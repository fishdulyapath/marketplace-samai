<script setup>
import { useCheckoutFooter } from '@/composables/useCheckoutFooter';
import CartService from '@/services/CartService';
import { PRODUCT_IMAGE_PLACEHOLDER } from '@/utils/productPlaceholder';
import ProductService from '@/services/ProductService';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { isSalePremiumItem } from '@/utils/itemType';
import { pickProductName } from '@/utils/languageDisplay';
import { cartStockBreakdown, hasCartStockShortage, stockQtyLimit } from '@/utils/cartStockLimit';
import { isPreorderAllowed, toOrderQty, toStockQty } from '@/utils/preorderSplit';
import { normalizeMaxOrderQty } from '@/utils/cartLimits';
import { buildBaseUnitRatioText } from '@/utils/unitConversion';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import Tag from 'primevue/tag';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
    saveQuantity: { type: Function, required: true },
    cartItems: {
        type: Array,
        required: true
    },
    userType: {
        type: String,
        default: ''
    },
    // โหลดต่อเนื่อง (รีวิว 260908 สไลด์ 4: ไม่เอาระบบเลขหน้า)
    totalCartCount: {
        type: Number,
        default: 0
    },
    isChangingPage: {
        type: Boolean,
        default: false
    },
    // กำลังดึงชุดถัดไปมาต่อท้าย
    isLoadingMore: {
        type: Boolean,
        default: false
    },
    hasMoreItems: {
        type: Boolean,
        default: false
    },
    // ยอดรวมจาก API (ทั้งตะกร้า ไม่ใช่เฉพาะที่โหลดมา)
    cartTotalPrice: {
        type: Number,
        default: 0
    },
    cartTotalQty: {
        type: Number,
        default: 0
    },
    // Search props
    searchQuery: {
        type: String,
        default: ''
    },
    isSearching: {
        type: Boolean,
        default: false
    },
    // Stock loading prop
    isLoadingStock: {
        type: Boolean,
        default: false
    },
    checkoutLocked: {
        type: Boolean,
        default: false
    },
    checkoutLockMessage: {
        type: String,
        default: ''
    }
});

const emit = defineEmits(['update-item', 'set-cart-changed', 'next-step', 'go-to-shop', 'refresh-cart', 'update-balance-qty', 'load-more', 'search', 'clear-search', 'open-product']);

const confirm = useConfirm();
const toast = useToast();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = languageStore.t;

// State สำหรับ expand/collapse รายการสินค้าย่อย
const expandedItems = ref(new Set());

// State สำหรับ dialog แสดงปัญหา stock
const showStockIssuesDialog = ref(false);
const stockIssues = ref([]);
const isValidatingStock = ref(false);

// State สำหรับ search input
const localSearchQuery = ref('');

// Local references to cart data
const items = computed(() => props.cartItems);
const cartStepRoot = ref(null);

function isSetItem(item) {
    return String(item?.item_type || '') === '3';
}

function getItemDisplayName(item) {
    return pickProductName(item, languageStore.locale) || item?.display_name || item?.item_name || item?.name || '';
}

