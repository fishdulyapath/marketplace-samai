export const ADMIN_PERMISSION_CODES = [
    'admin.orders',
    'admin.content',
    'admin.categories',
    'admin.customers',
    'admin.reports',
    'admin.employees',
    'admin.inventory',
    'admin.products',
    'admin.productParticipation',
    'admin.salesSettings',
    'admin.salePremium',
    'admin.permissions'
];

export function isSuperadmin(code) {
    return String(code || '').trim().toUpperCase() === 'SUPERADMIN';
}

function getEmployeeCode() {
    const empData = safeJson(localStorage.getItem('_empData')) || {};
    return localStorage.getItem('_empCode') || empData.user_code || '';
}

function safeJson(value) {
    try {
        return JSON.parse(value || 'null');
    } catch {
        return null;
    }
}

export function normalizeAdminPermissions(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => ADMIN_PERMISSION_CODES.includes(item)))];
}

export function getStoredAdminPermissions() {
    const empCode = getEmployeeCode();
    if (isSuperadmin(empCode)) return [...ADMIN_PERMISSION_CODES];

    const raw = localStorage.getItem('_adminPermissions');
    if (!raw) return [...ADMIN_PERMISSION_CODES];

    return normalizeAdminPermissions(safeJson(raw));
}

export function canAccessAdminPermission(permissionCode) {
    if (!permissionCode) return true;
    const empCode = getEmployeeCode();
    if (isSuperadmin(empCode)) return true;
    return getStoredAdminPermissions().includes(permissionCode);
}

export function saveStoredAdminPermissions(permissions, hasCustomPermissions = true) {
    if (hasCustomPermissions === false) {
        localStorage.removeItem('_adminPermissions');
        return;
    }
    localStorage.setItem('_adminPermissions', JSON.stringify(normalizeAdminPermissions(permissions)));
}

export function clearStoredAdminPermissions() {
    localStorage.removeItem('_adminPermissions');
}
