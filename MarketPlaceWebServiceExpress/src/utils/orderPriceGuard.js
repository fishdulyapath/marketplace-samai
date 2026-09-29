// ตรวจความสอดคล้องของแต่ละบรรทัดในคำสั่งซื้อ ก่อนบันทึกเป็นเอกสาร
//
// เดิม sendorder เชื่อตัวเลขที่ client ส่งมาทั้งหมด การทดสอบยืนยันว่าสั่งของฟรีได้ 4 ทาง
// (สินค้าราคาจริง 92 บาท x 2 ชิ้น = 184):
//   price: "abc" / ไม่ส่ง price / price: {}  -> บันทึก price 0
//   sum_amount: 1                            -> ยอดหัวเอกสารเหลือ 1 บาท
//   สินค้าชุด                                 -> ไม่เคยถูกตรวจเลย
//
// แยกเป็น pure function เพราะตรรกะการตัดสินไม่ควรผูกกับการต่อฐานข้อมูล
// ผู้เรียกส่ง lookupPrice เข้ามาเอง จึงเขียนเทสต์ได้โดยไม่ต้องมี DB

// ยอมให้ต่างได้ระดับสตางค์ เพราะราคาผ่านการปัดเศษหลายชั้นระหว่าง client กับ server
const PRICE_TOLERANCE = 0.01;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ตัวเลขที่ยอมรับได้: ตัวเลขจริง หรือสตริงตัวเลข (client ส่ง price มาเป็นสตริงเสมอ)
// ปฏิเสธ: undefined, null, '', object, array, สตริงที่แปลงไม่ได้
// Number('') = 0 จึงต้องกันสตริงว่างแยกต่างหาก ไม่งั้น "ไม่ได้กรอกราคา" จะกลายเป็นฟรี
function isFiniteNumeric(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

// ข้ามบรรทัดที่ไม่ควรตรวจ:
//   - ของแถม (is_permium) ราคาถูกบังคับเป็น 0 ฝั่ง server อยู่แล้ว
//   - บรรทัดที่ไม่มีรหัสสินค้า/หน่วย จะถูกด่าน validation อื่นปฏิเสธก่อน
//
// ⚠️ สินค้าชุด (item_type=3) ตรวจ "บรรทัดหัวชุด" ด้วย แต่ผู้เรียกต้องหาราคาชุดจาก server
//    ให้ถูกทาง และ **ห้ามเอา sub_item ไปเทียบราคาตลาดรายตัวเด็ดขาด**
//    เพราะ ERP จัดสรรราคาภายในชุดเอง ดูเอกสารจริง: ชุด 27-1393 ราคา 3010
//    sub ตัวแรกรับ 3010 ทั้งก้อน ส่วน sub อีกตัวราคา 0 อย่างถูกต้อง
//    ถ้าเอาไปเทียบราคาตลาดจะปฏิเสธออเดอร์จริงทันที
function shouldCheckItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (toNumber(item.is_permium, 0) === 1) return false;
  return Boolean(String(item.item_code || '').trim() && String(item.unit_code || '').trim());
}

// ส่วนลดที่ยอมให้หักออกจากยอดเต็มของบรรทัด
//
// ERP กับ marketplace เก็บคนละแบบ จึงต้องรองรับทั้งคู่:
//   - เอกสาร ERP จริง: sum_amount หักส่วนลดแล้ว และ discount_amount ที่เก็บคือส่วนที่ไม่รวม VAT
//     (ตรวจจากของจริง: 26130 - 23400 = 2730 ส่วน discount_amount = 2551.40 = 2730 x 100/107)
//   - marketplace ปัจจุบัน: client ส่ง sum_amount = qty x price และ discount_amount แยก
//     (ยังไม่เคยมีบรรทัดที่มีส่วนลดจริงเลยสักแถว)
// จึงเผื่อเพดานเป็นค่าที่รวม VAT กลับเข้าไปแล้ว เพื่อไม่ให้ปฏิเสธของที่ถูกต้อง
function allowedDiscountFor(item, vatRate = 0) {
  const declared = toNumber(item?.discount_amount, 0);
  if (!(declared > 0)) return 0;
  const rate = toNumber(vatRate, 0);
  return rate > 0 ? declared * (1 + rate / 100) : declared;
}

// เพดานส่วนลดของบรรทัด — ขอบเขตทางคณิตศาสตร์คือห้ามเกินยอดเต็ม (qty x price)
//
// 🚨 เดิมใช้ allowedDiscountFor() มาเทียบกับ gross ตรงๆ ซึ่งกลับด้าน
//    การคูณ (1 + vat/100) เข้ากับ "ส่วนลดที่ client ส่งมา" ทำให้เพดานจริงเหลือ
//    gross / 1.07 = 93.46% ส่วนลด 95% หรือ 100% ที่ถูกต้องจึงโดน ORDER_PRICE_MISMATCH
//    เจตนาเดิมคืออยากผ่อนปรน แต่ผลออกมาเข้มขึ้น ต้องคูณเข้ากับ "เพดาน" ไม่ใช่ "ส่วนลด"
//
// ที่ต้องเผื่อ VAT เพราะสองระบบเก็บคนละฐาน ERP เก็บ discount_amount แบบไม่รวม VAT
// (26130 - 23400 = 2730 แต่เก็บ 2551.40 = 2730 x 100/107) ส่วน marketplace ส่งฐานเดียวกับ price
// ผ่อนปรนไปทางไม่ปฏิเสธของที่ถูกต้อง ของที่ผิดจริงยังโดนจับที่ SUM_AMOUNT_* อยู่แล้ว
function discountCeilingFor(gross, vatRate = 0) {
  const rate = toNumber(vatRate, 0);
  return rate > 0 ? gross * (1 + rate / 100) : gross;
}

