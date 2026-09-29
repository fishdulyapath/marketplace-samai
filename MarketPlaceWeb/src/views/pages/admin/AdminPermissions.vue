<script setup>
import AdminPermissionService from '@/services/AdminPermissionService';
import EmployeeService from '@/services/EmployeeService';
import { ADMIN_PERMISSION_CODES, isSuperadmin, normalizeAdminPermissions, saveStoredAdminPermissions } from '@/utils/adminPermissions';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const toast = useToast();

const searchText = ref('');
const employees = ref([]);
const selectedEmployee = ref(null);
const permissionPages = ref([]);
const selectedPermissions = ref([]);
const isLoadingEmployees = ref(false);
const isLoadingPermissions = ref(false);
const isSaving = ref(false);
const permissionModeText = ref('');
let employeeSearchSeq = 0;
let permissionLoadSeq = 0;

const fallbackPages = [
    { code: 'admin.content', title: 'จัดการหน้าเว็บหลัก', path: '/admin/content' },
    { code: 'admin.categories', title: 'จัดการหมวดหมู่', path: '/admin/categories' },
    { code: 'admin.customers', title: 'จัดการลูกค้า', path: '/admin/customers' },
    { code: 'admin.employees', title: 'จัดการพนักงาน', path: '/admin/employees' },
    { code: 'admin.inventory', title: 'คลังสินค้า', path: '/admin/inventory' },
    { code: 'admin.products', title: 'จัดการสินค้า', path: '/admin/products' },
    { code: 'admin.productParticipation', title: 'กำหนดสินค้าเข้าร่วม', path: '/admin/product-participation' },
    { code: 'admin.salesSettings', title: 'จัดการตั้งค่าการขาย', path: '/admin/sales-settings' },
    { code: 'admin.salePremium', title: 'จัดการโปรโมชันของแถม', path: '/admin/sale-premium' },
    { code: 'admin.permissions', title: 'กำหนดสิทธิ์หลังบ้าน', path: '/admin/permissions' }
];

const isSelectedSuperadmin = computed(() => isSuperadmin(selectedEmployee.value?.code));
const allChecked = computed(() => permissionPages.value.length > 0 && permissionPages.value.every((page) => selectedPermissions.value.includes(page.code)));
const isPermissionBusy = computed(() => isLoadingEmployees.value || isLoadingPermissions.value || isSaving.value);
const canEditPermissions = computed(() => Boolean(selectedEmployee.value) && !isSelectedSuperadmin.value && !isPermissionBusy.value);
const canSavePermissions = computed(() => canEditPermissions.value);
const currentEmployeeCode = computed(() => {
    try {
        const empData = JSON.parse(localStorage.getItem('_empData') || '{}');
        return localStorage.getItem('_empCode') || empData.user_code || '';
    } catch {
        return localStorage.getItem('_empCode') || '';
    }
});

onMounted(async () => {
    await Promise.all([loadPermissionPages(), searchEmployees()]);
});

async function loadPermissionPages() {
    try {
        const pages = await AdminPermissionService.getPermissionPages();
        permissionPages.value = pages?.length ? pages : fallbackPages;
    } catch {
        permissionPages.value = fallbackPages;
    }
}

async function searchEmployees() {
    if (isPermissionBusy.value) return;
    const requestId = ++employeeSearchSeq;
    const requestSearch = searchText.value;
    isLoadingEmployees.value = true;
    try {
        const rows = await EmployeeService.getEmployees(requestSearch, 80);
        if (requestId !== employeeSearchSeq) return;
        employees.value = rows;
    } catch (error) {
        if (requestId !== employeeSearchSeq) return;
        employees.value = [];
        toast.add({ severity: 'error', summary: 'โหลดรายชื่อพนักงานไม่สำเร็จ', detail: error.message, life: 3000 });
    } finally {
        if (requestId === employeeSearchSeq) isLoadingEmployees.value = false;
    }
}

