// เลขที่เอกสารคำสั่งซื้อ marketplace (REQ4)
//
// รูปแบบ: BSW + YYMMDD + running 4 หลัก (รีเซ็ตทุกวัน) = BSW2608010001
// ถ้า 1 คำสั่งซื้อถูกแบ่งเป็นหลายเอกสาร (ERP รับได้ไม่เกิน 8 บรรทัด/ใบ) จะต่อท้ายด้วย -1 -2 -3
// ใบเดียวไม่มี suffix — เลขที่ลูกค้าเห็นจะตรงกับเลขใน ERP
//
// ⚠️ ห้ามใช้ pos.js resolveDocNo — มันกรองด้วย char_length(doc_no) คงที่
//    ซึ่งจะตัดเลขที่มี suffix ทิ้งทั้งหมด ทำให้ running นับใหม่จาก 0 ทุกวันและออกเลขซ้ำ

const DEFAULT_PATTERN = 'BSWYYMMDD####';

function safeText(value) {
  return String(value ?? '').trim();
}

// 'BSWYYMMDD####' + '2026-08-01' → 'BSW260801####'
function buildDocPattern(pattern, docDate) {
  const text = safeText(pattern) || DEFAULT_PATTERN;
  const date = safeText(docDate);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return text;

  const [, year4, month, day] = match;
  const year2 = year4.slice(2);
  return text
    .replace(/YYYY/g, year4)
    .replace(/YY/g, year2)
    .replace(/MM/g, month)
    .replace(/DD/g, day);
}

// 'BSW260801####' → { prefix: 'BSW260801', runLen: 4 }
function splitPattern(pattern) {
  const text = safeText(pattern);
  const firstHash = text.indexOf('#');
  if (firstHash < 0) return { prefix: text, runLen: 0 };

  let runLen = 0;
  while (firstHash + runLen < text.length && text[firstHash + runLen] === '#') runLen++;
  return { prefix: text.slice(0, firstHash), runLen };
}

// regex ที่ใช้ทั้งฝั่ง JS และ SQL — ต้องมาจากที่เดียวกัน ไม่งั้นเปลี่ยน pattern แล้วลืมแก้จุดใดจุดหนึ่ง
function mainDocNoRegexSource(prefixLetters = 'BSW') {
  return `^${prefixLetters}[0-9]{10}(-[0-9]{1,3})?$`;
}

