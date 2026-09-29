<script setup>
import { createProductItemMain, getProductImageUrl, getProductManageList, getUnitManageList } from '@/services/productManageService'
import InventoryService from '@/services/InventoryService'
import { useLanguageStore } from '@/stores/languageStore'
import { pickMasterName } from '@/utils/languageDisplay'
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const toast  = useToast()
const languageStore = useLanguageStore()
const t = languageStore.t

const searchText = ref('')
const products   = ref([])
const isLoading  = ref(false)
const pageSize   = ref(20)
const pageOffset = ref(0)
const totalCount = ref(0)
const sortField  = ref('')
const sortOrder  = ref(0)
const isMobile   = ref(false)
const units = ref([])
const warehouses = ref([])
const shelves = ref([])
const showCreateDialog = ref(false)
const isCreating = ref(false)
const createForm = ref({
  code: '',
  name_1: '',
  unit_standard: '',
  unit_cost: '',
  wh_code: '',
  shelf_code: '',
  item_category: '',
})

const MOBILE_BREAKPOINT = 768
const PRODUCT_CODE_PATTERN = /^[A-Z0-9_-]+$/
let mobileMediaQuery = null

const PLACEHOLDER_IMG =
  'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22 viewBox=%220 0 48 48%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23e5e7eb%22/%3E%3Cpath d=%22M12 34l8-10 6 7 4-5 6 8z%22 fill=%22%239ca3af%22/%3E%3Ccircle cx=%2218%22 cy=%2218%22 r=%223%22 fill=%22%239ca3af%22/%3E%3C/svg%3E'

function onImgError(e) { e.target.src = PLACEHOLDER_IMG }

function formatQty(v) {
  return (Number(v) || 0).toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const currentPage = computed(() => Math.floor(pageOffset.value / pageSize.value) + 1)
const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize.value)))
const canGoPrev = computed(() => currentPage.value > 1)
const canGoNext = computed(() => currentPage.value < totalPages.value)
const unitOptions = computed(() => units.value.map((u) => ({ value: u.code, label: `${u.code} - ${pickMasterName(u, languageStore.locale) || u.code}` })))
const warehouseOptions = computed(() => warehouses.value.map((w) => ({ value: w.code, label: `${w.code} - ${pickMasterName(w, languageStore.locale) || w.name_1 || w.code}` })))
const shelfOptions = computed(() => {
  const whCode = createForm.value.wh_code
  return shelves.value
    .filter((s) => !whCode || !s.whcode || s.whcode === whCode)
    .map((s) => ({ value: s.code, label: `${s.code} - ${pickMasterName(s, languageStore.locale) || s.name_1 || s.code}${s.whcode ? ` (${s.whcode})` : ''}` }))
})
const createCode = computed(() => String(createForm.value.code || '').trim().toUpperCase())
const canSubmitCreate = computed(() => {
  const code = createCode.value
  return !isCreating.value && Boolean(code) && PRODUCT_CODE_PATTERN.test(code) && Boolean(createForm.value.name_1.trim()) && Boolean(createForm.value.unit_standard)
})

function syncMobileState(eventOrQuery) {
  if (typeof eventOrQuery?.matches === 'boolean') {
    isMobile.value = eventOrQuery.matches
    return
  }
  if (typeof window !== 'undefined') {
    isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT
  }
}

let productLoadSeq = 0
async function loadProducts() {
  const requestId = ++productLoadSeq
  isLoading.value = true
  try {
    const res = await getProductManageList({
      search:     searchText.value.trim(),
      sort_field: sortField.value || '',
      sort_order: sortOrder.value === -1 ? 'desc' : sortOrder.value === 1 ? 'asc' : '',
      offset:     pageOffset.value,
      limit:      pageSize.value,
    })
    if (requestId !== productLoadSeq) return
    products.value   = res.data
    totalCount.value = res.totalCount
  } catch (e) {
    if (requestId !== productLoadSeq) return
    toast.add({ severity: 'error', summary: t('adminProduct.loadFailed'), detail: e.message, life: 3000 })
    products.value   = []
    totalCount.value = 0
  } finally {
    if (requestId === productLoadSeq) isLoading.value = false
  }
}

async function loadUnitOptions() {
  try {
    const res = await getUnitManageList('')
    units.value = res.data || []
  } catch {
    units.value = []
  }
}

