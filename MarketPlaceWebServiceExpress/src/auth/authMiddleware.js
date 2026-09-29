// ── ยืนยันตัวตนและจำกัดขอบเขตข้อมูล ──────────────────────────────────────
//
// ชั้นที่ 1 — "คุณคือใคร"       : ตรวจ Bearer token ที่ server เป็นคนออก
// ชั้นที่ 2 — "ข้อมูลนี้ของคุณไหม" : ลูกค้าอ้าง cust_code ได้เฉพาะของตัวเอง
//
// โครงเลียนแบบ licenseMiddleware (src/license.js) ซึ่งเป็น pattern ที่โปรเจกต์นี้ใช้อยู่แล้ว:
// middleware ระดับ global + สวิตช์ปิด + allowlist ของ path ที่ยกเว้น
//
// ── ทำไมตรวจ cust_code ที่นี่แทนที่จะไล่แก้ทุก route ──
// มีจุดที่อ่าน cust_code จาก request กระจายอยู่ ~40 จุดใน 9 ไฟล์ ทั้งแบบ req.query.cust_code
// และแบบ destructure การไล่แก้ทุกจุดคือ diff ใหญ่ พลาดง่าย และ review ยาก
// ตรวจที่ทางเข้าทางเดียวแทน — route ทุกตัวยังอ่าน cust_code แบบเดิม แต่ค่าถูกกรองแล้ว
//
// ⚠️ วิธีนี้กันได้เฉพาะพารามิเตอร์ชื่อ 'cust_code' เท่านั้น
//
// 🚨 คอมเมนต์เดิมตรงนี้เขียนว่า "ตรวจแล้วว่าไม่มี route ไหนรับตัวตนลูกค้าด้วยชื่ออื่น" — ไม่จริง
//    การทดสอบยิงจริงพบว่า customer.js รับด้วยชื่อ 'code':
//      GET /getCustomerDetail?code=<ของคนอื่น>  ->  200 พร้อมข้อมูลลูกค้ารายนั้น
//      และคอลัมน์ password (มาจาก ar_customer.fax) ก็หลุดออกมาด้วย = สวมสิทธิ์ล็อกอินได้
//    ด่านนี้จึงกันไม่ได้ และการเปิด AUTH_MODE=enforce ก็ยังไม่ปิดช่องนี้
//
//    ⚠️ ห้ามแก้ด้วยการเพิ่ม 'code' เข้า CUSTOMER_ID_FIELDS เฉยๆ — จะพังงานปกติของแอดมิน
//       ที่ต้องเปิดดูลูกค้ารายอื่น และ getCustomerDetail ยังเป็น endpoint ที่ใช้ร่วมกัน
//       สองทาง: CustomerProfile.vue เรียกดูโปรไฟล์ "ของตัวเอง" ส่วนหน้าแอดมินเรียกดู "ของใครก็ได้"
//       จึงต้องแยกกติกาต่อ route ไม่ใช่กติกาเดียวทั้งระบบ:
//         - getCustomerManageList / createCustomer / updateCustomer / deleteCustomer = ฝั่งแอดมินล้วน -> requireAdmin
//         - getCustomerDetail = ลูกค้าเปิดได้เฉพาะ code ของตัวเอง พนักงานเปิดได้ทุกคน
//         - คอลัมน์ password (ar_customer.fax) ไม่ควรออกไปในเส้นทางของลูกค้าเลย
//       (pos.js / financial.js ก็ไม่มี requireAdmin เหมือนกัน)
//
//    ถ้าเพิ่ม endpoint ใหม่ที่ใช้ชื่ออื่น (เช่น ar_code) ต้องเพิ่มใน CUSTOMER_ID_FIELDS ด้วย

const { verifyToken, assertSecretConfiguredForEnforce } = require('./token');

const MODE_OFF = 'off';
const MODE_AUDIT = 'audit';
const MODE_ENFORCE = 'enforce';

function getMode() {
  const raw = String(process.env.AUTH_MODE || MODE_AUDIT).trim().toLowerCase();
  return [MODE_OFF, MODE_AUDIT, MODE_ENFORCE].includes(raw) ? raw : MODE_AUDIT;
}

