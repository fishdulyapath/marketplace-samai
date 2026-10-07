<script setup>
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import CartService from '@/services/CartService';
import ProductService from '@/services/ProductService';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { isSalePremiumItem } from '@/utils/itemType';
import { withProductDisplay } from '@/utils/languageDisplay';
import { useToast } from 'primevue/usetoast';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

// Import step components
import StepCart from '@/components/cart/StepCart.vue';
import StepComplete from '@/components/cart/StepComplete.vue';
import StepConfirmation from '@/components/cart/StepConfirmation.vue';

const activeStep = ref(0);
const toast = useToast();
const router = useRouter();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = languageStore.t;
const isLoading = ref(true);

// Login error dialog
const showLoginRequiredDialog = ref(false);
const loginErrorMessage = ref('');

// Order result data for completion page
const orderResult = ref({
    orderNumber: '',
    orderNumbers: [],
    orderDocuments: [],
    orderDate: '',
    orderTime: '',
    partial: false,
    preorder: false
});

// User data
const userType = ref('');
const userData = ref({});

// Cart data - will be passed to child components
const localCartItems = ref([]);
const hasCartChanges = ref(false);
const cartUpdateQueues = new Map();

// dialog สั่งสินค้าที่เปิดจากบรรทัดในตะกร้า
const selectedProductCode = ref('');
const selectedProductIsSet = ref(false);
const showProductDialog = ref(false);

function openProductFromCart(item) {
    const code = String(item?.item_code || '').trim();
    if (!code) return;
    selectedProductCode.value = code;
    selectedProductIsSet.value = String(item?.item_type ?? '0') === '3';
    showProductDialog.value = true;
}

// ปิด dialog แล้วต้องดึงตะกร้าใหม่ เพราะผู้ใช้อาจเพิ่ม/แก้จำนวนในหน่วยอื่นไป
watch(showProductDialog, (open) => {
    if (!open) refreshCurrentPage();
});

// สถานะการโหลดแบบต่อท้าย (รีวิว 260908 สไลด์ 4: ตัดระบบเลขหน้าออก ใช้ scroll ไปเรื่อยๆ)
// currentPage ยังอยู่ แต่ความหมายเปลี่ยนเป็น "หน้าสุดท้ายที่โหลดมาแล้ว" ไม่ใช่หน้าที่กำลังดู
const currentPage = ref(1);
const pageSize = ref(20);
const totalCartCount = ref(0);
const totalPages = ref(1);
const isChangingPage = ref(false);
// โหลดชุดถัดไปอยู่ — แยกจาก isChangingPage เพื่อไม่ให้ทั้งลิสต์กะพริบตอน scroll
const isLoadingMore = ref(false);
const hasMoreCartItems = computed(() => localCartItems.value.length < totalCartCount.value);

// Search state
const searchQuery = ref('');
const isSearching = ref(false);

// Stock loading state
const isLoadingStock = ref(false);
const isProcessingCheckout = ref(false);

function isSetItem(item) {
    return String(item?.item_type || '') === '3';
}

