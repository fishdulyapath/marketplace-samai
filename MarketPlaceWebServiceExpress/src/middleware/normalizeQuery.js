// ── ทำให้ค่าใน query string เป็นสตริงเสมอ ────────────────────────────────
//
// ที่มา: `?cust_code=a&cust_code=b` ทำให้ Express (ผ่าน qs) คืนค่าเป็น array
// โค้ดเกือบทุก route เรียกเมธอดของสตริงต่อทันที เช่น `custCode.trim()`
// array ไม่มี `.trim` จึงโยน TypeError นอก try/catch ใน async handler
// ซึ่ง Express 4 ไม่จับ กลายเป็น unhandled rejection แล้ว Node 23 ฆ่า process ทิ้ง
// → request เดียวจากภายนอกทำให้ทั้งร้านดับได้ (พิสูจน์แล้วบนพอร์ตทดสอบ)
//
// สแกนแล้วพบจุดที่เรียก .trim() บนค่าดิบ 43 จุดใน 6 ไฟล์ การไล่แก้ทีละจุดไม่ยั่งยืน
// เพราะ endpoint ใหม่จะสร้างช่องเดิมขึ้นมาอีก จึงตัดที่ชั้น parse ให้จบทีเดียว
//
// ⚠️ ใช้กับ query string เท่านั้น ห้ามเอาไปใช้กับ req.body
//    เพราะ POST /additemtocart รับ body เป็น array จริง (cart.js:54)
//
// ⚠️ เจอหลายค่าให้เอา "ค่าแรก" เสมอ — สิ่งสำคัญคือ auth middleware กับตัว route
//    ต้องเห็นค่าเดียวกัน ถ้าเห็นคนละค่าจะกลายเป็นช่องโหว่ข้ามสิทธิ์

const qs = require('qs');

// ค่าเริ่มต้นเดียวกับ Express 4 โหมด 'extended' เพื่อไม่ให้พฤติกรรมเดิมเปลี่ยน
const QS_OPTIONS = { allowPrototypes: true, depth: 5, parameterLimit: 1000 };

// array → ค่าแรก · object (จาก a[x]=1) → สตริงว่าง เพราะไม่มี route ไหนรองรับ
// undefined/null คงไว้ตามเดิม ให้ปลายทางตัดสินใจเอง (บาง route แยกแยะ "ไม่ส่งมา" กับ "ส่งค่าว่าง")
function flattenValue(value) {
  if (Array.isArray(value)) {
    const first = value.find((item) => item !== undefined && item !== null);
    return flattenValue(first === undefined ? '' : first);
  }
  if (value !== null && typeof value === 'object') return '';
  return value;
}

function flattenQuery(parsed) {
  const out = {};
  for (const key of Object.keys(parsed)) {
    out[key] = flattenValue(parsed[key]);
  }
  return out;
}

// ใช้กับ app.set('query parser', queryParser) — Express 4 รองรับฟังก์ชันเอง
// ทำที่ชั้น parse จึงไม่ต้อง mutate req.query (การ assign ทับใช้ไม่ได้ใน Express 5)
function queryParser(str) {
  if (!str) return {};
  return flattenQuery(qs.parse(str, QS_OPTIONS));
}

module.exports = { queryParser, flattenQuery, flattenValue };