function toCartNumber(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

// คลิกชื่อ/รูปในตะกร้า → เปิดหน้าสั่งสินค้า (รีวิว 260908 สไลด์ 5)
// ให้หน้าแม่เป็นคนเปิด dialog เพราะ StepCart ไม่ควรรู้จักคอมโพเนนต์ dialog เอง
function openProductDetail(item) {
    const code = String(item?.item_code || '').trim();
    if (!code) return;
    emit('open-product', item);
}

// "1 ลัง = 24 ชิ้น" — ตะกร้ามีแค่หน่วยของบรรทัดนั้น จึงเทียบกับหน่วยฐานอย่างเดียว
function unitRatioTextOf(item) {
    return buildBaseUnitRatioText(item);
}

function getLineTotal(item = {}) {
    return toCartNumber(item.price) * toOrderQty(item.qty);
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

function formatSetQty(value) {
    const qty = toCartNumber(value, 0);
    return qty.toLocaleString(currentLocaleCode(), {
        minimumFractionDigits: Number.isInteger(qty) ? 0 : 2,
        maximumFractionDigits: 2
    });
}

function calculateSetItemQty(setItem, parentItem) {
    return toCartNumber(setItem?.qty, 0) * toOrderQty(parentItem?.qty);
}

// Sync local search with prop
watch(
    () => props.searchQuery,
    (newVal) => {
        localSearchQuery.value = newVal;
    },
    { immediate: true }
);

// ฟังก์ชันค้นหา
function handleSearch() {
    emit('search', localSearchQuery.value);
}

// ล้างการค้นหา
function handleClearSearch() {
    localSearchQuery.value = '';
    emit('clear-search');
}


// Calculate totals (ใช้ค่าจาก API ถ้ามี, fallback เป็นการคำนวณจาก items ที่โหลดมา)
const totalAmount = computed(() => {
    const apiTotal = toCartNumber(props.cartTotalPrice);
    if (apiTotal > 0) return apiTotal;
    return items.value.reduce((total, item) => total + getLineTotal(item), 0);
});
const totalItems = computed(() => {
    const apiQty = Math.trunc(toCartNumber(props.cartTotalQty, 0));
    if (apiQty > 0) return apiQty;
    return items.value.reduce((count, item) => count + toOrderQty(item.qty), 0);
});
const totalLines = computed(() => {
    const apiCount = Math.trunc(toCartNumber(props.totalCartCount, 0));
    if (apiCount > 0) return apiCount;
    return items.value.length;
});

const visibleStockIssueItems = computed(() => items.value.filter((item) => !props.isLoadingStock && isStockBlocked(item)));
const visibleStockIssueCount = computed(() => visibleStockIssueItems.value.length);
const hasVisibleStockIssues = computed(() => visibleStockIssueCount.value > 0);
const preorderItems = computed(() => items.value.filter((item) => stockBreakdown(item)?.preorderQty > 0));
const preorderLineCount = computed(() => preorderItems.value.length);
const checkoutBlockMessage = computed(() => {
    if (props.checkoutLocked) return props.checkoutLockMessage || t('cartFlow.partialCartReviewNotice', { docNos: '-' });
    if (hasVisibleStockIssues.value) return t('cartPage.mustFixStock', { count: visibleStockIssueCount.value });
    return '';
});
const editingKey = ref(null);
const savingQty = ref(false);
const itemKey = item => JSON.stringify([item.guid_code, item.item_code, item.unit_code]);
const isCheckoutDisabled = computed(() => props.checkoutLocked || !!editingKey.value || savingQty.value || isValidatingStock.value || props.isLoadingStock);
const getQuantityLimit = (item) => stockQtyLimit(item, items.value, !props.isLoadingStock);
const stockBreakdown = (item) => cartStockBreakdown(item, items.value, !props.isLoadingStock);
const quantityDraft = ref(null);
function draftExceedsLimit(item) {
    const max = getQuantityLimit(item);
    return quantityDraft.value?.key === itemKey(item) && !props.isLoadingStock && max !== null && quantityDraft.value.qty > max;
}
const isStockUnknown = (item) => !props.isLoadingStock && !props.isChangingPage && !props.isLoadingMore && !isSalePremiumItem(item) && toStockQty(item.balance_qty) === null;
function quantityLimitText(item) {
    const allowance = normalizeMaxOrderQty(item.max_order_qty);
    const stock = stockBreakdown(item);
    if (allowance !== null && (isPreorderAllowed(item) || !stock || allowance <= stock.maxReadyQty)) {
        return t('productDetail.maxAllowanceHint', { max: formatStockQty(allowance), unit: item.unit_code || '' });
    }
    return t('cartPage.stockAtLimit');
}
const formatStockQty = (qty) => toCartNumber(qty).toLocaleString(currentLocaleCode(), { maximumFractionDigits: 2 });
function stockNeedText(item) {
    const stock = stockBreakdown(item);
    if (!stock) return '';
    if (stock.baseUnit && stock.ratio !== 1) {
        return t('cartPage.stockNeedAvailableBase', {
            required: formatStockQty(stock.requiredBase), available: formatStockQty(stock.availableForLineBase), unit: stock.baseUnit
        });
    }
    return t('cartPage.stockNeedAvailableQty', {
        required: formatStockQty(stock.requestedQty), available: formatStockQty(stock.maxReadyQty), unit: item.unit_code || ''
    });
}
function goToFirstStockIssue() {
    cartStepRoot.value?.querySelector('[data-stock-issue="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function handlePrimaryAction() {
    if (hasVisibleStockIssues.value) {
        goToFirstStockIssue();
        return;
    }
    proceedToCheckout();
}
async function saveDraft(item, qty) {
    savingQty.value = true;
    try {
        return await props.saveQuantity({ ...item, qty });
    } finally {
        savingQty.value = false;
    }
}
async function changeQuantity(item, delta) {
    if (savingQty.value) return;
    if (delta > 0 && isStockUnknown(item)) return;
    const current = toOrderQty(item.qty) || 1;
    const next = Math.max(1, current + delta);
    const limit = getQuantityLimit(item);
    if (next === current || (delta > 0 && limit !== null && next > limit)) return;
    await saveDraft(item, next);
}
function quantityInputKeydown(event) {
    if (event.key === 'Enter') { event.target.blur(); return; }
    if (!/^[0-9]$/.test(event.key) && !['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault();
}
async function commitQuantityInput(item, event) {
    quantityDraft.value = null;
    const requested = Number(String(event.target.value).trim());
    const limit = getQuantityLimit(item);
    const next = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
    const bounded = isStockUnknown(item) && next > toOrderQty(item.qty) ? toOrderQty(item.qty)
        : limit === null ? next : Math.max(1, Math.min(next, limit));
    event.target.value = String(bounded);
    if (bounded !== toOrderQty(item.qty)) await saveDraft(item, bounded);
}
const checkoutButtonLabel = computed(() => {
    if (props.checkoutLocked) return t('cartPage.checkoutLocked');
    if (hasVisibleStockIssues.value) return t('cartPage.stockGoFix');
    return t('cartPage.checkout');
});

// Check if item exceeds its stock balance
const isExceedingStock = (item) => {
    if (isSalePremiumItem(item)) return false;
    // ตรวจสอบว่ามี balance_qty และเป็นค่าที่ใช้งานได้
    const balanceQty = toStockQty(item.balance_qty);
    return balanceQty !== null && hasCartStockShortage(item, items.value, !props.isLoadingStock);
};

// Check if item is out of stock
const isOutOfStock = (item) => {
    if (isSalePremiumItem(item)) return false;
    // ตรวจสอบว่ามี balance_qty และเป็นค่าที่ใช้งานได้
    const balanceQty = toStockQty(item.balance_qty);
    return balanceQty !== null && balanceQty <= 0;
};

const isStockBlocked = (item) => hasCartStockShortage(item, items.value, !props.isLoadingStock);

const getStockIssueShortageQty = (issue) => {
    const explicitShortage = toCartNumber(issue?.shortage_qty, null);
    if (explicitShortage !== null) return Math.max(0, explicitShortage);
    return Math.max(0, toCartNumber(issue?.qty_in_cart, 0) - toCartNumber(issue?.balance_qty, 0));
};

async function adjustItemToAvailableStock(item) {
    const maxQty = getQuantityLimit(item) ?? 0;
    if (maxQty <= 0) {
        confirmRemoveItem(item);
        return;
    }
    await saveDraft(item, maxQty);
}

// Update item quantity with specific value
async function updateItemQuantity(item, newQty) {
    try {
        const updatedItem = {
            ...item,
            qty: newQty
        };

        emit('update-item', updatedItem);
        emit('set-cart-changed');
    } catch (error) {
        console.error('Error updating item quantity:', error);
    }
}

// Update item in cart
async function updateItemInCart(item) {
    try {
        // ตรวจสอบให้แน่ใจว่า qty เป็นตัวเลข
        const updatedItem = {
            ...item,
            qty: toOrderQty(item.qty) || 1
        };

        emit('update-item', updatedItem);
    } catch (error) {
        console.error('Error updating cart item:', error);
        throw error;
    }
}

// Remove item from cart
async function removeItem(item) {
    try {
        // Remove from cart store
        await cartStore.removeFromCart(item);

        // อัพเดต items ตามข้อมูลจาก store โดยตรง
        emit('refresh-cart');

        toast.add({
            severity: 'info',
            summary: t('cartPage.itemRemoved'),
            detail: t('cartPage.itemRemovedDetail'),
            life: 1500
        });
    } catch (error) {
        console.error('Error removing item:', error);
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('cartPage.removeFailed'),
            life: 1500
        });
    }
}

// Clear cart
async function clearCart() {
    try {
        // Clear cart store
        await cartStore.clearCart();

        // emit event ให้ parent component เรียก fetchCartItems ใหม่
        emit('refresh-cart');

        toast.add({
            severity: 'info',
            summary: t('cartPage.cartCleared'),
            detail: t('cartPage.cartClearedDetail'),
            life: 1500
        });
    } catch (error) {
        console.error('Error clearing cart:', error);
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('cartPage.clearFailed'),
            life: 1500
        });
    }
}

// Toggle expand/collapse สำหรับสินค้าชุด
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

// โหลดรายการสินค้าย่อยสำหรับสินค้าชุดเมื่อ component mount
// (stock จะถูกดึงจาก CartView.vue แล้ว ไม่ต้องดึงซ้ำที่นี่)
onMounted(async () => {
    // โหลดข้อมูลสำหรับสินค้าชุด (item_type === '3') เฉพาะรายการสินค้าย่อย
    const setProducts = items.value.filter(isSetItem);

    for (const item of setProducts) {
        // โหลดรายการสินค้าย่อยสำหรับแสดง expand
        await cartStore.fetchSetItems(item.item_code);
    }

});

// ── โหลดต่อเนื่องแทนเลขหน้า ──────────────────────────────────────────────
// แพทเทิร์นเดียวกับ ProductList.vue: สังเกต sentinel ท้ายลิสต์ แล้วขอชุดถัดไป
const loadMoreSentinel = ref(null);
let loadMoreObserver = null;

// 🚨 IntersectionObserver ยิง callback เฉพาะตอน "เปลี่ยนสถานะ" เท่านั้น
//    ตะกร้าที่มีไม่กี่รายการทำให้ sentinel มองเห็นตั้งแต่โหลดหน้าเสร็จ และเห็นค้าง
//    อยู่ตลอด → callback ยิงครั้งเดียวตอน isChangingPage ยังเป็น true แล้วเงียบไปเลย
//    จึงต้องจำสถานะไว้ แล้วลองใหม่เมื่อเงื่อนไขพร้อม (ดู watch ด้านล่าง)
const sentinelVisible = ref(false);

function requestMoreIfPossible() {
    if (!sentinelVisible.value) return;
    if (props.isLoadingMore || props.isChangingPage || !props.hasMoreItems) return;
    emit('load-more');
}

function setupLoadMoreObserver() {
    if (typeof IntersectionObserver === 'undefined' || !loadMoreSentinel.value) return;
    loadMoreObserver = new IntersectionObserver(
        (entries) => {
            sentinelVisible.value = Boolean(entries[0]?.isIntersecting);
            requestMoreIfPossible();
        },
        // เผื่อระยะไว้ 240px ให้ชุดถัดไปมาถึงก่อนผู้ใช้เลื่อนถึงท้ายจริง
        { rootMargin: '240px' }
    );
    loadMoreObserver.observe(loadMoreSentinel.value);
}

// โหลดชุดก่อนหน้าเสร็จแล้วและ sentinel ยังอยู่ในจอ → ขอชุดถัดไปต่อทันที
watch(() => [props.isLoadingMore, props.isChangingPage, props.hasMoreItems], requestMoreIfPossible);

// sentinel ถูกถอด/ใส่ใหม่ตอนตะกร้าว่างแล้วมีของ — ต้องผูก observer ใหม่ทุกครั้ง
//
// 🚨 ห้ามเช็ค hasMoreItems ตรงนี้: CartView ตั้ง localCartItems ก่อน totalCartCount
//    ตอน watcher นี้ทำงาน hasMoreItems ยังคำนวณจาก total เก่า (0) อยู่ = false
//    แล้ว observer จะไม่ถูกผูกเลย เงื่อนไขไปเช็คใน callback แทน (ค่าตอนนั้นถูกแล้ว)
watch(
    loadMoreSentinel,
    async (el) => {
        loadMoreObserver?.disconnect();
        loadMoreObserver = null;
        if (!el) return;
        await nextTick();
        setupLoadMoreObserver();
    },
    { flush: 'post' }
);

onBeforeUnmount(() => {
    loadMoreObserver?.disconnect();
    loadMoreObserver = null;
});

// Confirmation dialogs
function confirmRemoveItem(item) {
    confirm.require({
        message: t('cartPage.removeConfirmMessage', { name: getItemDisplayName(item) }),
        header: t('cartPage.removeConfirmTitle'),
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: t('cartPage.removeAccept'),
        rejectLabel: t('common.cancel'),
        acceptClass: 'p-button-danger',
        accept: () => removeItem(item)
    });
}

function confirmClearCart() {
    confirm.require({
        message: t('cartPage.clearConfirmMessage'),
        header: t('cartPage.clearConfirmTitle'),
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: t('cartPage.clearAccept'),
        rejectLabel: t('common.cancel'),
        acceptClass: 'p-button-danger',
        accept: clearCart
    });
}

// Utility functions
function currentLocaleCode() {
    return languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH';
}

function formatNumber(value) {
    const num = toCartNumber(value);
    return Number.isFinite(num)
        ? num.toLocaleString(currentLocaleCode(), {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
          })
        : '0.00';
}

function formatQty(value) {
    const num = toCartNumber(value);
    return Number.isFinite(num)
        ? num.toLocaleString(currentLocaleCode(), {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0
          })
        : '0';
}

function getProductImage(itemOrCode) {
    const itemCode = typeof itemOrCode === 'object' ? itemOrCode?.item_code || itemOrCode?.code : itemOrCode;
    return itemCode ? ProductService.getProductImageUrl(itemCode, typeof itemOrCode === 'object' ? itemOrCode : {}) : PRODUCT_IMAGE_PLACEHOLDER;
}

function handleImageError(event) {
    event.target.src = PRODUCT_IMAGE_PLACEHOLDER;
}

// Navigation
async function proceedToCheckout() {
    if (editingKey.value || savingQty.value || isValidatingStock.value || props.isLoadingStock) return;
    if (props.checkoutLocked) {
        toast.add({
            severity: 'warn',
            summary: t('cartPage.checkoutLocked'),
            detail: checkoutBlockMessage.value,
            life: 5200
        });
        return;
    }

    if (items.value.length === 0) {
        toast.add({
            severity: 'warn',
            summary: t('cartPage.cartEmptyWarning'),
            detail: t('cartPage.addBeforeCheckout'),
            life: 1500
        });
        return;
    }

    if (hasVisibleStockIssues.value) {
        toast.add({
            severity: 'warn',
            summary: t('cartPage.fixQty'),
            detail: checkoutBlockMessage.value,
            life: 2200
        });
        return;
    }

    // Check the whole cart on the server, including rows not loaded by pagination.
    try {
        isValidatingStock.value = true;
        const custCode = cartStore.custCode || localStorage.getItem('_userCode');
        if (!custCode) throw new Error(t('cartPage.customerMissing'));
        const response = await CartService.validateCartStock(custCode);
        if (!response?.data?.success) throw new Error(t('cartPage.stockCheckFailedDetail'));
        if (!response.data.is_valid) {
            stockIssues.value = response.data.stock_issues || [];
            showStockIssuesDialog.value = true;
            return;
        }
        emit('next-step');
    } catch (error) {
        toast.add({ severity: 'error', summary: t('cartPage.stockCheckFailed'), detail: error.message || t('cartPage.stockCheckFailedDetail'), life: 5000 });
    } finally {
        isValidatingStock.value = false;
    }
}

// ลบรายการโปรโมชันของแถมที่หมดอายุออกจากตะกร้า (REQ5)
const removingPremiumCode = ref('');

// ปัญหาโปรโมชันมี 2 แบบ: หมดอายุ กับ ปิดให้บริการ (feature flag ถูกปิด)
// ทั้งคู่แสดงผลและแก้ด้วยวิธีเดียวกัน คือให้ลูกค้าลบรายการออกจากตะกร้า
const isPremiumIssue = (issue) => ['premium_expired', 'premium_unavailable', 'premium_out_of_stock'].includes(issue?.issue_type);

async function removeExpiredPremium(issue) {
    if (removingPremiumCode.value) return;
    const custCode = localStorage.getItem('_userCode') || '';
    if (!custCode || !issue?.guid_code) {
        toast.add({ severity: 'error', summary: t('common.error'), detail: t('cartPage.removeFailed'), life: 3000 });
        return;
    }

    removingPremiumCode.value = issue.item_code;
    try {
        await CartService.deleteItem(issue.guid_code, custCode);
        // เอาออกจากรายการที่แสดงใน dialog ทันที
        stockIssues.value = stockIssues.value.filter((row) => row.item_code !== issue.item_code);
        toast.add({ severity: 'success', summary: t('cartPage.removeSuccess'), life: 2500 });
        emit('refresh-cart');
        // ถ้าไม่เหลือปัญหาอื่นแล้ว ปิด dialog ให้เลย
        if (!stockIssues.value.length) showStockIssuesDialog.value = false;
    } catch (error) {
        console.error('Error removing expired premium:', error);
        toast.add({ severity: 'error', summary: t('common.error'), detail: t('cartPage.removeFailed'), life: 3000 });
    } finally {
        removingPremiumCode.value = '';
    }
}

// ปรับจำนวนในตะกร้าลงมาให้เท่าลิมิตต่อคำสั่งซื้อ (REQ3)
// ไม่ลบรายการทิ้งเหมือนกรณีของแถม เพราะสินค้ายังสั่งได้ แค่ต้องลดจำนวน
async function adjustToMaxAllowance(issue) {
    const item = items.value.find((row) => row.item_code === issue.item_code && row.unit_code === issue.unit_code);
    const maxOrderQty = Number(issue?.max_order_qty);
    if (!item || !Number.isFinite(maxOrderQty) || maxOrderQty <= 0) {
        toast.add({ severity: 'error', summary: t('common.error'), life: 3000 });
        return;
    }

    try {
        item.qty = maxOrderQty;
        emit('set-cart-changed');
        await updateItemInCart(item);
        stockIssues.value = stockIssues.value.filter(
            (row) => !(row.item_code === issue.item_code && row.unit_code === issue.unit_code)
        );
        emit('refresh-cart');
        if (!stockIssues.value.length) showStockIssuesDialog.value = false;
    } catch (error) {
        console.error('Error adjusting quantity to max allowance:', error);
        toast.add({ severity: 'error', summary: t('common.error'), life: 3000 });
    }
}

// ปิด dialog และ refresh ตะกร้า
function closeStockIssuesDialog() {
    showStockIssuesDialog.value = false;
    stockIssues.value = [];
    // refresh cart เพื่ออัปเดต stock ใหม่
    emit('refresh-cart');
}

const checkoutFooter = ref(null);
useCheckoutFooter(checkoutFooter);
</script>

<template>
    <!-- Empty cart -->
    <div v-if="items.length === 0 && !searchQuery" class="flex flex-col items-center justify-center p-8 text-center">
        <i class="pi pi-shopping-cart text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
        <h3 class="text-xl font-medium mb-2">{{ t('cartPage.emptyTitle') }}</h3>
        <p class="text-gray-500 dark:text-gray-400 mb-4">{{ t('cartPage.emptyHint') }}</p>
        <Button :label="t('cartPage.shopNow')" icon="pi pi-shopping-bag" @click="emit('go-to-shop')" />
    </div>

    <!-- Cart content -->
    <div v-else ref="cartStepRoot" class="cart-step-shell">
        <header class="cart-toolbar">
            <div class="cart-title"><i class="pi pi-shopping-cart" aria-hidden="true"></i><h1>{{ t('cart.cart') }}</h1>
                <span>{{ t('cartPage.summaryLine', { lines: totalLines, items: totalItems }) }}</span>
            </div>
            <form class="cart-search" role="search" @submit.prevent="handleSearch">
                <input type="search" v-model="localSearchQuery" :placeholder="t('cartPage.cartSearchPlaceholder')" :aria-label="t('cartPage.cartSearchPlaceholder')" />
                <button v-if="localSearchQuery || searchQuery" type="button" :aria-label="t('common.clearSearch')" @click="handleClearSearch"><i class="pi pi-times"></i></button>
                <button type="submit" :disabled="isSearching" :aria-label="t('common.search')"><i :class="isSearching ? 'pi pi-spin pi-spinner' : 'pi pi-search'"></i></button>
            </form>
            <Button icon="pi pi-trash" :label="t('cartPage.clearCart')" severity="secondary" text size="small" class="cart-clear" @click="confirmClearCart" />
        </header>

        <!-- Search result info -->
        <div v-if="searchQuery" class="mb-4 p-3 search-result-chip rounded-lg flex items-center justify-between">
            <span class="text-sm text-blue-700 dark:text-blue-300">
                <i class="pi pi-filter mr-2"></i>
                {{ t('cartPage.searchResult', { query: searchQuery, count: totalCartCount }) }}
            </span>
            <Button :label="t('common.clearSearch')" icon="pi pi-times" text size="small" @click="handleClearSearch" />
        </div>

        <div v-if="hasVisibleStockIssues" class="cart-stock-alert mb-4">
            <div>
                <i class="pi pi-exclamation-triangle"></i>
                <strong>{{ t('cartPage.stockIssuesTitle') }}</strong>
                <span>{{ checkoutBlockMessage }}</span>
            </div>
            <Button :label="t('cartPage.refreshStock')" icon="pi pi-refresh" outlined size="small" @click="emit('refresh-cart')" />
        </div>

        <!-- No search results -->
        <div v-if="items.length === 0 && searchQuery" class="flex flex-col items-center justify-center p-8 text-center">
            <i class="pi pi-search text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
            <h3 class="text-xl font-medium mb-2">{{ t('cartPage.noSearchResultTitle') }}</h3>
            <p class="text-gray-500 dark:text-gray-400 mb-4">{{ t('cartPage.noSearchResultHint') }}</p>
            <Button :label="t('common.clearSearch')" icon="pi pi-times" outlined @click="handleClearSearch" />
        </div>

        <!-- Cart items -->
        <div v-if="items.length > 0" class="cart-review-layout">
            <section class="cart-items-panel">
                <div class="cart-column-head" aria-hidden="true">
                    <span>{{ t('common.product') }}</span><span>{{ t('common.unit') }}</span><span>{{ t('common.price') }}</span>
                    <span>{{ t('productDetail.stock') }}</span><span>{{ t('common.qty') }}</span><span>{{ t('common.amount') }}</span>
                </div>
                <div class="cart-items-stack">
                    <div v-for="item in items" :key="item.guid_code + ':' + item.item_code + ':' + item.unit_code" class="cart-line" :class="{ 'cart-line--issue': !isLoadingStock && isStockBlocked(item) }" :data-stock-issue="!isLoadingStock && isStockBlocked(item) ? 'true' : null">
                        <div class="cart-row">
                            <div class="cart-product">
                                <button type="button" @click="openProductDetail(item)"><img :src="getProductImage(item)" :alt="getItemDisplayName(item)" @error="handleImageError" /></button>
                                <div><small>{{ item.item_code }}</small><button type="button" class="text-left font-semibold" @click="openProductDetail(item)">{{ getItemDisplayName(item) }}</button>
                                    <small v-if="item.category">{{ item.category }}</small>
                                    <Tag v-if="isSalePremiumItem(item)" :value="t('catalog.promotion')" severity="danger" icon="pi pi-gift" />
                                    <Tag v-if="isSetItem(item)" :value="t('cartPage.setTag')" severity="info" />
                                    <Button v-if="isSetItem(item) && cartStore.setItemsCache[item.item_code]?.length"
                                        :icon="isExpanded(item.item_code) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" text rounded size="small"
                                        :aria-expanded="isExpanded(item.item_code)" :aria-label="t('cartPage.setTag')" @click="toggleSetItems(item.item_code)" />
                                </div>
                            </div>
                            <span class="cart-unit">{{ item.unit_code }}</span>
                            <span class="cart-price">฿{{ formatNumber(item.price) }}<small> / {{ item.unit_code }}</small><small v-if="unitRatioTextOf(item)" class="unit-ratio">{{ unitRatioTextOf(item) }}</small></span>
                            <div class="cart-stock">
                                <div v-if="isLoadingStock" class="cart-stock-badge cart-stock-badge--loading">
                                    <i class="pi pi-spin pi-spinner"></i> {{ t('cartPage.checkingStock') }}
                                </div>
                                <div v-else-if="isStockUnknown(item)" class="cart-stock-badge cart-stock-badge--warn">
                                    <i class="pi pi-exclamation-triangle"></i> {{ t('cartPage.stockCheckFailed') }}
                                </div>
                                <div v-else-if="stockBreakdown(item)?.preorderQty > 0" class="cart-stock-badge cart-stock-badge--preorder">
                                    <i class="pi pi-clock"></i> {{ t('cartPage.stockPreorderQty', { qty: formatStockQty(stockBreakdown(item).preorderQty), unit: item.unit_code || '' }) }}
                                </div>
                                <div v-else-if="!isSalePremiumItem(item) && isOutOfStock(item)" class="cart-stock-badge cart-stock-badge--out">
                                    <i class="pi pi-times-circle"></i> {{ t('cartPage.outOfStock') }}
                                </div>
                                <div v-else-if="!isSalePremiumItem(item) && isExceedingStock(item)" class="cart-stock-badge cart-stock-badge--warn">
                                    <i class="pi pi-exclamation-triangle"></i> {{ t('cartPage.stockNotEnough') }} ({{ t('cartPage.stockBalance', { qty: formatQty(item.balance_qty), unit: item.unit_code }) }})
                                </div>
                                <div v-else-if="!isSalePremiumItem(item) && item.balance_qty !== undefined" class="cart-stock-badge cart-stock-badge--ok">
                                    <i class="pi pi-box"></i> {{ t('cartPage.stockBalance', { qty: formatQty(item.balance_qty), unit: item.unit_code }) }}
                                </div>
                            </div>
                            <div class="cart-item-qty-row">
                                <Button icon="pi pi-minus" text rounded size="small" class="qty-step-btn"
                                    :aria-label="`ลดจำนวน ${getItemDisplayName(item)}`" :disabled="savingQty || toOrderQty(item.qty) <= 1" @click="changeQuantity(item, -1)" />
                                <input :key="`${itemKey(item)}:${item.qty}`" type="text" :value="toOrderQty(item.qty)" class="qty-input"
                                    inputmode="numeric" :aria-label="`จำนวน ${getItemDisplayName(item)}`"
                                    :disabled="savingQty" @keydown="quantityInputKeydown" @input="quantityDraft = { key: itemKey(item), qty: Number($event.target.value) }" @blur="commitQuantityInput(item, $event)" />
                                <Button icon="pi pi-plus" text rounded size="small" class="qty-step-btn"
                                    :aria-label="`เพิ่มจำนวน ${getItemDisplayName(item)}`"
                                    :disabled="savingQty || props.isLoadingStock || isStockUnknown(item) || (getQuantityLimit(item) !== null && toOrderQty(item.qty) >= getQuantityLimit(item))"
                                    @click="changeQuantity(item, 1)" />
                            </div>
                            <strong class="cart-subtotal">฿{{ formatNumber(getLineTotal(item)) }}</strong>
                            <Button icon="pi pi-trash" :aria-label="t('cartPage.removeItem') + ' ' + getItemDisplayName(item)" severity="danger" text size="small" class="cart-remove" @click="confirmRemoveItem(item)" />
                        </div>
                        <div v-if="!isLoadingStock && isStockBlocked(item)" class="cart-issue-action" role="alert">
                            <div class="cart-issue-copy">
                                <strong><i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ t('cartPage.stockNotEnough') }}</strong>
                                <span>{{ stockNeedText(item) }}</span>
                                <small>{{ t('cartPage.stockCanOrder', { qty: formatStockQty(getQuantityLimit(item)), unit: item.unit_code || '' }) }}</small>
                            </div>
                            <Button :label="getQuantityLimit(item) > 0 ? t('cartPage.stockAdjustTo', { qty: formatStockQty(getQuantityLimit(item)), unit: item.unit_code || '' }) : t('cartPage.removeItem')"
                                :icon="getQuantityLimit(item) > 0 ? 'pi pi-pencil' : 'pi pi-trash'" size="small" outlined :disabled="savingQty" @click="adjustItemToAvailableStock(item)" />
                        </div>
                        <div v-else-if="stockBreakdown(item)?.preorderQty > 0" class="cart-preorder-action">
                            <div class="cart-preorder-pills">
                                <span>{{ t('cartPage.stockReadyQty', { qty: formatStockQty(stockBreakdown(item).readyQty), unit: item.unit_code || '' }) }}</span>
                                <span>{{ t('cartPage.stockPreorderQty', { qty: formatStockQty(stockBreakdown(item).preorderQty), unit: item.unit_code || '' }) }}</span>
                            </div>
                            <small>{{ t('cartPage.stockPreorderHint') }}</small>
                        </div>
                        <div v-else-if="draftExceedsLimit(item)" class="cart-limit-action" role="status">
                            <i class="pi pi-info-circle" aria-hidden="true"></i>
                            <span>{{ quantityLimitText(item) }}</span>
                        </div>
                        <div v-else-if="isStockUnknown(item)" class="cart-limit-action" role="status">
                            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                            <span>{{ t('cartPage.stockCheckFailedDetail') }}</span>
                            <Button :label="t('cartPage.refreshStock')" icon="pi pi-refresh" text size="small" @click="emit('refresh-cart')" />
                        </div>
                <!-- รายการสินค้าย่อย (expandable) -->
                <div v-if="isSetItem(item) && isExpanded(item.item_code)" class="ml-8 mt-2 space-y-2 border-l-2 border-primary-200 pl-4 mb-4">
                    <div v-for="(setItem, setIndex) in cartStore.setItemsCache[item.item_code]" :key="getSetItemKey(setItem, item, setIndex)" class="flex items-center gap-2 text-sm set-item-row p-2 rounded">
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
                            {{ formatSetQty(calculateSetItemQty(setItem, item)) }} {{ setItem.unit_code }}
                            <span class="text-gray-400">({{ formatSetQty(setItem.qty) }} x {{ formatQty(item.qty) }})</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- โหลดต่อเนื่อง — ไม่มีเลขหน้าแล้ว (รีวิว 260908 สไลด์ 4)
             sentinel ตัวนี้ถูกสังเกตด้วย IntersectionObserver แล้วขอชุดถัดไป -->
        <div ref="loadMoreSentinel" class="cart-load-more">
            <div v-if="isLoadingMore" class="cart-load-more__spinner">
                <i class="pi pi-spin pi-spinner"></i>
                <span>{{ t('cartPage.loadingMore') }}</span>
            </div>
            <!-- ปุ่มสำรองเผื่อเบราว์เซอร์ไม่รองรับ IntersectionObserver หรือ observer พลาด -->
            <button v-else-if="hasMoreItems" type="button" class="cart-load-more__btn" @click="emit('load-more')">
                {{ t('cartPage.loadMore') }}
            </button>
        </div>

        <!-- Loading overlay ตอนโหลดรายการใหม่ทั้งชุด (ค้นหา / รีเฟรชหลังลบ) -->
        <div v-if="isChangingPage" class="flex justify-center py-4">
            <i class="pi pi-spin pi-spinner text-2xl text-primary-500"></i>
        </div>
                <p v-if="checkoutBlockMessage" class="mobile-cart-warning">{{ checkoutBlockMessage }}</p>
            </section>

            <aside ref="checkoutFooter" class="cart-summary-card mobile-checkout-footer" :class="{ 'cart-summary-card--needs-fix': hasVisibleStockIssues }">
                <div class="cart-sum checkout-total"><small>{{ t('common.total') }}</small><strong>฿{{ formatNumber(totalAmount) }}</strong></div>
                <div class="cart-summary-count">{{ t('cartPage.summaryLine', { lines: totalLines, items: totalItems }) }}</div>
                <div v-if="checkoutBlockMessage" class="cart-summary-warning">
                    <i class="pi pi-exclamation-triangle"></i>
                    <span>{{ checkoutBlockMessage }}</span>
                </div>
                <div v-else-if="preorderLineCount > 0" class="cart-summary-preorder">
                    <i class="pi pi-clock"></i>
                    <span>{{ t('cartPage.stockPreorderSummary', { count: preorderLineCount }) }}</span>
                </div>
                <Button
                    :label="checkoutButtonLabel"
                    icon="pi pi-shopping-cart"
                    iconPos="right"
                    @click="handlePrimaryAction"
                    :loading="isValidatingStock"
                    :disabled="isCheckoutDisabled"
                    class="footer-checkout-btn cart-summary-checkout checkout-primary"
                />
                <Button :label="t('cartPage.continueShopping')" icon="pi pi-arrow-left" outlined severity="secondary" class="cart-summary-back checkout-secondary" @click="emit('go-to-shop')" />
            </aside>
        </div>

        <!-- Dialog แสดงปัญหา Stock -->
        <Dialog :visible="showStockIssuesDialog" @update:visible="showStockIssuesDialog = $event" :modal="true" :header="t('cartPage.stockDialogTitle')" :style="{ width: '90%', maxWidth: '500px' }" :closable="true">
            <div class="flex items-start mb-4">
                <i class="pi pi-exclamation-triangle text-orange-500 mr-3" style="font-size: 1.5rem"></i>
                <p class="m-0">{{ t('cartPage.stockDialogHint') }}</p>
            </div>

            <div class="max-h-64 overflow-y-auto">
                <div
                    v-for="issue in stockIssues"
                    :key="`${issue.item_code}-${issue.unit_code || ''}`"
                    class="flex items-center gap-3 p-3 mb-2 rounded-lg"
                    :class="isPremiumIssue(issue) ? 'bg-pink-50 dark:bg-pink-900/20' : issue.issue_type === 'out_of_stock' ? 'bg-red-50 dark:bg-red-900/20' : 'bg-orange-50 dark:bg-orange-900/20'"
                >
                    <div class="w-12 h-12 flex-shrink-0 rounded overflow-hidden border border-gray-200 dark:border-gray-700 flex items-center justify-center">
                        <i v-if="isPremiumIssue(issue)" class="pi pi-gift text-pink-500" style="font-size: 1.4rem"></i>
                        <img v-else :src="getProductImage(issue)" :alt="issue.item_code" class="w-full h-full object-contain" @error="handleImageError" />
                    </div>
                    <div class="flex-grow min-w-0">
                        <div class="font-medium truncate">{{ getItemDisplayName(issue) }}</div>
                        <div class="text-sm text-gray-500">{{ issue.item_code }}</div>
                        <div
                            class="text-sm mt-1"
                            :class="isPremiumIssue(issue) ? 'text-pink-600' : issue.issue_type === 'out_of_stock' ? 'text-red-600' : 'text-orange-600'"
                        >
                            <span v-if="isPremiumIssue(issue)">
                                <i class="pi pi-clock mr-1"></i>
                                {{
                                    issue.issue_type === 'premium_unavailable'
                                        ? t('cartPage.premiumUnavailable')
                                        : issue.issue_type === 'premium_out_of_stock'
                                          ? t('cartPage.premiumOutOfStock')
                                          : t('cartPage.premiumExpired')
                                }}
                            </span>
                            <span v-else-if="issue.issue_type === 'out_of_stock'"> <i class="pi pi-times-circle mr-1"></i> {{ t('cartPage.outOfStock') }} </span>
                            <span v-else-if="issue.issue_type === 'max_allowance_exceeded'">
                                <i class="pi pi-info-circle mr-1"></i>
                                {{ t('productDetail.maxAllowanceHint', { max: issue.max_order_qty, unit: issue.unit_code || '' }) }}
                            </span>
                            <span v-else>
                                <i class="pi pi-exclamation-triangle mr-1"></i>
                                {{ t('cartPage.stockIssueLine', { cartQty: formatQty(issue.qty_in_cart), balanceQty: formatQty(issue.balance_qty), shortageQty: formatQty(getStockIssueShortageQty(issue)), unit: issue.unit_code || t('common.piece') }) }}
                            </span>
                        </div>
                    </div>
                    <Button
                        v-if="isPremiumIssue(issue)"
                        :label="t('cartPage.removeExpiredPremium')"
                        icon="pi pi-trash"
                        severity="danger"
                        size="small"
                        outlined
                        :loading="removingPremiumCode === issue.item_code"
                        @click="removeExpiredPremium(issue)"
                    />
                    <Button
                        v-else-if="issue.issue_type === 'max_allowance_exceeded'"
                        :label="t('cartPage.adjustToMaxAllowance')"
                        icon="pi pi-pencil"
                        severity="warn"
                        size="small"
                        outlined
                        @click="adjustToMaxAllowance(issue)"
                    />
                </div>
            </div>

            <template #footer>
                <Button :label="t('common.confirm')" icon="pi pi-check" @click="closeStockIssuesDialog" autofocus />
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
.cart-step-shell {
    --line: var(--market-card-border, #dce7df);
    --surface: var(--market-card-bg, white);
    --muted: var(--market-muted, #586761);
    --green: var(--market-primary, #087d55);
    color: var(--market-text);
}
.cart-toolbar, .cart-title, .cart-search, .cart-product, .cart-stock-alert, .cart-stock-alert > div, .cart-issue-action {
    display: flex;
    align-items: center;
    gap: .6rem;
}
.cart-toolbar { flex-wrap: wrap; gap: .7rem 1rem; margin-bottom: 1rem; }
.cart-title h1 { margin: 0; font-size: 1.25rem; font-weight: 750; }
.cart-title > i, .cart-product small:first-child { color: var(--green); }
.cart-title span { padding-inline-start: .65rem; border-inline-start: 1px solid var(--line); color: var(--muted); }
.cart-search { flex: 1 1 13rem; max-width: 36rem; margin-inline-start: auto; gap: 0; padding-inline: .65rem .15rem; border: 1px solid var(--line); border-radius: .65rem; background: var(--surface); }
.cart-search:focus-within { outline: 2px solid var(--green); }
.cart-search input { flex: 1; width: 0; min-height: 2.65rem; color: inherit; background: transparent; outline: none; }
.cart-search input::-webkit-search-cancel-button { display: none; }
.cart-search button { min-width: 2.5rem; min-height: 2.5rem; color: var(--green); cursor: pointer; }
.cart-review-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 19%); gap: 1rem; align-items: start; }
.cart-items-panel, .cart-summary-card { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: .85rem; }
.cart-column-head, .cart-row {
    display: grid;
    grid-template-columns: minmax(9rem, 2fr) minmax(2.6rem, .48fr) minmax(4.5rem, .7fr) minmax(5.3rem, .9fr) 7rem minmax(5rem, .75fr) 2rem;
    align-items: center; gap: .45rem; padding: .75rem;
}
.cart-column-head { font-size: .82rem; font-weight: 650; color: var(--muted); background: var(--market-primary-soft, #edf6f0); border-radius: .85rem .85rem 0 0; }
.cart-column-head > :nth-child(5) { text-align: center; }
.cart-column-head > :nth-child(6), .cart-subtotal { text-align: end; }
.cart-line + .cart-line { border-top: 1px solid var(--line); }
.cart-line:last-child { border-radius: 0 0 .85rem .85rem; }
.cart-line--issue { background:#fffafa; }
.cart-stock-alert { background:#fff7e8; }
.cart-product { min-width: 0; overflow-wrap: anywhere; }
.cart-product img { width: 3rem; height: 3rem; flex: none; object-fit: contain; }
.cart-product small, .cart-product strong { display: block; }
.cart-product small { color: var(--muted); font-size: .78rem; }
.cart-product strong { font-weight: 650; line-height: 1.4; }
.cart-unit, .cart-stock, .cart-price { font-size: .86rem; overflow-wrap: anywhere; }
.cart-price small { display: none; }
.cart-stock-badge { line-height: 1.4; }
.cart-stock-badge--ok { color: #087247; }
.cart-stock-badge--preorder, .cart-summary-preorder { color: #514892; }
.cart-stock-badge--warn, .cart-stock-badge--out, .cart-summary-warning, .mobile-cart-warning { color:#b52f21; }
.cart-stock-alert, .cart-issue-action { flex-wrap: wrap; color:#b52f21; }
.cart-stock-alert { justify-content: space-between; border: 1px solid #e9c38c; padding: .5rem .8rem; border-radius: .65rem; }
.cart-stock-alert > div { flex-wrap: wrap; }
.cart-issue-action { justify-content:space-between; padding:.7rem .85rem; background:#fff1ed; border:1px solid #f3d2c9; color:#9e3828; gap:.75rem; }
.cart-issue-copy { display:grid; gap:.18rem; min-width:0; line-height:1.4; }
.cart-issue-copy small { color:#865c54; }
.cart-issue-action :deep(.p-button) { flex:none; color:#9e3828; border-color:#e9a995; }
.cart-preorder-action { padding:.65rem .8rem; background:#fff8e9; border:1px solid #f0dfb9; color:#875c12; }
.cart-preorder-pills { display:flex; flex-wrap:wrap; gap:.4rem; margin-bottom:.25rem; }
.cart-preorder-pills span { padding:.2rem .55rem; border-radius:999px; background:#fff0cf; font-size:.83rem; font-weight:700; }
.cart-preorder-pills span:first-child { background:#e5f5ee; color:#0a5948; }
.cart-preorder-action small { font-size:.78rem; }
.cart-limit-action { display:flex; align-items:center; gap:.45rem; padding:.48rem .8rem; background:#fff1ed; border:1px solid #f3d2c9; border-radius:.65rem; color:#b52f21; font-size:.83rem; font-weight:700; }
.cart-item-qty-row { display: inline-flex; align-items: center; justify-self: start; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; }
.cart-item-qty-row :deep(.p-button) { width: 2.1rem; height: 2.25rem; padding: 0; color: var(--green); }
.qty-input { width: 2.5rem; min-width: 0; text-align: center; color: inherit; background: transparent; }
.qty-input--error { color: #9c371a; }
.cart-subtotal, .cart-price, .cart-sum { font-variant-numeric: tabular-nums; }
.cart-remove { justify-self: end; }
.cart-summary-card { position: sticky; top: 8rem; display: grid; gap: .7rem; padding: 1rem; }
.cart-sum small, .cart-sum strong { display: block; }
.cart-sum strong { color: var(--green); font-size: clamp(1.3rem, 2vw, 1.85rem); line-height: 1.3; }
.cart-summary-count, .cart-page-number { color: var(--muted); font-size: .85rem; }
.cart-summary-warning, .cart-summary-preorder { display: flex; gap: .5rem; align-items: baseline; font-size: .87rem; }
.cart-summary-checkout:not(:disabled) { background: var(--green); color: white; }
.cart-pagination { flex-wrap: wrap; }

@media (max-width: 900px) {
    .cart-review-layout { display: flex; flex-direction: column; align-items: stretch; gap: .65rem; }
    .cart-column-head { display: none; }
    .cart-items-panel { border: 0; background: transparent; }
    .cart-items-stack { display: grid; gap: .55rem; }
    .cart-items-stack .cart-line { border: 1px solid var(--line); border-radius: .75rem; background: var(--surface); }
    .cart-items-stack .cart-line--issue { background:#fffafa; border-color:#f3d2c9; }
    .cart-row { grid-template-columns: minmax(0, 1fr) auto 2.3rem; grid-template-areas: "product product remove" "price stock stock" "qty total total"; gap: .3rem .55rem; }
    .cart-product { grid-area: product; }
    .cart-unit { display: none; }
    .cart-price { grid-area: price; color: var(--muted); }
    .cart-price small { display: inline; }
    .cart-stock { grid-area: stock; text-align: end; max-width: 12rem; }
    .cart-item-qty-row { grid-area: qty; }
    .cart-subtotal { grid-area: total; }
    .cart-remove { grid-area: remove; }
    .cart-issue-action { border-radius: 0 0 .75rem .75rem; }
    .cart-issue-action :deep(.p-button) { max-width:100%; }
    .cart-preorder-action { border-radius:0 0 .75rem .75rem; }
    .cart-summary-card {
        top: auto; bottom: 0; z-index: 4;
        grid-template-columns: minmax(0,1fr) auto; align-items: center;
        gap: .35rem .7rem; padding: .55rem .8rem;
        box-shadow: 0 -3px 12px rgb(20 50 35 / 8%);
    }
    .cart-sum { grid-column: 1; grid-row: 1; }
    .cart-summary-checkout { grid-column: 2; grid-row: 1; }
    .cart-summary-card--needs-fix .cart-summary-checkout { grid-column:1 / -1; grid-row:auto; width:100%; }
    .cart-summary-count { display: none; }
    .cart-summary-warning, .cart-summary-preorder, .cart-page-number { grid-column: 1 / -1; }
    .cart-summary-back { grid-column: 1 / -1; justify-self: center; min-height: 2rem; padding: .2rem .6rem; }
}
@media (max-width: 900px) {
    .cart-step-shell { padding-bottom: calc(var(--checkout-footer-height, 70px) + 1rem); }
    .cart-toolbar {
        position: sticky;
        top: 0;
        z-index: 6;
        padding-block: .45rem;
        background: var(--surface);
        border-bottom: 1px solid var(--line);
    }
    .cart-summary-warning, .cart-summary-preorder { overflow-wrap: anywhere; }
}
@media (max-width: 640px) {
    .cart-issue-action { align-items:stretch; flex-direction:column; }
    .cart-issue-action :deep(.p-button) { justify-content:center; }
    .cart-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .4rem; margin-bottom: .65rem; }
    .cart-title { grid-column: 1 / -1; }
    .cart-search { width: 100%; max-width: none; }
    .cart-clear { padding-inline: .35rem; }
}

.cart-price .unit-ratio { display:block; font-size:.78rem; color:var(--muted); }
.mobile-cart-warning { display:none; }
@media(max-width:900px) {
    .mobile-cart-warning { display:block; }
    .cart-summary-card > .cart-summary-warning, .cart-summary-card > .cart-summary-preorder { display:none; }
}
</style>
<style scoped src="./mobileCheckoutFooter.css"></style>
