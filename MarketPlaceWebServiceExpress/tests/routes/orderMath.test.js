const {
  calcAfterDiscount,
  calcOrderLineVat,
  calcDetailDiscountAmount,
  summarizeOrderVat,
  isPreorderDocument,
  mergePreorderRemark,
  buildDeliveryRemark,
} = require('../../src/routes/order');
const { calcDiscount } = require('../../src/utils/vatHelper');

// Characterization test — บันทึกพฤติกรรม "ปัจจุบัน" ของ logic การเงินใน sendorder
// ต้องเขียวทั้งก่อนและหลังการ refactor ในเฟส 3/4

const mapOf = (entries) => new Map(entries);

describe('calcAfterDiscount — parser ของ order.js', () => {
  it('ไม่มีส่วนลด คืนยอดเดิม', () => {
    expect(calcAfterDiscount('', 100)).toBe(100);
    expect(calcAfterDiscount(null, 100)).toBe(100);
  });

  it('รองรับ @n = ลดเป็นบาท', () => {
    expect(calcAfterDiscount('@5', 100)).toBe(95);
  });

  it('รองรับ n% = ลดเป็นเปอร์เซ็นต์', () => {
    expect(calcAfterDiscount('10%', 100)).toBe(90);
    expect(calcAfterDiscount('7.5%', 200)).toBe(185);
  });

  it('รองรับ nB = ลดเป็นบาท', () => {
    expect(calcAfterDiscount('10B', 100)).toBe(90);
  });

  it('ต่อกันได้ทั้ง + และ , คิดทบต่อเนื่อง', () => {
    expect(calcAfterDiscount('10%+5B', 100)).toBe(85);
    expect(calcAfterDiscount('10%,5B', 100)).toBe(85);
    // 100 → -50% = 50 → -60% ของ 50 = 20
    expect(calcAfterDiscount('50%+60%', 100)).toBe(20);
  });

  it('ตัดช่องว่างออกก่อน parse', () => {
    expect(calcAfterDiscount(' 10 % ', 100)).toBe(90);
  });

  it('ส่วนลดเกินยอด clamp ที่ 0', () => {
    expect(calcAfterDiscount('200B', 100)).toBe(0);
  });
});

describe('ความไม่ตรงกันระหว่าง parser 2 ตัว (ต้องแก้ในเฟส 4.1)', () => {
  it('เลขเปล่า: order.js ตีความเป็นบาท แต่ vatHelper ตีความเป็นเปอร์เซ็นต์', () => {
    // order.js: 200 - 10 บาท = 190 ⇒ ส่วนลด 10
    expect(calcAfterDiscount('10', 200)).toBe(190);
    // vatHelper: 10% ของ 200 ⇒ ส่วนลด 20
    expect(calcDiscount('10', 200)).toBe(20);
    // ยืนยันว่าให้ผลต่างกันจริง — นี่คือความเสี่ยงที่ต้องตัดสินใจก่อนรวมโค้ด
    expect(200 - calcAfterDiscount('10', 200)).not.toBe(calcDiscount('10', 200));
  });
});

describe('calcOrderLineVat', () => {
  const item = { item_code: 'A', qty: 2, price: 50 };

  it('tax_type 1 = สินค้ายกเว้น VAT ไม่คิด VAT เลย', () => {
    expect(calcOrderLineVat(item, mapOf([['A', 1]]), 0, 7)).toEqual({
      taxType: 1,
      sumAmount: 100,
      sumAmountExcludeVat: 100,
      vatValue: 0,
      priceExcludeVat: 50,
      lineTotalAmount: 100,
    });
  });

  it('vatType 1 (รวมใน) ถอด VAT ออกจากยอด', () => {
    const inclusive = { item_code: 'B', qty: 1, price: 107 };
    expect(calcOrderLineVat(inclusive, mapOf([['B', 0]]), 1, 7)).toEqual({
      taxType: 0,
      sumAmount: 107,
      sumAmountExcludeVat: 100,
      vatValue: 7,
      priceExcludeVat: 100,
      lineTotalAmount: 107,
    });
  });

  it('vatType 0 (แยกนอก) บวก VAT เพิ่มจากยอด', () => {
    const exclusive = { item_code: 'C', qty: 1, price: 100 };
    expect(calcOrderLineVat(exclusive, mapOf([['C', 0]]), 0, 7)).toEqual({
      taxType: 0,
      sumAmount: 100,
      sumAmountExcludeVat: 100,
      vatValue: 7,
      priceExcludeVat: 100,
      lineTotalAmount: 107,
    });
  });

  it('vatType อื่น (2/3) ไม่คิด VAT', () => {
    const other = { item_code: 'D', qty: 1, price: 100 };
    expect(calcOrderLineVat(other, mapOf([['D', 0]]), 2, 7).vatValue).toBe(0);
    expect(calcOrderLineVat(other, mapOf([['D', 0]]), 2, 7).lineTotalAmount).toBe(100);
  });

  it('ใช้ tax_type จาก map ก่อน ถ้าไม่มีใน map จึงใช้ค่าใน item', () => {
    const withOwnTax = { item_code: 'E', qty: 1, price: 100, tax_type: 1 };
    expect(calcOrderLineVat(withOwnTax, mapOf([]), 0, 7).taxType).toBe(1);
    // map ชนะเสมอ
    expect(calcOrderLineVat(withOwnTax, mapOf([['E', 0]]), 0, 7).taxType).toBe(0);
  });

  it('ใช้ sum_amount ที่ส่งมา แทนการคูณ qty × price', () => {
    const withSum = { item_code: 'F', qty: 2, price: 50, sum_amount: 95 };
    expect(calcOrderLineVat(withSum, mapOf([['F', 0]]), 0, 7).sumAmount).toBe(95);
  });
});

