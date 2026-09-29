<script setup>
import CustomerService from '@/services/CustomerService';
import EmployeeService from '@/services/EmployeeService';
import { getCustomerGroupList, getCustomerGroupSubList } from '@/services/productManageService';
import { useLanguageStore } from '@/stores/languageStore';
import { pickMasterName } from '@/utils/languageDisplay';
import { computed, onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';

const confirm = useConfirm();
const router = useRouter();
const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;

const loading = ref(false);
const saving = ref(false);
const generating = ref(false);
const deleting = ref(false);
const customers = ref([]);
const searchText = ref('');
const page = ref(1);
const pageSize = 30;
const pagination = ref({ total: 0, total_page: 1 });
const editing = ref(createEmptyCustomer());
const customerGroups = ref([]);
const customerGroupSubs = ref([]);
const employeeOptions = ref([]);
const isSearchingEmployee = ref(false);
const dimensionOptions = ref([]);
const isSearchingDimension = ref(false);
const logisticAreaOptions = ref([]);
const isSearchingLogisticArea = ref(false);

const pageLabel = computed(() => `${page.value} / ${Math.max(1, pagination.value.total_page || 1)}`);
const isLastPage = computed(() => page.value >= Math.max(1, pagination.value.total_page || 1));
const isCustomerActionBusy = computed(() => loading.value || saving.value || generating.value || deleting.value);
const isCustomerFormDisabled = computed(() => saving.value || deleting.value);
const canSaveCustomer = computed(() => {
    if (isCustomerFormDisabled.value) return false;
    if (!String(editing.value.code || '').trim()) return false;
    if (!String(editing.value.name_1 || '').trim()) return false;
    if (editing.value.isNew && !String(editing.value.password || '').trim()) return false;
    return true;
});
const customerGroupOptions = computed(() => mapMasterOptions(customerGroups.value));
const customerGroupSubOptions = computed(() => mapMasterOptions(customerGroupSubs.value));
const priceLevelOptions = [
    { value: 0, label: '0 - ราคากลาง' },
    { value: 1, label: '1 - ราคา 1' },
    { value: 2, label: '2 - ราคา 2' },
    { value: 3, label: '3 - ราคา 3' },
    { value: 4, label: '4 - ราคา 4' },
    { value: 5, label: '5 - ราคา 5' },
    { value: 6, label: '6 - ราคา 6' },
    { value: 7, label: '7 - ราคา 7' },
    { value: 8, label: '8 - ราคา 8' },
    { value: 9, label: '9 - ราคา 9' }
];

function createEmptyCustomer() {
    return {
        code: '',
        name_1: '',
        address: '',
        telephone: '',
        email: '',
        website: '',
        price_level: 0,
        tax_id: '',
        group_main: '',
        group_sub_1: '',
        group_sub_3: '',
        group_sub_4: '',
        logistic_area: '',
        logistic_area_name: '',
        sale_code: '',
        sale_name: '',
        dimension_1: '',
        dimension_1_name: '',
        credit_money: 0,
        credit_money_max: 0,
        credit_day: 0,
        password: '',
        isNew: true
    };
}

function normalizeForm(customer = {}) {
    return {
        code: customer.code || customer.user_code || '',
        name_1: customer.name_1 || customer.name || customer.user_name || '',
        address: customer.address || '',
        telephone: customer.telephone || '',
        email: customer.email || '',
        website: customer.website || customer.gps || '',
        price_level: Number(customer.price_level) || 0,
        tax_id: customer.tax_id || '',
        group_main: customer.group_main || '',
        group_sub_1: customer.group_sub_1 || '',
        group_sub_3: customer.group_sub_3 || '',
        group_sub_4: customer.group_sub_4 || '',
        logistic_area: customer.logistic_area || '',
        logistic_area_name: customer.logistic_area_name || '',
        sale_code: customer.sale_code || '',
        sale_name: customer.sale_name || '',
        dimension_1: customer.dimension_1 || '',
        dimension_1_name: customer.dimension_1_name || '',
        credit_money: Number(customer.credit_money) || 0,
        credit_money_max: Number(customer.credit_money_max) || 0,
        credit_day: Number(customer.credit_day) || 0,
        password: customer.password || '',
        isNew: false
    };
}

function mapMasterOptions(list = []) {
    return list.map((item) => ({
        value: item.code || '',
        label: `${item.code || ''}${pickMasterName(item, languageStore.locale) ? ` - ${pickMasterName(item, languageStore.locale)}` : ''}`
    }));
}

function mapEmployeeOptions(list = []) {
    return list
        .map((item) => ({
            code: item.code || '',
            name: item.name || item.name_1 || '',
            label: `${item.code || ''}${item.name || item.name_1 ? ` - ${item.name || item.name_1}` : ''}`
        }))
        .filter((item) => item.code);
}

function mergeEmployeeOptions(list = []) {
    const map = new Map(employeeOptions.value.map((item) => [String(item.code).toUpperCase(), item]));
    mapEmployeeOptions(list).forEach((item) => map.set(String(item.code).toUpperCase(), item));
    employeeOptions.value = Array.from(map.values());
}

function mapDimensionOptions(list = []) {
    return list
        .map((item) => ({
            value: item.code || '',
            label: `${item.code || ''}${item.name_1 ? ` - ${item.name_1}` : ''}`,
            name_1: item.name_1 || ''
        }))
        .filter((item) => item.value);
}

function mergeDimensionOptions(list = []) {
    const map = new Map(dimensionOptions.value.map((item) => [String(item.value).toUpperCase(), item]));
    mapDimensionOptions(list).forEach((item) => map.set(String(item.value).toUpperCase(), item));
    dimensionOptions.value = Array.from(map.values());
}

function mapLogisticAreaOptions(list = []) {
    return list
        .map((item) => ({
            value: item.code || '',
            label: `${item.code || ''}${item.name_1 ? ` - ${item.name_1}` : ''}`,
            name_1: item.name_1 || ''
        }))
        .filter((item) => item.value);
}

function mergeLogisticAreaOptions(list = []) {
    const map = new Map(logisticAreaOptions.value.map((item) => [String(item.value).toUpperCase(), item]));
    mapLogisticAreaOptions(list).forEach((item) => map.set(String(item.value).toUpperCase(), item));
    logisticAreaOptions.value = Array.from(map.values());
}

let customerLoadSeq = 0;

async function loadMasterOptions() {
    try {
        const [groupRes, groupSubRes] = await Promise.all([getCustomerGroupList(''), getCustomerGroupSubList('')]);
        customerGroups.value = groupRes.data || [];
        customerGroupSubs.value = groupSubRes.data || [];
    } catch (error) {
        toast.add({ severity: 'warn', summary: t('adminCustomer.loadGroupsFailed'), detail: error.message, life: 3000 });
    }
}

async function loadDimensionOptions(search = '') {
    isSearchingDimension.value = true;
    try {
        const data = await CustomerService.getDimensions(search);
        mergeDimensionOptions(data || []);
    } catch (error) {
        toast.add({ severity: 'warn', summary: 'โหลดมิติไม่สำเร็จ', detail: error.message, life: 2600 });
    } finally {
        isSearchingDimension.value = false;
    }
}

async function loadLogisticAreaOptions(search = '') {
    isSearchingLogisticArea.value = true;
    try {
        const data = await CustomerService.getLogisticAreas(search);
        mergeLogisticAreaOptions(data || []);
    } catch (error) {
        toast.add({ severity: 'warn', summary: 'โหลดเขตขนส่งไม่สำเร็จ', detail: error.message, life: 2600 });
    } finally {
        isSearchingLogisticArea.value = false;
    }
}

async function loadEmployeeOptions(search = '') {
    isSearchingEmployee.value = true;
    try {
        const data = await EmployeeService.getEmployees(search, search ? 100 : 50);
        mergeEmployeeOptions(data || []);
    } catch (error) {
        toast.add({ severity: 'warn', summary: 'โหลดรายชื่อพนักงานขายไม่สำเร็จ', detail: error.message, life: 2600 });
    } finally {
        isSearchingEmployee.value = false;
    }
}

async function filterEmployees(event) {
    const value = String(event?.value || '').trim();
    await loadEmployeeOptions(value.length >= 2 ? value : '');
}

async function filterDimensions(event) {
    const value = String(event?.value || '').trim();
    await loadDimensionOptions(value.length >= 2 ? value : '');
}

async function filterLogisticAreas(event) {
    const value = String(event?.value || '').trim();
    await loadLogisticAreaOptions(value.length >= 2 ? value : '');
}

function ensureEmployeeOption(code, name = '') {
    if (!code) return;
    mergeEmployeeOptions([{ code, name }]);
}

function ensureDimensionOption(code, name = '') {
    if (!code) return;
    mergeDimensionOptions([{ code, name_1: name }]);
}

function ensureLogisticAreaOption(code, name = '') {
    if (!code) return;
    mergeLogisticAreaOptions([{ code, name_1: name }]);
}

async function loadCustomers(resetPage = false) {
    if (loading.value) return;
    if (resetPage) page.value = 1;
    const requestPage = page.value;
    const requestSearch = searchText.value.trim();
    const requestId = ++customerLoadSeq;
    loading.value = true;
    try {
        const result = await CustomerService.getCustomerManageList({
            search: requestSearch,
            limit: pageSize,
            offset: (requestPage - 1) * pageSize
        });
        if (requestId !== customerLoadSeq) return;
        customers.value = result.data || [];
        pagination.value = result.pagination || { total: customers.value.length, total_page: 1 };
    } catch (error) {
        if (requestId !== customerLoadSeq) return;
        toast.add({ severity: 'error', summary: t('adminCustomer.loadFailed'), detail: error.response?.data?.ERROR || error.message, life: 3000 });
    } finally {
        if (requestId === customerLoadSeq) loading.value = false;
    }
}

function newCustomer(force = false) {
    if (!force && isCustomerActionBusy.value) return;
    editing.value = createEmptyCustomer();
}

function editCustomer(customer) {
    if (isCustomerActionBusy.value) return;
    editing.value = normalizeForm(customer);
    ensureEmployeeOption(editing.value.sale_code, editing.value.sale_name);
    ensureDimensionOption(editing.value.dimension_1, editing.value.dimension_1_name);
    ensureLogisticAreaOption(editing.value.logistic_area, editing.value.logistic_area_name);
}

async function generateCustomerCode() {
    if (!editing.value.isNew || isCustomerActionBusy.value) return;
    generating.value = true;
    try {
        editing.value.code = await CustomerService.getNextCustomerCode();
        toast.add({ severity: 'success', summary: t('adminCustomer.codeGenerated'), detail: editing.value.code, life: 1800 });
    } catch (error) {
        toast.add({ severity: 'error', summary: t('adminCustomer.codeGenerateFailed'), detail: error.response?.data?.ERROR || error.message, life: 3000 });
    } finally {
        generating.value = false;
    }
}

function validateCustomer() {
    if (!editing.value.code.trim()) return t('adminCustomer.requireCode');
    if (!editing.value.name_1.trim()) return t('adminCustomer.requireName');
    if (editing.value.isNew && !editing.value.password.trim()) return t('adminCustomer.requirePassword');
    return '';
}

async function saveCustomer() {
    if (isCustomerActionBusy.value) return;

    const error = validateCustomer();
    if (error) {
        toast.add({ severity: 'warn', summary: error, life: 2400 });
        return;
    }

    saving.value = true;
    try {
        if (editing.value.isNew) {
            await CustomerService.createCustomer(editing.value);
            toast.add({ severity: 'success', summary: t('adminCustomer.created'), detail: editing.value.code, life: 2600 });
        } else {
            await CustomerService.updateCustomer(editing.value);
            toast.add({ severity: 'success', summary: t('adminCustomer.updated'), detail: editing.value.code, life: 2600 });
        }
        await loadCustomers();
        if (editing.value.isNew) newCustomer(true);
    } catch (error) {
        toast.add({ severity: 'error', summary: t('adminCustomer.saveFailed'), detail: error.response?.data?.message || error.response?.data?.ERROR || error.message, life: 3200 });
    } finally {
        saving.value = false;
    }
}

function confirmDeleteCustomer(customer) {
    if (isCustomerActionBusy.value || !customer?.code) return;

    confirm.require({
        header: t('adminCustomer.deleteHeader'),
        message: t('adminCustomer.deleteMessage', { name: customer.name || customer.name_1 || customer.code }),
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: t('adminCustomer.deleteAccept'),
        rejectLabel: t('common.cancel'),
        acceptClass: 'p-button-danger',
        accept: async () => deleteCustomer(customer)
    });
}

async function deleteCustomer(customer) {
    if (deleting.value) return;

    deleting.value = true;
    try {
        await CustomerService.deleteCustomer(customer.code);
        toast.add({ severity: 'success', summary: t('adminCustomer.deleted'), life: 1800 });
        if (editing.value.code === customer.code) newCustomer(true);
        await loadCustomers();
    } catch (error) {
        const data = error.response?.data || {};
        const detail = data.used_count ? t('adminCustomer.deleteBlockedDetail', { count: data.used_count }) : data.message || data.ERROR || error.message;
        toast.add({ severity: 'warn', summary: t('adminCustomer.deleteBlocked'), detail, life: 3600 });
    } finally {
        deleting.value = false;
    }
}

function nextPage() {
    if (isLastPage.value || isCustomerActionBusy.value) return;
    page.value += 1;
    loadCustomers();
}

function prevPage() {
    if (page.value <= 1 || isCustomerActionBusy.value) return;
    page.value -= 1;
    loadCustomers();
}

onMounted(async () => {
    await Promise.all([loadMasterOptions(), loadEmployeeOptions(), loadDimensionOptions(), loadLogisticAreaOptions(), loadCustomers()]);
});
</script>

<template>
    <main class="admin-customers-page">
        <Toast position="top-right" />

        <header class="admin-customers-head">
            <div>
                <p>{{ t('adminCustomer.eyebrow') }}</p>
                <h1>{{ t('adminCustomer.title') }}</h1>
                <span>{{ t('adminCustomer.subtitle') }}</span>
            </div>
            <div class="admin-customers-actions">
                <Button :label="t('common.mainMenu')" icon="pi pi-arrow-left" outlined :disabled="saving || deleting" @click="router.push('/admin')" />
                <Button :label="t('common.reload')" icon="pi pi-refresh" text :disabled="isCustomerActionBusy" @click="loadCustomers()" />
                <Button :label="t('adminCustomer.addCustomer')" icon="pi pi-plus" :disabled="isCustomerActionBusy" @click="newCustomer" />
            </div>
        </header>

        <div class="customers-layout">
            <section class="customers-panel">
                <div class="panel-title-row">
                    <h2>{{ t('adminCustomer.listTitle') }}</h2>
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText v-model="searchText" :placeholder="t('adminCustomer.searchPlaceholder')" :aria-label="t('adminCustomer.searchPlaceholder')" :disabled="isCustomerActionBusy" @keyup.enter="loadCustomers(true)" />
                    </IconField>
                </div>

                <div class="list-tools">
                    <Button :label="t('common.search')" icon="pi pi-search" size="small" :disabled="isCustomerActionBusy" @click="loadCustomers(true)" />
                    <Button :label="t('common.clear')" icon="pi pi-times" size="small" text :disabled="isCustomerActionBusy" @click="searchText = ''; loadCustomers(true)" />
                    <span>{{ t('adminCustomer.totalItems', { count: pagination.total || 0 }) }}</span>
                </div>

                <div v-if="loading" class="loading-box">
                    <ProgressSpinner />
                    <span>{{ t('adminCustomer.loading') }}</span>
                </div>

                <div v-else class="customers-table">
                    <button v-for="customer in customers" :key="customer.code" type="button" class="customer-row" :class="{ active: editing.code === customer.code }" :disabled="isCustomerActionBusy" :aria-pressed="editing.code === customer.code" :aria-label="`เลือกลูกค้า ${customer.code} ${customer.name || ''}`" @click="editCustomer(customer)">
                        <div class="customer-avatar">
                            <i class="pi pi-user"></i>
                        </div>
                        <div class="customer-main">
                            <strong>{{ customer.name }}</strong>
                            <span>{{ customer.code }}</span>
                            <small>{{ customer.telephone || customer.email || '-' }}</small>
                        </div>
                    </button>

                    <div v-if="customers.length === 0" class="empty-state">
                        <i class="pi pi-users"></i>
                        <span>{{ t('adminCustomer.empty') }}</span>
                    </div>
                </div>

                <div class="pager-row">
                    <Button icon="pi pi-angle-left" text rounded :aria-label="t('cartPage.previousPage')" :disabled="page <= 1 || isCustomerActionBusy" @click="prevPage" />
                    <span>{{ pageLabel }}</span>
                    <Button icon="pi pi-angle-right" text rounded :aria-label="t('cartPage.nextPage')" :disabled="isLastPage || isCustomerActionBusy" @click="nextPage" />
                </div>
            </section>

            <section class="customer-editor-panel">
                <div class="panel-title-row">
                    <h2>{{ editing.isNew ? t('adminCustomer.addTitle') : t('adminCustomer.editTitle') }}</h2>
                    <Button v-if="!editing.isNew" icon="pi pi-trash" :label="t('adminCustomer.delete')" severity="danger" outlined :loading="deleting" :disabled="isCustomerActionBusy" @click="confirmDeleteCustomer(editing)" />
                </div>

                <div class="customer-form-grid">
                    <label class="span-2">
                        {{ t('adminCustomer.customerCode') }}
                        <div class="code-input-row">
                            <InputText v-model.trim="editing.code" :disabled="!editing.isNew || isCustomerFormDisabled" placeholder="OR-00001" />
                            <Button v-if="editing.isNew" label="Gen" icon="pi pi-bolt" outlined :loading="generating" :disabled="isCustomerActionBusy" @click="generateCustomerCode" />
                        </div>
                    </label>

                    <label class="span-2">
                        {{ t('adminCustomer.customerName') }}
                        <InputText v-model="editing.name_1" :placeholder="t('adminCustomer.customerNamePlaceholder')" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        {{ t('adminCustomer.phone') }}
                        <InputText v-model="editing.telephone" :placeholder="t('adminCustomer.phonePlaceholder')" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        Email
                        <InputText v-model="editing.email" placeholder="customer@example.com" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        GPS / Website
                        <InputText v-model="editing.website" :placeholder="t('adminCustomer.gpsWebsitePlaceholder')" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        Price Level
                        <Select v-model="editing.price_level" :options="priceLevelOptions" optionLabel="label" optionValue="value" placeholder="เลือก Price Level" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        วงเงินเครดิต
                        <InputNumber v-model="editing.credit_money" :minFractionDigits="2" :maxFractionDigits="2" mode="decimal" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        วงเงินเครดิตสูงสุด
                        <InputNumber v-model="editing.credit_money_max" :minFractionDigits="2" :maxFractionDigits="2" mode="decimal" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        {{ t('adminCustomer.taxId') }}
                        <InputText v-model="editing.tax_id" placeholder="Tax ID" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        {{ t('adminCustomer.password') }}
                        <InputText v-model="editing.password" :placeholder="t('adminCustomer.passwordPlaceholder')" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        {{ t('adminCustomer.mainGroup') }}
                        <Select v-model="editing.group_main" :options="customerGroupOptions" optionLabel="label" optionValue="value" :placeholder="t('adminCustomer.selectMainGroup')" :disabled="isCustomerFormDisabled" filter showClear />
                    </label>

                    <label>
                        {{ t('adminCustomer.subGroup1') }}
                        <Select v-model="editing.group_sub_1" :options="customerGroupSubOptions" optionLabel="label" optionValue="value" :placeholder="t('adminCustomer.selectSubGroup1')" :disabled="isCustomerFormDisabled" filter showClear />
                    </label>

                    <label>
                        {{ t('adminCustomer.subGroup3') }}
                        <Select v-model="editing.group_sub_3" :options="customerGroupSubOptions" optionLabel="label" optionValue="value" :placeholder="t('adminCustomer.selectSubGroup3')" :disabled="isCustomerFormDisabled" filter showClear />
                    </label>

                    <label>
                        {{ t('adminCustomer.subGroup4') }}
                        <Select v-model="editing.group_sub_4" :options="customerGroupSubOptions" optionLabel="label" optionValue="value" :placeholder="t('adminCustomer.selectSubGroup4')" :disabled="isCustomerFormDisabled" filter showClear />
                    </label>

                    <label>
                        {{ t('adminCustomer.logisticArea') }}
                        <Select
                            v-model="editing.logistic_area"
                            :options="logisticAreaOptions"
                            optionLabel="label"
                            optionValue="value"
                            placeholder="เลือกเขตขนส่ง"
                            filter
                            showClear
                            :loading="isSearchingLogisticArea"
                            :disabled="isCustomerFormDisabled"
                            :filterFields="['value', 'name_1', 'label']"
                            filterPlaceholder="ค้นหารหัสหรือชื่อเขตขนส่ง"
                            @filter="filterLogisticAreas"
                        >
                            <template #option="{ option }">
                                <div class="employee-option">
                                    <strong>{{ option.value }}</strong>
                                    <span>{{ option.name_1 || '-' }}</span>
                                </div>
                            </template>
                        </Select>
                    </label>

                    <label>
                        พนักงานขาย
                        <Select
                            v-model="editing.sale_code"
                            :options="employeeOptions"
                            optionLabel="label"
                            optionValue="code"
                            placeholder="เลือกพนักงานขาย"
                            filter
                            showClear
                            :loading="isSearchingEmployee"
                            :disabled="isCustomerFormDisabled"
                            :filterFields="['code', 'name', 'label']"
                            filterPlaceholder="ค้นหารหัสหรือชื่อพนักงาน"
                            @filter="filterEmployees"
                        >
                            <template #option="{ option }">
                                <div class="employee-option">
                                    <strong>{{ option.code }}</strong>
                                    <span>{{ option.name || '-' }}</span>
                                </div>
                            </template>
                        </Select>
                    </label>

                    <label>
                        {{ t('adminCustomer.creditDay') }}
                        <InputNumber v-model="editing.credit_day" :minFractionDigits="0" :maxFractionDigits="0" :disabled="isCustomerFormDisabled" />
                    </label>

                    <label>
                        มิติ
                        <Select
                            v-model="editing.dimension_1"
                            :options="dimensionOptions"
                            optionLabel="label"
                            optionValue="value"
                            placeholder="เลือกมิติ"
                            filter
                            showClear
                            :loading="isSearchingDimension"
                            :disabled="isCustomerFormDisabled"
                            :filterFields="['value', 'label', 'name_1']"
                            filterPlaceholder="ค้นหารหัสหรือชื่อมิติ"
                            @filter="filterDimensions"
                        />
                    </label>

                    <label class="span-2">
                        {{ t('adminCustomer.address') }}
                        <Textarea v-model="editing.address" rows="4" :placeholder="t('adminCustomer.addressPlaceholder')" :disabled="isCustomerFormDisabled" />
                    </label>
                </div>

                <div class="editor-note">
                    <i class="pi pi-info-circle"></i>
                    <span>{{ t('adminCustomer.note', { passwordField: 'ar_customer.fax', websiteField: 'ar_customer.website', priceField: 'ar_customer.price_level', detailField: 'ar_customer_detail' }) }}</span>
                </div>

                <div class="editor-actions">
                    <Button :label="t('common.cancel')" icon="pi pi-undo" text :disabled="isCustomerActionBusy" @click="newCustomer" />
                    <Button :label="t('adminCustomer.saveCustomer')" icon="pi pi-save" :loading="saving" :disabled="!canSaveCustomer" @click="saveCustomer" />
                </div>
            </section>
        </div>
    </main>
</template>

<style scoped>
.admin-customers-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 1.75rem);
    background: linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #4b3a1d);
}

