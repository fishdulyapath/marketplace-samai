<script setup>
import DocHistoryService from '@/services/DocHistoryService';
import { useLanguageStore } from '@/stores/languageStore';
import Card from 'primevue/card';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const languageStore = useLanguageStore();
const t = languageStore.t;
const advancePayments = ref([]);
const loading = ref(true);
const error = ref(null);
const summaryBalance = ref(0); // For total balance amount
const localeCode = computed(() => (languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'));

// เพิ่มตัวแปรเพื่อเก็บขนาดหน้าจอปัจจุบัน
const windowWidth = ref(window.innerWidth);

// ฟังก์ชันอัพเดทขนาดหน้าจอ
const updateWidth = () => {
    windowWidth.value = window.innerWidth;
};

// รหัสลูกค้า
const userData = JSON.parse(localStorage.getItem('_userData') || '{}');
const userCode = userData.user_code || '';

// สถานะเอกสาร
// const documentStatus = {
//     available: { label: 'พร้อมใช้', color: 'success', icon: 'pi pi-check-circle' },
//     partiallyUsed: { label: 'อ้างอิงแล้ว', color: 'warning', icon: 'pi pi-percentage' },
//     fullyUsed: { label: 'ใช้หมดแล้ว', color: 'info', icon: 'pi pi-check' }
// };

// กรองเอกสาร
const filters = ref({
    dateRange: null,
    searchTerm: ''
});

// ดึงข้อมูลเงินล่วงหน้าจาก API
async function fetchAdvancePayments() {
    try {
        loading.value = true;
        error.value = null;

        if (!userCode) {
            router.push('/auth/login');
            return;
        }

        const response = await DocHistoryService.getAdvancePayments(userCode);

        if (response?.data?.success) {
            advancePayments.value = response.data.data || [];

            // Calculate summary balance (sum of all balance_amount)
            calculateSummaryBalance();
        } else {
            error.value = t('historyPages.advance.loadFailed');
        }
    } catch (err) {
        console.error('Error fetching advance payments:', err);
        error.value = t('historyPages.advance.loadError');
    } finally {
        loading.value = false;
    }
}

// คำนวณยอดคงเหลือรวม
function calculateSummaryBalance() {
    summaryBalance.value = advancePayments.value.reduce((total, payment) => {
        return total + parseFloat(payment.balance_amount || 0);
    }, 0);
}

// ฟังก์ชันแปลงวันที่
function formatDate(dateStr) {
    if (!dateStr) return '';

    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;

    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);

    const date = new Date(year, month, day);

    return date.toLocaleDateString(localeCode.value, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// ฟอร์แมตตัวเลขเป็นรูปแบบเงินบาท
function formatCurrency(value) {
    if (value === undefined || value === null) return '0.00';
    return new Intl.NumberFormat(localeCode.value, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(parseFloat(value));
}

// กำหนดสถานะเอกสาร
// function getDocumentStatus(doc) {
//     const totalAmount = parseFloat(doc.total_amount || 0);
//     const balanceAmount = parseFloat(doc.balance_amount || 0);

//     if (balanceAmount <= 0) {
//         return documentStatus.fullyUsed;
//     } else if (balanceAmount < totalAmount) {
//         return documentStatus.partiallyUsed;
//     } else {
//         return documentStatus.available;
//     }
// }

// รีเซ็ตการกรอง
function resetFilters() {
    filters.value.dateRange = null;
    filters.value.searchTerm = '';
    // ไม่ต้องเรียก API ใหม่เมื่อรีเซ็ตตัวกรอง เพราะการกรองทำที่ฝั่ง client
}

// เอกสารที่ผ่านการกรอง
const filteredAdvancePayments = computed(() => {
    if (!advancePayments.value) return [];

    return advancePayments.value.filter((doc) => {
        let matchesSearch = true;
        let matchesDateRange = true;

        // กรองตามคำค้นหา
        if (filters.value.searchTerm) {
            const searchLower = filters.value.searchTerm.toLowerCase();
            matchesSearch = doc.doc_no.toLowerCase().includes(searchLower);
        }

        // กรองตามช่วงวันที่
        if (filters.value.dateRange && filters.value.dateRange.length === 2) {
            const docDate = new Date(doc.doc_date).setHours(0, 0, 0, 0);
            const startDate = new Date(filters.value.dateRange[0]).setHours(0, 0, 0, 0);
            const endDate = new Date(filters.value.dateRange[1]).setHours(23, 59, 59, 999);

            matchesDateRange = docDate >= startDate && docDate <= endDate;
        }

        return matchesSearch && matchesDateRange;
    });
});

// รวมการเรียก onMounted ทั้งหมดไว้ในที่เดียว
onMounted(() => {
    // สำหรับ resize listener
    window.addEventListener('resize', updateWidth);
    updateWidth(); // เรียกครั้งแรกเพื่อตั้งค่าเริ่มต้น

    // ดึงข้อมูลเงินล่วงหน้า
    fetchAdvancePayments();
});

// คงการเรียก onUnmounted ไว้ที่เดิม
onUnmounted(() => {
    window.removeEventListener('resize', updateWidth);
});
</script>
<template>
    <div class="advance-payment-page">
        <div class="advance-payment-container">
            <!-- Header -->
            <div class="page-header mb-4 flex justify-between">
                <div>
                    <h1 class="text-2xl font-bold">{{ t('historyPages.advance.title') }}</h1>
                    <p class="text-gray-500 dark:text-gray-400 mt-1">{{ t('historyPages.advance.subtitle') }}</p>
                </div>
                <!-- Summary Section -->
                <div>
                    <div class="flex flex-col md:items-end w-full">
                        <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('historyPages.advance.summary') }}</span>
                        <span class="text-2xl font-bold text-blue-500 mt-1">฿{{ formatCurrency(summaryBalance) }}</span>
                    </div>
                </div>
            </div>

            <!-- Filters -->
            <div class="filters-container mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">{{ t('historyPages.common.search') }}</label>
                        <IconField iconPosition="left" class="w-full">
                            <InputText v-model="filters.searchTerm" :placeholder="t('historyPages.advance.searchPlaceholder')" class="w-full" />
                            <InputIcon class="pi pi-search" />
                        </IconField>
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-1">{{ t('historyPages.common.dateRange') }}</label>
                        <DatePicker v-model="filters.dateRange" selectionMode="range" dateFormat="dd/mm/yy" :placeholder="t('historyPages.common.dateRange')" showIcon class="w-full" />
                    </div>
                </div>

                <div class="flex justify-end mt-3">
                    <Button :label="t('historyPages.common.clearFilters')" icon="pi pi-filter-slash" class="p-button-outlined p-button-sm w-full" @click="resetFilters" />
                </div>
            </div>

            <!-- Loading state -->
            <div v-if="loading" class="flex justify-center items-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <ProgressSpinner strokeWidth="4" style="width: 50px; height: 50px" />
            </div>

            <!-- Error state -->
            <div v-else-if="error" class="flex flex-col items-center justify-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <i class="pi pi-exclamation-triangle text-5xl text-yellow-500 mb-4"></i>
                <h3 class="text-xl font-medium mb-2">{{ t('historyPages.common.errorTitle') }}</h3>
                <p class="text-gray-500 dark:text-gray-400 mb-4 text-center">{{ error }}</p>
                <Button :label="t('historyPages.common.retry')" icon="pi pi-refresh" @click="fetchAdvancePayments" />
            </div>

            <!-- Empty state -->
            <div v-else-if="filteredAdvancePayments.length === 0" class="flex flex-col items-center justify-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <i class="pi pi-wallet text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
                <h3 class="text-xl font-medium mb-2">{{ t('historyPages.advance.noAdvance') }}</h3>
                <p v-if="filters.dateRange || filters.searchTerm" class="text-gray-500 dark:text-gray-400 mb-4 text-center">{{ t('historyPages.common.noMatchingFilters') }}<br />{{ t('historyPages.common.adjustFilters') }}</p>
                <p v-else class="text-gray-500 dark:text-gray-400 mb-4 text-center">{{ t('historyPages.advance.noAdvanceHistory') }}</p>
            </div>

            <!-- Advance Payments list -->
            <div v-else class="documents-list grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card v-for="doc in filteredAdvancePayments" :key="doc.doc_no" class="shadow-md transition-all duration-200 hover:shadow-lg rounded-xl overflow-hidden border-left-4 border-blue-500">
                    <!-- Header -->
                    <template #header>
                        <div class="p-3 border-b bg-blue-50 dark:bg-blue-900/10">
                            <div class="flex flex-col gap-1">
                                <!-- Document Code + Status -->
                                <div class="flex items-center justify-between">
                                    <div class="text-lg font-bold text-900">{{ doc.doc_no }}</div>
                                    <div class="flex items-center gap-1">
                                        <Tag :value="t('historyPages.advance.tag')" severity="info" />
                                        <!-- <Tag v-if="getDocumentStatus(doc)" :value="getDocumentStatus(doc).label" :severity="getDocumentStatus(doc).color" /> -->
                                    </div>
                                </div>

                                <!-- Date -->
                                <div class="flex flex-wrap text-sm text-600 gap-3">
                                    <span><i class="pi pi-calendar mr-1"></i>{{ formatDate(doc.doc_date) }}</span>
                                </div>
                            </div>
                        </div>
                    </template>

                    <!-- Content -->
                    <template #content>
                        <div class="p-3 space-y-3">
                            <!-- Section: Payment Details -->
                            <div>
                                <div class="text-sm font-semibold mb-2 text-800">{{ t('historyPages.common.advanceInfo') }}</div>
                                <div class="space-y-1">
                                    <div class="flex justify-between text-sm">
                                        <span class="text-600">{{ t('historyPages.common.totalAmount') }}</span>
                                        <span class="font-bold text-primary">฿{{ formatCurrency(doc.total_amount) }}</span>
                                    </div>
                                    <div class="flex justify-between text-sm">
                                        <span class="text-600">{{ t('historyPages.common.usedAmount') }}</span>
                                        <span class="text-warning">฿{{ formatCurrency(doc.used) }}</span>
                                    </div>
                                    <div class="flex justify-between text-sm">
                                        <span class="text-600">{{ t('historyPages.common.balance') }}</span>
                                        <span class="text-success">฿{{ formatCurrency(doc.balance_amount) }}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Progress Bar showing used vs remaining -->
                            <div>
                                <div class="text-sm font-semibold mb-1 text-800">{{ t('historyPages.common.usageRatio') }}</div>
                                <div class="relative w-full h-4 bg-gray-200 rounded-full overflow-hidden">
                                    <div class="absolute top-0 left-0 h-full bg-blue-500" :style="`width: ${(parseFloat(doc.used) / parseFloat(doc.total_amount)) * 100}%`"></div>
                                </div>
                                <div class="flex justify-between text-xs mt-1">
                                    <span>{{ t('historyPages.common.usedPercent', { percent: Math.round((parseFloat(doc.used) / parseFloat(doc.total_amount)) * 100) }) }}</span>
                                    <span>{{ t('historyPages.common.balancePercent', { percent: Math.round((parseFloat(doc.balance_amount) / parseFloat(doc.total_amount)) * 100) }) }}</span>
                                </div>
                            </div>
                        </div>
                    </template>
                </Card>
            </div>
        </div>
    </div>
</template>

<style scoped>
.border-left-4 {
    border-left-width: 4px;
    border-left-style: solid;
}
</style>