describe('calcDetailDiscountAmount', () => {
  it('คืน 0 เมื่อไม่มีส่วนลด', () => {
    expect(calcDetailDiscountAmount({ discount_amount: 0 }, 0, 7)).toBe(0);
  });

  it('vatType 1 ถอด VAT ออกจากยอดส่วนลด', () => {
    expect(calcDetailDiscountAmount({ discount_amount: 107 }, 1, 7)).toBe(100);
  });

  it('vatType อื่น ใช้ยอดส่วนลดตรงๆ', () => {
    expect(calcDetailDiscountAmount({ discount_amount: 107 }, 0, 7)).toBe(107);
  });
});

describe('summarizeOrderVat', () => {
  it('vatType 0 ไม่มีส่วนลด', () => {
    const items = [{ item_code: 'A', qty: 1, price: 100 }];
    expect(summarizeOrderVat(items, mapOf([['A', 0]]), 0, 7)).toEqual({
      totalValue: 100,
      totalDiscount: 0,
      totalBeforeVat: 100,
      totalVatValue: 7,
      totalAfterVat: 107,
      totalExceptVat: 0,
      totalAmount: 107,
    });
  });

  it('vatType 1 ไม่มีส่วนลด', () => {
    const items = [{ item_code: 'A', qty: 1, price: 107 }];
    expect(summarizeOrderVat(items, mapOf([['A', 0]]), 1, 7)).toEqual({
      totalValue: 107,
      totalDiscount: 0,
      totalBeforeVat: 100,
      totalVatValue: 7,
      totalAfterVat: 107,
      totalExceptVat: 0,
      totalAmount: 107,
    });
  });

  it('มีสินค้ายกเว้น VAT ปนอยู่ แยกยอดออกเป็น totalExceptVat', () => {
    const items = [
      { item_code: 'A', qty: 1, price: 100 },
      { item_code: 'B', qty: 1, price: 50 },
    ];
    expect(summarizeOrderVat(items, mapOf([['A', 0], ['B', 1]]), 0, 7)).toEqual({
      totalValue: 150,
      totalDiscount: 0,
      totalBeforeVat: 100,
      totalVatValue: 7,
      totalAfterVat: 107,
      totalExceptVat: 50,
      totalAmount: 157,
    });
  });

  it('discountType 0 — VAT ถูกคิดจากยอดก่อนหักส่วนลด (พฤติกรรมปัจจุบัน)', () => {
    const items = [{ item_code: 'A', qty: 1, price: 100 }];
    const result = summarizeOrderVat(items, mapOf([['A', 0]]), 0, 7, '10%', 0, 0);
    expect(result.totalDiscount).toBe(10);
    // หมายเหตุ: totalBeforeVat = 100 ไม่ใช่ 90 แม้ discountType จะเป็น "ลดก่อน VAT"
    // VAT จึงคิดจาก 100 → 7 บาท แล้วค่อยหักส่วนลดออกจากยอดรวมทีหลัง
    expect(result.totalBeforeVat).toBe(100);
    expect(result.totalVatValue).toBe(7);
    expect(result.totalAmount).toBe(97);
  });

  it('discountType 1 — ลดจากฐานก่อนคำนวณ VAT', () => {
    const items = [{ item_code: 'A', qty: 1, price: 100 }];
    expect(summarizeOrderVat(items, mapOf([['A', 0]]), 0, 7, '10B', 1, 0)).toEqual({
      totalValue: 100,
      totalDiscount: 10,
      totalBeforeVat: 90,
      totalVatValue: 6.3,
      totalAfterVat: 96.3,
      totalExceptVat: 0,
      totalAmount: 96.3,
    });
  });

  it('discountVatType 1 — เฉลี่ยส่วนลดระหว่างตะกร้า VAT และตะกร้ายกเว้น', () => {
    const items = [
      { item_code: 'A', qty: 1, price: 100 },
      { item_code: 'B', qty: 1, price: 100 },
    ];
    expect(summarizeOrderVat(items, mapOf([['A', 0], ['B', 1]]), 0, 7, '20B', 1, 1)).toEqual({
      totalValue: 200,
      totalDiscount: 20,
      totalBeforeVat: 90,
      totalVatValue: 6.3,
      totalAfterVat: 96.3,
      totalExceptVat: 90,
      totalAmount: 186.3,
    });
  });

  it('ส่วนลดมากกว่ายอดที่คิด VAT — ฐาน VAT เหลือ 0', () => {
    const items = [
      { item_code: 'A', qty: 1, price: 10 },
      { item_code: 'B', qty: 1, price: 100 },
    ];
    const result = summarizeOrderVat(items, mapOf([['A', 0], ['B', 1]]), 0, 7, '20B', 1, 0);
    expect(result.totalBeforeVat).toBe(0);
    expect(result.totalVatValue).toBe(0);
  });
});

