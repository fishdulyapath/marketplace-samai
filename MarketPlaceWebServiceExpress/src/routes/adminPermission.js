const express = require('express');
const router = express.Router();
const {
  ADMIN_PERMISSION_PAGES,
  getAdminPermissionsForUser,
  saveAdminPermissionsForUser,
} = require('../utils/adminPermissions');
const { requireAdmin, requireSuperadmin } = require('../auth/requireAdmin');

// รายการหน้าแอดมินเป็นแค่ metadata (ชื่อหน้า/path) ไม่มีข้อมูลลูกค้า
// แต่ยังต้องเป็นพนักงาน เพื่อไม่ให้คนนอกรู้ว่าระบบหลังบ้านมีอะไรบ้าง
router.get('/adminPermissionPages', requireAdmin('admin.permissions'), (_req, res) => {
  res.json({
    success: true,
    data: ADMIN_PERMISSION_PAGES,
  });
});

router.get('/getAdminPermissions', requireAdmin('admin.permissions'), async (req, res) => {
  try {
    const data = await getAdminPermissionsForUser(req.query.user_code || '');
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

// 🚨 จุดที่อันตรายที่สุดของระบบ — เดิมเปิดให้ใครก็ได้ยิงตั้งตัวเองเป็น superadmin
// จำกัดไว้ที่ superadmin เท่านั้น ไม่ใช่แค่ admin.permissions
// เพราะคนที่แก้สิทธิ์ได้ = แก้ให้ตัวเองมีทุกสิทธิ์ได้ = เท่ากับ superadmin อยู่ดี
router.post('/saveAdminPermissions', requireSuperadmin(), async (req, res) => {
  try {
    const data = await saveAdminPermissionsForUser(req.body?.user_code || '', req.body?.permissions || []);
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

module.exports = router;
