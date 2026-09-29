// ตัวกรองของหน้า "คำสั่งซื้อ (หลังบ้าน)"
//
// แยกออกมาเป็น pure function เพื่อให้เขียนเทสต์ได้โดยไม่ต้องมี DB
// และเพื่อให้กติกา "ย้อนหลัง 7 วัน" อยู่ที่เดียว ไม่กระจายไปทั้ง route กับหน้าจอ

// ย้อนหลัง 7 วันโดยนับรวมวันนี้ด้วย (วันนี้-6 ถึง วันนี้)
const DEFAULT_RANGE_DAYS = 7;

// จำกัดช่วงกว้างสุดกันเผลอลากยาวจนดึงทั้งฐาน
const MAX_RANGE_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  const text = String(value ?? '').trim();
  if (!ISO_DATE.test(text)) return false;
  // กันวันที่ที่หน้าตาถูกแต่ไม่มีจริง เช่น 2026-02-31 หรือ 2026-13-01
  // Date.UTC ปัดวันเกินให้เลื่อนเดือน จึงเทียบกลับว่าได้ค่าเดิมไหม
  const [y, m, d] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function shiftDays(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * แปลงค่า date_from / date_to ที่รับมาเป็นช่วงวันที่ที่ใช้ query ได้
 *
 * ไม่ส่งมาเลย        -> ย้อนหลัง 7 วันนับรวมวันนี้
 * ส่งมาแค่ date_from -> ถึงวันนี้
 * ส่งมาแค่ date_to   -> ย้อนหลัง 7 วันนับจากวันนั้น
 *
 * @param {string} rawFrom
 * @param {string} rawTo
 * @param {string} today วันที่ของเซิร์ฟเวอร์ (YYYY-MM-DD) — ส่งเข้ามาเพื่อให้เทสต์คุมได้
 */
function resolveDateRange(rawFrom, rawTo, today) {
  const from = String(rawFrom ?? '').trim();
  const to = String(rawTo ?? '').trim();

  if (!isIsoDate(today)) return { error: 'วันที่อ้างอิงของเซิร์ฟเวอร์ไม่ถูกต้อง' };
  if (from && !isIsoDate(from)) return { error: 'จากวันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD' };
  if (to && !isIsoDate(to)) return { error: 'ถึงวันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD' };

  const dateTo = to || today;
  const dateFrom = from || shiftDays(dateTo, -(DEFAULT_RANGE_DAYS - 1));

  if (dateFrom > dateTo) return { error: 'จากวันที่ต้องไม่เกินถึงวันที่' };
  if (daysBetween(dateFrom, dateTo) + 1 > MAX_RANGE_DAYS) {
    return { error: `เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน` };
  }

  return { dateFrom, dateTo };
}

module.exports = { DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS, isIsoDate, resolveDateRange, shiftDays };
