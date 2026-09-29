<script setup>
import AdminEmployeeService from '@/services/AdminEmployeeService';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const toast = useToast();

const searchText = ref('');
const statusFilter = ref('all');
const employees = ref([]);
const summary = ref({ total: 0, visible: 0, hidden: 0 });
const isLoading = ref(false);
const savingCodes = ref(new Set());
const truncated = ref(false);
const loadError = ref('');

const statusOptions = [
    { label: 'ทั้งหมด', value: 'all' },
    { label: 'แสดงให้เลือก', value: 'visible' },
    { label: 'ซ่อน', value: 'hidden' }
];

const resultText = computed(() => {
    if (isLoading.value) return 'กำลังโหลดข้อมูล...';
    return `พบ ${employees.value.length.toLocaleString('th-TH')} รายการ`;
});

function errorMessage(error, fallback) {
    return error?.response?.data?.message || error?.message || fallback;
}

function isSaving(code) {
    return savingCodes.value.has(String(code || '').toUpperCase());
}

function setSaving(code, value) {
    const key = String(code || '').toUpperCase();
    const next = new Set(savingCodes.value);
    if (value) next.add(key);
    else next.delete(key);
    savingCodes.value = next;
}

async function loadEmployees() {
    if (isLoading.value) return;
    isLoading.value = true;
    loadError.value = '';

    try {
        const result = await AdminEmployeeService.getEmployees({
            search: searchText.value.trim(),
            status: statusFilter.value,
            limit: 500
        });
        employees.value = result.rows;
        summary.value = result.summary;
        truncated.value = result.truncated;
    } catch (error) {
        employees.value = [];
        summary.value = { total: 0, visible: 0, hidden: 0 };
        truncated.value = false;
        loadError.value = errorMessage(error, 'โหลดข้อมูลพนักงานไม่สำเร็จ');
        toast.add({ severity: 'error', summary: 'โหลดข้อมูลไม่สำเร็จ', detail: loadError.value, life: 3500 });
    } finally {
        isLoading.value = false;
    }
}

async function changeFilter(value) {
    statusFilter.value = value;
    await loadEmployees();
}

async function setEmployeeSelectable(employee, selectable) {
    if (!employee?.code || isSaving(employee.code)) return;

    const previousSelectable = Boolean(employee.selectable);
    const mobileUser = selectable ? 0 : 1;
    employee.selectable = selectable;
    employee.mobile_user = mobileUser;
    setSaving(employee.code, true);

    try {
        const saved = await AdminEmployeeService.setVisibility(employee.code, mobileUser);
        if (saved) Object.assign(employee, saved);

        if (previousSelectable !== Boolean(employee.selectable)) {
            summary.value = {
                ...summary.value,
                visible: Math.max(0, Number(summary.value.visible || 0) + (employee.selectable ? 1 : -1)),
                hidden: Math.max(0, Number(summary.value.hidden || 0) + (employee.selectable ? -1 : 1))
            };
        }

        if ((statusFilter.value === 'visible' && !employee.selectable) || (statusFilter.value === 'hidden' && employee.selectable)) {
            employees.value = employees.value.filter((row) => row.code !== employee.code);
        }

        toast.add({
            severity: 'success',
            summary: employee.selectable ? 'แสดงพนักงานแล้ว' : 'ซ่อนพนักงานแล้ว',
            detail: `${employee.code} - ${employee.name || '-'}`,
            life: 2200
        });
    } catch (error) {
        employee.selectable = previousSelectable;
        employee.mobile_user = previousSelectable ? 0 : 1;
        toast.add({
            severity: 'error',
            summary: 'บันทึกสถานะไม่สำเร็จ',
            detail: errorMessage(error, 'กรุณาลองใหม่'),
            life: 3500
        });
    } finally {
        setSaving(employee.code, false);
    }
}

onMounted(loadEmployees);
</script>

