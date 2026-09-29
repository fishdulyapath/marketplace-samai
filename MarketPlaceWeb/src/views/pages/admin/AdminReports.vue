<script setup>
import AdminReportService from '@/services/AdminReportService';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import * as XLSX from 'xlsx';

const router = useRouter();
const toast = useToast();

const activeReport = ref('carts'); // 'carts' | 'products'

function toNum(value, fallback = 0) {
    const n = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function formatQty(value) {
    return toNum(value).toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

function formatMoney(value) {
    return toNum(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('en-GB', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ป้ายบอกว่า active ล่าสุดนานแค่ไหนแล้ว — ให้กวาดตาแยกตะกร้าสดกับตะกร้าค้างได้ทันที
function formatAgo(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 0) return '';
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'เมื่อสักครู่';
    if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ชม.ที่แล้ว`;
    const days = Math.floor(hours / 24);
    return `${days} วันที่แล้ว`;
}

// ---------- รายงาน 1: ตะกร้าสินค้า ----------
const cartLoading = ref(false);
const cartRows = ref([]);
const cartSearchText = ref('');
const cartPage = ref(1);
const cartPageSize = 30;
const cartTotalCount = ref(0);
let cartAbort = null;

const cartDetailVisible = ref(false);
const cartDetailLoading = ref(false);
const cartDetailCustomer = ref(null);
const cartDetailItems = ref([]);

const cartTotalPages = computed(() => Math.max(1, Math.ceil(cartTotalCount.value / cartPageSize)));
const cartDetailTotalAmount = computed(() => cartDetailItems.value.reduce((sum, item) => sum + toNum(item.price) * toNum(item.qty), 0));
const cartDetailTotalQty = computed(() => cartDetailItems.value.reduce((sum, item) => sum + toNum(item.qty), 0));

async function loadCartList(resetPage = false) {
    if (resetPage) cartPage.value = 1;
    if (cartAbort) cartAbort.abort();
    cartAbort = new AbortController();
    cartLoading.value = true;
    try {
        const response = await AdminReportService.getCartCustomers({
            search: cartSearchText.value.trim(),
            page: cartPage.value,
            pageSize: cartPageSize,
            signal: cartAbort.signal
        });
        if (response?.data?.success) {
            cartRows.value = response.data.data || [];
            cartTotalCount.value = toNum(response.data.total_count, 0);
        }
    } catch (error) {
        if (error?.code === 'ERR_CANCELED') return;
        console.error('Error loading cart customers:', error);
        toast.add({ severity: 'error', summary: 'ผิดพลาด', detail: 'โหลดรายงานตะกร้าสินค้าไม่สำเร็จ', life: 3000 });
    } finally {
        cartLoading.value = false;
    }
}

async function openCartDetail(row) {
    cartDetailCustomer.value = row;
    cartDetailItems.value = [];
    cartDetailVisible.value = true;
    cartDetailLoading.value = true;
    try {
        const response = await AdminReportService.getCustomerCartItems(row.cust_code);
        if (response?.data?.success) {
            cartDetailItems.value = response.data.data || [];
        }
    } catch (error) {
        console.error('Error loading customer cart items:', error);
        toast.add({ severity: 'error', summary: 'ผิดพลาด', detail: `โหลดตะกร้าของ ${row.cust_code} ไม่สำเร็จ`, life: 3000 });
    } finally {
        cartDetailLoading.value = false;
    }
}

// ---------- รายงาน 2: สินค้าที่แสดงขายบนเว็บ ----------
const productLoading = ref(false);
const productRows = ref([]);
const productSearchText = ref('');
const productPage = ref(1);
const productPageSize = 30;
const productTotalCount = ref(0);
const productLoaded = ref(false);
let productAbort = null;

const productDialogVisible = ref(false);
const productDialogLoading = ref(false);
const productDialogItem = ref(null);
const productDialogCustomers = ref([]);

const productTotalPages = computed(() => Math.max(1, Math.ceil(productTotalCount.value / productPageSize)));

async function loadProductList(resetPage = false) {
    if (resetPage) productPage.value = 1;
    if (productAbort) productAbort.abort();
    productAbort = new AbortController();
    productLoading.value = true;
    try {
        const response = await AdminReportService.getProductsOnWeb({
            search: productSearchText.value.trim(),
            page: productPage.value,
            pageSize: productPageSize,
            signal: productAbort.signal
        });
        if (response?.data?.success) {
            productRows.value = response.data.data || [];
            productTotalCount.value = toNum(response.data.total_count, 0);
            productLoaded.value = true;
        }
    } catch (error) {
        if (error?.code === 'ERR_CANCELED') return;
        console.error('Error loading products on web:', error);
        toast.add({ severity: 'error', summary: 'ผิดพลาด', detail: 'โหลดรายงานสินค้าที่แสดงขายบนเว็บไม่สำเร็จ', life: 3000 });
    } finally {
        productLoading.value = false;
    }
}

function unitChipLabel(unit) {
    const max = unit.max_order_qty;
    return max ? `${unit.code} (สูงสุด ${formatQty(max)})` : unit.code;
}

function visibleUnits(row) {
    return (row.units || []).filter((unit) => !unit.hidden);
}

function hiddenUnits(row) {
    return (row.units || []).filter((unit) => unit.hidden);
}

async function openProductCartCustomers(row) {
    if (!toNum(row.cart_customer_count)) return;
    productDialogItem.value = row;
    productDialogCustomers.value = [];
    productDialogVisible.value = true;
    productDialogLoading.value = true;
    try {
        const response = await AdminReportService.getProductCartCustomers(row.item_code);
        if (response?.data?.success) {
            productDialogCustomers.value = response.data.data || [];
        }
    } catch (error) {
        console.error('Error loading product cart customers:', error);
        toast.add({ severity: 'error', summary: 'ผิดพลาด', detail: `โหลดรายชื่อลูกค้าของ ${row.item_code} ไม่สำเร็จ`, life: 3000 });
    } finally {
        productDialogLoading.value = false;
    }
}

function formatCustomerLines(lines) {
    return (lines || []).map((line) => `${formatQty(line.qty)} ${line.unit_code}`).join(', ');
}

// ---------- รายงาน 3-4: ยอดสั่ง order / ยอดขายจาก marketplace ----------
// สองรายงานหน้าตาเดียวกัน (ช่วงวันที่ + ค้นหาลูกค้า + สรุปยอด + ตาราง) เก็บ state เป็นชุดต่อรายงาน
function todayIso() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function createAmountReportState() {
    return {
        loading: ref(false),
        loaded: ref(false),
        rows: ref([]),
        searchText: ref(''),
        dateFrom: ref(todayIso()),
        dateTo: ref(todayIso()),
        page: ref(1),
        pageSize: 30,
        totalCount: ref(0),
        summary: ref(null),
        abort: null
    };
}

const orderReport = createAmountReportState();
const saleReport = createAmountReportState();

async function loadAmountReport(state, fetcher, label, resetPage = false) {
    if (resetPage) state.page.value = 1;
    if (state.abort) state.abort.abort();
    state.abort = new AbortController();
    state.loading.value = true;
    try {
        const response = await fetcher({
            search: state.searchText.value.trim(),
            dateFrom: state.dateFrom.value,
            dateTo: state.dateTo.value,
            page: state.page.value,
            pageSize: state.pageSize,
            signal: state.abort.signal
        });
        if (response?.data?.success) {
            state.rows.value = response.data.data || [];
            state.totalCount.value = toNum(response.data.total_count, 0);
            state.summary.value = response.data.summary || null;
            state.loaded.value = true;
        }
    } catch (error) {
        if (error?.code === 'ERR_CANCELED') return;
        console.error(`Error loading ${label}:`, error);
        const detail = error?.response?.data?.error || `โหลด${label}ไม่สำเร็จ`;
        toast.add({ severity: 'error', summary: 'ผิดพลาด', detail, life: 4000 });
    } finally {
        state.loading.value = false;
    }
}

const loadOrderReport = (resetPage = false) => loadAmountReport(orderReport, (p) => AdminReportService.getMarketplaceOrderReport(p), 'รายงานยอดสั่งซื้อ', resetPage);
const loadSaleReport = (resetPage = false) => loadAmountReport(saleReport, (p) => AdminReportService.getMarketplaceSaleReport(p), 'รายงานยอดขาย', resetPage);

const orderTotalPages = computed(() => Math.max(1, Math.ceil(orderReport.totalCount.value / orderReport.pageSize)));
const saleTotalPages = computed(() => Math.max(1, Math.ceil(saleReport.totalCount.value / saleReport.pageSize)));

// ---------- Export Excel ----------
// gen ฝั่งหน้าจอด้วย SheetJS — ดึงข้อมูลทั้งชุดตาม filter ปัจจุบัน (export=1) แล้วเขียน .xlsx
const exportingReport = ref(''); // '' | 'products' | 'orders' | 'sales'

function writeExcelFile(rows, colWidths, sheetName, filename) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = colWidths.map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, filename);
}

function exportStamp() {
    return todayIso().replace(/-/g, '');
}

async function exportReport(kind, fetcher, buildSheet) {
    if (exportingReport.value) return;
    exportingReport.value = kind;
    try {
        const response = await fetcher();
        if (!response?.data?.success) throw new Error(response?.data?.error || 'โหลดข้อมูลไม่สำเร็จ');
        buildSheet(response.data);
        toast.add({ severity: 'success', summary: 'Export แล้ว', detail: `ดาวน์โหลดไฟล์ Excel (${formatQty((response.data.data || []).length)} แถว)`, life: 3000 });
    } catch (error) {
        console.error(`Error exporting ${kind}:`, error);
        toast.add({ severity: 'error', summary: 'Export ไม่สำเร็จ', detail: error?.response?.data?.error || error.message, life: 4000 });
    } finally {
        exportingReport.value = '';
    }
}

function exportProductsExcel() {
    exportReport(
        'products',
        () => AdminReportService.getProductsOnWeb({ search: productSearchText.value.trim(), exportAll: true }),
        (payload) => {
            const rows = [['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'หน่วยที่เปิดขาย (จำนวนสั่งสูงสุด)', 'หน่วยที่ซ่อนจากเว็บ', 'หน่วยเริ่มต้นขาย', 'สินค้าแนะนำ', 'Preorder', 'ลูกค้าใส่ตะกร้า (ราย)']];
            for (const r of payload.data || []) {
                rows.push([
                    r.item_code,
                    r.item_name,
                    r.category_name || r.category_code || '',
                    visibleUnits(r).map(unitChipLabel).join(', '),
                    hiddenUnits(r).map((u) => u.code).join(', '),
                    r.start_sale_unit || r.unit_standard || '',
                    r.is_recommended ? 'แนะนำ' : '',
                    r.preorder_allowed ? 'เปิด' : 'ปิด',
                    toNum(r.cart_customer_count)
                ]);
            }
            writeExcelFile(rows, [14, 42, 24, 36, 18, 14, 10, 9, 16], 'สินค้าบนเว็บ', `products-on-web-${exportStamp()}.xlsx`);
        }
    );
}

function exportOrdersExcel() {
    exportReport(
        'orders',
        () => AdminReportService.getMarketplaceOrderReport({
            search: orderReport.searchText.value.trim(),
            dateFrom: orderReport.dateFrom.value,
            dateTo: orderReport.dateTo.value,
            exportAll: true
        }),
        (payload) => {
            const rows = [['เลขที่ใบสั่งซื้อ', 'วันที่', 'เวลา', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'ยอดสั่ง', 'สถานะ']];
            for (const r of payload.data || []) {
                rows.push([r.doc_no, r.doc_date, r.doc_time, r.cust_code, r.cust_name, toNum(r.total_amount), r.is_cancelled ? 'ยกเลิก' : '']);
            }
            const s = payload.summary || {};
            rows.push([]);
            rows.push(['รวม (ไม่นับใบที่ยกเลิก)', '', '', '', `${formatQty(s.order_count)} ใบ`, toNum(s.total_amount), s.cancelled_count ? `ยกเลิก ${formatQty(s.cancelled_count)} ใบ` : '']);
            writeExcelFile(rows, [22, 12, 8, 12, 34, 14, 16], 'ยอดสั่งซื้อ', `marketplace-orders-${payload.date_from}_${payload.date_to}.xlsx`);
        }
    );
}

function exportSalesExcel() {
    exportReport(
        'sales',
        () => AdminReportService.getMarketplaceSaleReport({
            search: saleReport.searchText.value.trim(),
            dateFrom: saleReport.dateFrom.value,
            dateTo: saleReport.dateTo.value,
            exportAll: true
        }),
        (payload) => {
            const rows = [['เลขที่ใบขาย', 'วันที่', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'ยอดขาย', 'อ้างอิงใบสั่งซื้อ']];
            for (const r of payload.data || []) {
                rows.push([r.doc_no, r.doc_date, r.cust_code, r.cust_name, toNum(r.total_amount), r.order_doc_nos]);
            }
            const s = payload.summary || {};
            rows.push([]);
            rows.push(['รวม', '', '', `${formatQty(s.invoice_count)} ใบ`, toNum(s.total_amount), '']);
            writeExcelFile(rows, [24, 12, 12, 34, 14, 30], 'ยอดขาย', `marketplace-sales-${payload.date_from}_${payload.date_to}.xlsx`);
        }
    );
}

function switchReport(report) {
    activeReport.value = report;
    // โหลดครั้งแรกเมื่อเปิดแท็บ ไม่ยิงล่วงหน้าทุกรายงาน
    if (report === 'products' && !productLoaded.value && !productLoading.value) loadProductList();
    if (report === 'orders' && !orderReport.loaded.value && !orderReport.loading.value) loadOrderReport();
    if (report === 'sales' && !saleReport.loaded.value && !saleReport.loading.value) loadSaleReport();
}

onMounted(() => loadCartList());
onBeforeUnmount(() => {
    if (cartAbort) cartAbort.abort();
    if (productAbort) productAbort.abort();
    if (orderReport.abort) orderReport.abort.abort();
    if (saleReport.abort) saleReport.abort.abort();
});
</script>

<template>
    <main class="admin-reports-page">
        <Toast position="top-right" />

        <header class="admin-reports-head">
            <div>
                <p>จัดการหลังบ้าน</p>
                <h1>รายงาน</h1>
                <span>รายงานตะกร้าสินค้าของลูกค้า และสินค้าที่แสดงขายบนเว็บ</span>
            </div>
            <div class="admin-reports-actions">
                <Button label="เมนูหลัก" icon="pi pi-arrow-left" outlined @click="router.push('/admin')" />
            </div>
        </header>

        <nav class="report-tabs" aria-label="เลือกรายงาน">
            <button type="button" :class="{ active: activeReport === 'carts' }" @click="switchReport('carts')"><i class="pi pi-shopping-cart"></i> ตะกร้าสินค้า</button>
            <button type="button" :class="{ active: activeReport === 'products' }" @click="switchReport('products')"><i class="pi pi-globe"></i> สินค้าที่แสดงขายบนเว็บ</button>
            <button type="button" :class="{ active: activeReport === 'orders' }" @click="switchReport('orders')"><i class="pi pi-receipt"></i> ยอดสั่งซื้อ</button>
            <button type="button" :class="{ active: activeReport === 'sales' }" @click="switchReport('sales')"><i class="pi pi-wallet"></i> ยอดขาย</button>
        </nav>

        <!-- รายงานตะกร้าสินค้า -->
        <section v-show="activeReport === 'carts'" class="report-panel">
            <div class="panel-title-row">
                <h2>ลูกค้าที่มีของในตะกร้า</h2>
                <IconField>
                    <InputIcon class="pi pi-search" />
                    <InputText v-model="cartSearchText" placeholder="ค้นหารหัส / ชื่อลูกค้า" aria-label="ค้นหารหัสหรือชื่อลูกค้า" :disabled="cartLoading" @keyup.enter="loadCartList(true)" />
                </IconField>
            </div>

            <div class="list-tools">
                <Button label="ค้นหา" icon="pi pi-search" size="small" :disabled="cartLoading" @click="loadCartList(true)" />
                <Button label="ล้าง" icon="pi pi-times" size="small" text :disabled="cartLoading" @click="cartSearchText = ''; loadCartList(true)" />
                <Button label="โหลดใหม่" icon="pi pi-refresh" size="small" text :disabled="cartLoading" @click="loadCartList()" />
                <span>ทั้งหมด {{ formatQty(cartTotalCount) }} ราย</span>
            </div>

            <div v-if="cartLoading" class="loading-box">
                <ProgressSpinner />
                <span>กำลังโหลด...</span>
            </div>

            <div v-else class="carts-table">
                <button v-for="row in cartRows" :key="row.cust_code" type="button" class="cart-row" :aria-label="`ดูตะกร้าของ ${row.cust_code} ${row.cust_name || ''}`" @click="openCartDetail(row)">
                    <div class="row-avatar"><i class="pi pi-shopping-cart"></i></div>
                    <div class="row-main">
                        <strong>{{ row.cust_name || '(ไม่พบชื่อในระบบ)' }}</strong>
                        <span>{{ row.cust_code }}</span>
                        <small v-if="row.telephone">{{ row.telephone }}</small>
                    </div>
                    <div class="row-meta">
                        <span class="meta-strong">{{ formatQty(row.line_count) }} รายการ · {{ formatQty(row.total_qty) }} ชิ้น</span>
                        <span class="meta-time">
                            <i class="pi pi-clock"></i>
                            {{ formatDateTime(row.last_active) }}
                            <em v-if="formatAgo(row.last_active)">({{ formatAgo(row.last_active) }})</em>
                        </span>
                    </div>
                    <i class="pi pi-angle-right row-arrow"></i>
                </button>

                <div v-if="cartRows.length === 0" class="empty-state">
                    <i class="pi pi-shopping-cart"></i>
                    <span>ไม่พบลูกค้าที่มีสินค้าในตะกร้า</span>
                </div>
            </div>

            <div class="pager-row">
                <Button icon="pi pi-angle-left" text rounded aria-label="หน้าก่อนหน้า" :disabled="cartPage <= 1 || cartLoading" @click="cartPage -= 1; loadCartList()" />
                <span>{{ cartPage }} / {{ cartTotalPages }}</span>
                <Button icon="pi pi-angle-right" text rounded aria-label="หน้าถัดไป" :disabled="cartPage >= cartTotalPages || cartLoading" @click="cartPage += 1; loadCartList()" />
            </div>
        </section>

        <!-- รายงานสินค้าที่แสดงขายบนเว็บ -->
        <section v-show="activeReport === 'products'" class="report-panel">
            <div class="panel-title-row">
                <h2>สินค้าที่แสดงขายบนเว็บ</h2>
                <IconField>
                    <InputIcon class="pi pi-search" />
                    <InputText v-model="productSearchText" placeholder="ค้นหารหัส / ชื่อสินค้า" aria-label="ค้นหารหัสหรือชื่อสินค้า" :disabled="productLoading" @keyup.enter="loadProductList(true)" />
                </IconField>
            </div>

            <div class="list-tools">
                <Button label="ค้นหา" icon="pi pi-search" size="small" :disabled="productLoading" @click="loadProductList(true)" />
                <Button label="ล้าง" icon="pi pi-times" size="small" text :disabled="productLoading" @click="productSearchText = ''; loadProductList(true)" />
                <Button label="โหลดใหม่" icon="pi pi-refresh" size="small" text :disabled="productLoading" @click="loadProductList()" />
                <Button label="Export Excel" icon="pi pi-file-excel" size="small" outlined severity="success" :loading="exportingReport === 'products'" :disabled="productLoading || !!exportingReport" @click="exportProductsExcel" />
                <span>ทั้งหมด {{ formatQty(productTotalCount) }} รายการ</span>
            </div>

            <div v-if="productLoading" class="loading-box">
                <ProgressSpinner />
                <span>กำลังโหลด...</span>
            </div>

            <div v-else class="product-table-wrap">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>สินค้า</th>
                            <th>หมวดหมู่</th>
                            <th>หน่วยที่เปิดขาย (จำนวนสั่งสูงสุด)</th>
                            <th>หน่วยเริ่มต้นขาย</th>
                            <th>แนะนำ</th>
                            <th>Preorder</th>
                            <th class="num">ลูกค้าใส่ตะกร้า</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in productRows" :key="row.item_code">
                            <td>
                                <strong>{{ row.item_name || row.item_code }}</strong>
                                <small>{{ row.item_code }}</small>
                            </td>
                            <td>{{ row.category_name || row.category_code || '-' }}</td>
                            <td>
                                <span v-for="unit in visibleUnits(row)" :key="unit.code" class="unit-chip">{{ unitChipLabel(unit) }}</span>
                                <span v-for="unit in hiddenUnits(row)" :key="`h-${unit.code}`" class="unit-chip unit-chip--hidden" title="หน่วยนี้ถูกซ่อนจากหน้าเว็บ">{{ unit.code }} (ซ่อน)</span>
                                <span v-if="!(row.units || []).length" class="muted">-</span>
                            </td>
                            <td>{{ row.start_sale_unit || row.unit_standard || '-' }}</td>
                            <td>
                                <Tag v-if="row.is_recommended" value="แนะนำ" severity="warn" />
                                <span v-else class="muted">-</span>
                            </td>
                            <td>
                                <Tag v-if="row.preorder_allowed" value="เปิด" severity="info" />
                                <Tag v-else value="ปิด" severity="secondary" />
                            </td>
                            <td class="num">
                                <button v-if="toNum(row.cart_customer_count) > 0" type="button" class="cart-count-btn" :aria-label="`ดูลูกค้าที่ใส่ ${row.item_code} ในตะกร้า`" @click="openProductCartCustomers(row)">
                                    {{ formatQty(row.cart_customer_count) }} ราย
                                </button>
                                <span v-else class="muted">-</span>
                            </td>
                        </tr>
                        <tr v-if="productRows.length === 0">
                            <td colspan="7" class="empty-cell">ไม่พบสินค้าที่แสดงขายบนเว็บ</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="pager-row">
                <Button icon="pi pi-angle-left" text rounded aria-label="หน้าก่อนหน้า" :disabled="productPage <= 1 || productLoading" @click="productPage -= 1; loadProductList()" />
                <span>{{ productPage }} / {{ productTotalPages }}</span>
                <Button icon="pi pi-angle-right" text rounded aria-label="หน้าถัดไป" :disabled="productPage >= productTotalPages || productLoading" @click="productPage += 1; loadProductList()" />
            </div>
        </section>

        <!-- รายงานยอดสั่ง order marketplace -->
        <section v-show="activeReport === 'orders'" class="report-panel">
            <div class="panel-title-row">
                <h2>ยอดสั่ง Order Marketplace</h2>
            </div>

            <div class="filter-row">
                <label>จากวันที่ <input v-model="orderReport.dateFrom.value" type="date" class="date-input" :disabled="orderReport.loading.value" /></label>
                <label>ถึงวันที่ <input v-model="orderReport.dateTo.value" type="date" class="date-input" :disabled="orderReport.loading.value" /></label>
                <IconField>
                    <InputIcon class="pi pi-search" />
                    <InputText v-model="orderReport.searchText.value" placeholder="ค้นหารหัส / ชื่อลูกค้า / เลขที่ใบสั่ง" :disabled="orderReport.loading.value" @keyup.enter="loadOrderReport(true)" />
                </IconField>
                <Button label="ดูรายงาน" icon="pi pi-search" size="small" :disabled="orderReport.loading.value" @click="loadOrderReport(true)" />
                <Button label="ล้าง" icon="pi pi-times" size="small" text :disabled="orderReport.loading.value" @click="orderReport.searchText.value = ''; orderReport.dateFrom.value = todayIso(); orderReport.dateTo.value = todayIso(); loadOrderReport(true)" />
                <Button label="Export Excel" icon="pi pi-file-excel" size="small" outlined severity="success" :loading="exportingReport === 'orders'" :disabled="orderReport.loading.value || !!exportingReport" @click="exportOrdersExcel" />
            </div>

            <div v-if="orderReport.summary.value" class="summary-row">
                <div class="summary-card">
                    <small>จำนวนใบสั่งซื้อ</small>
                    <strong>{{ formatQty(orderReport.summary.value.order_count) }} ใบ</strong>
                </div>
                <div class="summary-card summary-card--primary">
                    <small>ยอดสั่งรวม</small>
                    <strong>฿{{ formatMoney(orderReport.summary.value.total_amount) }}</strong>
                </div>
                <div v-if="toNum(orderReport.summary.value.cancelled_count) > 0" class="summary-card summary-card--muted">
                    <small>ใบที่ถูกยกเลิก (ไม่รวมในยอด)</small>
                    <strong>{{ formatQty(orderReport.summary.value.cancelled_count) }} ใบ</strong>
                </div>
            </div>

            <div v-if="orderReport.loading.value" class="loading-box">
                <ProgressSpinner />
                <span>กำลังโหลด...</span>
            </div>

            <div v-else class="product-table-wrap">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>เลขที่ใบสั่งซื้อ</th>
                            <th>วันที่ / เวลา</th>
                            <th>ลูกค้า</th>
                            <th class="num">ยอดสั่ง</th>
                            <th>สถานะ</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in orderReport.rows.value" :key="row.doc_no" :class="{ 'row-cancelled': row.is_cancelled }">
                            <td>{{ row.doc_no }}</td>
                            <td>{{ row.doc_date }} {{ row.doc_time }}</td>
                            <td>
                                <strong>{{ row.cust_name || '(ไม่พบชื่อในระบบ)' }}</strong>
                                <small>{{ row.cust_code }}</small>
                            </td>
                            <td class="num">{{ formatMoney(row.total_amount) }}</td>
                            <td>
                                <Tag v-if="row.is_cancelled" value="ยกเลิก" severity="danger" />
                                <span v-else class="muted">-</span>
                            </td>
                        </tr>
                        <tr v-if="orderReport.rows.value.length === 0">
                            <td colspan="5" class="empty-cell">ไม่มีใบสั่งซื้อในช่วงวันที่ที่เลือก</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="pager-row">
                <Button icon="pi pi-angle-left" text rounded aria-label="หน้าก่อนหน้า" :disabled="orderReport.page.value <= 1 || orderReport.loading.value" @click="orderReport.page.value -= 1; loadOrderReport()" />
                <span>{{ orderReport.page.value }} / {{ orderTotalPages }}</span>
                <Button icon="pi pi-angle-right" text rounded aria-label="หน้าถัดไป" :disabled="orderReport.page.value >= orderTotalPages || orderReport.loading.value" @click="orderReport.page.value += 1; loadOrderReport()" />
            </div>
        </section>

        <!-- รายงานยอดขายจาก marketplace -->
        <section v-show="activeReport === 'sales'" class="report-panel">
            <div class="panel-title-row">
                <h2>ยอดขายจาก Marketplace</h2>
                <span class="panel-hint">นับจากใบขายจริง (ใบกำกับ/ใบส่งของ) ที่เกิดจากใบสั่งซื้อ marketplace ตามวันที่ของใบขาย</span>
            </div>

            <div class="filter-row">
                <label>จากวันที่ <input v-model="saleReport.dateFrom.value" type="date" class="date-input" :disabled="saleReport.loading.value" /></label>
                <label>ถึงวันที่ <input v-model="saleReport.dateTo.value" type="date" class="date-input" :disabled="saleReport.loading.value" /></label>
                <IconField>
                    <InputIcon class="pi pi-search" />
                    <InputText v-model="saleReport.searchText.value" placeholder="ค้นหารหัส / ชื่อลูกค้า / เลขที่ใบขาย" :disabled="saleReport.loading.value" @keyup.enter="loadSaleReport(true)" />
                </IconField>
                <Button label="ดูรายงาน" icon="pi pi-search" size="small" :disabled="saleReport.loading.value" @click="loadSaleReport(true)" />
                <Button label="ล้าง" icon="pi pi-times" size="small" text :disabled="saleReport.loading.value" @click="saleReport.searchText.value = ''; saleReport.dateFrom.value = todayIso(); saleReport.dateTo.value = todayIso(); loadSaleReport(true)" />
                <Button label="Export Excel" icon="pi pi-file-excel" size="small" outlined severity="success" :loading="exportingReport === 'sales'" :disabled="saleReport.loading.value || !!exportingReport" @click="exportSalesExcel" />
            </div>

            <div v-if="saleReport.summary.value" class="summary-row">
                <div class="summary-card">
                    <small>จำนวนใบขาย</small>
                    <strong>{{ formatQty(saleReport.summary.value.invoice_count) }} ใบ</strong>
                </div>
                <div class="summary-card summary-card--primary">
                    <small>ยอดขายรวม</small>
                    <strong>฿{{ formatMoney(saleReport.summary.value.total_amount) }}</strong>
                </div>
            </div>

            <div v-if="saleReport.loading.value" class="loading-box">
                <ProgressSpinner />
                <span>กำลังโหลด...</span>
            </div>

            <div v-else class="product-table-wrap">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>เลขที่ใบขาย</th>
                            <th>วันที่</th>
                            <th>ลูกค้า</th>
                            <th class="num">ยอดขาย</th>
                            <th>อ้างอิงใบสั่งซื้อ</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in saleReport.rows.value" :key="row.doc_no">
                            <td>{{ row.doc_no }}</td>
                            <td>{{ row.doc_date }}</td>
                            <td>
                                <strong>{{ row.cust_name || '(ไม่พบชื่อในระบบ)' }}</strong>
                                <small>{{ row.cust_code }}</small>
                            </td>
                            <td class="num">{{ formatMoney(row.total_amount) }}</td>
                            <td><small class="order-refs">{{ row.order_doc_nos || '-' }}</small></td>
                        </tr>
                        <tr v-if="saleReport.rows.value.length === 0">
                            <td colspan="5" class="empty-cell">ไม่มีใบขายในช่วงวันที่ที่เลือก</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="pager-row">
                <Button icon="pi pi-angle-left" text rounded aria-label="หน้าก่อนหน้า" :disabled="saleReport.page.value <= 1 || saleReport.loading.value" @click="saleReport.page.value -= 1; loadSaleReport()" />
                <span>{{ saleReport.page.value }} / {{ saleTotalPages }}</span>
                <Button icon="pi pi-angle-right" text rounded aria-label="หน้าถัดไป" :disabled="saleReport.page.value >= saleTotalPages || saleReport.loading.value" @click="saleReport.page.value += 1; loadSaleReport()" />
            </div>
        </section>

        <!-- Dialog: ตะกร้าของลูกค้า -->
        <Dialog v-model:visible="cartDetailVisible" modal :style="{ width: 'min(720px, 94vw)' }" :header="cartDetailCustomer ? `ตะกร้าของ ${cartDetailCustomer.cust_code} — ${cartDetailCustomer.cust_name || ''}` : 'ตะกร้าลูกค้า'">
            <div v-if="cartDetailLoading" class="loading-box">
                <ProgressSpinner />
                <span>กำลังโหลดตะกร้า...</span>
            </div>

            <template v-else>
                <div class="detail-summary">
                    <span><i class="pi pi-clock"></i> active ล่าสุด: {{ formatDateTime(cartDetailCustomer?.last_active) }}</span>
                    <span>{{ formatQty(cartDetailItems.length) }} รายการ · {{ formatQty(cartDetailTotalQty) }} ชิ้น · รวม ฿{{ formatMoney(cartDetailTotalAmount) }}</span>
                </div>

                <div class="product-table-wrap">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>สินค้า</th>
                                <th class="num">จำนวน</th>
                                <th>หน่วย</th>
                                <th class="num">ราคา/หน่วย</th>
                                <th class="num">รวม</th>
                                <th>เพิ่มเมื่อ</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="item in cartDetailItems" :key="item.guid_code || `${item.item_code}-${item.unit_code}`">
                                <td>
                                    <strong>{{ item.item_name || item.item_code }}</strong>
                                    <small>{{ item.item_code }}<template v-if="item.sale_premium_code"> · โปรโมชัน {{ item.sale_premium_code }}</template></small>
                                </td>
                                <td class="num">{{ formatQty(item.qty) }}</td>
                                <td>{{ item.unit_code }}</td>
                                <td class="num">{{ formatMoney(item.price) }}</td>
                                <td class="num">{{ formatMoney(toNum(item.price) * toNum(item.qty)) }}</td>
                                <td>{{ formatDateTime(item.create_datetime) }}</td>
                            </tr>
                            <tr v-if="cartDetailItems.length === 0">
                                <td colspan="6" class="empty-cell">ตะกร้าว่าง</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </template>
        </Dialog>

        <!-- Dialog: ลูกค้าที่ใส่สินค้าตัวนี้ในตะกร้า -->
        <Dialog v-model:visible="productDialogVisible" modal :style="{ width: 'min(640px, 94vw)' }" :header="productDialogItem ? `ลูกค้าที่ใส่ ${productDialogItem.item_name || productDialogItem.item_code} ในตะกร้า` : 'ลูกค้าที่ใส่ตะกร้า'">
            <div v-if="productDialogLoading" class="loading-box">
                <ProgressSpinner />
                <span>กำลังโหลด...</span>
            </div>

            <div v-else class="product-table-wrap">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>ลูกค้า</th>
                            <th>เบอร์โทร</th>
                            <th>จำนวนในตะกร้า</th>
                            <th>ใส่ล่าสุด</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="cust in productDialogCustomers" :key="cust.cust_code">
                            <td>
                                <strong>{{ cust.cust_name || '(ไม่พบชื่อในระบบ)' }}</strong>
                                <small>{{ cust.cust_code }}</small>
                            </td>
                            <td>{{ cust.telephone || '-' }}</td>
                            <td>{{ formatCustomerLines(cust.lines) || formatQty(cust.total_qty) }}</td>
                            <td>{{ formatDateTime(cust.last_active) }} <em v-if="formatAgo(cust.last_active)" class="ago">({{ formatAgo(cust.last_active) }})</em></td>
                        </tr>
                        <tr v-if="productDialogCustomers.length === 0">
                            <td colspan="4" class="empty-cell">ไม่มีลูกค้าใส่สินค้านี้ในตะกร้า</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </Dialog>
    </main>
</template>

<style scoped>
.admin-reports-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 2rem);
    background: var(--market-surface-soft, #f7f1e5);
    color: var(--market-text, #4b3a1d);
}

.admin-reports-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    max-width: 1080px;
    margin: 0 auto 1rem;
}

.admin-reports-head p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.admin-reports-head h1 {
    margin: 0.2rem 0;
    font-size: clamp(1.5rem, 3.4vw, 2.1rem);
}

.admin-reports-head span {
    color: var(--market-muted, #8a7650);
}

.report-tabs {
    display: flex;
    gap: 0.5rem;
    max-width: 1080px;
    margin: 0 auto 0.8rem;
}

.report-tabs button {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 1rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 999px;
    background: var(--market-card-bg, #fff);
    color: var(--market-muted, #8a7650);
    font-weight: 700;
    cursor: pointer;
}

.report-tabs button.active {
    background: var(--market-primary, #0f9f6e);
    border-color: var(--market-primary, #0f9f6e);
    color: #fff;
}

.report-panel {
    max-width: 1080px;
    margin: 0 auto;
    padding: 1rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.9rem;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(120, 86, 28, 0.09));
}

.panel-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.6rem;
}

.panel-title-row h2 {
    margin: 0;
    font-size: 1.1rem;
}

.list-tools {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.7rem 0;
    color: var(--market-muted, #8a7650);
    font-size: 0.85rem;
}

.loading-box {
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    padding: 2rem 0;
    color: var(--market-muted, #8a7650);
}

.carts-table {
    display: grid;
    gap: 0.5rem;
}

.cart-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    padding: 0.7rem 0.85rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.75rem;
    background: var(--market-card-bg, #fff);
    color: inherit;
    cursor: pointer;
    text-align: left;
    transition: border-color 120ms ease, box-shadow 120ms ease;
}

.cart-row:hover {
    border-color: var(--market-primary, #0f9f6e);
    box-shadow: 0 6px 16px var(--market-shadow, rgba(120, 86, 28, 0.12));
}

.row-avatar {
    flex: 0 0 auto;
    width: 2.4rem;
    height: 2.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--market-primary-soft, #f3ead5);
    color: var(--market-primary, #0f9f6e);
}

.row-main {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
    flex: 1 1 auto;
}

.row-main strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.row-main span,
.row-main small {
    color: var(--market-muted, #8a7650);
    font-size: 0.82rem;
}

.row-meta {
    display: grid;
    gap: 0.2rem;
    justify-items: end;
    flex: 0 0 auto;
    text-align: right;
}

.meta-strong {
    font-weight: 800;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.9rem;
}

.meta-time {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--market-muted, #8a7650);
    font-size: 0.8rem;
}

.meta-time em,
.ago {
    font-style: normal;
    color: var(--market-accent, #d97706);
}

.row-arrow {
    color: var(--market-muted, #b8a67e);
}

.empty-state {
    display: grid;
    justify-items: center;
    gap: 0.4rem;
    padding: 2.2rem 0;
    color: var(--market-muted, #8a7650);
}

.empty-state i {
    font-size: 1.6rem;
}

.pager-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    margin-top: 0.8rem;
    color: var(--market-muted, #8a7650);
}

.product-table-wrap {
    overflow-x: auto;
}

.report-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}

.report-table th,
.report-table td {
    padding: 0.55rem 0.6rem;
    border-bottom: 1px solid var(--market-card-border, #eee4cd);
    text-align: left;
    vertical-align: top;
}

.report-table th {
    color: var(--market-muted, #8a7650);
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
}

.report-table td small {
    display: block;
    color: var(--market-muted, #8a7650);
    font-size: 0.78rem;
}

.report-table .num {
    text-align: right;
    white-space: nowrap;
}

.empty-cell {
    text-align: center;
    color: var(--market-muted, #8a7650);
    padding: 1.4rem 0;
}

.unit-chip {
    display: inline-block;
    margin: 0.1rem 0.25rem 0.1rem 0;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--market-primary-soft, #eef7f2);
    color: var(--market-primary, #0f9f6e);
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
}

.unit-chip--hidden {
    background: color-mix(in srgb, var(--market-muted, #8a7650) 12%, transparent);
    color: var(--market-muted, #8a7650);
    text-decoration: line-through;
}

.cart-count-btn {
    border: 1px solid var(--market-primary, #0f9f6e);
    border-radius: 999px;
    padding: 0.25rem 0.7rem;
    background: transparent;
    color: var(--market-primary, #0f9f6e);
    font-weight: 800;
    cursor: pointer;
    white-space: nowrap;
}

.cart-count-btn:hover {
    background: var(--market-primary, #0f9f6e);
    color: #fff;
}

.muted {
    color: var(--market-muted, #b8a67e);
}

.panel-hint {
    color: var(--market-muted, #8a7650);
    font-size: 0.8rem;
}

.filter-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.7rem 0;
    color: var(--market-muted, #8a7650);
    font-size: 0.85rem;
}

.filter-row label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 700;
}

.date-input {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--market-card-border, #d8cba9);
    border-radius: 0.5rem;
    background: var(--market-card-bg, #fff);
    color: var(--market-text, #4b3a1d);
    font: inherit;
}

.summary-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin: 0.4rem 0 0.9rem;
}

.summary-card {
    display: grid;
    gap: 0.15rem;
    min-width: 10rem;
    padding: 0.6rem 0.9rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.75rem;
    background: var(--market-surface-soft, #faf6ec);
}

.summary-card small {
    color: var(--market-muted, #8a7650);
    font-size: 0.75rem;
}

.summary-card strong {
    font-size: 1.15rem;
}

.summary-card--primary {
    border-color: var(--market-primary, #0f9f6e);
    background: var(--market-primary-soft, #eef7f2);
}

.summary-card--primary strong {
    color: var(--market-primary, #0f9f6e);
}

.summary-card--muted strong {
    color: var(--market-muted, #8a7650);
}

.row-cancelled td {
    opacity: 0.55;
}

.order-refs {
    color: var(--market-muted, #8a7650);
}

.detail-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.7rem;
    color: var(--market-muted, #8a7650);
    font-size: 0.88rem;
}

.detail-summary i {
    margin-right: 0.25rem;
}

@media (max-width: 640px) {
    .cart-row {
        flex-wrap: wrap;
    }

    .row-meta {
        width: 100%;
        justify-items: start;
        text-align: left;
        order: 4;
    }

    .row-arrow {
        display: none;
    }
}
</style>