function toCartNumber(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toCartQty(value) {
    const qty = Math.trunc(toCartNumber(value, 0));
    return qty > 0 ? qty : 0;
}

function normalizeLocalCartItem(item = {}) {
    return withProductDisplay({
        ...item,
        id: item.id || item.guid_code,
        name: item.name || item.item_name,
        qty: toCartQty(item.qty || item.quantity),
        price: toCartNumber(item.price)
    });
}

function getCartUpdateKey(item = {}) {
    const itemCode = String(item.item_code || item.code || item.id || '').trim();
    const unitCode = String(item.unit_code || item.unit || '').trim();
    if (itemCode) return `${itemCode}::${unitCode}`;
    return String(item.guid_code || item.id || 'cart-line').trim();
}

async function waitForCartUpdateQueues() {
    const pendingUpdates = Array.from(cartUpdateQueues.values());
    if (pendingUpdates.length > 0) {
        await Promise.allSettled(pendingUpdates);
    }
}

function applyLocalCartItemSnapshot(item = {}) {
    const key = getCartUpdateKey(item);
    const index = localCartItems.value.findIndex(
        (cartItem) => getCartUpdateKey(cartItem) === key || (item.guid_code && cartItem.guid_code === item.guid_code) || (item.id && cartItem.id === item.id)
    );
    if (index === -1) return;
    localCartItems.value[index] = normalizeLocalCartItem({
        ...localCartItems.value[index],
        ...item
    });
}

// Order data - shared between steps
const orderData = ref({
    deliveryMethod: 'pickup',
    employeeCode: '',
    customerCode: '',
    deliveryAddress: '',
    deliveryTelephone: '',
    // เพิ่มฟิลด์ใหม่
    send_type: '0',
    address: '',
    address_name: '',
    telephone: ''
});

const dateLocale = computed(() => (languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'));

const partialSavedDocNos = computed(() => {
    const docs = Array.isArray(orderResult.value.orderNumbers) ? orderResult.value.orderNumbers.filter(Boolean).join(', ') : '';
    return docs || orderResult.value.orderNumber || '-';
});
const hasPartialSavedDocs = computed(() => Boolean(orderResult.value.partial));
const partialSavedDocText = computed(() => {
    if (!hasPartialSavedDocs.value) return '';
    return t('cartFlow.partialCartReviewNotice', { docNos: partialSavedDocNos.value });
});
const partialCheckoutLockText = computed(() => {
    if (!hasPartialSavedDocs.value) return '';
    return t('cartFlow.partialCheckoutLockedNotice', { docNos: partialSavedDocNos.value });
});

function resetOrderResultState() {
    orderResult.value = {
        orderNumber: '',
        orderNumbers: [],
        orderDocuments: [],
        orderDate: '',
        orderTime: '',
        partial: false,
        preorder: false
    };
}

function releasePartialCheckoutLockIfCartEmpty(cartData = [], totalCount = 0) {
    if (String(searchQuery.value || '').trim()) return;
    const remainingCount = Math.trunc(toCartNumber(totalCount, cartData.length));
    if (hasPartialSavedDocs.value && remainingCount <= 0) {
        resetOrderResultState();
    }
}

function checkoutErrorToastLife(message) {
    const text = String(message || '');
    return text.includes('\n') || text.length > 120 ? 8000 : 3000;
}

function getApiErrorMessage(error) {
    const data = error?.response?.data;
    if (typeof data === 'string' && data.trim()) return data.trim();
    if (data && typeof data === 'object') {
        const message = String(data.message || data.msg || data.ERROR || '').trim();
        if (message) return message;
    }
    return String(error?.message || '').trim();
}

// Initialize component
onMounted(() => checkAuthentication());

// Save changes before leaving
onBeforeUnmount(() => saveCartChanges());

// Authentication check
async function checkAuthentication() {
    isLoading.value = true;

    try {
        const token = localStorage.getItem('_token');

        if (!token) {
            toast.add({
                severity: 'warn',
                summary: t('cartFlow.loginRequiredSummary'),
                detail: t('cartFlow.loginRequiredDetail'),
                life: 3000
            });
            router.push('/auth/login');
            return;
        }

        // Get user type and data from storage
        userType.value = localStorage.getItem('_userType') || '';

        const userDataStr = localStorage.getItem('_userData');
        if (userDataStr) {
            try {
                userData.value = JSON.parse(userDataStr);

                // Pre-fill delivery info from user data
                orderData.value.deliveryAddress = userData.value.address || '';
                orderData.value.deliveryTelephone = userData.value.telephone || '';

                // Fetch cart items
                await fetchCartItems();
            } catch (error) {
                console.error('Error parsing user data:', error);
            }
        }
    } catch (error) {
        console.error('Error checking authentication:', error);
        router.push('/auth/login');
    } finally {
        isLoading.value = false;
    }
}

async function fetchCartItems(resetPage = false) {
    try {
        isChangingPage.value = true;

        // Reset to page 1 if requested (e.g., after delete/clear cart or search)
        if (resetPage) {
            currentPage.value = 1;
        }

        const response = await CartService.getCartItems(userData.value.user_code, currentPage.value, pageSize.value, searchQuery.value);
        if (response?.data) {
            const cartData = response.data.data || [];
            // อัปเดต localCartItems
            localCartItems.value = cartData.map(normalizeLocalCartItem);

            // อัปเดต pagination state
            totalCartCount.value = response.data.total_count || cartData.length;
            totalPages.value = Math.ceil(totalCartCount.value / pageSize.value) || 1;
            releasePartialCheckoutLockIfCartEmpty(cartData, totalCartCount.value);

            // สำคัญ: ซิงค์กับ Pinia store เพื่อให้ MiniCart แสดงข้อมูลเดียวกัน
            cartStore.syncWithApiData(localCartItems.value);

            // อัปเดต totalCartCount ใน store สำหรับ MiniCart
            cartStore.setTotalCartCount(totalCartCount.value);

            // ดึงยอดรวมราคาและจำนวนจาก API
            await cartStore.fetchCartSummary();

            // ดึง stock สำหรับรายการที่โหลดมา
            await fetchStockForItems(localCartItems.value);
        }
    } catch (error) {
        console.error('Error fetching cart items:', error);
        // โค้ดจัดการข้อผิดพลาด
    } finally {
        isChangingPage.value = false;
    }
}

// โหลดสินค้าชุดถัดไปต่อท้ายลิสต์ (แทนการกดเลขหน้า)
// ห้ามแตะ localCartItems ที่โหลดมาแล้ว ไม่งั้นจำนวนที่ผู้ใช้เพิ่งแก้จะเด้งกลับ
async function loadMoreCartItems() {
    if (isLoadingMore.value || isChangingPage.value || !hasMoreCartItems.value) return;

    try {
        isLoadingMore.value = true;
        const nextPage = currentPage.value + 1;
        const response = await CartService.getCartItems(userData.value.user_code, nextPage, pageSize.value, searchQuery.value);
        if (!response?.data) return;

        const cartData = response.data.data || [];
        currentPage.value = nextPage;
        totalCartCount.value = response.data.total_count || totalCartCount.value;
        totalPages.value = Math.ceil(totalCartCount.value / pageSize.value) || 1;

        // กันรายการซ้ำ เผื่อมีคนแก้ตะกร้าจากอีกแท็บระหว่างที่เรากำลังเลื่อน
        const seen = new Set(localCartItems.value.map((item) => item.guid_code || item.id));
        const fresh = cartData.map(normalizeLocalCartItem).filter((item) => !seen.has(item.guid_code || item.id));
        if (fresh.length === 0) return;

        localCartItems.value = [...localCartItems.value, ...fresh];
        cartStore.syncWithApiData(localCartItems.value);
        cartStore.setTotalCartCount(totalCartCount.value);
        await fetchStockForItems(fresh);
    } catch (error) {
        console.error('Error loading more cart items:', error);
    } finally {
        isLoadingMore.value = false;
    }
}

// ค้นหาสินค้าในตะกร้า
async function searchCartItems(query) {
    searchQuery.value = query;
    isSearching.value = true;
    currentPage.value = 1; // กลับไปหน้าแรกเสมอเมื่อค้นหา
    await fetchCartItems(true); // reset to page 1 when searching
    isSearching.value = false;
}

// ล้างการค้นหา
async function clearSearch() {
    searchQuery.value = '';
    isSearching.value = true;
    currentPage.value = 1; // กลับไปหน้าแรกเมื่อล้างการค้นหา
    await fetchCartItems(true);
    isSearching.value = false;
}

// โหลดรายการที่เปิดค้างไว้ใหม่ทั้งหมด (ใช้เมื่อแก้ไข/ลบสินค้า)
// 🚨 โหมด scroll ต่อเนื่องต้องดึงตั้งแต่หน้า 1 ถึงหน้าที่โหลดไปแล้ว ไม่ใช่หน้าเดียว
//    ไม่งั้นลบสินค้าทีเดียวแล้วรายการที่เลื่อนผ่านมาก่อนหน้าจะหายไปทั้งหมด
async function refreshCurrentPage() {
    try {
        isChangingPage.value = true;

        const pagesLoaded = Math.max(1, currentPage.value);
        const collected = [];
        let latestTotal = 0;

        for (let page = 1; page <= pagesLoaded; page += 1) {
            const response = await CartService.getCartItems(userData.value.user_code, page, pageSize.value, searchQuery.value);
            if (!response?.data) break;

            latestTotal = response.data.total_count || 0;
            const rows = response.data.data || [];
            collected.push(...rows);

            // ลบสินค้าจนจำนวนหน้าหดลง — หยุดที่หน้าสุดท้ายที่ยังมีของจริง
            if (rows.length === 0 || collected.length >= latestTotal) {
                currentPage.value = page;
                break;
            }
        }

        totalCartCount.value = latestTotal;
        totalPages.value = Math.ceil(latestTotal / pageSize.value) || 1;
        if (currentPage.value > totalPages.value) currentPage.value = Math.max(1, totalPages.value);
        releasePartialCheckoutLockIfCartEmpty(collected, latestTotal);

        localCartItems.value = collected.map(normalizeLocalCartItem);
        cartStore.syncWithApiData(localCartItems.value);
        cartStore.setTotalCartCount(totalCartCount.value);
        await cartStore.fetchCartSummary();
        await fetchStockForItems(localCartItems.value);
    } catch (error) {
        console.error('Error refreshing current page:', error);
    } finally {
        isChangingPage.value = false;
    }
}

// ดึง stock สำหรับรายการสินค้าที่โหลดมาใหม่
async function fetchStockForItems(items) {
    try {
        isLoadingStock.value = true;

        // โปรโมชันของแถมเป็นรายการเสมือน ไม่มี stock ของรหัสโปรโมชันเอง
        // จึงตรวจเฉพาะสินค้าปกติและสินค้าชุด ส่วนความพร้อมของโปรโมชันให้ server ตรวจวันหมดอายุ/สถานะ
        const normalProducts = items.filter((item) => !isSetItem(item) && !isSalePremiumItem(item));
        const setProducts = items.filter(isSetItem);

        // ดึง stock สำหรับสินค้าปกติ
        if (normalProducts.length > 0) {
            const stockItems = normalProducts.map((item) => ({
                item_code: item.item_code,
                unit_code: item.unit_code
            }));

            const response = await CartService.getCartItemStock(stockItems);
            if (response?.data?.success && response.data.data) {
                for (const stockItem of response.data.data) {
                    updateItemBalanceQty(stockItem.item_code, stockItem.balance_qty, stockItem.unit_code);
                }
            }
        }

        // ดึง stock สำหรับสินค้าชุด
        for (const item of setProducts) {
            // โหลดรายการสินค้าย่อย
            await cartStore.fetchSetItems(item.item_code);

            // ดึง balance_qty จาก ProductService
            const response = await ProductService.getProductSetByItemCode(item.item_code);
            if (response?.data && response.data.balance_qty !== undefined) {
                updateItemBalanceQty(item.item_code, response.data.balance_qty);
            }
        }
    } catch (error) {
        console.error('Error fetching stock for items:', error);
    } finally {
        if (Array.isArray(items) && items.length > 0) {
            cartStore.syncWithApiData(localCartItems.value);
        }
        isLoadingStock.value = false;
    }
}

// Format cart items for API
function formatCartItemsForApi(items) {
    return items.map((item) => ({
        creator_code: userData.value.user_code,
        cust_code: userData.value.user_code,
        item_code: item.item_code,
        item_name: item.item_name,
        qty: toCartQty(item.qty).toString(),
        price: toCartNumber(item.price).toString(),
        unit_code: item.unit_code || t('common.piece'),
        guid_code: item.guid_code || item.id,
        barcode: item.barcode || '',
        wh_code: item.wh_code || '',
        shelf_code: item.shelf_code || '',
        ratio: item.ratio || '1',
        stand_value: item.stand_value || '1',
        divide_value: item.divide_value || '1',
        item_type: item.item_type || '0', // เพิ่ม item_type (default = 0 สินค้าปกติ, 3 = สินค้าชุด)
        is_promotion: item.is_promotion || '0',
        create_datetime: new Date().toISOString().replace('T', ' ').substring(0, 23)
    }));
}

// Save cart changes
async function saveCartChanges() {
    await waitForCartUpdateQueues();
    if (!hasCartChanges.value) return;

    try {
        const cartItemsData = formatCartItemsForApi(localCartItems.value);
        await CartService.updateCartItemQuantity(cartItemsData);
        hasCartChanges.value = false;
    } catch (error) {
        console.error('Error saving cart changes:', error);
    }
}

// Calculate totals
function calculateTotals() {
    const totalAmount = localCartItems.value.reduce((total, item) => total + toCartNumber(item.price) * toCartQty(item.qty), 0);

    const totalItems = localCartItems.value.reduce((count, item) => count + toCartQty(item.qty), 0);

    return { totalAmount, totalItems };
}

// Update cart item
async function updateCartItem(item) {
    const key = getCartUpdateKey(item);
    const itemSnapshot = { ...item };
    applyLocalCartItemSnapshot(itemSnapshot);
    const previousUpdate = cartUpdateQueues.get(key) || Promise.resolve();
    const currentUpdate = previousUpdate
        .catch(() => {})
        .then(async () => {
            const cartItemData = formatCartItemsForApi([itemSnapshot]);
            await CartService.updateCartItemQuantity(cartItemData);
            hasCartChanges.value = false;
            cartStore.syncWithApiData(localCartItems.value);
            await cartStore.fetchCartSummary();
        });

    cartUpdateQueues.set(key, currentUpdate);
    currentUpdate
        .catch(() => {})
        .finally(() => {
            if (cartUpdateQueues.get(key) === currentUpdate) {
                cartUpdateQueues.delete(key);
            }
        });

    try {
        await currentUpdate;
    } catch (error) {
        console.error('Error updating cart item:', error);
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: getApiErrorMessage(error) || t('cartPage.addQtyFailed'),
            life: 4200
        });
        await fetchCartItems(false);
    }
}

// Update item balance qty (สำหรับสินค้าปกติและสินค้าชุด)
// ต้องใช้ทั้ง itemCode และ unitCode เพราะสินค้าเดียวกันอาจมีหลาย unit
function updateItemBalanceQty(itemCode, balanceQty, unitCode = null) {
    // console.log('[CartView] updateItemBalanceQty called:', itemCode, unitCode, balanceQty);
    let itemIndex;

    if (unitCode) {
        // ค้นหาด้วยทั้ง item_code และ unit_code
        itemIndex = localCartItems.value.findIndex((i) => i.item_code === itemCode && i.unit_code === unitCode);
    } else {
        // กรณีสินค้าชุด ค้นหาด้วย item_code อย่างเดียว
        itemIndex = localCartItems.value.findIndex((i) => i.item_code === itemCode);
    }

    // console.log('[CartView] Found item at index:', itemIndex);
    if (itemIndex !== -1) {
        // ใช้วิธีนี้เพื่อให้ Vue detect การเปลี่ยนแปลง
        localCartItems.value[itemIndex] = {
            ...localCartItems.value[itemIndex],
            balance_qty: balanceQty
        };
        // console.log('[CartView] Updated item:', localCartItems.value[itemIndex]);
    }
}

// Process checkout
async function processCheckout(finalOrderData, done) {
    const finish = (success, message = '', checkoutMeta = null) => {
        if (typeof done === 'function') done(success ? true : { success: false, message, checkoutMeta });
        return success;
    };

    if (isProcessingCheckout.value) {
        return finish(false, t('cartFlow.checkoutInProgress'));
    }
    isProcessingCheckout.value = true;

    try {
        // Save any pending changes
        await saveCartChanges();

        //console.log('Final order data received:', finalOrderData);

        // Create final order data
        const checkoutData = {
            items: finalOrderData.items, // ใช้ items จาก finalOrderData ที่มี tax_type แล้ว
            deliveryMethod: finalOrderData.deliveryMethod,
            employeeCode: finalOrderData.employeeCode,
            customerCode: finalOrderData.customerCode,
            deliveryAddress: finalOrderData.deliveryMethod === 'delivery' ? finalOrderData.deliveryAddress : null,
            deliveryTelephone: finalOrderData.deliveryMethod === 'delivery' ? finalOrderData.deliveryTelephone : null,
            // แก้ไขส่วนนี้
            send_type: finalOrderData.send_type || (finalOrderData.deliveryMethod === 'delivery' ? '1' : '0'),
            address: finalOrderData.address || userData.value.address || '',
            // ส่งค่า address_name ที่ถูกต้องไปยัง cartStore
            address_name: finalOrderData.address_name || '',
            telephone: finalOrderData.telephone || finalOrderData.deliveryTelephone || userData.value.telephone || '',
            remark: finalOrderData.remark || '',
            // เพิ่มฟิลด์ใหม่สำหรับวันที่จัดส่งและเครดิต
            send_date: finalOrderData.send_date || null,
            send_day: finalOrderData.send_day || null,
            // ข้อมูลรับเอง (รีวิว 260908 สไลด์ 6)
            pickup_date: finalOrderData.pickup_date || '',
            pickup_time_slot: finalOrderData.pickup_time_slot || '',
            pickup_receiver: finalOrderData.pickup_receiver || '',
            pickup_vehicle: finalOrderData.pickup_vehicle || '',
            credit_day: finalOrderData.credit_day || null,
            credit_date: finalOrderData.credit_date || null
        };

        //console.log('Checkout data being sent to store:', checkoutData);

        try {
            const result = await cartStore.checkoutCart(checkoutData);

            if (result?.success) {
                // เลขที่เอกสารมาจาก server เท่านั้น — ไม่ปลอมเลขให้ลูกค้าเมื่อ response ไม่มีเลข (REQ4)
                const savedOrderNumbers = (Array.isArray(result.orderNumbers) ? result.orderNumbers : [result.orderNumber]).filter(Boolean);
                const savedOrderDocuments = Array.isArray(result.orderDocuments) ? result.orderDocuments.filter((item) => item?.docNo) : [];
                const savedOrderText = savedOrderNumbers.join(', ');
                // วันเวลาที่แสดงใช้ของ server (Asia/Bangkok) ไม่ใช่นาฬิกาเครื่องลูกค้า (REQ6)
                const orderMoment = result.orderDocDate ? new Date(`${result.orderDocDate}T${result.orderDocTime || '00:00'}`) : new Date();
                orderResult.value = {
                    orderNumber: savedOrderText,
                    orderNumbers: savedOrderNumbers,
                    orderDocuments: savedOrderDocuments,
                    orderDate: orderMoment.toLocaleDateString(dateLocale.value, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    }),
                    orderTime: orderMoment.toLocaleTimeString(dateLocale.value, {
                        hour: '2-digit',
                        minute: '2-digit'
                    }),
                    partial: Boolean(result.partial),
                    preorder: Boolean(result.preorder)
                };

                // Clear local cart only when every document was saved. In partial saves,
                // keep the cart visible so the user can review the remaining items.
                if (!result.partial) {
                    localCartItems.value = [];
                }
                hasCartChanges.value = false;

                // Move to complete step
                activeStep.value = 2;

                toast.add({
                    severity: result.partial ? 'warn' : 'success',
                    summary: result.partial ? t('cartFlow.checkoutPartialSummary') : t('cartFlow.checkoutSuccessSummary'),
                    detail: result.partial ? t('cartFlow.checkoutPartialDetail', { docNos: savedOrderText }) : t('cartFlow.checkoutSuccessDetail'),
                    life: result.partial ? 6500 : 3000
                });

                return finish(true);
            } else {
                const message = result?.message || t('cartFlow.checkoutFailedDetail');
                toast.add({
                    severity: 'error',
                    summary: t('common.error'),
                    detail: message,
                    life: checkoutErrorToastLife(message)
                });
                return finish(false, message, result?.checkoutMeta || null);
            }
        } catch (error) {
            console.error('Checkout error:', error);

            // ตรวจสอบว่าเป็น error กรณี Customer Code Not Found หรือไม่
            if (error.message && error.message.startsWith('LOGIN_REQUIRED:')) {
                // แสดง dialog แจ้งเตือน
                loginErrorMessage.value = error.message.substring(14); // ตัด "LOGIN_REQUIRED:" ออก
                showLoginRequiredDialog.value = true;
                return finish(false, loginErrorMessage.value, error?.checkoutMeta || null);
            }

            // กรณีเกิด error อื่นๆ
            const message = String(error?.message || '').trim() || t('cartFlow.checkoutFailedDetail');
            toast.add({
                severity: 'error',
                summary: t('common.error'),
                detail: message,
                life: checkoutErrorToastLife(message)
            });
            return finish(false, message, error?.checkoutMeta || null);
        }
    } catch (error) {
        console.error('Checkout error:', error);
        const message = String(error?.message || '').trim() || t('cartFlow.checkoutFailedDetail');
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: message,
            life: checkoutErrorToastLife(message)
        });
        return finish(false, message, error?.checkoutMeta || null);
    } finally {
        isProcessingCheckout.value = false;
    }
}