function onPage(event) {
  pageOffset.value = event.first
  pageSize.value   = event.rows
  loadProducts()
}

function onSort(event) {
  sortField.value  = event.sortField || ''
  sortOrder.value  = event.sortOrder || 0
  pageOffset.value = 0
  loadProducts()
}

function onSearch() {
  pageOffset.value = 0
  loadProducts()
}

async function loadWarehouseShelfOptions() {
  try {
    const [warehouseRows, shelfRows] = await Promise.all([InventoryService.getWarehouseList(), InventoryService.getShelfList('')])
    warehouses.value = warehouseRows || []
    shelves.value = shelfRows || []
  } catch (e) {
    warehouses.value = []
    shelves.value = []
    toast.add({ severity: 'warn', summary: 'โหลดคลัง/ที่เก็บไม่สำเร็จ', detail: e.message, life: 3000 })
  }
}

function openCreateDialog() {
  if (isCreating.value) return
  createForm.value = {
    code: '',
    name_1: '',
    unit_standard: '',
    unit_cost: '',
    wh_code: '',
    shelf_code: '',
    item_category: '',
  }
  showCreateDialog.value = true
}

function onCreateWarehouseChange() {
  createForm.value.shelf_code = ''
}

function setCreateDialogVisible(value) {
  if (isCreating.value && !value) return
  showCreateDialog.value = value
}

function normalizeProductCodeInput(value) {
  createForm.value.code = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
}

async function createProduct() {
  if (isCreating.value) return

  const code = createForm.value.code.trim().toUpperCase()
  const name = createForm.value.name_1.trim()
  const unit = createForm.value.unit_standard

  if (!code) {
    toast.add({ severity: 'warn', summary: t('adminProduct.requireCode'), life: 2500 })
    return
  }
  if (!PRODUCT_CODE_PATTERN.test(code)) {
    toast.add({ severity: 'warn', summary: t('adminProduct.invalidCode'), detail: t('adminProduct.invalidCodeDetail'), life: 3000 })
    return
  }
  if (!name) {
    toast.add({ severity: 'warn', summary: t('adminProduct.requireName'), life: 2500 })
    return
  }
  if (!unit) {
    toast.add({ severity: 'warn', summary: t('adminProduct.requireUnit'), life: 2500 })
    return
  }
  if ((createForm.value.wh_code && !createForm.value.shelf_code) || (!createForm.value.wh_code && createForm.value.shelf_code)) {
    toast.add({ severity: 'warn', summary: 'กรุณาเลือกคลังและที่เก็บให้ครบ', life: 2500 })
    return
  }
  const warehouseShelves = createForm.value.wh_code && createForm.value.shelf_code
    ? [
        {
          wh_code: createForm.value.wh_code,
          shelf_code: createForm.value.shelf_code,
          status: 1,
        },
      ]
    : []

  isCreating.value = true
  try {
    const res = await createProductItemMain({
      ...createForm.value,
      code,
      name_1: name,
      unit_standard: unit,
      unit_cost: createForm.value.unit_cost || unit,
      start_sale_wh: createForm.value.wh_code,
      start_sale_shelf: createForm.value.shelf_code,
      warehouse_shelves: warehouseShelves,
    })
    if (res.success) {
      toast.add({ severity: 'success', summary: t('adminProduct.created'), life: 2000 })
      showCreateDialog.value = false
      await loadProducts()
      router.push({ name: 'admin-product-edit', params: { code } })
    } else {
      toast.add({ severity: 'error', summary: t('adminProduct.createFailed'), detail: res.message || '', life: 3000 })
    }
  } catch (e) {
    toast.add({ severity: 'error', summary: t('adminProduct.createFailed'), detail: e.message, life: 3000 })
  } finally {
    isCreating.value = false
  }
}

function goToPage(page) {
  const safePage = Math.min(Math.max(page, 1), totalPages.value)
  if (isLoading.value || safePage === currentPage.value) return
  pageOffset.value = (safePage - 1) * pageSize.value
  loadProducts()
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    syncMobileState(mobileMediaQuery)
    if (typeof mobileMediaQuery.addEventListener === 'function') {
      mobileMediaQuery.addEventListener('change', syncMobileState)
    } else {
      mobileMediaQuery.addListener(syncMobileState)
    }
  }

  loadUnitOptions()
  loadWarehouseShelfOptions()
  loadProducts()
})

