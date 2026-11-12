const { defaultSchedule, normalizeSchedule, availableDays, pickupRemark } = require('../../src/utils/pickupSchedule');

describe('pickup schedule', () => {
  test('default matches the former three-day, three-hour, hourly booking rules', () => {
    const schedule = defaultSchedule();
    const days = availableDays(schedule, new Date('2026-11-12T02:30:00Z')); // 09:30 Bangkok
    expect(days).toHaveLength(4);
    expect(days[0].date).toBe('2026-11-12');
    expect(days[0].slots[0]).toBe('13:00-14:00');
    expect(days[1].slots).toHaveLength(8);
  });

  test('closed weekdays and overlapping slots are handled', () => {
    const schedule = defaultSchedule();
    schedule.days[3].enabled = false; // Thursday
    expect(availableDays(schedule, new Date('2026-11-12T02:30:00Z'))[0].date).toBe('2026-11-13');
    schedule.days[3].enabled = true;
    schedule.days[3].slots = [{ start: '09:00', end: '11:00' }, { start: '10:00', end: '12:00' }];
    expect(() => normalizeSchedule(schedule)).toThrow(/ซ้อนกัน/);
    schedule.days[3].slots = [{ start: '13:00', end: '16:00' }, { start: '09:00', end: '11:00' }];
    expect(normalizeSchedule(schedule).days[3].slots[0].start).toBe('09:00');
  });

  test('uses Bangkok date around UTC midnight and rejects stale bookings', () => {
    const schedule = defaultSchedule();
    const now = new Date('2026-11-12T17:30:00Z'); // Friday 00:30 Bangkok
    expect(availableDays(schedule, now)[0].date).toBe('2026-11-13');
    const order = { pickup_date: '2026-11-13', pickup_time_slot: '09:00-10:00', pickup_receiver: 'สมชาย', pickup_phone: '0812345678' };
    expect(pickupRemark(order, schedule, now)).toContain('เบอร์โทร: 0812345678');
    order.pickup_time_slot = '08:00-09:00';
    expect(() => pickupRemark(order, schedule, now)).toThrow(/ไม่พร้อมให้เลือก/);
  });

  test('rejects missing or invalid receiver phone', () => {
    const order = { pickup_date: '2026-11-13', pickup_time_slot: '09:00-10:00', pickup_receiver: 'สมชาย', pickup_phone: 'ทะเบียน 1234' };
    expect(() => pickupRemark(order, defaultSchedule(), new Date('2026-11-12T02:00:00Z'))).toThrow(/เบอร์โทร/);
  });
});
