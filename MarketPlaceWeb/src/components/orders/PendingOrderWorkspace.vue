<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import PendingOrderService from '@/services/PendingOrderService';
import InventoryService from '@/services/InventoryService';
import AllocationLine from './AllocationLine.vue';
import { allocationPayload } from '@/utils/orderAllocations';
import { createOrderDraftStore, documentSignature, requestAge, unassignedRows } from '@/utils/orderWorkspace';

const props = defineProps({ employeeCode: { type: String, default: '' }, draftScope: { type: String, default: () => import.meta.env.VITE_APP_API || location.origin } });
const sort = ref('oldest'),
    filter = ref('all'),
    folded = ref({}),
    checkedLines = ref([]),
    healthLines = ref({});
const lineRefs = new Map();
const savedDocs = ref([]),
    draftMessage = ref(''),
    storageFailed = ref(false),
    now = ref(Date.now());
const bulkVisible = ref(false),
    bulkMode = ref('all'),
    bulkWh = ref(''),
    bulkShelf = ref(''),
    bulkShelves = ref([]),
    bulkBusy = ref(false),
    bulkError = ref(''),
    bulkRevision = ref(0);
let bulkVersion = 0,
    ageTimer,
    draftStore;
let documentShelves = new Map(),
    batchEditing = false;
function loadSharedShelves(wh) {
    const cache = documentShelves;
    if (!cache.has(wh))
        cache.set(
            wh,
            InventoryService.getShelfList(wh).catch((error) => {
                cache.delete(wh);
                throw error;
            })
        );
    return cache.get(wh);
}

const rows = ref([]),
    total = ref(0),
    page = ref(1);
const search = ref(''),
    dateFrom = ref(''),
    dateTo = ref('');
const loading = ref(false),
    opening = ref(false),
    busy = ref(false);
const error = ref(''),
    notice = ref(''),
    selected = ref(null);
const stockIssues = ref([]);
const warehouses = ref([]),
    validLines = ref({}),
    doneLines = ref({});
const action = ref(''),
    reason = ref(''),
    quote = ref(null);
const drafts = new Map();
let listVersion = 0,
    detailVersion = 0;
const money = (value) => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const messageOf = (err) => err?.response?.data?.message || err.message || 'ดำเนินการไม่สำเร็จ';
const validCount = computed(() => selected.value?.items.filter((item) => validLines.value[item.line_number]).length || 0);
const completed = computed(() => selected.value?.items.filter((item) => validLines.value[item.line_number] && doneLines.value[item.line_number]).length || 0);
const canConfirm = computed(() => selected.value?.status === 'pending' && selected.value.items.length > 0 && completed.value === selected.value.items.length && !busy.value && !opening.value);
const completionMessage = computed(() => {
    const count = selected.value?.items.length || 0;
    if (!count || validCount.value < count) return 'กรุณาจัดสรรสินค้า คลัง และที่เก็บให้ครบทุกบรรทัดก่อน';
    if (completed.value < count) return `กรุณากด “เสร็จและถัดไป” ให้ครบอีก ${count - completed.value} รายการก่อนตรวจสอบ`;
    return '';
});
const hasDraft = () => [...drafts.values()].some((doc) => doc.items.some((item) => JSON.stringify(item.allocations) !== item.initialAllocation));
function beforeUnload(event) {
    if (storageFailed.value && hasDraft()) {
        event.preventDefault();
        event.returnValue = '';
    }
}
onBeforeRouteLeave(() => !storageFailed.value || !hasDraft() || window.confirm('เก็บร่างในเครื่องไม่สำเร็จ หากออกจากหน้านี้รายการที่จัดไว้จะหาย ต้องการออกหรือไม่?'));
function initDraftStore() {
    try {
        draftStore = createOrderDraftStore(localStorage, props.draftScope, props.employeeCode);
        savedDocs.value = draftStore.list();
        storageFailed.value = !props.employeeCode;
    } catch {
        storageFailed.value = true;
    }
}
watch(
    () => [props.employeeCode, props.draftScope],
    () => {
        detailVersion++;
        opening.value = false;
        action.value = '';
        bulkVisible.value = false;
        savedDocs.value = [];
        draftStore = undefined;
        selected.value = null;
        drafts.clear();
        validLines.value = {};
        doneLines.value = {};
        healthLines.value = {};
        initDraftStore();
    }
);
function removeDraft(doc) {
    drafts.delete(doc);
    try {
        draftStore?.remove(doc);
        savedDocs.value = draftStore?.list() || [];
    } catch {
        storageFailed.value = true;
    }
}
function persistDraft(doc) {
    if (!doc || opening.value || batchEditing || doc.status !== 'pending') return;
    try {
        draftStore.save(doc);
        savedDocs.value = draftStore.list();
        storageFailed.value = false;
        draftMessage.value = 'บันทึกร่างในเครื่องแล้ว · ยังไม่สร้าง QT';
    } catch {
        storageFailed.value = true;
        draftMessage.value = 'เก็บร่างในเครื่องไม่สำเร็จ กรุณาอย่าปิดหน้านี้';
    }
}
watch(selected, persistDraft, { deep: true, flush: 'sync' });
const matchesFilter = (item) => filter.value === 'all' || (filter.value === 'incomplete' ? !doneLines.value[item.line_number] : healthLines.value[item.line_number]?.short);
const visibleCount = computed(() => selected.value?.items.filter(matchesFilter).length || 0);
const riskReasons = (item) =>
    [
        item.allocations.length > 1 && 'แบ่งสินค้า',
        item.allocations.some((row) => row.item_code !== item.item_code) && 'เปลี่ยนรหัส',
        healthLines.value[item.line_number]?.short && 'สต๊อกไม่พอ',
        healthLines.value[item.line_number]?.unknown && 'ไม่ทราบสต๊อก'
    ].filter(Boolean);
