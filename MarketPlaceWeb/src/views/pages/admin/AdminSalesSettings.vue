<script setup>
import SalesSettingsService from '@/services/SalesSettingsService';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const toast = useToast();
const confirm = useConfirm();
const FEATURE_PRODUCT_SEARCH_DEBOUNCE_MS = 2000;
const PREORDER_PRODUCT_SEARCH_DEBOUNCE_MS = 2000;
let featureProductSearchTimer = null;
let preorderProductSearchTimer = null;

const settings = ref({
    stock_display_percent: 100,
    doc_history_mode: 'all',
    preorder_default_enabled: 0,
    product_name_display_mode: 'name_1',
    sales_display_mode: '0',
    sales_star_thresholds: '100,500,1000,5000',
    // เลขที่เอกสารคำสั่งซื้อ (REQ4)
    order_doc_source: 'client',
    order_doc_pattern: 'BSWYYMMDD####',
    cancel_doc_pattern: 'BSCYYMMDD####',
    erp_max_lines_per_doc: 0
});
const featuredProducts = ref([]);
const productPreorderRows = ref([]);
const activeSettingsTab = ref('general');
const activeFeatureType = ref('recommend');
const activePreorderFilter = ref('all');
const featuredListSearchText = ref('');
const preorderSearchText = ref('');
const productOptions = ref([]);
const selectedProductCode = ref('');
const selectedFeatureProduct = ref(null);
const selectedPreorderProductCode = ref('');
const selectedPreorderMode = ref('default');
const featureDialogVisible = ref(false);
const featureDialogMode = ref('create');
const featureForm = ref({
    from_date: '',
    to_date: '',
    line_number: 0,
    status: 1,
    note: ''
});
const isLoading = ref(false);
const isSavingSettings = ref(false);
const isSearchingProducts = ref(false);
const isLoadingFeatured = ref(false);
const isLoadingProductPreorder = ref(false);
const isSavingProductPreorder = ref(false);
const isSavingFeature = ref(false);
const deletingKey = ref('');
const loadedFeatureTypes = ref({ recommend: false, new: false });
const productPreorderUnavailable = ref(false);
const productPreorderUnavailableMessage = ref('');
const isSalesSettingsBusy = computed(
    () =>
        isLoading.value ||
        isSavingSettings.value ||
        isSearchingProducts.value ||
        isLoadingFeatured.value ||
        isLoadingProductPreorder.value ||
        isSavingProductPreorder.value ||
        isSavingFeature.value ||
        Boolean(deletingKey.value)
);

const featureTypes = [
    { value: 'recommend', label: 'สินค้าแนะนำ' },
    { value: 'new', label: 'สินค้าใหม่' }
];
const settingsTabs = [
    { value: 'general', label: 'ตั้งค่าทั่วไป', icon: 'pi pi-sliders-h' },
    { value: 'preorder', label: 'Preorder รายสินค้า', icon: 'pi pi-clock' },
    { value: 'featured', label: 'สินค้าใหม่/แนะนำ', icon: 'pi pi-star' }
];
const preorderFilterOptions = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'enabled', label: 'เปิดรายตัว' },
    { value: 'disabled', label: 'ปิดรายตัว' },
    { value: 'default', label: 'ตาม default' }
];
const docHistoryOptions = [
    { value: 'marketplace_only', label: 'ดูเฉพาะเอกสารใน Marketplace' },
    { value: 'all', label: 'ดูเอกสารทั้งหมด' }
];
const orderDocSourceOptions = [
    { value: 'client', label: 'เว็บสร้างเลขเอง (แบบเดิม)' },
    { value: 'server', label: 'ระบบออกเลขให้ (แนะนำ)' }
];
const statusOptions = [
    { value: 1, label: 'เปิดใช้งาน' },
    { value: 0, label: 'ปิด' }
];
const preorderModeOptions = [
    { value: 'default', label: 'ตามค่าเริ่มต้นของระบบ' },
    { value: '1', label: 'อนุญาต Preorder' },
    { value: '0', label: 'ไม่อนุญาต Preorder' }
];
const productNameModeOptions = [
    { value: 'name_1', label: 'ชื่อสินค้า 1' },
    { value: 'name_2', label: 'ชื่อสินค้า 2' },
    { value: 'name_eng_1', label: 'ชื่ออังกฤษ 1' },
    { value: 'name_eng_2', label: 'ชื่ออังกฤษ 2' }
];
const salesDisplayModeOptions = [
    { value: '0', label: 'แสดงยอดขาย' },
    { value: '1', label: 'ไม่แสดงยอดขาย' },
    { value: '2', label: 'แสดงเป็นระดับความนิยม' }
];

const activeFeaturedRows = computed(() => featuredProducts.value.filter((item) => item.feature_type === activeFeatureType.value));
const filteredFeaturedRows = computed(() => {
    const terms = getSearchTerms(featuredListSearchText.value);
    if (!terms.length) return activeFeaturedRows.value;
    return activeFeaturedRows.value.filter((row) => matchesAllSearchTerms(getFeaturedSearchText(row), terms));
});
const activeFeatureTitle = computed(() => featureTypes.find((item) => item.value === activeFeatureType.value)?.label || '');
const selectedFeaturedRow = computed(() => activeFeaturedRows.value.find((item) => item.item_code === selectedProductCode.value) || null);
const selectedPreorderProduct = computed(() => productPreorderRows.value.find((item) => item.code === selectedPreorderProductCode.value) || null);
const docHistorySummary = computed(() => docHistoryOptions.find((item) => item.value === settings.value.doc_history_mode)?.label || '-');
const preorderDefaultSummary = computed(() => (Number(settings.value.preorder_default_enabled) === 1 ? 'เปิด Preorder เป็นค่าเริ่มต้น' : 'ปิด Preorder เป็นค่าเริ่มต้น'));
const productNameDisplaySummary = computed(() => productNameModeOptions.find((item) => item.value === settings.value.product_name_display_mode)?.label || '-');
const preorderFilterCounts = computed(() => {
    const counts = { all: productPreorderRows.value.length, enabled: 0, disabled: 0, default: 0 };
    productPreorderRows.value.forEach((row) => {
        const mode = String(row?.preorder_mode || 'default');
        if (mode === '1') counts.enabled += 1;
        else if (mode === '0') counts.disabled += 1;
        else counts.default += 1;
    });
    return counts;
});
const filteredProductPreorderRows = computed(() => {
    if (activePreorderFilter.value === 'all') return productPreorderRows.value;
    return productPreorderRows.value.filter((row) => {
        const mode = String(row?.preorder_mode || 'default');
        if (activePreorderFilter.value === 'enabled') return mode === '1';
        if (activePreorderFilter.value === 'disabled') return mode === '0';
        return mode !== '1' && mode !== '0';
    });
});
const productPreorderEffectiveText = computed(() => {
    if (!selectedPreorderProductCode.value) return '';
    const mode = String(selectedPreorderMode.value || 'default');
    if (mode === '1') return 'ผลลัพธ์: สินค้านี้เปิด Preorder';
    if (mode === '0') return 'ผลลัพธ์: สินค้านี้ปิด Preorder';
    return Number(settings.value.preorder_default_enabled) === 1
        ? 'ผลลัพธ์: ใช้ค่า default ระบบ = เปิด Preorder'
        : 'ผลลัพธ์: ใช้ค่า default ระบบ = ปิด Preorder';
});
const featureSaveModeText = computed(() => {
    if (!selectedProductCode.value) return '';
    if (selectedFeaturedRow.value) return `รายการนี้มีอยู่แล้วใน${activeFeatureTitle.value} การบันทึกครั้งนี้จะอัปเดตช่วงเวลา ลำดับ สถานะ และหมายเหตุ`;
    return `กำลังเพิ่มสินค้านี้เป็น${activeFeatureTitle.value}`;
});
const featureSaveButtonLabel = computed(() => (selectedFeaturedRow.value ? 'อัปเดตรายการ' : 'บันทึกสินค้า'));
const featureDialogTitle = computed(() => `${featureDialogMode.value === 'edit' ? 'แก้ไข' : 'เพิ่ม'}${activeFeatureTitle.value}`);
const stockPercentError = computed(() => {
    const value = Number(settings.value.stock_display_percent);
    if (!Number.isFinite(value)) return 'กรุณาระบุเปอร์เซ็นต์สต๊อกที่แสดง';
    if (value < 0 || value > 100) return 'เปอร์เซ็นต์สต๊อกต้องอยู่ระหว่าง 0 ถึง 100';
    return '';
});
const stockPercentWarning = computed(() => {
    const value = Number(settings.value.stock_display_percent);
    if (!Number.isFinite(value) || stockPercentError.value) return '';
    if (value === 0) return 'สต๊อกบนหน้าเว็บจะเป็น 0 ทุกสินค้า ลูกค้าจะสั่งได้เฉพาะสินค้าที่เปิด Preorder';
    if (value < 50) return `หน้าเว็บจะแสดงสต๊อกเพียง ${value}% ของสต๊อกจริง อาจทำให้สินค้าดูใกล้หมดเร็วกว่าปกติ`;
    return '';
});
const preorderDefaultWarning = computed(() => {
    if (Number(settings.value.preorder_default_enabled) === 1) {
        return 'สินค้าที่ยังไม่ได้กำหนดรายตัวจะสั่งเกินสต๊อกได้ ระบบจะแยกเป็นใบ Preorder ตอนยืนยันคำสั่งซื้อ';
    }
    return 'สินค้าที่ต้องการให้สั่งเกินสต๊อกได้ ต้องเปิด Preorder ที่หน้าสินค้ารายตัว';
});
const featureDateError = computed(() => {
    if (!featureForm.value.from_date || !featureForm.value.to_date) return '';
    return featureForm.value.to_date < featureForm.value.from_date ? 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม' : '';
});
const featureLineNumberError = computed(() => {
    const value = Number(featureForm.value.line_number ?? 0);
    if (!Number.isFinite(value) || value < 0) return 'ลำดับต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป';
    return '';
});
function parseSalesStarThresholds(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => Number(item));
}
// รูปแบบเลขที่เอกสาร (REQ4) — ต้องตรงกับที่ server ตรวจใน setOrderDocPattern
// # คือช่องเลขรัน ต้องอยู่ท้ายสุดเป็นก้อนเดียว · YY/MM/DD จะถูกแทนด้วยวันที่ตอนออกเลข
const DOC_PATTERN_RE = /^[A-Za-z0-9]*#{1,8}$/;

