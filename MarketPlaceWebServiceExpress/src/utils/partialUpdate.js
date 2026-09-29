// ประกอบคำสั่ง UPDATE จาก "เฉพาะฟิลด์ที่ client ส่งมาจริง"
//
// ที่มา: endpoint ฝั่งแอดมินหลายตัว destructure req.body พร้อม default เป็น '' แล้ว
// UPDATE ทับทุกคอลัมน์เสมอ ส่ง payload ไม่ครบจึงได้ 200 พร้อมข้อมูลเดิมถูกล้างทิ้ง
// เช่น POST /updateProductItemMain ส่งแค่ { code, dimension_38 } ทำให้ name_1,
// description, item_pattern (ตัวที่ควบคุมว่าสินค้าโชว์ในร้านไหม) กลายเป็นค่าว่างหมด
//
// หลักการที่ใช้ทุกจุด — แยก 3 กรณีนี้ออกจากกันให้ชัด:
//   ไม่ส่ง key มา     = ไม่แตะคอลัมน์นั้น
//   ส่งมาผิดชนิด      = ให้ผู้เรียกปฏิเสธ (ตรวจแยกต่างหาก)
//   ส่งมาเป็นค่าว่าง  = ล้างจริงตามเจตนา
//
// ⚠️ ชื่อคอลัมน์ต้องมาจาก whitelist ที่โค้ดกำหนดเท่านั้น ห้ามเอา key ของ client
//    ไปต่อเป็น SQL ตรงๆ ไม่งั้นจะเปลี่ยนบั๊ก "ข้อมูลหาย" เป็นช่องโหว่ SQL injection

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

/**
 * คัดเฉพาะฟิลด์ที่ client ส่งมาจริงและอยู่ใน whitelist
 *
 * @param {object} body req.body
 * @param {Array} allowed รายการคอลัมน์ที่ยอมให้เขียน — string หรือ { key, column, normalize }
 * @returns {{ columns: string[], values: any[] }}
 */
function pickProvidedFields(body, allowed) {
  const columns = [];
  const values = [];

  for (const entry of Array.isArray(allowed) ? allowed : []) {
    const field = typeof entry === 'string' ? { key: entry } : entry || {};
    const key = field.key;
    if (!key || !hasOwn(body, key)) continue;

    // undefined ถือว่า "ไม่ได้ส่ง" เพราะ JSON.stringify ตัดทิ้งอยู่แล้ว
    // การเจอ undefined จึงมาจากการประกอบ object ฝั่ง JS ไม่ใช่เจตนาจะล้างค่า
    const raw = body[key];
    if (raw === undefined) continue;

    columns.push(field.column || key);
    values.push(typeof field.normalize === 'function' ? field.normalize(raw) : raw);
  }

  return { columns, values };
}

/**
 * ประกอบส่วน SET ของ UPDATE พร้อมลำดับพารามิเตอร์
 * คืน null ถ้าไม่มีคอลัมน์ให้เขียน (ผู้เรียกควรตอบ 400 แทนการรัน UPDATE เปล่า)
 *
 * @param {string[]} columns ชื่อคอลัมน์ที่ผ่าน whitelist มาแล้ว
 * @param {number} startIndex ลำดับ $n ที่จะเริ่ม (เผื่อมีพารามิเตอร์อื่นมาก่อน)
 */
function buildSetClause(columns, startIndex = 1) {
  if (!Array.isArray(columns) || columns.length === 0) return null;
  return columns.map((col, i) => `${col}=$${startIndex + i}`).join(', ');
}

/**
 * ประกอบส่วน DO UPDATE SET ของ INSERT ... ON CONFLICT
 * ใช้กับตารางที่อาจยังไม่มีแถวของสินค้านั้น
 */
function buildConflictSetClause(columns) {
  if (!Array.isArray(columns) || columns.length === 0) return null;
  return columns.map((col) => `${col}=EXCLUDED.${col}`).join(', ');
}

module.exports = { pickProvidedFields, buildSetClause, buildConflictSetClause, hasOwn };