// path ที่ต้องเข้าถึงได้โดยไม่ล็อกอิน
//
// 🚨 หน้าร้านต้องเปิดดูสินค้าได้โดยไม่ล็อกอิน (ยืนยันแล้วว่าตอนนี้เข้าดูได้ 65 รายการ)
//    ถ้ารายการนี้ขาดไปเส้นเดียว ลูกค้าใหม่จะเจอหน้าเปล่า — โหมด audit จะจับให้เห็นก่อนบังคับ
const PUBLIC_EXACT = new Set([
  '/loginemp',
  '/logincus',
  '/servertime',
  '/license/status',
  '/license/check-now',
  '/getProductList',
  '/getProductDetail',
  '/getProductSetDetail',
  '/getProductPrice',
  '/getCategoryList',
  '/getImageList',
  '/images',
  '/imagesguid',
  // 3 ตัวนี้ได้มาจากการเดินหน้าร้านจริงในโหมด audit แล้วดู log ว่าอะไรถูกเรียกบ้าง
  // ไม่ใช่การเดา — ถ้าขาดไป หน้าร้านจะเด้งไป /auth/login ทันทีที่โหมด enforce
  '/getCompanyProfile', // ชื่อร้าน โลโก้ ที่อยู่ ที่แสดงบนหัวและฟุตเตอร์ทุกหน้า
  '/getErpOption', // ค่า VAT/รูปแบบราคา ที่ใช้คำนวณราคาที่แสดง
  '/sale-premium/list-for-sale', // ป้ายของแถมบนการ์ดสินค้า (ฝั่งลูกค้า ไม่ใช่หน้าแอดมิน)
]);

// GET เปิด แต่ POST ต้องมีสิทธิ์ (requireAdmin เป็นคนตรวจต่อ)
//
// ⚠️ path พวกนี้ห้ามอยู่ใน PUBLIC_EXACT ด้วย ไม่งั้น isPublic() จะคืน true ทุก method
//    แล้ว authMiddleware จะข้ามไปโดยไม่เซ็ต req.auth ทำให้ requireAdmin เห็นว่า "ไม่มี token"
//    แล้วตอบ 401 ทั้งที่แอดมินล็อกอินอยู่ (เคยพลาดตรงนี้กับ /content/home มาแล้ว)
const PUBLIC_GET_ONLY = new Set(['/sales-settings', '/media', '/content/home']);

const CUSTOMER_ID_FIELDS = ['cust_code'];

function isPublic(req) {
  const path = req.path;
  if (PUBLIC_EXACT.has(path)) return true;
  if (req.method === 'GET' && PUBLIC_GET_ONLY.has(path)) return true;
  // รูปภาพมี query string ต่อท้ายหลายแบบ และเป็น asset ของหน้าร้านล้วน
  if (path.startsWith('/images') || path.startsWith('/media/')) return req.method === 'GET';
  return false;
}

