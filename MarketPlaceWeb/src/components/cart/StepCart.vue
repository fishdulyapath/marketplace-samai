<script setup>
import CartService from '@/services/CartService';
import { PRODUCT_IMAGE_PLACEHOLDER } from '@/utils/productPlaceholder';
import ProductService from '@/services/ProductService';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { isSalePremiumItem } from '@/utils/itemType';
import { pickProductName } from '@/utils/languageDisplay';
import { isMaxOrderQtyReached, normalizeMaxOrderQty } from '@/utils/cartLimits';
import { getPreorderSplit, isPreorderAllowed, toOrderQty, toStockQty } from '@/utils/preorderSplit';
import { buildBaseUnitRatioText } from '@/utils/unitConversion';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import Tag from 'primevue/tag';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
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

// ค้นหาเมื่อกด Enter
function handleSearchKeydown(event) {
    if (event.key === 'Enter') {
        handleSearch();
    }
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
const showCartSearch = computed(() => toCartNumber(props.totalCartCount, 0) > 5 || !!props.searchQuery || !!localSearchQuery.value);

const visibleStockIssueItems = computed(() => items.value.filter((item) => !props.isLoadingStock && isStockBlocked(item)));
const visibleStockIssueCount = computed(() => visibleStockIssueItems.value.length);
const hasVisibleStockIssues = computed(() => visibleStockIssueCount.value > 0);
const preorderItems = computed(() => items.value.filter((item) => !props.isLoadingStock && getPreorderSplit(item).hasPreorder));
const preorderLineCount = computed(() => preorderItems.value.length);
const checkoutBlockMessage = computed(() => {
    if (props.checkoutLocked) return props.checkoutLockMessage || t('cartFlow.partialCartReviewNotice', { docNos: '-' });
    if (props.isLoadingStock) return t('cartPage.checkingStock');
    if (hasVisibleStockIssues.value) return t('cartPage.mustFixStock', { count: visibleStockIssueCount.value });
    return '';
});
const isCheckoutDisabled = computed(() => isValidatingStock.value || props.isLoadingStock || hasVisibleStockIssues.value || props.checkoutLocked);
const checkoutButtonLabel = computed(() => {
    if (props.checkoutLocked) return t('cartPage.checkoutLocked');
    if (hasVisibleStockIssues.value) return t('cartPage.fixStockFirst');
    return t('cartPage.checkout');
});

// Check if item exceeds its stock balance
const isExceedingStock = (item) => {
    if (isSalePremiumItem(item)) return false;
    // ตรวจสอบว่ามี balance_qty และเป็นค่าที่ใช้งานได้
    const balanceQty = toStockQty(item.balance_qty);
    return balanceQty !== null && toOrderQty(item.qty) > balanceQty;
};

// Check if item is out of stock
const isOutOfStock = (item) => {
    if (isSalePremiumItem(item)) return false;
    // ตรวจสอบว่ามี balance_qty และเป็นค่าที่ใช้งานได้
    const balanceQty = toStockQty(item.balance_qty);
    return balanceQty !== null && balanceQty <= 0;
};

const isStockBlocked = (item) => {
    const split = getPreorderSplit(item);
    return split.isBlockedByPreorderSetting || (isOutOfStock(item) && !isPreorderAllowed(item));
};

const getStockBlockMessage = (item) => {
    const maxQty = getMaxAvailable(item);
    if (maxQty <= 0) return t('cartPage.preorderOutOfStockHint');
    return t('cartPage.preorderNotAllowedHint', { qty: formatQty(maxQty), unit: item.unit_code });
};

const getPreorderSplitText = (item) => {
    const split = getPreorderSplit(item);
    return t('cartPage.preorderSplitLine', {
        ready: formatQty(split.readyQty),
        preorder: formatQty(split.preorderQty),
        unit: item.unit_code || ''
    });
};

const getStockIssueShortageQty = (issue) => {
    const explicitShortage = toCartNumber(issue?.shortage_qty, null);
    if (explicitShortage !== null) return Math.max(0, explicitShortage);
    return Math.max(0, toCartNumber(issue?.qty_in_cart, 0) - toCartNumber(issue?.balance_qty, 0));
};

// Get maximum available stock for an item
const getStockQtyOrNull = (item) => {
    return toStockQty(item.balance_qty);
};

const getMaxAvailable = (item) => {
    return getStockQtyOrNull(item) ?? 0;
};

async function adjustItemToAvailableStock(item) {
    const maxQty = getMaxAvailable(item);
    if (maxQty <= 0) {
        confirmRemoveItem(item);
        return;
    }
    await updateItemQuantity(item, maxQty);
}

// จำนวนสั่งสูงสุดต่อคำสั่งซื้อของรายการนี้ (REQ3) — server ส่งมาแล้วตรงหน่วย, null = ไม่จำกัด
function getMaxOrderQty(item) {
    return normalizeMaxOrderQty(item?.max_order_qty);
}

function isIncreaseQuantityDisabled(item) {
    return isMaxOrderQtyReached(item) || isStockBlocked({ ...item, qty: toOrderQty(item.qty) + 1 });
}

function warnMaxAllowance(item) {
    toast.add({
        severity: 'warn',
        summary: t('cartPage.stockNotEnough'),
        detail: t('productDetail.maxAllowanceHint', { max: getMaxOrderQty(item), unit: item.unit_code || '' }),
        life: 3000
    });
}

// Handle quantity changes
async function increaseQuantity(item) {
    const previousQty = toOrderQty(item.qty) || 1;
    try {
        // ห้ามเกินจำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3)
        const maxOrderQty = getMaxOrderQty(item);
        if (maxOrderQty !== null && previousQty + 1 > maxOrderQty) {
            warnMaxAllowance(item);
            return;
        }

        // ตรวจสอบก่อนว่าเพิ่มจำนวนแล้วจะเกินสต็อกหรือไม่
        const maxQty = getStockQtyOrNull(item);
        if (maxQty !== null) {
            if (!isPreorderAllowed(item) && toOrderQty(item.qty) + 1 > maxQty) {
                toast.add({
                    severity: 'warn',
                    summary: t('cartPage.stockNotEnough'),
                    detail: getStockBlockMessage(item),
                    life: 1500
                });
                return;
            }
        }

        // แปลงค่าเป็นตัวเลขก่อนบวก
        const newQty = previousQty + 1;
        item.qty = newQty;
        emit('set-cart-changed');
        await updateItemInCart(item);
    } catch (error) {
        console.error('Error updating quantity:', error);
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('cartPage.addQtyFailed'),
            life: 1500
        });
        // แปลงค่าเป็นตัวเลขก่อนลบ
        item.qty = previousQty;
    }
}

