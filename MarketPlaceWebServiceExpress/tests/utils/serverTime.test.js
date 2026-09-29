const { serverDocDate, serverDocTime, serverTimeInfo, TIME_ZONE } = require('../../src/utils/serverTime');

// REQ6 — เวลาต้องเป็น Asia/Bangkok เสมอ ไม่ใช่ UTC และไม่ใช่ TZ ของเครื่อง

describe('serverDocDate', () => {
  it('คืนรูปแบบ YYYY-MM-DD', () => {
    expect(serverDocDate(new Date('2026-08-01T05:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('ข้ามวันตามเวลาไทย ไม่ใช่ UTC — เคสที่ toISOString() เคยพัง', () => {
    // 17:30Z = 00:30 น. ของวันถัดไปตามเวลาไทย (UTC+7)
    // toISOString().slice(0,10) จะได้ 2026-08-01 ซึ่งผิด
    expect(serverDocDate(new Date('2026-08-01T17:30:00Z'))).toBe('2026-08-02');
  });

  it('ช่วง 00:00-06:59 น. ไทย ต้องได้วันของไทย ไม่ใช่วันก่อนหน้าแบบ UTC', () => {
    // 2026-08-02T00:30+07:00 = 2026-08-01T17:30Z
    expect(serverDocDate(new Date('2026-08-01T17:30:00Z'))).toBe('2026-08-02');
    // 2026-08-02T06:59+07:00 = 2026-08-01T23:59Z
    expect(serverDocDate(new Date('2026-08-01T23:59:00Z'))).toBe('2026-08-02');
    // 2026-08-02T07:00+07:00 = 2026-08-02T00:00Z (จุดที่ UTC ตามทัน)
    expect(serverDocDate(new Date('2026-08-02T00:00:00Z'))).toBe('2026-08-02');
  });

  it('ก่อนเที่ยงคืนไทยยังเป็นวันเดิม', () => {
    // 2026-08-01T23:59+07:00 = 2026-08-01T16:59Z
    expect(serverDocDate(new Date('2026-08-01T16:59:00Z'))).toBe('2026-08-01');
  });
});

describe('serverDocTime', () => {
  it('คืนรูปแบบ HH:mm แบบ 24 ชั่วโมง ไม่มี am/pm', () => {
    const time = serverDocTime(new Date('2026-08-01T07:30:00Z')); // 14:30 ไทย
    expect(time).toBe('14:30');
    expect(time).not.toMatch(/[ap]\.?m\.?/i);
  });

  it('เที่ยงคืนไทยเป็น 00:xx ไม่ใช่ 24:xx หรือ 12:xx AM', () => {
    expect(serverDocTime(new Date('2026-08-01T17:30:00Z'))).toBe('00:30');
  });

  it('บ่ายโมงไทยเป็น 13:00', () => {
    expect(serverDocTime(new Date('2026-08-01T06:00:00Z'))).toBe('13:00');
  });
});

describe('serverTimeInfo', () => {
  it('คืนข้อมูลครบสำหรับให้ client sync clock', () => {
    const at = new Date('2026-08-01T07:30:00Z');
    const info = serverTimeInfo(at);
    expect(info).toEqual({
      date: '2026-08-01',
      time: '14:30',
      iso: '2026-08-01T07:30:00.000Z',
      epoch_ms: at.getTime(),
      timezone: 'Asia/Bangkok',
    });
  });

  it('timezone คงที่เป็น Asia/Bangkok', () => {
    expect(TIME_ZONE).toBe('Asia/Bangkok');
  });
});

describe('ไม่พึ่ง process.env.TZ', () => {
  it('ผลลัพธ์เท่าเดิมแม้ TZ ถูกตั้งเป็น UTC', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      expect(serverDocDate(new Date('2026-08-01T17:30:00Z'))).toBe('2026-08-02');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
