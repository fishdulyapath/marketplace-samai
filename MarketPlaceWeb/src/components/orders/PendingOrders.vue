<script setup>
import { computed, onMounted, ref } from 'vue';
import PendingOrderService from '@/services/PendingOrderService';
import InventoryService from '@/services/InventoryService';

const props = defineProps({ admin: Boolean, custCode: { type: String, default: '' } });
const emit = defineEmits(['changed']);
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const search = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const selected = ref(null);
const detailVisible = ref(false);
const confirmAction = ref('');
const reason = ref('');
const warehouses = ref([]);
const shelves = ref({});
const shelfLoading = ref({});
let listVersion = 0;
const money = value => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const labels = { pending: 'รอพนักงานยืนยัน', cancelled: 'ลูกค้ายกเลิก', rejected: 'พนักงานปฏิเสธ', confirmed: 'ยืนยันแล้ว' };
const canConfirm = computed(() => selected.value?.status === 'pending' && selected.value?.items?.length > 0 && selected.value.items.every(item =>
    item.wh_code && item.shelf_code && !shelfLoading.value[item.wh_code] && (shelves.value[item.wh_code] || []).some(shelf => shelf.code === item.shelf_code)));
const actionText = computed(() => ({ confirm: 'ยืนยันสั่งซื้อ', reject: 'ปฏิเสธคำขอ', cancel: 'ยกเลิกคำขอ' }[confirmAction.value] || 'ยืนยัน'));
const messageOf = err => err?.response?.data?.message || err.message || 'ดำเนินการไม่สำเร็จ';

async function load(reset = false) {
    if (reset) page.value = 1;
    const version = ++listVersion;
    loading.value = true;
    error.value = '';
    try {
        const response = await PendingOrderService.list(props.admin, { cust_code: props.custCode, search: search.value, date_from: dateFrom.value || undefined, date_to: dateTo.value || undefined, page: page.value });
        if (version !== listVersion) return;
        rows.value = response.data;
        total.value = response.total;
    } catch (err) { if (version === listVersion) error.value = messageOf(err); }
    finally { if (version === listVersion) loading.value = false; }
}

async function open(row) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
        selected.value = await PendingOrderService.detail(row.doc_no);
        if (selected.value.status === 'confirmed') {
            notice.value = `พนักงานยืนยันแล้ว เลขที่คำสั่งซื้อ ${selected.value.qt_doc_no}`;
            await load();
            emit('changed');
            return;
        }
        if (props.admin && !warehouses.value.length) {
            warehouses.value = (await InventoryService.getWarehouseList()).map(row => ({ ...row, label: `${row.code} — ${row.name_1}` }));
        }
        detailVisible.value = true;
    } catch (err) { error.value = messageOf(err); }
    finally { busy.value = false; }
}

async function selectWarehouse(item) {
    item.shelf_code = '';
    const wh = item.wh_code;
    if (!wh || shelves.value[wh] || shelfLoading.value[wh]) return;
    shelfLoading.value[wh] = true;
    error.value = '';
    try {
        shelves.value[wh] = (await InventoryService.getShelfList(wh)).map(row => ({ ...row, label: `${row.code} — ${row.name_1}` }));
    } catch (err) { error.value = messageOf(err); }
    finally { shelfLoading.value[wh] = false; }
}

async function act() {
    if (busy.value || !selected.value) return;
    if (confirmAction.value === 'confirm' && !canConfirm.value) return;
    if (confirmAction.value === 'reject' && !reason.value.trim()) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        const doc = selected.value.doc_no;
        if (confirmAction.value === 'confirm') {
            const result = await PendingOrderService.confirm(doc, selected.value.items.map(({ line_number, wh_code, shelf_code }) => ({ line_number, wh_code, shelf_code })));
            notice.value = `ยืนยันแล้ว เลขที่คำสั่งซื้อ ${result.doc_no}`;
        } else if (confirmAction.value === 'reject') {
            await PendingOrderService.reject(doc, reason.value.trim());
            notice.value = 'ปฏิเสธคำขอแล้ว';
        } else {
            await PendingOrderService.cancel(doc);
            notice.value = 'ยกเลิกคำขอแล้ว';
        }
        confirmAction.value = '';
        detailVisible.value = false;
        reason.value = '';
        await load(true);
        emit('changed');
    } catch (err) {
        error.value = messageOf(err);
        confirmAction.value = '';
        // A concurrent confirmation/cancellation must refresh both the request and QT lists.
        if (err?.response?.status === 409) { detailVisible.value = false; await load(); emit('changed'); error.value = messageOf(err); }
    } finally { busy.value = false; }
}

