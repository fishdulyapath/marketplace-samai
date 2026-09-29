// ส่วนประกอบของสินค้าชุดต้องมาจากแม่แบบของ ERP เท่านั้น ค่าที่ client ส่งมาไม่มีผล
//
// 🚨 findPriceViolations ตรวจเฉพาะบรรทัดระดับบน ไม่เคยแตะ sub_item เลย client จึงส่ง
//    ราคาชิ้นส่วนอะไรก็ได้ รวมถึงติดลบ แล้วมันถูกเขียนลง ic_trans_detail ตรงๆ
//    ยอดที่ "หัวเอกสาร" ยังถูก เพราะหัวชุดถูกตรวจกับ SUM(sum_amount) ของแม่แบบอยู่แล้ว
//    แต่บรรทัดย่อยที่ผลรวมไม่ตรงหัวชุดทำให้เอกสารใน ERP กระทบยอดไม่ได้
//    ยิงจริงแล้ว: ชุด 27-1393 ราคาหัว 3,010 แต่ปั่นราคา sub เป็น 999999 กับ 888888
//    ได้ 200 และผลรวมบรรทัดย่อยกลายเป็น 11,666,655 ไม่ตรงหัวเอกสาร 3,010
//
// ⚠️ ห้ามเอาราคาชิ้นส่วนไปเทียบ "ราคาตลาด" ของสินค้านั้นเด็ดขาด — ERP ปันราคาภายในชุดเอง
//    ชิ้นส่วนราคา 0 เป็นเรื่องปกติ วัดกับแม่แบบจริงแล้วทั้ง 60 ชุดมีชิ้นส่วนราคา 0
//    สิ่งที่ยึดได้คือ "ต้องตรงกับแม่แบบ" ไม่ใช่ "ต้องสมเหตุสมผลตามราคาตลาด"
//
// วิธีที่เลือก: ประกอบ sub_item ใหม่จากแม่แบบทั้งชุด แทนการเทียบแล้วปฏิเสธ
//   - ปฏิเสธเมื่อไม่ตรงจะบล็อกออเดอร์ที่ถูกต้องได้ เช่นตอน setItemsCache ฝั่งหน้าร้าน
//     โหลดไม่ทันแล้วส่ง sub_item: [] มา (StepConfirmation.vue ทำแบบนั้นจริง)
//   - ประกอบใหม่ได้เอกสารที่ถูกต้องเสมอ และยอดที่ลูกค้ากดยืนยันก็ยังตรง เพราะราคาหัวชุด
//     ถูกตรวจกับ SUM(sum_amount) ของแม่แบบเดียวกันนี้อยู่แล้ว
//   - ที่ยังปฏิเสธคือ sub_item ผิดชนิด ซึ่งเป็น payload พังชัดเจน (ดู SUB_ITEM_NOT_ARRAY)

function toNumber(value, fallback = 0) {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value) {
  return String(value ?? '').trim();
}

/**
 * แปลงแถวจาก ic_inventory_set_detail เป็น Map ไว้ค้นเร็ว
 * @param {Array} rows [{ ic_set_code, ic_code, unit_code, qty, price, ... }]
 * @returns {Map<string, Array>} รหัสชุด -> รายการส่วนประกอบเรียงตามลำดับในแม่แบบ
 */
function buildSetTemplateMap(rows) {
  const bySet = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const setCode = safeText(row?.ic_set_code);
    const itemCode = safeText(row?.ic_code);
    if (!setCode || !itemCode) continue;
    // แถวที่ qty <= 0 ไม่มีอะไรให้เขียน ข้ามทิ้ง ถ้าข้ามจนไม่เหลือแถวเลยผู้เรียกจะตอบ 400
    // ตรงกับพฤติกรรมเดิมที่ปฏิเสธ sub ที่ qty <= 0 (ในฐานมี 5 ชุดแบบนี้ ราคารวม 0
    // และไม่ใช่ [W] จึงไม่โผล่หน้าร้านอยู่แล้ว — เป็นแม่แบบที่ยังตั้งไม่เสร็จ)
    if (toNumber(row?.qty, 0) <= 0) continue;
    if (!bySet.has(setCode)) bySet.set(setCode, []);
    // ฟิลด์ที่ใส่ตรงกับที่ INSERT ของ sub_item ใช้จริง (order.js) ไม่ใส่เกิน
    bySet.get(setCode).push({
      item_code: itemCode,
      item_name: safeText(row?.item_name) || itemCode,
      unit_code: safeText(row?.unit_code),
      qty: toNumber(row?.qty, 0),
      price: toNumber(row?.price, 0),
      barcode: safeText(row?.barcode),
      // หน้าร้านใช้ `setItem.price_ratio || 1` — ใช้ค่าเดียวกัน ไม่ใช่ 0 ตาม default ของ INSERT
      price_ratio: toNumber(row?.price_ratio, 1) || 1,
    });
  }
  return bySet;
}

/**
 * ประกอบ sub_item ของบรรทัดสินค้าชุดใหม่จากแม่แบบ
 *
 * @param {object} item บรรทัดสินค้าชุดที่ client ส่งมา (sub_item จะถูกเขียนทับ)
 * @param {Array} template ส่วนประกอบจากแม่แบบของชุดนี้
 * @returns {{reason: string, detail?: string}|null} null = ผ่าน
 */
function applySetTemplateToItem(item, template) {
  if (!item || typeof item !== 'object') return { reason: 'SUB_ITEM_NOT_OBJECT' };

  // ⚠️ ต้องตรวจชนิดก่อน — ตอนเขียนลง ERP ใช้ `it.sub_item || []` แล้ว for...of
  //    สตริงเป็น iterable จึงวนทีละตัวอักษร ส่ง sub_item:"abc" ได้บรรทัดขยะ
  //    item_code=NULL 3 บรรทัดใน ic_trans_detail (1 บรรทัดต่อ 1 ตัวอักษร)
  //    ด่านเดิมใช้ Array.isArray(...) ? ... : [] จึง "ข้ามการตรวจ" เมื่อไม่ใช่อาร์เรย์
  const provided = item.sub_item;
  if (provided !== undefined && provided !== null && !Array.isArray(provided)) {
    return { reason: 'SUB_ITEM_NOT_ARRAY' };
  }

  if (!Array.isArray(template) || template.length === 0) return { reason: 'SET_TEMPLATE_NOT_FOUND' };

  item.sub_item = template.map((row) => ({ ...row }));
  return null;
}

const SET_ISSUE_MESSAGES = {
  SUB_ITEM_NOT_ARRAY: 'รายการส่วนประกอบของสินค้าชุดต้องเป็นรายการ (array)',
  SUB_ITEM_NOT_OBJECT: 'รายการสินค้าชุดไม่สมบูรณ์',
  SET_TEMPLATE_NOT_FOUND: 'ไม่พบข้อมูลส่วนประกอบของสินค้าชุดนี้',
};

function setIssueMessage(issue, itemIndex) {
  const base = SET_ISSUE_MESSAGES[issue?.reason] || 'ข้อมูลสินค้าชุดไม่ถูกต้อง';
  return `สินค้าชุดลำดับที่ ${itemIndex + 1}: ${base}`;
}

module.exports = { buildSetTemplateMap, applySetTemplateToItem, setIssueMessage, SET_ISSUE_MESSAGES };
