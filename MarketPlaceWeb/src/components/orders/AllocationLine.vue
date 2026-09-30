<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import PendingOrderService from '@/services/PendingOrderService';
import InventoryService from '@/services/InventoryService';
import { allocationError } from '@/utils/orderAllocations';
import { remainingQty } from '@/utils/orderWorkspace';

const props = defineProps({ source: Object, docNo: String, warehouses: Array, disabled: Boolean, collapsed: Boolean, checked: Boolean, bulkRevision: Number, shelfLoader: Function });
const emit = defineEmits(['validity', 'health', 'toggle', 'checked', 'done']);
const root = ref(null);
const pickerIndex = ref(null),
    pickerSearch = ref(''),
    picking = ref(false),
    pickerError = ref('');
const options = ref([]);
const shelves = ref({});
const shelfBusy = ref({});
const pendingShelves = new Map();
const loading = ref(false);
const error = ref('');
const stockError = ref('');
let alive = true;
let version = 0;
const isSet = computed(() => Number(props.source.item_type) === 3);
const rows = computed(() => props.source.allocations);
const qty = (value) => (value == null ? 'ไม่ทราบยอด' : Number(value).toLocaleString('th-TH', { maximumFractionDigits: 8 }));
const optionFor = (row) => options.value.find((option) => option.item_code === row.item_code);
const total = computed(() => rows.value.reduce((sum, row) => sum + Number(row.qty || 0), 0));
const remaining = computed(() => remainingQty(props.source, rows.value));
const candidates = computed(() => options.value.filter((option) => `${option.item_code} ${option.item_name}`.toLowerCase().includes(pickerSearch.value.trim().toLowerCase())));
const health = computed(() => ({ short: !isSet.value && rows.value.some((row) => stockAt(row) != null && Number(stockAt(row)) < Number(row.qty)), unknown: !isSet.value && rows.value.some((row) => stockAt(row) == null) }));
watch(health, (value) => emit('health', value), { immediate: true });
const validation = computed(() => {
    if (loading.value) return 'กำลังตรวจสอบสินค้า…';
    const issue = allocationError(props.source, rows.value);
    if (issue) return issue;
    if (!isSet.value && rows.value.some((row) => !optionFor(row)?.selectable)) return 'กรุณาเลือกสินค้าที่หน่วยและภาษีตรงกับคำขอ';
    if (rows.value.some((row) => !props.warehouses?.some((wh) => wh.code === row.wh_code) || !shelves.value[row.wh_code]?.some((shelf) => shelf.code === row.shelf_code))) return 'กรุณาเลือกคลังและที่เก็บจาก master ให้ครบ';
    return '';
});
watch(validation, (value) => emit('validity', !value), { immediate: true });
watch(
    () => props.bulkRevision,
    () => rows.value.forEach((row) => loadShelves(row.wh_code))
);
function focusEditor(index = 0) {
    nextTick(() => root.value?.querySelectorAll('.allocation-entry')[index]?.querySelector('[role="combobox"], input')?.focus());
}
defineExpose({ focusEditor });
function openPicker(index) {
    pickerIndex.value = index;
    pickerSearch.value = '';
    pickerError.value = '';
}
async function selectCandidate(option, location) {
    if (props.disabled || picking.value || !option.selectable) return;
    const row = rows.value[pickerIndex.value];
    if (!row) return;
    picking.value = true;
    pickerError.value = '';
    try {
        if (location) {
            await loadShelves(location.wh_code);
            if (!alive) return;
            if (!props.warehouses?.some((wh) => wh.code === location.wh_code) || !shelves.value[location.wh_code]?.some((shelf) => shelf.code === location.shelf_code)) {
                pickerError.value = 'ตำแหน่งนี้ไม่มีใน master ปัจจุบัน กรุณาเลือกตำแหน่งอื่น';
                return;
            }
        }
        row.item_code = option.item_code;
        row.wh_code = location?.wh_code || '';
        row.shelf_code = location?.shelf_code || '';
        const index = pickerIndex.value;
        pickerIndex.value = null;
        nextTick(() => root.value?.querySelectorAll('.allocation-entry')[index]?.querySelector('input[role="spinbutton"]')?.focus());
    } finally {
        picking.value = false;
    }
}
async function loadShelves(wh) {
    if (!wh || shelves.value[wh]) return;
    if (pendingShelves.has(wh)) return pendingShelves.get(wh);
    shelfBusy.value[wh] = true;
    const request = (props.shelfLoader ? props.shelfLoader(wh) : InventoryService.getShelfList(wh))
        .then((data) => {
            if (alive) {
                shelves.value[wh] = data.map((row) => ({ ...row, label: `${row.code} — ${row.name_1}` }));
                if (error.value === 'โหลดที่เก็บไม่สำเร็จ กรุณาลองอีกครั้ง') error.value = '';
            }
        })
        .catch(() => {
            if (alive) error.value = 'โหลดที่เก็บไม่สำเร็จ กรุณาลองอีกครั้ง';
        })
        .finally(() => {
            pendingShelves.delete(wh);
            if (alive) shelfBusy.value[wh] = false;
        });
    pendingShelves.set(wh, request);
    return request;
}
async function changeWarehouse(row) {
    row.shelf_code = '';
    await loadShelves(row.wh_code);
}
async function chooseLocation(row, location) {
    row.wh_code = location.wh_code;
    row.shelf_code = '';
    await loadShelves(location.wh_code);
    if (alive && row.wh_code === location.wh_code && shelves.value[location.wh_code]?.some((shelf) => shelf.code === location.shelf_code)) row.shelf_code = location.shelf_code;
}
async function loadOptions() {
    if (isSet.value) return;
    const request = ++version;
    loading.value = true;
    error.value = '';
    stockError.value = '';
    try {
        const data = await PendingOrderService.options(props.docNo, props.source.line_number);
        if (!alive || request !== version) return;
        stockError.value = data.stock_error || '';
        options.value = data.options.map((row) => ({
            ...row,
            disabled: !row.selectable,
            label: `${row.item_code} — ${row.item_name}${row.is_original ? ' (รหัสเดิม)' : ''} · ${qty(row.balance_qty)} ${row.unit_code}${row.disabled_reason ? ` · ${row.disabled_reason}` : ''}`
        }));
    } catch (err) {
        if (alive && request === version) {
            options.value = [];
            error.value = err?.response?.data?.message || 'โหลดสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง';
        }
    } finally {
        if (alive && request === version) loading.value = false;
    }
}
function addRow() {
    rows.value.push({ item_code: props.source.item_code, qty: Math.max(0, remaining.value), wh_code: '', shelf_code: '' });
    focusEditor(rows.value.length - 1);
}
function stockAt(row) {
    const option = optionFor(row);
    if (!option || option.balance_qty == null || stockError.value || !row.wh_code || !row.shelf_code) return null;
    return option.locations?.find((location) => location.wh_code === row.wh_code && location.shelf_code === row.shelf_code)?.balance_qty ?? 0;
}
onMounted(() => {
    loadOptions();
    rows.value.forEach((row) => loadShelves(row.wh_code));
});
onBeforeUnmount(() => {
    alive = false;
    version++;
});
</script>