// หา running สูงสุดจากรายการเลขเอกสาร
// ⚠️ ต้องนับเลขที่มี suffix ด้วย (BSW2608010001-2 ก็คือ running 1) ไม่งั้นออกเลขซ้ำ
function maxRunningFromDocNos(docNos, prefix, runLen) {
  const p = safeText(prefix);
  if (!p || runLen <= 0) return 0;

  // ^PREFIX(\d{runLen})(-\d{1,3})?$
  const pattern = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d{${runLen}})(?:-\\d{1,3})?$`);
  let max = 0;
  for (const docNo of Array.isArray(docNos) ? docNos : []) {
    const m = pattern.exec(safeText(docNo));
    if (!m) continue;
    const running = parseInt(m[1], 10);
    if (Number.isFinite(running) && running > max) max = running;
  }
  return max;
}

// เลขเอกสารย่อย: ใบเดียวไม่มี suffix, หลายใบต่อท้าย -1 -2 -3
function formatSubDocNo(mainDocNo, seq, total) {
  const main = safeText(mainDocNo);
  if (!main) return '';
  if (toPositiveInt(total, 1) <= 1) return main;
  return `${main}-${toPositiveInt(seq, 1)}`;
}

function toPositiveInt(value, fallback = 0) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

// เลขย่อย → เลขหลัก · เลขที่ไม่ใช่รูปแบบ BSW คืนค่าเดิม (ข้อมูลเก่า MQT/PREQT ต้องไม่ถูกแตะ)
function mainDocNoOf(docNo, prefixLetters = 'BSW') {
  const text = safeText(docNo);
  if (!new RegExp(mainDocNoRegexSource(prefixLetters)).test(text)) return text;
  const idx = text.indexOf('-');
  return idx > 0 ? text.slice(0, idx) : text;
}

// นิพจน์ SQL แปลงเลขย่อย → เลขหลัก
// 🚨 ห้ามใช้ split_part(doc_no,'-',1) เปล่าๆ — ข้อมูลเก่า MQT20250815-ABC12 จะกลายเป็น MQT20250815
//    ทำให้ทุกใบของวันเดียวกันยุบรวมเป็นออเดอร์เดียว ประวัติลูกค้าพังทันที
function MAIN_DOC_NO_SQL(alias, prefixLetters = 'BSW') {
  const col = `${alias}.doc_no`;
  return `CASE WHEN ${col} ~ '${mainDocNoRegexSource(prefixLetters)}' THEN split_part(${col}, '-', 1) ELSE ${col} END`;
}

// กุญแจของ "กลุ่มเอกสาร" สำหรับใช้ทำ advisory lock
//
// 🚨 docNoPrefixCondition ทำให้เลขหลักครอบเลขย่อยทั้งกลุ่ม แต่เลขย่อยครอบแค่ตัวเอง
//    ถ้าเอาค่าดิบที่ client ส่งมาทำกุญแจล็อก การยิง "เลขหลัก" พร้อม "เลขย่อย" จะได้คนละล็อก
//    ทั้งคู่จึงอ่าน state พร้อมกันแล้วสร้างใบยกเลิกซ้ำ ยอดยกเลิกเป็นทวีคูณ (ยิงจริงแล้วได้ 1,559 จาก 852)
//
// ไม่ใช้ mainDocNoOf() เพราะมันผูกกับ prefixLetters ถ้ารูปแบบเลขถูกตั้งค่าเป็นอย่างอื่น
// regex จะไม่แมตช์แล้วคืนค่าเดิม = กลับไปแตกล็อกอีก · ตัดท้าย -<ตัวเลข> ตรงๆ ตรงกับที่
// formatSubDocNo สร้าง (-1, -2, ... -12) และไม่แตะข้อมูลเก่าแบบ MQT20250815-ABC12
function docGroupKey(docNo) {
  return safeText(docNo).replace(/-\d+$/, '');
}

// เงื่อนไขค้นด้วยเลขหลัก — ใช้ index ได้ (ต่างจากการ derive ทุกแถว)
// รองรับข้อมูลเก่า: doc_no = 'MQT...-ABC12' จะ match ตรงตัวจากสาขาแรก
function docNoPrefixCondition(alias, paramIndex) {
  return `(${alias}.doc_no = $${paramIndex} OR ${alias}.doc_no LIKE $${paramIndex} || '-%')`;
}

// กัน % และ _ ที่เป็น wildcard ของ LIKE หลุดเข้ามาทางพารามิเตอร์
function isValidDocNoParam(value) {
  return /^[A-Za-z0-9-]{1,30}$/.test(safeText(value));
}

// ออกเลขหลักถัดไปของวันนั้น — ต้องเรียกภายใน transaction เดียวกับที่ INSERT เอกสาร
//
// 🚨 lock ต้องจับ "ก่อน INSERT header ตัวแรก" เท่านั้น ห้ามจับตั้งแต่ต้น transaction
//    เพราะ lock นี้ global ต่อวัน ถ้าจับคร่อม expandOrderItems (ซึ่งเรียก getProductPriceLocalx
//    ที่ไล่ราคา 7 ชั้น) จะทำให้ checkout ทั้งระบบต่อคิวกัน
//
// ใช้วิธี scan ic_trans แทนตาราง counter เพราะ counter จะ drift ถ้า ERP ลบ/import เอกสาร
// แล้วออกเลขซ้ำ ส่วน scan self-healing เสมอ
async function resolveMainDocNo(client, { pattern, docDate, transFlag = 30, includePendingReservations = false }) {
  const expanded = buildDocPattern(pattern, docDate);
  const { prefix, runLen } = splitPattern(expanded);
  if (!prefix || runLen <= 0) throw new Error(`invalid order doc pattern: ${pattern}`);

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`marketplace:docno:${transFlag}:${prefix}`]);

  const rs = await client.query(
    `SELECT doc_no FROM ic_trans WHERE trans_flag = $1 AND doc_no LIKE $2 || '%'`,
    [transFlag, prefix]
  );

  const reserved = includePendingReservations ? await client.query(
    'SELECT reserved_qt_no AS doc_no FROM marketplace_pending_order WHERE reserved_qt_no LIKE $1', [`${prefix}%`]
  ) : { rows: [] };
  const next = maxRunningFromDocNos([...rs.rows, ...reserved.rows].map((r) => r.doc_no), prefix, runLen) + 1;
  if (next > Math.pow(10, runLen) - 1) {
    throw new Error(`order running number overflow for ${prefix}`);
  }
  return prefix + String(next).padStart(runLen, '0');
}

module.exports = {
  DEFAULT_PATTERN,
  resolveMainDocNo,
  buildDocPattern,
  splitPattern,
  maxRunningFromDocNos,
  formatSubDocNo,
  mainDocNoOf,
  docGroupKey,
  mainDocNoRegexSource,
  MAIN_DOC_NO_SQL,
  docNoPrefixCondition,
  isValidDocNoParam,
};
