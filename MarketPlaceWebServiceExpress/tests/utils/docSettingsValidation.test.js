const { isValidDocPattern, isValidDocSource, isValidMaxLinesPerDoc } = require('../../src/utils/marketplaceSalesSettings');

// REQ4 — ตัวตรวจค่าที่แอดมินกรอกเองได้ในหน้าตั้งค่า
// ค่าผิดที่หลุดเข้าไปจะทำให้ระบบออกเลขเอกสารซ้ำหรืออ่านประวัติไม่เจอ แก้ย้อนหลังไม่ได้

describe('isValidDocPattern', () => {
  it('รูปแบบมาตรฐานผ่าน', () => {
    expect(isValidDocPattern('BSWYYMMDD####')).toBe(true);
    expect(isValidDocPattern('BSCYYMMDD####')).toBe(true);
    expect(isValidDocPattern('AB#')).toBe(true);
  });

  it('>>> ไม่มี # = ไม่มีช่องเลขรัน → ทุกใบได้เลขเดียวกัน', () => {
    expect(isValidDocPattern('BSWYYMMDD')).toBe(false);
  });

  it('>>> # ต้องอยู่ท้ายสุดเป็นก้อนเดียว (splitPattern อ่านแบบนี้)', () => {
    expect(isValidDocPattern('BSW####YY')).toBe(false);
    expect(isValidDocPattern('BSW##YY##')).toBe(false);
  });

  it('อักขระที่ทำให้ LIKE/regex เพี้ยนถูกปฏิเสธ', () => {
    expect(isValidDocPattern('BSW-YY####')).toBe(false); // - ชนกับ suffix เอกสารย่อย
    expect(isValidDocPattern('BSW%####')).toBe(false); // wildcard ของ LIKE
    expect(isValidDocPattern('BSW_####')).toBe(false);
    expect(isValidDocPattern("BSW'####")).toBe(false);
    expect(isValidDocPattern('BSW ####')).toBe(false);
  });

  it('ค่าว่าง/ยาวเกิน/# เกิน 8 ตัว ถูกปฏิเสธ', () => {
    expect(isValidDocPattern('')).toBe(false);
    expect(isValidDocPattern('   ')).toBe(false);
    expect(isValidDocPattern(null)).toBe(false);
    expect(isValidDocPattern('A'.repeat(28) + '####')).toBe(false);
    expect(isValidDocPattern('AB#########')).toBe(false);
  });
});

describe('isValidDocSource', () => {
  it('รับเฉพาะ server หรือ client', () => {
    expect(isValidDocSource('server')).toBe(true);
    expect(isValidDocSource('client')).toBe(true);
    expect(isValidDocSource('SERVER')).toBe(false); // route แปลงเป็นตัวเล็กก่อนตรวจแล้ว
    expect(isValidDocSource('')).toBe(false);
    expect(isValidDocSource('auto')).toBe(false);
  });
});

describe('isValidMaxLinesPerDoc', () => {
  it('0 = ปิดการแบ่ง และรับได้ถึง 99', () => {
    expect(isValidMaxLinesPerDoc(0)).toBe(true);
    expect(isValidMaxLinesPerDoc(8)).toBe(true);
    expect(isValidMaxLinesPerDoc(99)).toBe(true);
  });

  it('ค่าติดลบ/เกินเพดาน/ไม่ใช่จำนวนเต็ม ถูกปฏิเสธ', () => {
    expect(isValidMaxLinesPerDoc(-1)).toBe(false);
    expect(isValidMaxLinesPerDoc(100)).toBe(false);
    expect(isValidMaxLinesPerDoc(8.5)).toBe(false);
    expect(isValidMaxLinesPerDoc('abc')).toBe(false);
    expect(isValidMaxLinesPerDoc(null)).toBe(false);
  });
});
