<script setup>
// จัดการโปรโมชันของแถม (Sale Premium) — เฟส 4.3 ของ docs/sale-premium-plan.md
import SalePremiumService from '@/services/SalePremiumService';
import SalesSettingsService from '@/services/SalesSettingsService';
import { getProductItemUnitUse } from '@/services/productManageService';
import { useLanguageStore } from '@/stores/languageStore';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';

const languageStore = useLanguageStore();
const t = (key, params) => languageStore.t(key, params);
const toast = useToast();

const empCode = localStorage.getItem('_empCode') || '';

const loading = ref(false);
const saving = ref(false);
const rows = ref([]);
const search = ref('');
const includeInactive = ref(false);

// ----- feature flag -----
const featureEnabled = ref(false);
const featureSaving = ref(false);

// ----- dialog -----
const dialogVisible = ref(false);
const isEdit = ref(false);
const draft = ref(emptyDraft());
const imageFileInput = ref(null);

// ----- product picker -----
const pickerVisible = ref(false);
const pickerTarget = ref(null); // { list: 'conditions'|'lists', index }
const pickerSearch = ref('');
const pickerRows = ref([]);
const pickerLoading = ref(false);

function emptyDraft() {
    return {
        premium_code: '',
        name_1: '',
        name_eng_1: '',
        date_begin: '',
        date_end: '',
        important: 0,
        show_on_web: 1,
        remark: '',
        image_guid: '',
        image_file: '',
        image_preview: '',
        clear_image: 0,
        conditions: [emptyLine()],
        lists: [emptyLine()]
    };
}

function emptyLine() {
    return { ic_code: '', ic_name: '', unit_code: '', unit_options: [], qty: 1 };
}

async function loadList() {
    loading.value = true;
    try {
        rows.value = await SalePremiumService.getList(search.value, includeInactive.value);
    } catch (err) {
        toast.add({ severity: 'error', summary: 'โหลดรายการไม่สำเร็จ', detail: err?.message, life: 4000 });
    } finally {
        loading.value = false;
    }
}

async function loadFeatureFlag() {
    try {
        const settings = await SalesSettingsService.getSettings({ includeFeatured: false });
        featureEnabled.value = String(settings?.sale_premium_enabled ?? '0') === '1';
    } catch {
        featureEnabled.value = false;
    }
}

async function toggleFeature() {
    featureSaving.value = true;
    try {
        await SalesSettingsService.saveSettings({ sale_premium_enabled: featureEnabled.value ? 1 : 0 });
        toast.add({ severity: 'success', summary: featureEnabled.value ? 'เปิดใช้ของแถมแล้ว' : 'ปิดของแถมแล้ว', life: 3000 });
    } catch (err) {
        featureEnabled.value = !featureEnabled.value;
        toast.add({ severity: 'error', summary: 'บันทึกไม่สำเร็จ', detail: err?.message, life: 4000 });
    } finally {
        featureSaving.value = false;
    }
}

function openCreate() {
    isEdit.value = false;
    draft.value = emptyDraft();
    dialogVisible.value = true;
}

async function openEdit(row) {
    isEdit.value = true;
    try {
        const detail = await SalePremiumService.getDetail(row.premium_code);
        if (!detail) throw new Error('ไม่พบข้อมูล');
        draft.value = {
            premium_code: detail.premium_code,
            name_1: detail.name_1 || '',
            name_eng_1: detail.name_eng_1 || '',
            date_begin: (detail.date_begin || '').slice(0, 10),
            date_end: (detail.date_end || '').slice(0, 10),
            important: Number(detail.important) === 1 ? 1 : 0,
            show_on_web: Number(detail.show_on_web ?? 1) === 1 ? 1 : 0,
            remark: detail.remark || '',
            image_guid: detail.image_guid || '',
            image_file: '',
            image_preview: SalePremiumService.getImageUrl(detail),
            clear_image: 0,
            conditions: (detail.conditions || []).map(mapLine),
            lists: (detail.lists || []).map(mapLine)
        };
        if (!draft.value.conditions.length) draft.value.conditions = [emptyLine()];
        if (!draft.value.lists.length) draft.value.lists = [emptyLine()];
        dialogVisible.value = true;
    } catch (err) {
        toast.add({ severity: 'error', summary: 'โหลดรายละเอียดไม่สำเร็จ', detail: err?.message, life: 4000 });
    }
}

function chooseImage() {
    imageFileInput.value?.click();
}

function selectImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
        toast.add({ severity: 'warn', summary: 'ไฟล์ไม่รองรับ', detail: 'เลือกรูป JPG, PNG, WEBP หรือ GIF', life: 3500 });
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        toast.add({ severity: 'warn', summary: 'ไฟล์ใหญ่เกินไป', detail: 'รูปภาพต้องมีขนาดไม่เกิน 8MB', life: 3500 });
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        draft.value.image_file = String(reader.result || '');
        draft.value.image_preview = draft.value.image_file;
        draft.value.clear_image = 0;
    };
    reader.onerror = () => toast.add({ severity: 'error', summary: 'อ่านไฟล์รูปไม่สำเร็จ', life: 3500 });
    reader.readAsDataURL(file);
}

function clearImage() {
    draft.value.image_guid = '';
    draft.value.image_file = '';
    draft.value.image_preview = '';
    draft.value.clear_image = 1;
}

function mapLine(row) {
    return {
        ic_code: row.ic_code || '',
        ic_name: row.ic_name || '',
        unit_code: row.unit_code || '',
        unit_options: row.unit_code ? [{ code: row.unit_code, unit_name: row.unit_name || row.unit_code }] : [],
        qty: Number(row.qty) || 1
    };
}

function addLine(list) {
    draft.value[list].push(emptyLine());
}
function removeLine(list, index) {
    draft.value[list].splice(index, 1);
    if (!draft.value[list].length) draft.value[list].push(emptyLine());
}

// ----- product picker -----
function openPicker(list, index) {
    pickerTarget.value = { list, index };
    pickerSearch.value = '';
    pickerRows.value = [];
    pickerVisible.value = true;
    searchPickerProducts();
}

async function searchPickerProducts() {
    pickerLoading.value = true;
    try {
        pickerRows.value = await SalesSettingsService.searchProducts(pickerSearch.value, 50);
    } catch (err) {
        toast.add({ severity: 'error', summary: 'ค้นหาสินค้าไม่สำเร็จ', detail: err?.message, life: 4000 });
    } finally {
        pickerLoading.value = false;
    }
}

async function selectProduct(product) {
    const { list, index } = pickerTarget.value || {};
    if (!list) return;
    const line = draft.value[list][index];
    line.ic_code = product.code;
    line.ic_name = product.name_1 || product.code;
    line.unit_code = product.unit_standard || '';
    line.unit_options = product.unit_standard ? [{ code: product.unit_standard, unit_name: product.unit_standard }] : [];
    pickerVisible.value = false;
    // โหลดหน่วยจริงของสินค้า
    try {
        const units = await getProductItemUnitUse(product.code);
        if (Array.isArray(units) && units.length) {
            line.unit_options = units.map((u) => ({ code: u.code, unit_name: u.unit_name || u.code }));
            if (!units.some((u) => u.code === line.unit_code)) line.unit_code = units[0].code;
        }
    } catch {
        // ใช้ unit_standard ที่ตั้งไว้ก่อนแล้ว
    }
}

function validateDraft() {
    if (!draft.value.premium_code.trim()) return 'กรุณาระบุรหัสโปรโมชัน';
    if (!draft.value.name_1.trim()) return 'กรุณาระบุชื่อโปรโมชัน';
    const badCond = draft.value.conditions.some((r) => !r.ic_code || !r.unit_code || Number(r.qty) <= 0);
    if (badCond) return 'กรุณากรอกเงื่อนไขการซื้อให้ครบ (สินค้า/หน่วย/จำนวน)';
    const badFree = draft.value.lists.some((r) => !r.ic_code || !r.unit_code || Number(r.qty) <= 0);
    if (badFree) return 'กรุณากรอกรายการของแถมให้ครบ (สินค้า/หน่วย/จำนวน)';
    return '';
}

async function save() {
    const error = validateDraft();
    if (error) {
        toast.add({ severity: 'warn', summary: 'ข้อมูลไม่ครบ', detail: error, life: 4000 });
        return;
    }
    saving.value = true;
    try {
        const payload = {
            emp_code: empCode,
            premium_code: draft.value.premium_code.trim(),
            name_1: draft.value.name_1.trim(),
            name_eng_1: draft.value.name_eng_1.trim(),
            date_begin: draft.value.date_begin || '',
            date_end: draft.value.date_end || '',
            important: draft.value.important,
            show_on_web: draft.value.show_on_web,
            remark: draft.value.remark || '',
            ...(draft.value.image_file ? { image_file: draft.value.image_file } : {}),
            ...(draft.value.clear_image ? { clear_image: 1 } : {}),
            conditions: draft.value.conditions.map((r) => ({ ic_code: r.ic_code, unit_code: r.unit_code, qty: Number(r.qty) })),
            lists: draft.value.lists.map((r) => ({ ic_code: r.ic_code, unit_code: r.unit_code, qty: Number(r.qty) }))
        };
        const res = await SalePremiumService.save(payload);
        if (!res?.success) throw new Error(res?.msg || 'บันทึกไม่สำเร็จ');
        toast.add({ severity: 'success', summary: 'บันทึกสำเร็จ', life: 3000 });
        dialogVisible.value = false;
        await loadList();
    } catch (err) {
        toast.add({ severity: 'error', summary: 'บันทึกไม่สำเร็จ', detail: err?.message, life: 4000 });
    } finally {
        saving.value = false;
    }
}