async function selectEmployee(employee) {
    if (isPermissionBusy.value || !employee?.code) return;
    selectedEmployee.value = employee;
    permissionModeText.value = '';
    await loadPermissions(employee.code);
}

async function loadPermissions(userCode) {
    const requestId = ++permissionLoadSeq;
    isLoadingPermissions.value = true;
    try {
        const data = await AdminPermissionService.getPermissions(userCode);
        if (requestId !== permissionLoadSeq || selectedEmployee.value?.code !== userCode) return;
        selectedPermissions.value = normalizeAdminPermissions(data?.permissions || []);
        permissionModeText.value = data?.is_superadmin
            ? 'SUPERADMIN มีสิทธิ์ทุกหน้าจออัตโนมัติ'
            : data?.has_custom_permissions
              ? 'ใช้สิทธิ์ที่กำหนดไว้สำหรับพนักงานคนนี้'
              : 'ยังไม่เคยกำหนดสิทธิ์ ระบบจึงให้เข้าได้ทุกหน้าจอตามค่าเดิม';
    } catch (error) {
        if (requestId !== permissionLoadSeq) return;
        selectedPermissions.value = [];
        toast.add({ severity: 'error', summary: 'โหลดสิทธิ์ไม่สำเร็จ', detail: error.message, life: 3000 });
    } finally {
        if (requestId === permissionLoadSeq) isLoadingPermissions.value = false;
    }
}

function togglePermission(code) {
    if (!canEditPermissions.value) return;
    const exists = selectedPermissions.value.includes(code);
    selectedPermissions.value = exists ? selectedPermissions.value.filter((item) => item !== code) : [...selectedPermissions.value, code];
}

function toggleAll() {
    if (!canEditPermissions.value) return;
    selectedPermissions.value = allChecked.value ? [] : permissionPages.value.map((page) => page.code);
}

