<script setup>
import ProductService from '@/services/ProductService';
import InventoryService from '@/services/InventoryService';
import { useLanguageStore } from '@/stores/languageStore';
import { pickMasterName, pickProductName } from '@/utils/languageDisplay';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';

const router = useRouter();
const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;

const search = ref('');
const barcode = ref('');
const searchResults = ref([]);
const searchLoading = ref(false);
const selectedProduct = ref(null);
const units = ref([]);
const detailLoading = ref(false);
let searchTimer = null;
let searchSeq = 0;
let detailSeq = 0;

const whList = ref([]);
const shelfList = ref([]);
const selectedWh = ref('');
const selectedShelf = ref('');
const locationBalance = ref(null);
const warehouseLoading = ref(false);
const shelfLoading = ref(false);
const balanceLoading = ref(false);
let warehouseSeq = 0;
let shelfSeq = 0;
let balanceSeq = 0;

const showAdjust = ref(false);
const adjustUnit = ref(null);
const adjustQty = ref(null);
const adjustSaving = ref(false);

const canAdjust = computed(() => selectedWh.value !== '' && selectedShelf.value !== '');
const isLocationBusy = computed(() => warehouseLoading.value || shelfLoading.value || balanceLoading.value);
const isInventoryBusy = computed(() => searchLoading.value || detailLoading.value || isLocationBusy.value || adjustSaving.value);
const canUseSearch = computed(() => !detailLoading.value && !adjustSaving.value);
const canOpenAdjust = computed(() => canAdjust.value && !detailLoading.value && !isLocationBusy.value && !adjustSaving.value);
const canConfirmAdjust = computed(() => adjustQty.value !== null && adjustQty.value >= 0 && !adjustSaving.value && !!selectedProduct.value && !!adjustUnit.value);
const adjustCurrentBalance = computed(() => (adjustUnit.value ? effectiveBalance(adjustUnit.value) : 0));
const selectedProductName = computed(() => getProductDisplayName(selectedProduct.value));

function getMasterDisplayName(row) {
    return pickMasterName(row, languageStore.locale) || row?.name_1 || row?.name || '';
}

function getProductDisplayName(product) {
    return pickProductName(product, languageStore.locale) || product?.display_name || product?.item_name || product?.name || '';
}

onMounted(async () => {
    const requestId = ++warehouseSeq;
    warehouseLoading.value = true;
    try {
        const list = await InventoryService.getWarehouseList();
        if (requestId !== warehouseSeq) return;
        whList.value = [{ code: '', name_1: t('inventory.allWarehouses'), name_2: 'All Warehouses' }, ...list];
    } catch (error) {
        if (requestId !== warehouseSeq) return;
        toast.add({ severity: 'error', summary: t('inventory.loadWarehouseFailed'), detail: error.message, life: 3000 });
    } finally {
        if (requestId === warehouseSeq) warehouseLoading.value = false;
    }
});

watch(selectedWh, async (wh) => {
    const requestId = ++shelfSeq;
    const balanceRequestId = ++balanceSeq;
    const productCode = selectedProduct.value?.item_code;
    selectedShelf.value = '';
    shelfList.value = [];
    locationBalance.value = null;
    balanceLoading.value = false;

    if (!wh) return;

    shelfLoading.value = true;
    if (productCode) balanceLoading.value = true;

    try {
        const fetches = [InventoryService.getShelfList(wh)];
        if (productCode) {
            fetches.push(InventoryService.getInventoryBalance(productCode, wh, ''));
        }
        const [list, balance] = await Promise.all(fetches);
        if (requestId !== shelfSeq || selectedWh.value !== wh || selectedProduct.value?.item_code !== productCode) return;
        shelfList.value = [{ code: '', name_1: t('inventory.allShelves'), name_2: 'All Locations' }, ...list];
        if (balance !== undefined) locationBalance.value = balance;
    } catch (error) {
        if (requestId !== shelfSeq) return;
        toast.add({ severity: 'error', summary: t('inventory.loadShelfFailed'), detail: error.message, life: 3000 });
    } finally {
        if (requestId === shelfSeq) shelfLoading.value = false;
        if (balanceRequestId === balanceSeq) balanceLoading.value = false;
    }
});

