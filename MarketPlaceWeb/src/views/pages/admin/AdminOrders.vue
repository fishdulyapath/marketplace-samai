<script setup>
// หน้าหลังบ้าน "คำสั่งซื้อ" — ดูคำสั่งซื้อทุกใบที่เข้ามา
//
// ต่างจากหน้า "คำสั่งซื้อของฉัน" ของลูกค้าตรงที่ไม่จำกัดลูกค้ารายเดียว
// จึงต้องมีตัวกรองช่วงวันที่และการแบ่งหน้าเสมอ ไม่งั้นเปิดหน้ามาจะดึงทั้งฐาน
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import AdminOrderService from '@/services/AdminOrderService';
import { getOrderTotalBeforeVat } from '@/utils/orderTaxTotals';

const router = useRouter();
const toast = useToast();

const PAGE_SIZE = 20;

// รีเฟรชอัตโนมัติทุก 2 นาที
const AUTO_REFRESH_MS = 2 * 60 * 1000;

// เว้นระยะขั้นต่ำระหว่างการโหลด 2 ครั้งที่ "ระบบสั่งเอง"
//
// 🚨 ตอนแรกให้ visibilitychange สั่งโหลดทันทีทุกครั้งที่กลับมาเห็นหน้า
//    วัดจริงแล้วยิง 70 ครั้งใน 140 วินาที (ทุก 2 วินาที) เพราะเบราว์เซอร์
//    สลับสถานะซ่อน/แสดงถี่กว่าที่คิดมาก ผู้ใช้ที่สลับแท็บไปมาก็เจอแบบเดียวกัน
//    query นี้หนักระดับวินาที ถ้าปล่อยไว้คือถล่ม DB ตัวเอง
//
//    ใช้เกณฑ์เดียวกับรอบอัตโนมัติ = ข้อมูลเก่าได้ไม่เกิน 2 นาทีตามที่ตกลงไว้
//    กลับมาดูหน้าแล้วข้อมูลยังใหม่อยู่ก็ไม่ต้องยิงซ้ำ
const MIN_RELOAD_GAP_MS = AUTO_REFRESH_MS;

