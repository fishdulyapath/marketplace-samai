<!-- eslint-disable no-unused-vars -->
<script setup>
import CartService from '@/services/CartService';
import DeliveryAddressForm from './DeliveryAddressForm.vue';
import { useDeliveryAddress } from '@/composables/useDeliveryAddress';
import { PRODUCT_IMAGE_PLACEHOLDER } from '@/utils/productPlaceholder';
import CustomerService from '@/services/CustomerService';
import DocHistoryService from '@/services/DocHistoryService';
import EmployeeService from '@/services/EmployeeService';
import ErpOptionService from '@/services/ErpOptionService';
import ProductService from '@/services/ProductService';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { getCheckoutFormIssue } from '@/utils/checkoutReadiness';
import { isSalePremiumItem } from '@/utils/itemType';
import { pickProductName, withProductDisplay } from '@/utils/languageDisplay';
import { getPreorderSplit, splitItemsForPreorder, toOrderQty } from '@/utils/preorderSplit';
import { getAvailablePickupSlots, getPickupDateRange } from '@/utils/pickupSlots';
import MultiSelect from 'primevue/multiselect';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import { computed, onMounted, ref, watch } from 'vue';
// Note: defineProps and defineEmits are compiler macros and don't need to be imported

const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = languageStore.t;

// State  expand/collapse
const expandedItems = ref(new Set());

const props = defineProps({
    cartItems: {
        type: Array,
        required: true
    },
    userType: {
        type: String,
        default: ''
    },
    userData: {
        type: Object,
        default: () => ({})
    },
    orderData: {
        type: Object,
        default: () => ({
            deliveryMethod: 'pickup',
            employeeCode: '',
            customerCode: '',
            deliveryAddress: '',
            deliveryTelephone: ''
        })
    },
    totals: {
        type: Object,
        required: true
    }
});

const emit = defineEmits(['prev-step', 'process-checkout']);

// Local states
const isCheckingOut = ref(false);
const errorMessage = ref('');
const checkoutErrorMeta = ref({});
const allConfirmedItems = ref([]); // ( memory)
const isOrderProcessing = ref(false); // dialog loading
const erpOption = ref({
    vat_type: 1,
    vat_rate: 7,
    discout_type: 0,
    discount_type: 0
});

// Pagination state  ( page  memory)
const currentPage = ref(1);
const pageSize = ref(10);
const isLoadingItems = ref(false);
const isLoadingPrices = ref(false); // lazy load

// Search state  memory
const searchQuery = ref('');
const localSearchInput = ref('');
const showConfirmationSearch = computed(() => allConfirmedItems.value.length > 5 || !!searchQuery.value || !!localSearchInput.value);

// Price loading progress
const priceLoadProgress = ref(0); // 0-100%
const priceLoadedCount = ref(0);
const priceTotalCount = ref(0);
const priceLoadError = ref(false); // error
const showPriceErrorDialog = ref(false); // dialog  error

// Config  batch loading
const BATCH_SIZE = 20;
const PARALLEL_BATCHES = 3;
const MAX_RETRY = 1;

function isSetItem(item) {
    return String(item?.item_type || '') === '3';
}

function isFixedPriceItem(item) {
    return isSetItem(item) || isSalePremiumItem(item);
}

function getItemDisplayName(item) {
    return pickProductName(item, languageStore.locale) || item?.display_name || item?.item_name || item?.name || '';
}

function getSetItemKey(setItem, parentItem, index = 0) {
    return [
        parentItem?.item_code ?? '',
        parentItem?.unit_code ?? '',
        setItem?.line_number ?? '',
        setItem?.roworder ?? '',
        setItem?.item_code ?? '',
        setItem?.unit_code ?? '',
        index
    ].join(':');
}

function getSetItemQtyPerSet(setItem) {
    return toMoneyNumber(setItem?.qty, 0);
}

function getSetItemDisplayQty(setItem, parentItem) {
    return getSetItemQtyPerSet(setItem) * toOrderQty(parentItem?.qty);
}

function formatSetQuantity(value) {
    const qty = toMoneyNumber(value, 0);
    return formatQuantity(qty, Number.isInteger(qty) ? 0 : 2);
}

// Computed:  filter ( memory)
const filteredItems = computed(() => {
    if (!searchQuery.value.trim()) {
        return allConfirmedItems.value;
    }
    const query = searchQuery.value.toLowerCase().trim();
    return allConfirmedItems.value.filter((item) => {
        const itemCode = (item.item_code || '').toLowerCase();
        const itemName = getItemDisplayName(item).toLowerCase();
        return itemCode.includes(query) || itemName.includes(query);
    });
});

// Computed:  (slice  filteredItems)
const confirmedItems = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    const end = start + pageSize.value;
    return filteredItems.value.slice(start, end);
});

// Computed:  ( filteredItems)
const totalPages = computed(() => {
    return Math.ceil(filteredItems.value.length / pageSize.value) || 1;
});

// Computed: Final summary  allConfirmedItems ( 100% )
const finalSummary = computed(() => {
    const items = allConfirmedItems.value;
    const total_items = items.length;
    const total_qty = items.reduce((sum, item) => sum + toOrderQty(item.qty), 0);

    // 100%
    let total_price = 0;
    if (priceLoadProgress.value === 100 && !isLoadingPrices.value) {
        total_price = items.reduce((sum, item) => {
            const priceConfirm = toMoneyNumber(item.price_confirm, NaN);
            const originalPrice = toMoneyNumber(item.price);
            const qty = toOrderQty(item.qty);

            // (item_type = 3)  price_confirm  price
            if (isFixedPriceItem(item)) {
                const price = Number.isFinite(priceConfirm) && priceConfirm > 0 ? priceConfirm : originalPrice;
                return sum + price * qty;
            }

            // price_confirm  ( 0)
            const price = Number.isFinite(priceConfirm) ? priceConfirm : 0;
            return sum + calcLineAmount(price, qty, getItemDiscount(item)).sum_amount;
        }, 0);
    }

    return { total_items, total_qty, total_price };
});

const pricesReady = computed(() => priceLoadProgress.value === 100 && !isLoadingPrices.value);

// รายการที่โหลดราคาเสร็จแล้วแต่ price_confirm ว่างหรือเป็น 0 (ไม่ใช่ item_type=3)
const itemsWithMissingPrice = computed(() => {
    if (isLoadingPrices.value || priceLoadProgress.value < 100) return [];
    return allConfirmedItems.value.filter((item) => {
        const val = getItemPrice(item);
        return isNaN(val) || val === 0;
    });
});

const hasMissingPrice = computed(() => itemsWithMissingPrice.value.length > 0);

const priceValidationReady = computed(() => allConfirmedItems.value.length > 0 && priceLoadProgress.value === 100 && !isLoadingItems.value && !isLoadingPrices.value);

const preorderCheckoutSplit = computed(() => ({ readyItems: allConfirmedItems.value, preorderItems: [], hasReadyItems: true, hasPreorderItems: false }));
const preorderBlockedItems = computed(() => []);
const hasPreorderBlockedItems = computed(() => preorderBlockedItems.value.length > 0);
const preorderBlockMessage = computed(() => {
    if (!hasPreorderBlockedItems.value) return '';
    return t('reviewOrder.preorderBlockedMessage', { count: preorderBlockedItems.value.length });
});
const preorderBlockedItemDetails = computed(() =>
    preorderBlockedItems.value.slice(0, 3).map((item) => {
        const split = getPreorderSplit(item);
        return {
            key: `${item.item_code || ''}-${item.unit_code || ''}`,
            name: getItemDisplayName(item) || item.item_code || '-',
            qty: formatQuantity(split.totalQty, 0),
            stock: formatQuantity(split.readyQty, 0),
            shortage: formatQuantity(split.shortageQty, 0),
            unit: item.unit_code || ''
        };
    })
);
const preorderBlockedMoreCount = computed(() => Math.max(0, preorderBlockedItems.value.length - preorderBlockedItemDetails.value.length));
const preorderDocumentMessage = computed(() => {
    if (!preorderCheckoutSplit.value.hasPreorderItems) return '';
    if (preorderCheckoutSplit.value.hasReadyItems) return t('reviewOrder.preorderSplitTwoDocs');
    return t('reviewOrder.preorderSplitOneDoc');
});
const preorderQuantitySummary = computed(() => {
    if (!preorderCheckoutSplit.value.hasPreorderItems) return '';
    const readyQty = preorderCheckoutSplit.value.readyItems.reduce((sum, item) => sum + toOrderQty(item.qty), 0);
    const preorderQty = preorderCheckoutSplit.value.preorderItems.reduce((sum, item) => sum + toOrderQty(item.qty), 0);
    return t('reviewOrder.preorderQtySummary', {
        ready: formatQuantity(readyQty, 0),
        preorder: formatQuantity(preorderQty, 0)
    });
});
const priceAndStockReady = computed(() => priceValidationReady.value && !priceLoadError.value && !hasMissingPrice.value && !hasPreorderBlockedItems.value);

function calculateTaxSummaryForItems(items = [], options = {}) {
    const vatType = toIntNumber(erpOption.value?.vat_type, 1);
    const vatRate = toMoneyNumber(erpOption.value?.vat_rate ?? 7);
    const summary = {
        vatType,
        vatRate,
        vatLabel: getVatTypeLabel(vatType),
        itemCount: items.length,
        totalQty: items.reduce((sum, item) => sum + toOrderQty(item.qty), 0),
        taxableAmount: 0,
        exemptAmount: 0,
        beforeVat: 0,
        vatAmount: 0,
        afterVat: 0,
        totalAmount: 0,
        discountAmount: 0,
        taxableItems: 0,
        exemptItems: 0
    };

    if (!pricesReady.value) return summary;

    items.forEach((item) => {
        const lineAmount = getItemLineAmount(item, options);
        const sumAmount = roundMoney(lineAmount.sum_amount);
        const taxType = toIntNumber(item.tax_type, 0);

        summary.discountAmount = roundMoney(summary.discountAmount + lineAmount.discount_amount);

        if (taxType === 1) {
            summary.exemptAmount = roundMoney(summary.exemptAmount + sumAmount);
            summary.exemptItems += 1;
            return;
        }

        summary.taxableAmount = roundMoney(summary.taxableAmount + sumAmount);
        summary.taxableItems += 1;
    });

    if (summary.vatType === 1) {
        summary.beforeVat = roundMoney((summary.taxableAmount * 100) / (100 + summary.vatRate));
        summary.vatAmount = roundMoney(summary.taxableAmount - summary.beforeVat);
        summary.afterVat = summary.taxableAmount;
        summary.totalAmount = roundMoney(summary.taxableAmount + summary.exemptAmount);
    } else if (summary.vatType === 0) {
        summary.beforeVat = summary.taxableAmount;
        summary.vatAmount = roundMoney(summary.beforeVat * (summary.vatRate / 100));
        summary.afterVat = roundMoney(summary.beforeVat + summary.vatAmount);
        summary.totalAmount = roundMoney(summary.afterVat + summary.exemptAmount);
    } else {
        summary.beforeVat = summary.taxableAmount;
        summary.vatAmount = 0;
        summary.afterVat = summary.taxableAmount;
        summary.totalAmount = roundMoney(summary.taxableAmount + summary.exemptAmount);
    }

    return summary;
}

const taxSummary = computed(() => calculateTaxSummaryForItems(allConfirmedItems.value));

const preorderDocumentTotals = computed(() => {
    if (!pricesReady.value || !preorderCheckoutSplit.value.hasPreorderItems) return [];
    const split = preorderCheckoutSplit.value;
    const totals = [];
    if (split.hasReadyItems) {
        totals.push({
            key: 'ready',
            label: t('reviewOrder.readyDocumentTotal'),
            summary: calculateTaxSummaryForItems(split.readyItems, { preferExistingLineAmount: true })
        });
    }
    if (split.hasPreorderItems) {
        totals.push({
            key: 'preorder',
            label: t('reviewOrder.preorderDocumentTotal'),
            summary: calculateTaxSummaryForItems(split.preorderItems, { preferExistingLineAmount: true })
        });
    }
    return totals;
});

const priceBlockMessage = computed(() => {
    if (isLoadingItems.value) return t('reviewOrder.loadItemsMessage');
    if (isLoadingPrices.value || priceLoadProgress.value < 100) return t('reviewOrder.loadingPriceMessage');
    if (priceLoadError.value) return t('reviewOrder.loadPriceFailed');
    if (hasMissingPrice.value) return t('reviewOrder.missingPriceMessage', { count: itemsWithMissingPrice.value.length });
    return '';
});