/**
 * ตรวจบรรทัดเดียว คืนสาเหตุที่ผิด หรือ null ถ้าผ่าน
 * ตรวจได้โดยไม่ต้องรู้ราคา server (เป็นความสอดคล้องภายในของตัวเลขที่ client ส่งมา)
 */
function findLineIntegrityIssue(item, vatRate = 0) {
  if (!isFiniteNumeric(item?.price)) return 'PRICE_NOT_NUMERIC';

  const price = toNumber(item.price, 0);
  const qty = toNumber(item.qty, 0);
  if (price < 0) return 'PRICE_NEGATIVE';

  const declaredDiscount = toNumber(item?.discount_amount, 0);
  if (declaredDiscount < 0) return 'DISCOUNT_NEGATIVE';

  const gross = qty * price;
  const allowedDiscount = allowedDiscountFor(item, vatRate);
  // ส่วนลดเกินยอดเต็มของบรรทัด = ผิดแน่นอน (เป็นขอบเขตทางคณิตศาสตร์ ไม่ใช่กฎธุรกิจ)
  // เทียบ "ส่วนลดที่ประกาศ" กับ "เพดาน" ไม่ใช่เอาส่วนลดที่ขยายแล้วมาเทียบยอดเต็ม
  if (declaredDiscount > discountCeilingFor(gross, vatRate) + PRICE_TOLERANCE) return 'DISCOUNT_EXCEEDS_LINE';

  // ไม่ส่ง sum_amount มา = ให้ server คำนวณเอง ไม่ถือว่าผิด
  if (item?.sum_amount === null || item?.sum_amount === undefined) return null;
  if (!isFiniteNumeric(item.sum_amount)) return 'SUM_AMOUNT_NOT_NUMERIC';

  const sumAmount = toNumber(item.sum_amount, 0);
  if (sumAmount < 0) return 'SUM_AMOUNT_NEGATIVE';

  // ยอดบรรทัดต้องอยู่ระหว่าง "เต็มราคาหักส่วนลดที่ประกาศไว้" ถึง "เต็มราคา"
  // ถ้าไม่มีส่วนลด ช่วงนี้จะแคบเหลือค่าเดียว = ต้องเท่ากับ qty x price พอดี
  if (sumAmount > gross + PRICE_TOLERANCE) return 'SUM_AMOUNT_ABOVE_LINE';
  if (sumAmount < gross - allowedDiscount - PRICE_TOLERANCE) return 'SUM_AMOUNT_BELOW_LINE';

  return null;
}

/**
 * @param {Array} items รายการสินค้าที่ client ส่งมา
 * @param {Function} lookupPrice async (item) => ราคาจริงต่อหน่วย (number) หรือ NaN ถ้าหาไม่ได้
 * @param {object} options { vatRate }
 * @returns {Promise<Array>} รายการบรรทัดที่มีปัญหา
 */
async function findPriceViolations(items, lookupPrice, options = {}) {
  const vatRate = toNumber(options.vatRate, 0);
  const violations = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (!shouldCheckItem(item)) continue;

    const itemCode = String(item.item_code).trim();
    const unitCode = String(item.unit_code).trim();

    // ชั้นที่ 1 - ความสอดคล้องภายในบรรทัด ไม่ต้องถามฐานข้อมูล
    const issue = findLineIntegrityIssue(item, vatRate);
    if (issue) {
      violations.push({ item_code: itemCode, unit_code: unitCode, reason: issue });
      continue;
    }

    // ชั้นที่ 2 - เทียบกับราคาจริงฝั่ง server
    const serverPrice = await lookupPrice(item);
    // หาราคาไม่ได้ = ไม่ตัดสิน ปล่อยผ่าน ดีกว่าบล็อกออเดอร์ที่ถูกต้องเพราะระบบราคาล่ม
    if (!Number.isFinite(serverPrice) || serverPrice <= 0) continue;

    // ตรวจเฉพาะทิศที่ถูกโกงคือ "ถูกกว่าความจริง"
    // ราคาสูงกว่าปล่อยผ่าน เพราะพนักงานตั้งราคาพิเศษสูงกว่าได้ และการบล็อกทิศนั้น
    // เสี่ยงปฏิเสธออเดอร์ที่ถูกต้องมากกว่าประโยชน์ที่ได้
    const clientPrice = toNumber(item.price, 0);
    if (clientPrice < serverPrice - PRICE_TOLERANCE) {
      violations.push({
        item_code: itemCode,
        unit_code: unitCode,
        reason: 'PRICE_BELOW_SERVER',
        sent_price: clientPrice,
        server_price: serverPrice,
      });
    }
  }

  return violations;
}

module.exports = {
  findPriceViolations,
  findLineIntegrityIssue,
  shouldCheckItem,
  isFiniteNumeric,
  allowedDiscountFor,
  discountCeilingFor,
  PRICE_TOLERANCE,
};