const orders = ref([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref('');

const page = ref(1);
const totalOrders = ref(0);
const pageAmount = ref(0);
// ช่วงวันที่ที่เซิร์ฟเวอร์ใช้จริง — รอบแรกหน้าจอยังไม่รู้ ต้องให้เซิร์ฟเวอร์บอกกลับมา
const appliedFrom = ref('');
const appliedTo = ref('');
const lastUpdatedAt = ref('');

// ค่าที่ผู้ใช้กำลังพิมพ์ (ยังไม่กดค้นหา) แยกจากค่าที่ใช้ยิงจริง
// เพื่อไม่ให้ auto refresh หยิบค่าที่พิมพ์ค้างไว้ไปใช้แล้วผลเปลี่ยนเองกลางคัน
const draft = ref({ search: '', dateFrom: '', dateTo: '' });
const applied = ref({ search: '', dateFrom: '', dateTo: '' });

const totalPages = computed(() => Math.max(1, Math.ceil(totalOrders.value / PAGE_SIZE)));
const rangeStart = computed(() => (totalOrders.value === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1));
const rangeEnd = computed(() => Math.min(page.value * PAGE_SIZE, totalOrders.value));

// Unified history starts on All so pending requests and confirmed QTs are both visible.
const STATUS_TABS = [
    { value: 'awaiting_confirmation', label: 'รอพนักงานยืนยัน' },
    { value: 'pending', label: 'รอตรวจสอบ' },
    { value: '', label: 'ทั้งหมด' },
    { value: 'packing', label: 'กำลังจัดสินค้า' },
    { value: 'payment', label: 'เตรียมนำส่ง - กำลังนำส่ง' },
    { value: 'success', label: 'จัดส่งสำเร็จ' },
    { value: 'cancel', label: 'ยกเลิก / ติดต่อพนักงาน' },
    { value: 'cancelled', label: 'ลูกค้ายกเลิก' },
    { value: 'rejected', label: 'พนักงานปฏิเสธ' }
];
const statusTab = ref('');
const statusCounts = ref({});

function tabCount(value) {
    if (value === '') return Object.values(statusCounts.value).reduce((a, b) => a + Number(b || 0), 0);
    return Number(statusCounts.value[value] || 0);
}

function selectTab(value) {
    if (loading.value || statusTab.value === value) return;
    statusTab.value = value;
    page.value = 1;
    load();
}

// ป้าย/สี/ไอคอนชุดเดียวกับหน้า "คำสั่งซื้อของฉัน" ของลูกค้า ให้ตากลุ่มเดียวกัน
const STATUS_META = {
    awaiting_confirmation: { label: 'รอพนักงานยืนยัน', cls: 'is-pending', icon: 'pi pi-clock' },
    cancelled: { label: 'ลูกค้ายกเลิก', cls: 'is-cancel', icon: 'pi pi-times-circle' },
    rejected: { label: 'พนักงานปฏิเสธ', cls: 'is-cancel', icon: 'pi pi-ban' },
    pending: { label: 'รอตรวจสอบ', cls: 'is-pending', icon: 'pi pi-clock' },
    packing: { label: 'กำลังจัดสินค้า', cls: 'is-progress', icon: 'pi pi-box' },
    payment: { label: 'เตรียมนำส่ง - กำลังนำส่ง', cls: 'is-progress', icon: 'pi pi-send' },
    success: { label: 'จัดส่งสำเร็จ', cls: 'is-success', icon: 'pi pi-check-circle' },
    cancel: { label: 'ยกเลิก / ติดต่อพนักงาน', cls: 'is-cancel', icon: 'pi pi-times-circle' }
};

// สรุปความคืบหน้ารายใบให้อ่านได้ในบรรทัดเดียว เช่น "จัดสินค้า 1 · รอตรวจสอบ 1"
function progressText(order) {
    const counts = {};
    for (const d of order?.sub_docs || []) {
        if (d.status === 'cancel') continue;
        counts[d.status] = (counts[d.status] || 0) + 1;
    }
    return Object.entries(counts)
        .map(([st, n]) => `${STATUS_META[st]?.label || st} ${n}`)
        .join(' · ');
}

function statusOf(status) {
    return STATUS_META[status] || { label: status || '-', cls: 'is-muted', icon: 'pi pi-circle' };
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// วันที่จาก API เป็น YYYY-MM-DD (::text) อยู่แล้ว แปลงเป็น dd/mm/พ.ศ. โดยไม่ผ่าน Date
// เพื่อเลี่ยงปัญหาโซนเวลาที่เคยทำให้วันเลื่อนไป 1 วัน
function formatDate(isoDate) {
    const text = String(isoDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || '-';
    const [y, m, d] = text.split('-');
    return d + '/' + m + '/' + (Number(y) + 543);
}

// ── dialog รายละเอียดคำสั่งซื้อ ─────────────────────────────────────
const detailVisible = ref(false);
const detailOrder = ref(null);
const detailItems = ref([]);
const detailUnmapped = ref([]);
const detailLoading = ref(false);
const detailTotalItems = ref(0);
const detailPage = ref(1);
const DETAIL_PAGE_SIZE = 100;

async function openDetail(order) {
    detailOrder.value = order;
    detailVisible.value = true;
    detailItems.value = [];
    detailUnmapped.value = [];
    detailTotalItems.value = 0;
    detailPage.value = 1;
    await loadDetailItems();
}

async function loadDetailItems(append = false) {
    if (!detailOrder.value) return;
    detailLoading.value = true;
    try {
        const nextPage = append ? detailPage.value + 1 : 1;
        const res = await AdminOrderService.getOrderDetail(detailOrder.value.cust_code, detailOrder.value.doc_no, nextPage, DETAIL_PAGE_SIZE);
        const body = res?.data || {};
        const batch = body?.data?.items || [];
        detailUnmapped.value = body?.data?.unmapped_items || [];
        detailItems.value = append ? [...detailItems.value, ...batch] : batch;
        detailPage.value = nextPage;
        detailTotalItems.value = Number(body?.paging?.total_items ?? detailItems.value.length);
    } catch (err) {
        toast.add({ severity: 'error', summary: 'โหลดรายการสินค้าไม่สำเร็จ', detail: err?.message || '', life: 4000 });
    } finally {
        detailLoading.value = false;
    }
}

const detailHasMore = computed(() => detailItems.value.length < detailTotalItems.value);

// ใบที่ออกบิลแล้ว = รายการที่ไม่อยู่ในบิลคือถูกตัดออกจริง
// ใบที่ยังจัดของอยู่ = อาจยังทยอยจัดไม่ครบ ยังไม่ใช่การตัดออก
const detailSettled = computed(() => ['payment', 'success'].includes(detailOrder.value?.status));

// ใบ preorder = ของยังไม่มีในสต็อก ต้องสั่งเข้ามาก่อนถึงจะจัดได้
// หน้าลูกค้ามีป้ายบอกอยู่แล้ว แต่หน้านี้ซึ่งเป็นคนจัดของจริงกลับไม่มี
// ระบบเก่าออกเลขขึ้นต้น PREQT ส่วนระบบใหม่ใช้ remark ต้องดูทั้งสองทาง
function isPreorder(order) {
    if (/^PREQT/i.test(String(order?.doc_no || '').trim())) return true;
    return String(order?.remark_qt || '')
        .trim()
        .toUpperCase()
        .split(/\s+/)
        .includes('PREORDER');
}

// ยอดที่ออกบิลจริง ต่างจากยอดที่สั่งเมื่อ ERP ตัดรายการออก — ต้องโชว์คู่กัน
function invoicedDiff(order) {
    const invoiced = Number(order?.invoiced_amount || 0);
    const ordered = Number(order?.total_amount || 0);
    if (invoiced <= 0 || Math.abs(invoiced - ordered) < 0.01) return null;
    return invoiced;
}

// จัดกลุ่มบรรทัดตามเอกสารย่อย — คำสั่งซื้อที่เกินลิมิตบรรทัด (erp_max_lines_per_doc)
// ถูกแตกเป็นหลายใบใน ERP แอดมินต้องเห็นว่าบรรทัดไหนอยู่ใบไหน จะได้ตามเอกสารใน ERP ถูก
const detailGroups = computed(() => {
    const groups = [];
    const byDoc = new Map();
    for (const it of detailItems.value) {
        const key = String(it.doc_no || detailOrder.value?.doc_no || '');
        if (!byDoc.has(key)) {
            const g = { doc_no: key, items: [], subtotal: 0 };
            byDoc.set(key, g);
            groups.push(g);
        }
        const g = byDoc.get(key);
        g.items.push(it);
        g.subtotal += Number(it.sum_amount) || 0;
    }
    // ติดสถานะรายใบจาก sub_docs (ERP อาจยกเลิกเฉพาะบางใบ)
    const statusByDoc = new Map((detailOrder.value?.sub_docs || []).map((d) => [String(d.doc_no), d.status]));
    for (const g of groups) {
        g.status = statusByDoc.get(g.doc_no) || '';
        g.cancelled = g.status === 'cancel';
    }
    return groups;
});

let inFlight = null;
let timer = null;
let lastLoadStartedAt = 0;

async function load({ silent = false, throttle = false } = {}) {
    // throttle ใช้เฉพาะรอบที่ระบบสั่งเอง (กลับมาเห็นหน้า) — ที่ผู้ใช้กดเองต้องทำงานทันทีเสมอ
    if (throttle && Date.now() - lastLoadStartedAt < MIN_RELOAD_GAP_MS) return;

    // กันคำขอซ้อนกัน — auto refresh อาจมาชนกับที่ผู้ใช้กดค้นหาเอง
    if (inFlight) inFlight.abort();
    lastLoadStartedAt = Date.now();
    const controller = new AbortController();
    inFlight = controller;

    if (silent) refreshing.value = true;
    else loading.value = true;
    errorMessage.value = '';

    try {
        const res = await AdminOrderService.getOrders({
            search: applied.value.search,
            dateFrom: applied.value.dateFrom,
            dateTo: applied.value.dateTo,
            status: statusTab.value,
            page: page.value,
            pageSize: PAGE_SIZE,
            signal: controller.signal
        });
        const body = res?.data || {};
        orders.value = Array.isArray(body.data) ? body.data : [];
        totalOrders.value = Number(body.total_orders || 0);
        pageAmount.value = Number(body.page_amount || 0);
        appliedFrom.value = body.date_from || '';
        appliedTo.value = body.date_to || '';
        statusCounts.value = body.status_counts || {};
        // เติมช่องวันที่ให้ผู้ใช้เห็นว่าระบบเลือกช่วงไหนให้ ตอนเข้าหน้าครั้งแรก
        if (!draft.value.dateFrom) draft.value.dateFrom = appliedFrom.value;
        if (!draft.value.dateTo) draft.value.dateTo = appliedTo.value;
        lastUpdatedAt.value = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (err) {
        // คำขอที่ถูกยกเลิกเองไม่ใช่ error ของผู้ใช้ ไม่ต้องแสดงอะไร
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        const msg = err?.response?.data?.ERROR || err?.response?.data?.message || err?.message || 'ไม่สามารถโหลดคำสั่งซื้อได้';
        errorMessage.value = msg;
        // รอบ auto refresh ไม่ต้องเด้ง toast รบกวน แสดงบนหน้าพอ
        if (!silent) toast.add({ severity: 'error', summary: 'โหลดข้อมูลไม่สำเร็จ', detail: msg, life: 4000 });
    } finally {
        if (inFlight === controller) inFlight = null;
        loading.value = false;
        refreshing.value = false;
    }
}

function applyFilters() {
    applied.value = { ...draft.value };
    page.value = 1;
    load();
}

function clearFilters() {
    draft.value = { search: '', dateFrom: '', dateTo: '' };
    applied.value = { search: '', dateFrom: '', dateTo: '' };
    statusTab.value = '';
    page.value = 1;
    load();
}

function goPage(next) {
    const target = Math.min(Math.max(1, next), totalPages.value);
    if (target === page.value) return;
    page.value = target;
    load();
}

// ── รีเฟรชอัตโนมัติ ──────────────────────────────────────────────────
//
// ข้ามรอบเมื่อผู้ใช้สลับไปแท็บอื่น แล้วยิงทันทีตอนกลับมา
// ไม่งั้นแท็บที่เปิดค้างไว้ข้ามคืนจะยิงทิ้งเปล่าหลายร้อยครั้ง
function startAutoRefresh() {
    stopAutoRefresh();
    timer = setInterval(() => {
        if (document.hidden) return;
        load({ silent: true });
    }, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
    if (timer) clearInterval(timer);
    timer = null;
}

function onVisibilityChange() {
    if (!document.hidden) load({ silent: true, throttle: true });
}

onMounted(() => {
    load();
    startAutoRefresh();
    document.addEventListener('visibilitychange', onVisibilityChange);
});

onBeforeUnmount(() => {
    stopAutoRefresh();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (inFlight) inFlight.abort();
});
</script>

<template>
    <div class="ao-page">
        <div class="ao-head">
            <div>
                <span class="ao-eyebrow">BACK OFFICE</span>
                <h1 class="ao-title">คำสั่งซื้อ</h1>
                <p class="ao-subtitle">ดูสถานะคำสั่งซื้อทุกใบที่เข้ามา ค้นหาด้วยรหัส/ชื่อลูกค้า หรือเลขที่คำสั่งซื้อ</p>
            </div>
            <div class="ao-head__actions">
                <Button label="เมนูหลัก" icon="pi pi-arrow-left" outlined size="small" @click="router.push('/admin')" />
                <Button label="รีเฟรช" icon="pi pi-refresh" size="small" :loading="loading || refreshing" @click="load()" />
            </div>
        </div>

        <div class="ao-filters">
            <div class="ao-field ao-field--grow">
                <label for="ao-search">ค้นหา</label>
                <InputText id="ao-search" v-model="draft.search" placeholder="รหัสลูกค้า / ชื่อลูกค้า / เลขที่คำสั่งซื้อ" @keyup.enter="applyFilters" />
            </div>
            <div class="ao-field">
                <label for="ao-from">จากวันที่</label>
                <input id="ao-from" v-model="draft.dateFrom" type="date" class="ao-date" />
            </div>
            <div class="ao-field">
                <label for="ao-to">ถึงวันที่</label>
                <input id="ao-to" v-model="draft.dateTo" type="date" class="ao-date" />
            </div>
            <div class="ao-field ao-field--buttons">
                <Button label="ค้นหา" icon="pi pi-search" size="small" @click="applyFilters" />
                <Button label="ล้างตัวกรอง" icon="pi pi-times" text size="small" @click="clearFilters" />
            </div>
        </div>

        <div class="ao-tabs" role="tablist">
            <button
                v-for="tab in STATUS_TABS"
                :key="tab.value"
                type="button"
                role="tab"
                :aria-selected="statusTab === tab.value"
                :class="['ao-tab', { 'is-active': statusTab === tab.value }]"
                :disabled="loading"
                @click="selectTab(tab.value)"
            >
                {{ tab.label }}
                <span v-if="tabCount(tab.value) > 0" :class="['ao-tab__count', { 'is-alert': tab.value === 'pending' }]">{{ tabCount(tab.value).toLocaleString('th-TH') }}</span>
            </button>
        </div>

        <div class="ao-metrics">
            <div class="ao-metric">
                <span class="ao-metric__label">คำสั่งซื้อทั้งหมด</span>
                <strong class="ao-metric__value">{{ totalOrders.toLocaleString('th-TH') }}</strong>
            </div>
            <div class="ao-metric">
                <span class="ao-metric__label">ยอดรวมในหน้านี้</span>
                <strong class="ao-metric__value">฿{{ formatMoney(pageAmount) }}</strong>
            </div>
            <div class="ao-metric">
                <span class="ao-metric__label">ช่วงวันที่</span>
                <strong class="ao-metric__value ao-metric__value--sm">{{ formatDate(appliedFrom) }} – {{ formatDate(appliedTo) }}</strong>
            </div>
            <div class="ao-metric ao-metric--muted">
                <span class="ao-metric__label">อัปเดตล่าสุด</span>
                <strong class="ao-metric__value ao-metric__value--sm">
                    {{ lastUpdatedAt || '-' }}
                    <i v-if="refreshing" class="pi pi-spin pi-spinner ao-metric__spin"></i>
                </strong>
                <span class="ao-metric__hint">รีเฟรชอัตโนมัติทุก 2 นาที</span>
            </div>
        </div>

        <Message v-if="errorMessage" severity="error" :closable="false" class="mb-3">{{ errorMessage }}</Message>

        <div class="ao-list">
            <div v-if="loading" class="ao-empty"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลด...</div>
            <div v-else-if="orders.length === 0" class="ao-empty">
                ไม่พบคำสั่งซื้อ{{ statusTab ? 'สถานะ "' + (STATUS_TABS.find((t) => t.value === statusTab)?.label || '') + '"' : '' }}ในช่วง {{ formatDate(appliedFrom) }} – {{ formatDate(appliedTo) }}
                <div class="ao-empty__hint">ลองขยายช่วงวันที่ หรือล้างตัวกรอง</div>
            </div>
            <div v-for="order in orders" v-else :key="order.doc_no" class="aoc">
                <!-- หัวการ์ด: เลขที่ + พนักงาน · สถานะขวา -->
                <div class="aoc__head">
                    <div class="aoc__head-left">
                        <i class="pi pi-shopping-bag aoc__doc-icon"></i>
                        <button type="button" class="aoc__doc" @click="openDetail(order)">{{ order.doc_no }}</button>
                        <span v-if="order.mpr_doc_no && order.qt_doc_nos?.length" class="text-xs text-gray-500 break-all">QT: {{ order.qt_doc_nos.join(', ') }}</span>
                        <span v-if="order.emp_name || order.emp_code" class="aoc__emp"><i class="pi pi-user"></i> {{ order.emp_name || order.emp_code }}</span>
                        <span v-if="Number(order.cancelled_doc_count) > 0 && order.status !== 'cancel'" class="aoc__partial-cancel">
                            <i class="pi pi-exclamation-triangle"></i> ยกเลิกบางเอกสาร {{ order.cancelled_doc_count }}/{{ order.sub_doc_count }} ใบ
                        </span>
                        <!-- ใบย่อยเดินไปคนละ step — สถานะรวมใช้ใบที่ช้าสุด ต้องบอกว่ามีใบอื่นคืบหน้าแล้ว -->
                        <span v-if="isPreorder(order)" class="aoc__preorder">
                            <i class="pi pi-clock"></i> พรีออเดอร์
                        </span>
                        <span v-if="order.mixed_progress" class="aoc__mixed" :title="progressText(order)">
                            <i class="pi pi-sort-alt"></i> {{ progressText(order) }}
                        </span>
                    </div>
                    <span :class="['aoc__status', statusOf(order.status).cls]"><i :class="statusOf(order.status).icon"></i> {{ statusOf(order.status).label }}</span>
                </div>

                <!-- เนื้อการ์ด: ซ้ายข้อมูล ขวายอดรวม -->
                <div class="aoc__body">
                    <div class="aoc__info">
                        <div class="aoc__meta">
                            {{ formatDate(order.doc_date) }} {{ order.doc_time }}
                            <span class="aoc__send"><i :class="String(order.send_type) === '1' ? 'pi pi-truck' : 'pi pi-home'"></i> {{ String(order.send_type) === '1' ? 'จัดส่ง' : 'รับที่ร้าน' }}</span>
                        </div>
                        <div class="aoc__cust">
                            <span class="aoc__cust-name">{{ order.cust_code }} · {{ order.cust_name || '-' }}</span>
                            <span v-if="order.contact_telephone" class="aoc__tel"><i class="pi pi-phone"></i> {{ order.contact_telephone }}</span>
                        </div>
                        <div v-if="String(order.send_type) === '1' && order.ship_address" class="aoc__addr">
                            <i class="pi pi-map-marker"></i> {{ order.ship_address }}
                        </div>
                        <div class="aoc__vat">ยอดก่อน VAT: ฿{{ formatMoney(getOrderTotalBeforeVat(order)) }} &nbsp; VAT: ฿{{ formatMoney(order.total_vat_value) }}</div>
                    </div>
                    <div class="aoc__total">
                        <span class="aoc__total-label">รวมการสั่งซื้อ:</span>
                        <span class="aoc__total-amount">฿{{ formatMoney(order.total_amount) }}</span>
                        <span v-if="order.document_total_amount !== null && Number(order.request_total_amount) !== Number(order.total_amount)" class="aoc__net">ยอดคำขอเดิม ฿{{ formatMoney(order.request_total_amount) }}</span>
                        <!-- ยกเลิกบางใบ = ยอดข้างบนสูงกว่ายอดที่เก็บได้จริง ต้องบอกให้เห็น -->
                        <span v-if="Number(order.cancelled_amount) > 0 && order.status !== 'cancel'" class="aoc__net">
                            สุทธิ ฿{{ formatMoney(order.active_amount) }}
                        </span>
                        <span v-if="invoicedDiff(order)" class="aoc__net aoc__net--invoiced">
                            ออกบิลจริง ฿{{ formatMoney(invoicedDiff(order)) }}
                        </span>
                    </div>
                </div>

                <!-- ท้ายการ์ด: ปุ่มแบบเดียวกับหน้าลูกค้า -->
                <div v-if="order.reason" class="px-4 py-2 text-sm text-red-600">{{ order.reason }}</div>
                <div class="aoc__foot">
                    <button type="button" class="aoc-btn aoc-btn--outline" @click="openDetail(order)">รายละเอียด</button>
                </div>
            </div>
        </div>

        <!-- Dialog รายละเอียดเอกสารและสินค้าที่สั่ง -->
        <Dialog v-model:visible="detailVisible" :header="'รายละเอียดคำสั่งซื้อ ' + (detailOrder?.doc_no || '')" :style="{ width: '95%', maxWidth: '900px' }" :modal="true" :closeOnEscape="true" :dismissableMask="true">
            <div v-if="detailOrder" class="aod">
                <!-- แถบสรุปหัวเอกสาร -->
                <div class="aod__band">
                    <div>
                        <div class="aod__doc">{{ detailOrder.doc_no }}</div>
                        <div v-if="detailOrder.mpr_doc_no && detailOrder.qt_doc_nos?.length" class="text-xs break-all">QT: {{ detailOrder.qt_doc_nos.join(', ') }}</div>
                        <div v-if="detailOrder.reason" class="text-sm text-red-600">{{ detailOrder.reason }}</div>
                        <div class="aod__date">{{ formatDate(detailOrder.doc_date) }} {{ detailOrder.doc_time }}</div>
                    </div>
                    <div class="aod__band-right">
                        <span class="aod__total">฿{{ formatMoney(detailOrder.total_amount) }}</span>
                        <span v-if="detailOrder.document_total_amount !== null && Number(detailOrder.request_total_amount) !== Number(detailOrder.total_amount)" class="text-xs text-gray-500">ยอดคำขอเดิม ฿{{ formatMoney(detailOrder.request_total_amount) }}</span>
                        <span :class="['aod__tag', statusOf(detailOrder.status).cls]"><i :class="statusOf(detailOrder.status).icon"></i> {{ statusOf(detailOrder.status).label }}</span>
                        <span v-if="isPreorder(detailOrder)" class="aod__preorder"><i class="pi pi-clock"></i> พรีออเดอร์ — ของยังไม่เข้าคลัง</span>
                    </div>
                </div>

                <!-- ลูกค้า / การจัดส่ง -->
                <div class="aod__grid">
                    <div class="aod__box">
                        <div class="aod__box-title"><i class="pi pi-user"></i> ข้อมูลลูกค้า</div>
                        <div class="aod__row"><span>รหัสลูกค้า:</span><b>{{ detailOrder.cust_code }}</b></div>
                        <div class="aod__row"><span>ชื่อลูกค้า:</span><b>{{ detailOrder.cust_name || '-' }}</b></div>
                        <div class="aod__row"><span>เบอร์โทรศัพท์:</span><b>{{ detailOrder.contact_telephone || '-' }}</b></div>
                    </div>
                    <div class="aod__box">
                        <div class="aod__box-title"><i class="pi pi-truck"></i> ข้อมูลการจัดส่ง</div>
                        <div class="aod__row"><span>วิธีการรับสินค้า:</span><b>{{ String(detailOrder.send_type) === '1' ? 'จัดส่ง' : 'รับที่ร้าน' }}</b></div>
                        <div v-if="String(detailOrder.send_type) === '1'" class="aod__row"><span>ที่อยู่จัดส่ง:</span><b>{{ detailOrder.ship_address || '-' }}</b></div>
                        <div class="aod__row"><span>พนักงาน:</span><b>{{ detailOrder.emp_name || detailOrder.emp_code || '-' }}</b></div>
                    </div>
                </div>

                <!-- รายการสินค้า -->
                <div class="aod__items-title"><i class="pi pi-shopping-cart"></i> รายการสินค้า ({{ detailItems.length }} / {{ detailTotalItems }} รายการ)</div>
                <div class="aod__table-wrap">
                    <table class="aod__table">
                        <thead>
                            <tr><th>สินค้า</th><th>หน่วย</th><th class="aod-right">ราคา</th><th class="aod-right">จำนวน</th><th class="aod-right">รวม</th></tr>
                        </thead>
                        <tbody>
                            <tr v-if="detailLoading && detailItems.length === 0"><td colspan="5" class="aod__empty"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลด...</td></tr>
                            <tr v-else-if="detailItems.length === 0"><td colspan="5" class="aod__empty">ไม่พบรายการสินค้าในคำสั่งซื้อนี้</td></tr>
                            <template v-for="(g, gi) in detailGroups" v-else :key="g.doc_no">
                                <!-- หัวใบย่อย — โชว์เมื่อคำสั่งซื้อถูกแตกเป็นหลายเอกสารเท่านั้น -->
                                <tr v-if="detailGroups.length > 1" :class="['aod__doc-row', { 'is-cancelled': g.cancelled }]">
                                    <td colspan="4">
                                        <i class="pi pi-file"></i> เอกสารที่ {{ gi + 1 }}: <b>{{ g.doc_no }}</b>
                                        <span class="aod__doc-count">{{ g.items.length }} รายการ</span>
                                        <!-- ใบย่อยแต่ละใบเดินไป step ของตัวเอง แสดงสถานะของใบนั้นตรงๆ -->
                                        <span v-if="g.status" :class="['aod__doc-status', statusOf(g.status).cls]"><i :class="statusOf(g.status).icon"></i> {{ statusOf(g.status).label }}</span>
                                    </td>
                                    <td class="aod-right"><b :class="{ 'aod__struck': g.cancelled }">฿{{ formatMoney(g.subtotal) }}</b></td>
                                </tr>
                                <template v-for="(it, idx) in g.items" :key="g.doc_no + '-' + (it.line_number ?? idx)">
                                <tr :class="{ 'aod__row-cancelled': g.cancelled }">
                                    <td>
                                        <span class="aod__item-name">{{ it.item_name }}</span>
                                        <span class="aod__item-code">รหัส: {{ it.item_code }}
                                            <span v-if="Number(it.is_permium) === 1" class="aod__gift">ของแถม</span>
                                        <!-- ERP ยกเลิกสินค้าเฉพาะรายการด้วยการลบออกตอนทำเอกสารขั้นถัดไป
                                             ใบสั่งซื้อยังมีของครบเสมอ ยอดบิลจริงจึงน้อยกว่ายอดที่สั่ง -->
                                        <span v-if="it.ship_state === 'added'" class="aod__added">ร้านเพิ่มให้ตอนจัดของ</span>
                                        <span v-else-if="it.ship_state === 'none'" :class="['aod__notship', { 'is-removed': detailSettled }]">
                                            {{ detailSettled ? 'ถูกตัดออกจากบิล' : 'ยังไม่ถูกจัดลงบิล' }}
                                        </span>
                                        <span v-else-if="it.ship_state === 'partial'" :class="['aod__notship', { 'is-removed': detailSettled }]">
                                            จัดลงบิล {{ Number(it.shipped_qty) }} จาก {{ Number(it.qty) }}
                                        </span>
                                        <span v-else-if="it.ship_state === 'unknown'" class="aod__notship">รอตรวจสอบความคืบหน้ารายการ</span>
                                        </span>
                                    </td>
                                    <td>{{ it.unit_code }}</td>
                                    <td class="aod-right">฿{{ formatMoney(it.price) }}</td>
                                    <td class="aod-right">{{ Number(it.qty).toLocaleString('th-TH') }}</td>
                                    <td class="aod-right"><b>฿{{ formatMoney(it.sum_amount) }}</b></td>
                                </tr>
                                <tr v-for="child in it.sub_item || []" :key="'set-' + child.line_number" class="bg-purple-50">
                                    <td class="pl-6">↳ {{ child.item_name }} <small>{{ child.item_code }}</small></td>
                                    <td>{{ child.unit_code }}</td><td></td><td class="aod-right">{{ Number(child.qty) }}</td><td></td>
                                </tr>
                                <tr v-for="allocation in it.qt_allocations || []" :key="allocation.doc_no + '-' + allocation.line_number" class="bg-emerald-50" data-testid="qt-allocation">
                                    <td class="pl-6">
                                        <span class="aod__item-name">↳ {{ allocation.item_name }}</span>
                                        <span class="aod__item-code">{{ allocation.item_code }} · QT {{ allocation.doc_no }}</span>
                                        <span class="aod__item-code">คลัง {{ allocation.wh_code || '-' }} / ที่เก็บ {{ allocation.shelf_code || '-' }}</span>
                                        <div v-for="component in allocation.sub_item || []" :key="component.line_number" class="text-xs pl-4 mt-1">
                                            {{ component.item_code }} · {{ component.item_name }} × {{ Number(component.qty) }} {{ component.unit_code }} · {{ component.wh_code }} / {{ component.shelf_code }}
                                        </div>
                                    </td>
                                    <td>{{ allocation.unit_code }}</td><td class="aod-right">฿{{ formatMoney(allocation.price) }}</td>
                                    <td class="aod-right">{{ Number(allocation.qty) }}</td><td class="aod-right">฿{{ formatMoney(allocation.sum_amount) }}</td>
                                </tr>
                                </template>
                            </template>
                        </tbody>
                    </table>
                </div>
                <div v-if="detailHasMore" class="aod__more">
                    <Button label="โหลดเพิ่มเติม" icon="pi pi-angle-down" text size="small" :loading="detailLoading" @click="loadDetailItems(true)" />
                </div>
                <section v-if="detailUnmapped.length" class="p-3 mt-3 border border-amber-300 rounded bg-amber-50">
                    <h3 class="font-semibold">รายการที่ไม่พบความสัมพันธ์กับ MPR</h3>
                    <p class="text-sm">แสดงเพื่ออ้างอิง ไม่รวมซ้ำในยอดคำขอ</p>
                    <div v-for="item in detailUnmapped" :key="item.doc_no + '-' + item.line_number" class="mt-2 text-sm">
                        {{ item.item_code }} · {{ item.item_name }} × {{ Number(item.qty) }} {{ item.unit_code }}
                        · QT {{ item.doc_no }} · {{ item.wh_code }} / {{ item.shelf_code }}
                    </div>
                </section>

                <!-- สรุปภาษี -->
                <div class="aod__sum">
                    <!-- ยอดใบเป็นยอดหลังหักลดหนี้ — โชว์ลดหนี้ด้วย ไม่งั้นบวกบรรทัดแล้วไม่ตรงจะงง -->
                    <div v-if="Number(detailOrder.cancelled_amount) > 0" class="aod__sum-row aod__sum-row--warn">
                        <span>ยอดเอกสารที่ถูกยกเลิก ({{ detailOrder.cancelled_doc_count }} ใบ):</span><span>-฿{{ formatMoney(detailOrder.cancelled_amount) }}</span>
                    </div>
                    <div v-if="Number(detailOrder.cn_total_amount) > 0" class="aod__sum-row"><span>ยอดลดหนี้รวม:</span><span>-฿{{ formatMoney(detailOrder.cn_total_amount) }}</span></div>
                    <div class="aod__sum-row"><span>ยอดก่อน VAT:</span><span>฿{{ formatMoney(getOrderTotalBeforeVat(detailOrder)) }}</span></div>
                    <div class="aod__sum-row"><span>ยอดภาษี (VAT):</span><span>฿{{ formatMoney(detailOrder.total_vat_value) }}</span></div>
                    <div class="aod__sum-row aod__sum-row--grand"><span>รวมทั้งสิ้น:</span><span>฿{{ formatMoney(detailOrder.total_amount) }}</span></div>
                    <div v-if="invoicedDiff(detailOrder)" class="aod__sum-row aod__sum-row--net">
                        <span>ยอดออกบิลจริง:</span><span>฿{{ formatMoney(invoicedDiff(detailOrder)) }}</span>
                    </div>
                    <div v-if="Number(detailOrder.cancelled_amount) > 0" class="aod__sum-row aod__sum-row--net">
                        <span>ยอดสุทธิหลังหักใบที่ยกเลิก:</span><span>฿{{ formatMoney(detailOrder.active_amount) }}</span>
                    </div>
                </div>
            </div>
        </Dialog>

        <div v-if="totalOrders > 0" class="ao-pager">
            <span class="ao-pager__info">แสดง {{ rangeStart.toLocaleString('th-TH') }}–{{ rangeEnd.toLocaleString('th-TH') }} จาก {{ totalOrders.toLocaleString('th-TH') }} รายการ</span>
            <div class="ao-pager__buttons">
                <Button icon="pi pi-angle-double-left" text size="small" :disabled="page === 1 || loading" aria-label="หน้าแรก" @click="goPage(1)" />
                <Button icon="pi pi-angle-left" text size="small" :disabled="page === 1 || loading" aria-label="หน้าก่อน" @click="goPage(page - 1)" />
                <span class="ao-pager__page">หน้า {{ page }} / {{ totalPages }}</span>
                <Button icon="pi pi-angle-right" text size="small" :disabled="page >= totalPages || loading" aria-label="หน้าถัดไป" @click="goPage(page + 1)" />
                <Button icon="pi pi-angle-double-right" text size="small" :disabled="page >= totalPages || loading" aria-label="หน้าสุดท้าย" @click="goPage(totalPages)" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.ao-page {
    padding: 1.25rem;
    max-width: 1280px;
    margin: 0 auto;
}

.ao-head {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 1.25rem;
}

.ao-eyebrow {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--market-primary, #0f9f6e);
}

.ao-title {
    margin: 0.2rem 0 0;
    font-size: 1.5rem;
    font-weight: 700;
}

.ao-subtitle {
    margin: 0.25rem 0 0;
    font-size: 0.86rem;
    color: #6b7280;
}

.ao-head__actions {
    display: flex;
    gap: 0.5rem;
}

.ao-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
    background: var(--market-card-bg, #fff);
    margin-bottom: 1rem;
}

.ao-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 170px;
}

.ao-field--grow {
    flex: 1 1 260px;
}

.ao-field--buttons {
    flex-direction: row;
    align-items: flex-end;
    gap: 0.4rem;
    min-width: auto;
}

.ao-field label {
    font-size: 0.78rem;
    font-weight: 600;
    color: #4b5563;
}

.ao-date {
    /* สูงอย่างน้อย 40px ให้เท่ากับ InputText ของ PrimeVue และกดง่ายบนมือถือ */
    min-height: 40px;
    padding: 0.5rem 0.7rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font: inherit;
    background: #fff;
    color: inherit;
}

.ao-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.4rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--market-card-border, #e6ebef);
}

.ao-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 42px;
    padding: 0.45rem 0.15rem;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    color: #4b5563;
    margin-bottom: -1px;
}

.ao-tab:hover {
    color: #111827;
}

.ao-tab.is-active {
    color: #dc2626;
    border-bottom-color: #dc2626;
    font-weight: 600;
}

.ao-tab:disabled {
    opacity: 0.6;
    cursor: wait;
}

.ao-tab__count {
    min-width: 1.35rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: #f3f4f6;
    color: #6b7280;
    font-size: 0.72rem;
    font-weight: 700;
    text-align: center;
}

/* ตัวเลขออเดอร์ใหม่ต้องสะดุดตา */
.ao-tab__count.is-alert {
    background: #dc2626;
    color: #fff;
}

.ao-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
}

.ao-metric {
    padding: 0.85rem 1rem;
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
    background: var(--market-card-bg, #fff);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.ao-metric--muted {
    background: #f9fafb;
}

.ao-metric__label {
    font-size: 0.76rem;
    color: #6b7280;
}

.ao-metric__value {
    font-size: 1.25rem;
    font-weight: 700;
}

.ao-metric__value--sm {
    font-size: 0.95rem;
}

.ao-metric__spin {
    font-size: 0.8rem;
    margin-inline-start: 0.35rem;
    color: var(--market-primary, #0f9f6e);
}

.ao-metric__hint {
    font-size: 0.7rem;
    color: #9ca3af;
}

/* ── การ์ดคำสั่งซื้อ — โครงเดียวกับหน้า "คำสั่งซื้อของฉัน" ── */
.ao-list {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
}

.aoc {
    background: var(--market-card-bg, #fff);
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
    overflow: hidden;
}

.aoc__head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.8rem 1.1rem;
    border-bottom: 1px solid #f1f5f9;
}

.aoc__head-left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
}

.aoc__doc-icon {
    color: #6b7280;
}

.aoc__doc {
    font-weight: 700;
    color: #111827;
    border: none;
    background: none;
    font: inherit;
    font-weight: 700;
    padding: 0;
    cursor: pointer;
}

.aoc__doc:hover {
    color: #dc2626;
    text-decoration: underline;
}

.aoc__emp {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.6rem;
    border-radius: 999px;
    background: #f3f4f6;
    color: #6b7280;
    font-size: 0.78rem;
}

.aoc__status {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
}

.is-pending { color: #d97706; }
.is-progress { color: #2563eb; }
.is-info { color: #0284c7; }
.is-success { color: #16a34a; }
.is-cancel { color: #dc2626; }
.is-muted { color: #6b7280; }

.aoc__body {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    align-items: flex-end;
    justify-content: space-between;
    padding: 0.85rem 1.1rem 1rem;
}

.aoc__info {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
    flex: 1 1 320px;
}

.aoc__meta {
    font-size: 0.85rem;
    color: #6b7280;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.9rem;
}

.aoc__send {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: #374151;
}

.aoc__cust {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 1rem;
}

.aoc__cust-name {
    font-weight: 600;
    color: #111827;
    font-size: 0.9rem;
}

.aoc__tel {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.83rem;
    color: #0f766e;
    white-space: nowrap;
}

.aoc__addr {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    font-size: 0.83rem;
    color: #6b7280;
    /* ที่อยู่ยาวตัด 2 บรรทัด กันการ์ดสูงผิดปกติ */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.aoc__vat {
    font-size: 0.78rem;
    color: #9ca3af;
}

.aoc__total {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
    margin-inline-start: auto;
}

.aoc__total-label {
    font-size: 0.78rem;
    color: #9ca3af;
}

.aoc__total-amount {
    font-size: 1.35rem;
    font-weight: 800;
    color: #dc2626;
    white-space: nowrap;
}

.ao-empty {
    text-align: center;
    padding: 2.5rem 1rem;
    color: #6b7280;
    background: var(--market-card-bg, #fff);
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
}

.ao-empty__hint {
    margin-top: 0.35rem;
    font-size: 0.8rem;
    color: #9ca3af;
}

.aoc__foot {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.6rem 1.1rem 0.85rem;
    border-top: 1px solid #f1f5f9;
}

/* ปุ่มโทนเดียวกับหน้าลูกค้า (ขอบแดง ตัวอักษรแดง) */
.aoc-btn {
    min-height: 36px;
    padding: 0.4rem 1.1rem;
    border-radius: 8px;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
}

.aoc-btn--outline {
    border: 1px solid #f0b4a8;
    background: #fff;
    color: #dc2626;
}

.aoc-btn--outline:hover {
    background: #fef2f2;
    border-color: #dc2626;
}

/* ── dialog รายละเอียด ── */
.aod__band {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1.1rem;
    border-radius: 12px;
    background: #eff6ff;
    margin-bottom: 1rem;
}

.aod__doc {
    font-weight: 800;
    font-size: 1.05rem;
    color: #111827;
}

.aod__date {
    font-size: 0.82rem;
    color: #6b7280;
}

.aod__band-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.3rem;
}

.aod__total {
    font-size: 1.3rem;
    font-weight: 800;
    color: #dc2626;
}

.aod__tag {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
    font-weight: 600;
}

.aod__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
}

.aod__box {
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
    padding: 0.85rem 1rem;
}

.aod__box-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-weight: 700;
    margin-bottom: 0.6rem;
    color: #111827;
}

.aod__row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.86rem;
    padding: 0.18rem 0;
    color: #6b7280;
}

.aod__row b {
    color: #111827;
    font-weight: 600;
    text-align: end;
    overflow-wrap: anywhere;
}

.aod__items-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
}

.aod__table-wrap {
    overflow-x: auto;
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
}

.aod__table {
    width: 100%;
    min-width: 560px;
    border-collapse: collapse;
    font-size: 0.86rem;
}

.aod__table th {
    text-align: start;
    padding: 0.6rem 0.85rem;
    background: #f9fafb;
    border-bottom: 1px solid var(--market-card-border, #e6ebef);
    font-size: 0.78rem;
    color: #4b5563;
    white-space: nowrap;
}

.aod__table td {
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
}

.aod__table tbody tr:last-child td {
    border-bottom: none;
}

.aod-right {
    text-align: end;
    white-space: nowrap;
}

.aod__item-name {
    display: block;
    color: #047857;
    font-weight: 600;
}

.aod__item-code {
    display: block;
    font-size: 0.76rem;
    color: #9ca3af;
}

.aod__notship {
    display: inline-block;
    margin-inline-start: 0.4rem;
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: #f3f4f6;
    color: #4b5563;
    font-size: 0.72rem;
    font-weight: 700;
}

.aod__notship.is-removed {
    background: #fee2e2;
    color: #991b1b;
}

.aod__gift {
    display: inline-block;
    margin-inline-start: 0.4rem;
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: #fef3c7;
    color: #92400e;
    font-size: 0.72rem;
    font-weight: 700;
}

/* ของที่ร้านเพิ่มให้ตอนจัดของ — ไม่ได้อยู่ในใบสั่งซื้อเดิม */
.aod__added {
    display: inline-block;
    margin-inline-start: 0.4rem;
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: #d1fae5;
    color: #047857;
    font-size: 0.72rem;
    font-weight: 700;
}

.aod__doc-row td {
    background: #f0fdf4;
    border-top: 2px solid #bbf7d0;
    font-size: 0.82rem;
    color: #166534;
}

.aod__doc-row i {
    margin-inline-end: 0.3rem;
}

.aod__doc-count {
    margin-inline-start: 0.6rem;
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: #dcfce7;
    font-size: 0.74rem;
    font-weight: 700;
}

.aod__doc-row.is-cancelled td {
    background: #fef2f2;
    border-top-color: #fecaca;
    color: #991b1b;
}

.aod__doc-status {
    margin-inline-start: 0.6rem;
    font-weight: 700;
}

.aoc__preorder {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.6rem;
    border-radius: 999px;
    background: #fef3c7;
    color: #92400e;
    font-size: 0.76rem;
    font-weight: 700;
}

.aod__preorder {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    font-weight: 700;
    color: #92400e;
}

.aoc__mixed {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.6rem;
    border-radius: 999px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 0.76rem;
    font-weight: 600;
}

.aod__doc-cancel {
    margin-inline-start: 0.6rem;
    font-weight: 700;
    color: #dc2626;
}

.aod__struck,
.aod__row-cancelled td {
    text-decoration: line-through;
    color: #9ca3af;
}

.aod__row-cancelled .aod__item-name {
    color: #9ca3af;
}

.aod__sum-row--warn {
    color: #b91c1c;
}

.aod__sum-row--net {
    font-weight: 700;
    color: #166534;
}

.aoc__partial-cancel {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.6rem;
    border-radius: 999px;
    background: #fef2f2;
    color: #b91c1c;
    font-size: 0.76rem;
    font-weight: 600;
}

.aoc__net--invoiced {
    color: #047857;
}

.aoc__net {
    font-size: 0.78rem;
    font-weight: 700;
    color: #166534;
}

.aod__empty {
    text-align: center;
    color: #6b7280;
    padding: 1.5rem;
}

.aod__more {
    display: flex;
    justify-content: center;
    padding: 0.5rem 0;
}

.aod__sum {
    margin-top: 0.9rem;
    padding: 0.8rem 1rem;
    border-radius: 12px;
    background: #f9fafb;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.aod__sum-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.86rem;
    color: #6b7280;
}

.aod__sum-row--grand {
    font-size: 1.05rem;
    font-weight: 800;
    color: #dc2626;
    padding-top: 0.35rem;
    border-top: 1px dashed #e5e7eb;
    margin-top: 0.25rem;
}

.ao-pager {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.85rem;
}

.ao-pager__info {
    font-size: 0.82rem;
    color: #6b7280;
}

.ao-pager__buttons {
    display: flex;
    align-items: center;
    gap: 0.15rem;
}

.ao-pager__page {
    font-size: 0.82rem;
    padding: 0 0.5rem;
    white-space: nowrap;
}
@media (max-width: 640px) {
    .aod__band { flex-wrap: wrap; gap: 0.75rem; }
    .aod__table { display: block; min-width: 0; }
    .aod__table thead { display: none; }
    .aod__table tbody { display: block; }
    .aod__table tbody tr { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 0.65rem; border-bottom: 1px solid #dbe5e0; }
    .aod__table td { display: block; border: 0; padding: 0.3rem; font-size: 0.82rem; text-align: left; overflow-wrap: anywhere; }
    .aod__table td:first-child { grid-column: 1 / -1; }
    .aod__table td:nth-child(2)::before { content: 'หน่วย'; }
    .aod__table td:nth-child(3)::before { content: 'ราคา'; }
    .aod__table td:nth-child(4)::before { content: 'จำนวน'; }
    .aod__table td:nth-child(5)::before { content: 'รวม'; }
    .aod__table td::before { display: block; color: #64748b; font-size: 0.72rem; }
    .aod__table tr[data-testid='qt-allocation'] { margin-left: 0.65rem; border-left: 3px solid #9dd4b5; }
    .aod__table .aod__doc-row td { grid-column: 1 / -1; }
}
</style>