function docPatternMessage(value, label) {
    const text = String(value || '').trim().toUpperCase();
    if (!text) return `กรุณาระบุ${label}`;
    if (text.length > 30) return `${label}ยาวเกินไป`;
    if (!DOC_PATTERN_RE.test(text)) return `${label}ต้องเป็นตัวอักษร/ตัวเลข แล้วตามด้วย # 1-8 ตัวท้ายสุด เช่น BSWYYMMDD####`;
    return '';
}

const docPatternError = computed(
    () => docPatternMessage(settings.value.order_doc_pattern, 'รูปแบบเลขที่คำสั่งซื้อ')
        || docPatternMessage(settings.value.cancel_doc_pattern, 'รูปแบบเลขที่ใบยกเลิก')
);

// ตัวอย่างเลขที่จะได้จริง ช่วยให้แอดมินเห็นผลก่อนบันทึก
function previewDocNo(pattern) {
    const text = String(pattern || '').trim().toUpperCase();
    if (docPatternMessage(text, 'x')) return '-';
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const runLen = (text.match(/#/g) || []).length;
    return text
        .replace(/YYYY/g, yyyy)
        .replace(/YY/g, yyyy.slice(2))
        .replace(/MM/g, mm)
        .replace(/DD/g, dd)
        .replace(/#+$/, '1'.padStart(runLen, '0'));
}

const orderDocPreview = computed(() => previewDocNo(settings.value.order_doc_pattern));
const cancelDocPreview = computed(() => previewDocNo(settings.value.cancel_doc_pattern));
const isServerDocNo = computed(() => settings.value.order_doc_source === 'server');

const salesStarThresholdError = computed(() => {
    const values = parseSalesStarThresholds(settings.value.sales_star_thresholds);
    if (values.length !== 4) return 'กรุณาระบุช่วงดาว 4 ค่า เช่น 100,500,1000,5000';
    if (values.some((item) => !Number.isFinite(item) || item <= 0)) return 'ช่วงดาวต้องเป็นตัวเลขมากกว่า 0';
    for (let index = 1; index < values.length; index += 1) {
        if (values[index] <= values[index - 1]) return 'ช่วงดาวต้องเรียงจากน้อยไปมาก';
    }
    return '';
});
const canSaveSettings = computed(() => !isLoading.value && !isSavingSettings.value && !stockPercentError.value && !salesStarThresholdError.value);
const isProductPreorderEditorDisabled = computed(() => isLoadingProductPreorder.value || isSavingProductPreorder.value || productPreorderUnavailable.value);
const canSaveProductPreorder = computed(() => !isProductPreorderEditorDisabled.value && Boolean(selectedPreorderProductCode.value));
const canSaveFeaturedProduct = computed(() => !isSearchingProducts.value && !isSavingFeature.value && Boolean(selectedProductCode.value) && !featureDateError.value && !featureLineNumberError.value);

watch(selectedPreorderProductCode, (code) => {
    const row = productPreorderRows.value.find((item) => item.code === code);
    if (row) selectedPreorderMode.value = row.preorder_mode || 'default';
});

watch(activeSettingsTab, (tab) => {
    if (tab === 'featured') {
        loadFeaturedProducts(activeFeatureType.value);
    }
});

watch(activeFeatureType, (featureType) => {
    featuredListSearchText.value = '';
    if (featureDialogVisible.value && !isSavingFeature.value) closeFeatureDialog();
    if (activeSettingsTab.value === 'featured') {
        loadFeaturedProducts(featureType);
    }
});

function productLabel(product) {
    if (!product) return '';
    return `${product.code} - ${product.name_1 || product.name_2 || product.name_eng_1 || ''}`.trim();
}

function getFeaturedSearchText(row) {
    return [row?.item_code, row?.name_1, row?.name_2, row?.name_eng_1, row?.name_eng_2, row?.unit_standard, row?.note, row?.line_number, rowStatus(row).text].filter(Boolean).join(' ').toLowerCase();
}

function getSearchTerms(value, maxTerms = 8) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, maxTerms);
}

function matchesAllSearchTerms(searchText, terms) {
    const text = String(searchText || '').toLowerCase();
    return terms.every((term) => text.includes(term));
}

function isSetProduct(product) {
    return String(product?.item_type || '') === '3';
}

function productTypeLabel(product) {
    return isSetProduct(product) ? 'สินค้าชุด' : 'สินค้าปกติ';
}

function productTypeClass(product) {
    return isSetProduct(product) ? 'is-set' : 'is-normal';
}

function preorderRowClass(row) {
    return row?.code === selectedPreorderProductCode.value ? 'selected-preorder-row' : '';
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function rowStatus(row) {
    if (Number(row.status) !== 1) return { text: 'ปิด', className: 'inactive' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (row.from_date && new Date(row.from_date) > today) return { text: 'รอเริ่ม', className: 'pending' };
    if (row.to_date && new Date(row.to_date) < today) return { text: 'หมดเวลา', className: 'expired' };
    return { text: 'แสดงผล', className: 'active' };
}

function preorderStatus(row) {
    const mode = String(row?.preorder_mode || 'default');
    if (mode === '1') return { text: 'เปิดรายตัว', className: 'active' };
    if (mode === '0') return { text: 'ปิดรายตัว', className: 'inactive' };
    return Number(row?.preorder_allowed || 0) === 1
        ? { text: 'ตาม default: เปิด', className: 'pending' }
        : { text: 'ตาม default: ปิด', className: 'inactive' };
}

function isEndpointNotFound(error) {
    return Number(error?.response?.status || 0) === 404;
}

function clearProductPreorderSelection() {
    productPreorderRows.value = [];
    selectedPreorderProductCode.value = '';
    selectedPreorderMode.value = 'default';
}

async function loadSettings() {
    if (isLoading.value || isSavingSettings.value) return;

    isLoading.value = true;
    try {
        const data = await SalesSettingsService.getSettings({ includeFeatured: false });
        settings.value = {
            stock_display_percent: Number(data.stock_display_percent ?? 100),
            doc_history_mode: data.doc_history_mode || 'all',
            preorder_default_enabled: Number(data.preorder_default_enabled || 0),
            product_name_display_mode: data.product_name_display_mode || 'name_1',
            sales_display_mode: String(data.sales_display_mode ?? '0'),
            sales_star_thresholds: data.sales_star_thresholds || '100,500,1000,5000',
            order_doc_source: data.order_doc_source === 'server' ? 'server' : 'client',
            order_doc_pattern: data.order_doc_pattern || 'BSWYYMMDD####',
            cancel_doc_pattern: data.cancel_doc_pattern || 'BSCYYMMDD####',
            erp_max_lines_per_doc: Number(data.erp_max_lines_per_doc || 0)
        };
    } catch (error) {
        toast.add({ severity: 'error', summary: 'โหลดตั้งค่าไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    } finally {
        isLoading.value = false;
    }
}

async function loadFeaturedProducts(featureType = activeFeatureType.value, force = false) {
    const type = featureTypes.some((item) => item.value === featureType) ? featureType : 'recommend';
    if (isLoadingFeatured.value || (!force && loadedFeatureTypes.value[type])) return;

    isLoadingFeatured.value = true;
    try {
        const rows = await SalesSettingsService.getFeaturedProducts(type);
        featuredProducts.value = [...featuredProducts.value.filter((item) => item.feature_type !== type), ...rows];
        loadedFeatureTypes.value = { ...loadedFeatureTypes.value, [type]: true };
    } catch (error) {
        toast.add({ severity: 'error', summary: `โหลด${featureTypes.find((item) => item.value === type)?.label || 'รายการสินค้า'}ไม่สำเร็จ`, detail: error?.response?.data?.message || error.message, life: 3000 });
    } finally {
        isLoadingFeatured.value = false;
    }
}

async function saveSettings() {
    if (isLoading.value || isSavingSettings.value) return;

    if (stockPercentError.value) {
        toast.add({ severity: 'warn', summary: stockPercentError.value, life: 2500 });
        return;
    }
    if (salesStarThresholdError.value) {
        toast.add({ severity: 'warn', summary: salesStarThresholdError.value, life: 2500 });
        return;
    }
    if (docPatternError.value) {
        toast.add({ severity: 'warn', summary: docPatternError.value, life: 2500 });
        return;
    }
    isSavingSettings.value = true;
    try {
        const payload = {
            ...settings.value,
            stock_display_percent: Math.max(0, Math.min(100, Math.round(Number(settings.value.stock_display_percent) * 100) / 100)),
            preorder_default_enabled: Number(settings.value.preorder_default_enabled) === 1 ? 1 : 0,
            sales_display_mode: String(settings.value.sales_display_mode ?? '0'),
            sales_star_thresholds: parseSalesStarThresholds(settings.value.sales_star_thresholds).join(','),
            order_doc_source: settings.value.order_doc_source === 'server' ? 'server' : 'client',
            order_doc_pattern: String(settings.value.order_doc_pattern || '').trim().toUpperCase(),
            cancel_doc_pattern: String(settings.value.cancel_doc_pattern || '').trim().toUpperCase(),
            erp_max_lines_per_doc: Math.max(0, Math.min(99, Math.trunc(Number(settings.value.erp_max_lines_per_doc) || 0)))
        };
        const response = await SalesSettingsService.saveSettings(payload);
        if (!response.success) throw new Error(response.message || 'บันทึกไม่สำเร็จ');
        settings.value = {
            ...settings.value,
            ...(response.data || {})
        };
        await loadProductPreorderSettings();
        toast.add({ severity: 'success', summary: 'บันทึกตั้งค่าสำเร็จ', life: 2200 });
    } catch (error) {
        toast.add({ severity: 'error', summary: 'บันทึกตั้งค่าไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    } finally {
        isSavingSettings.value = false;
    }
}

async function searchProducts(search = '') {
    if (isSearchingProducts.value) return;

    const keyword = typeof search === 'string' ? search.trim() : '';
    isSearchingProducts.value = true;
    try {
        productOptions.value = await SalesSettingsService.searchProducts(keyword, 80);
    } catch (error) {
        toast.add({ severity: 'error', summary: 'ค้นหาสินค้าไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3000 });
    } finally {
        isSearchingProducts.value = false;
    }
}

function clearFeatureProductSearchTimer() {
    if (featureProductSearchTimer) {
        clearTimeout(featureProductSearchTimer);
        featureProductSearchTimer = null;
    }
}

function completeFeatureProductSearch(event) {
    if (featureDialogMode.value === 'edit') return;
    clearFeatureProductSearchTimer();
    const query = event?.query || '';
    featureProductSearchTimer = setTimeout(() => {
        featureProductSearchTimer = null;
        searchProducts(query);
    }, FEATURE_PRODUCT_SEARCH_DEBOUNCE_MS);
}

function selectFeatureProduct(product) {
    if (!product?.code) {
        selectedProductCode.value = '';
        return;
    }
    selectedFeatureProduct.value = product;
    selectedProductCode.value = product.code;
}

function handleFeatureProductModel(value) {
    selectedFeatureProduct.value = value;
    if (value?.code) {
        selectedProductCode.value = value.code;
    } else {
        selectedProductCode.value = '';
    }
}

async function loadProductPreorderSettings(force = false) {
    if (!force && (isLoadingProductPreorder.value || isSavingProductPreorder.value)) return;

    isLoadingProductPreorder.value = true;
    productPreorderUnavailableMessage.value = '';
    try {
        productPreorderRows.value = await SalesSettingsService.getProductPreorderSettings(preorderSearchText.value.trim(), 80);
        productPreorderUnavailable.value = false;
        if (selectedPreorderProductCode.value && !productPreorderRows.value.some((item) => item.code === selectedPreorderProductCode.value)) {
            selectedPreorderProductCode.value = '';
            selectedPreorderMode.value = 'default';
        }
    } catch (error) {
        if (isEndpointNotFound(error)) {
            productPreorderUnavailable.value = true;
            productPreorderUnavailableMessage.value = 'API ตั้งค่า Preorder รายสินค้ายังไม่พร้อมบนเซิร์ฟเวอร์นี้ สามารถบันทึกตั้งค่าทั่วไปและจัดการสินค้าใหม่/สินค้าแนะนำต่อได้ตามปกติ';
            clearProductPreorderSelection();
            return;
        }
        toast.add({ severity: 'error', summary: 'ค้นหาตั้งค่า Preorder ไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3000 });
    } finally {
        isLoadingProductPreorder.value = false;
    }
}

function clearPreorderProductSearchTimer() {
    if (preorderProductSearchTimer) {
        clearTimeout(preorderProductSearchTimer);
        preorderProductSearchTimer = null;
    }
}

function searchPreorderProductsNow() {
    clearPreorderProductSearchTimer();
    loadProductPreorderSettings(true);
}

function schedulePreorderProductSearch() {
    clearPreorderProductSearchTimer();
    preorderProductSearchTimer = setTimeout(() => {
        preorderProductSearchTimer = null;
        loadProductPreorderSettings(true);
    }, PREORDER_PRODUCT_SEARCH_DEBOUNCE_MS);
}

function editProductPreorder(row) {
    if (!row?.code || isProductPreorderEditorDisabled.value) return;

    selectedPreorderProductCode.value = row.code;
    selectedPreorderMode.value = row.preorder_mode || 'default';
}

async function saveProductPreorderSetting() {
    if (isLoadingProductPreorder.value || isSavingProductPreorder.value) return;
    if (productPreorderUnavailable.value) {
        toast.add({ severity: 'warn', summary: 'ยังตั้งค่า Preorder รายสินค้าไม่ได้', detail: productPreorderUnavailableMessage.value, life: 3500 });
        return;
    }

    if (!selectedPreorderProductCode.value) {
        toast.add({ severity: 'warn', summary: 'กรุณาเลือกสินค้า', life: 2200 });
        return;
    }
    isSavingProductPreorder.value = true;
    try {
        const response = await SalesSettingsService.saveProductPreorderSetting({
            item_code: selectedPreorderProductCode.value,
            preorder_mode: selectedPreorderMode.value
        });
        if (!response.success) throw new Error(response.message || 'บันทึกไม่สำเร็จ');
        await loadProductPreorderSettings(true);
        toast.add({ severity: 'success', summary: 'บันทึก Preorder รายสินค้าแล้ว', life: 2200 });
    } catch (error) {
        toast.add({ severity: 'error', summary: 'บันทึก Preorder รายสินค้าไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    } finally {
        isSavingProductPreorder.value = false;
    }
}

function editRow(row) {
    activeFeatureType.value = row.feature_type;
    selectedProductCode.value = row.item_code;
    selectedFeatureProduct.value = { code: row.item_code, name_1: row.name_1, name_2: row.name_2, name_eng_1: row.name_eng_1 };
    if (!productOptions.value.some((item) => item.code === row.item_code)) {
        productOptions.value = [selectedFeatureProduct.value, ...productOptions.value];
    }
    featureForm.value = {
        from_date: row.from_date ? String(row.from_date).slice(0, 10) : '',
        to_date: row.to_date ? String(row.to_date).slice(0, 10) : '',
        line_number: Number(row.line_number || 0),
        status: Number(row.status) === 0 ? 0 : 1,
        note: row.note || ''
    };
}

function clearFeatureForm() {
    selectedProductCode.value = '';
    selectedFeatureProduct.value = null;
    featureForm.value = { from_date: '', to_date: '', line_number: 0, status: 1, note: '' };
}

function openFeatureDialog(mode = 'create', row = null) {
    featureDialogMode.value = mode;
    if (mode === 'edit' && row) {
        editRow(row);
    } else {
        clearFeatureForm();
    }
    featureDialogVisible.value = true;
    if (!productOptions.value.length && !isSearchingProducts.value) {
        searchProducts();
    }
}

function closeFeatureDialog() {
    if (isSavingFeature.value) return;
    clearFeatureProductSearchTimer();
    featureDialogVisible.value = false;
    clearFeatureForm();
}

async function reloadFeatured() {
    await loadFeaturedProducts(activeFeatureType.value, true);
}

async function saveFeaturedProduct() {
    if (isSearchingProducts.value || isSavingFeature.value) return;

    if (!selectedProductCode.value) {
        toast.add({ severity: 'warn', summary: 'กรุณาเลือกสินค้า', life: 2200 });
        return;
    }
    if (featureDateError.value) {
        toast.add({ severity: 'warn', summary: featureDateError.value, life: 2500 });
        return;
    }
    if (featureLineNumberError.value) {
        toast.add({ severity: 'warn', summary: featureLineNumberError.value, life: 2500 });
        return;
    }
    isSavingFeature.value = true;
    try {
        const response = await SalesSettingsService.saveFeaturedProduct({
            ...featureForm.value,
            line_number: Math.trunc(Number(featureForm.value.line_number ?? 0)),
            item_code: selectedProductCode.value,
            feature_type: activeFeatureType.value
        });
        if (!response.success) throw new Error(response.message || 'บันทึกไม่สำเร็จ');
        await reloadFeatured();
        featureDialogVisible.value = false;
        clearFeatureForm();
        toast.add({ severity: 'success', summary: 'บันทึกรายการสินค้าแล้ว', life: 2200 });
    } catch (error) {
        toast.add({ severity: 'error', summary: 'บันทึกรายการสินค้าไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    } finally {
        isSavingFeature.value = false;
    }
}

async function deleteFeaturedProduct(row) {
    const key = `${row.feature_type}:${row.item_code}`;
    if (deletingKey.value) return;

    deletingKey.value = key;
    try {
        const response = await SalesSettingsService.deleteFeaturedProduct({
            feature_type: row.feature_type,
            item_code: row.item_code
        });
        if (!response.success) throw new Error(response.message || 'ลบไม่สำเร็จ');
        await reloadFeatured();
        toast.add({ severity: 'success', summary: 'ลบรายการแล้ว', life: 1800 });
    } catch (error) {
        toast.add({ severity: 'error', summary: 'ลบรายการไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3000 });
    } finally {
        deletingKey.value = '';
    }
}

function confirmDeleteFeaturedProduct(row) {
    if (deletingKey.value) return;

    const productName = row.name_1 || row.name_2 || row.item_code;
    confirm.require({
        message: `ยืนยันลบ ${productName} ออกจาก${activeFeatureTitle.value}หรือไม่`,
        header: 'ยืนยันการลบสินค้า',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'ลบรายการ',
        rejectLabel: 'ยกเลิก',
        acceptClass: 'p-button-danger',
        accept: async () => {
            await deleteFeaturedProduct(row);
        }
    });
}

onMounted(async () => {
    await Promise.all([loadSettings(), loadProductPreorderSettings()]);
});

onBeforeUnmount(() => {
    clearFeatureProductSearchTimer();
    clearPreorderProductSearchTimer();
});
</script>

<template>
    <main class="sales-settings-page">
        <header class="page-header">
            <Button icon="pi pi-arrow-left" text rounded severity="secondary" aria-label="กลับหน้าจัดการหลังบ้าน" @click="router.push('/admin')" />
            <div>
                <p>SALES SETTINGS</p>
                <h1>จัดการตั้งค่าการขาย</h1>
                <span>กำหนดยอดสต๊อกที่แสดง สินค้าใหม่ สินค้าแนะนำ และประวัติเอกสาร</span>
            </div>
            <Button icon="pi pi-refresh" outlined aria-label="โหลดตั้งค่าทั่วไปใหม่" :loading="isLoading" :disabled="isSavingSettings" @click="loadSettings" />
        </header>

        <section class="summary-strip" aria-label="สรุปตั้งค่าการขายปัจจุบัน">
            <article class="summary-item">
                <span>สต๊อกบนเว็บ</span>
                <strong>{{ Number(settings.stock_display_percent || 0).toLocaleString('th-TH') }}%</strong>
            </article>
            <article class="summary-item">
                <span>ประวัติเอกสาร</span>
                <strong>{{ docHistorySummary }}</strong>
            </article>
            <article class="summary-item">
                <span>Preorder default</span>
                <strong>{{ preorderDefaultSummary }}</strong>
            </article>
            <article class="summary-item">
                <span>ชื่อสินค้าบนเว็บ</span>
                <strong>{{ productNameDisplaySummary }}</strong>
            </article>
        </section>

        <nav class="settings-tabs" aria-label="หมวดตั้งค่าการขาย">
            <button v-for="tab in settingsTabs" :key="tab.value" type="button" :class="['settings-tab', { active: activeSettingsTab === tab.value }]" :aria-pressed="activeSettingsTab === tab.value" @click="activeSettingsTab = tab.value">
                <i :class="tab.icon"></i>
                <span>{{ tab.label }}</span>
            </button>
        </nav>

        <section v-show="activeSettingsTab === 'general'" class="settings-grid">
            <article class="settings-card">
                <div class="card-title">
                    <i class="pi pi-box"></i>
                    <div>
                        <h2>สต๊อกที่แสดงบนเว็บ</h2>
                        <span>เช่น สต๊อกจริง 500 ตั้ง 70% จะแสดง 350</span>
                    </div>
                </div>
                <div class="field-row">
                    <label for="stock-display-percent">เปอร์เซ็นต์สต๊อกที่แสดง</label>
                    <InputNumber
                        inputId="stock-display-percent"
                        v-model="settings.stock_display_percent"
                        suffix="%"
                        :min="0"
                        :max="100"
                        :minFractionDigits="0"
                        :maxFractionDigits="2"
                        :aria-invalid="Boolean(stockPercentError)"
                        aria-describedby="stock-display-percent-feedback"
                        :disabled="isLoading || isSavingSettings"
                        class="w-full"
                    />
                    <small v-if="stockPercentError" id="stock-display-percent-feedback" class="field-error">{{ stockPercentError }}</small>
                    <small v-else-if="stockPercentWarning" id="stock-display-percent-feedback" class="field-warning">{{ stockPercentWarning }}</small>
                </div>
            </article>

            <article class="settings-card">
                <div class="card-title">
                    <i class="pi pi-file"></i>
                    <div>
                        <h2>ประวัติเอกสารลูกค้า</h2>
                        <span>บันทึกค่าที่ erp_option.wallet_bcel_mcid</span>
                    </div>
                </div>
                <div class="field-row">
                    <label for="doc-history-mode">รูปแบบการแสดงประวัติเอกสาร</label>
                    <Select inputId="doc-history-mode" v-model="settings.doc_history_mode" :options="docHistoryOptions" optionLabel="label" optionValue="value" class="w-full" aria-label="รูปแบบการแสดงประวัติเอกสาร" :disabled="isLoading || isSavingSettings" />
                </div>
            </article>

            <article class="settings-card">
                <div class="card-title">
                    <i class="pi pi-clock"></i>
                    <div>
                        <h2>Preorder เริ่มต้น</h2>
                        <span>ใช้เป็นค่า default สำหรับสินค้าที่ยังไม่ได้กำหนดรายตัว</span>
                    </div>
                </div>
                <label class="toggle-row">
                    <ToggleSwitch inputId="preorder-default-enabled" :modelValue="Number(settings.preorder_default_enabled) === 1" aria-label="ตั้งค่า Preorder เริ่มต้น" :disabled="isLoading || isSavingSettings" @update:modelValue="settings.preorder_default_enabled = $event ? 1 : 0" />
                    <span>{{ Number(settings.preorder_default_enabled) === 1 ? 'เปิดให้ preorder เป็นค่าเริ่มต้น' : 'ปิด preorder เป็นค่าเริ่มต้น' }}</span>
                </label>
                <div :class="['setting-impact-note', Number(settings.preorder_default_enabled) === 1 ? 'is-warning' : 'is-muted']">
                    <i class="pi pi-info-circle"></i>
                    <span>{{ preorderDefaultWarning }}</span>
                </div>
            </article>

            <!-- เลขที่เอกสารคำสั่งซื้อ + การแบ่งเอกสารตามข้อจำกัด ERP (REQ4) -->
            <article class="settings-card marketplace-default-card">
                <div class="card-title">
                    <i class="pi pi-hashtag"></i>
                    <div>
                        <h2>เลขที่เอกสารคำสั่งซื้อ</h2>
                        <span>ควบคุมว่าใครออกเลขเอกสาร และแบ่งเอกสารเมื่อรายการยาวเกินที่ ERP รับได้</span>
                    </div>
                </div>
                <div class="form-grid-2">
                    <div class="field-row">
                        <label for="order-doc-source">ที่มาของเลขที่เอกสาร</label>
                        <Select inputId="order-doc-source" v-model="settings.order_doc_source" :options="orderDocSourceOptions" optionLabel="label" optionValue="value" class="w-full" aria-label="ที่มาของเลขที่เอกสารคำสั่งซื้อ" :disabled="isLoading || isSavingSettings" />
                        <small class="field-warning">
                            {{ isServerDocNo ? 'ระบบออกเลขรันเรียงตามวัน กันเลขซ้ำและกันกดยืนยันซ้ำได้' : 'เว็บสุ่มเลขเอง (MQT...) ยังใช้ได้แต่กันเลขซ้ำไม่ได้' }}
                        </small>
                    </div>
                    <div class="field-row">
                        <label for="erp-max-lines">จำนวนบรรทัดสูงสุดต่อเอกสาร</label>
                        <InputNumber inputId="erp-max-lines" v-model="settings.erp_max_lines_per_doc" :min="0" :max="99" :useGrouping="false" class="w-full" :disabled="isLoading || isSavingSettings || !isServerDocNo" />
                        <small v-if="!isServerDocNo" class="field-warning">ต้องเลือก "ระบบออกเลขให้" ก่อนจึงจะแบ่งเอกสารได้</small>
                        <small v-else-if="Number(settings.erp_max_lines_per_doc) > 0" class="field-warning">
                            เกิน {{ settings.erp_max_lines_per_doc }} บรรทัดจะแบ่งเป็นเอกสารย่อย -1 -2 -3 โดยลูกค้าเห็นเลขหลักเลขเดียว
                        </small>
                        <small v-else class="field-warning">0 = ไม่แบ่งเอกสาร (ปิดการทำงาน)</small>
                    </div>
                    <div class="field-row">
                        <label for="order-doc-pattern">รูปแบบเลขที่คำสั่งซื้อ</label>
                        <InputText id="order-doc-pattern" v-model="settings.order_doc_pattern" placeholder="BSWYYMMDD####" class="w-full" :disabled="isLoading || isSavingSettings || !isServerDocNo" />
                        <small class="field-warning">ตัวอย่างที่จะได้: {{ orderDocPreview }}</small>
                    </div>
                    <div class="field-row">
                        <label for="cancel-doc-pattern">รูปแบบเลขที่ใบยกเลิก</label>
                        <InputText id="cancel-doc-pattern" v-model="settings.cancel_doc_pattern" placeholder="BSCYYMMDD####" class="w-full" :disabled="isLoading || isSavingSettings" />
                        <small class="field-warning">ตัวอย่างที่จะได้: {{ cancelDocPreview }}</small>
                    </div>
                    <div class="field-row span-2">
                        <small v-if="docPatternError" class="field-error">{{ docPatternError }}</small>
                        <div :class="['setting-impact-note', isServerDocNo ? 'is-warning' : 'is-muted']">
                            <i class="pi pi-info-circle"></i>
                            <span>
                                YY/MM/DD = วันที่ · # = เลขรัน (รีเซ็ตทุกวัน) ต้องอยู่ท้ายสุด ·
                                เอกสารที่ออกไปแล้วไม่เปลี่ยนตาม การแก้มีผลกับเอกสารใบถัดไปเท่านั้น
                            </span>
                        </div>
                    </div>
                </div>
            </article>

            <article class="settings-card marketplace-default-card">
                <div class="card-title">
                    <i class="pi pi-globe"></i>
                    <div>
                        <h2>ตั้งค่า Marketplace เริ่มต้น</h2>
                        <span>ใช้กับสินค้าที่ยังไม่ได้กำหนดรายตัว โดยรายสินค้าจะมีสิทธิ์มากกว่าค่าระบบ</span>
                    </div>
                </div>
                <div class="form-grid-2">
                    <div class="field-row">
                        <label for="product-name-display-mode">ชื่อสินค้าที่แสดง</label>
                        <Select inputId="product-name-display-mode" v-model="settings.product_name_display_mode" :options="productNameModeOptions" optionLabel="label" optionValue="value" class="w-full" aria-label="ชื่อสินค้าที่แสดงเป็นค่าเริ่มต้นของระบบ" :disabled="isLoading || isSavingSettings" />
                    </div>
                    <div class="field-row">
                        <label for="sales-display-mode">การแสดงยอดขายเริ่มต้น</label>
                        <Select inputId="sales-display-mode" v-model="settings.sales_display_mode" :options="salesDisplayModeOptions" optionLabel="label" optionValue="value" class="w-full" aria-label="การแสดงยอดขายเริ่มต้นของระบบ" :disabled="isLoading || isSavingSettings" />
                    </div>
                    <div class="field-row span-2">
                        <label for="sales-star-thresholds">ช่วงระดับดาว</label>
                        <InputText id="sales-star-thresholds" v-model="settings.sales_star_thresholds" placeholder="100,500,1000,5000" aria-label="ช่วงระดับดาวเริ่มต้นของระบบ" :aria-invalid="Boolean(salesStarThresholdError)" aria-describedby="sales-star-thresholds-feedback" class="w-full" :disabled="isLoading || isSavingSettings" />
                        <small v-if="salesStarThresholdError" id="sales-star-thresholds-feedback" class="field-error">{{ salesStarThresholdError }}</small>
                        <small v-else id="sales-star-thresholds-feedback" class="field-warning">ตัวอย่าง: 1-100 ได้ 1 ดาว, 101-500 ได้ 2 ดาว ตามค่าที่กำหนด</small>
                    </div>
                </div>
            </article>
        </section>

        <div v-show="activeSettingsTab === 'general'" class="save-band">
            <Button label="บันทึกตั้งค่าทั่วไป" icon="pi pi-save" :loading="isSavingSettings" :disabled="!canSaveSettings" @click="saveSettings" />
        </div>

        <section v-show="activeSettingsTab === 'preorder'" class="featured-section preorder-section">
            <div class="featured-head">
                <div>
                    <p>PRODUCT PREORDER</p>
                    <h2>ตั้งค่า Preorder รายสินค้า</h2>
                </div>
                <Button icon="pi pi-refresh" outlined aria-label="โหลดรายการตั้งค่า Preorder ใหม่" :loading="isLoadingProductPreorder" :disabled="isSavingProductPreorder" @click="searchPreorderProductsNow" />
            </div>
            <div v-if="productPreorderUnavailable" class="preorder-unavailable-note" role="status">
                <i class="pi pi-info-circle" aria-hidden="true"></i>
                <span>{{ productPreorderUnavailableMessage }}</span>
            </div>

            <div class="preorder-workspace">
                <div class="preorder-list-pane">
                    <div class="preorder-toolbar">
                        <div class="product-search">
                            <InputText v-model="preorderSearchText" placeholder="ค้นหาสินค้า" aria-label="ค้นหาสินค้าเพื่อตั้งค่า Preorder" autocomplete="off" :disabled="isProductPreorderEditorDisabled" @input="schedulePreorderProductSearch" @keyup.enter="searchPreorderProductsNow" />
                            <Button icon="pi pi-search" aria-label="ค้นหาสินค้าในรายการ Preorder" :loading="isLoadingProductPreorder" :disabled="isSavingProductPreorder" @click="searchPreorderProductsNow" />
                        </div>
                        <div class="filter-chips" aria-label="กรองรายการ Preorder">
                            <button v-for="filter in preorderFilterOptions" :key="filter.value" type="button" :class="['filter-chip', { active: activePreorderFilter === filter.value }]" :aria-pressed="activePreorderFilter === filter.value" @click="activePreorderFilter = filter.value">
                                <span>{{ filter.label }}</span>
                                <strong>{{ preorderFilterCounts[filter.value].toLocaleString('th-TH') }}</strong>
                            </button>
                        </div>
                    </div>

                    <div class="table-scroll-shell preorder-table-shell" role="region" aria-label="รายการตั้งค่า Preorder รายสินค้า" tabindex="0">
                        <DataTable :value="filteredProductPreorderRows" dataKey="code" class="featured-table compact-table" responsiveLayout="scroll" :loading="isLoadingProductPreorder" :rowClass="preorderRowClass" @row-click="editProductPreorder($event.data)">
                            <Column field="code" header="สินค้า" style="min-width: 240px">
                                <template #body="{ data }">
                                    <div class="product-cell">
                                        <strong>{{ data.code }}</strong>
                                        <span>{{ data.name_1 || data.name_2 || '-' }}</span>
                                        <small :class="['product-type-chip', productTypeClass(data)]">{{ productTypeLabel(data) }}</small>
                                    </div>
                                </template>
                            </Column>
                            <Column header="Preorder" style="width: 150px">
                                <template #body="{ data }">
                                    <span :class="['status-pill', preorderStatus(data).className]">{{ preorderStatus(data).text }}</span>
                                </template>
                            </Column>
                            <Column style="width: 64px">
                                <template #body="{ data }">
                                    <Button icon="pi pi-pencil" text rounded size="small" :aria-label="`แก้ไขค่า Preorder ${data.code}`" :disabled="isProductPreorderEditorDisabled" @click.stop="editProductPreorder(data)" />
                                </template>
                            </Column>
                            <template #empty>
                                <div class="empty-table">ยังไม่พบสินค้า</div>
                            </template>
                        </DataTable>
                    </div>
                </div>

                <aside class="preorder-detail-pane" aria-label="แก้ไข Preorder รายสินค้า">
                    <div class="pane-title">
                        <div>
                            <p>EDIT PREORDER</p>
                            <h3>แก้ไขสินค้าที่เลือก</h3>
                        </div>
                        <span v-if="selectedPreorderProduct" :class="['status-pill', preorderStatus(selectedPreorderProduct).className]">{{ preorderStatus(selectedPreorderProduct).text }}</span>
                    </div>

                    <Select v-model="selectedPreorderProductCode" :options="productPreorderRows" optionLabel="code" optionValue="code" placeholder="เลือกสินค้า" class="product-select" aria-label="เลือกสินค้าเพื่อตั้งค่า Preorder" :disabled="isProductPreorderEditorDisabled" filter>
                        <template #value="{ value }">
                            <span>{{ productLabel(productPreorderRows.find((item) => item.code === value)) || 'เลือกสินค้า' }}</span>
                        </template>
                        <template #option="{ option }">
                            <div class="product-option">
                                <strong>{{ option.code }}</strong>
                                <span>{{ option.name_1 || option.name_2 || option.name_eng_1 || '-' }}</span>
                                <small :class="['product-type-chip', productTypeClass(option)]">{{ productTypeLabel(option) }}</small>
                            </div>
                        </template>
                    </Select>

                    <div v-if="selectedPreorderProduct" class="selected-product-card">
                        <strong>{{ selectedPreorderProduct.code }}</strong>
                        <span>{{ selectedPreorderProduct.name_1 || selectedPreorderProduct.name_2 || '-' }}</span>
                        <small>หน่วยหลัก: {{ selectedPreorderProduct.unit_standard || '-' }}</small>
                    </div>
                    <div v-else class="empty-editor">
                        <i class="pi pi-arrow-left"></i>
                        <span>เลือกสินค้าจากตารางด้านซ้าย หรือค้นหาแล้วเลือกจากช่องด้านบน</span>
                    </div>

                    <div class="field-row">
                        <label>โหมด Preorder ของสินค้า</label>
                        <Select v-model="selectedPreorderMode" :options="preorderModeOptions" optionLabel="label" optionValue="value" class="preorder-mode-select" aria-label="โหมด Preorder ของสินค้า" :disabled="isProductPreorderEditorDisabled" />
                    </div>
                    <small v-if="productPreorderEffectiveText" class="preorder-mode-note">{{ productPreorderEffectiveText }}</small>
                    <Button label="บันทึกรายสินค้า" icon="pi pi-save" :loading="isSavingProductPreorder" :disabled="!canSaveProductPreorder" @click="saveProductPreorderSetting" />
                </aside>
            </div>
        </section>

        <section v-show="activeSettingsTab === 'featured'" class="featured-section">
            <div class="featured-head">
                <div>
                    <p>FEATURED PRODUCTS</p>
                    <h2>สินค้าใหม่ / สินค้าแนะนำ</h2>
                </div>
                <nav class="feature-type-tabs" aria-label="เลือกประเภทสินค้าใหม่หรือสินค้าแนะนำ">
                    <button v-for="type in featureTypes" :key="type.value" type="button" :class="['feature-type-tab', { active: activeFeatureType === type.value }]" :aria-pressed="activeFeatureType === type.value" :disabled="isLoadingFeatured && activeFeatureType !== type.value" @click="activeFeatureType = type.value">
                        <span>{{ type.label }}</span>
                    </button>
                </nav>
            </div>

            <div class="feature-toolbar">
                <label class="feature-list-search">
                    <span>ค้นหาในรายการที่ตั้งค่าแล้ว</span>
                    <div class="product-search">
                        <InputText v-model="featuredListSearchText" placeholder="รหัสสินค้า ชื่อสินค้า หมายเหตุ" aria-label="ค้นหาในรายการสินค้าใหม่หรือสินค้าแนะนำที่ตั้งค่าแล้ว" autocomplete="off" />
                        <Button v-if="featuredListSearchText" icon="pi pi-times" text rounded aria-label="ล้างคำค้นหา" @click="featuredListSearchText = ''" />
                        <Button v-else icon="pi pi-search" text rounded aria-label="ค้นหาในรายการที่ตั้งค่าแล้ว" disabled />
                    </div>
                </label>
                <div class="feature-toolbar-actions">
                    <span>{{ filteredFeaturedRows.length.toLocaleString('th-TH') }} / {{ activeFeaturedRows.length.toLocaleString('th-TH') }} รายการ</span>
                    <Button :label="`เพิ่ม${activeFeatureTitle}`" icon="pi pi-plus" :disabled="isSalesSettingsBusy || isLoadingFeatured" @click="openFeatureDialog('create')" />
                </div>
            </div>

            <div class="table-scroll-shell" role="region" :aria-label="`รายการ${activeFeatureTitle}`" tabindex="0">
                <DataTable :value="filteredFeaturedRows" dataKey="item_code" class="featured-table" responsiveLayout="scroll" :loading="isLoadingFeatured">
                    <Column field="line_number" header="ลำดับ" style="width: 80px" />
                    <Column field="item_code" header="สินค้า" style="min-width: 220px">
                        <template #body="{ data }">
                            <div class="product-cell">
                                <strong>{{ data.item_code }}</strong>
                                <span>{{ data.name_1 || data.name_2 || '-' }}</span>
                            </div>
                        </template>
                    </Column>
                    <Column header="ช่วงเวลา" style="min-width: 210px">
                        <template #body="{ data }">{{ formatDate(data.from_date) }} - {{ formatDate(data.to_date) }}</template>
                    </Column>
                    <Column header="สถานะ" style="width: 120px">
                        <template #body="{ data }">
                            <span :class="['status-pill', rowStatus(data).className]">{{ rowStatus(data).text }}</span>
                        </template>
                    </Column>
                    <Column field="note" header="หมายเหตุ" style="min-width: 160px" />
                    <Column style="width: 96px">
                        <template #body="{ data }">
                            <Button icon="pi pi-pencil" text rounded size="small" :aria-label="`แก้ไข ${data.item_code}`" :disabled="isSalesSettingsBusy" @click="openFeatureDialog('edit', data)" />
                            <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="`ลบ ${data.item_code} ออกจาก${activeFeatureTitle}`" :loading="deletingKey === `${data.feature_type}:${data.item_code}`" :disabled="Boolean(deletingKey) && deletingKey !== `${data.feature_type}:${data.item_code}`" @click="confirmDeleteFeaturedProduct(data)" />
                        </template>
                    </Column>
                    <template #empty>
                        <div class="empty-table">{{ loadedFeatureTypes[activeFeatureType] ? `ยังไม่มี${activeFeatureTitle}` : `ยังไม่ได้โหลด${activeFeatureTitle}` }}</div>
                    </template>
                </DataTable>
            </div>

            <Dialog v-model:visible="featureDialogVisible" modal :draggable="false" :closable="!isSavingFeature" :header="featureDialogTitle" :style="{ width: 'min(920px, 96vw)' }" @hide="closeFeatureDialog">
                <div class="feature-editor feature-dialog-form">
                    <div class="feature-field feature-product-field">
                        <span class="feature-field-label">ค้นหาและเลือกสินค้า</span>
                        <AutoComplete
                            :modelValue="selectedFeatureProduct"
                            :suggestions="productOptions"
                            optionLabel="code"
                            :placeholder="`พิมพ์รหัสหรือชื่อสินค้าเพื่อเพิ่มเป็น${activeFeatureTitle}`"
                            class="product-select"
                            inputClass="feature-product-input"
                            aria-label="ค้นหาและเลือกสินค้าใหม่หรือสินค้าแนะนำ"
                            :disabled="featureDialogMode === 'edit' || isSavingFeature"
                            :loading="isSearchingProducts"
                            :minLength="0"
                            completeOnFocus
                            dropdown
                            forceSelection
                            @complete="completeFeatureProductSearch"
                            @item-select="selectFeatureProduct($event.value)"
                            @update:modelValue="handleFeatureProductModel"
                        >
                            <template #option="{ option }">
                                <div class="product-option">
                                    <strong>{{ option.code }}</strong>
                                    <span>{{ option.name_1 || option.name_2 || option.name_eng_1 || '-' }}</span>
                                    <small :class="['product-type-chip', productTypeClass(option)]">{{ productTypeLabel(option) }}</small>
                                </div>
                            </template>
                        </AutoComplete>
                    </div>
                    <label class="feature-field feature-start-field">
                        <span class="feature-field-label">วันที่เริ่ม</span>
                        <input v-model="featureForm.from_date" type="date" class="native-input feature-start-date" aria-label="วันที่เริ่มแสดงสินค้า" :aria-invalid="Boolean(featureDateError)" aria-describedby="feature-date-error" :disabled="isSavingFeature" />
                    </label>
                    <label class="feature-field feature-end-field">
                        <span class="feature-field-label">วันที่สิ้นสุด</span>
                        <input v-model="featureForm.to_date" type="date" class="native-input feature-end-date" aria-label="วันที่สิ้นสุดการแสดงสินค้า" :aria-invalid="Boolean(featureDateError)" aria-describedby="feature-date-error" :class="{ invalid: featureDateError }" :disabled="isSavingFeature" />
                    </label>
                    <label class="feature-field feature-line-field">
                        <span class="feature-field-label">ลำดับ</span>
                        <InputNumber v-model="featureForm.line_number" placeholder="ลำดับ" class="feature-line-input" aria-label="ลำดับการแสดงสินค้า" :aria-invalid="Boolean(featureLineNumberError)" aria-describedby="feature-line-number-error" :min="0" :minFractionDigits="0" :maxFractionDigits="0" :disabled="isSavingFeature" />
                    </label>
                    <div class="feature-field feature-status-field">
                        <span class="feature-field-label">สถานะ</span>
                        <Select v-model="featureForm.status" :options="statusOptions" optionLabel="label" optionValue="value" class="feature-status-select" aria-label="สถานะการแสดงสินค้า" :disabled="isSavingFeature" />
                    </div>
                    <label class="feature-field feature-note-field">
                        <span class="feature-field-label">หมายเหตุ</span>
                        <InputText v-model="featureForm.note" placeholder="หมายเหตุ" class="feature-note-input" aria-label="หมายเหตุสินค้าใหม่หรือสินค้าแนะนำ" :disabled="isSavingFeature" />
                    </label>
                    <small v-if="featureSaveModeText" :class="['feature-mode-note', selectedFeaturedRow ? 'is-update' : 'is-create']">{{ featureSaveModeText }}</small>
                    <small v-if="featureDateError" id="feature-date-error" class="field-error feature-error">{{ featureDateError }}</small>
                    <small v-else-if="featureLineNumberError" id="feature-line-number-error" class="field-error feature-error">{{ featureLineNumberError }}</small>
                </div>
                <template #footer>
                    <div class="feature-dialog-footer">
                        <Button label="ยกเลิก" text severity="secondary" :disabled="isSavingFeature" @click="closeFeatureDialog" />
                        <Button :label="featureSaveButtonLabel" :icon="selectedFeaturedRow ? 'pi pi-pencil' : 'pi pi-plus'" :loading="isSavingFeature" :disabled="!canSaveFeaturedProduct" @click="saveFeaturedProduct" />
                    </div>
                </template>
            </Dialog>
        </section>
    </main>
</template>

<style scoped>
.sales-settings-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 1.5rem);
    background: linear-gradient(180deg, var(--market-card-bg, #fff) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #243142);
}

.page-header,
.summary-strip,
.settings-tabs,
.settings-grid,
.save-band,
.featured-section {
    max-width: 1180px;
    margin-left: auto;
    margin-right: auto;
}

.page-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.75rem;
    align-items: start;
    margin-bottom: 1rem;
}

.page-header p,
.featured-head p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 0.08em;
}

.page-header h1,
.featured-head h2,
.settings-card h2 {
    margin: 0.15rem 0;
}

.page-header span,
.settings-card span {
    color: var(--market-muted, #64748b);
}

.summary-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
}

.summary-item {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 8px;
    background: var(--market-card-bg, #fff);
    padding: 0.85rem 1rem;
    box-shadow: 0 8px 18px var(--market-shadow, rgba(15, 23, 42, 0.06));
}

.summary-item span {
    color: var(--market-muted, #64748b);
    font-size: 0.76rem;
    font-weight: 800;
}

.summary-item strong {
    min-width: 0;
    color: var(--market-text, #243142);
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.settings-tabs {
    display: flex;
    gap: 0.45rem;
    margin-bottom: 1rem;
    overflow-x: auto;
    padding-bottom: 0.1rem;
}

.settings-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.55rem;
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 8px;
    background: var(--market-card-bg, #fff);
    color: var(--market-muted, #64748b);
    cursor: pointer;
    font: inherit;
    font-size: 0.88rem;
    font-weight: 900;
    padding: 0.55rem 0.8rem;
    white-space: nowrap;
}

.settings-tab.active {
    border-color: color-mix(in srgb, var(--market-primary, #0f9f6e) 35%, #d1fae5);
    background: color-mix(in srgb, var(--market-primary, #0f9f6e) 10%, #fff);
    color: var(--market-primary, #0f9f6e);
}

.settings-tab:focus-visible,
.filter-chip:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--market-primary, #0f9f6e) 50%, transparent);
    outline-offset: 2px;
}

.settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
}

.settings-card,
.featured-section {
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 8px;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(15, 23, 42, 0.08));
}

.settings-card {
    display: grid;
    gap: 1rem;
    padding: 1rem;
}

.marketplace-default-card {
    grid-column: 1 / -1;
}

.form-grid-2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
}

.span-2 {
    grid-column: 1 / -1;
}

.card-title {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
}

.card-title > i {
    display: inline-grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--market-primary, #0f9f6e) 12%, #fff);
    color: var(--market-primary, #0f9f6e);
}

.field-row {
    display: grid;
    gap: 0.4rem;
}

.field-row label {
    font-weight: 800;
}

.field-error {
    color: #dc2626;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.35;
}

.field-warning {
    color: #b45309;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.35;
}

.toggle-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 44px;
    color: var(--market-text, #0f172a);
    font-weight: 800;
}

.setting-impact-note {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    min-height: 2.4rem;
    border-radius: 8px;
    padding: 0.65rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1.4;
}

.setting-impact-note i {
    margin-top: 0.08rem;
    font-size: 0.9rem;
}

.setting-impact-note.is-warning {
    background: #fff7ed;
    color: #9a3412;
}

.setting-impact-note.is-muted {
    background: #f8fafc;
    color: #475569;
}

.save-band {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
}

.featured-section {
    margin-top: 1rem;
    overflow: hidden;
}

.featured-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    border-bottom: 1px solid var(--market-card-border, #e2e8f0);
}

.feature-type-tabs {
    display: inline-flex;
    gap: 0.25rem;
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 8px;
    background: #f8fafc;
    padding: 0.25rem;
}

.feature-type-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.25rem;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--market-muted, #64748b);
    cursor: pointer;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 900;
    padding: 0.45rem 0.8rem;
    white-space: nowrap;
}

.feature-type-tab.active {
    background: var(--market-card-bg, #fff);
    color: var(--market-primary, #0f9f6e);
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.feature-type-tab:disabled {
    cursor: not-allowed;
    opacity: 0.6;
}

.feature-toolbar {
    display: grid;
    grid-template-columns: minmax(280px, 1fr) auto;
    gap: 1rem;
    align-items: end;
    padding: 1rem;
    border-bottom: 1px solid var(--market-card-border, #e2e8f0);
    background: #fbfdff;
}

.feature-list-search {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
    color: var(--market-muted, #64748b);
    font-size: 0.76rem;
    font-weight: 900;
}

.feature-toolbar-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    min-width: 0;
}

.feature-toolbar-actions span {
    color: var(--market-muted, #64748b);
    font-size: 0.78rem;
    font-weight: 900;
    white-space: nowrap;
}

.feature-editor {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 0.6rem;
    align-items: start;
    padding: 1rem;
    border-bottom: 1px solid var(--market-card-border, #e2e8f0);
}

.feature-dialog-form {
    padding: 0;
    border-bottom: 0;
}

.feature-editor > * {
    min-width: 0;
}

.feature-field {
    display: grid;
    gap: 0.32rem;
    min-width: 0;
}

.feature-field-label {
    color: var(--market-muted, #64748b);
    font-size: 0.72rem;
    font-weight: 900;
    line-height: 1.2;
}

.feature-field > .p-component,
.feature-field > .native-input,
.feature-field > .product-select,
.feature-field > .feature-line-input,
.feature-field > .feature-note-input,
.feature-field > .feature-status-select {
    width: 100%;
}

.feature-editor > .feature-search-field {
    grid-column: 1 / 4;
    grid-row: 1;
}

.feature-editor > .feature-product-field {
    grid-column: 4 / 9;
    grid-row: 1;
}

.feature-editor > .feature-start-field {
    grid-column: 1 / 3;
    grid-row: 2;
}

.feature-editor > .feature-end-field {
    grid-column: 3 / 5;
    grid-row: 2;
}

.feature-editor > .feature-line-field {
    grid-column: 5 / 7;
    grid-row: 2;
}

.feature-editor > .feature-status-field {
    grid-column: 9 / 11;
    grid-row: 1;
}

.feature-editor > .feature-note-field {
    grid-column: 7 / 13;
    grid-row: 2;
}

.feature-editor > .feature-action-field {
    grid-column: 11 / 13;
    grid-row: 1;
    align-self: end;
}

.feature-editor.feature-dialog-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.9rem 1rem;
}

.feature-editor.feature-dialog-form > .feature-search-field,
.feature-editor.feature-dialog-form > .feature-product-field,
.feature-editor.feature-dialog-form > .feature-start-field,
.feature-editor.feature-dialog-form > .feature-end-field,
.feature-editor.feature-dialog-form > .feature-line-field,
.feature-editor.feature-dialog-form > .feature-status-field,
.feature-editor.feature-dialog-form > .feature-note-field {
    grid-row: auto;
}

.feature-editor.feature-dialog-form > .feature-search-field,
.feature-editor.feature-dialog-form > .feature-product-field {
    grid-column: 1 / -1;
}

.feature-editor.feature-dialog-form > .feature-start-field,
.feature-editor.feature-dialog-form > .feature-line-field {
    grid-column: 1 / 2;
}

.feature-editor.feature-dialog-form > .feature-end-field,
.feature-editor.feature-dialog-form > .feature-status-field {
    grid-column: 2 / 3;
}

.feature-editor.feature-dialog-form > .feature-note-field,
.feature-editor.feature-dialog-form > .feature-mode-note,
.feature-editor.feature-dialog-form > .feature-error {
    grid-column: 1 / -1;
}

.feature-save-button {
    width: 100%;
    min-width: 8.5rem;
    justify-content: center;
    white-space: nowrap;
}

.feature-dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    width: 100%;
}

.preorder-editor {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(260px, 1.4fr) minmax(190px, 0.8fr) auto;
    gap: 0.6rem;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid var(--market-card-border, #e2e8f0);
}

.preorder-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(300px, 0.8fr);
    gap: 0;
    min-height: 29rem;
}

.preorder-list-pane {
    min-width: 0;
    border-right: 1px solid var(--market-card-border, #e2e8f0);
}

.preorder-toolbar {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border-bottom: 1px solid var(--market-card-border, #e2e8f0);
    background: #fbfdff;
}

.filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
}

.filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2rem;
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 999px;
    background: var(--market-card-bg, #fff);
    color: var(--market-muted, #64748b);
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 900;
    padding: 0.3rem 0.6rem;
}

.filter-chip strong {
    display: inline-grid;
    place-items: center;
    min-width: 1.45rem;
    height: 1.45rem;
    border-radius: 999px;
    background: #f1f5f9;
    color: var(--market-text, #243142);
    font-size: 0.72rem;
}

.filter-chip.active {
    border-color: color-mix(in srgb, var(--market-primary, #0f9f6e) 35%, #d1fae5);
    background: #ecfdf5;
    color: #047857;
}

.filter-chip.active strong {
    background: #d1fae5;
    color: #065f46;
}

.preorder-detail-pane {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 0;
    padding: 1rem;
    background: #fcfcfd;
}

.pane-title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
}

.pane-title p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.08em;
}

.pane-title h3 {
    margin: 0.12rem 0 0;
    color: var(--market-text, #243142);
    font-size: 1rem;
}

.selected-product-card,
.empty-editor {
    display: grid;
    gap: 0.25rem;
    min-height: 6.5rem;
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 8px;
    background: var(--market-card-bg, #fff);
    padding: 0.85rem;
}

.selected-product-card strong {
    color: var(--market-text, #243142);
}

.selected-product-card span,
.selected-product-card small,
.empty-editor {
    color: var(--market-muted, #64748b);
}

.empty-editor {
    place-items: center;
    text-align: center;
    font-size: 0.85rem;
    font-weight: 800;
    line-height: 1.4;
}

.empty-editor i {
    color: var(--market-primary, #0f9f6e);
    font-size: 1.35rem;
}

.preorder-unavailable-note {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    margin: 1rem 1rem 0;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    background: #eff6ff;
    color: #1e40af;
    padding: 0.75rem 0.85rem;
    font-size: 0.84rem;
    font-weight: 800;
    line-height: 1.45;
}

.preorder-unavailable-note i {
    margin-top: 0.1rem;
    flex: 0 0 auto;
}

.product-search {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.4rem;
}

.product-select,
.preorder-mode-select,
.native-input {
    width: 100%;
}

.native-input {
    min-height: 2.5rem;
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    color: inherit;
    font: inherit;
}

.native-input.invalid {
    border-color: #dc2626;
    box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.14);
}

.feature-error {
    grid-column: 1 / -1;
}

.feature-mode-note {
    grid-column: 1 / -1;
    border-radius: 8px;
    padding: 0.55rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 800;
    line-height: 1.35;
}

.feature-mode-note.is-create {
    background: #ecfdf5;
    color: #047857;
}

.feature-mode-note.is-update {
    background: #eff6ff;
    color: #1d4ed8;
}

.preorder-mode-note {
    grid-column: 1 / -1;
    border-radius: 8px;
    background: #f8fafc;
    color: #475569;
    padding: 0.55rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 800;
    line-height: 1.35;
}

.product-option,
.product-cell {
    display: grid;
    gap: 0.1rem;
}

.product-option span,
.product-cell span {
    color: var(--market-muted, #64748b);
    font-size: 0.82rem;
}

.product-type-chip {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
    font-size: 0.68rem;
    font-weight: 900;
    line-height: 1.2;
}

.product-type-chip.is-normal {
    background: #eff6ff;
    color: #1d4ed8;
}

.product-type-chip.is-set {
    background: #f0fdf4;
    color: #047857;
}

.featured-table {
    border-radius: 0;
}

.table-scroll-shell {
    max-height: clamp(18rem, 42vh, 28rem);
    overflow: auto;
    border-top: 1px solid var(--market-card-border, #e2e8f0);
    background: var(--market-card-bg, #fff);
}

.preorder-table-shell {
    max-height: clamp(22rem, 52vh, 34rem);
    border-top: 0;
}

.table-scroll-shell:focus {
    outline: 2px solid color-mix(in srgb, var(--market-primary, #0f9f6e) 55%, transparent);
    outline-offset: -2px;
}

.table-scroll-shell :deep(.p-datatable-thead > tr > th) {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--market-card-bg, #fff);
    box-shadow: inset 0 -1px 0 var(--market-card-border, #e2e8f0);
}

.table-scroll-shell :deep(.p-datatable-wrapper) {
    overflow: visible;
}

.compact-table :deep(.p-datatable-tbody > tr) {
    cursor: pointer;
}

.compact-table :deep(.p-datatable-tbody > tr.selected-preorder-row > td) {
    background: #ecfdf5;
    box-shadow: inset 3px 0 0 var(--market-primary, #0f9f6e);
}

.compact-table :deep(.p-datatable-tbody > tr > td),
.compact-table :deep(.p-datatable-thead > tr > th) {
    padding-block: 0.65rem;
}

.status-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 900;
}

.status-pill.active {
    background: #dcfce7;
    color: #166534;
}

.status-pill.pending {
    background: #dbeafe;
    color: #1d4ed8;
}

.status-pill.expired,
.status-pill.inactive {
    background: #f1f5f9;
    color: #64748b;
}

.empty-table {
    padding: 2rem;
    text-align: center;
    color: var(--market-muted, #64748b);
}

@media (max-width: 1080px) {
    .feature-editor {
        grid-template-columns: repeat(6, minmax(0, 1fr));
    }

    .feature-editor > .feature-search-field {
        grid-column: 1 / 4;
        grid-row: auto;
    }

    .feature-editor > .feature-product-field {
        grid-column: 4 / 7;
        grid-row: auto;
    }

    .feature-editor > .feature-start-field {
        grid-column: 1 / 3;
        grid-row: auto;
    }

    .feature-editor > .feature-end-field {
        grid-column: 3 / 5;
        grid-row: auto;
    }

    .feature-editor > .feature-line-field {
        grid-column: 5 / 7;
        grid-row: auto;
    }

    .feature-editor > .feature-status-field {
        grid-column: 1 / 3;
        grid-row: auto;
    }

    .feature-editor > .feature-note-field {
        grid-column: 3 / 5;
        grid-row: auto;
    }

    .feature-editor > .feature-action-field {
        grid-column: 5 / 7;
        grid-row: auto;
    }

    .preorder-editor {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .summary-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .preorder-workspace {
        grid-template-columns: 1fr;
    }

    .preorder-list-pane {
        border-right: 0;
        border-bottom: 1px solid var(--market-card-border, #e2e8f0);
    }
}

@media (max-width: 720px) {
    .page-header,
    .summary-strip,
    .settings-grid,
    .form-grid-2,
    .feature-toolbar,
    .preorder-editor {
        grid-template-columns: 1fr;
    }

    .span-2 {
        grid-column: 1 / -1;
    }

    .feature-editor {
        grid-template-columns: 1fr;
    }

    .feature-editor.feature-dialog-form {
        grid-template-columns: 1fr;
    }

    .feature-editor > .feature-search-field,
    .feature-editor > .feature-product-field,
    .feature-editor > .feature-start-field,
    .feature-editor > .feature-end-field,
    .feature-editor > .feature-line-field,
    .feature-editor > .feature-status-field,
    .feature-editor > .feature-note-field,
    .feature-editor > .feature-action-field {
        grid-column: 1 / -1;
        grid-row: auto;
    }

    .feature-editor.feature-dialog-form > .feature-search-field,
    .feature-editor.feature-dialog-form > .feature-product-field,
    .feature-editor.feature-dialog-form > .feature-start-field,
    .feature-editor.feature-dialog-form > .feature-end-field,
    .feature-editor.feature-dialog-form > .feature-line-field,
    .feature-editor.feature-dialog-form > .feature-status-field,
    .feature-editor.feature-dialog-form > .feature-note-field {
        grid-column: 1 / -1;
        grid-row: auto;
    }

    .settings-tabs {
        margin-inline: auto;
        width: min(100%, 1180px);
    }

    .settings-tab {
        flex: 1 0 auto;
    }

    .save-band,
    .featured-head,
    .feature-toolbar-actions {
        align-items: stretch;
        flex-direction: column;
    }

    .feature-type-tabs {
        width: 100%;
    }

    .feature-type-tab {
        flex: 1 1 0;
    }

    .preorder-table-shell,
    .table-scroll-shell {
        max-height: 22rem;
    }
}
</style>