.admin-customers-head,
.customers-layout {
    width: min(1180px, 100%);
    margin: 0 auto;
}

.admin-customers-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 1rem;
}

.admin-customers-head p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.admin-customers-head h1 {
    margin: 0.15rem 0;
    color: var(--market-text, #4b3a1d);
}

.admin-customers-head span {
    color: var(--market-muted, #8a7650);
}

.admin-customers-actions,
.panel-title-row,
.list-tools,
.editor-actions,
.code-input-row,
.pager-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
}

.customers-layout {
    display: grid;
    grid-template-columns: minmax(300px, 0.9fr) minmax(380px, 1.2fr);
    gap: 1rem;
}

.customers-panel,
.customer-editor-panel {
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.9rem;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(120, 86, 28, 0.09));
    padding: 1rem;
}

.panel-title-row {
    justify-content: space-between;
    margin-bottom: 0.85rem;
}

.panel-title-row h2 {
    margin: 0;
    color: var(--market-text, #4b3a1d);
    font-size: 1.05rem;
}

.list-tools {
    margin-bottom: 0.75rem;
    color: var(--market-muted, #8a7650);
    font-size: 0.85rem;
}

.customers-table {
    display: grid;
    gap: 0.55rem;
    max-height: 68vh;
    overflow: auto;
    padding-right: 0.25rem;
}

.customer-row {
    display: grid;
    grid-template-columns: 3.2rem minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    border: 1px solid var(--market-card-border, #f0e3c9);
    border-radius: 0.7rem;
    background: var(--market-card-bg, #fffdf8);
    padding: 0.55rem;
    color: var(--market-text, #4b3a1d);
    cursor: pointer;
    text-align: left;
}

.customer-row.active {
    border-color: var(--market-primary, #0f9f6e);
    background: var(--market-primary-soft, #ecfdf5);
}

.customer-row:disabled {
    cursor: wait;
    opacity: 0.68;
}

.customer-avatar {
    width: 3.2rem;
    height: 3.2rem;
    border-radius: 0.8rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--market-primary-soft, #ecfdf5);
    color: var(--market-primary, #0f9f6e);
}

.customer-main strong,
.customer-main span,
.customer-main small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.customer-main span,
.customer-main small {
    color: var(--market-muted, #8a7650);
    font-size: 0.78rem;
}

.customer-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
}

.customer-form-grid label {
    display: grid;
    gap: 0.35rem;
    color: var(--market-text, #5b4a27);
    font-weight: 700;
}

.employee-option {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
}

.employee-option strong,
.employee-option span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.employee-option span {
    color: var(--market-muted, #8a7650);
    font-size: 0.82rem;
}

.span-2 {
    grid-column: span 2;
}

.code-input-row {
    flex-wrap: nowrap;
}

.code-input-row :deep(.p-inputtext) {
    width: 100%;
}

.editor-note {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
    padding: 0.8rem;
    border-radius: 0.8rem;
    background: var(--market-surface-soft, #fffaf0);
    border: 1px solid var(--market-card-border, #eadcbc);
    color: var(--market-muted, #8a7650);
    line-height: 1.45;
}

.editor-note i {
    color: var(--market-primary, #0f9f6e);
    margin-top: 0.15rem;
}

.editor-actions {
    justify-content: flex-end;
    margin-top: 1rem;
}

.pager-row {
    justify-content: center;
    margin-top: 0.75rem;
    color: var(--market-muted, #8a7650);
}

.loading-box,
.empty-state {
    display: grid;
    place-items: center;
    gap: 0.75rem;
    padding: 2rem;
    color: var(--market-muted, #8a7650);
}

.empty-state i {
    font-size: 2rem;
    color: var(--market-primary, #0f9f6e);
}

@media (max-width: 860px) {
    .admin-customers-head,
    .customers-layout,
    .customer-form-grid {
        grid-template-columns: 1fr;
    }

    .admin-customers-head {
        display: grid;
    }

    .span-2 {
        grid-column: span 1;
    }
}
</style>