async function savePermissions() {
    if (isPermissionBusy.value) return;

    if (!selectedEmployee.value?.code) {
        toast.add({ severity: 'warn', summary: 'กรุณาเลือกพนักงาน', life: 2500 });
        return;
    }
    if (isSelectedSuperadmin.value) {
        toast.add({ severity: 'info', summary: 'SUPERADMIN มีสิทธิ์ครบอยู่แล้ว', life: 2500 });
        return;
    }

    isSaving.value = true;
    try {
        const data = await AdminPermissionService.savePermissions(selectedEmployee.value.code, selectedPermissions.value);
        selectedPermissions.value = normalizeAdminPermissions(data?.permissions || []);
        permissionModeText.value = 'บันทึกสิทธิ์เรียบร้อยแล้ว';

        if (String(selectedEmployee.value.code || '').toUpperCase() === String(currentEmployeeCode.value || '').toUpperCase()) {
            saveStoredAdminPermissions(selectedPermissions.value);
        }

        toast.add({ severity: 'success', summary: 'บันทึกสิทธิ์สำเร็จ', life: 2500 });
    } catch (error) {
        toast.add({ severity: 'error', summary: 'บันทึกสิทธิ์ไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    } finally {
        isSaving.value = false;
    }
}
</script>

<template>
    <main class="admin-permission-page">
        <header class="permission-header">
            <Button icon="pi pi-arrow-left" text rounded severity="secondary" aria-label="กลับหน้าจัดการหลังบ้าน" :disabled="isPermissionBusy" @click="router.push('/admin')" />
            <div>
                <p>BACK OFFICE ACCESS</p>
                <h1>กำหนดสิทธิ์หลังบ้าน</h1>
                <span>เลือกพนักงานจาก erp_user แล้วกำหนดหน้าจอจัดการหลังบ้านที่เข้าใช้งานได้</span>
            </div>
        </header>

        <section class="permission-layout">
            <aside class="permission-panel employee-panel">
                <div class="panel-title-row">
                    <div>
                        <h2>พนักงาน</h2>
                        <span>ข้อมูลจาก table erp_user</span>
                    </div>
                </div>

                <div class="employee-search">
                    <InputText v-model="searchText" placeholder="ค้นหารหัสหรือชื่อพนักงาน" aria-label="ค้นหารหัสหรือชื่อพนักงาน" class="w-full" :disabled="isPermissionBusy" @keyup.enter="searchEmployees" />
                    <Button icon="pi pi-search" aria-label="ค้นหาพนักงาน" :loading="isLoadingEmployees" :disabled="isPermissionBusy" @click="searchEmployees" />
                </div>

                <div v-if="isLoadingEmployees" class="loading-box">
                    <i class="pi pi-spin pi-spinner"></i>
                    <span>กำลังโหลดพนักงาน...</span>
                </div>

                <div v-else class="employee-list">
                    <button
                        v-for="employee in employees"
                        :key="employee.code"
                        type="button"
                        :class="['employee-row', selectedEmployee?.code === employee.code ? 'active' : '']"
                        :aria-pressed="selectedEmployee?.code === employee.code"
                        :aria-label="`เลือกพนักงาน ${employee.code} ${employee.name || employee.name_1 || ''}`"
                        :disabled="isPermissionBusy"
                        @click="selectEmployee(employee)"
                    >
                        <strong>{{ employee.code }}</strong>
                        <span>{{ employee.name || employee.name_1 || '-' }}</span>
                        <small v-if="isSuperadmin(employee.code)">SUPERADMIN</small>
                    </button>
                    <div v-if="!employees.length" class="empty-box">ไม่พบพนักงาน</div>
                </div>
            </aside>

            <section class="permission-panel permission-editor">
                <div class="panel-title-row">
                    <div>
                        <h2>สิทธิ์เข้าหน้าจอ</h2>
                        <span v-if="selectedEmployee">{{ selectedEmployee.code }} - {{ selectedEmployee.name || selectedEmployee.name_1 || '-' }}</span>
                        <span v-else>กรุณาเลือกพนักงานด้านซ้าย</span>
                    </div>
                    <Button label="เลือก/ยกเลิกทั้งหมด" icon="pi pi-check-square" outlined :disabled="!canEditPermissions" @click="toggleAll" />
                </div>

                <div v-if="!selectedEmployee" class="empty-editor">
                    <i class="pi pi-user"></i>
                    <p>เลือกพนักงานเพื่อกำหนดสิทธิ์</p>
                </div>

                <div v-else-if="isLoadingPermissions" class="loading-box">
                    <i class="pi pi-spin pi-spinner"></i>
                    <span>กำลังโหลดสิทธิ์...</span>
                </div>

                <div v-else>
                    <div :class="['permission-note', isSelectedSuperadmin ? 'superadmin' : '']">
                        <i :class="isSelectedSuperadmin ? 'pi pi-shield' : 'pi pi-info-circle'"></i>
                        <span>{{ permissionModeText }}</span>
                    </div>

                    <div class="permission-grid">
                        <button
                            v-for="page in permissionPages"
                            :key="page.code"
                            type="button"
                            :class="['permission-card', selectedPermissions.includes(page.code) ? 'checked' : '']"
                            :aria-pressed="selectedPermissions.includes(page.code)"
                            :aria-label="`${selectedPermissions.includes(page.code) ? 'ยกเลิกสิทธิ์' : 'เลือกสิทธิ์'} ${page.title}`"
                            :disabled="!canEditPermissions"
                            @click="togglePermission(page.code)"
                        >
                            <i :class="selectedPermissions.includes(page.code) ? 'pi pi-check-circle' : 'pi pi-circle'"></i>
                            <strong>{{ page.title }}</strong>
                            <span>{{ page.path }}</span>
                        </button>
                    </div>

                    <div class="permission-actions">
                        <span>{{ selectedPermissions.length }} / {{ ADMIN_PERMISSION_CODES.length }} สิทธิ์</span>
                        <Button label="บันทึกสิทธิ์" icon="pi pi-save" :loading="isSaving" :disabled="!canSavePermissions" @click="savePermissions" />
                    </div>
                </div>
            </section>
        </section>
    </main>
</template>

<style scoped>
.admin-permission-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 2rem);
    background: linear-gradient(180deg, var(--market-card-bg, #fff) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #243142);
}

.permission-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    max-width: 1180px;
    margin: 0 auto 1rem;
}

.permission-header p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 0.08em;
}