watch(selectedShelf, async (shelf) => {
    const requestId = ++balanceSeq;
    const wh = selectedWh.value;
    const productCode = selectedProduct.value?.item_code;

    if (!selectedWh.value || !selectedProduct.value) {
        locationBalance.value = null;
        balanceLoading.value = false;
        return;
    }

    balanceLoading.value = true;
    try {
        const balance = await InventoryService.getInventoryBalance(productCode, wh, shelf);
        if (requestId !== balanceSeq || selectedWh.value !== wh || selectedShelf.value !== shelf || selectedProduct.value?.item_code !== productCode) return;
        locationBalance.value = balance;
    } catch (error) {
        if (requestId !== balanceSeq) return;
        toast.add({ severity: 'error', summary: t('inventory.loadBalanceFailed'), detail: error.message, life: 3000 });
    } finally {
        if (requestId === balanceSeq) balanceLoading.value = false;
    }
});

function onSearchInput() {
    if (!canUseSearch.value) return;

    clearTimeout(searchTimer);
    detailSeq++;
    balanceSeq++;
    selectedProduct.value = null;
    units.value = [];
    locationBalance.value = null;

    if (!search.value.trim()) {
        searchSeq++;
        searchResults.value = [];
        searchLoading.value = false;
        return;
    }

    searchTimer = setTimeout(doSearch, 450);
}

async function doSearch() {
    const query = search.value.trim();
    if (!query || !canUseSearch.value) return;

    const requestId = ++searchSeq;
    searchLoading.value = true;
    try {
        const result = await ProductService.getProducts({ search: query, includeAllPattern: true }, 0);
        if (requestId !== searchSeq || search.value.trim() !== query) return;
        searchResults.value = result?.data || [];
    } catch (error) {
        if (requestId !== searchSeq) return;
        searchResults.value = [];
        toast.add({ severity: 'error', summary: t('inventory.productSearchFailed'), detail: error.message, life: 3000 });
    } finally {
        if (requestId === searchSeq) searchLoading.value = false;
    }
}

async function searchBarcode() {
    const value = barcode.value.trim();
    if (!value || !canUseSearch.value || searchLoading.value) return;

    const requestId = ++searchSeq;
    searchLoading.value = true;
    try {
        const product = await InventoryService.getProductByBarcode(value);
        if (requestId !== searchSeq || barcode.value.trim() !== value) return;
        if (!product) {
            toast.add({ severity: 'warn', summary: t('inventory.productNotFound'), detail: t('inventory.barcodeNotFound', { barcode: value }), life: 3000 });
            return;
        }
        search.value = getProductDisplayName(product) || product.item_code;
        searchResults.value = [product];
        await selectProduct(product);
    } catch (error) {
        if (requestId !== searchSeq) return;
        toast.add({ severity: 'error', summary: t('inventory.barcodeSearchFailed'), detail: error.message, life: 3000 });
    } finally {
        if (requestId === searchSeq) searchLoading.value = false;
    }
}

async function selectProduct(product, { force = false } = {}) {
    if (!product?.item_code || detailLoading.value || (!force && adjustSaving.value)) return;

    const requestId = ++detailSeq;
    const productCode = product.item_code;
    selectedProduct.value = product;
    units.value = [];
    locationBalance.value = null;
    detailLoading.value = true;

    try {
        const detail = await ProductService.getProductByItemCode(productCode);
        if (requestId !== detailSeq || selectedProduct.value?.item_code !== productCode) return;
        const primary = detail?.data;
        units.value = primary ? [primary, ...(primary.otherUnits || [])] : [];

        if (selectedWh.value) {
            const balanceRequestId = ++balanceSeq;
            const wh = selectedWh.value;
            const shelf = selectedShelf.value;
            balanceLoading.value = true;
            const balance = await InventoryService.getInventoryBalance(productCode, wh, shelf);
            if (balanceRequestId !== balanceSeq || requestId !== detailSeq || selectedWh.value !== wh || selectedShelf.value !== shelf || selectedProduct.value?.item_code !== productCode) return;
            locationBalance.value = balance;
        }
    } catch (error) {
        if (requestId !== detailSeq) return;
        toast.add({ severity: 'error', summary: t('inventory.productDetailFailed'), detail: getProductDisplayName(product) || product.item_code, life: 3000 });
    } finally {
        if (requestId === detailSeq) detailLoading.value = false;
        if (!selectedWh.value || requestId === detailSeq) balanceLoading.value = false;
    }
}

