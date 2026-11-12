const { serverDocDate } = require('./serverTime');

// days[0] is Monday. Booking times use the shop's Asia/Bangkok clock.
function defaultSchedule() {
  const hour = n => String(n).padStart(2, '0') + ':00';
  return {
    days_ahead: 3,
    lead_hours: 3,
    days: Array.from({ length: 7 }, () => ({
      enabled: true,
      slots: Array.from({ length: 8 }, (_, i) => ({ start: hour(9 + i), end: hour(10 + i) })),
    })),
  };
}

function normalizeSchedule(input) {
  const { days_ahead, lead_hours, days } = input || {};
  if (!Number.isInteger(days_ahead) || days_ahead < 0 || days_ahead > 365)
    throw new Error('จำนวนวันที่จองล่วงหน้าต้องเป็นจำนวนเต็ม 0–365 วัน');
  if (!Number.isInteger(lead_hours) || lead_hours < 0 || lead_hours > 24)
    throw new Error('เวลาเตรียมสินค้าต้องเป็นจำนวนเต็ม 0–24 ชั่วโมง');
  if (!Array.isArray(days) || days.length !== 7) throw new Error('กรุณาตั้งค่ารอบให้ครบทั้ง 7 วัน');
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return { days_ahead, lead_hours, days: days.map(day => {
    if (typeof day?.enabled !== 'boolean' || !Array.isArray(day.slots) || (day.enabled && !day.slots.length))
      throw new Error('วันที่เปิดรับต้องมีอย่างน้อย 1 รอบ');
    const slots = day.slots.map(slot => {
      if (!time.test(slot?.start) || !time.test(slot?.end) || slot.start >= slot.end)
        throw new Error('กรุณากำหนดเวลาเริ่มและสิ้นสุดให้ถูกต้องในวันเดียวกัน');
      return { start: slot.start, end: slot.end };
    }).sort((a, b) => a.start.localeCompare(b.start));
    if (slots.some((s, i) => i > 0 && slots[i - 1].end > s.start)) throw new Error('ช่วงเวลารับสินค้าภายในวันเดียวกันซ้อนกัน');
    return { enabled: day.enabled, slots };
  }) };
}

function availableDays(schedule, now = new Date()) {
  const today = serverDocDate(now);
  const calendar = new Date(today + 'T00:00:00Z');
  const earliest = now.getTime() + schedule.lead_hours * 3600000;
  const dates = [];
  for (let i = 0; i <= schedule.days_ahead; i++, calendar.setUTCDate(calendar.getUTCDate() + 1)) {
    const day = schedule.days[(calendar.getUTCDay() + 6) % 7];
    if (!day.enabled) continue;
    const date = calendar.toISOString().slice(0, 10);
    const slots = day.slots.filter(s => i !== 0 || Date.parse(date + 'T' + s.start + ':00+07:00') >= earliest);
    if (slots.length) dates.push({ date, slots: slots.map(s => s.start + '-' + s.end) });
  }
  return dates;
}

function pickupRemark(order, schedule, now = new Date()) {
  const { pickup_date: date, pickup_time_slot: slot } = order;
  const receiver = typeof order.pickup_receiver === 'string' ? order.pickup_receiver.trim() : '';
  const phone = typeof order.pickup_phone === 'string' ? order.pickup_phone.trim() : '';
  if (!receiver || receiver.length > 80 || /[\r\n]/.test(receiver) || !/^\+?[\d ()-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, '')) || phone.length > 30)
    throw Object.assign(new Error('กรุณาตรวจสอบชื่อและเบอร์โทรผู้รับสินค้า'), { code: 'PICKUP_CONTACT_INVALID' });
  if (!availableDays(schedule, now).some(day => day.date === date && day.slots.includes(slot)))
    throw Object.assign(new Error('รอบรับสินค้านี้ไม่พร้อมให้เลือกแล้ว กรุณาเลือกวันที่และรอบอีกครั้ง'), { code: 'PICKUP_SLOT_UNAVAILABLE' });
  return `รับเอง ${date.split('-').reverse().join('/')} ${slot} ผู้รับ: ${receiver} เบอร์โทร: ${phone}`;
}

module.exports = { defaultSchedule, normalizeSchedule, availableDays, pickupRemark };