describe('การจำแนกเอกสารพรีออเดอร์', () => {
  it('ดูจาก prefix PREQT ของเลขที่เอกสาร', () => {
    expect(isPreorderDocument('PREQT20250815ABC12', '')).toBe(true);
    expect(isPreorderDocument('preqt20250815abc12', '')).toBe(true);
    expect(isPreorderDocument('MQT20250815ABC12', '')).toBe(false);
  });

  it('ดูจากคำว่า PREORDER ใน remark', () => {
    expect(isPreorderDocument('MQT001', 'PREORDER ของสั่งจอง')).toBe(true);
    // ต้องเป็นคำเต็ม ไม่ใช่ substring
    expect(isPreorderDocument('MQT001', 'PREORDERED')).toBe(false);
  });

  it('mergePreorderRemark ไม่เติมซ้ำถ้ามีอยู่แล้ว', () => {
    expect(mergePreorderRemark('ของด่วน', true)).toBe('PREORDER ของด่วน');
    expect(mergePreorderRemark('PREORDER ของด่วน', true)).toBe('PREORDER ของด่วน');
    expect(mergePreorderRemark('ของด่วน', false)).toBe('ของด่วน');
  });
});

describe('buildDeliveryRemark — รวมวิธีรับของ+ที่อยู่ลง remark ช่องเดียว', () => {
  it('ส่งให้ (send_type=1) → "ส่งให้ ที่อยู่ หมายเหตุ"', () => {
    expect(buildDeliveryRemark('1', '99/1 ถ.มิตรภาพ ต.ในเมือง', 'โทรก่อนส่ง'))
      .toBe('ส่งให้ 99/1 ถ.มิตรภาพ ต.ในเมือง โทรก่อนส่ง');
  });

  it('ข้ามส่วนที่ว่าง — ไม่มีหมายเหตุ/ไม่มีที่อยู่ ก็ไม่เหลือช่องว่างซ้อน', () => {
    expect(buildDeliveryRemark('1', '99/1 ถ.มิตรภาพ', '')).toBe('ส่งให้ 99/1 ถ.มิตรภาพ');
    expect(buildDeliveryRemark('1', '', 'โทรก่อนส่ง')).toBe('ส่งให้ โทรก่อนส่ง');
    expect(buildDeliveryRemark('1', '', '')).toBe('ส่งให้');
  });

  it('รับเอง (send_type=0) → คง remark เดิมไม่แตะ', () => {
    expect(buildDeliveryRemark('0', '99/1 ถ.มิตรภาพ', 'โทรก่อนส่ง')).toBe('โทรก่อนส่ง');
    expect(buildDeliveryRemark('0', '99/1 ถ.มิตรภาพ', '')).toBe('');
  });

  it('ประกอบกับ PREORDER marker แล้ว marker ยังอยู่หน้าสุด', () => {
    expect(mergePreorderRemark(buildDeliveryRemark('1', '99/1', 'ด่วน'), true))
      .toBe('PREORDER ส่งให้ 99/1 ด่วน');
  });
});