function clearSelection() {
    if (detailLoading.value || adjustSaving.value) return;

    detailSeq++;
    balanceSeq++;
    selectedProduct.value = null;
    searchResults.value = [];
    units.value = [];
    locationBalance.value = null;
    balanceLoading.value = false;
}

function getSumBalance(unit) {
    return locationBalance.value !== null ? locationBalance.value : Number(unit.sum_balance_qty ?? 0);
}

function rawBalance(unit) {
    const safeRatio = Math.max(1, Number(unit.ratio || 1));
    return Math.floor(getSumBalance(unit) / safeRatio);
}

function effectiveBalance(unit) {
    return Math.max(0, rawBalance(unit));
}

function isBaseUnit(unit) {
    return unit.unit_code === selectedProduct.value?.unit_standard;
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString('th-TH');
}

function openAdjust(unit) {
    if (!canOpenAdjust.value) return;

    adjustUnit.value = {
        ...unit,
        wh_code: selectedWh.value,
        shelf_code: selectedShelf.value
    };
    adjustQty.value = Math.max(0, rawBalance(unit));
    showAdjust.value = true;
}

function getEmployeeCode() {
    try {
        const empData = JSON.parse(localStorage.getItem('_empData') || '{}');
        return localStorage.getItem('_empCode') || empData.user_code || empData.code || '';
    } catch {
        return localStorage.getItem('_empCode') || '';
    }
}

async function confirmAdjust() {
    if (!canConfirmAdjust.value) return;

    adjustSaving.value = true;
    try {
        const result = await InventoryService.adjustStock({
            item_code: selectedProduct.value.item_code,
            item_name: selectedProduct.value.item_name,
            unit_code: adjustUnit.value.unit_code,
            barcode: adjustUnit.value.barcode || '',
            wh_code: adjustUnit.value.wh_code || '',
            shelf_code: adjustUnit.value.shelf_code || '',
            branch_code: import.meta.env.VITE_APP_BRANCH_CODE || '',
            emp_code: getEmployeeCode(),
            qty: adjustQty.value
        });

        // การปรับสต็อกออกเอกสาร 2 ใบ: ใบนับ (MSTC) กับใบปรับผลต่าง (IS) เมื่อจำนวนเปลี่ยนจริง
        // เดิมแจ้งแค่ใบนับ พนักงานจึงตามหาเอกสารที่เพิ่ม/ลดสต็อกจริงใน ERP ไม่เจอ
        const docNos = [result?.doc_no, result?.doc_no_adj].filter(Boolean);
        toast.add({
            severity: 'success',
            summary: t('inventory.saved'),
            detail: docNos.length ? t('inventory.documentNo', { docNo: docNos.join(' · ') }) : t('inventory.stockAdjusted'),
            life: 5000
        });

        showAdjust.value = false;
        await selectProduct(selectedProduct.value, { force: true });
    } catch (error) {
        toast.add({ severity: 'error', summary: t('inventory.saveFailed'), detail: error.response?.data?.ERROR || error.message, life: 4000 });
    } finally {
        adjustSaving.value = false;
    }
}
</script>

