const { round4, calcDiscount, calcVat } = require('../../src/utils/vatHelper');

// Characterization test — บันทึกพฤติกรรม "ปัจจุบัน" ของระบบไว้ ไม่ใช่พฤติกรรมที่ควรจะเป็น
// ใช้เป็นตาข่ายก่อนรวม discount parser 3 ตัวเข้าด้วยกัน (ดูแผนเฟส 4.1)

describe('round4', () => {
  it('ปัดเป็น 4 ตำแหน่ง', () => {
    expect(round4(1.234567)).toBe(1.2346);
    expect(round4(1.00005)).toBe(1.0001);
    expect(round4(0)).toBe(0);
  });
});

describe('calcDiscount — parser ของ vatHelper (รองรับแค่ nB และ % ต่อด้วย +)', () => {
  it('คืน 0 เมื่อไม่มีส่วนลด', () => {
    expect(calcDiscount('', 100)).toBe(0);
    expect(calcDiscount(null, 100)).toBe(0);
    expect(calcDiscount('   ', 100)).toBe(0);
  });

  it('ส่วนลดเป็นบาท ลงท้ายด้วย B', () => {
    expect(calcDiscount('10B', 100)).toBe(10);
  });

  it('ส่วนลดเป็นเปอร์เซ็นต์ (เลขเปล่าถูกตีความเป็น %)', () => {
    expect(calcDiscount('10', 100)).toBe(10);
    expect(calcDiscount('7.5', 200)).toBe(15);
  });

  it('ส่วนลดซ้อนกันด้วย + คิดแบบทบต่อเนื่อง', () => {
    // 100 → -50% = 50 → -10B = 40 ⇒ ส่วนลดรวม 60
    expect(calcDiscount('50+10B', 100)).toBe(60);
    // 100 → -50% = 50 → -50% = 25 ⇒ ส่วนลดรวม 75 (ไม่ใช่ 100)
    expect(calcDiscount('50+50', 100)).toBe(75);
  });

  it('ส่วนลดเกินยอด ถูก clamp ไม่ให้ติดลบ', () => {
    expect(calcDiscount('200B', 100)).toBe(100);
  });

  it('ไม่รองรับ @n — ถูกอ่านเป็น NaN แล้วกลายเป็น 0', () => {
    // พฤติกรรมปัจจุบัน: parseFloat('@5') = NaN → || 0 → ไม่ลดอะไรเลย
    expect(calcDiscount('@5', 100)).toBe(0);
  });
});

describe('calcVat — [beforeVat, vatValue, afterVat, totalAmount]', () => {
  it('vatType 0 (แยกนอก) ลดก่อน VAT', () => {
    expect(calcVat(0, 7, 0, 100, 0)).toEqual([100, 7, 107, 107]);
    expect(calcVat(0, 7, 0, 100, 10)).toEqual([90, 6.3, 96.3, 96.3]);
  });

  it('vatType 0 (แยกนอก) ลดหลัง VAT', () => {
    expect(calcVat(0, 7, 1, 100, 10)).toEqual([100, 7, 107, 97]);
  });

  it('vatType 1 (รวมใน)', () => {
    expect(calcVat(1, 7, 0, 107, 0)).toEqual([100, 7, 107, 107]);
  });

  it('vatType 2/3 (ยกเว้น) ไม่มี VAT', () => {
    expect(calcVat(2, 7, 0, 100, 10)).toEqual([90, 0, 90, 90]);
    expect(calcVat(3, 7, 0, 100, 0)).toEqual([100, 0, 100, 100]);
  });

  it('ส่วนลดเกินยอดใน vatType 0 ถูก clamp ที่ 0', () => {
    expect(calcVat(0, 7, 0, 100, 200)).toEqual([0, 0, 0, 0]);
  });
});