<template>
    <main class="employee-admin-page">
        <header class="page-header">
            <Button icon="pi pi-arrow-left" text rounded severity="secondary" aria-label="กลับหน้าจัดการหลังบ้าน" :disabled="isLoading" @click="router.push('/admin')" />
            <div>
                <p>EMPLOYEE VISIBILITY</p>
                <h1>จัดการพนักงาน</h1>
                <span>กำหนดรายชื่อพนักงานขายที่ลูกค้าสามารถเลือกได้ในหน้ายืนยันออเดอร์</span>
            </div>
        </header>

        <section class="summary-grid" aria-label="สรุปสถานะพนักงาน">
            <article>
                <i class="pi pi-users"></i>
                <div>
                    <small>พนักงานทั้งหมด</small><strong>{{ summary.total.toLocaleString('th-TH') }}</strong>
                </div>
            </article>
            <article class="visible-summary">
                <i class="pi pi-eye"></i>
                <div>
                    <small>แสดงให้เลือก</small><strong>{{ summary.visible.toLocaleString('th-TH') }}</strong>
                </div>
            </article>
            <article class="hidden-summary">
                <i class="pi pi-eye-slash"></i>
                <div>
                    <small>ซ่อน</small><strong>{{ summary.hidden.toLocaleString('th-TH') }}</strong>
                </div>
            </article>
        </section>

        <section class="employee-panel">
            <div class="toolbar">
                <div class="search-box">
                    <i class="pi pi-search"></i>
                    <InputText v-model="searchText" placeholder="ค้นหารหัสหรือชื่อพนักงาน" aria-label="ค้นหารหัสหรือชื่อพนักงาน" :disabled="isLoading" @keyup.enter="loadEmployees" />
                    <Button label="ค้นหา" icon="pi pi-search" :loading="isLoading" @click="loadEmployees" />
                </div>

                <SelectButton :modelValue="statusFilter" :options="statusOptions" optionLabel="label" optionValue="value" :allowEmpty="false" :disabled="isLoading" aria-label="กรองสถานะพนักงาน" @update:modelValue="changeFilter" />
            </div>

            <div class="result-meta">
                <span>{{ resultText }}</span>
                <small>สวิตช์เปิด = แสดงในหน้ายืนยันออเดอร์</small>
            </div>

            <Message v-if="loadError" severity="error" :closable="false">{{ loadError }}</Message>
            <Message v-if="truncated" severity="warn" :closable="false">แสดงสูงสุด 500 รายการ กรุณาค้นหาด้วยรหัสหรือชื่อเพื่อเจาะจงผลลัพธ์</Message>

            <DataTable :value="employees" dataKey="code" stripedRows responsiveLayout="scroll" :loading="isLoading" class="employee-table">
                <Column field="code" header="รหัสพนักงาน" sortable style="min-width: 150px">
                    <template #body="{ data }">
                        <strong class="employee-code">{{ data.code }}</strong>
                    </template>
                </Column>
                <Column field="name" header="ชื่อพนักงาน" sortable style="min-width: 240px">
                    <template #body="{ data }">
                        <span>{{ data.name || '-' }}</span>
                    </template>
                </Column>
                <Column header="ค่า mobile_user" style="width: 150px">
                    <template #body="{ data }">
                        <Tag :value="String(data.mobile_user)" :severity="data.mobile_user === 1 ? 'danger' : 'success'" />
                    </template>
                </Column>
                <Column header="แสดงให้เลือก" style="min-width: 220px">
                    <template #body="{ data }">
                        <div class="visibility-control">
                            <ToggleSwitch :modelValue="Boolean(data.selectable)" :disabled="isSaving(data.code)" :aria-label="`${data.selectable ? 'ซ่อน' : 'แสดง'}พนักงาน ${data.code}`" @update:modelValue="setEmployeeSelectable(data, $event)" />
                            <span :class="data.selectable ? 'is-visible' : 'is-hidden'">
                                <i v-if="isSaving(data.code)" class="pi pi-spin pi-spinner"></i>
                                <i v-else :class="data.selectable ? 'pi pi-eye' : 'pi pi-eye-slash'"></i>
                                {{ data.selectable ? 'แสดงให้เลือก' : 'ซ่อนจากรายการ' }}
                            </span>
                        </div>
                    </template>
                </Column>
                <template #empty>
                    <div class="empty-state">
                        <i class="pi pi-users"></i>
                        <strong>ไม่พบพนักงาน</strong>
                        <span>ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ</span>
                    </div>
                </template>
            </DataTable>
        </section>
    </main>
</template>

<style scoped>
.employee-admin-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 2rem);
    background: linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #4b3a1d);
}

.page-header,
.summary-grid,
.employee-panel {
    max-width: 1080px;
    margin-inline: auto;
}

.page-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
}

.page-header p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.76rem;
    font-weight: 900;
    letter-spacing: 0.1em;
}

.page-header h1 {
    margin: 0.2rem 0;
    font-size: clamp(1.65rem, 4vw, 2.35rem);
}

.page-header span {
    color: var(--market-muted, #7b6844);
}

.summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.85rem;
    margin-bottom: 1rem;
}

.summary-grid article {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 1rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.9rem;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 10px 24px var(--market-shadow, rgba(120, 86, 28, 0.07));
}

.summary-grid article > i {
    display: grid;
    width: 2.7rem;
    height: 2.7rem;
    place-items: center;
    border-radius: 0.8rem;
    background: var(--market-primary-soft, #e8f5ef);
    color: var(--market-primary, #0f9f6e);
    font-size: 1.15rem;
}

.summary-grid article div {
    display: grid;
    gap: 0.15rem;
}

.summary-grid small {
    color: var(--market-muted, #7b6844);
}

.summary-grid strong {
    font-size: 1.45rem;
}

.hidden-summary > i {
    background: #fff0f0 !important;
    color: #dc2626 !important;
}

.employee-panel {
    padding: 1rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 1rem;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 14px 30px var(--market-shadow, rgba(120, 86, 28, 0.08));
}

.toolbar,
.search-box,
.result-meta,
.visibility-control {
    display: flex;
    align-items: center;
}

.toolbar {
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.85rem;
}

.search-box {
    position: relative;
    flex: 1;
    gap: 0.55rem;
    max-width: 590px;
}

.search-box > i {
    position: absolute;
    left: 0.85rem;
    z-index: 1;
    color: var(--market-muted, #7b6844);
}

.search-box :deep(.p-inputtext) {
    width: 100%;
    padding-left: 2.35rem;
}

.result-meta {
    justify-content: space-between;
    gap: 1rem;
    margin: 0.35rem 0 0.8rem;
    color: var(--market-muted, #7b6844);
}

.result-meta small {
    font-weight: 700;
}

.employee-table {
    margin-top: 0.85rem;
}

.employee-code {
    color: var(--market-primary, #0f9f6e);
}

.visibility-control {
    gap: 0.65rem;
}

.visibility-control span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 750;
}

.is-visible {
    color: #059669;
}

.is-hidden {
    color: #dc2626;
}

.empty-state {
    display: grid;
    place-items: center;
    gap: 0.4rem;
    padding: 2.5rem 1rem;
    color: var(--market-muted, #7b6844);
    text-align: center;
}

.empty-state i {
    font-size: 2rem;
}

@media (max-width: 760px) {
    .summary-grid {
        grid-template-columns: 1fr;
    }

    .toolbar,
    .result-meta {
        align-items: stretch;
        flex-direction: column;
    }

    .search-box {
        max-width: none;
    }

    .toolbar :deep(.p-selectbutton) {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
    }
}
</style>