<template>
    <main class="inventory-page">
        <header class="inventory-head">
            <div>
                <p>Back Office</p>
                <h1><i class="pi pi-box"></i> {{ t('inventory.title') }}</h1>
                <span>{{ t('inventory.subtitle') }}</span>
            </div>
            <Button :label="t('common.mainMenu')" icon="pi pi-arrow-left" outlined class="inventory-back-button" :disabled="isInventoryBusy" @click="router.push('/admin')" />
        </header>

        <section class="inventory-panel location-panel">
            <div class="field">
                <label>{{ t('inventory.warehouse') }}</label>
                <Select v-model="selectedWh" :options="whList" optionLabel="name_1" optionValue="code" :placeholder="t('inventory.selectWarehouse')" :aria-label="t('inventory.selectWarehouse')" :loading="warehouseLoading" :disabled="warehouseLoading || detailLoading || adjustSaving" class="w-full">
                    <template #value="{ value }">
                        <span v-if="value !== undefined && value !== null">
                            {{ whList.find((w) => w.code === value)?.code || '' }}
                            {{ getMasterDisplayName(whList.find((w) => w.code === value)) }}
                        </span>
                    </template>
                    <template #option="{ option }">
                        <span class="loc-code">{{ option.code }}</span>
                        <span class="loc-name">{{ getMasterDisplayName(option) }}</span>
                    </template>
                </Select>
            </div>
            <div class="field">
                <label>{{ t('inventory.shelf') }}</label>
                <Select v-model="selectedShelf" :options="shelfList" optionLabel="name_1" optionValue="code" :placeholder="t('inventory.selectShelf')" :aria-label="t('inventory.selectShelf')" :loading="shelfLoading" :disabled="!selectedWh || shelfLoading || detailLoading || adjustSaving" class="w-full">
                    <template #value="{ value }">
                        <span v-if="value !== undefined && value !== null">
                            {{ shelfList.find((s) => s.code === value)?.code || '' }}
                            {{ getMasterDisplayName(shelfList.find((s) => s.code === value)) }}
                        </span>
                    </template>
                    <template #option="{ option }">
                        <span class="loc-code">{{ option.code }}</span>
                        <span class="loc-name">{{ getMasterDisplayName(option) }}</span>
                    </template>
                </Select>
            </div>
        </section>

        <section class="inventory-panel search-panel">
            <div class="search-grid">
                <IconField iconPosition="left">
                    <InputIcon class="pi pi-search" />
                    <InputText v-model="search" :placeholder="t('inventory.productSearchPlaceholder')" :aria-label="t('inventory.productSearchPlaceholder')" :disabled="!canUseSearch" class="w-full" @input="onSearchInput" />
                </IconField>
                <div class="barcode-row">
                    <InputText v-model="barcode" :placeholder="t('inventory.barcode')" :aria-label="t('inventory.barcode')" :disabled="!canUseSearch || searchLoading" class="w-full" @keydown.enter="searchBarcode" />
                    <Button icon="pi pi-qrcode" :label="t('common.search')" :loading="searchLoading" :disabled="!canUseSearch || searchLoading" @click="searchBarcode" />
                </div>
            </div>

            <div v-if="searchLoading" class="skeleton-list">
                <Skeleton v-for="n in 5" :key="n" height="3rem" />
            </div>

            <ul v-else-if="searchResults.length > 0 && !selectedProduct" class="result-list">
                <li v-for="product in searchResults" :key="product.item_code" class="result-item" :class="{ disabled: !canUseSearch }" role="button" :tabindex="canUseSearch ? 0 : -1" :aria-disabled="!canUseSearch" :aria-label="`เลือกสินค้า ${product.item_code} ${getProductDisplayName(product)}`" @click="selectProduct(product)" @keydown.enter.prevent="selectProduct(product)" @keydown.space.prevent="selectProduct(product)">
                    <span class="result-name">{{ getProductDisplayName(product) }}</span>
                    <span class="result-code">{{ product.item_code }}</span>
                </li>
            </ul>

            <div v-else-if="search.trim() && !searchLoading && searchResults.length === 0" class="empty-state">
                <i class="pi pi-search"></i>
                <p>{{ t('inventory.noProductFound') }}</p>
            </div>
        </section>

        <section v-if="selectedProduct" class="inventory-panel detail-panel">
            <div class="detail-head">
                <Button icon="pi pi-arrow-left" text rounded severity="secondary" aria-label="กลับไปค้นหาสินค้า" :disabled="detailLoading || adjustSaving" @click="clearSelection" />
                <div>
                    <h2>{{ selectedProductName }}</h2>
                    <p>{{ selectedProduct.item_code }}</p>
                </div>
            </div>

            <div v-if="detailLoading" class="skeleton-list">
                <Skeleton v-for="n in 3" :key="n" height="3rem" />
            </div>

            <div v-else-if="units.length" class="unit-table-wrap">
                <table class="unit-table">
                    <thead>
                        <tr>
                            <th>{{ t('inventory.unit') }}</th>
                            <th class="num-col">{{ t('inventory.balance') }}</th>
                            <th class="num-col">{{ t('inventory.countedQty') }}</th>
                            <th class="num-col">{{ t('common.status') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="unit in units" :key="unit.unit_code">
                            <td>
                                <strong>{{ unit.unit_code }}</strong>
                                <span v-if="isBaseUnit(unit)" class="base-badge">{{ t('inventory.baseUnit') }}</span>
                            </td>
                            <td class="num-col">{{ formatNumber(rawBalance(unit)) }}</td>
                            <td class="num-col">{{ formatNumber(effectiveBalance(unit)) }}</td>
                            <td class="num-col">
                                <Tag :value="effectiveBalance(unit) <= 0 ? t('common.outOfStock') : t('common.inStock')" :severity="effectiveBalance(unit) <= 0 ? 'danger' : 'success'" />
                            </td>
                            <td class="action-col">
                                <Button :label="t('inventory.adjustStock')" icon="pi pi-pencil" size="small" severity="warning" outlined :disabled="!canOpenAdjust" v-tooltip.top="!canOpenAdjust ? t('inventory.selectLocationFirst') : undefined" @click="openAdjust(unit)" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-else class="empty-state">
                <i class="pi pi-box"></i>
                <p>{{ t('inventory.noUnits') }}</p>
            </div>
        </section>

        <Dialog v-model:visible="showAdjust" :header="t('inventory.adjustStock')" modal :draggable="false" :style="{ width: 'min(440px, 95vw)' }">
            <div v-if="adjustUnit" class="adjust-body">
                <div class="adjust-info">
                    <span>{{ t('common.product') }}</span>
                    <strong>{{ selectedProductName }}</strong>
                </div>
                <div class="adjust-info">
                    <span>{{ t('common.unit') }}</span>
                    <strong>{{ adjustUnit.unit_code }}</strong>
                </div>
                <div class="adjust-info">
                    <span>{{ t('inventory.currentBalance') }}</span>
                    <strong class="balance">{{ formatNumber(adjustCurrentBalance) }}</strong>
                </div>

                <div class="field">
                    <label>{{ t('inventory.actualStockQty') }}</label>
                    <InputNumber v-model="adjustQty" :min="0" :useGrouping="false" :aria-label="t('inventory.actualStockQty')" :disabled="adjustSaving" class="w-full" autofocus />
                </div>

                <div class="adjust-actions">
                    <Button :label="t('common.cancel')" severity="secondary" outlined :disabled="adjustSaving" @click="showAdjust = false" />
                    <Button :label="t('inventory.confirmSave')" icon="pi pi-check" :loading="adjustSaving" :disabled="!canConfirmAdjust" @click="confirmAdjust" />
                </div>
            </div>
        </Dialog>
    </main>
</template>

<style scoped>
.inventory-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 2rem);
    background: linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #3f3118);
}