function readBearer(req) {
  const header = String(req.headers?.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

// บาง route ใช้ชื่อ 'code' แทน 'cust_code' เป็นตัวระบุตัวตนลูกค้า
//
// ประกาศเป็น "ราย path" ไม่ใช่ใส่รวมใน CUSTOMER_ID_FIELDS เพราะ 'code' เป็นชื่อกว้างมาก
// route อื่นอีกหลายสิบตัวใช้ 'code' หมายถึงรหัสสินค้า/หมวดหมู่/คลัง ถ้าใส่รวมจะบล็อกผิดจุด
// ทั้งสอง route นี้เป็นของลูกค้าเอง (CustomerProfile.vue) พนักงานยังผ่านได้ตามปกติ
//
// 🚨 ถ้าไม่มีบรรทัดนี้ ลูกค้าที่ล็อกอินแล้วส่ง code ของคนอื่นจะ
//    อ่านข้อมูลลูกค้ารายนั้นได้ (getCustomerDetail) และ
//    แก้โปรไฟล์ + เปลี่ยนรหัสผ่านของรายนั้นได้ (updateCustomerProfile)
const CUSTOMER_ID_FIELDS_BY_PATH = new Map([
  ['/getCustomerDetail', ['code']],
  ['/updateCustomerProfile', ['code']],
]);

function claimedCustomerCodes(req) {
  const found = [];
  const extra = CUSTOMER_ID_FIELDS_BY_PATH.get(req.path) || [];
  for (const field of [...CUSTOMER_ID_FIELDS, ...extra]) {
    for (const source of [req.query, req.body]) {
      if (!source || typeof source !== 'object') continue;
      const value = source[field];
      if (value === null || value === undefined) continue;
      if (typeof value === 'string') {
        if (value.trim()) found.push(value.trim());
        continue;
      }
      // ⚠️ ส่ง cust_code เป็นอาร์เรย์/ออบเจ็กต์แล้วเคยหลุดด่านนี้ไปทั้งที่ route ยัง String() ใช้งานได้
      //    (['AP002'] -> 'AP002') จึงต้องนับเป็นรหัสที่อ้างสิทธิ์ ไม่ใช่มองข้าม
      const flattened = Array.isArray(value) ? value : [value];
      for (const entry of flattened) {
        const text = String(entry ?? '').trim();
        // ค่าที่ไม่ใช่สตริงจะกลายเป็น [object Object] ซึ่งไม่มีวันตรงกับรหัสใคร = ถูกปฏิเสธ ถูกแล้ว
        if (text) found.push(text);
      }
    }
  }
  return found;
}

// log ให้อ่านออกว่า "ถ้าบังคับตอนนี้ request นี้จะพัง" — คือสิ่งที่ต้องไล่แก้ก่อนเปลี่ยนโหมด
function auditLog(req, reason, detail = '') {
  console.warn(`[auth:audit] ${req.method} ${req.originalUrl} — ${reason}${detail ? ' · ' + detail : ''}`);
}

function authMiddleware(req, res, next) {
  const mode = getMode();
  if (mode === MODE_OFF) return next();
  if (isPublic(req)) return next();

  const enforcing = mode === MODE_ENFORCE;
  const payload = verifyToken(readBearer(req));

  // ── ชั้น 1 ──
  if (!payload) {
    if (!enforcing) {
      auditLog(req, readBearer(req) ? 'token ใช้ไม่ได้/หมดอายุ' : 'ไม่ได้ส่ง token');
      return next();
    }
    return res.status(401).json({
      success: false,
      auth_error: true,
      code: 'AUTH_REQUIRED',
      message: 'กรุณาเข้าสู่ระบบใหม่',
    });
  }

  req.auth = {
    userCode: String(payload.sub || ''),
    userType: payload.typ === 'employee' ? 'employee' : 'customer',
    contactCode: String(payload.cc || ''),
    isEmployee: payload.typ === 'employee',
  };

  // ── ชั้น 2 ──
  // พนักงานอ้าง cust_code ของลูกค้าคนไหนก็ได้ เพราะสั่งซื้อแทนลูกค้าเป็นฟีเจอร์ที่ออกแบบไว้
  if (!req.auth.isEmployee) {
    const mine = req.auth.userCode.toUpperCase();
    const foreign = claimedCustomerCodes(req).find((code) => code.toUpperCase() !== mine);
    if (foreign) {
      if (!enforcing) {
        auditLog(req, 'cust_code ไม่ตรงกับเจ้าของ token', `token=${req.auth.userCode} ขอ=${foreign}`);
        return next();
      }
      return res.status(403).json({
        success: false,
        auth_error: true,
        code: 'AUTH_SCOPE_DENIED',
        message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลของลูกค้ารายอื่น',
      });
    }
  }

  return next();
}

// เรียกตอน boot — โหมด enforce ที่ไม่มี secret ถาวรจะทำให้ token ตายทุกครั้งที่ restart
function assertAuthConfig() {
  if (getMode() === MODE_ENFORCE) assertSecretConfiguredForEnforce();
  console.log(`[auth] AUTH_MODE = ${getMode()}`);
}

module.exports = { authMiddleware, assertAuthConfig, getMode, isPublic, claimedCustomerCodes };
