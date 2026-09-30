<script setup>
import { computed, ref, watch } from 'vue';
import PendingOrderService from '@/services/PendingOrderService';
import InventoryService from '@/services/InventoryService';
import { allocationError } from '@/utils/orderAllocations';

const props = defineProps({ visible: Boolean, source: Object, docNo: String, warehouses: Array });
const emit = defineEmits(['update:visible', 'apply']);
const draft = ref([]);
const options = ref([]);
const shelves = ref({});
const shelfBusy = ref({});
const loading = ref(false);
const error = ref('');
const stockError = ref('');
let version = 0;
const quantity = value => value === null ? 'ไม่ทราบยอด' : Number(value).toLocaleString('th-TH', { maximumFractionDigits: 8 });
const optionFor = row => options.value.find(option => option.item_code === row.item_code);
const total = computed(() => draft.value.reduce((sum, row) => sum + Number(row.qty || 0), 0));
const validation = computed(() => {
    if (!props.source) return '';
    const problem = allocationError(props.source, draft.value);
    if (problem) return problem;
    if (draft.value.some(row => !optionFor(row)?.selectable)) return 'มีสินค้าที่ไม่สามารถเลือกได้ กรุณาตรวจสอบหน่วยและภาษี';
    if (draft.value.some(row => shelfBusy.value[row.wh_code] || !(shelves.value[row.wh_code] || []).some(shelf => shelf.code === row.shelf_code))) return 'กรุณาเลือกที่เก็บจาก master ของคลังที่เลือก';
    return '';
});
async function loadShelves(wh) {
    if (!wh || shelves.value[wh]) return;
    if (shelfBusy.value[wh]) return;
    shelfBusy.value[wh] = true;
    try { shelves.value[wh] = (await InventoryService.getShelfList(wh)).map(row => ({ ...row, label: `${row.code} — ${row.name_1}` })); }
    catch (err) { error.value = err?.response?.data?.message || 'โหลดที่เก็บไม่สำเร็จ กรุณาลองใหม่'; }
    finally { shelfBusy.value[wh] = false; }
}
async function changeWarehouse(row) { row.shelf_code = ''; await loadShelves(row.wh_code); }
async function chooseLocation(row, location) {
    row.wh_code = location.wh_code; row.shelf_code = '';
    await loadShelves(row.wh_code);
    if ((shelves.value[row.wh_code] || []).some(shelf => shelf.code === location.shelf_code)) row.shelf_code = location.shelf_code;
}
async function loadOptions() {
    const request = ++version;
    loading.value = true; error.value = ''; stockError.value = '';
    try {
        const data = await PendingOrderService.options(props.docNo, props.source.line_number);
        if (request !== version) return;
        stockError.value = data.stock_error || '';
        options.value = data.options.map(row => ({ ...row, disabled: !row.selectable,
            label: `${row.item_code} — ${row.item_name}${row.is_original ? ' (รหัสเดิม)' : ''} · ${quantity(row.balance_qty)} ${row.unit_code}${row.disabled_reason ? ` · ${row.disabled_reason}` : ''}` }));
    } catch (err) { if (request === version) error.value = err?.response?.data?.message || 'โหลดรายการสินค้าไม่สำเร็จ'; }
    finally { if (request === version) loading.value = false; }
}
watch(() => props.visible, async visible => {
    if (!visible) { version++; return; }
    options.value = []; shelves.value = {};
    draft.value = props.source.allocations?.map(row => ({ ...row })) || [{ item_code: props.source.item_code, qty: Number(props.source.qty), wh_code: props.source.wh_code || '', shelf_code: props.source.shelf_code || '' }];
    await Promise.all([loadOptions(), ...draft.value.map(row => loadShelves(row.wh_code))]);
});
function addRow() {
    draft.value.push({ item_code: props.source.item_code, qty: Math.max(0, Number(props.source.qty) - total.value), wh_code: '', shelf_code: '' });
}
function apply() {
    if (loading.value || validation.value) return;
    emit('apply', draft.value.map(({ item_code, qty, wh_code, shelf_code }) => ({ item_code, qty: Number(qty), wh_code, shelf_code })));
    emit('update:visible', false);
}
</script>