onMounted(() => load());
defineExpose({ reload: load });
</script>

<template>
    <section class="pending-orders" aria-label="คำขอรอดำเนินการ">
        <div class="pending-title"><div><h2>{{ admin ? 'รอดำเนินการ' : 'คำขอสั่งซื้อ' }}</h2><p>{{ admin ? 'เลือกคลังและที่เก็บให้ครบ ก่อนยืนยันคำสั่งซื้อ' : 'ติดตามคำขอที่รอพนักงานยืนยัน หรือดูคำขอที่ปิดแล้ว' }}</p></div><Button label="รีเฟรช" icon="pi pi-refresh" outlined :disabled="busy || loading" @click="load(); emit('changed')" /></div>
        <form class="pending-filters" @submit.prevent="load(true)">
            <label>ค้นหา<InputText v-model="search" placeholder="เลขคำขอ / ลูกค้า" /></label>
            <label>ตั้งแต่วันที่<input v-model="dateFrom" type="date" /></label>
            <label>ถึงวันที่<input v-model="dateTo" type="date" /></label>
            <Button type="submit" label="ค้นหา" :disabled="busy || loading" />
        </form>
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
        <Message v-if="notice" severity="success" :closable="false">{{ notice }}</Message>
        <p v-if="loading" role="status">กำลังโหลดคำขอ…</p>
        <p v-else-if="!rows.length">ไม่พบคำขอในช่วงที่เลือก</p>
        <div v-else class="pending-list">
            <article v-for="row in rows" :key="row.doc_no" class="pending-row">
                <div><strong>{{ row.doc_no }}</strong><p>{{ row.doc_date }} {{ row.doc_time }} · {{ labels[row.status] }}</p><p v-if="admin">{{ row.cust_code }} · {{ row.cust_name }}</p><p v-if="row.reason">เหตุผล: {{ row.reason }}</p></div>
                <div class="pending-row-action"><strong>฿{{ money(row.total_amount) }}</strong><Button label="ดูรายละเอียด" outlined :disabled="busy" @click="open(row)" /></div>
            </article>
        </div>
        <div v-if="total > 20" class="pending-pager"><Button label="ก่อนหน้า" :disabled="page <= 1 || loading || busy" @click="page--; load()" /><span>หน้า {{ page }} / {{ Math.ceil(total / 20) }}</span><Button label="ถัดไป" :disabled="page * 20 >= total || loading || busy" @click="page++; load()" /></div>

        <Dialog v-model:visible="detailVisible" modal :header="selected?.doc_no" :style="{ width: 'min(1100px, 96vw)' }" :closable="!busy" :closeOnEscape="!busy">
            <template v-if="selected">
                <p>{{ selected.cust_code }} · {{ selected.cust_name }} · {{ labels[selected.status] }}</p>
                <p>{{ selected.address }} {{ selected.telephone }}</p>
                <p v-if="selected.remark">{{ selected.remark }}</p>
                <Message v-if="selected.reason" severity="warn" :closable="false">{{ selected.reason }}</Message>
                <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
                <div class="pending-table" :class="{ 'pending-table--allocation': admin }"><table><thead><tr><th>สินค้า</th><th>จำนวน</th><th>ราคา</th><th>รวม</th><th v-if="admin">คลัง / ที่เก็บ</th></tr></thead><tbody>
                    <tr v-for="item in selected.items" :key="item.line_number">
                        <td><strong>{{ item.item_code }}</strong><div>{{ item.item_name }}</div><small v-if="Number(item.is_permium)">ของแถม</small><ul v-if="item.sub_item?.length"><li v-for="sub in item.sub_item" :key="sub.line_number">{{ sub.item_name }} × {{ sub.qty }} {{ sub.unit_code }}</li></ul></td>
                        <td>{{ item.qty }} {{ item.unit_code }}</td><td>{{ money(item.price) }}</td><td>{{ money(item.sum_amount) }}</td>
                        <td v-if="admin" class="pending-location">
                            <label :for="`wh-${item.line_number}`">คลัง</label><Select :inputId="`wh-${item.line_number}`" :ariaLabel="`คลัง ${item.item_code}`" v-model="item.wh_code" :options="warehouses" optionLabel="label" optionValue="code" filter placeholder="เลือกคลัง" :disabled="busy || selected.status !== 'pending'" @change="selectWarehouse(item)" />
                            <label :for="`shelf-${item.line_number}`">ที่เก็บ</label><Select :inputId="`shelf-${item.line_number}`" :ariaLabel="`ที่เก็บ ${item.item_code}`" v-model="item.shelf_code" :options="shelves[item.wh_code] || []" optionLabel="label" optionValue="code" filter placeholder="เลือกที่เก็บ" :loading="shelfLoading[item.wh_code]" :disabled="!item.wh_code || busy || selected.status !== 'pending'" />
                            <Button v-if="item.wh_code && !shelves[item.wh_code] && !shelfLoading[item.wh_code]" label="โหลดที่เก็บอีกครั้ง" text @click="selectWarehouse(item)" />
                            <small v-if="item.wh_code && shelves[item.wh_code]?.length === 0">คลังนี้ยังไม่มีที่เก็บใน master</small>
                        </td>
                    </tr>
                </tbody></table></div>
                <p class="pending-total">ยอดรวม ฿{{ money(selected.total_amount) }}</p>
            </template>
            <template #footer>
                <template v-if="selected?.status === 'pending'">
                    <Button v-if="admin" label="ปฏิเสธคำขอ" severity="danger" outlined :disabled="busy" @click="reason = ''; confirmAction = 'reject'" />
                    <Button v-if="admin" label="ยืนยันสั่งซื้อ" icon="pi pi-check" :disabled="!canConfirm || busy" @click="confirmAction = 'confirm'" />
                    <Button v-else label="ยกเลิกคำขอ" severity="danger" :disabled="busy" @click="confirmAction = 'cancel'" />
                </template>
                <Button label="ปิด" severity="secondary" :disabled="busy" @click="detailVisible = false" />
            </template>
        </Dialog>
        <Dialog :visible="!!confirmAction" modal :header="actionText" :style="{ width: 'min(540px, 95vw)' }" :closable="!busy" :closeOnEscape="!busy" @update:visible="value => { if (!value && !busy) confirmAction = ''; }">
            <p>{{ actionText }} {{ selected?.doc_no }} ใช่หรือไม่?</p>
            <template v-if="confirmAction === 'confirm'"><p>ยอดรวม ฿{{ money(selected?.total_amount) }}</p><ul><li v-for="item in selected?.items" :key="item.line_number">{{ item.item_name }}: {{ item.wh_code }} / {{ item.shelf_code }}</li></ul></template>
            <label v-if="confirmAction === 'reject'" class="pending-reason">เหตุผลที่แจ้งลูกค้า<Textarea v-model="reason" rows="4" maxlength="1000" autofocus /></label>
            <template #footer><Button label="กลับ" outlined :disabled="busy" @click="confirmAction = ''" /><Button :label="actionText" :loading="busy" :disabled="busy || (confirmAction === 'reject' && !reason.trim())" @click="act" /></template>
        </Dialog>
    </section>
