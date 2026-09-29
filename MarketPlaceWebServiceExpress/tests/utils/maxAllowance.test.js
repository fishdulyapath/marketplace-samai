const { parseMaxAllowance, normalizeMaxAllowance, getMaxAllowanceForUnit } = require('../../src/utils/maxAllowance');

// REQ3 — จำนวนสั่งสูงสุดต่อคำสั่งซื้อ กำหนดแยกทีละหน่วย เก็บใน dimension_38

describe('parseMaxAllowance', () => {
  it('แปลง CSV เป็น map ต่อหน่วย', () => {
    expect(parseMaxAllowance('ชิ้น:100,ลัง:5')).toEqual({ 'ชิ้น': 100, 'ลัง': 5 });
  });

  it('ค่าว่าง = ไม่จำกัด', () => {
    expect(parseMaxAllowance('')).toEqual({});
    expect(parseMaxAllowance(null)).toEqual({});
    expect(parseMaxAllowance(undefined)).toEqual({});
  });

  it('ตัดช่องว่างรอบชื่อหน่วยและตัวเลข', () => {
    expect(parseMaxAllowance(' ชิ้น : 10 , ลัง : 2 ')).toEqual({ 'ชิ้น': 10, 'ลัง': 2 });
  });

  it('ข้ามรายการที่จำนวนไม่ถูกต้อง', () => {
    expect(parseMaxAllowance('ชิ้น:0,ลัง:-5,กล่อง:abc,ถุง:10')).toEqual({ 'ถุง': 10 });
  });

  it('ข้ามรายการที่ไม่มีเครื่องหมาย : หรือไม่มีชื่อหน่วย', () => {
    expect(parseMaxAllowance('ชิ้น,:10,ลัง:3')).toEqual({ 'ลัง': 3 });
  });

  it('ตัดเศษทศนิยมของจำนวน', () => {
    expect(parseMaxAllowance('ชิ้น:10.9')).toEqual({ 'ชิ้น': 10 });
  });
});

describe('normalizeMaxAllowance', () => {
  it('รับ object จากหน้าแอดมิน แปลงเป็น CSV', () => {
    expect(normalizeMaxAllowance({ 'ชิ้น': 100, 'ลัง': 5 })).toBe('ชิ้น:100,ลัง:5');
  });

  it('รับ CSV จาก import แล้วทำให้สะอาด', () => {
    expect(normalizeMaxAllowance(' ชิ้น : 100 , ลัง : 5 ')).toBe('ชิ้น:100,ลัง:5');
  });

  it('ตัดรายการที่จำนวน <= 0 ทิ้ง (= ไม่จำกัดหน่วยนั้น)', () => {
    expect(normalizeMaxAllowance({ 'ชิ้น': 0, 'ลัง': 5 })).toBe('ลัง:5');
    expect(normalizeMaxAllowance({ 'ชิ้น': -1 })).toBe('');
  });

  it('ตัด , และ : ออกจากชื่อหน่วย ป้องกัน CSV เสียรูป', () => {
    expect(normalizeMaxAllowance({ 'ชิ้น,ใหญ่': 5 })).toBe('ชิ้นใหญ่:5');
    expect(normalizeMaxAllowance({ 'ก:ล่อง': 3 })).toBe('กล่อง:3');
  });

  it('หน่วยซ้ำเก็บตัวแรก', () => {
    expect(normalizeMaxAllowance('ชิ้น:10,ชิ้น:99')).toBe('ชิ้น:10');
  });

  it('ค่าว่างคืนสตริงว่าง', () => {
    expect(normalizeMaxAllowance('')).toBe('');
    expect(normalizeMaxAllowance({})).toBe('');
  });

  it('ไป-กลับแล้วได้ค่าเดิม', () => {
    const csv = 'ชิ้น:100,ลัง:5';
    expect(normalizeMaxAllowance(parseMaxAllowance(csv))).toBe(csv);
  });
});

describe('getMaxAllowanceForUnit', () => {
  const csv = 'ชิ้น:100,ลัง:5';

  it('คืนจำนวนสูงสุดของหน่วยที่ระบุ', () => {
    expect(getMaxAllowanceForUnit(csv, 'ชิ้น')).toBe(100);
    expect(getMaxAllowanceForUnit(csv, 'ลัง')).toBe(5);
  });

  it('>>> หน่วยที่ไม่ได้กำหนด = ไม่จำกัด (null)', () => {
    expect(getMaxAllowanceForUnit(csv, 'กล่อง')).toBe(null);
  });

  it('ไม่มีการตั้งค่าเลย = ไม่จำกัด', () => {
    expect(getMaxAllowanceForUnit('', 'ชิ้น')).toBe(null);
    expect(getMaxAllowanceForUnit(null, 'ชิ้น')).toBe(null);
  });

  it('ไม่ระบุหน่วย = ไม่จำกัด', () => {
    expect(getMaxAllowanceForUnit(csv, '')).toBe(null);
    expect(getMaxAllowanceForUnit(csv, null)).toBe(null);
  });
});

describe('เคสบังคับใช้จริงตอนสั่งซื้อ', () => {
  it('สั่งเท่าลิมิตพอดี = ผ่าน, เกิน 1 = ไม่ผ่าน', () => {
    const max = getMaxAllowanceForUnit('ลัง:5', 'ลัง');
    expect(5 > max).toBe(false);
    expect(6 > max).toBe(true);
  });

  it('หน่วยคนละหน่วยใช้ลิมิตคนละตัว', () => {
    const csv = 'ชิ้น:100,ลัง:5';
    expect(50 > getMaxAllowanceForUnit(csv, 'ชิ้น')).toBe(false);
    expect(50 > getMaxAllowanceForUnit(csv, 'ลัง')).toBe(true);
  });
});
