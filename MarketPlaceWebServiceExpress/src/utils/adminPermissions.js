const { query } = require('../db');

const ADMIN_PERMISSION_PAGES = [
  { code: 'admin.orders', title: 'คำสั่งซื้อ', path: '/admin/orders' },
  { code: 'admin.content', title: 'จัดการหน้าเว็บหลัก', path: '/admin/content' },
  { code: 'admin.categories', title: 'จัดการหมวดหมู่', path: '/admin/categories' },
  { code: 'admin.customers', title: 'จัดการลูกค้า', path: '/admin/customers' },
  { code: 'admin.reports', title: 'รายงาน', path: '/admin/reports' },
  { code: 'admin.employees', title: 'จัดการพนักงาน', path: '/admin/employees' },
  { code: 'admin.inventory', title: 'คลังสินค้า', path: '/admin/inventory' },
  { code: 'admin.products', title: 'จัดการสินค้า', path: '/admin/products' },
  { code: 'admin.productParticipation', title: 'กำหนดสินค้าเข้าร่วม', path: '/admin/product-participation' },
  { code: 'admin.salesSettings', title: 'จัดการตั้งค่าการขาย', path: '/admin/sales-settings' },
  { code: 'admin.salePremium', title: 'จัดการโปรโมชันของแถม', path: '/admin/sale-premium' },
  { code: 'admin.permissions', title: 'กำหนดสิทธิ์หลังบ้าน', path: '/admin/permissions' },
];

const ADMIN_PERMISSION_CODES = ADMIN_PERMISSION_PAGES.map((page) => page.code);
let tableReady = false;

function cleanUserCode(value) {
  return String(value || '').trim();
}

function isSuperadmin(code) {
  return cleanUserCode(code).toUpperCase() === 'SUPERADMIN';
}

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.map((value) => String(value || '').trim()).filter((value) => ADMIN_PERMISSION_CODES.includes(value)))];
}

async function ensureAdminPermissionTable() {
  if (tableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS marketplace_admin_permission (
      user_code VARCHAR(50) PRIMARY KEY,
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    )`
  );
  tableReady = true;
}

async function getAdminPermissionsForUser(userCode) {
  const code = cleanUserCode(userCode);
  if (!code) {
    return {
      user_code: '',
      permissions: [],
      is_superadmin: false,
      has_custom_permissions: false,
    };
  }

  if (isSuperadmin(code)) {
    return {
      user_code: code,
      permissions: [...ADMIN_PERMISSION_CODES],
      is_superadmin: true,
      has_custom_permissions: true,
    };
  }

  await ensureAdminPermissionTable();
  const result = await query(
    'SELECT permissions FROM marketplace_admin_permission WHERE UPPER(user_code) = UPPER($1) LIMIT 1',
    [code]
  );

  if (!result.rows.length) {
    return {
      user_code: code,
      permissions: [...ADMIN_PERMISSION_CODES],
      is_superadmin: false,
      has_custom_permissions: false,
    };
  }

  return {
    user_code: code,
    permissions: normalizePermissions(result.rows[0].permissions),
    is_superadmin: false,
    has_custom_permissions: true,
  };
}

async function saveAdminPermissionsForUser(userCode, permissions) {
  const code = cleanUserCode(userCode);
  if (!code) throw new Error('กรุณาระบุรหัสพนักงาน');
  if (isSuperadmin(code)) throw new Error('SUPERADMIN มีสิทธิ์ทุกหน้าจอโดยอัตโนมัติ ไม่ต้องกำหนดสิทธิ์');

  const cleanPermissions = normalizePermissions(permissions);
  await ensureAdminPermissionTable();
  await query(
    `INSERT INTO marketplace_admin_permission (user_code, permissions, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_code)
     DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()`,
    [code, JSON.stringify(cleanPermissions)]
  );

  return getAdminPermissionsForUser(code);
}

module.exports = {
  ADMIN_PERMISSION_PAGES,
  ADMIN_PERMISSION_CODES,
  cleanUserCode,
  ensureAdminPermissionTable,
  getAdminPermissionsForUser,
  isSuperadmin,
  normalizePermissions,
  saveAdminPermissionsForUser,
};
