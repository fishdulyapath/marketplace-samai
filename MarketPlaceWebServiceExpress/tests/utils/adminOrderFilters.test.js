const { DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS, isIsoDate, resolveDateRange, shiftDays } = require('../../src/utils/adminOrderFilters');

const TODAY = '2026-08-23';

describe('isIsoDate', () => {
  test('รับเฉพาะ YYYY-MM-DD ที่มีอยู่จริง', () => {
    expect(isIsoDate('2026-08-23')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true); // ปีอธิกสุรทิน
  });

  test('ปฏิเสธรูปแบบผิดและวันที่ที่ไม่มีจริง', () => {
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate('23/08/2026')).toBe(false);
    expect(isIsoDate('2026-8-3')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2025-02-29')).toBe(false); // ไม่ใช่ปีอธิกสุรทิน
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('resolveDateRange — ค่าเริ่มต้นย้อนหลัง 7 วัน', () => {
  test('ไม่ส่งอะไรมาเลย ได้ 7 วันนับรวมวันนี้', () => {
    expect(resolveDateRange('', '', TODAY)).toEqual({ dateFrom: '2026-08-17', dateTo: TODAY });
  });

  test('undefined/null ก็ได้ผลเดียวกับไม่ส่ง', () => {
    expect(resolveDateRange(undefined, null, TODAY)).toEqual({ dateFrom: '2026-08-17', dateTo: TODAY });
  });

  test('ช่วงเริ่มต้นครอบคลุมพอดี 7 วัน', () => {
    const { dateFrom, dateTo } = resolveDateRange('', '', TODAY);
    const days = Math.round((Date.parse(dateTo + 'T00:00:00Z') - Date.parse(dateFrom + 'T00:00:00Z')) / 86400000) + 1;
    expect(days).toBe(DEFAULT_RANGE_DAYS);
  });

  test('ข้ามเดือนแล้วยังนับถูก', () => {
    expect(resolveDateRange('', '', '2026-03-03')).toEqual({ dateFrom: '2026-02-25', dateTo: '2026-03-03' });
  });

  test('ข้ามปีแล้วยังนับถูก', () => {
    expect(resolveDateRange('', '', '2026-01-03')).toEqual({ dateFrom: '2025-12-28', dateTo: '2026-01-03' });
  });
});

describe('resolveDateRange — ส่งมาบางส่วน', () => {
  test('ส่งแค่จากวันที่ ให้ถึงวันนี้', () => {
    expect(resolveDateRange('2026-08-01', '', TODAY)).toEqual({ dateFrom: '2026-08-01', dateTo: TODAY });
  });

  test('ส่งแค่ถึงวันที่ ให้ย้อนหลัง 7 วันจากวันนั้น', () => {
    expect(resolveDateRange('', '2026-07-02', TODAY)).toEqual({ dateFrom: '2026-06-26', dateTo: '2026-07-02' });
  });

  test('ส่งครบทั้งคู่ ใช้ตามที่ส่ง', () => {
    expect(resolveDateRange('2026-01-01', '2026-01-31', TODAY)).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
  });

  test('วันเดียวกันทั้งคู่ ใช้ได้', () => {
    expect(resolveDateRange(TODAY, TODAY, TODAY)).toEqual({ dateFrom: TODAY, dateTo: TODAY });
  });

  test('ตัดช่องว่างหัวท้ายให้', () => {
    expect(resolveDateRange('  2026-08-01  ', ' 2026-08-05 ', TODAY)).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-05' });
  });
});

describe('resolveDateRange — ค่าที่ไม่ถูกต้อง', () => {
  test('จากวันที่เกินถึงวันที่', () => {
    expect(resolveDateRange('2026-08-20', '2026-08-01', TODAY).error).toBeTruthy();
  });

  test('รูปแบบวันที่ผิด', () => {
    expect(resolveDateRange('23/08/2026', '', TODAY).error).toBeTruthy();
    expect(resolveDateRange('', '23-08-2026', TODAY).error).toBeTruthy();
  });

  test('วันที่ไม่มีอยู่จริง', () => {
    expect(resolveDateRange('2026-02-31', '', TODAY).error).toBeTruthy();
  });

  test('ช่วงกว้างเกินเพดาน', () => {
    expect(resolveDateRange('2020-01-01', TODAY, TODAY).error).toBeTruthy();
  });

  test('ช่วงเท่าเพดานพอดี ยังผ่าน', () => {
    const from = shiftDays(TODAY, -(MAX_RANGE_DAYS - 1));
    expect(resolveDateRange(from, TODAY, TODAY)).toEqual({ dateFrom: from, dateTo: TODAY });
  });

  test('วันที่อ้างอิงของเซิร์ฟเวอร์เพี้ยน ต้องฟ้อง ไม่ใช่เงียบ', () => {
    expect(resolveDateRange('', '', 'ไม่ใช่วันที่').error).toBeTruthy();
  });
});

describe('shiftDays', () => {
  test('บวกลบวันข้ามเดือนข้ามปีถูก', () => {
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDays('2025-12-31', 1)).toBe('2026-01-01');
  });
});