onBeforeUnmount(() => {
  if (!mobileMediaQuery) return
  if (typeof mobileMediaQuery.removeEventListener === 'function') {
    mobileMediaQuery.removeEventListener('change', syncMobileState)
  } else {
    mobileMediaQuery.removeListener(syncMobileState)
  }
})
</script>

<template>
  <div class="manage-page">
    <div class="page-header">
      <div class="page-title-wrap">
        <i class="pi pi-tag header-icon" />
        <h1 class="page-title">{{ t('adminProduct.title') }}</h1>
      </div>
      <div class="page-header-actions">
        <Button :label="t('common.mainMenu')" icon="pi pi-arrow-left" outlined :disabled="isCreating" @click="router.push('/admin')" />
        <Button :label="t('adminProduct.addProduct')" icon="pi pi-plus" :disabled="isCreating" @click="openCreateDialog" />
      </div>
    </div>

    <div class="search-row">
      <InputText v-model="searchText" :placeholder="t('adminProduct.searchPlaceholder')" :aria-label="t('adminProduct.searchPlaceholder')" class="search-input" :disabled="isLoading" @keyup.enter="onSearch" />
      <Button icon="pi pi-search" :aria-label="t('common.search')" :loading="isLoading" :disabled="isLoading" @click="onSearch" />
    </div>

    <DataTable
      v-if="!isMobile"
      :value="products"
      :loading="isLoading"
      :lazy="true"
      :paginator="true"
      :rows="pageSize"
      :first="pageOffset"
      :totalRecords="totalCount"
      :rowsPerPageOptions="[20, 50, 100]"
      :sortField="sortField"
      :sortOrder="sortOrder"
      stripedRows
      scrollable
      class="product-table"
      @page="onPage"
      @sort="onSort"
    >
      <Column :header="t('adminProduct.image')" style="width: 68px; min-width: 68px">
        <template #body="{ data }">
          <img :src="getProductImageUrl(data.code)" @error="onImgError" class="product-thumb" loading="lazy" alt="" />
        </template>
      </Column>
      <Column field="code" :header="t('adminProduct.code')" style="min-width: 120px" sortable />
      <Column field="name_1" :header="t('adminProduct.productName')" style="min-width: 220px" sortable />
      <Column field="name_eng_1" :header="t('adminProduct.productNameEn')" style="min-width: 180px" />
      <Column field="unit_standard" :header="t('adminProduct.unit')" style="min-width: 70px" />
      <Column field="balance_qty" :header="t('adminProduct.balance')" style="min-width: 100px" bodyClass="col-num" headerClass="col-num" sortable>
        <template #body="{ data }">{{ formatQty(data.balance_qty) }}</template>
      </Column>
      <Column field="book_out_qty" :header="t('adminProduct.booked')" style="min-width: 100px" bodyClass="col-num" headerClass="col-num" sortable>
        <template #body="{ data }">{{ formatQty(data.book_out_qty) }}</template>
      </Column>
      <Column field="accrued_out_qty" :header="t('adminProduct.pendingDelivery')" style="min-width: 100px" bodyClass="col-num" headerClass="col-num" sortable>
        <template #body="{ data }">{{ formatQty(data.accrued_out_qty) }}</template>
      </Column>
      <Column field="accrued_in_qty" :header="t('adminProduct.pendingReceive')" style="min-width: 100px" bodyClass="col-num" headerClass="col-num" sortable>
        <template #body="{ data }">{{ formatQty(data.accrued_in_qty) }}</template>
      </Column>
      <Column style="width: 52px; min-width: 52px">
        <template #body="{ data }">
          <Button icon="pi pi-pencil" text rounded size="small" :aria-label="`แก้ไขสินค้า ${data.code}`" :disabled="isLoading" @click="router.push({ name: 'admin-product-edit', params: { code: data.code } })" />
        </template>
      </Column>
      <template #empty>
        <div class="table-empty">{{ t('adminProduct.empty') }}</div>
      </template>
    </DataTable>

    <div v-else-if="isLoading" class="mobile-loading">
      <i class="pi pi-spinner pi-spin" />
    </div>

    <div v-else-if="products.length" class="mobile-list">
      <div v-for="product in products" :key="product.code" class="product-card">
        <div class="product-card-main">
          <img :src="getProductImageUrl(product.code)" @error="onImgError" class="product-thumb product-thumb-mobile" loading="lazy" alt="" />
          <div class="product-card-body">
            <div class="product-card-top">
              <div class="product-card-meta">
                <p class="product-code">{{ product.code }}</p>
                <h2 class="product-name">{{ product.name_1 || '-' }}</h2>
                <p v-if="product.name_eng_1" class="product-name-en">{{ product.name_eng_1 }}</p>
              </div>
              <Button icon="pi pi-pencil" text rounded size="small" :aria-label="`แก้ไขสินค้า ${product.code}`" :disabled="isLoading" @click="router.push({ name: 'admin-product-edit', params: { code: product.code } })" />
            </div>

            <div class="product-badges">
              <span class="product-badge">{{ t('adminProduct.unitBadge', { unit: product.unit_standard || '-' }) }}</span>
            </div>

            <div class="product-stats">
              <div class="product-stat">
                <span>{{ t('adminProduct.balance') }}</span>
                <strong>{{ formatQty(product.balance_qty) }}</strong>
              </div>
              <div class="product-stat">
                <span>{{ t('adminProduct.booked') }}</span>
                <strong>{{ formatQty(product.book_out_qty) }}</strong>
              </div>
              <div class="product-stat">
                <span>{{ t('adminProduct.pendingDelivery') }}</span>
                <strong>{{ formatQty(product.accrued_out_qty) }}</strong>
              </div>
              <div class="product-stat">
                <span>{{ t('adminProduct.pendingReceive') }}</span>
                <strong>{{ formatQty(product.accrued_in_qty) }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mobile-pager">
        <span class="mobile-pager-summary">{{ t('adminProduct.totalItems', { count: totalCount }) }}</span>
        <div class="mobile-pager-controls">
          <Button icon="pi pi-angle-left" text rounded :aria-label="t('cartPage.previousPage')" :disabled="!canGoPrev || isLoading" @click="goToPage(currentPage - 1)" />
          <span>{{ currentPage }} / {{ totalPages }}</span>
          <Button icon="pi pi-angle-right" text rounded :aria-label="t('cartPage.nextPage')" :disabled="!canGoNext || isLoading" @click="goToPage(currentPage + 1)" />
        </div>
      </div>
    </div>

    <div v-else class="table-empty">{{ t('adminProduct.empty') }}</div>

    <Dialog
      :visible="showCreateDialog"
      @update:visible="setCreateDialogVisible"
      :header="t('adminProduct.createTitle')"
      :modal="true"
      :draggable="false"
      :closable="!isCreating"
      style="width: min(520px, 95vw)"
    >
      <div class="create-form">
        <div class="create-field">
          <label>{{ t('adminProduct.productCode') }} <span class="required">*</span></label>
          <InputText
            :modelValue="createForm.code"
            class="w-full"
            :placeholder="t('adminProduct.codePlaceholder')"
            :aria-label="t('adminProduct.productCode')"
            :disabled="isCreating"
            @update:modelValue="normalizeProductCodeInput"
          />
          <small class="code-help">{{ t('adminProduct.codeHelp') }}</small>
        </div>
        <div class="create-field">
          <label>{{ t('adminProduct.productName') }} <span class="required">*</span></label>
          <InputText v-model="createForm.name_1" class="w-full" :placeholder="t('adminProduct.productNamePlaceholder')" :aria-label="t('adminProduct.productName')" :disabled="isCreating" />
        </div>
        <div class="create-grid-2">
          <div class="create-field">
            <label>{{ t('adminProduct.standardUnit') }} <span class="required">*</span></label>
            <Select
              v-model="createForm.unit_standard"
              :options="unitOptions"
              optionLabel="label"
              optionValue="value"
              class="w-full"
              :placeholder="t('adminProduct.selectUnit')"
              :aria-label="t('adminProduct.standardUnit')"
              :disabled="isCreating"
              filter
            />
          </div>
          <div class="create-field">
            <label>{{ t('adminProduct.costUnit') }}</label>
            <Select
              v-model="createForm.unit_cost"
              :options="unitOptions"
              optionLabel="label"
              optionValue="value"
              class="w-full"
              :placeholder="t('adminProduct.costUnitPlaceholder')"
              :aria-label="t('adminProduct.costUnit')"
              :disabled="isCreating"
              filter
              showClear
            />
          </div>
        </div>
        <div class="create-grid-2">
          <div class="create-field">
            <label>คลัง</label>
            <Select
              v-model="createForm.wh_code"
              :options="warehouseOptions"
              optionLabel="label"
              optionValue="value"
              class="w-full"
              placeholder="เลือกคลัง"
              aria-label="Warehouse"
              :disabled="isCreating"
              filter
              @change="onCreateWarehouseChange"
            />
          </div>
          <div class="create-field">
            <label>ที่เก็บ</label>
            <Select
              v-model="createForm.shelf_code"
              :options="shelfOptions"
              optionLabel="label"
              optionValue="value"
              class="w-full"
              placeholder="เลือกที่เก็บ"
              aria-label="Shelf"
              :disabled="isCreating || !createForm.wh_code"
              filter
            />
          </div>
        </div>
      </div>

      <template #footer>
        <Button :label="t('common.cancel')" severity="secondary" outlined :disabled="isCreating" @click="setCreateDialogVisible(false)" />
        <Button :label="t('adminProduct.saveAndContinue')" icon="pi pi-save" :loading="isCreating" :disabled="!canSubmitCreate" @click="createProduct" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.manage-page {
  display: flex;
  flex-direction: column;
  margin-top: 15px;
  gap: 1rem;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.625rem;
}

.page-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.page-title-wrap {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.header-icon {
  font-size: 1.375rem;
  color: var(--p-primary-color);
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
}

/* Search */
.search-row {
  display: flex;
  gap: 0.5rem;
}

.search-input {
  flex: 1;
  max-width: 400px;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding-top: 0.25rem;
}

.create-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.create-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.create-field label {
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
}

.code-help {
  font-size: 0.74rem;
  color: var(--p-text-color-secondary);
}

.required {
  color: var(--p-red-500);
}

/* Table */
.product-thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--p-surface-200);
  display: block;
}