const deleteTarget = ref(null);
async function confirmDelete() {
    if (!deleteTarget.value) return;
    try {
        const res = await SalePremiumService.remove(deleteTarget.value.premium_code, empCode);
        if (!res?.success) throw new Error(res?.msg || 'ลบไม่สำเร็จ');
        toast.add({ severity: 'success', summary: 'ลบสำเร็จ', life: 3000 });
        deleteTarget.value = null;
        await loadList();
    } catch (err) {
        toast.add({ severity: 'error', summary: 'ลบไม่สำเร็จ', detail: err?.message, life: 4000 });
    }
}

const emptyMessage = computed(() => (loading.value ? 'กำลังโหลด...' : 'ยังไม่มีโปรโมชันของแถม'));

onMounted(() => {
    loadFeatureFlag();
    loadList();
});
</script>

<template>
    <div class="card">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
                <h1 class="text-xl font-semibold m-0"><i class="pi pi-gift mr-2" />จัดการโปรโมชันของแถม</h1>
                <p class="text-sm text-surface-500 m-0 mt-1">ตั้งเงื่อนไข "ซื้อครบแถม" — ของแถมจะถูกเพิ่มอัตโนมัติตอนสั่งซื้อ</p>
            </div>
            <Button icon="pi pi-plus" label="สร้างโปรโมชัน" @click="openCreate" />
        </div>

        <div class="flex items-center gap-3 p-3 mb-4 border border-surface-200 rounded-lg bg-surface-50">
            <i class="pi pi-power-off" />
            <span class="font-medium">เปิดใช้ระบบของแถมบนหน้าร้าน</span>
            <ToggleSwitch v-model="featureEnabled" :disabled="featureSaving" @change="toggleFeature" />
            <span class="text-sm text-surface-500">{{ featureEnabled ? 'เปิดอยู่' : 'ปิดอยู่ (ลูกค้าจะไม่เห็นของแถม)' }}</span>
        </div>

        <div class="flex flex-wrap items-center gap-3 mb-3">
            <IconField class="grow max-w-md">
                <InputIcon class="pi pi-search" />
                <InputText v-model="search" placeholder="ค้นหารหัส/ชื่อโปรโมชัน" class="w-full" @keyup.enter="loadList" />
            </IconField>
            <div class="flex items-center gap-2">
                <Checkbox v-model="includeInactive" :binary="true" inputId="incInactive" @change="loadList" />
                <label for="incInactive" class="text-sm">แสดงที่ปิดใช้งานด้วย</label>
            </div>
            <Button icon="pi pi-refresh" label="ค้นหา" outlined @click="loadList" />
        </div>

        <DataTable :value="rows" :loading="loading" dataKey="premium_code" paginator :rows="20" stripedRows>
            <template #empty>{{ emptyMessage }}</template>
            <Column field="premium_code" header="รหัส" style="min-width: 10rem" />
            <Column header="รูป" style="width: 5rem">
                <template #body="{ data }">
                    <img v-if="data.image_guid" :src="SalePremiumService.getImageUrl(data)" :alt="data.name_1" class="sale-premium-list-image" />
                    <span v-else class="sale-premium-list-image is-empty"><i class="pi pi-image" /></span>
                </template>
            </Column>
            <Column field="name_1" header="ชื่อโปรโมชัน" style="min-width: 14rem">
                <template #body="{ data }">
                    <div>{{ data.name_1 }}</div>
                    <div v-if="data.name_eng_1" class="text-xs text-surface-500">{{ data.name_eng_1 }}</div>
                    <!-- โปรฯ ที่หน่วยไม่ตรงกับสินค้าจะหายจากหน้าร้านเงียบๆ ต้องเตือนตรงนี้ -->
                    <div v-if="data.sellable === false" class="mt-1 inline-flex items-start gap-1 text-xs text-red-600" :title="data.unsellable_reason">
                        <i class="pi pi-exclamation-triangle mt-0.5" />
                        <span>ลูกค้ามองไม่เห็นโปรฯ นี้ — {{ data.unsellable_reason }}</span>
                    </div>
                </template>
            </Column>
            <Column header="ช่วงวันที่" style="min-width: 12rem">
                <template #body="{ data }">
                    <span class="text-sm">{{ data.date_begin || '—' }} → {{ data.date_end || '—' }}</span>
                </template>
            </Column>
            <Column header="เงื่อนไข/ของแถม" style="min-width: 9rem">
                <template #body="{ data }">
                    <span class="text-sm">ซื้อ {{ data.condition_count }} · แถม {{ data.list_count }}</span>
                </template>
            </Column>
            <Column header="สถานะ" style="min-width: 9rem">
                <template #body="{ data }">
                    <Tag v-if="Number(data.important) === 1" severity="secondary" value="ปิดใช้งาน" />
                    <Tag v-else-if="Number(data.show_on_web) === 1" severity="success" value="แสดงหน้าร้าน" />
                    <Tag v-else severity="warn" value="ซ่อนหน้าร้าน" />
                </template>
            </Column>
            <Column header="" style="width: 8rem">
                <template #body="{ data }">
                    <Button icon="pi pi-pencil" text rounded severity="info" @click="openEdit(data)" />
                    <Button icon="pi pi-trash" text rounded severity="danger" @click="deleteTarget = data" />
                </template>
            </Column>
        </DataTable>

        <!-- dialog สร้าง/แก้ไข -->
        <Dialog v-model:visible="dialogVisible" :header="isEdit ? 'แก้ไขโปรโมชัน' : 'สร้างโปรโมชัน'" modal :style="{ width: '54rem' }" :breakpoints="{ '960px': '95vw' }">
            <div class="flex flex-col gap-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm mb-1">รหัสโปรโมชัน *</label>
                        <InputText v-model="draft.premium_code" class="w-full" :disabled="isEdit" placeholder="เช่น PROMO001" />
                    </div>
                    <div>
                        <label class="block text-sm mb-1">ชื่อโปรโมชัน (ไทย) *</label>
                        <InputText v-model="draft.name_1" class="w-full" />
                    </div>
                    <div>
                        <label class="block text-sm mb-1">ชื่อโปรโมชัน (อังกฤษ)</label>
                        <InputText v-model="draft.name_eng_1" class="w-full" />
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-sm mb-1">เริ่ม</label>
                            <InputText v-model="draft.date_begin" type="date" class="w-full" />
                        </div>
                        <div>
                            <label class="block text-sm mb-1">สิ้นสุด</label>
                            <InputText v-model="draft.date_end" type="date" class="w-full" />
                        </div>
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="flex items-center gap-2">
                            <Checkbox v-model="draft.show_on_web" :binary="true" :true-value="1" :false-value="0" inputId="showWeb" />
                            <label for="showWeb" class="text-sm">แสดงบนหน้าร้าน</label>
                        </div>
                        <div class="flex items-center gap-2">
                            <Checkbox v-model="draft.important" :binary="true" :true-value="1" :false-value="0" inputId="disabled" />
                            <label for="disabled" class="text-sm">ปิดใช้งาน</label>
                        </div>
                    </div>
                    <div class="md:col-span-2">
                        <label class="block text-sm mb-1">รูปโปรโมชัน</label>
                        <input ref="imageFileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" @change="selectImage" />
                        <div class="sale-premium-image-editor">
                            <div class="sale-premium-image-preview">
                                <img v-if="draft.image_preview" :src="draft.image_preview" :alt="draft.name_1 || 'รูปโปรโมชัน'" />
                                <div v-else class="sale-premium-image-empty"><i class="pi pi-image" /><span>ยังไม่มีรูป</span></div>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <Button label="เลือกรูปภาพ" icon="pi pi-upload" size="small" outlined @click="chooseImage" />
                                <Button v-if="draft.image_preview" label="ล้างรูป" icon="pi pi-trash" size="small" text severity="danger" @click="clearImage" />
                            </div>
                            <small class="text-surface-500">รองรับ JPG, PNG, WEBP, GIF ขนาดไม่เกิน 8MB</small>
                        </div>
                    </div>
                </div>

                <!-- เงื่อนไข -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="text-base font-semibold m-0">เงื่อนไข: ต้องซื้อ (ครบทุกรายการ)</h3>
                        <Button icon="pi pi-plus" label="เพิ่มรายการ" size="small" text @click="addLine('conditions')" />
                    </div>
                    <div v-for="(line, idx) in draft.conditions" :key="'c' + idx" class="flex flex-wrap items-end gap-2 mb-2">
                        <div class="grow min-w-[14rem]">
                            <InputGroup>
                                <InputText :value="line.ic_code ? `${line.ic_code} — ${line.ic_name}` : ''" readonly placeholder="เลือกสินค้า" />
                                <Button icon="pi pi-search" @click="openPicker('conditions', idx)" />
                            </InputGroup>
                        </div>
                        <div class="w-32">
                            <Select v-model="line.unit_code" :options="line.unit_options" optionLabel="unit_name" optionValue="code" placeholder="หน่วย" class="w-full" />
                        </div>
                        <div class="w-24">
                            <InputNumber v-model="line.qty" :min="1" class="w-full" inputClass="w-full" />
                        </div>
                        <Button icon="pi pi-trash" text rounded severity="danger" @click="removeLine('conditions', idx)" />
                    </div>
                </div>

                <!-- ของแถม -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="text-base font-semibold m-0"><i class="pi pi-gift mr-1" />ของแถมที่ได้รับ</h3>
                        <Button icon="pi pi-plus" label="เพิ่มของแถม" size="small" text @click="addLine('lists')" />
                    </div>
                    <div v-for="(line, idx) in draft.lists" :key="'f' + idx" class="flex flex-wrap items-end gap-2 mb-2">
                        <div class="grow min-w-[14rem]">
                            <InputGroup>
                                <InputText :value="line.ic_code ? `${line.ic_code} — ${line.ic_name}` : ''" readonly placeholder="เลือกสินค้า" />
                                <Button icon="pi pi-search" @click="openPicker('lists', idx)" />
                            </InputGroup>
                        </div>
                        <div class="w-32">
                            <Select v-model="line.unit_code" :options="line.unit_options" optionLabel="unit_name" optionValue="code" placeholder="หน่วย" class="w-full" />
                        </div>
                        <div class="w-24">
                            <InputNumber v-model="line.qty" :min="1" class="w-full" inputClass="w-full" />
                        </div>
                        <Button icon="pi pi-trash" text rounded severity="danger" @click="removeLine('lists', idx)" />
                    </div>
                </div>
            </div>

            <template #footer>
                <Button label="ยกเลิก" text @click="dialogVisible = false" />
                <Button label="บันทึก" icon="pi pi-check" :loading="saving" @click="save" />
            </template>
        </Dialog>

        <!-- product picker -->
        <Dialog v-model:visible="pickerVisible" header="เลือกสินค้า" modal :style="{ width: '40rem' }" :breakpoints="{ '960px': '95vw' }">
            <IconField class="w-full mb-3">
                <InputIcon class="pi pi-search" />
                <InputText v-model="pickerSearch" placeholder="ค้นหารหัส/ชื่อ/บาร์โค้ด" class="w-full" @keyup.enter="searchPickerProducts" />
            </IconField>
            <DataTable :value="pickerRows" :loading="pickerLoading" scrollable scrollHeight="24rem" dataKey="code" @row-click="(e) => selectProduct(e.data)" :rowHover="true">
                <template #empty>{{ pickerLoading ? 'กำลังค้นหา...' : 'ไม่พบสินค้า' }}</template>
                <Column field="code" header="รหัส" style="min-width: 8rem" />
                <Column field="name_1" header="ชื่อ" style="min-width: 14rem" />
                <Column field="unit_standard" header="หน่วย" style="min-width: 6rem" />
            </DataTable>
        </Dialog>

        <!-- delete confirm -->
        <Dialog :visible="!!deleteTarget" header="ยืนยันการลบ" modal :style="{ width: '28rem' }" @update:visible="(v) => { if (!v) deleteTarget = null; }">
            <p>ลบโปรโมชัน <strong>{{ deleteTarget?.premium_code }}</strong> ({{ deleteTarget?.name_1 }}) ?</p>
            <template #footer>
                <Button label="ยกเลิก" text @click="deleteTarget = null" />
                <Button label="ลบ" icon="pi pi-trash" severity="danger" @click="confirmDelete" />
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
.sale-premium-list-image {
    width: 3.25rem;
    height: 3.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    object-fit: contain;
    border: 1px solid var(--surface-border);
    border-radius: 0.5rem;
    background: var(--surface-50);
}

.sale-premium-list-image.is-empty {
    color: var(--surface-400);
}

.sale-premium-image-editor {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--surface-border);
    border-radius: 0.75rem;
    background: var(--surface-50);
}

.sale-premium-image-preview {
    width: 7rem;
    height: 7rem;
    flex: 0 0 auto;
    overflow: hidden;
    border: 1px solid var(--surface-border);
    border-radius: 0.65rem;
    background: white;
}

.sale-premium-image-preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.sale-premium-image-empty {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    color: var(--surface-400);
    font-size: 0.75rem;
}
</style>
