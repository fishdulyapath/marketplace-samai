// กรองรหัสก่อนส่งเข้า sml_ic_function_stock_balance_warehouse_location()
//
// ⚠️ อ่านก่อนแก้ — การใช้ $1 ไม่ได้ป้องกันฟังก์ชันตัวนี้
//
// ฟังก์ชันของ ERP รับค่าเข้าไปแล้วเอาไปต่อสตริงเป็น SQL แล้ว EXECUTE ต่ออีกทอด
// โดยผ่าน gen_code_list() ที่ครอบ '' ให้เฉยๆ ไม่ได้ escape อะไรเลย:
//
//   temp_text := temp_text||''''||value1||'''';   -- gen_code_list
//   return query execute(query_text);             -- ฟังก์ชันหลัก
//
// $1 จึงกันได้แค่ชั้นนอก พอค่าเข้าไปถึงในฟังก์ชันมันถูก parse เป็น SQL อีกรอบ
// = second-order SQL injection ที่ parameterized query กันไม่ได้
//
// พิสูจน์กับฐานทดสอบแล้ว ส่ง item_code = ZZZ') or 1=1 or ic_code in ('
//   ยอดคงเหลือ 26  ->  3,704,846 (ทั้งคลัง)
//   และดึงข้อมูลตาราง ar_customer ออกมาได้แบบ blind boolean
//
// แก้ที่ฟังก์ชันไม่ได้เพราะเป็นของ ERP (smlerp) ที่ระบบอื่นใช้ร่วมกัน
// ทางเดียวที่เหลือคือกรองให้สะอาดก่อนส่งเข้าไป — ทุกจุดที่เรียกต้องผ่านที่นี่

// อนุญาตเฉพาะตัวอักษร/ตัวเลข/. _ / - และช่องว่าง
// ข้อมูลจริงในฐานใช้แค่ [-0-9A-Z] เผื่อพยัญชนะไทยไว้ด้วย
// แต่ \p{L} ไม่ครอบสระ/วรรณยุกต์ไทย (เป็น combining mark หมวด Mn) เช่น ลัง24 กับ น้ำ จึงตก
// ถ้าวันหนึ่งต้องรองรับรหัสไทยเต็มรูป ต้องเพิ่ม \p{M} ที่นี่ ดูหมายเหตุที่ ERP_CODE_SQL_PATTERN ด้วย
// สิ่งที่กันคือ ' \ ; ( ) และ , : ที่เป็นตัวคั่นของ gen_code_list เอง
const ERP_CODE_PATTERN = /^[\p{L}\p{N}._/ -]+$/u;

// รูปแบบเดียวกันสำหรับใช้ฝั่ง SQL — ใช้กับรหัสที่ string_agg มาจากตาราง
// (รหัสในตะกร้ามาจาก client ตอน additemtocart จึงเชื่อไม่ได้เหมือนกัน)
// PostgreSQL ไม่มี \p{L} ใช้ [[:alnum:]] แทน
//
// ⚠️ เรื่องค่าว่างต้องตรงกับฝั่ง JS เป๊ะ ไม่งั้นเกิดบั๊กแบบที่เคยเจอมาแล้ว
//    เคยใช้ + ตัวเดียวทั้งสองที่ ทำให้ wh_code ว่าง (ที่ฝั่ง JS ปล่อยผ่าน) ถูก SQL กรองทิ้ง
//    สต็อกในตะกร้าเลยกลายเป็น 0 ทั้งที่ของเต็มคลัง จึงต้องมีตัวที่ยอมให้ว่างแยกไว้
//
// ⚠️ สองฝั่งไม่ได้ตัดสินเหมือนกันทุกกรณี — วัดกับฐานจริง (lc_ctype = th_TH.UTF-8) แล้ว
//    [[:alnum:]] ของ PostgreSQL รับสระไทยบางตัวที่ \p{L} ของ JS ไม่รับ:
//      ลัง24 / ที  ->  SQL ผ่าน  JS ตก
//      สินค้า-01 / น้ำ  ->  ตกทั้งคู่
//    ทิศทางนี้ปลอดภัยเพราะ JS เข้มกว่า รหัสอันตรายถูกกันตั้งแต่ทางเข้าอยู่แล้ว
//    และตอนนี้ในฐานไม่มีรหัสที่ตกสักตัว (สแกน ic_inventory / ic_wh_shelf / ic_shelf แล้ว 0 แถว)
//    ถ้าจะรองรับรหัสไทยเต็มรูป ต้องแก้พร้อมกันทั้งสองฝั่ง ห้ามแก้ข้างเดียว
const ERP_CODE_SQL_PATTERN = '^[[:alnum:]._/ -]+$';