<template>
    <article ref="root" class="allocation-line" :class="{ 'line-ready': !validation, 'line-collapsed': collapsed && !validation }" :aria-label="`จัดสรร ${source.item_code}`">
        <header class="source-heading">
            <div>
                <label class="line-check"
                    ><input type="checkbox" :checked="checked" :disabled="disabled" :aria-label="`เลือกบรรทัด ${source.line_number}`" @change="emit('checked', $event.target.checked)" /><span class="eyebrow"
                        >รายการ {{ source.line_number }} · สินค้าตามคำขอ</span
                    ></label
                >
                <h3>{{ source.item_code }} <span v-if="Number(source.is_permium)" class="pill">ของแถม</span><span v-if="isSet" class="pill">สินค้าชุด</span></h3>
                <p>{{ source.item_name }}</p>
            </div>
            <div class="source-numbers">
                <strong>{{ qty(source.qty) }} {{ source.unit_code }}</strong
                ><span>฿{{ Number(source.sum_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }) }}</span>
                <Button v-if="!validation" :label="collapsed ? 'แก้ไข' : 'ย่อ'" :icon="collapsed ? 'pi pi-pencil' : 'pi pi-angle-up'" text size="small" :disabled="disabled" @click="emit('toggle')" />
            </div>
        </header>
        <div v-if="collapsed && !validation" class="collapsed-summary">
            <p v-for="(row, index) in rows" :key="index">
                → <strong>{{ row.item_code }}</strong> × {{ qty(row.qty) }} {{ source.unit_code }} · {{ row.wh_code }} / {{ row.shelf_code }}
            </p>
            <span :class="health.short ? 'validation' : 'complete'">✓ จัดสรรครบ{{ health.short ? ' · สต๊อกไม่พอ' : health.unknown ? ' · ไม่ทราบสต๊อก' : '' }}</span>
        </div>
        <div v-show="!collapsed || validation">
            <p v-if="isSet" class="set-note">ชุดและส่วนประกอบใช้คลัง / ที่เก็บเดียวกัน ไม่เปลี่ยนรหัสหรือแบ่งจำนวน</p>
            <details v-if="source.sub_item?.length" class="set-note">
                <summary>ส่วนประกอบ {{ source.sub_item.length }} รายการ</summary>
                <p v-for="sub in source.sub_item" :key="sub.line_number">{{ sub.item_code }} · {{ sub.item_name }} × {{ sub.qty }} {{ sub.unit_code }}</p>
            </details>
            <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
            <Message v-if="stockError" severity="warn" :closable="false">{{ stockError }}</Message>
            <fieldset :disabled="disabled" class="allocation-fields">
                <div v-for="(row, index) in rows" :key="index" class="allocation-entry">
                    <div class="allocation-grid">
                        <div class="product-field">
                            <span>→ สินค้าจริง {{ index + 1 }}</span
                            ><Select
                                v-if="!isSet"
                                v-model="row.item_code"
                                :options="options"
                                optionLabel="label"
                                optionValue="item_code"
                                optionDisabled="disabled"
                                filter
                                :loading="loading"
                                :aria-label="`รหัสสินค้าจริง ${index + 1}`"
                                :disabled="disabled"
                                ><template #value
                                    ><strong>{{ row.item_code }}</strong></template
                                ></Select
                            ><strong v-else>{{ row.item_code }}</strong
                            ><small>{{ optionFor(row)?.item_name || source.item_name }}</small
                            ><Button v-if="!isSet" label="เลือกสินค้า + ตำแหน่ง" icon="pi pi-map-marker" outlined size="small" :disabled="disabled || loading" @click="openPicker(index)" />
                        </div>
                        <label
                            ><span>จำนวน ({{ source.unit_code }})</span><InputNumber v-model="row.qty" :min="0" :max="Number(source.qty)" :maxFractionDigits="8" :aria-label="`จำนวนจัดสรร ${index + 1}`" :disabled="disabled || isSet" /><Button
                                v-if="!isSet && rows.length > 1 && remainingQty(source, rows, index) > 0 && remaining !== 0"
                                label="เติมส่วนที่เหลือ"
                                text
                                size="small"
                                :disabled="disabled"
                                @click="row.qty = remainingQty(source, rows, index)"
                        /></label>
                        <label
                            ><span>คลัง</span
                            ><Select v-model="row.wh_code" :options="warehouses" optionLabel="label" optionValue="code" filter placeholder="เลือกคลัง" :aria-label="`คลังจัดสรร ${index + 1}`" :disabled="disabled" @change="changeWarehouse(row)"
                        /></label>
                        <label
                            ><span>ที่เก็บ</span
                            ><Select
                                v-model="row.shelf_code"
                                :options="shelves[row.wh_code] || []"
                                optionLabel="label"
                                optionValue="code"
                                filter
                                placeholder="เลือกที่เก็บ"
                                :aria-label="`ที่เก็บจัดสรร ${index + 1}`"
                                :disabled="disabled || !row.wh_code"
                        /></label>
                        <Button icon="pi pi-trash" text severity="secondary" :aria-label="`ลบรายการ ${index + 1}`" :disabled="disabled || rows.length === 1 || isSet" @click="rows.splice(index, 1)" />
                    </div>
                    <Button
                        v-if="row.wh_code && !shelves[row.wh_code]"
                        :label="shelfBusy[row.wh_code] ? 'กำลังโหลดที่เก็บ' : 'โหลดที่เก็บอีกครั้ง'"
                        :loading="shelfBusy[row.wh_code]"
                        :disabled="disabled"
                        text
                        size="small"
                        @click="loadShelves(row.wh_code)"
                    />
                    <small v-if="row.wh_code && shelves[row.wh_code]?.length === 0">คลังนี้ยังไม่มีที่เก็บใน master</small>
                    <p v-if="row.wh_code && row.shelf_code" class="location-caption">
                        {{ row.wh_code }} · {{ warehouses?.find((wh) => wh.code === row.wh_code)?.name_1 }} / {{ row.shelf_code }} · {{ shelves[row.wh_code]?.find((shelf) => shelf.code === row.shelf_code)?.name_1 }}
                    </p>
                    <div v-if="!isSet" class="stock-strip">
                        <span class="stock-badge" :class="stockAt(row) == null ? 'unknown' : Number(stockAt(row)) < Number(row.qty) ? 'short' : 'enough'">{{
                            stockAt(row) == null
                                ? 'ยังไม่ทราบยอด · ต้องตรวจสต๊อกสำเร็จก่อนสร้าง QT'
                                : `ตำแหน่งที่เลือก: ${qty(stockAt(row))} ${source.unit_code}${Number(stockAt(row)) < Number(row.qty) ? ' · ไม่พอ กรุณาเปลี่ยนการจัดสรร' : ' · เพียงพอ ณ เวลาที่โหลด'}`
                        }}</span>
                        <details v-if="optionFor(row)">
                            <summary>สต๊อกจริงรวม {{ qty(optionFor(row).balance_qty) }} {{ source.unit_code }} · ดูตำแหน่ง</summary>
                            <div v-for="location in optionFor(row).locations" :key="`${location.wh_code}/${location.shelf_code}`" class="stock-location">
                                <span
                                    >{{ location.wh_code }} {{ location.wh_name }} / {{ location.shelf_code }} {{ location.shelf_name }} · <strong>{{ qty(location.balance_qty) }} {{ source.unit_code }}</strong></span
                                ><Button label="ใช้ตำแหน่งนี้" text size="small" :disabled="disabled || !warehouses?.some((wh) => wh.code === location.wh_code)" @click="chooseLocation(row, location)" />
                            </div>
                            <p v-if="!optionFor(row).locations?.length">ไม่มีข้อมูลตำแหน่งจากฟังก์ชันสต๊อก</p>
                        </details>
                    </div>
                    <small v-if="optionFor(row)?.disabled_reason" class="validation">{{ optionFor(row).disabled_reason }}</small>
                </div>
            </fieldset>
            <footer class="line-footer">
                <div>
                    <Button v-if="!isSet" label="เพิ่มรายการจัดสรร" icon="pi pi-plus" text size="small" :disabled="disabled" @click="addRow" /><Button
                        v-if="!isSet"
                        icon="pi pi-refresh"
                        text
                        size="small"
                        aria-label="โหลดสินค้าและสต๊อกใหม่"
                        :loading="loading"
                        :disabled="disabled"
                        @click="loadOptions"
                    />
                </div>
                <span aria-live="polite" :class="validation ? 'validation' : 'complete'">{{ !validation ? '✓ พร้อม' : 'จัดสรรแล้ว' }} {{ qty(total) }} / {{ qty(source.qty) }} {{ source.unit_code }}</span>
                <Button v-if="!validation" label="เสร็จและถัดไป" icon="pi pi-check" size="small" outlined :disabled="disabled" @click="emit('done')" />
            </footer>
            <p v-if="remaining !== 0" class="validation validation-note" role="status">{{ remaining > 0 ? 'ยังขาด' : 'เกิน' }} {{ qty(Math.abs(remaining)) }} {{ source.unit_code }}</p>
            <p v-if="validation" class="validation validation-note">{{ validation }}</p>
        </div>
        <Dialog
            :visible="pickerIndex !== null"
            modal
            header="เลือกสินค้าและตำแหน่ง"
            :style="{ width: 'min(820px, 96vw)' }"
            :closable="!picking"
            @update:visible="
                (value) => {
                    if (!value && !picking) pickerIndex = null;
                }
            "
        >
            <p>{{ source.item_code }} · จำนวนส่วนนี้ {{ qty(rows[pickerIndex]?.qty) }} {{ source.unit_code }} — เลือกตำแหน่งครั้งเดียวเพื่อใส่สินค้า คลัง และที่เก็บ</p>
            <InputText v-model="pickerSearch" placeholder="ค้นหารหัสหรือชื่อสินค้าจริง" aria-label="ค้นหาสินค้าและตำแหน่ง" class="picker-search" autofocus />
            <Message v-if="pickerError" severity="error" :closable="false">{{ pickerError }}</Message>
            <p v-if="!candidates.length">ไม่พบสินค้าที่ค้นหา</p>
            <article v-for="option in candidates" :key="option.item_code" class="picker-product">
                <header>
                    <strong>{{ option.item_code }} {{ option.is_original ? '(รหัสเดิม)' : '' }}</strong
                    ><span>คงเหลือจริง {{ qty(option.balance_qty) }} {{ option.unit_code }}</span>
                </header>
                <p>{{ option.item_name }}</p>
                <p v-if="!option.selectable" class="validation">{{ option.disabled_reason || 'หน่วยหรือภาษีไม่ตรงกับต้นทาง' }}</p>
                <button
                    v-for="location in option.locations"
                    :key="`${location.wh_code}/${location.shelf_code}`"
                    type="button"
                    class="picker-location"
                    :disabled="picking || !option.selectable || !warehouses?.some((wh) => wh.code === location.wh_code) || (shelves[location.wh_code] && !shelves[location.wh_code].some((shelf) => shelf.code === location.shelf_code))"
                    @click="selectCandidate(option, location)"
                >
                    <span>{{ location.wh_code }} {{ location.wh_name }} / {{ location.shelf_code }} {{ location.shelf_name }}</span
                    ><strong>{{ qty(location.balance_qty) }} {{ source.unit_code }} → เลือก</strong>
                </button>
                <Button label="เลือกสินค้าอย่างเดียว" text size="small" :disabled="picking || !option.selectable" @click="selectCandidate(option)" />
            </article>
            <template #footer><small>เลือกเพื่อจัดสรรได้ · ก่อนสร้าง QT ต้องตรวจสต๊อกล่าสุดว่าพอ</small><Button label="กลับ" outlined :disabled="picking" @click="pickerIndex = null" /></template>
        </Dialog>
    </article>
