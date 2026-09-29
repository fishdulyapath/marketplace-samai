<script setup>
import { exportProductData, getProductImportTemplate, importProductData, verifyProductImportData } from '@/services/productManageService';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Message from 'primevue/message';
import ProgressBar from 'primevue/progressbar';
import Textarea from 'primevue/textarea';
import { useToast } from 'primevue/usetoast';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const toast = useToast();

const csvText = ref('');
const selectedFileName = ref('');
const validation = ref(null);
const isReadingFile = ref(false);
const isExporting = ref(false);
const isDownloadingTemplate = ref(false);
const isVerifying = ref(false);
const isImporting = ref(false);

const isBusy = computed(() => isReadingFile.value || isExporting.value || isDownloadingTemplate.value || isVerifying.value || isImporting.value);
const canVerify = computed(() => !isBusy.value && csvText.value.trim().length > 0);
const canImport = computed(() => !isBusy.value && validation.value?.success && csvText.value.trim().length > 0);
const previewRows = computed(() => validation.value?.preview || []);
const errorRows = computed(() => validation.value?.errors || []);
const warningRows = computed(() => validation.value?.warnings || []);
const updateFieldsText = computed(() => (validation.value?.update_fields || []).join(', ') || '-');

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function makeDateStamp() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function downloadExport() {
    if (isBusy.value) return;
    isExporting.value = true;
    try {
        const blob = await exportProductData();
        downloadBlob(blob, `product-export-${makeDateStamp()}.csv`);
        toast.add({ severity: 'success', summary: 'ดาวน์โหลดข้อมูลสินค้าแล้ว', life: 2500 });
    } catch (error) {
        toast.add({ severity: 'error', summary: 'Export ไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    } finally {
        isExporting.value = false;
    }
}

async function downloadTemplate() {
    if (isBusy.value) return;
    isDownloadingTemplate.value = true;
    try {
        const blob = await getProductImportTemplate();
        downloadBlob(blob, 'product-import-template.csv');
        toast.add({ severity: 'success', summary: 'ดาวน์โหลด template แล้ว', life: 2500 });
    } catch (error) {
        toast.add({ severity: 'error', summary: 'ดาวน์โหลด template ไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    } finally {
        isDownloadingTemplate.value = false;
    }
}

function onFileSelected(event) {
    const file = event.target.files?.[0];
    validation.value = null;
    if (!file) return;

    selectedFileName.value = file.name;
    isReadingFile.value = true;
    const reader = new FileReader();
    reader.onload = () => {
        csvText.value = String(reader.result || '');
        isReadingFile.value = false;
        toast.add({ severity: 'info', summary: 'โหลดไฟล์แล้ว', detail: `${file.name} (${file.size.toLocaleString()} bytes)`, life: 2500 });
    };
    reader.onerror = () => {
        isReadingFile.value = false;
        toast.add({ severity: 'error', summary: 'อ่านไฟล์ไม่สำเร็จ', detail: reader.error?.message || '', life: 3500 });
    };
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
}

function clearImportData() {
    csvText.value = '';
    selectedFileName.value = '';
    validation.value = null;
}

async function verifyImport() {
    if (!canVerify.value) return;
    validation.value = null;
    isVerifying.value = true;
    try {
        const response = await verifyProductImportData(csvText.value);
        validation.value = response.data || null;
        if (validation.value?.success) {
            toast.add({ severity: 'success', summary: 'ข้อมูลผ่านการตรวจสอบ', detail: `พร้อมนำเข้า ${validation.value.valid_rows || 0} รายการ`, life: 3000 });
        } else {
            toast.add({ severity: 'warn', summary: 'ข้อมูลยังไม่ถูกต้อง', detail: `พบปัญหา ${validation.value?.errors?.length || 0} รายการ`, life: 3500 });
        }
    } catch (error) {
        validation.value = error?.response?.data?.data || null;
        toast.add({ severity: 'error', summary: 'ตรวจสอบข้อมูลไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    } finally {
        isVerifying.value = false;
    }
}

async function runImport() {
    if (!canImport.value) return;
    isImporting.value = true;
    try {
        const response = await importProductData(csvText.value);
        const importedRows = response.data?.imported_rows || 0;
        toast.add({ severity: 'success', summary: 'นำเข้าสินค้าเรียบร้อย', detail: `อัปเดต ${importedRows.toLocaleString()} รายการ`, life: 3500 });
        validation.value = {
            ...validation.value,
            imported_rows: importedRows
        };
    } catch (error) {
        validation.value = error?.response?.data?.data || validation.value;
        toast.add({ severity: 'error', summary: 'Import ไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 4000 });
    } finally {
        isImporting.value = false;
    }
}
</script>

<template>
    <main class="product-transfer-page">
        <header class="transfer-header">
            <Button icon="pi pi-arrow-left" text rounded severity="secondary" aria-label="กลับหน้าจัดการหลังบ้าน" :disabled="isBusy" @click="router.push('/admin')" />
            <div>
                <p>PRODUCT DATA</p>
                <h1>Export / Import ข้อมูลสินค้า</h1>
                <span>อัปเดตข้อมูลสินค้าและค่า Marketplace จำนวนมากผ่านไฟล์ CSV โดยตรวจสอบก่อนนำเข้าจริง</span>
            </div>
        </header>

        <section class="transfer-layout">
            <section class="transfer-panel">
                <div class="panel-title-row">
                    <div>
                        <h2>Export ข้อมูลสินค้า</h2>
                        <span>ดาวน์โหลดข้อมูลจาก ic_inventory และ ic_inventory_detail เพื่อแก้ไขในไฟล์ CSV</span>
                    </div>
                </div>

                <div class="export-actions">
                    <Button label="ดาวน์โหลดข้อมูลสินค้า" icon="pi pi-download" :loading="isExporting" :disabled="isBusy" @click="downloadExport" />
                    <Button label="ดาวน์โหลด Template" icon="pi pi-file" outlined :loading="isDownloadingTemplate" :disabled="isBusy" @click="downloadTemplate" />
                </div>

                <Message severity="info" :closable="false">
                    เฟสแรกจะรองรับการอัปเดตสินค้าที่มีอยู่แล้วเท่านั้น ถ้ารหัสสินค้าไม่มีในระบบ การตรวจสอบจะแจ้ง error และไม่ให้นำเข้า
                </Message>
            </section>

            <section class="transfer-panel">
                <div class="panel-title-row">
                    <div>
                        <h2>Import ข้อมูลสินค้า</h2>
                        <span>เลือกไฟล์ CSV แล้วกดตรวจสอบก่อน ระบบจะยังไม่บันทึกจนกว่าจะกดนำเข้า</span>
                    </div>
                </div>

                <div class="import-toolbar">
                    <label class="file-picker">
                        <input type="file" accept=".csv,text/csv" :disabled="isBusy" @change="onFileSelected" />
                        <i class="pi pi-upload"></i>
                        <span>เลือกไฟล์ CSV</span>
                    </label>
                    <span class="file-name">{{ selectedFileName || 'ยังไม่ได้เลือกไฟล์' }}</span>
                    <Button label="ล้างข้อมูล" icon="pi pi-times" severity="secondary" outlined :disabled="isBusy || !csvText" @click="clearImportData" />
                </div>

                <Textarea v-model="csvText" class="csv-input" rows="8" placeholder="วางข้อมูล CSV ที่นี่ หรือเลือกไฟล์ CSV ด้านบน" :disabled="isBusy" @update:modelValue="validation = null" />

                <div v-if="isBusy" class="busy-row">
                    <ProgressBar mode="indeterminate" style="height: 6px" />
                </div>

                <div class="import-actions">
                    <Button label="ตรวจสอบข้อมูล" icon="pi pi-check-circle" outlined :loading="isVerifying" :disabled="!canVerify" @click="verifyImport" />
                    <Button label="นำเข้าข้อมูล" icon="pi pi-database" :loading="isImporting" :disabled="!canImport" @click="runImport" />
                </div>
            </section>
        </section>

        <section v-if="validation" class="transfer-panel result-panel">
            <div class="panel-title-row">
                <div>
                    <h2>ผลการตรวจสอบ</h2>
                    <span>คอลัมน์ที่จะอัปเดต: {{ updateFieldsText }}</span>
                </div>
                <strong :class="['result-state', validation.success ? 'pass' : 'fail']">{{ validation.success ? 'พร้อมนำเข้า' : 'ต้องแก้ไขก่อน' }}</strong>
            </div>

            <div class="summary-grid">
                <div>
                    <span>แถวทั้งหมด</span>
                    <strong>{{ (validation.total_rows || 0).toLocaleString() }}</strong>
                </div>
                <div>
                    <span>พร้อมนำเข้า</span>
                    <strong>{{ (validation.valid_rows || 0).toLocaleString() }}</strong>
                </div>
                <div>
                    <span>Error</span>
                    <strong>{{ errorRows.length.toLocaleString() }}</strong>
                </div>
                <div>
                    <span>นำเข้าแล้ว</span>
                    <strong>{{ (validation.imported_rows || 0).toLocaleString() }}</strong>
                </div>
            </div>

            <Message v-for="warning in warningRows" :key="warning" severity="warn" :closable="false">{{ warning }}</Message>

            <DataTable v-if="errorRows.length" :value="errorRows" stripedRows scrollable class="result-table">
                <Column field="row_no" header="แถว" style="width: 90px" />
                <Column field="code" header="รหัสสินค้า" style="min-width: 140px" />
                <Column field="field" header="คอลัมน์" style="min-width: 140px" />
                <Column field="message" header="ปัญหา" style="min-width: 320px" />
            </DataTable>

            <DataTable v-else-if="previewRows.length" :value="previewRows" stripedRows scrollable class="result-table">
                <Column field="_row_no" header="แถว" style="width: 90px" />
                <Column field="code" header="รหัสสินค้า" style="min-width: 140px" />
                <Column v-for="field in validation.update_fields" :key="field" :field="field" :header="field" style="min-width: 160px" />
            </DataTable>
        </section>
    </main>
</template>

<style scoped>
.product-transfer-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 2rem);
    background: linear-gradient(180deg, var(--market-card-bg, #fff) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #243142);
}

.transfer-header {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    max-width: 1180px;
    margin: 0 auto 1rem;
}

.transfer-header p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 0.08em;
}

.transfer-header h1 {
    margin: 0.2rem 0;
    font-size: clamp(1.45rem, 3vw, 2.1rem);
}

.transfer-header span,
.panel-title-row span {
    color: var(--market-muted, #64748b);
}

.transfer-layout {
    display: grid;
    grid-template-columns: minmax(280px, 0.8fr) minmax(360px, 1.2fr);
    gap: 1rem;
    max-width: 1180px;
    margin: 0 auto;
}

.transfer-panel {
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 0.9rem;
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

.export-actions,
.import-actions,
.import-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin-bottom: 0.9rem;
}

.file-picker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.65rem;
    border: 1px solid var(--market-primary, #0f9f6e);
    border-radius: 0.55rem;
    padding: 0.55rem 0.85rem;
    background: var(--market-primary, #0f9f6e);
    color: #fff;
    cursor: pointer;
    font-weight: 700;
}

.file-picker input {
    display: none;
}

.file-picker:has(input:disabled) {
    cursor: wait;
    opacity: 0.65;
}

.file-name {
    color: var(--market-muted, #64748b);
    font-size: 0.88rem;
}

.csv-input {
    width: 100%;
    font-family: Consolas, Monaco, monospace;
    font-size: 0.86rem;
}

.busy-row {
    margin: 0.75rem 0;
}

.result-panel {
    max-width: 1180px;
    margin: 1rem auto 0;
}

.result-state {
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    font-size: 0.82rem;
}

.result-state.pass {
    background: #dcfce7;
    color: #047857;
}

.result-state.fail {
    background: #fee2e2;
    color: #b91c1c;
}

.summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
}

.summary-grid div {
    display: grid;
    gap: 0.2rem;
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 0.75rem;
    padding: 0.8rem;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 92%, var(--market-primary, #0f9f6e) 8%);
}

.summary-grid span {
    color: var(--market-muted, #64748b);
    font-size: 0.78rem;
}

.summary-grid strong {
    font-size: 1.2rem;
}

.result-table {
    margin-top: 0.75rem;
}

@media (max-width: 860px) {
    .transfer-layout,
    .summary-grid {
        grid-template-columns: 1fr;
    }

    .export-actions,
    .import-actions,
    .import-toolbar,
    .panel-title-row {
        align-items: stretch;
        flex-direction: column;
    }

    .transfer-panel :deep(.p-button),
    .file-picker {
        width: 100%;
    }
}
</style>