</template>

<style scoped>
.pending-orders{background:var(--surface-card,#fff);border:1px solid var(--surface-border,#e5e7eb);border-radius:16px;padding:1.25rem;margin-bottom:1.5rem;color:var(--text-color,#1f2937)}
.pending-title,.pending-row,.pending-pager{display:flex;justify-content:space-between;align-items:center;gap:1rem}.pending-title h2{font-size:1.4rem;margin:0}.pending-title p,.pending-row p{margin:.35rem 0;color:var(--text-color-secondary,#64748b)}
.pending-filters{display:flex;gap:.75rem;flex-wrap:wrap;align-items:end;margin:1rem 0}.pending-filters label,.pending-reason{display:flex;flex-direction:column;gap:.35rem}.pending-filters input[type=date]{padding:.65rem;border:1px solid #cbd5e1;border-radius:6px;background:transparent;color:inherit}.pending-row{border-top:1px solid var(--surface-border,#e5e7eb);padding:1rem 0}.pending-row-action{display:flex;gap:1rem;align-items:center}.pending-pager{justify-content:center;margin-top:1rem}
.pending-table{overflow-x:auto}.pending-table table{width:100%;border-collapse:collapse}.pending-table th,.pending-table td{text-align:left;padding:.8rem;border-bottom:1px solid var(--surface-border,#e5e7eb);vertical-align:top}.pending-table th{white-space:nowrap}.pending-location{min-width:245px}.pending-location label{display:block;font-size:.85rem;margin:.25rem 0}.pending-location :deep(.p-select){width:100%}.pending-total{text-align:right;font-size:1.2rem;font-weight:700}
@media(max-width:640px){.pending-title,.pending-row,.pending-row-action{align-items:stretch;flex-direction:column}.pending-filters label{flex:1;min-width:130px}.pending-orders{padding:1rem}.pending-table--allocation table{min-width:600px}.pending-table td,.pending-table th{padding:.45rem .3rem}}
</style>