</template>

<style scoped>
.line-check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.line-ready {
    border-left: 3px solid #397452 !important;
}
.collapsed-summary {
    padding: 0.6rem 1rem;
    font-size: 0.95rem;
}
.collapsed-summary p {
    margin: 0.25rem 0;
    overflow-wrap: anywhere;
}
.line-collapsed .source-heading {
    padding: 0.6rem 1rem;
}
.line-collapsed .source-numbers {
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
}
.location-caption {
    font-size: 0.85rem;
    color: #506657;
    margin: 0.35rem 0;
    overflow-wrap: anywhere;
}
.picker-search {
    width: 100%;
    margin: 0.5rem 0;
}
.picker-product {
    border: 1px solid #dce6e0;
    border-radius: 10px;
    padding: 1rem;
    margin: 0.8rem 0;
}
.picker-product header,
.picker-location {
    display: flex;
    justify-content: space-between;
    gap: 0.7rem;
    flex-wrap: wrap;
}
.picker-product p {
    margin: 0.5rem 0;
}
.picker-location {
    width: 100%;
    text-align: left;
    border: 1px solid #dce6e0;
    border-radius: 6px;
    padding: 0.8rem;
    margin: 0.4rem 0;
    background: #f6faf7;
    color: #244c32;
    cursor: pointer;
    font: inherit;
}
.picker-location:hover {
    background: #e8f3eb;
}
.picker-location:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.picker-location:focus-visible {
    outline: 2px solid #397452;
}
.line-footer {
    flex-wrap: wrap;
}
.allocation-line {
    border: 1px solid #dce6e0;
    border-radius: 14px;
    background: #fff;
    overflow: hidden;
    color: #20392d;
}
.source-heading {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.2rem;
    background: #f5f8f5;
}
.eyebrow {
    font-size: 0.75rem;
    color: #63766b;
}
.source-heading h3 {
    font-size: 1rem;
    margin: 0.25rem 0;
}
.source-heading p {
    margin: 0;
    color: #52675b;
}
.source-numbers {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    text-align: right;
    white-space: nowrap;
}
.source-numbers span {
    font-size: 0.85rem;
    color: #63766b;
}
.pill {
    font-size: 0.7rem;
    background: #e2eee6;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
}
.allocation-fields {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
}
.allocation-entry {
    padding: 0.9rem 1.2rem;
    border-top: 1px solid #edf1ed;
}
.allocation-grid {
    display: grid;
    grid-template-columns: minmax(150px, 1.3fr) minmax(90px, 0.65fr) minmax(125px, 1fr) minmax(125px, 1fr) 32px;
    gap: 0.7rem;
    align-items: start;
}
.allocation-grid label,
.allocation-grid .product-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
}
.allocation-grid label > span,
.allocation-grid .product-field > span {
    font-size: 0.75rem;
    color: #5f7165;
}
.allocation-grid small {
    font-size: 0.75rem;
    overflow-wrap: anywhere;
    color: #65766c;
}
.allocation-grid :deep(.p-select),
.allocation-grid :deep(.p-inputnumber),
.allocation-grid :deep(input) {
    width: 100%;
    min-width: 0;
}
.allocation-grid > .p-button {
    margin-top: 1.7rem;
}
.stock-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-top: 0.7rem;
    font-size: 0.75rem;
    align-items: start;
}
.stock-badge {
    border-radius: 5px;
    padding: 0.25rem 0.5rem;
}
.unknown {
    background: #f0f2f3;
    color: #54616a;
}
.enough {
    background: #e9f5ee;
    color: #22623d;
}
.short {
    background: #fff1db;
    color: #915419;
}
.stock-strip details {
    flex: 1;
    min-width: 180px;
}
.stock-strip summary {
    cursor: pointer;
    padding: 0.25rem 0;
    color: #586c5f;
}
.stock-location {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #edf1ed;
}
.line-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 1rem;
    border-top: 1px dashed #dce6e0;
    font-size: 0.8rem;
}
.validation {
    color: #97551c;
}
.complete {
    color: #246442;
    font-weight: 600;
}
.validation-note {
    margin: 0;
    padding: 0 1.2rem 0.8rem;
    font-size: 0.75rem;
}
.set-note {
    margin: 0.7rem 1.2rem;
    font-size: 0.8rem;
    color: #63766b;
}
.eyebrow,
.allocation-grid label > span,
.allocation-grid .product-field > span,
.allocation-grid small,
.stock-strip,
.validation-note,
.set-note {
    font-size: 0.9rem;
}
.source-heading {
    padding: 0.7rem 1rem;
}
.source-heading h3 {
    font-size: 1.1rem;
}
.line-footer {
    font-size: 0.95rem;
}
.source-heading input[type='checkbox'] {
    width: 17px;
    height: 17px;
}
@media (max-width: 1100px) {
    .allocation-grid {
        grid-template-columns: minmax(120px, 1fr) 90px minmax(100px, 1fr) minmax(100px, 1fr) 28px;
        gap: 0.45rem;
    }
    .allocation-entry {
        padding: 0.8rem;
    }
    .source-heading {
        padding: 1rem;
    }
}
@media (max-width: 760px) {
    .allocation-grid {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px;
        gap: 0.7rem;
    }
    .product-field {
        grid-column: 1/3;
    }
    .allocation-grid > label:nth-child(2) {
        grid-column: 1/3;
        grid-row: 2;
    }
    .allocation-grid > label:nth-child(3) {
        grid-column: 1;
        grid-row: 3;
    }
    .allocation-grid > label:nth-child(4) {
        grid-column: 2/4;
        grid-row: 3;
    }
    .allocation-grid > .p-button {
        grid-column: 3;
        grid-row: 1;
        margin-top: 1.5rem;
    }
    .source-heading {
        gap: 0.5rem;
    }
    .source-heading h3 {
        overflow-wrap: anywhere;
    }
    .source-numbers {
        font-size: 0.85rem;
    }
    .allocation-entry + .allocation-entry {
        border-top: 4px solid #f0f4f1;
    }
    .line-footer {
        flex-wrap: wrap;
    }
    .stock-location {
        align-items: start;
        flex-direction: column;
    }
}
</style>