const errorMessageLines = computed(() =>
    String(errorMessage.value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
);
const showCheckoutErrorFixButton = computed(() => {
    const meta = checkoutErrorMeta.value || {};
    const code = String(meta.code || meta.msg || '').trim();
    return (
        hasPreorderBlockedItems.value ||
        meta.needsCartFix === true ||
        code === 'ORDER_STOCK_PREORDER_INVALID' ||
        code === 'PREORDER_BLOCKED' ||
        (Array.isArray(meta.stockIssues) && meta.stockIssues.length > 0)
    );
});

const priceStatusMeta = computed(() => {
    if (isLoadingItems.value) {
        return {
            tone: 'loading',
            icon: 'pi pi-spin pi-spinner',
            title: t('reviewOrder.loadingItemsTitle'),
            detail: t('reviewOrder.loadingItemsDetail')
        };
    }

    if (isLoadingPrices.value || priceLoadProgress.value < 100) {
        const total = priceTotalCount.value || allConfirmedItems.value.filter((item) => !isFixedPriceItem(item)).length || allConfirmedItems.value.length;
        return {
            tone: 'loading',
            icon: 'pi pi-spin pi-spinner',
            title: t('reviewOrder.checkingPriceTitle'),
            detail: t('reviewOrder.checkedProgressDetail', { loaded: priceLoadedCount.value, total })
        };
    }

    if (priceLoadError.value) {
        return {
            tone: 'error',
            icon: 'pi pi-exclamation-triangle',
            title: t('reviewOrder.loadPriceFailedTitle'),
            detail: t('reviewOrder.loadPriceFailedDetail'),
            action: true
        };
    }

    if (hasMissingPrice.value) {
        return {
            tone: 'warn',
            icon: 'pi pi-exclamation-circle',
            title: t('reviewOrder.missingPriceTitle'),
            detail: t('reviewOrder.missingPriceDetail', { count: itemsWithMissingPrice.value.length }),
            action: true
        };
    }

    if (allConfirmedItems.value.length > 0) {
        return {
            tone: 'ready',
            icon: 'pi pi-check-circle',
            title: t('reviewOrder.readyTitle'),
            detail: t('reviewOrder.readyDetail')
        };
    }

    return {
        tone: 'idle',
        icon: 'pi pi-info-circle',
        title: t('reviewOrder.idleTitle'),
        detail: t('reviewOrder.idleDetail')
    };
});

// Advance payment data
const advancePayments = ref([]);
const isLoadingAdvancePayments = ref(false);
const selectedAdvancePayments = ref([]);

// ข้อมูลเครดิตลูกค้า
const creditData = ref({ credit_day: null, credit_date: null });
const isLoadingCreditData = ref(false);

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const sendDate = ref(tomorrow);

// (send_day)
const sendDay = computed(() => {
    if (!sendDate.value) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(sendDate.value);
    selected.setHours(0, 0, 0, 0);
    const diffTime = selected.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
});

// Form data
const formData = ref({
    deliveryMethod: props.orderData.deliveryMethod,
    employeeCode: props.orderData.employeeCode,
    customerCode: props.orderData.customerCode || '',
    deliveryAddress: props.orderData.deliveryAddress || props.userData.address || '',
    deliveryTelephone: props.orderData.deliveryTelephone || props.userData.telephone || '',
    // API
    send_type: props.orderData.deliveryMethod === 'delivery' ? '1' : '0',
    address: props.userData.address || '',
    address_name: '',
    remark: props.orderData.remark || ''
});

// ── รับเอง (รีวิว 260908 สไลด์ 6) ──────────────────────────────────────
const pickupDate = ref(new Date());
const pickupTimeSlot = ref('');
const pickupReceiver = ref('');
const pickupVehicle = ref('');

const pickupDateRange = computed(() => getPickupDateRange());
const pickupSlots = computed(() => getAvailablePickupSlots(pickupDate.value));

// เปลี่ยนวันแล้ว slot ที่เลือกไว้อาจใช้ไม่ได้ (เช่นเลือกเช้าของวันนี้ไว้แล้วย้อนกลับมาวันนี้)
// ต้องล้างทิ้ง ไม่งั้นจะส่ง slot ที่เกินเวลาไปให้ ERP
watch(pickupSlots, (slots) => {
    if (pickupTimeSlot.value && !slots.some((slot) => slot.value === pickupTimeSlot.value)) {
        pickupTimeSlot.value = '';
    }
});

const checkoutFormIssue = computed(() =>
    getCheckoutFormIssue({
        userType: props.userType,
        customerCode: formData.value.customerCode,
        deliveryMethod: formData.value.deliveryMethod,
        deliveryAddress: formData.value.deliveryAddress,
        deliveryTelephone: formData.value.deliveryTelephone,
        pickupDate: pickupDate.value,
        pickupTimeSlot: pickupTimeSlot.value,
        pickupReceiver: pickupReceiver.value,
        pickupVehicle: pickupVehicle.value
    })
);
const checkoutFormBlockMessage = computed(() => (checkoutFormIssue.value ? t(`reviewOrder.${checkoutFormIssue.value}`) : ''));
const canSubmitOrder = computed(() => priceAndStockReady.value && !checkoutFormIssue.value && !(formData.value.deliveryMethod === 'delivery' && deliveryAddressLoading.value));
const checkoutBlockMessage = computed(() => priceBlockMessage.value || preorderBlockMessage.value || (formData.value.deliveryMethod === 'delivery' && deliveryAddressLoading.value ? 'กำลังดึงข้อมูลที่อยู่ลูกค้า' : checkoutFormBlockMessage.value));

// ข้อความ "กรุณาเลือกวัน/เวลา/ผู้รับ/ทะเบียน" ต้องอยู่ติดกล่องที่ต้องแก้
// ไม่ใช่ไปกองรวมล่างสุดของหน้า ซึ่งอยู่ไกลจากช่องที่ยังไม่ได้กรอก
const PICKUP_ISSUE_KEYS = ['requirePickupDate', 'requirePickupTimeSlot', 'requirePickupReceiver', 'requirePickupVehicle'];
const pickupBlockMessage = computed(() => (PICKUP_ISSUE_KEYS.includes(checkoutFormIssue.value) ? checkoutFormBlockMessage.value : ''));

const deliveryMethodLabel = computed(() => (formData.value.deliveryMethod === 'delivery' ? t('reviewOrder.deliveryCustomer') : t('reviewOrder.pickupSelf')));
const selectedCustomerDisplay = computed(() => {
    if (props.userType === 'employee') return formData.value.customerCode || selectedCustomerCode.value || '-';
    return props.userData?.name || props.userData?.cust_name || props.userData?.user_name || props.userData?.user_code || '-';
});
const deliveryContactDisplay = computed(() => {
    if (formData.value.deliveryMethod === 'delivery') {
        const tel = formData.value.deliveryTelephone;
        return tel || '-';
    }
    return props.userData?.telephone || '-';
});
const deliveryAddressDisplay = computed(() => {
    if (formData.value.deliveryMethod !== 'delivery') return t('reviewOrder.pickupAtStore');
    return formData.value.deliveryAddress || '-';
});
const readinessChecks = computed(() => [
    {
        label: t('reviewOrder.priceDiscount'),
        ready: priceValidationReady.value && !priceLoadError.value && !hasMissingPrice.value,
        detail: priceBlockMessage.value || t('reviewOrder.checkedReady')
    },
    {
        label: 'การจัดคลัง',
        ready: !hasPreorderBlockedItems.value,
        detail: 'พนักงานจะเลือกคลังและที่เก็บหลังรับคำขอ'
    },
    {
        label: t('reviewOrder.customerInfo'),
        ready: props.userType !== 'employee' || !!formData.value.customerCode,
        detail: props.userType === 'employee' ? formData.value.customerCode || t('reviewOrder.selectCustomerBeforeConfirm') : selectedCustomerDisplay.value
    },
    {
        label: t('reviewOrder.pickupInfo'),
        ready: formData.value.deliveryMethod !== 'delivery' || (!!formData.value.deliveryAddress && !!formData.value.deliveryTelephone),
        detail: ['requireDeliveryAddress', 'requireDeliveryPhone'].includes(checkoutFormIssue.value) ? checkoutFormBlockMessage.value : deliveryMethodLabel.value
    }
]);
const submitButtonLabel = computed(() => {
    if (isProcessingOrder.value) return t('reviewOrder.submitProcessing');
    if (isLoadingPrices.value || priceLoadProgress.value < 100) return t('reviewOrder.submitLoadingPrice');
    if (!canSubmitOrder.value) return t('reviewOrder.submitDisabled');
    return t('reviewOrder.submitConfirm');
});

const isSubmitting = ref(false);
const isProcessingOrder = computed(() => isSubmitting.value || isCheckingOut.value || isOrderProcessing.value);

// Employee selection
const selectedEmployee = ref(null);
const isSearchingEmployee = ref(false);
const employeeOptions = ref([]);
const selectedEmployeeCode = ref(localStorage.getItem('_empCode') || '');

// Customer selection
const selectedCustomer = ref(null);
const isSearchingCustomer = ref(false);
const customerOptions = ref([]);
const selectedCustomerCode = ref(localStorage.getItem('_userCode') || '');

const shipping = useDeliveryAddress({
    customerCode: () => props.userType === 'employee'
        ? formData.value.customerCode || selectedCustomerCode.value
        : props.userData.user_code || props.userData.code || selectedCustomerCode.value,
    customer: () => props.userData,
    draft: () => props.orderData,
    loadCustomer: (code) => CustomerService.getCustomerDetail(code)
});
const { customAddress, customTelephone,
    loading: deliveryAddressLoading, loadError: deliveryAddressLoadError } = shipping;

watch([shipping.deliveryAddress, shipping.deliveryTelephone], ([address, telephone]) => {
    formData.value.deliveryAddress = address;
    formData.value.deliveryTelephone = telephone;
    formData.value.address = address;
    formData.value.address_name = '';
}, { immediate: true, flush: 'sync' });

// Confirm order dialog
const termsDialog = ref(false);
const termsAccepted = ref(false);

// Update the watch for deliveryMethod to set send_type
watch(
    () => formData.value.deliveryMethod,
    (newValue) => {
        formData.value.send_type = newValue === 'delivery' ? '1' : '0';
    }
);

// Helper:  array  chunks
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

function toMoneyNumber(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toIntNumber(value, fallback = 0) {
    return Math.trunc(toMoneyNumber(value, fallback));
}

function roundMoney(value) {
    return Math.round(toMoneyNumber(value) * 100) / 100;
}

function calcAfterDiscount(discountWord, amount, qty = 1) {
    if (!discountWord || !String(discountWord).trim()) return roundMoney(amount);

    let result = toMoneyNumber(amount);
    const lineQty = toOrderQty(qty) || 1;
    const tokens = String(discountWord).replace(/\s/g, '').split(/[,+]/);
    for (const token of tokens) {
        if (!token) continue;
        if (token.startsWith('@')) {
            result -= roundMoney(toMoneyNumber(token.slice(1)) * lineQty);
        } else if (token.includes('%')) {
            result -= roundMoney((toMoneyNumber(token.replace(/%/g, '')) / 100) * result);
        } else if (token.toUpperCase().endsWith('B')) {
            result -= toMoneyNumber(token.slice(0, -1));
        } else {
            result -= toMoneyNumber(token);
        }
        if (result < 0) result = 0;
    }
    return roundMoney(result);
}

function calcLineAmount(unitPrice, qty, discountWord = '') {
    const gross = roundMoney(toMoneyNumber(unitPrice) * toOrderQty(qty));
    if (!discountWord || !String(discountWord).trim()) {
        return { gross, discount_amount: 0, sum_amount: gross };
    }
    const sum_amount = calcAfterDiscount(discountWord, gross, qty);
    return {
        gross,
        discount_amount: roundMoney(gross - sum_amount),
        sum_amount
    };
}

function getItemDiscount(item) {
    return item.defaultDiscount || item.default_discount || item.discount || '';
}

function getItemLineAmount(item, options = {}) {
    if (options.preferExistingLineAmount) {
        const sumAmount = toMoneyNumber(item?.sum_amount, NaN);
        if (Number.isFinite(sumAmount)) {
            const discountAmount = toMoneyNumber(item?.discount_amount, 0);
            const gross = roundMoney(sumAmount + discountAmount);
            return { gross, discount_amount: discountAmount, sum_amount: sumAmount };
        }
    }
    return calcLineAmount(getItemPrice(item), item.qty, getItemDiscount(item));
}

// ()  page  memory
const loadAllConfirmedItems = async () => {
    if (!props.userData?.user_code) return;

    try {
        isLoadingItems.value = true;
        allConfirmedItems.value = [];
        currentPage.value = 1;

        // API (loop pagination)
        let page = 1;
        let hasNext = true;
        const fetchPageSize = 100; // 100

        while (hasNext) {
            const response = await CartService.getCartOrder(props.userData.user_code, page, fetchPageSize);

            if (response?.data?.success && response.data.data) {
                allConfirmedItems.value = [...allConfirmedItems.value, ...response.data.data.map((item) => withProductDisplay(item))];
                hasNext = page * fetchPageSize < response.data.total_count;
                page++;
            } else {
                hasNext = false;
            }
        }

        const setProducts = allConfirmedItems.value.filter(isSetItem);
        for (const item of setProducts) {
            await cartStore.fetchSetItems(item.item_code);
        }

        // isLoadingPrices  isLoadingItems  0.00
        if (allConfirmedItems.value.length > 0) {
            isLoadingPrices.value = true;
            priceTotalCount.value = allConfirmedItems.value.length;
        }
    } catch (error) {
        console.error(':', error);
    } finally {
        isLoadingItems.value = false;

        // lazy load  batch (background)  isLoadingItems
        if (allConfirmedItems.value.length > 0) {
            loadPricesInBatches();
        }
    }
};

// batch  retry
const loadPriceBatch = async (batch, retryCount = 0) => {
    try {
        const priceResponse = await CartService.getCartOrderPrice(props.userData.user_code, batch);

        if (priceResponse?.data?.success && priceResponse.data.data) {
            return priceResponse.data.data;
        }
        return null;
    } catch (error) {
        if (retryCount < MAX_RETRY) {
            console.warn(`Batch price load failed, retrying... (${retryCount + 1}/${MAX_RETRY})`);
            return loadPriceBatch(batch, retryCount + 1);
        }
        console.error('Batch price load failed after retry:', error);
        return null;
    }
};

const cartPriceKey = (item) => `${item.item_code}-${item.unit_code}-${item.barcode || ''}`;

// batch (parallel)
// (item_type === '3')  price_confirm   API
const loadPricesInBatches = async () => {
    if (!props.userData?.user_code || allConfirmedItems.value.length === 0) return;

    try {
        isLoadingPrices.value = true;
        priceLoadProgress.value = 0;
        priceLoadedCount.value = 0;
        priceLoadError.value = false; // error state

        // ( API)  ( price_confirm )
        const normalItems = allConfirmedItems.value.filter((item) => !isFixedPriceItem(item));

        // ()
        priceTotalCount.value = normalItems.length;

        const priceMap = new Map();
        let hasError = false; // error  batch

        if (normalItems.length === 0) {
            priceLoadProgress.value = 100;
            return;
        }

        // batches
        const batches = chunkArray(normalItems, BATCH_SIZE);

        // parallel batches
        for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
            const currentBatches = batches.slice(i, i + PARALLEL_BATCHES);

            // parallel
            const results = await Promise.all(currentBatches.map((batch) => loadPriceBatch(batch)));

            // error
            results.forEach((result) => {
                if (result === null) {
                    hasError = true; // batch  fail
                } else if (result) {
                    result.forEach((p) => {
                        if (p?.success === false) {
                            hasError = true;
                            return;
                        }
                        const key = cartPriceKey(p);
                        // number
                        const priceValue = toMoneyNumber(p.price_confirm, NaN);
                        priceMap.set(key, {
                            price_confirm: Number.isFinite(priceValue) ? priceValue : 0,
                            defaultDiscount: p.defaultDiscount || p.default_discount || p.discount || ''
                        });
                    });
                }
            });

            // progress ()
            const processedCount = Math.min((i + PARALLEL_BATCHES) * BATCH_SIZE, normalItems.length);
            priceLoadedCount.value = processedCount;
            priceLoadProgress.value = Math.round((processedCount / priceTotalCount.value) * 100);

            // allConfirmedItems  ()
            allConfirmedItems.value = allConfirmedItems.value.map((item) => {
                // price_confirm
                if (isFixedPriceItem(item)) {
                    return item;
                }
                const key = cartPriceKey(item);
                const priceInfo = priceMap.get(key);
                if (priceInfo !== undefined) {
                    return {
                        ...item,
                        price_confirm: priceInfo.price_confirm,
                        defaultDiscount: priceInfo.defaultDiscount,
                        discount: priceInfo.defaultDiscount
                    };
                }
                return item;
            });
        }

        // error state  batch  fail
        if (hasError) {
            priceLoadError.value = true;
            showPriceErrorDialog.value = true; // dialog
        }

        priceLoadProgress.value = 100;
    } catch (error) {
        console.error(':', error);
        priceLoadError.value = true; // error state
        showPriceErrorDialog.value = true; // dialog
    } finally {
        isLoadingPrices.value = false;
    }
};

async function retryLoadPrices() {
    showPriceErrorDialog.value = false;
    priceLoadError.value = false;
    allConfirmedItems.value = allConfirmedItems.value.map((item) => {
        if (isFixedPriceItem(item)) return item;
        const { price_confirm, defaultDiscount, default_discount, discount, ...rest } = item;
        return rest;
    });
    await loadPricesInBatches();
}

// ( memory -  async)
const changePage = (page) => {
    if (page < 1 || page > totalPages.value || page === currentPage.value) return;
    currentPage.value = page;
};

// memory
const handleSearch = () => {
    searchQuery.value = localSearchInput.value;
    currentPage.value = 1; //
};

const handleClearSearch = () => {
    localSearchInput.value = '';
    searchQuery.value = '';
    currentPage.value = 1;
};

// Enter
const handleSearchKeydown = (event) => {
    if (event.key === 'Enter') {
        handleSearch();
    }
};

// pagination pages
const paginationPages = computed(() => {
    const pages = [];
    const maxVisible = 5;

    if (totalPages.value <= maxVisible) {
        for (let i = 1; i <= totalPages.value; i++) {
            pages.push(i);
        }
    } else {
        pages.push(1);

        let start = Math.max(2, currentPage.value - 1);
        let end = Math.min(totalPages.value - 1, currentPage.value + 1);

        if (currentPage.value <= 2) {
            end = 4;
        } else if (currentPage.value >= totalPages.value - 1) {
            start = totalPages.value - 3;
        }

        if (start > 2) {
            pages.push('...');
        }

        for (let i = start; i <= end; i++) {
            pages.push(i);
        }

        if (end < totalPages.value - 1) {
            pages.push('...');
        }

        pages.push(totalPages.value);
    }

    return pages;
});

watch(selectedAdvancePayments, () => {
    updateRemarkWithAdvancePayments();
});

onMounted(async () => {
    try {
        if (props.userData && props.userData.user_code) {
            await Promise.all([
                loadErpOption(),
                loadAllConfirmedItems(),
                loadAdvancePayments(props.userData.user_code),
                loadCustomerCredit(props.userData.user_code)
            ]);
        }

        if (selectedEmployeeCode.value) {
            formData.value.employeeCode = selectedEmployeeCode.value;
        }

        if (selectedCustomerCode.value) {
            formData.value.customerCode = selectedCustomerCode.value;
        }

        await Promise.all([loadInitialEmployees()]);
    } catch (error) {
        console.error(':', error);
    }
});

async function loadErpOption() {
    try {
        const option = await ErpOptionService.getErpOption();
        erpOption.value = {
            ...erpOption.value,
            ...option,
            vat_type: option?.vat_type ?? erpOption.value.vat_type,
            vat_rate: option?.vat_rate ?? erpOption.value.vat_rate,
            discout_type: option?.discout_type ?? option?.discount_type ?? erpOption.value.discout_type,
            discount_type: option?.discount_type ?? option?.discout_type ?? erpOption.value.discount_type
        };
    } catch (error) {
        console.warn('Unable to load ERP VAT option, using default tax display.', error);
    }
}

const loadInitialEmployees = async () => {
    try {
        isSearchingEmployee.value = true;
        const data = await EmployeeService.getEmployees('', 50, { selectableOnly: true });

        if (Array.isArray(data) && data.length > 0) {
            employeeOptions.value = data;
        } else {
            employeeOptions.value = [];
        }

        if (selectedEmployeeCode.value) {
            const normalizedCode = selectedEmployeeCode.value.toUpperCase();
            selectedEmployee.value = employeeOptions.value.find((emp) => String(emp.code || '').toUpperCase() === normalizedCode) || null;

            if (!selectedEmployee.value) {
                try {
                    selectedEmployee.value = await EmployeeService.getEmployeeByCode(selectedEmployeeCode.value, { selectableOnly: true });
                    employeeOptions.value = [selectedEmployee.value, ...employeeOptions.value];
                } catch {
                    selectedEmployeeCode.value = '';
                    formData.value.employeeCode = '';
                    localStorage.removeItem('_empCode');
                    localStorage.removeItem('_empData');
                }
            }
        }
    } catch (error) {
        console.error(':', error);
        employeeOptions.value = [];
    } finally {
        isSearchingEmployee.value = false;
    }
};

const filterEmployees = async (event) => {
    try {
        isSearchingEmployee.value = true;
        const searchTerm = event.value || '';

        if (searchTerm.trim().length < 2) {
            await loadInitialEmployees();
            return;
        }

        const data = await EmployeeService.getEmployees(searchTerm, 100, { selectableOnly: true });

        if (Array.isArray(data) && data.length > 0) {
            employeeOptions.value = data;
        } else {
            employeeOptions.value = [];
        }
    } catch (error) {
        console.error(':', error);
        employeeOptions.value = [];
    } finally {
        isSearchingEmployee.value = false;
    }
};

const onEmployeeSelect = (employee) => {
    if (employee) {
        formData.value.employeeCode = employee.code;
        selectedEmployeeCode.value = employee.code;
        localStorage.setItem('_empCode', selectedEmployee.value.code);
        localStorage.setItem('_empData', JSON.stringify(selectedEmployee.value));
    } else {
        formData.value.employeeCode = '';
        selectedEmployeeCode.value = '';
        localStorage.removeItem('_empCode');
        localStorage.removeItem('_empData');
    }
};

const loadInitialCustomers = async () => {
    try {
        isSearchingCustomer.value = true;
        const data = await CustomerService.getCustomers('', 50);

        if (Array.isArray(data) && data.length > 0) {
            customerOptions.value = data;

            if (selectedCustomerCode.value && selectedCustomerCode.value.trim() !== '') {
                const matchedCustomer = data.find((cust) => cust.code === selectedCustomerCode.value);
                if (matchedCustomer) {
                    selectedCustomer.value = matchedCustomer;
                    formData.value.customerCode = matchedCustomer.code;
                } else {
                    await searchCustomerByCode(selectedCustomerCode.value);
                }
            }
        } else {
            customerOptions.value = [];
        }
    } catch (error) {
        console.error(':', error);
        customerOptions.value = [];
    } finally {
        isSearchingCustomer.value = false;
    }
};

const searchCustomerByCode = async (code) => {
    if (!code) return;

    try {
        isSearchingCustomer.value = true;
        const data = await CustomerService.getCustomers(code, 10);

        if (Array.isArray(data) && data.length > 0) {
            customerOptions.value = data;
            const customer = data.find((cust) => cust.code === code);
            if (customer) {
                selectedCustomer.value = customer;
                formData.value.customerCode = customer.code;
            }
        }
    } catch (error) {
        console.error(':', error);
    } finally {
        isSearchingCustomer.value = false;
    }
};

const filterCustomers = async (event) => {
    try {
        isSearchingCustomer.value = true;
        const searchTerm = event.value || '';

        if (searchTerm.trim().length < 2) {
            await loadInitialCustomers();
            return;
        }

        const data = await CustomerService.getCustomers(searchTerm, 100);

        if (Array.isArray(data) && data.length > 0) {
            customerOptions.value = data;
        } else {
            customerOptions.value = [];
        }
    } catch (error) {
        console.error(':', error);
        customerOptions.value = [];
    } finally {
        isSearchingCustomer.value = false;
    }
};

const onCustomerSelect = (customer) => {
    if (customer) {
        formData.value.customerCode = customer.code;
        localStorage.setItem('_userCode', customer.code);
        localStorage.setItem('_userData', JSON.stringify(customer));
        selectedCustomerCode.value = customer.code;
    } else {
        formData.value.customerCode = '';
        localStorage.removeItem('_userCode');
        localStorage.removeItem('_userData');

        selectedCustomerCode.value = '';
    }
};

// Checkout process
async function handleCheckout() {
    // Reset error message
    errorMessage.value = '';
    checkoutErrorMeta.value = {};

    if (isSubmitting.value) {
        return;
    }

    if (!canSubmitOrder.value) {
        markCheckoutBlockMeta();
        errorMessage.value = checkoutBlockMessage.value || t('reviewOrder.waitPriceValidation');
        if (priceLoadError.value) showPriceErrorDialog.value = true;
        return;
    }

    isSubmitting.value = true;

    // Validate form first before showing confirm dialog
    let isValid = true;
    let validationMessage = '';

    // Check if customer code is required (for employee users)
    if (props.userType === 'employee' && !formData.value.customerCode?.trim()) {
        isValid = false;
        validationMessage = t('reviewOrder.selectCustomerBeforeConfirm');
    }

    // Check delivery information if delivery method is selected
    if (formData.value.deliveryMethod === 'delivery') {
        if (!formData.value.deliveryAddress?.trim()) {
            isValid = false;
            validationMessage = t('reviewOrder.requireDeliveryAddress');
        } else if (!formData.value.deliveryTelephone?.trim()) {
            isValid = false;
            validationMessage = t('reviewOrder.requireDeliveryPhone');
        }
    }

    // If validation fails, show error message and exit
    if (!isValid) {
        errorMessage.value = validationMessage;
        isSubmitting.value = false; // isSubmitting  validation
        return;
    }

    // Form is valid, show terms dialog before submitting
    termsAccepted.value = false;
    termsDialog.value = true;
    isSubmitting.value = false; // wait for user confirm in dialog
    return;
}

function confirmCheckout() {
    if (isProcessingOrder.value) {
        return;
    }

    if (!termsAccepted.value) {
        return;
    }

    if (!canSubmitOrder.value) {
        termsDialog.value = false;
        termsAccepted.value = false;
        markCheckoutBlockMeta();
        errorMessage.value = checkoutBlockMessage.value || t('reviewOrder.loadAllPricesBeforeConfirm');
        if (priceLoadError.value) showPriceErrorDialog.value = true;
        return;
    }
    termsDialog.value = false;
    termsAccepted.value = false;
    // dialog loading
    isSubmitting.value = true; // true
    isOrderProcessing.value = true; // dialog loading

    // dialog
    setTimeout(() => {
        proceedCheckout();
    }, 100);
}

function cancelCheckout() {
    termsDialog.value = false;
    termsAccepted.value = false;
    isSubmitting.value = false; // isSubmitting
}

function checkoutErrorMessage(error) {
    const message = String(error?.message || '').trim();
    if (!message || message === '[object Object]') return t('reviewOrder.checkoutFailedRetry');
    if (message.startsWith('API Error:')) return t('reviewOrder.checkoutFailedRetry');
    if (message.startsWith('LOGIN_REQUIRED:')) return message.slice('LOGIN_REQUIRED:'.length).trim() || t('reviewOrder.checkoutFailedRetry');
    return message;
}

function checkoutErrorMetaFrom(error) {
    const meta = error?.checkoutMeta;
    return meta && typeof meta === 'object' ? meta : {};
}

function markCheckoutBlockMeta() {
    checkoutErrorMeta.value = hasPreorderBlockedItems.value
        ? {
              code: 'PREORDER_BLOCKED',
              needsCartFix: true,
              stockIssues: preorderBlockedItemDetails.value
          }
        : {};
}

function setCheckoutError(error, fallbackMessage = '') {
    checkoutErrorMeta.value = checkoutErrorMetaFrom(error);
    errorMessage.value = checkoutErrorMessage(error) || fallbackMessage || t('reviewOrder.checkoutFailedRetry');
}

async function proceedCheckout() {
    try {
        isCheckingOut.value = true;
        isOrderProcessing.value = true; // dialog loading

        // Update telephone based on send_type
        if (formData.value.send_type === '0') {
            // -
            formData.value.telephone = props.userData.telephone || '';
        } else {
            // -
            formData.value.telephone = formData.value.deliveryTelephone;

            formData.value.address = formData.value.deliveryAddress;
            formData.value.address_name = '';
        }

        // dd/mm/yyyy สำหรับข้อความที่คนอ่าน
        const formatPickupDate = (date) => {
            if (!date) return '';
            const d = new Date(date);
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        };

        // YYYY-MM-DD
        const formatDate = (date) => {
            if (!date) return null;
            const d = new Date(date);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Make sure all fields for new requirements are explicitly set
        const dataToSend = {
            ...formData.value,
            // Ensure all required fields are explicitly set
            send_type: formData.value.send_type,
            address: formData.value.address,
            address_name: formData.value.address_name,
            telephone: formData.value.telephone,
            send_date: formatDate(sendDate.value),
            send_day: sendDay.value,
            // ข้อมูลรับเอง — backend เอาไปต่อท้ายหมายเหตุของ QT
            // (รีวิว 260908 สไลด์ 6: "ข้อมูลจะอยู่ที่ หมายเหตุ ขอ QT")
            // ส่งเป็น dd/mm/yyyy ให้ตรงกับที่ผู้ใช้เห็นในช่องเลือกวัน — ข้อความนี้ไปโผล่
            // ในหมายเหตุของ QT ซึ่งพนักงาน ERP เป็นคนอ่าน ไม่ใช่เครื่องอ่าน
            pickup_date: formData.value.deliveryMethod === 'pickup' ? formatPickupDate(pickupDate.value) : '',
            pickup_time_slot: formData.value.deliveryMethod === 'pickup' ? pickupTimeSlot.value : '',
            pickup_receiver: formData.value.deliveryMethod === 'pickup' ? pickupReceiver.value.trim() : '',
            pickup_vehicle: formData.value.deliveryMethod === 'pickup' ? pickupVehicle.value.trim() : '',
            credit_day: creditData.value.credit_day,
            credit_date: creditData.value.credit_date,
            // tax_type, item_type  sub_item ( allConfirmedItems )
            items: allConfirmedItems.value.map((item) => {
                const finalPrice = item.price_confirm !== undefined ? toMoneyNumber(item.price_confirm) : toMoneyNumber(item.price);
                const discount = getItemDiscount(item);
                const lineAmount = calcLineAmount(finalPrice, item.qty, discount);

                // sub_item  (item_type === '3')
                let subItems = [];
                if (isSetItem(item) && cartStore.setItemsCache[item.item_code]?.length > 0) {
                    subItems = cartStore.setItemsCache[item.item_code].map((setItem) => ({
                        item_code: setItem.item_code,
                        item_name: setItem.item_name,
                        unit_code: setItem.unit_code,
                        qty: getSetItemQtyPerSet(setItem),
                        price: toMoneyNumber(setItem.price),
                        sum_amount: toMoneyNumber(setItem.sum_amount), //
                        balance_qty: setItem.balance_qty || 0,
                        price_ratio: setItem.price_ratio || 1,
                        barcode: setItem.barcode || '',
                        line_number: setItem.line_number || 0,
                        roworder: setItem.roworder || 0,
                        stand_value: setItem.stand_value || 1,
                        divide_value: setItem.divide_value || 1
                    }));
                }

                return {
                    ...item,
                    price: finalPrice, // (price_confirm)
                    discount,
                    discount_amount: lineAmount.discount_amount,
                    sum_amount: lineAmount.sum_amount,
                    tax_type: item.tax_type || '0', // tax_type
                    item_type: item.item_type || '0', // item_type
                    is_promotion: item.is_promotion || '0',
                    sub_item: subItems // sub_item ([] )
                };
            })
        };

        //console.log('Step confirmation sending data:', dataToSend);
        //console.log(
        // 'Items with tax_type and confirmed price:',
        // dataToSend.items.map((item) => ({
        // item_code: item.item_code,
        // tax_type: item.tax_type,
        // price: item.price, // price_confirm
        // qty: item.qty,
        // sum_amount: item.price * item.qty
        // }))
        // );

        // Process checkout using the parent component's method
        const checkoutResult = await new Promise((resolve) => {
            emit('process-checkout', dataToSend, resolve);
        });
        const success = checkoutResult === true || checkoutResult?.success === true;

        if (!success) {
            setCheckoutError(checkoutResult, t('reviewOrder.checkoutFailedRetry'));
            isCheckingOut.value = false;
            isSubmitting.value = false; //
            isOrderProcessing.value = false; // dialog loading
        }
    } catch (error) {
        console.error('Checkout error:', error);
        setCheckoutError(error, t('reviewOrder.checkoutFailedRetry'));
        isCheckingOut.value = false;
        isSubmitting.value = false; //
        isOrderProcessing.value = false; // dialog loading
    }
}

// Utility functions
function currentLocaleCode() {
    return languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH';
}

function formatNumber(value) {
    return toMoneyNumber(value).toLocaleString(currentLocaleCode(), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatQuantity(value, fractionDigits = 2) {
    const num = toMoneyNumber(value);
    return num.toLocaleString(currentLocaleCode(), {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
    });
}

function formatDisplayDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString(currentLocaleCode(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function getVatTypeLabel(vatType) {
    if (vatType === 1) return t('reviewOrder.vatIncluded');
    if (vatType === 0) return t('reviewOrder.vatExcluded');
    return t('reviewOrder.noVat');
}

const loadAdvancePayments = async (custCode) => {
    if (!custCode) return;
    try {
        isLoadingAdvancePayments.value = true;
        const response = await DocHistoryService.getAdvancePayments(custCode);
        if (response?.data?.data) {
            advancePayments.value = response.data.data.map((item) => ({
                docno: item.doc_no || item.docno,
                balance_amount: item.balance_amount || '0'
            }));
        } else {
            advancePayments.value = [];
        }
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการโหลดข้อมูลเงินล่วงหน้า:', error);
        advancePayments.value = [];
    } finally {
        isLoadingAdvancePayments.value = false;
    }
};

const loadCustomerCredit = async (custCode) => {
    if (!custCode) return;
    try {
        isLoadingCreditData.value = true;
        const response = await CartService.getCustomerCredit(custCode);
        if (response?.data?.data) {
            creditData.value = {
                credit_day: response.data.data.credit_day || null,
                credit_date: response.data.data.credit_date || null
            };
        } else {
            creditData.value = { credit_day: null, credit_date: null };
        }
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการโหลดข้อมูลเครดิต:', error);
        creditData.value = { credit_day: null, credit_date: null };
    } finally {
        isLoadingCreditData.value = false;
    }
};

function stripAdvancePaymentRemark(value) {
    return String(value || '')
        .replace(/^(รับเงินล่วงหน้า:|Advance payment:|ຮັບເງິນລ່ວງໜ້າ:).*?(\n|$)/gm, '')
        .trim();
}

function getAdvancePaymentRemarkLabel() {
    return `${t('reviewOrder.advancePayment')}:`;
}

function updateRemarkWithAdvancePayments() {
    const selectedDocs = selectedAdvancePayments.value.map((p) => p.docno).join(',');
    if (!formData.value._originalRemark && !stripAdvancePaymentRemark(formData.value.remark)) {
        formData.value._originalRemark = formData.value.remark;
    } else if (!formData.value._originalRemark) {
        formData.value._originalRemark = stripAdvancePaymentRemark(formData.value.remark);
    }
    if (selectedDocs) {
        const advanceInfo = `${getAdvancePaymentRemarkLabel()} ${selectedDocs} (${selectedAdvancePayments.value.map((p) => `฿${formatNumber(p.balance_amount)}`).join(', ')})`;
        const cleanRemark = stripAdvancePaymentRemark(formData.value._originalRemark);
        formData.value.remark = advanceInfo + (cleanRemark ? '\n' + cleanRemark : '');
    } else {
        formData.value.remark = formData.value._originalRemark || '';
    }
}

function updateOriginalRemark(event) {
    const currentText = event.target.value || '';
    formData.value._originalRemark = stripAdvancePaymentRemark(currentText);
    if (selectedAdvancePayments.value.length > 0) {
        updateRemarkWithAdvancePayments();
    }
}

function getProductImage(itemOrCode) {
    const itemCode = typeof itemOrCode === 'object' ? itemOrCode?.item_code || itemOrCode?.code : itemOrCode;
    if (!itemCode) {
        return PRODUCT_IMAGE_PLACEHOLDER;
    }
    return ProductService.getProductImageUrl(itemCode, typeof itemOrCode === 'object' ? itemOrCode : {});
}

function handleImageError(event) {
    event.target.src = PRODUCT_IMAGE_PLACEHOLDER;
}

// Helper:
// -  (item_type = 3):  price_confirm  0   price
// - :  price_confirm  ( 0  API )
function getItemPrice(item) {
    const priceConfirm = toMoneyNumber(item.price_confirm, NaN);
    const originalPrice = toMoneyNumber(item.price);

    // (item_type = 3)  price_confirm  price
    if (isFixedPriceItem(item)) {
        return Number.isFinite(priceConfirm) && priceConfirm > 0 ? priceConfirm : originalPrice;
    }

    // price_confirm  ( 0)
    return Number.isFinite(priceConfirm) ? priceConfirm : 0;
}

// Helper:  valid  ()
// -  (item_type = 3): valid  price_confirm  price
// - : valid  price_confirm  set  ( 0)
function hasValidPrice(item) {
    const originalPrice = toMoneyNumber(item.price);

    // (item_type = 3)
    if (isFixedPriceItem(item)) {
        const priceConfirm = toMoneyNumber(item.price_confirm, NaN);
        return (Number.isFinite(priceConfirm) && priceConfirm > 0) || originalPrice > 0;
    }

    // price_confirm  set  ( 0)
    // price_confirm  undefined/null/empty string
    return item.price_confirm !== undefined && item.price_confirm !== null && item.price_confirm !== '';
}

// Helper:  confirm  ( price_confirm > 0)
function hasPriceDiscount(item) {
    const priceConfirm = toMoneyNumber(item.price_confirm, NaN);
    const originalPrice = toMoneyNumber(item.price, NaN);
    return Number.isFinite(priceConfirm) && priceConfirm > 0 && priceConfirm !== originalPrice;
}

function hasLineDiscount(item) {
    return getItemLineAmount(item).discount_amount > 0;
}

function hasEffectiveDiscount(item) {
    return hasPriceDiscount(item) || hasLineDiscount(item);
}

function calculateConfirmedTotal() {
    return props.cartItems.reduce((total, item) => {
        const confirmedPrice = getConfirmedPrice(item.item_code, item.unit_code);
        const price = confirmedPrice !== null ? confirmedPrice : item.price;
        return total + toMoneyNumber(price) * toOrderQty(item.qty);
    }, 0);
}

function getConfirmedPrice(itemCode, unitCode) {
    const confirmedItem = allConfirmedItems.value.find((item) => item.item_code === itemCode && item.unit_code === unitCode);
    return confirmedItem ? toMoneyNumber(confirmedItem.price_confirm, null) : null;
}

// tax_type
function getTaxType(itemCode, unitCode) {
    const confirmedItem = allConfirmedItems.value.find((item) => item.item_code === itemCode && item.unit_code === unitCode);
    return confirmedItem ? confirmedItem.tax_type : '0'; // default  '0' =
}

// expand/collapse
function toggleSetItems(itemCode) {
    if (expandedItems.value.has(itemCode)) {
        expandedItems.value.delete(itemCode);
    } else {
        expandedItems.value.add(itemCode);
    }
}

function isExpanded(itemCode) {
    return expandedItems.value.has(itemCode);
}
</script>

<template>
    <div class="confirmation-shell">
        <div class="confirmation-heading mb-4">
            <div>
                <p class="confirmation-kicker">{{ t('reviewOrder.kicker') }}</p>
                <h2 class="confirmation-title">{{ t('reviewOrder.title') }}</h2>
            </div>
            <div class="confirmation-head-metrics">
                <div class="confirmation-state-chip">
                    <span>{{ t('reviewOrder.productLines') }}</span>
                    <strong>{{ t('reviewOrder.itemCount', { count: finalSummary.total_items }) }}</strong>
                    <small>{{ t('reviewOrder.pieceCount', { count: finalSummary.total_qty }) }}</small>
                </div>
                <div class="confirmation-state-chip">
                    <span>{{ t('reviewOrder.total') }}</span>
                    <strong v-if="pricesReady">฿{{ formatNumber(taxSummary.totalAmount) }}</strong>
                    <strong v-else class="confirmation-loading-total">{{ t('reviewOrder.calculating') }}</strong>
                </div>
            </div>
        </div>

        <div :class="['confirmation-price-status', `confirmation-price-status--${priceStatusMeta.tone}`]">
            <div class="confirmation-price-status-icon">
                <i :class="priceStatusMeta.icon"></i>
            </div>
            <div class="confirmation-price-status-body">
                <strong>{{ priceStatusMeta.title }}</strong>
                <span>{{ priceStatusMeta.detail }}</span>
                <div v-if="priceStatusMeta.tone === 'loading'" class="confirmation-price-status-progress">
                    <div :style="{ width: `${priceLoadProgress}%` }"></div>
                </div>
            </div>
            <Button
                v-if="priceStatusMeta.action"
                :label="t('reviewOrder.reloadPrice')"
                icon="pi pi-refresh"
                size="small"
                outlined
                :loading="isLoadingPrices"
                @click="retryLoadPrices"
            />
        </div>

        <div class="confirmation-layout">
            <div class="confirmation-main-column">
                <!-- Order summary -->
                <div class="mb-6 confirmation-section">
                    <h3 class="text-lg font-medium mb-3 confirmation-section-title">{{ t('reviewOrder.orderItems') }}</h3>
                    <div class="confirmation-card p-4 rounded-xl">
                        <!-- Loading indicator -->
                        <div v-if="isLoadingItems" class="flex justify-center py-8">
                            <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="4" />
                        </div>

                        <!-- Price Loading Progress Bar -->
                        <div v-if="isLoadingPrices && !isLoadingItems" class="mb-4 p-3 confirmation-progress-panel rounded-lg border border-orange-200 dark:border-orange-800">
                            <div class="flex items-center justify-between mb-2">
                                <div class="flex items-center gap-2">
                                    <ProgressSpinner style="width: 16px; height: 16px" strokeWidth="4" />
                                    <span class="text-orange-600 dark:text-orange-400 font-medium text-sm">{{ t('reviewOrder.loadingPricesAndDiscounts') }}</span>
                                </div>
                                <span class="text-orange-600 dark:text-orange-400 text-sm font-semibold">{{ priceLoadProgress }}%</span>
                            </div>
                            <div class="w-full bg-orange-200 dark:bg-orange-800 rounded-full h-2">
                                <div class="bg-orange-500 h-2 rounded-full transition-all duration-300" :style="{ width: priceLoadProgress + '%' }"></div>
                            </div>
                            <div class="text-xs text-orange-500 dark:text-orange-400 mt-1 text-right">{{ t('reviewOrder.loadedCount', { loaded: priceLoadedCount, total: priceTotalCount }) }}</div>
                        </div>

                        <!-- Search Box -->
                        <div v-if="!isLoadingItems && showConfirmationSearch" class="mb-4">
                            <div class="flex items-center gap-2">
                                <div class="relative flex-grow">
                                    <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                                    <input
                                        type="text"
                                        v-model="localSearchInput"
                                        :placeholder="t('reviewOrder.searchPlaceholder')"
                                        :aria-label="t('reviewOrder.searchPlaceholder')"
                                        class="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-white text-sm"
                                        @keydown="handleSearchKeydown"
                                    />
                                    <button v-if="localSearchInput" type="button" :aria-label="t('reviewOrder.clearSearch')" @click="handleClearSearch" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                        <i class="pi pi-times"></i>
                                    </button>
                                </div>
                                <Button icon="pi pi-search" size="small" :aria-label="t('common.search')" @click="handleSearch" />
                            </div>
                            <!-- Search result info -->
                            <div v-if="searchQuery" class="mt-2 p-2 confirmation-search-chip rounded-lg flex items-center justify-between">
                                <span class="text-sm text-blue-700 dark:text-blue-300">
                                    <i class="pi pi-filter mr-2"></i>
                                    {{ t('reviewOrder.searchResult', { query: searchQuery, count: filteredItems.length }) }}
                                </span>
                                <Button :label="t('reviewOrder.clear')" icon="pi pi-times" text size="small" @click="handleClearSearch" />
                            </div>
                        </div>

                        <!-- No search results -->
                        <div v-if="!isLoadingItems && searchQuery && filteredItems.length === 0" class="flex flex-col items-center justify-center py-8 text-center">
                            <i class="pi pi-search text-4xl text-gray-300 dark:text-gray-600 mb-3"></i>
                            <h3 class="text-lg font-medium mb-2">{{ t('reviewOrder.noSearchTitle') }}</h3>
                            <p class="text-gray-500 dark:text-gray-400 mb-3">{{ t('reviewOrder.noSearchHint') }}</p>
                            <Button :label="t('reviewOrder.clearSearch')" icon="pi pi-times" outlined size="small" @click="handleClearSearch" />
                        </div>

                        <!-- Items list -->
                        <template v-if="!isLoadingItems && confirmedItems.length > 0">
                            <div v-for="(item, index) in confirmedItems" :key="item.guid_code || `${item.item_code}-${item.unit_code}`">
                                <div :class="['flex items-center gap-3 confirmation-item-row', index !== confirmedItems.length - 1 ? 'border-b border-gray-200 dark:border-gray-700 pb-3 mb-3' : '']">
                                    <!-- Thumbnail -->
                                    <div class="w-12 h-12 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
                                        <img :src="getProductImage(item)" :alt="getItemDisplayName(item)" class="w-full h-full object-contain" @error="handleImageError" />
                                    </div>

                                    <!-- Details -->
                                    <div class="flex-grow">
                                        <div class="flex items-center gap-2 flex-wrap mb-1">
                                            <div class="font-medium">{{ getItemDisplayName(item) }}</div>
                                            <Tag v-if="isSetItem(item)" :value="t('reviewOrder.setTag')" severity="info" class="text-xs" />
                                            <Button
                                                v-if="isSetItem(item) && cartStore.setItemsCache[item.item_code]?.length > 0"
                                                :icon="isExpanded(item.item_code) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                                                text
                                                rounded
                                                size="small"
                                                :aria-label="isExpanded(item.item_code) ? t('reviewOrder.collapseSetItems') : t('reviewOrder.expandSetItems')"
                                                :aria-expanded="isExpanded(item.item_code)"
                                                @click="toggleSetItems(item.item_code)"
                                                class="p-1"
                                            />
                                        </div>
                                        <div class="confirmation-item-meta">
                                            <span>{{ item.item_code }}</span>
                                            <span class="confirmation-unit-chip">{{ item.unit_code }}</span>
                                        </div>
                                    </div>

                                    <!-- Qty & Price (ใช้ price_confirm โดยตรง) - รองรับ progressive load -->
                                    <div class="text-right min-w-28">
                                        <!-- ยังไม่มี price_confirm และกำลังโหลด หรือราคายังไม่พร้อม -->
                                        <template v-if="isLoadingPrices && !item.price_confirm">
                                            <div class="flex items-center justify-end gap-2">
                                                <ProgressSpinner style="width: 16px; height: 16px" strokeWidth="4" />
                                                <span class="text-orange-500 text-sm font-medium animate-pulse">{{ t('reviewOrder.waiting') }}</span>
                                            </div>
                                            <div class="text-sm text-gray-400">{{ item.qty }} x <span class="inline-block w-12 h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></span></div>
                                        </template>
                                        <!-- ไม่มีราคา valid (item_type != 3 และ price_confirm = 0) -->
                                        <template v-else-if="!hasValidPrice(item)">
                                            <div class="font-medium text-orange-500">{{ t('reviewOrder.waitingPrice') }}</div>
                                            <div class="text-sm text-gray-500">{{ item.qty }} {{ item.unit_code }}</div>
                                        </template>
                                        <!-- มี price_confirm แล้ว (หรือโหลดเสร็จแล้ว) -->
                                        <template v-else>
                                            <div class="font-medium">
                                                <template v-if="hasLineDiscount(item)">
                                                    <div class="font-medium text-green-600">฿{{ formatNumber(getItemLineAmount(item).sum_amount) }}</div>
                                                    <div class="text-sm line-through text-gray-500">฿{{ formatNumber(getItemLineAmount(item).gross) }}</div>
                                                </template>
                                                <template v-else>
                                                    <div class="font-medium">฿{{ formatNumber(getItemLineAmount(item).sum_amount) }}</div>
                                                </template>
                                            </div>
                                            <div class="text-sm text-gray-500">
                                                <template v-if="hasPriceDiscount(item)">
                                                    {{ item.qty }} x
                                                    <span class="text-green-600">฿{{ formatNumber(getItemPrice(item)) }}</span>
                                                    <span class="line-through">฿{{ formatNumber(item.price) }}</span>
                                                </template>
                                                <template v-else> {{ item.qty }} x ฿{{ formatNumber(getItemPrice(item)) }} </template>
                                            </div>
                                            <Tag v-if="getItemDiscount(item) && hasEffectiveDiscount(item)" :value="`${t('reviewOrder.discountPrefix')} ${getItemDiscount(item)}`" severity="success" class="mt-1 text-xs" />
                                        </template>
                                    </div>
                                </div>

                                <!-- รายการสินค้าย่อย (expandable) -->
                                <div v-if="isSetItem(item) && isExpanded(item.item_code)" class="ml-8 mt-2 space-y-2 border-l-2 border-primary-200 pl-4 mb-3">
                                    <div v-for="(setItem, setIndex) in cartStore.setItemsCache[item.item_code]" :key="getSetItemKey(setItem, item, setIndex)" class="flex items-center gap-2 text-sm confirmation-set-row p-2 rounded">
                                        <!-- รูปภาพเล็ก -->
                                        <div class="w-8 h-8 flex-shrink-0">
                                            <img :src="setItem.image" :alt="getItemDisplayName(setItem)" class="w-full h-full object-contain rounded" @error="handleImageError" />
                                        </div>

                                        <!-- รายละเอียด -->
                                        <div class="flex-grow min-w-0">
                                            <div class="font-bold truncate">{{ getItemDisplayName(setItem) }}</div>
                                            <div class="text-gray-500">{{ setItem.item_code }}</div>
                                        </div>

                                        <!-- จำนวน -->
                                        <div class="text-gray-600 flex-shrink-0">
                                            {{ formatSetQuantity(getSetItemDisplayQty(setItem, item)) }} {{ setItem.unit_code }}
                                            <span class="text-gray-400">({{ formatSetQuantity(setItem.qty) }} x {{ formatQuantity(item.qty, 0) }})</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Pagination -->
                            <div v-if="totalPages > 1" class="flex justify-center items-center gap-1 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <!-- First page -->
                                <Button icon="pi pi-angle-double-left" text rounded size="small" :aria-label="t('cartPage.firstPage')" :disabled="currentPage === 1 || isLoadingItems" @click="changePage(1)" class="w-8 h-8" />
                                <!-- Previous page -->
                                <Button icon="pi pi-angle-left" text rounded size="small" :aria-label="t('cartPage.previousPage')" :disabled="currentPage === 1 || isLoadingItems" @click="changePage(currentPage - 1)" class="w-8 h-8" />

                                <!-- Page numbers -->
                                <template v-for="page in paginationPages">
                                    <span v-if="page === '...'" :key="`ellipsis-${page}`" class="px-2 text-gray-400">...</span>
                                    <Button
                                        v-else
                                        :key="`page-${page}`"
                                        :label="String(page)"
                                        :text="page !== currentPage"
                                        :severity="page === currentPage ? 'primary' : 'secondary'"
                                        :aria-label="t('cartPage.pageSummary', { page, total: totalPages })"
                                        :aria-current="page === currentPage ? 'page' : undefined"
                                        rounded
                                        size="small"
                                        :disabled="isLoadingItems"
                                        @click="changePage(page)"
                                        class="w-8 h-8"
                                    />
                                </template>

                                <!-- Next page -->
                                <Button icon="pi pi-angle-right" text rounded size="small" :aria-label="t('cartPage.nextPage')" :disabled="currentPage === totalPages || isLoadingItems" @click="changePage(currentPage + 1)" class="w-8 h-8" />
                                <!-- Last page -->
                                <Button icon="pi pi-angle-double-right" text rounded size="small" :aria-label="t('cartPage.lastPage')" :disabled="currentPage === totalPages || isLoadingItems" @click="changePage(totalPages)" class="w-8 h-8" />

                                <!-- Page info -->
                                <span class="ml-2 text-sm text-gray-500">
                                    {{ t('reviewOrder.pageSummary', { page: currentPage, total: totalPages }) }}
                                    <span v-if="searchQuery">{{ t('reviewOrder.filteredSummary', { filtered: filteredItems.length, total: allConfirmedItems.length }) }}</span>
                                </span>
                            </div>
                        </template>

                        <!-- Totals (คำนวณจาก allConfirmedItems - ยอดรวมทั้งหมดไม่เปลี่ยนตามการค้นหา) -->
                        <div class="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 confirmation-total-box">
                            <div class="flex justify-between items-center mb-1">
                                <span class="text-gray-600 dark:text-gray-400">{{ t('reviewOrder.itemSummaryLabel') }}</span>
                                <span v-if="isLoadingItems"><ProgressSpinner style="width: 16px; height: 16px" strokeWidth="4" /></span>
                                <span v-else>
                                    {{ t('reviewOrder.summaryLine', { items: finalSummary.total_items, qty: finalSummary.total_qty }) }}
                                    <span v-if="searchQuery" class="text-blue-500 text-sm">{{ t('reviewOrder.showingFiltered', { count: filteredItems.length }) }}</span>
                                </span>
                            </div>
                            <div class="flex justify-between items-center text-lg font-bold">
                                <span>{{ t('reviewOrder.grandTotal') }}</span>
                                <span v-if="isLoadingItems || isLoadingPrices" class="flex items-center gap-2">
                                    <ProgressSpinner style="width: 20px; height: 20px" strokeWidth="4" />
                                    <span class="text-sm text-orange-500 font-normal">{{ t('reviewOrder.calculatingDots') }}</span>
                                </span>
                                <span v-else class="text-primary">฿{{ formatNumber(taxSummary.totalAmount) }}</span>
                            </div>

                            <div v-if="hasPreorderBlockedItems" class="confirmation-preorder-note confirmation-preorder-note--blocked">
                                <i class="pi pi-exclamation-triangle"></i>
                                <span>
                                    <strong>{{ preorderBlockMessage }}</strong>
                                    <small>{{ t('reviewOrder.preorderBlockedFixHint') }}</small>
                                    <ul class="confirmation-preorder-block-list">
                                        <li v-for="item in preorderBlockedItemDetails" :key="item.key">
                                            <span>{{ item.name }}</span>
                                            <em>{{ t('reviewOrder.preorderBlockedItemLine', { qty: item.qty, stock: item.stock, shortage: item.shortage, unit: item.unit }) }}</em>
                                        </li>
                                    </ul>
                                    <small v-if="preorderBlockedMoreCount > 0">{{ t('reviewOrder.preorderBlockedMore', { count: preorderBlockedMoreCount }) }}</small>
                                </span>
                            </div>
                            <div v-else-if="preorderCheckoutSplit.hasPreorderItems" class="confirmation-preorder-note">
                                <i class="pi pi-clock"></i>
                                <span>
                                    <strong>{{ preorderDocumentMessage }}</strong>
                                    <small>{{ preorderQuantitySummary }}</small>
                                </span>
                            </div>

                            <div v-if="preorderDocumentTotals.length" class="confirmation-document-totals">
                                <div v-for="docTotal in preorderDocumentTotals" :key="docTotal.key" class="confirmation-document-total-row" :class="`is-${docTotal.key}`">
                                    <span>
                                        <strong>{{ docTotal.label }}</strong>
                                        <small>{{ t('reviewOrder.summaryLine', { items: docTotal.summary.itemCount, qty: docTotal.summary.totalQty }) }}</small>
                                    </span>
                                    <em>฿{{ formatNumber(docTotal.summary.totalAmount) }}</em>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="confirmation-side-column">
                <!-- Customer/Employee information -->
                <div class="mb-6 confirmation-section">
                    <h3 class="text-lg font-medium mb-3 confirmation-section-title">{{ t('reviewOrder.orderInfo') }}</h3>

                    <!-- Customer form -->
                    <div v-if="userType === 'customer'" class="confirmation-card confirmation-form-card p-4 rounded-xl">
                        <!-- Delivery method selection -->
                        <div class="mb-4">
                            <label class="block font-medium mb-2">{{ t('reviewOrder.pickupMethod') }}</label>
                            <div class="flex gap-2">
                                <button
                                    type="button"
                                    :aria-pressed="formData.deliveryMethod === 'pickup'"
                                    :class="['flex items-center p-3 border rounded-lg cursor-pointer flex-1 text-left transition-colors', formData.deliveryMethod === 'pickup' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900' : 'border-gray-200 dark:border-gray-700']"
                                    @click="formData.deliveryMethod = 'pickup'"
                                >
                                    <i class="pi pi-user mr-2 text-primary-500"></i>
                                    <span>{{ t('reviewOrder.pickup') }}</span>
                                </button>
                                <button
                                    type="button"
                                    :aria-pressed="formData.deliveryMethod === 'delivery'"
                                    :class="['flex items-center p-3 border rounded-lg cursor-pointer flex-1 text-left transition-colors', formData.deliveryMethod === 'delivery' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900' : 'border-gray-200 dark:border-gray-700']"
                                    @click="formData.deliveryMethod = 'delivery'"
                                >
                                    <i class="pi pi-truck mr-2 text-primary-500"></i>
                                    <span>{{ t('reviewOrder.delivery') }}</span>
                                </button>
                            </div>
                        </div>

                        <!-- Employee code เปลี่ยนเป็นแบบ Select -->
                        <div class="mb-4">
                            <label for="employee-code" class="block font-medium mb-2">{{ t('reviewOrder.employeeOptional') }}</label>
                            <div v-if="isSearchingEmployee && employeeOptions.length === 0" class="flex justify-center py-2">
                                <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
                            </div>
                            <Select
                                v-model="selectedEmployee"
                                :options="employeeOptions"
                                optionLabel="name"
                                :placeholder="t('reviewOrder.selectEmployee')"
                                class="w-full"
                                :loading="isSearchingEmployee"
                                filter
                                :aria-label="t('reviewOrder.employeeOptional')"
                                @filter="filterEmployees"
                                :filterPlaceholder="t('reviewOrder.employeeSearchPlaceholder')"
                                :virtualScrollerOptions="{ itemSize: 48, lazy: true, delay: 250 }"
                                :showClear="true"
                                @change="onEmployeeSelect($event.value)"
                            >
                                <template #value="slotProps">
                                    <div v-if="slotProps.value" class="flex items-center">
                                        <i class="pi pi-user mr-2 text-primary"></i>
                                        <div>{{ slotProps.value.name || '' }}</div>
                                    </div>
                                    <span v-else>
                                        {{ slotProps.placeholder }}
                                    </span>
                                </template>
                                <template #option="slotProps">
                                    <div class="flex align-items-center w-full" v-if="slotProps && slotProps.option">
                                        <div>{{ slotProps.option.name || '' }}</div>
                                    </div>
                                </template>
                            </Select>
                            <small class="text-color-secondary">{{ t('reviewOrder.searchHint') }}</small>
                        </div>


                        <!-- ข้อมูลการเข้ารับสินค้า (รีวิว 260908 สไลด์ 6) -->
                        <div v-if="formData.deliveryMethod === 'pickup'" class="mb-4">
                            <label class="block font-medium mb-2">{{ t('reviewOrder.pickupDetails') }}</label>
                            <div class="confirmation-subcard p-4 rounded-lg space-y-3">
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label :for="'pickup-date-cus'" class="block text-sm font-medium mb-1">{{ t('reviewOrder.pickupDate') }} <span class="text-red-500">*</span></label>
                                        <DatePicker
                                            :inputId="'pickup-date-cus'"
                                            v-model="pickupDate"
                                            dateFormat="dd/mm/yy"
                                            :minDate="pickupDateRange.min"
                                            :maxDate="pickupDateRange.max"
                                            class="w-full"
                                        />
                                        <small class="text-color-secondary">{{ t('reviewOrder.pickupDateHint') }}</small>
                                    </div>
                                    <div>
                                        <label :for="'pickup-slot-cus'" class="block text-sm font-medium mb-1">{{ t('reviewOrder.pickupTimeSlot') }} <span class="text-red-500">*</span></label>
                                        <Select
                                            :inputId="'pickup-slot-cus'"
                                            v-model="pickupTimeSlot"
                                            :options="pickupSlots"
                                            optionLabel="label"
                                            optionValue="value"
                                            :placeholder="t('reviewOrder.pickupTimeSlotPlaceholder')"
                                            :disabled="pickupSlots.length === 0"
                                            class="w-full"
                                        />
                                        <small v-if="pickupSlots.length === 0" class="text-red-500">{{ t('reviewOrder.pickupTimeSlotEmpty') }}</small>
                                        <small v-else class="text-color-secondary">{{ t('reviewOrder.pickupTimeSlotHint') }}</small>
                                    </div>
                                </div>

                                <div>
                                    <label :for="'pickup-receiver-cus'" class="block text-sm font-medium mb-1">{{ t('reviewOrder.pickupReceiver') }} <span class="text-red-500">*</span></label>
                                    <InputText :id="'pickup-receiver-cus'" v-model="pickupReceiver" class="w-full" :placeholder="t('reviewOrder.pickupReceiverPlaceholder')" />
                                </div>

                                <div>
                                    <label :for="'pickup-vehicle-cus'" class="block text-sm font-medium mb-1">{{ t('reviewOrder.pickupVehicle') }} <span class="text-red-500">*</span></label>
                                    <InputText :id="'pickup-vehicle-cus'" v-model="pickupVehicle" class="w-full" :placeholder="t('reviewOrder.pickupVehiclePlaceholder')" />
                                </div>
                            </div>

                            <!-- บอกช่องที่ยังไม่ได้กรอกตรงนี้ ไม่ใช่ล่างสุดของหน้า -->
                            <Message v-if="pickupBlockMessage" severity="warn" :closable="false" class="mt-2">{{ pickupBlockMessage }}</Message>
                        </div>

                        <DeliveryAddressForm v-if="formData.deliveryMethod === 'delivery'"
                            :custom-address="customAddress" :custom-telephone="customTelephone"
                            :send-date="sendDate" :send-days="sendDay" :min-date="tomorrow" date-input-id="send-date-customer"
                            :loading="deliveryAddressLoading" :load-error="deliveryAddressLoadError" :issue="checkoutFormIssue"
                            @update:send-date="sendDate = $event" @set-address="shipping.setAddress" @set-telephone="shipping.setTelephone" @retry="shipping.refresh" />

                        <!-- ข้อมูลเครดิต -->
                        <div class="mb-4" v-if="isLoadingCreditData || creditData.credit_day">
                            <label class="block font-medium mb-2">{{ t('reviewOrder.creditInfo') }}</label>
                            <div class="confirmation-subcard p-4 rounded-lg">
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label class="block text-sm font-medium mb-1">{{ t('reviewOrder.creditDays') }}</label>
                                        <div v-if="isLoadingCreditData" class="flex justify-center py-2">
                                            <ProgressSpinner style="width: 20px; height: 20px" strokeWidth="4" />
                                        </div>
                                        <InputText v-else :value="creditData.credit_day ? creditData.credit_day + ' ' + t('reviewOrder.daySuffix') : '-'" readonly class="w-full" :aria-label="t('reviewOrder.creditDays')" />
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium mb-1">{{ t('reviewOrder.creditDate') }}</label>
                                        <div v-if="isLoadingCreditData" class="flex justify-center py-2">
                                            <ProgressSpinner style="width: 20px; height: 20px" strokeWidth="4" />
                                        </div>
                                        <InputText v-else :value="formatDisplayDate(creditData.credit_date)" readonly class="w-full" :aria-label="t('reviewOrder.creditDate')" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Advance Payment Selection -->
                        <div class="mb-4" v-if="advancePayments.length > 0" >
                            <label class="block font-medium mb-2">{{ t('reviewOrder.advancePayment') }}</label>
                            <div v-if="isLoadingAdvancePayments" class="flex justify-center py-2">
                                <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
                            </div>
                            <MultiSelect v-model="selectedAdvancePayments" :options="advancePayments" optionLabel="docno" :placeholder="t('reviewOrder.selectAdvancePayment')" :aria-label="t('reviewOrder.advancePayment')" class="w-full" display="chip" :disabled="isLoadingAdvancePayments || advancePayments.length === 0">
                                <template #option="slotProps">
                                    <div>{{ slotProps.option.docno }} - ฿{{ formatNumber(slotProps.option.balance_amount) }}</div>
                                </template>
                                <template #chip="slotProps">
                                    <div>{{ slotProps.value.docno }} (฿{{ formatNumber(slotProps.value.balance_amount) }})</div>
                                </template>
                            </MultiSelect>
                            <small v-if="advancePayments.length === 0 && !isLoadingAdvancePayments" class="text-gray-500 dark:text-gray-400">{{ t('reviewOrder.noAdvancePayment') }}</small>
                            <small v-else class="text-gray-500 dark:text-gray-400">{{ t('reviewOrder.advancePaymentHint') }}</small>
                        </div>

                        <div class="mb-4 mt-4">
                            <label for="order-remark" class="block font-medium mb-2">{{ t('reviewOrder.remark') }}</label>
                            <Textarea id="order-remark" v-model="formData.remark" rows="2" class="w-full" placeholder="" @input="updateOriginalRemark" />
                        </div>
                    </div>

                    <!-- Employee form -->
                    <div v-else-if="userType === 'employee'" class="confirmation-card confirmation-form-card p-4 rounded-xl">
                        <!-- รหัสลูกค้าอยู่บนสุด (รีวิว 260908 สไลด์ 6) -->
                        <div class="mb-4">
                            <label for="customer-code" class="block font-medium mb-2">{{ t('reviewOrder.customerCode') }} <span class="text-red-500">*</span></label>
                            <div v-if="isSearchingCustomer && customerOptions.length === 0" class="flex justify-center py-2">
                                <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
                            </div>
                            <Message severity="info" icon="pi pi-user">{{ selectedCustomerCode }}</Message>
                        </div>

                        <!-- Delivery method selection -->
                        <div class="mb-4">
                            <label class="block font-medium mb-2">{{ t('reviewOrder.pickupMethodEmployee') }}</label>
                            <div class="flex gap-2">
                                <button
                                    type="button"
                                    :aria-pressed="formData.deliveryMethod === 'pickup'"
                                    :class="['flex items-center p-3 border rounded-lg cursor-pointer flex-1 text-left transition-colors', formData.deliveryMethod === 'pickup' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900' : 'border-gray-200 dark:border-gray-700']"
                                    @click="formData.deliveryMethod = 'pickup'"
                                >
                                    <i class="pi pi-shopping-bag mr-2 text-primary-500"></i>
                                    <span>{{ t('reviewOrder.pickup') }}</span>
                                </button>
                                <button
                                    type="button"
                                    :aria-pressed="formData.deliveryMethod === 'delivery'"
                                    :class="['flex items-center p-3 border rounded-lg cursor-pointer flex-1 text-left transition-colors', formData.deliveryMethod === 'delivery' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900' : 'border-gray-200 dark:border-gray-700']"
                                    @click="formData.deliveryMethod = 'delivery'"
                                >
                                    <i class="pi pi-truck mr-2 text-primary-500"></i>
                                    <span>{{ t('reviewOrder.delivery') }}</span>
                                </button>
                            </div>
                        </div>
                        <!-- ข้อมูลการเข้ารับสินค้า (รีวิว 260908 สไลด์ 6) -->
                        <div v-if="formData.deliveryMethod === 'pickup'" class="mb-4">
                            <label class="block font-medium mb-2">{{ t('reviewOrder.pickupDetails') }}</label>
                            <div class="confirmation-subcard p-4 rounded-lg space-y-3">
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label :for="'pickup-date-emp'" class="block text-sm font-medium mb-1">{{ t('reviewOrder.pickupDate') }} <span class="text-red-500">*</span></label>
                                        <DatePicker
                                            :inputId="'pickup-date-emp'"
                                            v-model="pickupDate"
                                            dateFormat="dd/mm/yy"
                                            :minDate="pickupDateRange.min"
                                            :maxDate="pickupDateRange.max"
                                            class="w-full"
                                        />
                                        <small class="text-color-secondary">{{ t('reviewOrder.pickupDateHint') }}</small>
                                    </div>
                                    <div>
                                        <label :for="'pickup-slot-emp'" class="block text-sm font-medium mb-1">{{ t('reviewOrder.pickupTimeSlot') }} <span class="text-red-500">*</span></label>
                                        <Select
                                            :inputId="'pickup-slot-emp'"
                                            v-model="pickupTimeSlot"
                                            :options="pickupSlots"
                                            optionLabel="label"
                                            optionValue="value"
                                            :placeholder="t('reviewOrder.pickupTimeSlotPlaceholder')"
                                            :disabled="pickupSlots.length === 0"
                                            class="w-full"
                                        />
                                        <small v-if="pickupSlots.length === 0" class="text-red-500">{{ t('reviewOrder.pickupTimeSlotEmpty') }}</small>
                                        <small v-else class="text-color-secondary">{{ t('reviewOrder.pickupTimeSlotHint') }}</small>
                                    </div>
                                </div>

                                <div>
                                    <label :for="'pickup-receiver-emp'" class="block text-sm font-medium mb-1">{{ t('reviewOrder.pickupReceiver') }} <span class="text-red-500">*</span></label>
                                    <InputText :id="'pickup-receiver-emp'" v-model="pickupReceiver" class="w-full" :placeholder="t('reviewOrder.pickupReceiverPlaceholder')" />
                                </div>

                                <div>
                                    <label :for="'pickup-vehicle-emp'" class="block text-sm font-medium mb-1">{{ t('reviewOrder.pickupVehicle') }} <span class="text-red-500">*</span></label>
                                    <InputText :id="'pickup-vehicle-emp'" v-model="pickupVehicle" class="w-full" :placeholder="t('reviewOrder.pickupVehiclePlaceholder')" />
                                </div>
                            </div>

                            <!-- บอกช่องที่ยังไม่ได้กรอกตรงนี้ ไม่ใช่ล่างสุดของหน้า -->
                            <Message v-if="pickupBlockMessage" severity="warn" :closable="false" class="mt-2">{{ pickupBlockMessage }}</Message>
                        </div>

                        <!-- <Select
                        v-model="selectedCustomer"
                        :options="customerOptions"
                        optionLabel="name"
                        :placeholder="t('reviewOrder.selectCustomer')"
                        class="w-full"
                        :loading="isSearchingCustomer"
                        filter
                        @filter="filterCustomers"
                        :filterPlaceholder="t('reviewOrder.customerSearchPlaceholder')"
                        :virtualScrollerOptions="{ itemSize: 48, lazy: true, delay: 250 }"
                        :showClear="true"
                        @change="onCustomerSelect($event.value)"
                    >
                        <template #value="slotProps">
                            <div v-if="slotProps.value" class="flex items-center">
                                <i class="pi pi-user mr-2 text-primary"></i>
                                <div>{{ slotProps.value.code ? slotProps.value.code : '' }} {{ slotProps.value.name ? slotProps.value.name : '' }}</div>
                            </div>
                            <span v-else>
                                {{ slotProps.placeholder }}
                            </span>
                        </template>
                        <template #option="slotProps">
                            <div class="flex flex-column w-full" v-if="slotProps && slotProps.option">
                                <div class="font-bold">{{ slotProps.option.code }}</div>
                                <div>{{ slotProps.option.name }}</div>
                            </div>
                        </template>
                    </Select>
                    <small class="text-color-secondary">{{ t('reviewOrder.searchHint') }}</small> -->

                        <DeliveryAddressForm v-if="formData.deliveryMethod === 'delivery'"
                            :custom-address="customAddress" :custom-telephone="customTelephone"
                            :send-date="sendDate" :send-days="sendDay" :min-date="tomorrow" date-input-id="send-date-employee"
                            :loading="deliveryAddressLoading" :load-error="deliveryAddressLoadError" :issue="checkoutFormIssue"
                            @update:send-date="sendDate = $event" @set-address="shipping.setAddress" @set-telephone="shipping.setTelephone" @retry="shipping.refresh" />

                        <!-- ข้อมูลเครดิต (employee) -->
                        <div class="mb-4" v-if="isLoadingCreditData || creditData.credit_day">
                            <label class="block font-medium mb-2">{{ t('reviewOrder.creditInfo') }}</label>
                            <div class="confirmation-subcard p-4 rounded-lg">
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label class="block text-sm font-medium mb-1">{{ t('reviewOrder.creditDays') }}</label>
                                        <div v-if="isLoadingCreditData" class="flex justify-center py-2">
                                            <ProgressSpinner style="width: 20px; height: 20px" strokeWidth="4" />
                                        </div>
                                        <InputText v-else :value="creditData.credit_day ? creditData.credit_day + ' ' + t('reviewOrder.daySuffix') : '-'" readonly class="w-full" :aria-label="t('reviewOrder.creditDays')" />
                                    </div>
                                    <div>
                                        <label class="block text-sm font-medium mb-1">{{ t('reviewOrder.creditDate') }}</label>
                                        <div v-if="isLoadingCreditData" class="flex justify-center py-2">
                                            <ProgressSpinner style="width: 20px; height: 20px" strokeWidth="4" />
                                        </div>
                                        <InputText v-else :value="formatDisplayDate(creditData.credit_date)" readonly class="w-full" :aria-label="t('reviewOrder.creditDate')" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Advance Payment Selection (employee) -->
                        <div class="mb-4" v-if="advancePayments.length > 0">
                            <label class="block font-medium mb-2">{{ t('reviewOrder.advancePayment') }}</label>
                            <div v-if="isLoadingAdvancePayments" class="flex justify-center py-2">
                                <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
                            </div>
                            <MultiSelect v-model="selectedAdvancePayments" :options="advancePayments" optionLabel="docno" :placeholder="t('reviewOrder.selectAdvancePayment')" :aria-label="t('reviewOrder.advancePayment')" class="w-full" display="chip" :disabled="isLoadingAdvancePayments || advancePayments.length === 0">
                                <template #option="slotProps">
                                    <div>{{ slotProps.option.docno }} - ฿{{ formatNumber(slotProps.option.balance_amount) }}</div>
                                </template>
                                <template #chip="slotProps">
                                    <div>{{ slotProps.value.docno }} (฿{{ formatNumber(slotProps.value.balance_amount) }})</div>
                                </template>
                            </MultiSelect>
                            <small v-if="advancePayments.length === 0 && !isLoadingAdvancePayments" class="text-gray-500 dark:text-gray-400">{{ t('reviewOrder.noAdvancePayment') }}</small>
                            <small v-else class="text-gray-500 dark:text-gray-400">{{ t('reviewOrder.advancePaymentHint') }}</small>
                        </div>

                        <div class="mb-4 mt-4">
                            <label for="order-remark-emp" class="block font-medium mb-2">{{ t('reviewOrder.remark') }}</label>
                            <Textarea id="order-remark-emp" v-model="formData.remark" rows="2" class="w-full" placeholder="" @input="updateOriginalRemark" />
                        </div>
                    </div>
                </div>

                <div class="confirmation-card confirmation-review-card p-4 rounded-xl mb-6">
                    <div class="confirmation-review-header">
                        <div>
                            <p>{{ t('reviewOrder.finalKicker') }}</p>
                            <h3>{{ t('reviewOrder.finalCheck') }}</h3>
                        </div>
                        <Tag v-if="canSubmitOrder" :value="t('reviewOrder.readyToConfirm')" severity="success" />
                        <Tag v-else :value="t('reviewOrder.waitingReview')" severity="warning" />
                    </div>

                    <div class="confirmation-review-total">
                        <span>{{ t('reviewOrder.netTotal') }}</span>
                        <strong v-if="pricesReady">฿{{ formatNumber(taxSummary.totalAmount) }}</strong>
                        <strong v-else>{{ t('reviewOrder.calculating') }}</strong>
                    </div>

                    <div class="confirmation-review-grid">
                        <div>
                            <span>{{ t('reviewOrder.customer') }}</span>
                            <strong>{{ selectedCustomerDisplay }}</strong>
                        </div>
                        <div>
                            <span>{{ t('reviewOrder.deliveryMethod') }}</span>
                            <strong>{{ deliveryMethodLabel }}</strong>
                        </div>
                        <div>
                            <span>{{ t('reviewOrder.contactPhone') }}</span>
                            <strong>{{ deliveryContactDisplay }}</strong>
                        </div>
                        <div>
                            <span>{{ t('reviewOrder.deliveryDateSummary') }}</span>
                            <strong v-if="formData.deliveryMethod === 'delivery'">{{ formatDisplayDate(sendDate) }}</strong>
                            <strong v-else-if="pickupDate">{{ formatDisplayDate(pickupDate) }} {{ pickupTimeSlot }}</strong>
                            <strong v-else>-</strong>
                        </div>
                    </div>

                    <div class="confirmation-review-address">
                        <span>{{ t('reviewOrder.addressOrPickup') }}</span>
                        <p>{{ deliveryAddressDisplay }}</p>
                    </div>

                    <div class="confirmation-readiness-list">
                        <div v-for="check in readinessChecks" :key="check.label" class="confirmation-readiness-row" :class="{ ready: check.ready }">
                            <i :class="['pi', check.ready ? 'pi-check-circle' : 'pi-exclamation-circle']"></i>
                            <div>
                                <strong>{{ check.label }}</strong>
                                <span>{{ check.detail }}</span>
                            </div>
                        </div>
                    </div>

                    <div class="confirmation-review-actions">
                        <Button :label="t('reviewOrder.back')" icon="pi pi-arrow-left" outlined severity="secondary" class="conf-back-btn" :disabled="isProcessingOrder" @click="emit('prev-step')" />
                        <Button
                            :label="submitButtonLabel"
                            :icon="!canSubmitOrder ? 'pi pi-lock' : 'pi pi-check-circle'"
                            iconPos="right"
                            :severity="!canSubmitOrder ? 'warning' : undefined"
                            @click="handleCheckout"
                            :loading="isProcessingOrder || isLoadingPrices"
                            :disabled="isProcessingOrder || !canSubmitOrder || (userType === 'employee' && !formData.customerCode)"
                            class="conf-submit-btn confirmation-review-submit"
                        />
                    </div>
                </div>

                <!-- Error message -->
                <Message v-if="errorMessage" severity="error" :closable="false" class="mb-4 confirmation-error-message">
                    <div class="confirmation-error-content">
                        <strong>{{ errorMessageLines[0] || errorMessage }}</strong>
                        <ul v-if="errorMessageLines.length > 1">
                            <li v-for="(line, index) in errorMessageLines.slice(1)" :key="`${index}-${line}`">{{ line }}</li>
                        </ul>
                        <Button v-if="showCheckoutErrorFixButton" :label="t('reviewOrder.back')" icon="pi pi-arrow-left" size="small" outlined severity="danger" class="confirmation-error-action" :disabled="isProcessingOrder" @click="emit('prev-step')" />
                    </div>
                </Message>
            </div>
        </div>

        <!-- Warning: blocked confirmation -->
        <Message v-if="checkoutBlockMessage && checkoutBlockMessage !== pickupBlockMessage" :severity="priceLoadError ? 'error' : 'warn'" :closable="false" class="mt-4">
            {{ checkoutBlockMessage }}
            <Button v-if="priceLoadError || hasMissingPrice" :label="t('reviewOrder.reloadPrice')" icon="pi pi-refresh" size="small" text class="ml-2" :loading="isLoadingPrices" @click="retryLoadPrices" />
        </Message>

        <!-- Action buttons -->
        <div class="confirmation-actions flex justify-between items-center mt-6">
            <Button :label="t('reviewOrder.back')" icon="pi pi-arrow-left" text :disabled="isProcessingOrder" @click="emit('prev-step')" class="conf-back-btn" />
            <div class="confirmation-action-summary">
                <span>{{ t('reviewOrder.itemCount', { count: finalSummary.total_items }) }} · {{ t('reviewOrder.pieceCount', { count: finalSummary.total_qty }) }}</span>
                <strong v-if="pricesReady">฿{{ formatNumber(taxSummary.totalAmount) }}</strong>
                <strong v-else>{{ t('reviewOrder.calculating') }}</strong>
                <small v-if="checkoutBlockMessage && checkoutBlockMessage !== pickupBlockMessage">{{ checkoutBlockMessage }}</small>
            </div>
            <Button
                :label="submitButtonLabel"
                :icon="!canSubmitOrder ? 'pi pi-lock' : 'pi pi-check-circle'"
                iconPos="right"
                :severity="!canSubmitOrder ? 'warning' : undefined"
                @click="handleCheckout"
                :loading="isProcessingOrder || isLoadingPrices"
                :disabled="isProcessingOrder || !canSubmitOrder || (userType === 'employee' && !formData.customerCode)"
                class="conf-submit-btn"
            />
        </div>

        <!-- Terms and Conditions Dialog -->
        <Dialog :visible="termsDialog" @update:visible="termsDialog = $event" modal :header="t('reviewOrder.termsTitle')" :style="{ width: '90%', maxWidth: '500px' }" :draggable="false" :closeOnEscape="false" :closable="false">
            <div class="p-2">
                <div class="mb-5 text-gray-700">
                    <ol class="list-decimal pl-5 space-y-3">
                        <li>{{ t('reviewOrder.termsPreliminaryOrder') }}</li>
                    </ol>
                </div>

                <div class="flex items-start mb-5">
                    <Checkbox v-model="termsAccepted" :binary="true" inputId="terms" />
                    <label for="terms" class="ml-2 text-gray-700 cursor-pointer leading-relaxed">{{ t('reviewOrder.termsAcceptedLabel') }}</label>
                </div>
            </div>

            <template #footer>
                <div class="flex justify-end">
                    <Button :label="t('common.cancel')" icon="pi pi-times" outlined :disabled="isProcessingOrder" @click="cancelCheckout()" class="mr-2" />
                    <Button :label="isProcessingOrder ? t('reviewOrder.submitProcessing') : t('common.confirm')" icon="pi pi-check" :loading="isProcessingOrder" @click="confirmCheckout()" :disabled="isProcessingOrder || !termsAccepted" />
                </div>
            </template>
        </Dialog>

        <!-- Order Processing Dialog -->
        <Dialog :visible="isOrderProcessing" @update:visible="isOrderProcessing = $event" modal :closable="false" :closeOnEscape="false" :style="{ width: '90%', maxWidth: '400px' }" :showHeader="false">
            <div class="flex flex-col items-center justify-center py-8">
                <ProgressSpinner style="width: 60px; height: 60px" strokeWidth="4" class="mb-4" />
                <h3 class="text-xl font-semibold text-primary mb-2">{{ t('reviewOrder.processingTitle') }}</h3>
                <p class="text-gray-600 text-center">{{ t('reviewOrder.pleaseWait') }}</p>
                <p class="text-gray-400 text-sm mt-2">{{ t('reviewOrder.doNotClose') }}</p>
            </div>
        </Dialog>

        <!-- Price Load Error Dialog -->
        <Dialog :visible="showPriceErrorDialog" @update:visible="showPriceErrorDialog = $event" modal :header="t('reviewOrder.priceErrorTitle')" :style="{ width: '90%', maxWidth: '450px' }" :draggable="false">
            <div class="flex flex-col items-center text-center py-4">
                <i class="pi pi-exclamation-triangle text-5xl text-orange-500 mb-4"></i>
                <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">{{ t('reviewOrder.priceErrorHeading') }}</h3>
                <p class="text-gray-600 dark:text-gray-400 mb-4">{{ t('reviewOrder.priceErrorHint') }}</p>
                <p class="text-sm text-gray-500 dark:text-gray-500">{{ t('reviewOrder.priceErrorContact') }}</p>
            </div>
            <template #footer>
                <div class="flex justify-center gap-2">
                    <Button
                        :label="t('reviewOrder.reloadPrice')"
                        icon="pi pi-refresh"
                        :loading="isLoadingPrices"
                        @click="retryLoadPrices"
                    />
                    <Button
                        :label="t('reviewOrder.backToCart')"
                        icon="pi pi-arrow-left"
                        outlined
                        @click="
                            showPriceErrorDialog = false;
                            emit('prev-step');
                        "
                    />
                </div>
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
.confirmation-shell {
    background: linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #fdf9f1) 100%);
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1.4rem;
    padding: 1.15rem;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.confirmation-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    background: linear-gradient(135deg, var(--market-surface-soft, #fff7e7) 0%, var(--market-card-bg, #f7ecd2) 100%);
    color: var(--market-text, #5b4a27);
    border: 1px solid var(--market-card-border, #ead9b5);
    border-radius: 1.15rem;
    padding: 1rem 1.1rem;
    box-shadow: 0 14px 26px var(--market-shadow, rgba(140, 111, 53, 0.1));
}

.confirmation-kicker {
    margin: 0 0 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--market-primary, #b28b46);
}

.confirmation-title {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--market-text, #5b4a27);
}

.confirmation-head-metrics {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
}

.confirmation-state-chip {
    min-width: 7.5rem;
    padding: 0.7rem 0.9rem;
    border-radius: 0.95rem;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 82%, transparent);
    border: 1px solid var(--market-card-border, #ead9b5);
    display: grid;
    gap: 0.15rem;
}

.confirmation-state-chip span {
    font-size: 0.72rem;
    color: var(--market-muted, #9b8a67);
}

.confirmation-state-chip strong {
    color: var(--market-text, #5b4a27);
}

.confirmation-state-chip small {
    font-size: 0.7rem;
    color: var(--market-primary, #b28b46);
    line-height: 1.15;
}

.confirmation-loading-total {
    font-size: 0.9rem;
    color: #b7791f !important;
}

.confirmation-price-status {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.9rem;
    margin: -0.25rem 0 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--market-card-border, #ead9b5);
    border-radius: 1rem;
    background: var(--market-card-bg, #fffdf8);
    box-shadow: 0 8px 18px var(--market-shadow, rgba(140, 111, 53, 0.07));
}

.confirmation-price-status-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.3rem;
    height: 2.3rem;
    border-radius: 999px;
    background: var(--market-surface-soft, #fff7e7);
    color: var(--market-primary, #b28b46);
}

.confirmation-price-status-body {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
}

.confirmation-price-status-body strong {
    color: var(--market-text, #4a3300);
    font-size: 0.95rem;
}

.confirmation-preorder-note {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin-top: 0.75rem;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 0.85rem;
    font-weight: 800;
    line-height: 1.35;
    padding: 0.75rem;
}

.confirmation-preorder-note span {
    display: grid;
    gap: 0.2rem;
}

.confirmation-preorder-note small {
    color: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    opacity: 0.82;
}

.confirmation-preorder-note--blocked {
    border-color: #fed7aa;
    background: #fff7ed;
    color: #9a3412;
}

.confirmation-document-totals {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.75rem;
}

.confirmation-document-total-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border: 1px solid #dbeafe;
    border-radius: 10px;
    background: #f8fbff;
    padding: 0.75rem;
}

.confirmation-document-total-row span {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
}

.confirmation-document-total-row strong {
    color: #1e3a8a;
    font-size: 0.9rem;
    font-weight: 900;
}

.confirmation-document-total-row small {
    color: #64748b;
    font-size: 0.78rem;
    font-weight: 700;
}

.confirmation-document-total-row em {
    color: var(--market-primary, var(--primary-color));
    font-size: 1rem;
    font-style: normal;
    font-weight: 900;
    white-space: nowrap;
}

.confirmation-document-total-row.is-preorder {
    border-color: #fed7aa;
    background: #fff7ed;
}

.confirmation-document-total-row.is-preorder strong {
    color: #9a3412;
}

.confirmation-preorder-block-list {
    display: grid;
    gap: 0.35rem;
    margin: 0.35rem 0 0;
    padding: 0;
    list-style: none;
}

.confirmation-preorder-block-list li {
    display: grid;
    gap: 0.12rem;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.58);
    padding: 0.45rem 0.55rem;
}

.confirmation-preorder-block-list span {
    overflow-wrap: anywhere;
    font-weight: 800;
}

.confirmation-preorder-block-list em {
    font-size: 0.76rem;
    font-style: normal;
    font-weight: 700;
    opacity: 0.86;
}

.confirmation-error-content {
    display: grid;
    gap: 0.65rem;
    min-width: 0;
    line-height: 1.45;
}

.confirmation-error-content strong {
    overflow-wrap: anywhere;
}

.confirmation-error-content ul {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
}

.confirmation-error-content li {
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.62);
    padding: 0.5rem 0.6rem;
    overflow-wrap: anywhere;
}

.confirmation-error-action {
    justify-self: flex-start;
}

.confirmation-price-status-body span {
    color: var(--market-muted, #8a7650);
    font-size: 0.82rem;
}

.confirmation-price-status-progress {
    height: 0.4rem;
    margin-top: 0.35rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--market-card-border, #ead9b5) 70%, #fff);
}

.confirmation-price-status-progress div {
    height: 100%;
    border-radius: inherit;
    background: var(--market-primary, #b28b46);
    transition: width 0.25s ease;
}

.confirmation-price-status--ready {
    border-color: color-mix(in srgb, #16a34a 35%, var(--market-card-border, #ead9b5));
    background: color-mix(in srgb, #16a34a 8%, var(--market-card-bg, #fffdf8));
}

.confirmation-price-status--ready .confirmation-price-status-icon {
    background: #dcfce7;
    color: #15803d;
}

.confirmation-price-status--warn {
    border-color: #fbbf24;
    background: #fffbeb;
}

.confirmation-price-status--warn .confirmation-price-status-icon,
.confirmation-price-status--loading .confirmation-price-status-icon {
    background: #fef3c7;
    color: #b45309;
}

.confirmation-price-status--error {
    border-color: #fecaca;
    background: #fff7f7;
}

.confirmation-price-status--error .confirmation-price-status-icon {
    background: #fee2e2;
    color: #b91c1c;
}

.confirmation-section-title {
    color: var(--market-text, #6b5428);
}

.confirmation-layout {
    display: grid;
    gap: 1.25rem;
}

.confirmation-main-column,
.confirmation-side-column {
    min-width: 0;
}

.confirmation-side-column {
    display: grid;
    align-content: start;
}

.confirmation-card {
    background: linear-gradient(180deg, var(--market-card-bg, #fffdf8) 0%, var(--market-surface-soft, #fffaf0) 100%);
    border: 1px solid var(--market-card-border, #efe3c8);
    box-shadow: 0 10px 22px var(--market-shadow, rgba(140, 111, 53, 0.08));
}

.confirmation-subcard {
    background: var(--market-surface-soft, #fdf7ea);
    border: 1px solid var(--market-card-border, #ebddbf);
}

.confirmation-progress-panel {
    background: var(--market-accent-soft, #fff8ec);
}

.confirmation-search-chip {
    background: var(--market-surface-soft, #f7f0df);
    border: 1px solid var(--market-card-border, #ebddbf);
}

.confirmation-item-row {
    border-bottom-color: var(--market-card-border, #efe3c8) !important;
}

.confirmation-item-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    color: var(--market-muted, #7a6b4d);
    font-size: 0.84rem;
}

.confirmation-unit-chip {
    display: inline-flex;
    align-items: center;
    min-height: 1.3rem;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    background: var(--market-primary-soft, #fff3d0);
    border: 1px solid color-mix(in srgb, var(--market-primary, #8a5e1a) 22%, var(--market-card-border, #ead39a));
    color: var(--market-primary, #8a5e1a);
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
}

.confirmation-set-row {
    background: var(--market-surface-soft, #fdf7ea);
    border: 1px dashed var(--market-card-border, #e6d3ac);
}

.confirmation-total-box {
    background: var(--market-surface-soft, #fffaf0);
    border-radius: 1rem;
    padding: 1rem 1rem 0.2rem;
    border-top-color: transparent !important;
}

.confirmation-form-card {
    border-top: 4px solid var(--market-primary, #d7b66b);
}

.confirmation-review-card {
    position: sticky;
    top: 5.5rem;
    display: grid;
    gap: 0.9rem;
}

.confirmation-review-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
}

.confirmation-review-header p {
    margin: 0 0 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.64rem;
    font-weight: 800;
    color: var(--market-primary, #b28b46);
}

.confirmation-review-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 800;
    color: var(--market-text, #4a3300);
}

/* ป้าย "รอตรวจสอบ" — พื้นส้มทึบกับตัวหนังสือขาวอ่านยาก (ลูกค้าแจ้งตอนรีวิว)
   เปลี่ยนเป็นพื้นขาว ตัวหนังสือส้ม แล้วใช้เส้นขอบบอกขอบเขตแทน
   ⚠️ PrimeVue รุ่นนี้ไม่ใส่ class ตาม severity (.p-tag-warning) แต่ใช้ attribute
      data-p="warning" ต้องเลือกด้วย attribute selector ไม่งั้น CSS ไม่ติด */
.confirmation-review-header :deep(.p-tag[data-p~='warning']) {
    background: #fff;
    color: #d97706;
    border: 1px solid #f59e0b;
    font-weight: 700;
}

.confirmation-review-header :deep(.p-tag[data-p~='warning'] .p-tag-label) {
    color: #d97706;
}

.confirmation-review-total {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.85rem;
    border-radius: 0.9rem;
    background: linear-gradient(135deg, var(--market-primary-soft, #fff3d0), var(--market-card-bg, #fffdf8));
    border: 1px solid color-mix(in srgb, var(--market-primary, #d3af67) 28%, var(--market-card-border, #ead9b5));
}

.confirmation-review-total span {
    font-size: 0.82rem;
    color: var(--market-muted, #8a7650);
}

.confirmation-review-total strong {
    font-size: 1.35rem;
    line-height: 1;
    color: var(--market-primary, #8a5e1a);
    white-space: nowrap;
}

.confirmation-review-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
}

.confirmation-review-grid > div,
.confirmation-review-address {
    padding: 0.65rem 0.75rem;
    border-radius: 0.75rem;
    background: var(--market-surface-soft, #fdf7ea);
    border: 1px solid var(--market-card-border, #ebddbf);
    min-width: 0;
}

.confirmation-review-grid span,
.confirmation-review-address span {
    display: block;
    margin-bottom: 0.18rem;
    font-size: 0.72rem;
    color: var(--market-muted, #8a7650);
}

.confirmation-review-grid strong {
    display: block;
    overflow: hidden;
    color: var(--market-text, #4a3300);
    font-size: 0.86rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.confirmation-review-address p {
    margin: 0;
    color: var(--market-text, #4a3300);
    font-size: 0.86rem;
    line-height: 1.45;
    white-space: pre-line;
}

.confirmation-readiness-list {
    display: grid;
    gap: 0.45rem;
}

.confirmation-readiness-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.55rem;
    align-items: flex-start;
    padding: 0.65rem 0.75rem;
    border-radius: 0.75rem;
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
}

.confirmation-readiness-row.ready {
    background: #f0fdf4;
    border-color: #bbf7d0;
    color: #166534;
}

.confirmation-readiness-row i {
    margin-top: 0.1rem;
}

.confirmation-readiness-row strong {
    display: block;
    font-size: 0.84rem;
}

.confirmation-readiness-row span {
    display: block;
    color: currentColor;
    font-size: 0.75rem;
    line-height: 1.25;
    opacity: 0.82;
}

.confirmation-actions {
    gap: 0.75rem;
    position: sticky;
    bottom: 0.75rem;
    z-index: 8;
    padding: 0.75rem;
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--market-surface-soft, #fffaf0) 96%, transparent);
    box-shadow: 0 14px 28px var(--market-shadow, rgba(91, 74, 39, 0.16));
    backdrop-filter: blur(10px);
}

.confirmation-action-summary {
    margin-left: auto;
    display: grid;
    gap: 0.1rem;
    text-align: right;
    color: var(--market-text, #5b4a27);
}

.confirmation-action-summary span,
.confirmation-action-summary small {
    color: var(--market-muted, #8a7650);
    font-size: 0.76rem;
    line-height: 1.2;
}

.confirmation-action-summary strong {
    color: var(--market-primary, #8a5e1a);
    font-size: 1.12rem;
    line-height: 1.1;
}

.confirmation-action-summary small {
    max-width: 18rem;
    color: #b45309;
}

:deep(.conf-back-btn.p-button) {
    color: var(--market-muted, #9b8a67);
    font-size: 0.88rem;
    padding: 0.5rem 0.75rem;
}
:deep(.conf-back-btn.p-button:hover) {
    color: var(--market-text, #5b4a27);
    background: var(--market-surface-soft, #fdf7ea);
}

:deep(.conf-submit-btn.p-button) {
    background: linear-gradient(120deg, var(--market-primary, #e6c885) 0%, color-mix(in srgb, var(--market-primary, #d3af67) 74%, var(--market-accent, #f97316)) 100%);
    border-color: var(--market-primary, #c8a45d);
    color: var(--market-card-bg, #4a3300);
    font-size: 0.95rem;
    font-weight: 700;
    padding: 0.65rem 1.6rem;
    box-shadow: 0 3px 10px color-mix(in srgb, var(--market-primary, #c89b28) 30%, transparent);
    letter-spacing: 0.01em;
    border-radius: 8px;
    transition: all 0.18s;
}
:deep(.conf-submit-btn.p-button:hover:not(:disabled)) {
    background: linear-gradient(120deg, color-mix(in srgb, var(--market-primary, #ddbf79) 90%, #fff) 0%, var(--market-primary, #c8a45d) 100%);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--market-primary, #c89b28) 38%, transparent);
    transform: translateY(-1px);
}
:deep(.conf-submit-btn.p-button:disabled) {
    opacity: 0.55;
}

@media (max-width: 640px) {
    .confirmation-heading,
    .confirmation-actions {
        flex-direction: column;
    }

    .confirmation-head-metrics {
        width: 100%;
    }

    .confirmation-price-status {
        grid-template-columns: auto minmax(0, 1fr);
    }

    .confirmation-price-status :deep(.p-button) {
        grid-column: 1 / -1;
        justify-content: center;
        width: 100%;
    }

    .confirmation-state-chip {
        flex: 1 1 0;
    }

    .confirmation-actions {
        align-items: stretch !important;
    }

    .confirmation-review-card {
        position: static;
    }

    .confirmation-review-grid {
        grid-template-columns: 1fr;
    }

    .confirmation-action-summary {
        margin-left: 0;
        text-align: left;
    }

    .confirmation-action-summary small {
        max-width: none;
    }

    :deep(.conf-back-btn.p-button),
    :deep(.conf-submit-btn.p-button) {
        width: 100%;
        justify-content: center;
    }
}

@media (min-width: 1024px) {
    .confirmation-layout {
        grid-template-columns: minmax(0, 1.45fr) minmax(22rem, 0.95fr);
        align-items: start;
    }
}

/* Production polish: reduce nested boxes without touching order logic. */
.confirmation-shell {
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 0;
    box-shadow: none;
}

.confirmation-heading {
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 0 0 0.9rem;
    box-shadow: none;
}

.confirmation-head-metrics {
    display: none;
}

.confirmation-kicker,
.confirmation-review-header p {
    letter-spacing: 0.08em;
}

.confirmation-price-status {
    margin: 0 0 1rem;
    padding: 0.7rem 0.85rem;
    border-radius: var(--market-radius-md, 14px);
    box-shadow: none;
}

.confirmation-layout {
    gap: 1.25rem;
}

.confirmation-section {
    margin-bottom: 0 !important;
}

.confirmation-section-title {
    margin-bottom: 0.75rem !important;
    color: var(--market-text, #0f172a);
    font-weight: 800;
}

.confirmation-main-column .confirmation-card {
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    padding: 0 !important;
}

.confirmation-item-row {
    padding: 0.85rem 0 !important;
    margin: 0 !important;
    border-bottom: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 74%, transparent) !important;
}

.confirmation-item-row:last-child {
    border-bottom: 0 !important;
}

.confirmation-total-box {
    margin-top: 0.75rem !important;
    padding: 0.9rem 0 0 !important;
    background: transparent;
    border-radius: 0;
    border-top: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 74%, transparent) !important;
}

.confirmation-side-column {
    gap: 1rem;
}

.confirmation-side-column .confirmation-section {
    display: contents;
}

.confirmation-form-card,
.confirmation-review-card {
    background: var(--market-card-bg, #fff);
    border: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 76%, transparent);
    border-radius: var(--market-radius-lg, 18px);
    box-shadow: 0 10px 24px color-mix(in srgb, var(--market-shadow, rgba(15, 23, 42, 0.08)) 56%, transparent);
}

.confirmation-form-card {
    border-top: 0;
}

.confirmation-subcard {
    background: color-mix(in srgb, var(--market-surface-soft, #f8fafc) 82%, transparent);
    border-color: color-mix(in srgb, var(--market-card-border, #e2e8f0) 70%, transparent);
}

.confirmation-review-card {
    margin-bottom: 0 !important;
}

.confirmation-review-total {
    background: transparent;
    border: 0;
    border-top: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 74%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 74%, transparent);
    border-radius: 0;
    padding: 0.85rem 0;
}

.confirmation-review-grid > div,
.confirmation-review-address,
.confirmation-readiness-row {
    background: color-mix(in srgb, var(--market-surface-soft, #f8fafc) 82%, transparent);
    border-color: color-mix(in srgb, var(--market-card-border, #e2e8f0) 68%, transparent);
}

.confirmation-review-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.6rem;
    padding-top: 0.2rem;
}

:deep(.confirmation-review-actions .p-button) {
    width: 100%;
    justify-content: center;
}

.confirmation-actions {
    display: none !important;
}

@media (max-width: 640px) {
    .confirmation-shell {
        padding-bottom: 5.5rem;
    }

    .confirmation-review-actions {
        display: none;
    }

    .confirmation-actions {
        display: flex !important;
    }
}
</style>
