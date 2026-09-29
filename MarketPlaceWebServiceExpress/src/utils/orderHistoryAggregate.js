// ยุบเอกสารย่อยหลายใบให้เป็น 1 คำสั่งซื้อที่ลูกค้าเห็น (REQ4)
//
// 1 คำสั่งซื้อที่เกิน 8 บรรทัดจะถูกแบ่งเป็น BSW...-1, -2, -3 ใน ERP
// แต่ลูกค้าต้องเห็นเลขหลัก BSW... ใบเดียวพร้อมยอดรวมของทุกใบ
//
// ทำใน JS ไม่ใช่ GROUP BY ใน SQL เพราะ CTE ประวัติมี SELECT DISTINCT + correlated subquery หลายชั้น
// การไปแตะมันเสี่ยงทำ logic สถานะของ ERP พัง และแบบนี้เขียน test ได้โดยไม่ต้องต่อ DB

// เรียงจากคืบหน้าน้อย → มาก · สถานะรวมของกลุ่มใช้ตัวที่คืบหน้าน้อยสุด
// (ถ้าใบหนึ่งยังไม่จัดของ ทั้งคำสั่งซื้อก็ยังไม่เสร็จ)
const STATUS_ORDER = ['pending', 'packing', 'payment', 'success'];

function toNumber(value, fallback = 0) {
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function firstNonEmpty(current, next) {
  const text = String(current ?? '').trim();
  if (text) return current;
  return next;
}

// ยอดที่มาจากตัวใบ QT เอง — เมื่อ QT ใบเดียวถูกแตกเป็นใบสั่งขายหลายใบ
// ค่าพวกนี้จะซ้ำมาทุกแถว ถ้าบวกจะบวมเป็น N เท่า จึงเอาค่าแรกอย่างเดียว
//
// 🚨 แต่กรณีเอกสารย่อย BSW...-1/-2 (QT คนละใบจริงๆ) ต้องบวกเหมือนเดิม
//    ตัวแยกคือ main_doc_no เดียวกันแต่ doc_no ต่างกัน = คนละใบ QT
const QT_LEVEL_SUM_FIELDS = [
  'total_amount',
  'total_before_vat',
  'total_except_vat',
  'total_after_vat',
  'total_vat_value',
];

// ยอดที่เกิดจากใบสั่งขาย/ใบกำกับ — ต้องบวกข้ามใบเสมอ
const DOC_LEVEL_SUM_FIELDS = [
  'invoiced_amount',
  'balance',
  'wallet_amount',
  'cn_total_amount',
];

const SUM_FIELDS = [...QT_LEVEL_SUM_FIELDS, ...DOC_LEVEL_SUM_FIELDS];

// ข้อความ/รหัสอ้างอิง เอาค่าแรกที่ไม่ว่าง
const FIRST_TEXT_FIELDS = [
  'cust_code',
  'send_type',
  'emp_code',
  'emp_name',
  'remark_qt',
  'remark_cancel',
  'remark_inv',
  'remark_5',
  'inv_doc_no',
  'inv_doc_date',
];

function resolveGroupStatus(statuses) {
  const list = statuses.filter(Boolean);
  if (list.length === 0) return '';
  // ยกเลิกทั้งหมด = ทั้งคำสั่งซื้อถูกยกเลิก
  if (list.every((s) => s === 'cancel')) return 'cancel';

  // ใบที่ยังไม่ยกเลิกเป็นตัวกำหนดความคืบหน้า
  const active = list.filter((s) => s !== 'cancel');
  let best = null;
  let bestIdx = Number.POSITIVE_INFINITY;
  for (const status of active) {
    const idx = STATUS_ORDER.indexOf(status);
    const rank = idx < 0 ? Number.POSITIVE_INFINITY : idx;
    if (rank < bestIdx) {
      bestIdx = rank;
      best = status;
    }
  }
  return best ?? active[0];
}

// rows = แถวดิบจาก CTE (1 แถว = 1 เอกสารย่อย) ต้องมี main_doc_no ติดมาด้วย
// คืน: 1 แถวต่อ 1 เลขหลัก เรียงตามลำดับที่พบครั้งแรก (SQL เรียงมาแล้ว)
function aggregateOrderRowsByMainDoc(rows) {
  const groups = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const mainDocNo = String(row?.main_doc_no || row?.doc_no || '').trim();
    if (!mainDocNo) continue;

    const existing = groups.get(mainDocNo);
    if (!existing) {
      groups.set(mainDocNo, {
        ...row,
        doc_no: mainDocNo,
        sub_doc_count: 1,
        __statuses: [row.status],
        // เลข QT ที่นับยอดระดับใบไปแล้ว — กันบวกซ้ำเมื่อ QT ใบเดียวมีหลายใบสั่งขาย
        __qtDocNos: new Set([String(row.doc_no || '')]),
        // รายใบย่อยพร้อมสถานะ — หน้าจอต้องบอกได้ว่าใบไหนถูกยกเลิกใน ERP
        sub_docs: [{
          doc_no: String(row.doc_no || ''),
          so_doc_no: String(row.so_doc_no || ''),
          inv_doc_no: String(row.inv_doc_no || ''),
          status: row.status,
          total_amount: toNumber(row.total_amount, 0),
        }],
        // เก็บเลขจริงของใบที่มีรูปหลักฐานการส่ง
        // 🚨 ห้ามใส่เลขหลัก — image.js ค้น sml_doc_images.image_id = doc_no ตรงตัว รูปจะหายทั้งหมด
        delivery_image_doc_no: toInt(row.delivery_image_count, 0) > 0 ? row.delivery_image_doc_no : '',
        delivery_image_count: toInt(row.delivery_image_count, 0),
      });
      continue;
    }

    existing.sub_doc_count += 1;
    existing.__statuses.push(row.status);
    existing.sub_docs.push({
      doc_no: String(row.doc_no || ''),
      so_doc_no: String(row.so_doc_no || ''),
      inv_doc_no: String(row.inv_doc_no || ''),
      status: row.status,
      total_amount: toNumber(row.total_amount, 0),
    });

    // แถวนี้เป็นใบ QT ใบเดิมหรือใบใหม่ — ตัดสินยอดระดับ QT ว่าจะบวกหรือไม่
    const isSameQtDoc = existing.__qtDocNos.has(String(row.doc_no || ''));
    if (!isSameQtDoc) {
      existing.__qtDocNos.add(String(row.doc_no || ''));
      for (const field of QT_LEVEL_SUM_FIELDS) {
        existing[field] = toNumber(existing[field], 0) + toNumber(row[field], 0);
      }
    }

    for (const field of DOC_LEVEL_SUM_FIELDS) {
      existing[field] = toNumber(existing[field], 0) + toNumber(row[field], 0);
    }

    for (const field of FIRST_TEXT_FIELDS) {
      existing[field] = firstNonEmpty(existing[field], row[field]);
    }

    // วันส่งของทั้งคำสั่งซื้อ = ใบที่ส่งช้าสุด — ลูกค้าได้ของครบเมื่อใบสุดท้ายถึง
    // 🚨 ห้ามใช้ "ค่าแรกที่เจอ" เพราะลำดับแถวของหน้าประวัติกับหน้ารายละเอียดไม่เท่ากัน
    //    QT ใบเดียวที่ถูกแตกเป็นใบสั่งขายหลายใบที่ส่งคนละวัน จะโชว์วันคนละวันในสองหน้า
    if (row.send_date && String(row.send_date) > String(existing.send_date || '')) {
      existing.send_date = row.send_date;
    }
    // ใบไหนใบหนึ่งได้วันจากเอกสารจริงแล้ว ก็ถือว่ายืนยันแล้ว
    if (toInt(row.send_date_confirmed, 0) === 1) existing.send_date_confirmed = 1;

    // วันเวลาที่ลูกค้ากดสั่ง = ใบแรกสุด
    if (row.doc_date && (!existing.doc_date || String(row.doc_date) < String(existing.doc_date))) {
      existing.doc_date = row.doc_date;
      existing.doc_time = row.doc_time;
    } else if (row.doc_date && String(row.doc_date) === String(existing.doc_date)) {
      if (row.doc_time && String(row.doc_time) < String(existing.doc_time || '')) {
        existing.doc_time = row.doc_time;
      }
    }

    const rowImageCount = toInt(row.delivery_image_count, 0);
    if (rowImageCount > 0) {
      existing.delivery_image_count += rowImageCount;
      if (!existing.delivery_image_doc_no) existing.delivery_image_doc_no = row.delivery_image_doc_no;
    }
  }

  return [...groups.values()].map((group) => {
    const { __statuses, __qtDocNos, ...rest } = group;
    // ยอดของใบที่ถูกยกเลิกไปแล้ว — total_amount ยังเป็นยอดรวมทุกใบเหมือนเดิม
    // (ไม่แตะ เพราะเป็นยอดที่ ERP ออกเอกสารไว้จริง) แต่ต้องบอกให้รู้ว่าส่วนไหนตกไป
    // ไม่งั้นยอดที่เห็นจะสูงกว่ายอดที่เก็บเงินได้จริงโดยไม่มีอะไรฟ้อง
    // 🚨 นับตามเลข QT ไม่ใช่ตามจำนวนแถว: QT ใบเดียวที่ถูกแตกเป็นใบสั่งขายหลายใบ
    //    จะมีหลายแถวที่ total_amount เท่ากันหมด (เป็นยอดของ QT ใบเดิม)
    //    ถ้านับทุกแถวยอดที่ยกเลิกจะบวมเป็นเท่าตัว
    const cancelledQtDocs = new Map();
    for (const d of rest.sub_docs) {
      if (d.status !== 'cancel') continue;
      const docNo = String(d.doc_no || '');
      if (!cancelledQtDocs.has(docNo)) cancelledQtDocs.set(docNo, toNumber(d.total_amount, 0));
    }
    const cancelledAmount = [...cancelledQtDocs.values()].reduce((sum, amount) => sum + amount, 0);
    const cancelledCount = cancelledQtDocs.size;
    // ใบย่อยอาจถูกดึงไป step ถัดไปไม่พร้อมกัน (ERP ออกใบส่งของทีละใบได้)
    // สถานะรวมใช้ใบที่คืบหน้าน้อยสุด ถ้าไม่บอกว่ามีใบอื่นเดินไปแล้ว
    // หน้าจอจะดูเหมือนไม่มีอะไรเกิดขึ้นเลย ทั้งที่ของบางส่วนกำลังจัดอยู่
    const activeStatuses = rest.sub_docs.filter((d) => d.status !== 'cancel').map((d) => d.status);
    const mixedProgress = new Set(activeStatuses).size > 1;
    return {
      ...rest,
      status: resolveGroupStatus(__statuses),
      mixed_progress: mixedProgress,
      cancelled_doc_count: cancelledCount,
      cancelled_amount: cancelledAmount,
      // ยอดที่ยังเดินหน้าอยู่จริง = ยอดรวม − ยอดใบที่ยกเลิก
      active_amount: toNumber(rest.total_amount, 0) - cancelledAmount,
    };
  });
}

module.exports = {
  STATUS_ORDER,
  resolveGroupStatus,
  aggregateOrderRowsByMainDoc,
};