// Step navigation
function nextStep() {
    if (hasPartialSavedDocs.value) {
        toast.add({
            severity: 'warn',
            summary: t('cartPage.checkoutLocked'),
            detail: partialCheckoutLockText.value,
            life: 5200
        });
        return;
    }
    if (activeStep.value < 2) activeStep.value++;
}

function prevStep() {
    if (activeStep.value > 0) activeStep.value--;
}

function goToShop() {
    saveCartChanges();
    router.push('/');
}

function resetStepper() {
    activeStep.value = 0;
    router.push('/');
}

async function reviewPartialCart() {
    activeStep.value = 0;
    await fetchCartItems(false);
}

// ฟังก์ชันสำหรับ redirect ไปยังหน้า login เมื่อมีปัญหา Customer Code Not Found
function redirectToLogin() {
    // ปิด dialog
    showLoginRequiredDialog.value = false;

    // ล้างข้อมูล user ใน localStorage เพราะมีปัญหา
    localStorage.removeItem('_userData');
    localStorage.removeItem('_token');

    // นำผู้ใช้ไปยังหน้า login
    router.push('/auth/login');
}
</script>

<template>
    <div class="cart-page-shell">
        <div v-if="isLoading" class="cart-page-loading">
            <ProgressSpinner style="width: 50px" />
        </div>

        <div v-else class="cart-page-container">


            <section class="cart-stage-card">
                <div v-if="activeStep === 0">
                    <Message v-if="partialSavedDocText" severity="warn" :closable="false" class="cart-partial-review-message">
                        {{ partialSavedDocText }}
                    </Message>
                    <StepCart
                        :cartItems="localCartItems"
                        :userType="userType"
                        :totalCartCount="totalCartCount"
                        :isChangingPage="isChangingPage"
                        :isLoadingMore="isLoadingMore"
                        :hasMoreItems="hasMoreCartItems"
                        :cartTotalPrice="cartStore.cartTotalPrice"
                        :cartTotalQty="cartStore.cartTotalQty"
                        :searchQuery="searchQuery"
                        :isSearching="isSearching"
                        :isLoadingStock="isLoadingStock"
                        :checkoutLocked="hasPartialSavedDocs"
                        :checkoutLockMessage="partialCheckoutLockText"
                        @update-item="updateCartItem"
                        @set-cart-changed="hasCartChanges = true"
                        @refresh-cart="refreshCurrentPage"
                        @update-balance-qty="updateItemBalanceQty"
                        @load-more="loadMoreCartItems"
                        @open-product="openProductFromCart"
                        @search="searchCartItems"
                        @clear-search="clearSearch"
                        @next-step="nextStep"
                        @go-to-shop="goToShop"
                    />
                </div>

                <div v-else-if="activeStep === 1">
                    <StepConfirmation :cartItems="localCartItems" :userType="userType" :userData="userData" :orderData="orderData" :totals="calculateTotals()" @prev-step="prevStep" @process-checkout="processCheckout" />
                </div>

                <div v-else-if="activeStep === 2">
                    <StepComplete
                        :order-number="orderResult.orderNumber"
                        :order-numbers="orderResult.orderNumbers"
                        :order-documents="orderResult.orderDocuments"
                        :order-date="orderResult.orderDate"
                        :order-time="orderResult.orderTime"
                        :partial="orderResult.partial"
                        :preorder="orderResult.preorder"
                        @go-to-shop="resetStepper"
                        @review-cart="reviewPartialCart"
                    />
                </div>
            </section>
        </div>

        <Dialog :visible="showLoginRequiredDialog" @update:visible="showLoginRequiredDialog = $event" :modal="true" :closable="false" :header="t('cartFlow.importantWarning')" :style="{ width: '90%', maxWidth: '500px' }">
            <div class="flex items-center mb-4">
                <i class="pi pi-exclamation-triangle text-yellow-500 mr-3" style="font-size: 2rem"></i>
                <div>{{ loginErrorMessage || t('cartFlow.customerCodeMissing') }}</div>
            </div>
            <template #footer>
                <div class="flex justify-end">
                    <Button :label="t('cartFlow.loginAgain')" icon="pi pi-sign-in" @click="redirectToLogin" autofocus />
                </div>
            </template>
        </Dialog>

        <!-- หน้าสั่งสินค้าจากบรรทัดในตะกร้า (รีวิว 260908 สไลด์ 5)
             ลูกค้าเปิดเพื่อเปลี่ยนหน่วยที่จะสั่ง — dialog เดียวกับที่ใช้ในหน้ารายการสินค้า -->
        <ProductDetailDialog
            v-if="selectedProductCode && !selectedProductIsSet"
            v-model:visible="showProductDialog"
            :itemCode="selectedProductCode"
            @added-to-cart="refreshCurrentPage"
        />
        <ProductSetDialog
            v-if="selectedProductCode && selectedProductIsSet"
            v-model:visible="showProductDialog"
            :itemCode="selectedProductCode"
            @added-to-cart="refreshCurrentPage"
        />
    </div>
