const { normalizePromotionSwitch, cleanPromotionDetail } = require('../../src/routes/product');

// สวิตช์เปิด/ปิดโปรโมชั่นเก็บใน ic_inventory_detail.dimension_41 เป็นสตริง "1"/"0"
// สินค้าเก่ายังไม่มีค่า ต้องตกเป็น "ปิด" ไม่ใช่เปิดค้าง
describe('normalizePromotionSwitch', () => {
  test('ค่าว่างทุกรูปแบบ = ปิด', () => {
    expect(normalizePromotionSwitch(undefined)).toBe('0');
    expect(normalizePromotionSwitch(null)).toBe('0');
    expect(normalizePromotionSwitch('')).toBe('0');
    expect(normalizePromotionSwitch('   ')).toBe('0');
  });

  test('ศูนย์ = ปิด', () => {
    expect(normalizePromotionSwitch('0')).toBe('0');
    expect(normalizePromotionSwitch(0)).toBe('0');
    expect(normalizePromotionSwitch(false)).toBe('0');
  });

  test('หนึ่ง = เปิด และเก็บเป็นสตริงเสมอ', () => {
    expect(normalizePromotionSwitch('1')).toBe('1');
    expect(normalizePromotionSwitch(1)).toBe('1');
    expect(normalizePromotionSwitch(true)).toBe('1');
    expect(normalizePromotionSwitch(' 1 ')).toBe('1');
  });

  test('ค่าแปลกปลอมถือว่าปิด ไม่ใช่เปิด', () => {
    expect(normalizePromotionSwitch('2')).toBe('0');
    expect(normalizePromotionSwitch('yes')).toBe('0');
    expect(normalizePromotionSwitch('on')).toBe('0');
  });
});

// รายละเอียดโปรโมชั่นเป็น "ช่องแสดงผล" ล้วน ไม่มีผลกับสถานะโปรโมชั่น
// แต่ต้องไม่เก็บมาร์กอัปเปล่าที่ Quill ทิ้งไว้ ไม่งั้นหน้าสินค้าจะขึ้นกล่องโปรโมชั่นเปล่า
describe('cleanPromotionDetail', () => {
  test('มาร์กอัปเปล่าเก็บเป็นค่าว่าง', () => {
    expect(cleanPromotionDetail('<p><br></p>')).toBe('');
    expect(cleanPromotionDetail('<p></p>')).toBe('');
    expect(cleanPromotionDetail('<p>&nbsp;</p>')).toBe('');
    expect(cleanPromotionDetail('   ')).toBe('');
    expect(cleanPromotionDetail(null)).toBe('');
  });

  test('มีข้อความจริงเก็บทั้งก้อนตามที่พิมพ์ ไม่ trim ไม่ตัด', () => {
    const html = '<p><strong>ซื้อ 3 แถม 1</strong></p><p><br></p>';
    expect(cleanPromotionDetail(html)).toBe(html);
  });

  test('รูปภาพล้วนก็ยังเก็บไว้', () => {
    expect(cleanPromotionDetail('<p><img src="/promo.png"></p>')).toBe('<p><img src="/promo.png"></p>');
  });
});