.table-empty {
  text-align: center;
  padding: 2.5rem 0;
  color: var(--p-text-color-secondary);
}

.mobile-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  font-size: 1.5rem;
  color: var(--p-text-color-secondary);
}

.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.product-card {
  border: 1px solid var(--p-surface-200);
  border-radius: 14px;
  background: var(--p-surface-0);
  padding: 0.875rem;
}

.product-card-main {
  display: flex;
  gap: 0.875rem;
}

.product-thumb-mobile {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  flex-shrink: 0;
}

.product-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.product-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.product-card-meta {
  min-width: 0;
}

.product-code {
  margin: 0;
  font-size: 0.76rem;
  color: var(--p-text-color-secondary);
}

.product-name {
  margin: 0.18rem 0 0;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.3;
  word-break: break-word;
}

.product-name-en {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
  word-break: break-word;
}

.product-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.product-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  background: var(--p-surface-100);
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
}

.product-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.625rem;
}

.product-stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.625rem 0.7rem;
  border-radius: 10px;
  background: var(--p-surface-50);
}

.product-stat span {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
}

.product-stat strong {
  font-size: 0.92rem;
}

.mobile-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.25rem 0;
  color: var(--p-text-color-secondary);
}

.mobile-pager-summary {
  font-size: 0.82rem;
}

.mobile-pager-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

@media (max-width: 768px) {
  .manage-page {
    gap: 0.875rem;
  }

  .page-title {
    font-size: 1.25rem;
  }

  .search-row {
    flex-direction: column;
  }

  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .page-header-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .page-header-actions :deep(.p-button) {
    width: 100%;
    justify-content: center;
  }

  .search-row :deep(.p-button) {
    width: 100%;
    justify-content: center;
  }

  .search-input {
    max-width: none;
  }

  .product-card-main {
    flex-direction: column;
  }

  .product-thumb-mobile {
    width: 100%;
    height: 180px;
  }

  .product-card-top,
  .mobile-pager {
    flex-direction: column;
    align-items: stretch;
  }

  .product-card-top :deep(.p-button) {
    align-self: flex-end;
  }

  .product-stats {
    grid-template-columns: 1fr;
  }

  .create-grid-2 {
    grid-template-columns: 1fr;
  }

  .mobile-pager-controls {
    justify-content: space-between;
  }
}
</style>
