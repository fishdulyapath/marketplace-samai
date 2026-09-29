// เวลาอ้างอิงของระบบ = เวลา server โซน Asia/Bangkok เสมอ (REQ6)
//
// ห้ามใช้เวลาจากเครื่องลูกค้าในการตัดสินใจใดๆ ที่มีผลต่อข้อมูล
// (วันที่เอกสาร, การหมดอายุโปรโมชัน, การคิดราคา)
//
// ใช้ Intl.DateTimeFormat แทนการพึ่ง process.env.TZ เพราะ:
//   - ถูกต้องแม้ TZ ของ OS/container ไม่ได้ตั้งไว้
//   - toISOString() ให้ UTC ซึ่งช่วง 00:00-06:59 เวลาไทยจะได้วันก่อนหน้า (บั๊กที่เคยมีจริง)
// pattern เดียวกับที่ MarketPlaceWeb/src/views/pages/Landing.vue:419 ใช้อยู่

const TIME_ZONE = 'Asia/Bangkok';

// en-CA ให้รูปแบบ YYYY-MM-DD ตรงกับที่ PostgreSQL รับ
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// hour12:false สำคัญ — ค่า default ของ en-CA เป็น 12 ชั่วโมง จะได้ "02:30 p.m."
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// YYYY-MM-DD ตามเวลาไทย
function serverDocDate(date = new Date()) {
  return dateFormatter.format(date);
}

// HH:mm ตามเวลาไทย
function serverDocTime(date = new Date()) {
  return timeFormatter.format(date);
}

// ISO string (UTC) — ใช้กับ log/audit ที่ต้องการ absolute time
function serverNowIso(date = new Date()) {
  return date.toISOString();
}

function serverEpochMs() {
  return Date.now();
}

// ข้อมูลเวลาชุดเต็มสำหรับส่งให้ client sync clock skew
function serverTimeInfo(date = new Date()) {
  return {
    date: serverDocDate(date),
    time: serverDocTime(date),
    iso: serverNowIso(date),
    epoch_ms: date.getTime(),
    timezone: TIME_ZONE,
  };
}

module.exports = {
  TIME_ZONE,
  serverDocDate,
  serverDocTime,
  serverNowIso,
  serverEpochMs,
  serverTimeInfo,
};
