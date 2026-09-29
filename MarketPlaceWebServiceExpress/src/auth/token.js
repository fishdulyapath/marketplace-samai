// ── token สำหรับยืนยันตัวตน ─────────────────────────────────────────────
//
// เดิมระบบไม่มีการยืนยันตัวตนเลย — frontend ปั้นสตริง 'CUSTOMER_TOKEN_' + Date.now()
// เก็บไว้เองเป็นธง "ล็อกอินแล้ว" ส่วน server เชื่อ cust_code ที่ส่งมาใน query string ตรงๆ
// ใครเปลี่ยน cust_code ใน URL ก็อ่านข้อมูลลูกค้ารายอื่นได้
//
// ใช้ HMAC-SHA256 ด้วย crypto ที่มากับ Node ไม่เพิ่ม dependency (โปรเจกต์นี้มีแค่ 8 ตัว)
// รูปแบบ: base64url(payload) + '.' + base64url(hmac)
//
// ⚠️ token เป็นแบบ stateless — ยกเลิกกลางคันไม่ได้ ต้องรอหมดอายุ
//    ถ้าวันหนึ่งต้องเตะคนออกทันที (เช่นพนักงานลาออก) ค่อยเพิ่มตาราง session แล้วเช็คเพิ่ม
//    ที่นี่จงใจไม่ทำเพราะจะเพิ่ม query 1 ครั้งทุก request ซึ่งกระทบ connection pool ที่ตึงอยู่แล้ว

const crypto = require('crypto');

const DEFAULT_TTL_HOURS = 12;

// secret ชั่วคราวสำหรับ dev ที่ยังไม่ได้ตั้ง env — สุ่มใหม่ทุกครั้งที่ restart
// (token เก่าใช้ไม่ได้หลัง restart ซึ่งยอมรับได้ตอน dev แต่ยอมไม่ได้ตอน production)
let ephemeralSecret = null;

function getSecret() {
  const configured = String(process.env.AUTH_TOKEN_SECRET || '').trim();
  if (configured) return configured;

  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[auth] ไม่ได้ตั้ง AUTH_TOKEN_SECRET — ใช้ secret ชั่วคราวที่สุ่มตอนเริ่มระบบ\n' +
      '       token จะใช้ไม่ได้หลัง restart และห้ามใช้แบบนี้บน production'
    );
  }
  return ephemeralSecret;
}

// โหมด enforce ที่ไม่มี secret ถาวร = token ทั้งระบบตายทุกครั้งที่ restart
// ปล่อยให้ boot ผ่านไปแล้วค่อยพังตอนลูกค้าใช้งานแย่กว่าพังตอน start
function assertSecretConfiguredForEnforce() {
  if (!String(process.env.AUTH_TOKEN_SECRET || '').trim()) {
    throw new Error(
      'AUTH_MODE=enforce ต้องตั้ง AUTH_TOKEN_SECRET ใน .env ก่อน\n' +
      'สร้างค่าได้ด้วย: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
}

function getTtlSeconds() {
  const hours = Number(process.env.AUTH_TOKEN_TTL_HOURS);
  const safe = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS;
  return Math.round(safe * 3600);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hmac(data) {
  return crypto.createHmac('sha256', getSecret()).update(data).digest();
}

/**
 * @param {{ sub: string, typ: 'customer'|'employee', cc?: string }} claims
 * @returns {string} token
 */
function signToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(claims?.sub || ''),
    typ: claims?.typ === 'employee' ? 'employee' : 'customer',
    cc: String(claims?.cc || ''),
    iat: now,
    exp: now + getTtlSeconds(),
  };

  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(hmac(body))}`;
}

/**
 * คืน payload ถ้า token ถูกต้องและยังไม่หมดอายุ · คืน null ในทุกกรณีที่ใช้ไม่ได้
 * ห้าม throw — ผู้เรียกเป็น middleware ที่ต้องตัดสินใจเองว่าจะปล่อยผ่านหรือปฏิเสธ
 */
function verifyToken(raw) {
  const token = String(raw || '').trim();
  if (!token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let given;
  let expected;
  try {
    given = Buffer.from(signature, 'base64url');
    expected = hmac(body);
  } catch {
    return null;
  }

  // timingSafeEqual โยน error ถ้าความยาวไม่เท่ากัน จึงต้องเช็คก่อน
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;
  if (!payload.sub) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;

  return payload;
}

module.exports = { signToken, verifyToken, assertSecretConfiguredForEnforce, DEFAULT_TTL_HOURS };