const reviewRisk = computed(() => selected.value?.items.filter((item) => riskReasons(item).length) || []);
const reviewNormal = computed(() => selected.value?.items.filter((item) => !riskReasons(item).length) || []);
const bulkTargets = computed(() => unassignedRows(selected.value?.items || [], bulkMode.value === 'selected' ? checkedLines.value : undefined));
async function nextIncomplete(after) {
    const items = selected.value?.items || [];
    const index = items.findIndex((item) => item.line_number === after);
    const next = [...items.slice(index + 1), ...items.slice(0, index + 1)].find((item) => !doneLines.value[item.line_number]);
    if (!next) {
        notice.value = 'จัดสรรครบแล้ว พร้อมตรวจสอบและยืนยัน';
        return;
    }
    filter.value = 'all';
    folded.value[next.line_number] = false;
    await nextTick();
    const component = lineRefs.get(next.line_number);
    component?.$el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    component?.focusEditor();
}
function doneLine(item) {
    doneLines.value[item.line_number] = true;
    folded.value[item.line_number] = true;
    nextIncomplete(item.line_number);
}
function markLineChanged(item) {
    quote.value = null;
    if (!doneLines.value[item.line_number]) return;
    doneLines.value[item.line_number] = false;
    folded.value[item.line_number] = false;
}
function openBulk() {
    bulkMode.value = checkedLines.value.length ? 'selected' : 'all';
    bulkWh.value = '';
    bulkShelf.value = '';
    bulkShelves.value = [];
    bulkError.value = '';
    bulkVisible.value = true;
}
async function loadBulkShelves() {
    const version = ++bulkVersion;
    const wh = bulkWh.value;
    bulkShelf.value = '';
    bulkShelves.value = [];
    bulkBusy.value = true;
    bulkError.value = '';
    try {
        const data = await loadSharedShelves(wh);
        if (version === bulkVersion) bulkShelves.value = data.map((row) => ({ ...row, label: `${row.code} — ${row.name_1}` }));
    } catch {
        if (version === bulkVersion) bulkError.value = 'โหลดที่เก็บไม่สำเร็จ กรุณาลองอีกครั้ง';
    } finally {
        if (version === bulkVersion) bulkBusy.value = false;
    }
}
function applyBulk() {
    if (busy.value || bulkBusy.value || !warehouses.value.some((wh) => wh.code === bulkWh.value) || !bulkShelves.value.some((shelf) => shelf.code === bulkShelf.value)) return;
    const targets = bulkTargets.value;
    batchEditing = true;
    targets.forEach((row) => {
        row.wh_code = bulkWh.value;
        row.shelf_code = bulkShelf.value;
    });
    batchEditing = false;
    quote.value = null;
    persistDraft(selected.value);
    bulkRevision.value++;
    bulkVisible.value = false;
    notice.value = `กำหนดตำแหน่งให้ ${targets.length} รายการจัดสรร โดยไม่ทับรายการที่มีตำแหน่งแล้ว`;
}
function displayDate(value) {
    return value ? String(value).slice(0, 10) : '—';
}
async function load(reset = false) {
    if (reset) page.value = 1;
    const version = ++listVersion;
    loading.value = true;
    try {
        const data = await PendingOrderService.list(true, { search: search.value, date_from: dateFrom.value || undefined, date_to: dateTo.value || undefined, page: page.value, sort: sort.value });
        if (version !== listVersion) return;
        rows.value = data.data;
        total.value = data.total;
    } catch (err) {
        if (version === listVersion) error.value = messageOf(err);
    } finally {
        if (version === listVersion) loading.value = false;
    }
}
async function open(row) {
    if (busy.value) return;
    const version = ++detailVersion;
    opening.value = true;
    error.value = '';
    stockIssues.value = [];
    quote.value = null;
    try {
        const [fresh, master] = await Promise.all([PendingOrderService.detail(row.doc_no), InventoryService.getWarehouseList()]);
        if (version !== detailVersion) return;
        warehouses.value = master.map((wh) => ({ ...wh, label: `${wh.code} — ${wh.name_1}` }));
        documentShelves = new Map();
        if (fresh.status !== 'pending') {
            removeDraft(row.doc_no);
            selected.value = null;
            notice.value = fresh.status === 'confirmed' ? `คำขอนี้ได้รับการยืนยันแล้ว ${fresh.qt_doc_no || ''}` : 'คำขอนี้ปิดแล้ว กรุณาเลือกคำขออื่น';
            await load();
            return;
        }
        fresh.items.forEach((item) => {
            item.allocations = [{ item_code: item.item_code, qty: Number(item.qty), wh_code: '', shelf_code: '' }];
            item.initialAllocation = JSON.stringify(item.allocations);
        });
        draftMessage.value = '';
        try {
            const restored = draftStore.restore(fresh);
            if (restored.status === 'restored') draftMessage.value = 'คืนร่างแล้ว · กำลังตรวจสินค้าและตำแหน่งกับ master ปัจจุบัน';
            if (restored.status === 'discarded') draftMessage.value = 'ร่างหมดอายุหรือข้อมูลต้นทางเปลี่ยน เริ่มจากคำขอปัจจุบัน';
        } catch {
            storageFailed.value = true;
        }
        const memory = drafts.get(row.doc_no);
        if (storageFailed.value && memory && documentSignature(memory) === documentSignature(fresh))
            fresh.items.forEach((item, index) => {
                item.allocations = memory.items[index].allocations;
            });
        drafts.set(row.doc_no, fresh);
        // Force fresh master validation when reopening a locally retained draft.
        validLines.value = {};
        doneLines.value = {};
        healthLines.value = {};
        folded.value = {};
        checkedLines.value = [];
        filter.value = 'all';
        lineRefs.clear();
        selected.value = null;
        selected.value = drafts.get(row.doc_no);
    } catch (err) {
        if (version === detailVersion) error.value = messageOf(err);
    } finally {
        if (version === detailVersion) opening.value = false;
    }
}
async function reviewQuote() {
    if (!canConfirm.value || !selected.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        quote.value = await PendingOrderService.quote(selected.value.doc_no, allocationPayload(selected.value.items));
        action.value = 'confirm';
    } catch (err) {
        quote.value = null;
        const issues = err?.response?.data?.price_issues || [];
        const products = [...new Set(issues.map((issue) => issue.item_code).filter(Boolean))];
        error.value = `${messageOf(err)}${products.length ? `: ${products.join(', ')}` : ''}`;
    } finally {
        busy.value = false;
    }
}
async function act() {
    if (busy.value || !selected.value || (action.value === 'confirm' && !canConfirm.value) || (action.value === 'reject' && !reason.value.trim())) return;
    busy.value = true;
    error.value = '';
    stockIssues.value = [];
    notice.value = '';
    const doc = selected.value.doc_no;
    try {
        if (action.value === 'confirm') {
            const result = await PendingOrderService.confirm(doc, allocationPayload(selected.value.items), quote.value?.fingerprint);
            notice.value = `ยืนยันแล้ว เลขที่คำสั่งซื้อ ${[...new Set([result.doc_no, ...(result.sub_doc_nos || [])].filter(Boolean))].join(', ')}`;
        } else {
            await PendingOrderService.reject(doc, reason.value.trim());
            notice.value = 'ปฏิเสธคำขอแล้ว';
        }
        removeDraft(doc);
        selected.value = null;
        action.value = '';
        reason.value = '';
        await load();
        if (!rows.value.length && page.value > 1) {
            page.value--;
            await load();
        }
    } catch (err) {
        const changedQuote = err?.response?.data?.quote;
        if (err?.response?.data?.code === 'PENDING_QT_PRICE_CHANGED' && changedQuote) {
            quote.value = changedQuote;
            action.value = 'confirm';
            notice.value = 'ราคา หรือเงื่อนไขสินค้าเปลี่ยนแล้ว กรุณาตรวจสอบยอด QT ล่าสุดก่อนยืนยันอีกครั้ง';
        } else if (err?.response?.status === 409) {
            action.value = '';
            removeDraft(doc);
            selected.value = null;
            await load();
        } else {
            action.value = '';
        }
        error.value = messageOf(err);
        stockIssues.value = err?.response?.data?.stock_issues || [];
    } finally {
        busy.value = false;
    }
}
onMounted(() => {
    initDraftStore();
    load();
    ageTimer = setInterval(() => {
        now.value = Date.now();
    }, 60000);
    window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
    listVersion++;
    detailVersion++;
    bulkVersion++;
    clearInterval(ageTimer);
    window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
    <section class="staff-orders" aria-label="คำขอรอดำเนินการ">
        <header class="workspace-title">
            <div>
                <h1>
                    รอดำเนินการ <span class="count">{{ total }}</span>
                </h1>
                <p>จัดสินค้าและแหล่งจัดส่ง ก่อนยืนยันใบเสนอราคา</p>
            </div>
            <Button
                label="รีเฟรชคิว"
                icon="pi pi-refresh"
                outlined
                :disabled="busy || loading"
                @click="
                    error = '';
                    load();
                "
            />
        </header>
        <Message v-if="error" severity="error" :closable="false">
            {{ error }}
            <ul v-if="stockIssues.length" aria-label="สินค้าสต๊อกไม่พอ">
                <li v-for="issue in stockIssues" :key="`${issue.item_code}/${issue.wh_code}/${issue.shelf_code}`">
                    {{ issue.item_code }} · {{ issue.wh_code }} / {{ issue.shelf_code }} — ต้องการ {{ issue.required_qty }} / คงเหลือ {{ issue.available_qty }} (หน่วยฐาน)
                </li>
            </ul> </Message
        ><Message v-if="notice" severity="success" :closable="false">{{ notice }}</Message>
        <div class="workspace-grid" :class="{ 'has-selection': selected }">
            <aside class="order-queue" aria-label="คิวคำขอ">
                <form class="queue-filters" @submit.prevent="load(true)">
                    <label class="search-field">ค้นหาคำขอ<InputText v-model="search" placeholder="เลขคำขอ / ลูกค้า" /></label>
                    <details>
                        <summary>กรองวันที่</summary>
                        <div class="date-fields">
                            <label>ตั้งแต่<input v-model="dateFrom" type="date" /></label><label>ถึง<input v-model="dateTo" type="date" /></label>
                        </div>
                    </details>
                    <Button type="submit" label="ค้นหา" size="small" :disabled="loading || busy" />
                </form>
                <div class="queue-caption">
                    <strong>คิวคำขอ</strong
                    ><label
                        >เรียง
                        <select v-model="sort" aria-label="เรียงคิว" :disabled="loading || busy" @change="load(true)">
                            <option value="oldest">เก่าสุดก่อน</option>
                            <option value="newest">ใหม่ล่าสุดก่อน</option>
                        </select></label
                    >
                </div>
                <p v-if="loading" class="empty-state" role="status">กำลังโหลดคิว…</p>
                <p v-else-if="!rows.length" class="empty-state">ไม่มีคำขอในช่วงที่เลือก</p>
                <div v-else class="queue-list">
                    <button v-for="row in rows" :key="row.doc_no" type="button" class="queue-card" :class="{ active: selected?.doc_no === row.doc_no }" :aria-pressed="selected?.doc_no === row.doc_no" :disabled="busy || opening" @click="open(row)">
                        <span class="queue-card-top"
                            ><span class="pending-dot">{{ requestAge(row.created_at, now) }}</span
                            ><span>{{ displayDate(row.doc_date) }}</span></span
                        ><strong>{{ row.cust_name || row.cust_code }}</strong
                        ><span class="doc-code">{{ row.doc_no }}</span
                        ><span class="queue-card-bottom"
                            ><span>{{ row.cust_code }}</span
                            ><b>฿{{ money(row.total_amount) }}</b></span
                        >
                        <small v-if="savedDocs.includes(row.doc_no)" class="draft-tag">มีร่างที่จัดไว้</small>
                    </button>
                </div>
                <nav v-if="total > 20" class="queue-pager" aria-label="หน้าคิว">
                    <Button
                        icon="pi pi-chevron-left"
                        aria-label="ก่อนหน้า"
                        text
                        :disabled="page <= 1 || loading || busy"
                        @click="
                            page--;
                            load();
                        "
                    /><span>{{ page }} / {{ Math.ceil(total / 20) }}</span
                    ><Button
                        icon="pi pi-chevron-right"
                        aria-label="ถัดไป"
                        text
                        :disabled="page * 20 >= total || loading || busy"
                        @click="
                            page++;
                            load();
                        "
                    />
                </nav>
            </aside>
            <section class="order-work" aria-label="พื้นที่จัดสินค้า" :aria-busy="opening">
                <p v-if="opening" class="empty-state" role="status">กำลังเปิดคำขอ…</p>
                <template v-else-if="selected">
                    <Button class="back-to-queue" label="กลับไปคิวคำขอ" icon="pi pi-arrow-left" text :disabled="busy" @click="selected = null" />
                    <header class="document-heading">
                        <div>
                            <h2>{{ selected.cust_name || selected.cust_code }}</h2>
                            <p>{{ selected.doc_no }} · {{ displayDate(selected.doc_date) }} {{ selected.doc_time }}</p>
                        </div>
                        <span class="status-tag">รอพนักงานยืนยัน</span>
                    </header>
                    <details class="customer-detail">
                        <summary>{{ selected.cust_code }} · ข้อมูลติดต่อ / ที่อยู่</summary>
                        <p>{{ selected.address || 'ไม่ระบุที่อยู่' }} · {{ selected.telephone || 'ไม่ระบุเบอร์โทร' }}</p>
                    </details>
                    <p v-if="selected.remark" class="remark">หมายเหตุ: {{ selected.remark }}</p>
                    <div class="work-progress">
                        <div>
                            <strong>จัดสรรครบ {{ completed }} / {{ selected.items.length }} รายการ</strong><span>1 จัดสินค้า <i class="pi pi-angle-right" /> 2 ตรวจสอบ <i class="pi pi-angle-right" /> 3 สร้าง QT</span>
                        </div>
                        <progress :value="completed" :max="selected.items.length || 1" :aria-label="`จัดสรรครบ ${completed} จาก ${selected.items.length} รายการ`" />
                    </div>
                    <p v-if="completionMessage" class="completion-note" role="status"><i class="pi pi-info-circle" /> {{ completionMessage }}</p>
                    <p v-if="draftMessage" class="draft-status" :class="{ 'save-error': storageFailed }" role="status">{{ draftMessage }}</p>
                    <div class="work-toolbar">
                        <div class="filter-tabs" aria-label="กรองรายการ">
                            <button
                                v-for="tab in [
                                    { value: 'all', label: 'ทั้งหมด' },
                                    { value: 'incomplete', label: 'ยังไม่ครบ' },
                                    { value: 'short', label: 'สต๊อกไม่พอ' }
                                ]"
                                :key="tab.value"
                                type="button"
                                :aria-pressed="filter === tab.value"
                                @click="filter = tab.value"
                            >
                                {{ tab.label }}
                            </button>
                        </div>
                        <Button label="จัดคลังหลายรายการ" icon="pi pi-map-marker" outlined size="small" :disabled="busy" @click="openBulk" />
                    </div>
                    <p v-if="!visibleCount" class="empty-state">ไม่มีรายการในตัวกรองนี้ <Button label="แสดงทั้งหมด" text @click="filter = 'all'" /></p>
                    <div class="allocation-lines">
                        <AllocationLine
                            v-for="item in selected.items"
                            v-show="matchesFilter(item)"
                            :key="`${selected.doc_no}/${item.line_number}`"
                            :ref="
                                (el) => {
                                    if (el) lineRefs.set(item.line_number, el);
                                }
                            "
                            :source="item"
                            :doc-no="selected.doc_no"
                            :warehouses="warehouses"
                            :shelf-loader="loadSharedShelves"
                            :disabled="busy"
                            :collapsed="!!folded[item.line_number]"
                            :checked="checkedLines.includes(item.line_number)"
                            :bulk-revision="bulkRevision"
                            @toggle="folded[item.line_number] = !folded[item.line_number]"
                            @checked="
                                (value) => {
                                    checkedLines = value ? [...checkedLines, item.line_number] : checkedLines.filter((number) => number !== item.line_number);
                                }
                            "
                            @health="(value) => (healthLines[item.line_number] = value)"
                            @changed="markLineChanged(item)"
                            @done="doneLine(item)"
                            @validity="(valid) => (validLines[item.line_number] = valid)"
                        />
                    </div>
                    <footer class="workspace-actions">
                        <div class="action-total">
                            <span>ยอดรวมตามคำขอ</span><strong>฿{{ money(selected.total_amount) }}</strong>
                        </div>
                        <div class="action-buttons">
                            <Button v-if="completed < selected.items.length" label="จัดรายการถัดไป" icon="pi pi-arrow-down" outlined :disabled="busy" @click="nextIncomplete()" />
                            <Button
                                label="ปฏิเสธคำขอ"
                                text
                                severity="danger"
                                :disabled="busy"
                                @click="
                                    reason = '';
                                    action = 'reject';
                                "
                            /><Button label="ตรวจสอบและยืนยัน" icon="pi pi-arrow-right" iconPos="right" :disabled="!canConfirm" @click="reviewQuote" />
                        </div>
                    </footer>
                </template>
                <div v-else class="welcome-state">
                    <span class="welcome-icon"><i class="pi pi-box" /></span>
                    <h2>เลือกคำขอ แล้วเริ่มจัดสินค้า</h2>
                    <p>เลือกสินค้าจริง จำนวน คลัง และที่เก็บ<br />ตรวจสอบให้ครบก่อนสร้างใบเสนอราคา QT</p>
                    <span class="welcome-flow">MPR / 300 <i class="pi pi-arrow-right" /> จัดสินค้า <i class="pi pi-arrow-right" /> QT / 30</span>
                </div>
            </section>
        </div>
        <Dialog
            :visible="!!action"
            modal
            :header="action === 'confirm' ? 'ตรวจสอบก่อนยืนยันสั่งซื้อ' : 'ปฏิเสธคำขอ'"
            :style="{ width: 'min(720px, 95vw)' }"
            :closable="!busy"
            :closeOnEscape="!busy"
            @update:visible="
                (value) => {
                    if (!value && !busy) action = '';
                }
            "
        >
            <p>{{ selected?.doc_no }} · {{ selected?.cust_name }}</p>
            <template v-if="action === 'confirm'"
                ><h3>ยอด QT ล่าสุด</h3>
                <p class="quote-total">฿{{ money(quote?.totals?.total_amount) }}</p>
                <p v-if="Number(quote?.totals?.total_amount) !== Number(selected?.total_amount)" class="risk-label">ยอดคำขอ MPR ฿{{ money(selected?.total_amount) }} · ส่วนต่าง ฿{{ money(Number(quote?.totals?.total_amount || 0) - Number(selected?.total_amount || 0)) }}</p>
                <div v-for="(row, index) in quote?.items || []" :key="`${row.source_line}/${index}`" class="review-line">
                    <strong>{{ row.source_item }} → {{ row.item_code }} · {{ row.item_name }}</strong>
                    <p>{{ row.qty }} {{ row.unit_code }} · {{ row.wh_code }} / {{ row.shelf_code }}</p>
                    <p>ราคา ฿{{ money(row.price) }}<span v-if="row.discount"> · ลด {{ row.discount }}</span> · {{ Number(row.tax_type) === 1 ? 'ยกเว้น VAT' : 'คิด VAT' }} · รวม ฿{{ money(row.sum_amount) }}</p>
                </div>
                <h3 v-if="reviewRisk.length">ตรวจเป็นพิเศษ {{ reviewRisk.length }} รายการ</h3>
                <div v-for="item in reviewRisk" :key="item.line_number" class="review-line review-risk">
                    <strong>{{ item.item_code }} · {{ item.item_name }}</strong>
                    <p class="risk-label">{{ riskReasons(item).join(' · ') }}</p>
                    <p v-for="(row, index) in item.allocations" :key="index">→ {{ row.item_code }} × {{ row.qty }} {{ item.unit_code }} · {{ row.wh_code }} / {{ row.shelf_code }}</p>
                </div>
                <details v-if="reviewNormal.length" class="normal-review">
                    <summary>รายการปกติ {{ reviewNormal.length }} รายการ — เปิดตรวจสอบทั้งหมด</summary>
                    <div v-for="item in reviewNormal" :key="item.line_number" class="review-line">
                        <strong>{{ item.item_code }} · {{ item.item_name }}</strong>
                        <p v-for="(row, index) in item.allocations" :key="index">→ {{ row.item_code }} × {{ row.qty }} {{ item.unit_code }} · {{ row.wh_code }} / {{ row.shelf_code }}</p>
                    </div>
                </details>
                <p class="review-total">ยอด QT ฿{{ money(quote?.totals?.total_amount) }}</p></template
            >
            <label v-else class="reject-reason">เหตุผลที่แจ้งลูกค้า<Textarea v-model="reason" rows="4" maxlength="1000" autofocus /><small>จำเป็นต้องระบุเหตุผลก่อนปฏิเสธ</small></label>
            <template #footer
                ><Button label="กลับไปแก้ไข" outlined :disabled="busy" @click="action = ''" /><Button
                    :label="action === 'confirm' ? 'ยืนยันสั่งซื้อ' : 'ปฏิเสธคำขอ'"
                    :severity="action === 'reject' ? 'danger' : undefined"
                    :loading="busy"
                    :disabled="busy || (action === 'confirm' ? !canConfirm || !quote?.fingerprint : !reason.trim())"
                    @click="act"
            /></template>
        </Dialog>
        <Dialog v-model:visible="bulkVisible" modal header="จัดคลังหลายรายการ" :style="{ width: 'min(620px, 95vw)' }">
            <p>เติมเฉพาะรายการที่ว่างทั้งคลังและที่เก็บ ไม่เปลี่ยนรหัสสินค้า จำนวน หรือทับตำแหน่งที่เลือกไว้</p>
            <div class="bulk-controls">
                <label><input v-model="bulkMode" type="radio" value="all" /> ทุกรายการที่ยังไม่มีตำแหน่ง</label><label><input v-model="bulkMode" type="radio" value="selected" /> เฉพาะบรรทัดที่ติ๊กเลือก ({{ checkedLines.length }})</label>
            </div>
            <p>
                <strong>จะเติมตำแหน่งให้ {{ bulkTargets.length }} รายการจัดสรร</strong>
            </p>
            <div class="bulk-controls">
                <label>คลัง<Select v-model="bulkWh" :options="warehouses" optionLabel="label" optionValue="code" filter placeholder="เลือกคลัง" aria-label="คลังหลายรายการ" @change="loadBulkShelves" /></label
                ><label>ที่เก็บ<Select v-model="bulkShelf" :options="bulkShelves" optionLabel="label" optionValue="code" filter placeholder="เลือกที่เก็บ" aria-label="ที่เก็บหลายรายการ" :loading="bulkBusy" :disabled="!bulkWh || bulkBusy" /></label>
            </div>
            <Message v-if="bulkError" severity="error" :closable="false">{{ bulkError }} <Button label="ลองอีกครั้ง" text @click="loadBulkShelves" /></Message>
            <template #footer
                ><Button label="กลับ" outlined @click="bulkVisible = false" /><Button
                    :label="`ใช้กับ ${bulkTargets.length} รายการ`"
                    :disabled="busy || bulkBusy || !bulkTargets.length || !bulkShelves.some((shelf) => shelf.code === bulkShelf)"
                    @click="applyBulk"
            /></template>
        </Dialog>
    </section>
</template>

<style scoped>
.work-toolbar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.7rem 0;
    margin-bottom: 0.7rem;
}
.filter-tabs {
    display: flex;
    border: 1px solid #ccdcd0;
    border-radius: 8px;
    overflow: hidden;
}
.filter-tabs button {
    border: 0;
    background: #fff;
    color: #476250;
    padding: 0.65rem 0.8rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
}
.filter-tabs button[aria-pressed='true'] {
    background: #2f6845;
    color: white;
}
.draft-status {
    font-size: 0.85rem;
    color: #4d6b56;
}
.save-error,
.risk-label {
    color: #935615;
}
.draft-tag {
    font-size: 0.8rem;
    color: #2c6b43;
}
.queue-caption select {
    max-width: 120px;
    border: 1px solid #d5e1d8;
    border-radius: 5px;
    padding: 0.3rem;
    color: #355740;
    background: white;
}
.bulk-controls {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin: 1rem 0;
}
.bulk-controls label {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex: 1;
    min-width: 180px;
}
.bulk-controls :deep(.p-select) {
    flex: 1;
    min-width: 0;
}
.review-risk {
    border-left: 3px solid #e3a349 !important;
}
.normal-review summary {
    padding: 0.8rem;
    background: #f1f6f2;
    border-radius: 6px;
    cursor: pointer;
}
.allocation-lines :deep(.allocation-line) {
    scroll-margin-top: 120px;
}
.work-toolbar :deep(.p-button) {
    min-height: 38px;
}
.staff-orders {
    color: #20392d;
}
.workspace-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.4rem;
}
.overline {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #728679;
}
.workspace-title h1 {
    font-size: 1.7rem;
    margin: 0.25rem 0;
}
.workspace-title p {
    margin: 0;
    color: #6a7b70;
    font-size: 0.9rem;
}
.count {
    font-size: 0.85rem;
    vertical-align: middle;
    background: #e5eee7;
    color: #386145;
    border-radius: 8px;
    padding: 0.25rem 0.6rem;
    margin-left: 0.4rem;
}
.workspace-grid {
    display: grid;
    grid-template-columns: 285px minmax(0, 1fr);
    gap: 1.3rem;
    align-items: start;
    margin-top: 1rem;
}
.order-queue {
    border: 1px solid #dde6df;
    background: #fff;
    border-radius: 15px;
    overflow: hidden;
    position: sticky;
    top: 95px;
}
.queue-filters {
    padding: 1rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    border-bottom: 1px solid #edf1ed;
}
.search-field {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.8rem;
}
.queue-filters details {
    flex: 1;
    font-size: 0.8rem;
}
.queue-filters summary {
    cursor: pointer;
    color: #61786a;
}
.date-fields {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin: 0.6rem 0;
}
.date-fields label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-width: 100%;
}
.date-fields input {
    border: 1px solid #dce5de;
    border-radius: 6px;
    padding: 0.4rem;
    width: 100%;
    color: #20392d;
}
.queue-caption {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #718277;
    padding: 1rem 1rem 0.5rem;
}
.queue-caption strong {
    color: #374c3e;
}
.queue-list {
    padding: 0.2rem 0.6rem;
    max-height: calc(100vh - 455px);
    min-height: 180px;
    overflow: auto;
}
.queue-card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    padding: 1rem 0.8rem;
    border: 1px solid transparent;
    border-bottom-color: #edf1ed;
    border-radius: 10px;
    background: white;
    cursor: pointer;
    color: inherit;
    margin-bottom: 0.25rem;
    transition: background 0.15s;
}
.queue-card:hover {
    background: #f6f9f6;
}
.queue-card.active {
    background: #edf5ef;
    border-color: #59926d;
    box-shadow: inset 3px 0 #397452;
}
.queue-card:focus-visible {
    outline: 2px solid #397452;
    outline-offset: -2px;
}
.queue-card-top,
.queue-card-bottom {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.7rem;
    color: #6c7d70;
}
.queue-card-bottom b {
    font-size: 0.95rem;
    color: #304a3a;
}
.pending-dot {
    color: #986225;
}
.pending-dot:before {
    content: '●';
    font-size: 0.55rem;
    margin-right: 0.35rem;
}
.doc-code {
    font-size: 0.75rem;
    color: #63756a;
    overflow-wrap: anywhere;
}
.queue-pager {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 1rem;
    font-size: 0.8rem;
}
.draft-note {
    font-size: 0.7rem;
    line-height: 1.7;
    color: #78877e;
    padding: 0.7rem 1rem;
    margin: 0;
    background: #fafbf9;
}
.order-work {
    min-width: 0;
}
.document-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}
.document-heading h2 {
    font-size: 1.35rem;
    margin: 0.3rem 0;
}
.document-heading p {
    font-size: 0.8rem;
    color: #718277;
    margin: 0;
}
.status-tag {
    background: #fff0db;
    color: #996225;
    border: 1px solid #f2dab7;
    padding: 0.35rem 0.65rem;
    border-radius: 6px;
    font-size: 0.75rem;
    white-space: nowrap;
}
.customer-detail {
    font-size: 0.8rem;
    color: #65796c;
    margin: 1rem 0;
}
.customer-detail summary {
    cursor: pointer;
}
.remark {
    font-size: 0.85rem;
    background: #fff6e8;
    padding: 0.6rem;
    border-radius: 6px;
}
.work-progress {
    background: #eaf2eb;
    border-radius: 10px;
    padding: 0.8rem 1rem;
}
.work-progress > div {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.8rem;
}
.work-progress span {
    font-size: 0.7rem;
    color: #6a7e6f;
}
.work-progress progress {
    display: block;
    width: 100%;
    height: 5px;
    margin-top: 0.65rem;
    accent-color: #32734b;
    border: 0;
    border-radius: 10px;
    overflow: hidden;
}
.work-progress progress::-webkit-progress-bar {
    background: #d5e4d9;
}
.work-progress progress::-webkit-progress-value {
    background: #32734b;
}
.stock-note {
    font-size: 0.75rem;
    color: #738277;
    margin: 1rem 0;
}
.completion-note {
    margin: -0.5rem 0 1rem;
    color: #97551c;
    font-size: 0.8rem;
    font-weight: 600;
}
.allocation-lines {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}
.workspace-actions {
    position: sticky;
    bottom: 0;
    background: #fff;
    border: 1px solid #dbe5dd;
    border-radius: 12px;
    box-shadow: 0 -4px 20px #264b3510;
    padding: 0.9rem 1rem;
    margin-top: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    z-index: 5;
}
.action-total {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}
.action-total > span {
    font-size: 0.7rem;
    color: #77857a;
}
.action-total strong {
    font-size: 1.35rem;
}
.action-total label {
    font-size: 0.7rem;
    color: #617367;
    display: flex;
    align-items: center;
    gap: 0.4rem;
}
.action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
.back-to-queue {
    display: none;
}
.empty-state {
    padding: 2rem 1rem;
    text-align: center;
    color: #75897c;
}
.welcome-state {
    display: flex;
    min-height: 520px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    text-align: center;
    border: 1px dashed #d4e1d7;
    border-radius: 15px;
    background: #fafcf9;
    color: #698070;
}
.welcome-state h2 {
    font-size: 1.3rem;
    color: #35513d;
    margin: 1rem 0 0.2rem;
}
.welcome-state p {
    line-height: 1.9;
    font-size: 0.9rem;
}
.welcome-icon {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    background: #eaf2e9;
    border-radius: 18px;
    color: #397452;
}
.welcome-icon i {
    font-size: 1.8rem;
}
.welcome-flow {
    font-size: 0.75rem;
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-top: 1rem;
}
.review-line {
    padding: 0.8rem;
    border: 1px solid #dce6df;
    border-radius: 8px;
    margin: 0.6rem 0;
    overflow-wrap: anywhere;
}
.review-line p {
    font-size: 0.85rem;
    margin: 0.5rem 0;
}
.review-total {
    font-size: 1.2rem;
    font-weight: 700;
    text-align: right;
}
.reject-reason {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.reject-reason small {
    color: #748179;
}
.queue-card-top,
.queue-card-bottom,
.doc-code,
.draft-note,
.customer-detail,
.document-heading p,
.stock-note,
.work-progress > div,
.work-progress span,
.action-total label {
    font-size: 0.9rem;
}
.queue-caption {
    font-size: 0.85rem;
}
.allocation-lines {
    padding-bottom: 0.5rem;
}
@media (max-width: 1100px) {
    .workspace-grid {
        grid-template-columns: 235px minmax(0, 1fr);
        gap: 0.9rem;
    }
    .workspace-actions {
        flex-wrap: wrap;
    }
    .action-buttons {
        margin-left: auto;
    }
}
@media (max-width: 760px) {
    .workspace-title {
        align-items: start;
    }
    .workspace-title h1 {
        font-size: 1.4rem;
    }
    .workspace-title p {
        font-size: 0.75rem;
    }
    .workspace-title > .p-button {
        font-size: 0.75rem;
        padding: 0.5rem;
    }
    .workspace-grid {
        grid-template-columns: 1fr;
    }
    .order-queue {
        position: static;
    }
    .queue-list {
        max-height: none;
    }
    .has-selection .order-queue {
        display: none;
    }
    .workspace-grid:not(.has-selection) .order-work {
        display: none;
    }
    .back-to-queue {
        display: inline-flex;
        margin-bottom: 0.7rem;
    }
    .document-heading {
        flex-wrap: wrap;
        gap: 0.6rem;
    }
    .document-heading h2 {
        font-size: 1.2rem;
    }
    .work-progress > div {
        flex-direction: column;
    }
    .workspace-actions {
        padding: 0.7rem;
        gap: 0.5rem;
    }
    .action-total {
        width: 100%;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
    }
    .action-total label {
        grid-column: 1/3;
    }
    .action-total strong {
        font-size: 1.2rem;
    }
    .action-buttons {
        width: 100%;
        justify-content: space-between;
    }
    .action-buttons :deep(.p-button) {
        font-size: 0.85rem;
    }
    .stock-note {
        line-height: 1.7;
    }
}
</style>