<template>
    <Dialog :visible="visible" modal header="เปลี่ยน/แบ่งสินค้า" :style="{ width: 'min(980px, 96vw)' }" @update:visible="emit('update:visible', $event)">
        <template v-if="source">
            <p><strong>{{ source.item_code }} — {{ source.item_name }}</strong></p>
            <p>จำนวนตามคำขอ {{ quantity(source.qty) }} {{ source.unit_code }} · ราคา ส่วนลด และภาษีคงเดิม</p>
            <p class="allocation-note">สต๊อกด้านล่างเป็นยอดจริงรายรหัส ไม่ใช่ยอดรวมกลุ่ม ก่อนสร้าง QT ระบบจะตรวจยอดล่าสุดตามคลัง/ที่เก็บ ต้องมีพอทุกสินค้า</p>
            <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
            <Message v-if="stockError" severity="warn" :closable="false">{{ stockError }}</Message>
            <Button label="โหลดสินค้าและสต๊อกใหม่" icon="pi pi-refresh" text :loading="loading" @click="loadOptions" />
            <div v-for="(row, index) in draft" :key="index" class="allocation-card">
                <div class="allocation-card-title"><strong>รายการจัดสรร {{ index + 1 }}</strong><Button label="ลบรายการ" icon="pi pi-trash" text severity="danger" :disabled="draft.length === 1" @click="draft.splice(index, 1)" /></div>
                <label>รหัสสินค้าจริง<Select v-model="row.item_code" :options="options" optionLabel="label" optionValue="item_code" optionDisabled="disabled" filter :loading="loading" :aria-label="`รหัสสินค้าจริง ${index + 1}`" /></label>
                <div class="allocation-controls">
                    <label>จำนวน ({{ source.unit_code }})<InputNumber v-model="row.qty" :min="0" :max="Number(source.qty)" :maxFractionDigits="8" :aria-label="`จำนวนจัดสรร ${index + 1}`" /></label>
                    <label>คลัง<Select v-model="row.wh_code" :options="warehouses" optionLabel="label" optionValue="code" filter placeholder="เลือกคลัง" :aria-label="`คลังจัดสรร ${index + 1}`" @change="changeWarehouse(row)" /></label>
                    <label>ที่เก็บ<Select v-model="row.shelf_code" :options="shelves[row.wh_code] || []" optionLabel="label" optionValue="code" filter placeholder="เลือกที่เก็บ" :disabled="!row.wh_code" :loading="shelfBusy[row.wh_code]" :aria-label="`ที่เก็บจัดสรร ${index + 1}`" /></label>
                </div>
                <Button v-if="row.wh_code && !shelves[row.wh_code] && !shelfBusy[row.wh_code]" label="โหลดที่เก็บอีกครั้ง" text @click="loadShelves(row.wh_code)" />
                <p v-if="optionFor(row)">คงเหลือจริงรวม: <strong>{{ quantity(optionFor(row).balance_qty) }} {{ optionFor(row).unit_code }}</strong></p>
                <Message v-if="optionFor(row)?.disabled_reason" severity="warn" :closable="false">{{ optionFor(row).disabled_reason }}</Message>
                <details v-if="optionFor(row)?.locations?.length" open><summary>สต๊อกแยกคลัง / ที่เก็บ</summary>
                    <div v-for="location in optionFor(row).locations" :key="`${location.wh_code}/${location.shelf_code}`" class="allocation-stock">
                        <span>{{ location.wh_code }} {{ location.wh_name }} / {{ location.shelf_code }} {{ location.shelf_name }} — {{ quantity(location.balance_qty) }} {{ source.unit_code }}</span>
                        <Button label="ใช้ตำแหน่งนี้" text size="small" :disabled="!warehouses?.some(wh => wh.code === location.wh_code)" @click="chooseLocation(row, location)" />
                    </div>
                </details>
            </div>
            <Button label="เพิ่มรายการจัดสรร" icon="pi pi-plus" outlined @click="addRow" />
            <p aria-live="polite">จัดสรรแล้ว {{ quantity(total) }} / {{ quantity(source.qty) }} {{ source.unit_code }}</p>
            <Message v-if="validation && !loading" severity="warn" :closable="false">{{ validation }}</Message>
        </template>
        <template #footer><Button label="ยกเลิก" outlined @click="emit('update:visible', false)" /><Button label="ใช้รายการจัดสรร" :disabled="loading || !!validation" @click="apply" /></template>
    </Dialog>
</template>

<style scoped>
.allocation-note{color:var(--text-color-secondary)}.allocation-card{border:1px solid var(--surface-border);border-radius:12px;padding:1rem;margin:1rem 0}.allocation-card-title,.allocation-stock{display:flex;align-items:center;justify-content:space-between;gap:1rem}.allocation-card label{display:flex;flex-direction:column;gap:.35rem;min-width:0}.allocation-card :deep(.p-select){width:100%}.allocation-controls{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin:1rem 0}.allocation-controls :deep(input){width:100%}.allocation-stock{padding:.35rem 0;border-bottom:1px solid var(--surface-border)}
@media(max-width:640px){.allocation-controls{grid-template-columns:1fr}.allocation-stock{align-items:flex-start;flex-direction:column;gap:0}.allocation-card{padding:.75rem}}
</style>
