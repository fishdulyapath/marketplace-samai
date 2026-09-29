// ── ชั้นที่ 3: สิทธิ์งานหลังบ้าน ─────────────────────────────────────────
//
// เดิม endpoint ฝั่งแอดมินไม่มีการตรวจสิทธิ์เลยแม้แต่ตัวเดียว
// ที่หนักที่สุดคือ POST /saveAdminPermissions — ใครก็ยิงตั้งตัวเองเป็น superadmin ได้
// แล้วเข้าถึงหน้าแอดมินทั้งหมด ต่อด้วยแก้ราคา แก้เนื้อหาหน้าร้าน หรือดูข้อมูลลูกค้าทุกราย
//
// ใช้ getAdminPermissionsForUser() ที่มีอยู่แล้วใน utils/adminPermissions.js
// สิทธิ์ "ไม่" ถูกฝังใน token โดยตั้งใจ — อ่านจากฐานข้อมูลตอนตรวจทุกครั้ง
// เพื่อให้การถอนสิทธิ์มีผลทันที ไม่ต้องรอ token หมดอายุ

const { getAdminPermissionsForUser } = require('../utils/adminPermissions');
const { getMode } = require('./authMiddleware');

function deny(res, code, message) {
  return res.status(403).json({ success: false, auth_error: true, code, message });
}

/**
 * @param {string|null} permissionCode รหัสสิทธิ์ที่ต้องมี · null = ต้องเป็น superadmin เท่านั้น
 */
function requireAdmin(permissionCode = null) {
  return async function requireAdminMiddleware(req, res, next) {
    const mode = getMode();
    if (mode === 'off') return next();

    const auditOnly = mode === 'audit';
    const label = permissionCode || 'superadmin';

    // ไม่มี req.auth = authMiddleware ปล่อยผ่านมาในโหมด audit (ไม่มี token)
    if (!req.auth) {
      if (auditOnly) {
        console.warn(`[auth:audit] ${req.method} ${req.originalUrl} — งานแอดมินที่ยังไม่มี token (ต้องการ ${label})`);
        return next();
      }
      return res.status(401).json({
        success: false,
        auth_error: true,
        code: 'AUTH_REQUIRED',
        message: 'กรุณาเข้าสู่ระบบใหม่',
      });
    }

    if (!req.auth.isEmployee) {
      if (auditOnly) {
        console.warn(`[auth:audit] ${req.method} ${req.originalUrl} — ลูกค้า ${req.auth.userCode} เรียกงานแอดมิน (ต้องการ ${label})`);
        return next();
      }
      return deny(res, 'AUTH_ADMIN_REQUIRED', 'ต้องเข้าสู่ระบบด้วยบัญชีพนักงาน');
    }

    let info;
    try {
      info = await getAdminPermissionsForUser(req.auth.userCode);
    } catch (error) {
      console.error('requireAdmin: อ่านสิทธิ์ไม่สำเร็จ —', error?.message || error);
      // อ่านสิทธิ์ไม่ได้ = ปฏิเสธ (fail-closed) ต่างจากด่านราคาที่ยอม fail-open
      // เพราะที่นี่ผลของการเดาผิดคือเปิดให้คนไม่มีสิทธิ์เข้าถึงงานหลังบ้าน
      if (auditOnly) return next();
      return res.status(503).json({
        success: false,
        auth_error: true,
        code: 'AUTH_PERMISSION_UNAVAILABLE',
        message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ กรุณาลองใหม่',
      });
    }

    const allowed = info.is_superadmin || (permissionCode ? (info.permissions || []).includes(permissionCode) : false);
    if (allowed) return next();

    if (auditOnly) {
      console.warn(`[auth:audit] ${req.method} ${req.originalUrl} — พนักงาน ${req.auth.userCode} ไม่มีสิทธิ์ ${label}`);
      return next();
    }
    return deny(res, 'AUTH_PERMISSION_DENIED', 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
  };
}

// สิทธิ์ระดับสูงสุด — ใช้กับการแก้สิทธิ์คนอื่น ซึ่งเป็นกุญแจของทุกอย่าง
const requireSuperadmin = () => requireAdmin(null);

/**
 * "ต้องเป็นพนักงาน" เฉยๆ ไม่ผูกกับสิทธิ์หน้าใดหน้าหนึ่ง
 *
 * มีไว้สำหรับ endpoint ที่เป็นงานของพนักงานแต่ไม่ได้อยู่ในหน้าแอดมินหน้าไหนโดยตรง
 * เช่น dropdown ข้อมูลหลัก (คลัง/ที่เก็บ/สาขา) แดชบอร์ด POS และประวัติการขายหน้าร้าน
 *
 * ⚠️ ห้ามใช้ requireAdmin('admin.xxx') กับของพวกนี้ — รหัสสิทธิ์มีเท่าที่ประกาศใน
 *    ADMIN_PAGES ถ้าอ้างรหัสที่ไม่มีจริง พนักงานที่ "มีแถวสิทธิ์" จะโดนปฏิเสธทั้งหมด
 *    (คนที่ไม่มีแถวได้ทุกสิทธิ์ตามกติกาเดิม จึงไม่เจอปัญหา ทำให้บั๊กแบบนี้ซ่อนตัวได้นาน)
 *    และห้ามใช้ requireSuperadmin() เพราะเข้มเกินไปสำหรับงานประจำวัน
 */
function requireEmployee() {
  return function requireEmployeeMiddleware(req, res, next) {
    const mode = getMode();
    if (mode === 'off') return next();
    const auditOnly = mode === 'audit';

    if (!req.auth) {
      if (auditOnly) {
        console.warn(`[auth:audit] ${req.method} ${req.originalUrl} — งานของพนักงานที่ยังไม่มี token`);
        return next();
      }
      return res.status(401).json({
        success: false, auth_error: true, code: 'AUTH_REQUIRED', message: 'กรุณาเข้าสู่ระบบใหม่',
      });
    }
    if (req.auth.isEmployee) return next();

    if (auditOnly) {
      console.warn(`[auth:audit] ${req.method} ${req.originalUrl} — ลูกค้า ${req.auth.userCode} เรียกงานของพนักงาน`);
      return next();
    }
    return deny(res, 'AUTH_ADMIN_REQUIRED', 'ต้องเข้าสู่ระบบด้วยบัญชีพนักงาน');
  };
}

module.exports = { requireAdmin, requireSuperadmin, requireEmployee };