</template>

<style scoped>
.cart-page-shell {
    min-height: 100vh;
    width: 100%;
    display: flex;
    justify-content: center;
    background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--market-accent, #f97316) 14%, transparent), transparent 30%),
        radial-gradient(circle at 0% 100%, color-mix(in srgb, var(--market-primary, #0f9f6e) 10%, transparent), transparent 40%),
        var(--market-surface-soft, #f7f3ea);
    color: var(--market-text, #5b4a27);
}

.cart-page-loading {
    width: 100%;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
}

.cart-page-container {
    width: 100%;
    max-width: 72rem;
    display: grid;
    gap: 0.75rem;
}

.cart-partial-review-message {
    margin-bottom: 0.85rem;
}

.cart-page-hero {
    background: linear-gradient(120deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #fdf7ea) 100%);
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1rem;
    padding: 0.85rem 1rem;
    box-shadow: 0 12px 20px var(--market-shadow, rgba(140, 111, 53, 0.08));
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: center;
}

.cart-hero-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--market-text, #5b4a27);
    line-height: 1.15;
}

.cart-hero-subtitle {
    margin-top: 0.1rem;
    margin-bottom: 0;
    color: var(--market-primary, #7b5f2a);
    font-weight: 600;
    font-size: 0.95rem;
}

.cart-hero-description {
    margin-top: 0.15rem;
    color: var(--market-muted, #9b8a67);
    font-size: 0.86rem;
    line-height: 1.3;
}

.cart-hero-side {
    display: grid;
    justify-items: end;
    gap: 0.5rem;
}

.cart-user-badge {
    font-size: 0.85rem;
    font-weight: 600;
    border-radius: 999px;
    padding: 0.38rem 0.8rem;
    border: 1px solid transparent;
}

.user-badge-customer {
    color: var(--market-primary, #8f6a22);
    background: var(--market-primary-soft, #f8efd9);
    border-color: color-mix(in srgb, var(--market-primary, #8f6a22) 24%, var(--market-card-border, #ead9b5));
}

.user-badge-employee {
    color: var(--market-text, #5b4a27);
    background: var(--market-accent-soft, #f3e6c7);
    border-color: color-mix(in srgb, var(--market-accent, #f97316) 22%, var(--market-card-border, #d9bf8a));
}

.user-badge-default {
    color: var(--market-muted, #725a29);
    background: var(--market-surface-soft, #f6ecd3);
    border-color: var(--market-card-border, #e6d1a6);
}

.cart-back-btn {
    border-color: var(--market-primary, #d6b36a);
    color: var(--market-primary, #6b5428);
}

.cart-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.6rem;
}

.metric-card {
    background: var(--market-card-bg, #fffdf8);
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 0.85rem;
    padding: 0.6rem 0.8rem;
    box-shadow: 0 8px 16px var(--market-shadow, rgba(140, 111, 53, 0.05));
    display: grid;
    gap: 0.2rem;
}

.metric-label {
    color: var(--market-muted, #9b8a67);
    font-size: 0.75rem;
}

.metric-value {
    color: var(--market-text, #5b4a27);
    font-size: 1rem;
    line-height: 1.2;
}

.cart-stepper-card,
.cart-stage-card {
    background: color-mix(in srgb, var(--market-card-bg, #fffefb) 88%, transparent);
    border: 0;
    border-radius: 0;
    padding: 0.5rem;
    box-shadow: none;
}

:deep(.cart-stepper-card .p-steps .p-steps-item .p-menuitem-link) {
    background: transparent;
}

@media (max-width: 900px) {
    .cart-page-hero {
        flex-direction: column;
    }

    .cart-hero-side {
        width: 100%;
        justify-items: start;
    }

    .cart-metrics {
        grid-template-columns: 1fr;
    }
}
</style>