async function decreaseQuantity(item) {
    // แปลงค่าเป็นตัวเลขก่อนเปรียบเทียบ
    const currentQty = toOrderQty(item.qty);
    if (currentQty > 1) {
        try {
            // แปลงค่าเป็นตัวเลขก่อนลบ
            const newQty = currentQty - 1;
            item.qty = newQty;
            emit('set-cart-changed');
            await updateItemInCart(item);
        } catch (error) {
            console.error('Error updating quantity:', error);
            toast.add({
                severity: 'error',
                summary: t('common.error'),
                detail: t('cartPage.reduceQtyFailed'),
                life: 1500
            });
            // แปลงค่าเป็นตัวเลขก่อนบวก
            item.qty = currentQty;
        }
    }
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
async function removeItem(itemId) {
    try {
        // Remove from cart store
        await cartStore.removeFromCart(itemId);

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
        accept: () => removeItem(item.id)
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

    // ตรวจสอบ stock จาก API (ครอบคลุมทุกรายการในตะกร้า รวมที่ยังไม่ได้โหลด)
    try {
        isValidatingStock.value = true;

        // ดึง user_code จาก localStorage
        const userData = localStorage.getItem('_userData');
        const userObj = userData ? JSON.parse(userData) : null;
        const custCode = userObj?.user_code;

        if (!custCode) {
            toast.add({
                severity: 'error',
                summary: t('common.error'),
                detail: t('cartPage.customerMissing'),
                life: 3000
            });
            return;
        }

        const response = await CartService.validateCartStock(custCode);

        if (response?.data?.success) {
            if (response.data.is_valid) {
                // ไม่มีปัญหา stock ดำเนินการต่อได้
                emit('next-step');
            } else {
                // มีปัญหา stock แสดง dialog
                stockIssues.value = response.data.stock_issues || [];
                showStockIssuesDialog.value = true;
            }
        } else {
            // API error แต่ให้ดำเนินการต่อได้ (fallback)
            console.warn('validateCartStock API returned unsuccessful response');
            emit('next-step');
        }
    } catch (error) {
        console.error('Error validating cart stock:', error);
        // กรณี API error ให้แสดง error และไม่ให้ไปหน้าถัดไป
        toast.add({
            severity: 'error',
            summary: t('cartPage.stockCheckFailed'),
            detail: t('cartPage.stockCheckFailedDetail'),
            life: 5000
        });
        return;
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
    const item = props.items.find((row) => row.item_code === issue.item_code && row.unit_code === issue.unit_code);
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

function validateQuantity(item) {
    // ถ้าค่าว่างเปล่าหรือไม่ใช่ตัวเลข ให้กำหนดเป็น 1
    let numValue = toOrderQty(item.qty);
    if (numValue <= 0) {
        item.qty = 1;
        updateItemInCart(item);
        return;
    }

    // แปลงให้เป็นตัวเลข
    numValue = Math.floor(numValue);

    // ตรวจสอบว่าไม่ต่ำกว่า 1
    if (numValue < 1) {
        item.qty = 1;
        updateItemInCart(item);
        return;
    }

    // Check if quantity exceeds available stock
    const maxQty = getStockQtyOrNull(item);
    if (maxQty !== null) {
        if (!isPreorderAllowed(item) && numValue > maxQty) {
            toast.add({
                severity: 'warn',
                summary: t('cartPage.stockNotEnough'),
                detail: getStockBlockMessage(item),
                life: 2400
            });
            if (maxQty > 0) numValue = maxQty;
        }
    }

    // จำกัดตามจำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3)
    const maxOrderQty = getMaxOrderQty(item);
    if (maxOrderQty !== null && numValue > maxOrderQty) {
        warnMaxAllowance(item);
        numValue = maxOrderQty;
    }

    // ตัดศูนย์นำหน้า
    item.qty = numValue;

    // อัพเดทสินค้า
    emit('set-cart-changed');
    updateItemInCart(item);
}

// ฟังก์ชันสำหรับจำกัดให้พิมพ์ได้เฉพาะตัวเลข
function handleQuantityKeydown(event) {
    // อนุญาตให้กดปุ่มตัวเลข 0-9 บนคีย์บอร์ดหลักหรือปุ่มตัวเลขด้านข้าง
    const isNumber = /^[0-9]$/.test(event.key);
    // อนุญาตให้กดปุ่ม backspace, delete, tab, arrows
    const isControl = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(event.key);

    if (!isNumber && !isControl) {
        event.preventDefault();
    }
}
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
    <div v-else class="cart-step-shell">
        <div class="cart-toolbar">
            <!-- Row 1: Title + Stats -->
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3" :class="{ 'mb-3': showCartSearch }">
                <div>
                    <p class="cart-toolbar-kicker">{{ t('cartPage.reviewBasket') }}</p>
                    <h2 class="text-xl font-bold cart-toolbar-title">{{ t('cartPage.cartItems') }}</h2>
                </div>

                <div class="cart-toolbar-stats">
                    <div class="cart-toolbar-stat">
                        <span>{{ t('cartPage.productLines') }}</span>
                        <strong>{{ t('cart.itemCount', { count: totalLines }) }}</strong>
                        <small>{{ totalItems }} {{ t('common.piece') }}</small>
                    </div>
                </div>
            </div>

            <!-- Row 2: Search Box -->
            <div v-if="showCartSearch" class="flex items-center gap-2">
                <div class="relative flex-grow">
                    <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"></i>
                    <input
                        type="text"
                        v-model="localSearchQuery"
                        :placeholder="t('cartPage.cartSearchPlaceholder')"
                        class="cart-search-input w-full pl-10 pr-10 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-400"
                        @keydown="handleSearchKeydown"
                    />
                    <button v-if="localSearchQuery" type="button" :aria-label="t('common.clearSearch')" @click="handleClearSearch" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                        <i class="pi pi-times-circle"></i>
                    </button>
                </div>
                <Button icon="pi pi-search" aria-label="ค้นหาสินค้าในตะกร้า" class="cart-search-button" @click="handleSearch" :loading="isSearching" :disabled="isSearching" rounded />
            </div>
        </div>

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
                <div class="cart-items-heading">
                    <div>
                        <span class="cart-section-eyebrow">{{ t('cartPage.productLines') }}</span>
                        <h3>{{ t('cartPage.summaryLine', { lines: totalLines, items: totalItems }) }}</h3>
                    </div>
                    <Button icon="pi pi-trash" :label="t('cartPage.clearCart')" severity="secondary" text size="small" class="cart-clear-inline" @click="confirmClearCart" />
                </div>

                <div class="cart-items-stack">
            <div v-for="item in items" :key="item.id">
                <div class="cart-item-card rounded-xl" :class="{ 'cart-item-card--issue': !isLoadingStock && isStockBlocked(item) }">
                    <div class="cart-item-inner">
                        <!-- Product image — คลิกเพื่อเปิดหน้าสั่งสินค้า (รีวิว 260908 สไลด์ 5) -->
                        <button type="button" class="cart-item-img-wrap cart-item-link" :aria-label="getItemDisplayName(item)" @click="openProductDetail(item)">
                            <img :src="getProductImage(item)" :alt="item.item_code" class="w-full h-full object-contain" @error="handleImageError" />
                        </button>

                        <!-- Product info (left column) -->
                        <div class="cart-item-info">
                            <div class="cart-item-code-line">{{ item.item_code }}</div>
                            <div class="flex items-center gap-2 flex-wrap">
                                <button type="button" class="cart-item-name cart-item-link" @click="openProductDetail(item)">{{ getItemDisplayName(item) }}</button>
                                <span class="cart-unit-chip">{{ item.unit_code }}</span>
                                <Tag v-if="isSetItem(item)" :value="t('cartPage.setTag')" severity="info" class="text-xs" />
                                <Tag v-if="String(item.item_type) === '4' || item.sale_premium_code" value="โปรโมชันของแถม" severity="danger" icon="pi pi-gift" class="text-xs" />
                                <Button
                                    v-if="isSetItem(item) && cartStore.setItemsCache[item.item_code]?.length > 0"
                                    :icon="isExpanded(item.item_code) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                                    text rounded size="small"
                                    :aria-label="isExpanded(item.item_code) ? 'ซ่อนรายการสินค้าในชุด' : 'แสดงรายการสินค้าในชุด'"
                                    @click="toggleSetItems(item.item_code)"
                                    class="p-1"
                                />
                            </div>
                            <div v-if="item.category" class="cart-item-category">{{ item.category }}</div>

                            <!-- Stock badge -->
                            <div v-if="isLoadingStock" class="cart-stock-badge cart-stock-badge--loading">
                                <i class="pi pi-spin pi-spinner"></i> {{ t('cartPage.checkingStock') }}
                            </div>
                            <div v-else-if="getPreorderSplit(item).hasPreorder" class="cart-stock-badge cart-stock-badge--preorder">
                                <i class="pi pi-clock"></i>
                                {{ getPreorderSplitText(item) }}
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
                            <div v-if="!isLoadingStock && isStockBlocked(item)" class="cart-stock-action-row">
                                <Button v-if="isExceedingStock(item)" :label="t('cartPage.adjustToStock')" icon="pi pi-check" size="small" text @click="adjustItemToAvailableStock(item)" />
                                <Button v-else :label="t('cartPage.removeItem')" icon="pi pi-trash" severity="danger" size="small" text @click="confirmRemoveItem(item)" />
                            </div>
                            <div v-if="!isLoadingStock && isStockBlocked(item)" class="cart-stock-block-hint">
                                <i class="pi pi-info-circle"></i>
                                <span>{{ getStockBlockMessage(item) }}</span>
                            </div>
                        </div>

                        <!-- Right column: price + qty + remove -->
                        <div class="cart-item-right">
                            <Button icon="pi pi-trash" :label="t('cartPage.removeItem')" severity="danger" text size="small" class="cart-item-remove" @click="confirmRemoveItem(item)" />

                            <div class="cart-item-price-block">
                                <span class="cart-item-total-price">฿{{ formatNumber(getLineTotal(item)) }}</span>
                                <span class="cart-item-unit-price">฿{{ formatNumber(item.price) }} / {{ item.unit_code }}</span>
                                <!-- ตัวคูณหน่วย เช่น "1 ลัง = 24 ชิ้น" (รีวิว 260908 สไลด์ 1) -->
                                <span v-if="unitRatioTextOf(item)" class="cart-item-unit-ratio">{{ unitRatioTextOf(item) }}</span>
                            </div>

                            <div class="cart-item-qty-row">
                                <Button icon="pi pi-minus" text rounded size="small" class="qty-step-btn" :aria-label="`ลดจำนวน ${getItemDisplayName(item)}`" @click="decreaseQuantity(item)" :disabled="toOrderQty(item.qty) <= 1" />
                                <input
                                    type="text"
                                    v-model="item.qty"
                                    class="qty-input"
                                    :aria-label="`จำนวน ${getItemDisplayName(item)}`"
                                    @blur="validateQuantity(item)"
                                    @keydown="handleQuantityKeydown($event)"
                                    :class="{ 'qty-input--error': isStockBlocked(item) }"
                                />
                                <Button
                                    icon="pi pi-plus"
                                    text rounded size="small"
                                    class="qty-step-btn"
                                    :aria-label="`เพิ่มจำนวน ${getItemDisplayName(item)}`"
                                    @click="increaseQuantity(item)"
                                    :disabled="isIncreaseQuantityDisabled(item)"
                                />
                            </div>
                        </div>
                    </div>
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
            </section>

            <aside class="cart-summary-card">
                <p class="cart-summary-kicker">{{ t('cartPage.reviewBasket') }}</p>
                <h3>{{ t('common.total') }}</h3>
                <div class="cart-summary-total">฿{{ formatNumber(totalAmount) }}</div>
                <div class="cart-summary-lines">
                    <div>
                        <span>{{ t('cartPage.productLines') }}</span>
                        <strong>{{ t('cart.itemCount', { count: totalLines }) }}</strong>
                    </div>
                    <div>
                        <span>{{ t('common.piece') }}</span>
                        <strong>{{ totalItems }} {{ t('common.piece') }}</strong>
                    </div>
                </div>
                <div v-if="checkoutBlockMessage" class="cart-summary-warning">
                    <i class="pi pi-exclamation-triangle"></i>
                    <span>{{ checkoutBlockMessage }}</span>
                </div>
                <div v-else-if="preorderLineCount > 0" class="cart-summary-preorder">
                    <i class="pi pi-clock"></i>
                    <span>{{ t('cartPage.preorderSummaryLine', { count: preorderLineCount }) }}</span>
                </div>
                <Button
                    :label="checkoutButtonLabel"
                    icon="pi pi-shopping-cart"
                    iconPos="right"
                    @click="proceedToCheckout"
                    :loading="isValidatingStock"
                    :disabled="isCheckoutDisabled"
                    class="footer-checkout-btn cart-summary-checkout"
                />
                <Button :label="t('cartPage.continueShopping')" icon="pi pi-arrow-left" outlined severity="secondary" class="cart-summary-back" @click="emit('go-to-shop')" />
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
    background: linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #fdf9f1) 100%);
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1.4rem;
    padding: 1.15rem;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.cart-toolbar {
    background: linear-gradient(135deg, var(--market-surface-soft, #fff7e7) 0%, var(--market-card-bg, #fffefb) 100%);
    border: 1px solid var(--market-card-border, #ead9b5);
    border-radius: 1.1rem;
    padding: 1rem;
    box-shadow: 0 14px 24px var(--market-shadow, rgba(140, 111, 53, 0.1));
}

.cart-toolbar-kicker {
    margin: 0 0 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--market-primary, #b28b46);
}

.cart-toolbar-title {
    color: var(--market-text, #5b4a27);
}

.cart-toolbar-stats {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
}

.cart-toolbar-stat {
    min-width: 7.5rem;
    padding: 0.7rem 0.9rem;
    border-radius: 0.95rem;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 82%, transparent);
    border: 1px solid var(--market-card-border, #ead9b5);
    display: grid;
    gap: 0.15rem;
}

.cart-toolbar-stat span {
    font-size: 0.72rem;
    color: var(--market-muted, #9b8a67);
}

.cart-toolbar-stat strong {
    color: var(--market-text, #5b4a27);
}

.cart-toolbar-stat small {
    font-size: 0.7rem;
    color: var(--market-primary, #b28b46);
    line-height: 1.15;
}

/* ── Cart Item Card ── */
.cart-item-card {
    background: linear-gradient(180deg, var(--market-card-bg, #fffdf8) 0%, var(--market-surface-soft, #fffaf0) 100%);
    border: 1px solid var(--market-card-border, #efe3c8);
    border-left: 4px solid var(--market-primary, #d9b86c);
    box-shadow: 0 2px 12px var(--market-shadow, rgba(140, 111, 53, 0.07));
    transition: box-shadow 0.15s ease;
}

.cart-item-card:hover {
    box-shadow: 0 4px 18px var(--market-shadow, rgba(140, 111, 53, 0.13));
}

.cart-item-card--issue {
    border-left-color: #f97316;
    box-shadow:
        0 2px 14px rgba(249, 115, 22, 0.12),
        0 0 0 1px rgba(249, 115, 22, 0.12);
}

.cart-item-inner {
    display: grid;
    grid-template-columns: 5rem 1fr auto;
    gap: 1rem;
    align-items: center;
    padding: 0.85rem 1rem;
}

/* Product thumbnail */
.cart-item-img-wrap {
    width: 5rem;
    height: 5rem;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 0.6rem;
    border: 1px solid var(--market-card-border, #ebddbf);
    background: var(--market-card-bg, #fffefb);
}

/* Info column */
.cart-item-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

.cart-item-code-line {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--market-primary, #b28b46);
    text-transform: uppercase;
}

/* ชื่อ/รูปที่กดได้ — ต้องดูเหมือนของเดิม ไม่ใช่ปุ่ม */
.cart-item-link {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.cart-item-link:hover {
    text-decoration: underline;
}

.cart-item-img-wrap.cart-item-link:hover {
    text-decoration: none;
    opacity: 0.85;
}

.cart-item-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--market-text, #3d2f14);
    line-height: 1.3;
}

.cart-unit-chip {
    display: inline-flex;
    align-items: center;
    min-height: 1.35rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: var(--market-primary-soft, #fff3d0);
    border: 1px solid color-mix(in srgb, var(--market-primary, #8a5e1a) 22%, var(--market-card-border, #ead39a));
    color: var(--market-primary, #8a5e1a);
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
}

.cart-item-category {
    font-size: 0.72rem;
    color: var(--market-muted, #9b8a67);
}

/* Stock badges */
.cart-stock-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    font-weight: 500;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    width: fit-content;
    margin-top: 0.15rem;
}

.cart-stock-badge--loading {
    background: #f3f4f6;
    color: #9ca3af;
}
.cart-stock-badge--out {
    background: #fee2e2;
    color: #dc2626;
}
.cart-stock-badge--warn {
    background: #fff3cd;
    color: #b45309;
}
.cart-stock-badge--preorder {
    background: #eff6ff;
    color: #1d4ed8;
}
.cart-stock-badge--ok {
    background: #f0fdf4;
    color: #16a34a;
}

.cart-stock-action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.2rem;
}

.cart-stock-block-hint {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    max-width: 28rem;
    margin-top: 0.25rem;
    color: #9a3412;
    font-size: 0.76rem;
    line-height: 1.35;
}

.cart-stock-block-hint i {
    flex-shrink: 0;
    margin-top: 0.08rem;
    color: #f97316;
}

/* Right column */
.cart-item-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
    min-width: 9rem;
}

.cart-item-remove {
    margin-bottom: -0.25rem;
}

.cart-item-price-block {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
}

.cart-item-total-price {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--market-text, #5b4a27);
    line-height: 1;
}

.cart-item-unit-ratio {
    font-size: 0.7rem;
    color: var(--market-muted, #9a8f7a);
    line-height: 1.3;
}

.cart-item-unit-price {
    font-size: 0.72rem;
    color: var(--market-muted, #9b8a67);
}

/* Qty control */
.cart-item-qty-row {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 78%, transparent);
    border: 1px solid var(--market-card-border, #ead9b5);
    border-radius: 999px;
    padding: 0.1rem 0.25rem;
}

.qty-step-btn {
    color: var(--market-primary, #7b5f2a) !important;
    width: 1.75rem !important;
    height: 1.75rem !important;
}

.qty-input {
    width: 2.25rem;
    text-align: center;
    font-size: 0.9rem;
    font-weight: 600;
    border: none;
    background: transparent;
    outline: none;
    color: var(--market-text, #3d2f14);
}

.qty-input--error {
    color: #dc2626;
}

/* Search */
.search-result-chip {
    background: var(--market-surface-soft, #f9f2e1);
    border: 1px solid var(--market-card-border, #ebddbf);
}

.cart-stock-alert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.85rem;
    padding: 0.8rem 0.95rem;
    border-radius: 1rem;
    border: 1px solid rgba(249, 115, 22, 0.28);
    background: linear-gradient(135deg, rgba(255, 247, 237, 0.96), rgba(255, 251, 235, 0.96));
    color: #92400e;
    box-shadow: 0 10px 20px rgba(249, 115, 22, 0.08);
}

.cart-stock-alert > div {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.55rem;
    row-gap: 0.1rem;
    align-items: center;
    min-width: 0;
}

.cart-stock-alert i {
    grid-row: 1 / 3;
    color: #f97316;
}

.cart-stock-alert strong {
    font-size: 0.9rem;
    color: #7c2d12;
    line-height: 1.2;
}

.cart-stock-alert span {
    font-size: 0.78rem;
    color: #a16207;
    line-height: 1.25;
}

.cart-search-input {
    border-color: var(--market-card-border, #ead9b5);
    background: color-mix(in srgb, var(--market-card-bg, #fff) 95%, transparent);
    color: var(--market-text, #3d2f14);
}

.cart-search-button {
    flex-shrink: 0;
}

/* Set items expand */
.set-item-row {
    background: var(--market-surface-soft, #fdf7ea);
    border: 1px dashed var(--market-card-border, #e6d3ac);
}

/* Stack */
.cart-items-stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

/* โหลดต่อเนื่อง */
.cart-load-more {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 2.75rem;
    padding: 0.75rem 0 0.25rem;
}

.cart-load-more__spinner {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--market-muted, #64748b);
    font-size: 0.85rem;
}

.cart-load-more__btn {
    border: 1px solid var(--market-card-border, #e2e8f0);
    background: transparent;
    color: var(--market-muted, #64748b);
    border-radius: 999px;
    padding: 0.45rem 1.1rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}

.cart-load-more__btn:hover {
    background: var(--market-surface-soft, #f8fafc);
}

/* Action bar */
.action-summary-bar {
    background: var(--market-surface-soft, #fffaf0);
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1rem;
    padding: 0.9rem 1.1rem;
}

.footer-actions {
    position: sticky;
    bottom: 0.75rem;
    z-index: 8;
    gap: 0.85rem;
    padding: 0.75rem;
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--market-surface-soft, #fffaf0) 96%, transparent);
    box-shadow: 0 14px 28px var(--market-shadow, rgba(91, 74, 39, 0.16));
    backdrop-filter: blur(10px);
}

.footer-summary-mini {
    margin-left: auto;
    display: grid;
    gap: 0.1rem;
    text-align: right;
    color: var(--market-text, #5b4a27);
}

.footer-summary-mini span,
.footer-summary-mini small {
    font-size: 0.76rem;
    color: var(--market-muted, #9b8a67);
    line-height: 1.2;
}

.footer-summary-mini strong {
    font-size: 1.12rem;
    line-height: 1.1;
    color: var(--market-primary, #8a5e1a);
}

.footer-summary-mini small {
    color: #b45309;
    max-width: 18rem;
}

:deep(.footer-back-btn.p-button) {
    color: var(--market-muted, #9b8a67);
    font-size: 0.88rem;
    padding: 0.5rem 0.75rem;
}
:deep(.footer-back-btn.p-button:hover) {
    color: var(--market-text, #5b4a27);
    background: var(--market-surface-soft, #fdf7ea);
}

:deep(.footer-checkout-btn.p-button) {
    background: linear-gradient(120deg, var(--market-primary, #e6c885) 0%, color-mix(in srgb, var(--market-primary, #d3af67) 74%, var(--market-accent, #f97316)) 100%);
    border-color: var(--market-primary, #c8a45d);
    color: var(--market-card-bg, #4a3300);
    font-size: 0.95rem;
    font-weight: 700;
    padding: 0.65rem 1.4rem;
    box-shadow: 0 3px 10px color-mix(in srgb, var(--market-primary, #c89b28) 30%, transparent);
    letter-spacing: 0.01em;
    border-radius: 8px;
}
:deep(.footer-checkout-btn.p-button:hover:not(:disabled)) {
    background: linear-gradient(120deg, color-mix(in srgb, var(--market-primary, #ddbf79) 90%, #fff) 0%, var(--market-primary, #c8a45d) 100%);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--market-primary, #c89b28) 38%, transparent);
    transform: translateY(-1px);
}
:deep(.footer-checkout-btn.p-button:disabled) {
    opacity: 0.55;
}

/* Primary buttons */
:deep(.cart-step-shell .p-button:not(.p-button-text):not(.p-button-outlined)) {
    background: linear-gradient(120deg, var(--market-primary, #e6c885) 0%, color-mix(in srgb, var(--market-primary, #d3af67) 76%, var(--market-accent, #f97316)) 100%);
    border-color: var(--market-primary, #d3af67);
    color: var(--market-card-bg, #5b4a27);
}

:deep(.cart-step-shell .p-button:not(.p-button-text):not(.p-button-outlined):hover) {
    background: linear-gradient(120deg, color-mix(in srgb, var(--market-primary, #ddbf79) 90%, #fff) 0%, var(--market-primary, #c8a45d) 100%);
    border-color: var(--market-primary, #c8a45d);
}

/* Toolbar stat highlight */
.cart-toolbar-stat--highlight {
    background: linear-gradient(135deg, var(--market-primary-soft, #fff3d0) 0%, var(--market-accent-soft, #fde9a8) 100%) !important;
    border-color: var(--market-primary, #d9b86c) !important;
}

.cart-toolbar-stat--highlight strong {
    color: var(--market-primary, #8a5e1a);
    font-size: 1rem;
}

.cart-step-shell {
    background: color-mix(in srgb, var(--market-card-bg, #fff) 94%, var(--market-surface-soft, #f8fafc));
    border-color: color-mix(in srgb, var(--market-card-border, #e2e8f0) 82%, transparent);
    border-radius: var(--market-radius-lg, 18px);
    padding: 1rem;
    box-shadow: 0 16px 36px color-mix(in srgb, var(--market-shadow, rgba(15, 23, 42, 0.1)) 70%, transparent);
}

.cart-toolbar {
    background: var(--market-card-bg, #fff);
    border-color: color-mix(in srgb, var(--market-card-border, #e2e8f0) 80%, transparent);
    border-radius: var(--market-radius-md, 14px);
    box-shadow: none;
}

.cart-toolbar-stat {
    border-radius: var(--market-radius-md, 14px);
}

.cart-review-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 21rem);
    gap: 1rem;
    align-items: start;
}

.cart-items-panel,
.cart-summary-card {
    background: var(--market-card-bg, #fff);
    border: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 86%, transparent);
    border-radius: var(--market-radius-lg, 18px);
    box-shadow: 0 10px 24px color-mix(in srgb, var(--market-shadow, rgba(15, 23, 42, 0.08)) 62%, transparent);
}

.cart-items-panel {
    padding: 1rem;
    min-width: 0;
}

.cart-items-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.9rem;
    margin-bottom: 0.9rem;
    border-bottom: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 78%, transparent);
}

.cart-section-eyebrow,
.cart-summary-kicker {
    display: block;
    margin-bottom: 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.67rem;
    font-weight: 800;
    color: var(--market-primary, #2563eb);
}

.cart-items-heading h3,
.cart-summary-card h3 {
    margin: 0;
    color: var(--market-text, #0f172a);
    font-size: 1.05rem;
    font-weight: 800;
}

:deep(.cart-clear-inline.p-button) {
    color: var(--market-muted, #64748b);
    white-space: nowrap;
}

.cart-summary-card {
    position: sticky;
    top: 5.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.95rem;
    padding: 1rem;
}

.cart-summary-total {
    color: var(--market-primary, #2563eb);
    font-size: clamp(1.75rem, 4vw, 2.25rem);
    font-weight: 900;
    line-height: 1;
}

.cart-summary-lines {
    display: grid;
    gap: 0.6rem;
    padding: 0.85rem;
    border-radius: var(--market-radius-md, 14px);
    background: color-mix(in srgb, var(--market-surface-soft, #f8fafc) 88%, transparent);
}

.cart-summary-lines div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--market-muted, #64748b);
    font-size: 0.85rem;
}

.cart-summary-lines strong {
    color: var(--market-text, #0f172a);
    font-weight: 800;
    text-align: right;
}

.cart-summary-warning,
.cart-summary-preorder {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.75rem;
    border-radius: var(--market-radius-md, 14px);
    font-size: 0.83rem;
    line-height: 1.35;
}

.cart-summary-warning {
    background: #fff7ed;
    color: #9a3412;
}

.cart-summary-preorder {
    background: #eff6ff;
    color: #1d4ed8;
}

.cart-summary-checkout,
.cart-summary-back {
    width: 100%;
    justify-content: center;
}

.cart-item-card {
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 88%, transparent);
    border-left: 0;
    border-radius: var(--market-radius-md, 14px);
    background: var(--market-card-bg, #fff);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--market-shadow, rgba(15, 23, 42, 0.07)) 64%, transparent);
}

.cart-item-card:hover {
    box-shadow: 0 10px 24px color-mix(in srgb, var(--market-shadow, rgba(15, 23, 42, 0.11)) 78%, transparent);
}

.cart-item-card--issue {
    border-color: rgba(249, 115, 22, 0.36);
    box-shadow:
        0 8px 22px rgba(249, 115, 22, 0.12),
        inset 4px 0 0 #f97316;
}

.cart-item-inner {
    grid-template-columns: 6.25rem minmax(0, 1fr) minmax(10.5rem, auto);
    gap: 1rem;
    padding: 1rem;
}

.cart-item-img-wrap {
    width: 6.25rem;
    height: 6.25rem;
    border-radius: var(--market-radius-sm, 10px);
    background: color-mix(in srgb, var(--market-surface-soft, #f8fafc) 70%, #fff);
}

.cart-item-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.cart-item-name {
    font-size: 1rem;
    font-weight: 800;
}

.cart-item-right {
    min-width: 10.5rem;
    gap: 0.6rem;
}

:deep(.cart-item-remove.p-button) {
    align-self: flex-end;
    color: #dc2626;
    padding: 0.25rem 0.35rem;
}

.cart-item-total-price {
    font-size: 1.22rem;
    font-weight: 900;
}

.cart-item-qty-row {
    gap: 0.25rem;
    padding: 0.22rem 0.35rem;
}

.qty-step-btn {
    width: 2rem !important;
    height: 2rem !important;
}

.qty-input {
    width: 2.75rem;
    font-size: 1rem;
}

.set-items-panel {
    margin: 0.5rem 0 0.75rem 1.25rem;
    padding-left: 0.8rem;
    border-left: 2px solid color-mix(in srgb, var(--market-primary, #2563eb) 30%, transparent);
}

.set-item-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem;
    border-radius: var(--market-radius-sm, 10px);
}

.set-item-thumb {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
}

.set-item-qty {
    color: var(--market-muted, #64748b);
    flex-shrink: 0;
    font-size: 0.82rem;
    text-align: right;
}

.set-item-qty span {
    color: color-mix(in srgb, var(--market-muted, #64748b) 70%, transparent);
}

/* Reduced chrome: keep only product cards and the order summary as real cards. */
.cart-step-shell {
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 0;
    box-shadow: none;
}

.cart-toolbar {
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 0 0 0.9rem;
    box-shadow: none;
}

.cart-toolbar-stats {
    display: none;
}

.cart-toolbar-kicker {
    letter-spacing: 0.08em;
}

.cart-review-layout {
    gap: 1.25rem;
}

.cart-items-panel {
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    padding: 0;
}

.cart-items-heading {
    padding: 0 0 0.75rem;
    margin-bottom: 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 70%, transparent);
}

.cart-section-eyebrow,
.cart-summary-kicker {
    letter-spacing: 0.08em;
}

.cart-item-card {
    border-color: color-mix(in srgb, var(--market-card-border, #e2e8f0) 72%, transparent);
    box-shadow: 0 6px 18px color-mix(in srgb, var(--market-shadow, rgba(15, 23, 42, 0.08)) 50%, transparent);
}

.cart-summary-card {
    border-color: color-mix(in srgb, var(--market-card-border, #e2e8f0) 72%, transparent);
    box-shadow: 0 10px 24px color-mix(in srgb, var(--market-shadow, rgba(15, 23, 42, 0.08)) 58%, transparent);
}

.cart-summary-lines {
    background: transparent;
    border-top: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 70%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 70%, transparent);
    border-radius: 0;
    padding: 0.75rem 0;
}

/* Responsive */
@media (max-width: 1024px) {
    .cart-review-layout {
        grid-template-columns: 1fr;
    }

    /* จอแคบ: การ์ดสรุปตกลงมาต่อท้ายลิสต์ ถ้าปล่อยเป็น static ผู้ใช้ต้องเลื่อน
       ผ่านสินค้าทั้งตะกร้าถึงจะเห็นยอดรวม — รีวิว 260908 สไลด์ 4 สั่งให้ freeze ไว้
       ใช้ sticky bottom แทน fixed เพื่อไม่ต้องจองพื้นที่ท้ายหน้าและไม่ทับ footer อื่น */
    .cart-summary-card {
        position: sticky;
        top: auto;
        bottom: calc(var(--app-bottomnav-h, 0px) + var(--app-safe-bottom, 0px));
        z-index: 20;
        box-shadow: 0 -10px 26px color-mix(in srgb, var(--market-shadow, rgba(15, 23, 42, 0.12)) 70%, transparent);
    }

    /* ยอดรวมกับปุ่มต้องเห็นเสมอ ส่วนรายละเอียดยิบย่อยยุบได้ */
    .cart-summary-kicker,
    .cart-summary-back {
        display: none;
    }

    .cart-summary-card h3 {
        font-size: 0.9rem;
    }
}

@media (max-width: 640px) {
    .cart-toolbar {
        padding: 0.85rem;
    }

    .cart-toolbar-stats {
        width: 100%;
    }

    .cart-toolbar-stat {
        flex: 1 1 0;
    }

    .cart-items-panel,
    .cart-summary-card {
        padding: 0.85rem;
        border-radius: var(--market-radius-md, 14px);
    }

    .cart-items-heading {
        align-items: flex-start;
        flex-direction: column;
    }

    .cart-item-inner {
        grid-template-columns: 4.75rem 1fr;
        grid-template-rows: auto auto;
        gap: 0.8rem;
        padding: 0.8rem;
    }

    .cart-item-img-wrap {
        width: 4.75rem;
        height: 4.75rem;
    }

    .cart-item-right {
        grid-column: 1 / -1;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        min-width: unset;
        padding-top: 0.5rem;
        border-top: 1px solid var(--market-card-border, #efe3c8);
    }

    .cart-item-remove {
        margin-bottom: 0;
    }

    .cart-stock-alert {
        align-items: stretch;
        flex-direction: column;
    }
}
</style>