.inventory-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    max-width: 1120px;
    margin: 0 auto 1rem;
}

.inventory-head > div {
    min-width: 0;
}

.inventory-back-button {
    flex: 0 0 auto;
}

.inventory-head p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.inventory-head h1 {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin: 0.15rem 0;
    color: var(--market-text, #3f3118);
    font-size: clamp(1.5rem, 3vw, 2.2rem);
}

.inventory-head span {
    color: var(--market-muted, #806d47);
}

.inventory-panel {
    max-width: 1120px;
    margin: 0 auto 1rem;
    padding: 1rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.9rem;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(120, 86, 28, 0.08));
}

.location-panel,
.search-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
}

.field {
    display: grid;
    gap: 0.4rem;
}

.field label {
    color: var(--market-text, #5d4c2d);
    font-size: 0.85rem;
    font-weight: 800;
}

.loc-code {
    margin-right: 0.4rem;
    color: var(--market-text, #3f3118);
    font-weight: 800;
}

.loc-name {
    color: var(--market-muted, #7b6844);
}

.barcode-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
}

.skeleton-list {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.85rem;
}

.result-list {
    display: grid;
    gap: 0.45rem;
    margin: 0.85rem 0 0;
    padding: 0;
    list-style: none;
}

.result-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.8rem 1rem;
    border: 1px solid var(--market-card-border, #efe4ca);
    border-radius: 0.7rem;
    cursor: pointer;
    transition: 0.15s ease;
}

.result-item:hover {
    border-color: var(--market-primary, #0f9f6e);
    background: var(--market-primary-soft, #f3fbf7);
}

.result-item.disabled {
    cursor: wait;
    opacity: 0.65;
    pointer-events: none;
}

.result-name {
    min-width: 0;
    color: var(--market-text, #3f3118);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.result-code {
    color: var(--market-muted, #88734d);
    font-size: 0.85rem;
    white-space: nowrap;
}

.detail-head {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin-bottom: 0.8rem;
}

.detail-head h2 {
    margin: 0;
    color: var(--market-text, #3f3118);
    font-size: 1.15rem;
}

.detail-head p {
    margin: 0.15rem 0 0;
    color: var(--market-muted, #88734d);
}

.unit-table-wrap {
    overflow-x: auto;
}

.unit-table {
    width: 100%;
    min-width: 680px;
    border-collapse: collapse;
}

.unit-table th,
.unit-table td {
    padding: 0.75rem 0.85rem;
    border-bottom: 1px solid var(--market-card-border, #f1e7d1);
    text-align: left;
}

.unit-table th {
    color: var(--market-muted, #7b6844);
    background: var(--market-surface-soft, #fffaf0);
    font-size: 0.82rem;
}

.num-col {
    text-align: right !important;
}

.action-col {
    text-align: right !important;
    white-space: nowrap;
}

.base-badge {
    display: inline-flex;
    margin-left: 0.45rem;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    background: var(--market-primary-soft, #e7f8ef);
    color: var(--market-primary, #0f9f6e);
    font-size: 0.72rem;
    font-weight: 800;
}

.empty-state {
    display: grid;
    place-items: center;
    gap: 0.6rem;
    min-height: 9rem;
    color: var(--market-muted, #8a7650);
    text-align: center;
}

.empty-state i {
    font-size: 2rem;
    color: var(--market-primary, #0f9f6e);
}

.empty-state p {
    margin: 0;
}

.adjust-body {
    display: grid;
    gap: 1rem;
}

.adjust-info {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
}

.adjust-info span {
    color: var(--market-muted, #7b6844);
}

.adjust-info strong {
    color: var(--market-text, #3f3118);
    text-align: right;
}

.adjust-info .balance {
    color: var(--market-primary, #0f9f6e);
    font-size: 1.1rem;
}

.adjust-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
}

@media (max-width: 720px) {
    .inventory-head {
        display: grid;
    }

    .inventory-back-button {
        width: 100%;
        justify-content: center;
    }

    .location-panel,
    .search-grid {
        grid-template-columns: 1fr;
    }

    .result-item {
        align-items: flex-start;
        flex-direction: column;
        gap: 0.25rem;
    }

    .result-name {
        white-space: normal;
    }
}
</style>