.permission-header h1 {
    margin: 0.2rem 0;
    font-size: clamp(1.5rem, 3vw, 2.2rem);
}

.permission-header span,
.panel-title-row span {
    color: var(--market-muted, #64748b);
}

.permission-layout {
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 1rem;
    max-width: 1180px;
    margin: 0 auto;
}

.permission-panel {
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: var(--market-radius, 16px);
    background: var(--market-card-bg, #fff);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(15, 23, 42, 0.08));
    padding: 1rem;
}

.panel-title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
}

.panel-title-row h2 {
    margin: 0 0 0.2rem;
    font-size: 1.1rem;
}

.employee-search {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
}

.employee-list {
    display: grid;
    gap: 0.45rem;
    max-height: 62vh;
    overflow: auto;
    padding-right: 0.2rem;
}

.employee-row,
.permission-card {
    border: 1px solid var(--market-card-border, #e2e8f0);
    background: color-mix(in srgb, var(--market-card-bg, #fff) 94%, var(--market-primary, #0f9f6e) 6%);
    color: var(--market-text, #243142);
    cursor: pointer;
    text-align: left;
}

.employee-row {
    display: grid;
    gap: 0.15rem;
    border-radius: 0.75rem;
    padding: 0.7rem 0.8rem;
}

.employee-row span {
    color: var(--market-muted, #64748b);
    font-size: 0.86rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.employee-row small {
    justify-self: start;
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
    background: #111827;
    color: #fff;
    font-weight: 800;
}

.employee-row.active,
.permission-card.checked {
    border-color: var(--market-primary, #0f9f6e);
    background: color-mix(in srgb, var(--market-primary, #0f9f6e) 12%, var(--market-card-bg, #fff) 88%);
}

.employee-row:disabled {
    cursor: wait;
    opacity: 0.68;
}

.permission-note {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-bottom: 1rem;
    border-radius: 0.8rem;
    padding: 0.75rem 0.85rem;
    background: color-mix(in srgb, var(--market-primary, #0f9f6e) 9%, #fff 91%);
    color: var(--market-text, #243142);
}

.permission-note.superadmin {
    background: #111827;
    color: #fff;
}

.permission-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 0.75rem;
}

.permission-card {
    display: grid;
    gap: 0.35rem;
    min-height: 7.5rem;
    border-radius: 0.9rem;
    padding: 0.9rem;
}

.permission-card:disabled {
    cursor: default;
    opacity: 0.9;
}

.permission-card > i {
    color: var(--market-primary, #0f9f6e);
    font-size: 1.2rem;
}

.permission-card span {
    color: var(--market-muted, #64748b);
    font-size: 0.82rem;
}

.permission-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1rem;
    border-top: 1px solid var(--market-card-border, #e2e8f0);
    padding-top: 1rem;
}

.loading-box,
.empty-box,
.empty-editor {
    display: grid;
    place-items: center;
    gap: 0.55rem;
    min-height: 10rem;
    color: var(--market-muted, #64748b);
    text-align: center;
}

.empty-editor i {
    font-size: 2rem;
    color: var(--market-primary, #0f9f6e);
}

@media (max-width: 820px) {
    .permission-layout {
        grid-template-columns: 1fr;
    }

    .employee-list {
        max-height: 18rem;
    }

    .permission-actions,
    .panel-title-row {
        align-items: stretch;
        flex-direction: column;
    }
}
</style>