// สำหรับคอลัมน์ที่ค่าว่างมีความหมายจริง (wh_code / shelf_code ว่าง = ไม่กรองคลัง)
// ตรงกับ checkErpCode() ฝั่ง JS ที่ปล่อยค่าว่างผ่าน
const ERP_CODE_SQL_PATTERN_OPTIONAL = '^[[:alnum:]._/ -]*$';

const MAX_ERP_CODE_LENGTH = 50;

function isSafeErpCode(value) {
  if (value === null || value === undefined) return false;
  const text = String(value);
  if (text.length === 0 || text.length > MAX_ERP_CODE_LENGTH) return false;
  return ERP_CODE_PATTERN.test(text);
}

/**
 * ตรวจรหัสเดี่ยว — ค่าว่างถือว่าผ่าน เพราะฟังก์ชัน ERP ใช้ '' แปลว่า "ไม่กรอง"
 * คืนข้อความ error ภาษาไทยถ้าไม่ผ่าน คืน null ถ้าผ่าน
 *
 * ⚠️ ตรวจค่าดิบ ไม่ trim ก่อน — route เอาค่าดิบไปต่อ SQL ถ้าตรวจค่าที่ trim แล้ว
 *    จะกลายเป็นตรวจคนละค่ากับที่ใช้จริง (item_code=%0A เคยได้ 200 เพราะ trim แล้วเหลือว่าง)
 *    ช่องว่างอยู่ใน allowlist อยู่แล้ว รหัสที่มีเว้นวรรคหัวท้ายจึงยังผ่านเหมือนเดิม
 */
function checkErpCode(value, label) {
  const text = String(value ?? '');
  if (text === '') return null;
  if (text.length > MAX_ERP_CODE_LENGTH) return `${label} ยาวเกินกำหนด`;
  if (!ERP_CODE_PATTERN.test(text)) return `${label} มีอักขระที่ไม่อนุญาต`;
  return null;
}

/**
 * ตรวจหลายรหัสพร้อมกัน คืนข้อความ error ตัวแรกที่เจอ หรือ null ถ้าผ่านหมด
 * ใช้ที่ต้นทางของ route: const err = checkErpCodes({ item_code, wh_code });
 */
function checkErpCodes(fields) {
  for (const [label, value] of Object.entries(fields || {})) {
    const err = checkErpCode(value, label);
    if (err) return err;
  }
  return null;
}

/**
 * คัดเฉพาะรหัสที่ปลอดภัยออกมาเป็นอาร์เรย์ สำหรับจุดที่ต้องประกอบ CSV
 * ส่งเข้าฟังก์ชัน ERP (ตัวฟังก์ชันแยกรายการด้วย , เอง)
 *
 * ทิ้งตัวที่ไม่ผ่านแทนที่จะโยน error เพราะจุดที่ใช้เป็นการอ่านสต็อกหลายรายการ
 * รหัสเสียหนึ่งตัวไม่ควรทำให้ทั้งตะกร้าดูสต็อกไม่ได้ — ผลคือรายการนั้นได้สต็อก 0
 */
function filterErpCodeList(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value ?? '').trim();
    if (text !== '' && text.length <= MAX_ERP_CODE_LENGTH && ERP_CODE_PATTERN.test(text)) out.push(text);
  }
  return out;
}

module.exports = {
  ERP_CODE_PATTERN,
  ERP_CODE_SQL_PATTERN,
  ERP_CODE_SQL_PATTERN_OPTIONAL,
  MAX_ERP_CODE_LENGTH,
  isSafeErpCode,
  checkErpCode,
  checkErpCodes,
  filterErpCodeList,
};
