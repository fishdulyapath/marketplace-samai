// ประกอบ pattern ของ LIKE/ILIKE จากคำค้นของผู้ใช้
//
// 🚨 การเขียน `%${search}%` ตรงๆ ทำให้ % และ _ ที่ผู้ใช้พิมพ์กลายเป็น wildcard ของ LIKE
//    ไม่ใช่ช่องโหว่ SQL injection (ค่ายังส่งผ่าน $n) แต่ผลการค้นหาผิด:
//      search=%   -> คืนสินค้าทั้งฐาน เท่ากับไม่ได้ค้นเลย
//      search=_   -> เหมือนกัน
//      search=__B4 -> ไปเจอ 06-4527 (...สีลาเต้ CB4) เพราะ _ แทนอักขระใดก็ได้
//    ยิงจริงกับ /getProductList และ /getProductManageList แล้วได้ผลตามนี้ทั้งคู่
//
// PostgreSQL ใช้ \ เป็น escape character ของ LIKE โดยปริยาย จึงต้อง escape ตัว \ เองด้วย
// (ต้องเป็นตัวแรก ไม่งั้นจะไป escape ตัวที่เราเพิ่งใส่เข้าไป)

function escapeLike(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/[%_]/g, (ch) => `\\${ch}`);
}

/** คำค้น -> '%คำค้น%' ที่ปลอดภัยกับ LIKE */
function likeContains(value) {
  return `%${escapeLike(value)}%`;
}

module.exports = { escapeLike, likeContains };
