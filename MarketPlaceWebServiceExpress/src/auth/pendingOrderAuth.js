const { verifyToken } = require('./token');
const { getAdminPermissionsForUser } = require('../utils/adminPermissions');

// These document actions require verified identity even on legacy audit/off deployments.
function pendingIdentity(req, res, next) {
  if (typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); }
    catch { return res.status(400).json({ success: false, message: 'ข้อมูลคำขอไม่ถูกต้อง' }); }
  }
  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || '').trim());
  const claims = token && verifyToken(token[1]);
  if (!claims) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' });
  req.auth = { userCode: String(claims.sub), isEmployee: claims.typ === 'employee' };
  const customer = req.body?.cust_code || req.query?.cust_code;
  if (!req.auth.isEmployee && customer && String(customer).toUpperCase() !== req.auth.userCode.toUpperCase()) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลลูกค้ารายนี้' });
  }
  next();
}

async function pendingAdmin(req, res, next) {
  if (!req.auth?.isEmployee) return res.status(403).json({ success: false, message: 'ต้องเข้าสู่ระบบด้วยบัญชีพนักงาน' });
  try {
    const info = await getAdminPermissionsForUser(req.auth.userCode);
    if (!info.is_superadmin && !info.permissions.includes('admin.orders')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์จัดการคำสั่งซื้อ' });
    }
    next();
  } catch (error) { next(error); }
}

module.exports = { pendingIdentity, pendingAdmin };
