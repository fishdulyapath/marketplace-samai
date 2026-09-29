<!-- ProductSetDialog.vue -->

<script setup>
import returnIcon from '@/assets/retun.png';
import { useSilentRefresh } from '@/composables/useSilentRefresh';
import ProductService from '@/services/ProductService';
import { useAuthenStore } from '@/stores/authen';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { getRemainingAddableQty, normalizeMaxOrderQty } from '@/utils/cartLimits';
import { formatCartUnitSummary, summarizeCartUnits } from '@/utils/cartUnitSummary';
import { collectProductUnits } from '@/utils/unitConversion';
import { pickProductName } from '@/utils/languageDisplay';
import { getPreorderSplit, isPreorderAllowed, toOrderQty, toStockQty } from '@/utils/preorderSplit';
import { productDescriptionText, sanitizeProductDescription } from '@/utils/productDescription';
import Badge from 'primevue/badge';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Divider from 'primevue/divider';
import Galleria from 'primevue/galleria';
import OverlayPanel from 'primevue/overlaypanel';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
    visible: {
        type: Boolean,
        default: false
    },
    itemCode: {
        type: String,
        default: ''
    },
    // เปิดซ้อนบน CartOverlay ต้องยกให้สูงกว่า drawer (z-index 1200)
    baseZIndex: {
        type: Number,
        default: 0
    }
});

const emit = defineEmits(['update:visible', 'added-to-cart', 'favorite-changed', 'show-full-detail']);

const router = useRouter();
const product = ref(null);
const images = ref([]);
const quantity = ref('1');
const loading = ref(true);
const addingToCart = ref(false); // แยก state การเพิ่มลงตะกร้าออกมาต่างหาก
const priceLoading = ref(false);
const toast = useToast();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = languageStore.t;
const selectedUnitIndex = ref(0);
const shareOverlay = ref(null); // อ้างอิงถึง OverlayPanel สำหรับแชร์
const showFullDescription = ref(false); // สำหรับควบคุมการแสดงรายละเอียดแบบเต็ม
const isFullScreenDetail = ref(false);
const setItems = ref([]); // รายการสินค้าย่อยในชุด
const loadingSetItems = ref(false);

const authenStore = useAuthenStore();
const isLoggedIn = computed(() => authenStore.isAuthenticated);
function getProductDisplayName(item) {
    return pickProductName(item, languageStore.locale) || item?.display_name || item?.item_name || item?.name || '';
}

const productDisplayName = computed(() => (product.value ? getProductDisplayName(product.value) : ''));
const hiddenDetailFields = computed(() => {
    const fields = new Set();
    const addFields = (value) => {
        if (Array.isArray(value)) value.forEach((item) => fields.add(String(item).trim()));
        else String(value || '').split(',').forEach((item) => {
            const key = item.trim();
            if (key) fields.add(key);
        });
    };
    addFields(product.value?.hidden_detail_fields);
    addFields(product.value?.hidden_detail_fields_csv);
    return fields;
});
const isDetailFieldHidden = (key) => hiddenDetailFields.value.has(key);
const salesDisplayMode = computed(() => String(currentUnit.value?.sales_display_mode ?? product.value?.sales_display_mode ?? '0'));
const isSalesPopularityMode = computed(() => salesDisplayMode.value === '2');
const shouldShowStock = computed(() => !isDetailFieldHidden('stock'));
const shouldShowSales = computed(() => !isDetailFieldHidden('sales') && salesDisplayMode.value !== '1');
const salesStarThresholds = computed(() => {
    const values = String(currentUnit.value?.sales_star_thresholds || product.value?.sales_star_thresholds || '100,500,1000,5000')
        .split(',')
        .map((item) => toDialogNumber(item, 0))
        .filter((item) => Number.isFinite(item) && item > 0)
        .slice(0, 4);
    return values.length === 4 ? values : [100, 500, 1000, 5000];
});
const currentSalesText = computed(() => {
    if (!currentUnit.value || !shouldShowSales.value) return '';
    const salesQty = toDialogNumber(currentUnit.value.sum_sale, 0);
    if (isSalesPopularityMode.value) {
        const thresholds = salesStarThresholds.value;
        const count = salesQty > thresholds[3] ? 5 : salesQty > thresholds[2] ? 4 : salesQty > thresholds[1] ? 3 : salesQty > thresholds[0] ? 2 : salesQty > 0 ? 1 : 0;
        return count > 0 ? '★'.repeat(count) : '-';
    }
    return `${formatNumber(salesQty)} ${currentUnit.value.unit_code || ''}`.trim();
});
const dialogStyle = computed(() =>
    isFullScreenDetail.value
        ? { width: '100vw', maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh', padding: 0 }
        : { width: '95vw', maxWidth: '900px', padding: 0 }
);
const dialogBreakpoints = computed(() => (isFullScreenDetail.value ? {} : { '960px': '95vw', '640px': '100vw' }));
const dialogClass = computed(() => ['product-detail-dialog', { 'product-detail-dialog--fullscreen': isFullScreenDetail.value }]);

// สำหรับการแชร์
const shareItems = computed(() => [
    {
        label: 'Facebook',
        icon: 'pi pi-facebook',
        command: () => {
            shareToFacebook();
        }
    },
    {
        label: 'Line',
        icon: 'pi pi-comment',
        command: () => {
            shareToLine();
        }
    },
    {
        label: t('productDetail.copyLink'),
        icon: 'pi pi-copy',
        command: () => {
            copyLink();
        }
    }
]);

// สไลด์กาลเลอรี่ responsive options
const galleryOptions = ref([
    {
        breakpoint: '992px',
        numVisible: 5
    },
    {
        breakpoint: '768px',
        numVisible: 4
    },
    {
        breakpoint: '576px',
        numVisible: 3
    }
]);

// ตรวจสอบว่าสินค้านี้อยู่ในตะกร้าหรือไม่
// "มีในตะกร้าแล้ว 6 ลัง 3 แพ็ค" — ทุกหน่วยพร้อมกัน (รีวิว 260908 สไลด์ 3)
// ⚠️ ใช้แค่แสดงผล ตรรกะเพดานสต็อก/โควตายังนับเฉพาะหน่วยที่เลือก (quantityInCart)
const cartUnitLines = computed(() =>
    summarizeCartUnits(
        cartStore.cartItems,
        product.value?.id || product.value?.code,
        collectProductUnits(product.value).map((u) => u.unit_code)
    )
);
const cartUnitSummaryText = computed(() => formatCartUnitSummary(cartUnitLines.value));
const isInCart = computed(() => cartUnitLines.value.length > 0);

const safeProductDescription = computed(() => sanitizeProductDescription(product.value?.description || ''));
const productDescriptionPlainText = computed(() => productDescriptionText(product.value?.description || ''));

// ตรวจสอบว่า description มีมากกว่า 2 บรรทัดหรือไม่
const shouldShowMoreButton = computed(() => {
    if (!productDescriptionPlainText.value) return false;

    // ตรวจสอบจำนวนบรรทัดหรือความยาวของข้อความ
    const lines = productDescriptionPlainText.value.split('\n').length;
    const isLongText = productDescriptionPlainText.value.length > 100; // หรือความยาวมากกว่า 100 ตัวอักษร

    return lines > 2 || isLongText;
});

// จำนวนที่มีในตะกร้า
const quantityInCart = computed(() => {
    if (!product.value || !currentUnit.value) return 0;
    const item = cartStore.cartItems.find((item) => item.item_code === (product.value.id || product.value.code) && item.unit_code === currentUnit.value.unit_code);
    return item ? toOrderQty(item.qty) : 0;
});

const totalSelectedWithCart = computed(() => {
    if (!product.value || !currentUnit.value) return 0;

    // จำนวนที่กำลังเลือกในหน้าต่างปัจจุบัน
    const currentlySelected = toOrderQty(quantity.value);

    // จำนวนที่มีในตะกร้าแล้ว (ของหน่วยเดียวกัน)
    const inCartQty = cartStore.cartItems.find((item) => item.item_code === (product.value.id || product.value.code) && item.unit_code === currentUnit.value.unit_code)?.qty || 0;

    // จำนวนรวมทั้งหมด
    return currentlySelected + toOrderQty(inCartQty);
});

// Maximum Allowance = จำนวนสั่งสูงสุดต่อคำสั่งซื้อ กำหนดต่อหน่วย (REQ3)
// null = ไม่จำกัด · server บังคับซ้ำที่ /sendorder และ /validatecartstock
const maxAllowanceForUnit = computed(() => {
    const map = product.value?.max_order_qty_by_unit;
    const unitCode = currentUnit.value?.unit_code;
    if (!map || !unitCode) return null;
    return normalizeMaxOrderQty(map[unitCode]);
});

const exceedsMaxAllowance = computed(() => {
    const max = maxAllowanceForUnit.value;
    return max !== null && totalSelectedWithCart.value > max;
});

// จำนวนที่ยังเพิ่มได้อีกภายใต้ลิมิต (นับรวมที่มีในตะกร้าแล้ว)
const remainingAllowanceToAdd = computed(() => {
    const max = maxAllowanceForUnit.value;
    if (max === null) return null;
    return Math.max(0, max - quantityInCart.value);
});

const exceedsAvailableStock = computed(() => {
    if (!currentUnit.value) return false;
    if (isPreorderAllowed(currentUnit.value)) return false;

    const maxStock = toStockQty(currentUnit.value.balance_qty);
    return maxStock !== null && totalSelectedWithCart.value > maxStock;
});

const remainingStockToAdd = computed(() => {
    if (!currentUnit.value) return 0;

    const maxStock = toStockQty(currentUnit.value.balance_qty);
    if (maxStock === null) return 0;
    const inCartQty = cartStore.cartItems.find((item) => item.item_code === (product.value.id || product.value.code) && item.unit_code === currentUnit.value.unit_code)?.qty || 0;

    return Math.max(0, maxStock - toOrderQty(inCartQty));
});

const hasReachedMaxAllowance = computed(() => remainingAllowanceToAdd.value !== null && remainingAllowanceToAdd.value <= 0);
const remainingAddableQty = computed(() => getRemainingAddableQty(remainingStockToAdd.value, remainingAllowanceToAdd.value));

function getSelectedUnitSource() {
    if (!product.value) return null;
    if (selectedUnitIndex.value === 0) return product.value;
    return product.value.otherUnits?.[selectedUnitIndex.value - 1] || null;
}

function resolveOrderableSoldOut(unit) {
    if (!unit) return '1';
    if (isPreorderAllowed(unit)) return '0';
    const balanceQty = toStockQty(unit.balance_qty);
    if (balanceQty !== null && balanceQty <= 0) return '1';
    return unit.sold_out;
}

// หน่วยสินค้าที่กำลังเลือก
const currentUnit = computed(() => {
    const unit = getSelectedUnitSource();
    if (!unit) return null;

    const preorderAllowed = unit.preorder_allowed ?? product.value.preorder_allowed ?? 0;
    return {
        ...unit,
        item_code: unit.item_code || product.value.code,
        item_name: unit.item_name || product.value.name,
        preorder_allowed: preorderAllowed,
        preorder_mode: unit.preorder_mode ?? product.value.preorder_mode ?? 'default',
        promotion: Array.isArray(unit.promotion) ? unit.promotion : [],
        sold_out: resolveOrderableSoldOut({ ...unit, preorder_allowed: preorderAllowed })
    };
});

// ฟังก์ชันจัดเรียงและจัดรูปแบบ promotion
const formattedPromotions = computed(() => {
    if (!currentUnit.value || !currentUnit.value.promotion || currentUnit.value.promotion.length === 0) {
        return [];
    }

    // เรียงลำดับ promotion ตาม line_number
    const sortedPromotions = [...currentUnit.value.promotion].sort((a, b) => {
        return toDialogNumber(a.line_number, 0) - toDialogNumber(b.line_number, 0);
    });

    // จัดรูปแบบการแสดงผล
    return sortedPromotions.map((promo, index) => {
        const fromQty = toDialogNumber(promo.from_qty, 0);
        const toQty = toDialogNumber(promo.to_qty, 0);
        const price = toDialogNumber(promo.price, 0);
        const unitName = promo.unit_name || currentUnit.value.unit_code;

        // ตรวจสอบว่าเป็นรายการสุดท้ายหรือไม่ (to_qty มากกว่า 1000 หรือเป็นค่าสูงมาก)
        const isLastItem = index === sortedPromotions.length - 1 || toQty >= 9999;

        let displayText;
        if (isLastItem) {
            displayText = t('productDetail.buyFromQty', { from: fromQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), unit: unitName });
        } else {
            displayText = t('productDetail.buyFromToQty', { from: fromQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), to: toQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), unit: unitName });
        }

        return {
            ...promo,
            displayText,
            formattedPrice: price.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })
        };
    });
});

// ตรวจสอบเมื่อ Dialog เปิดและมี itemCode หรือเมื่อ itemCode เปลี่ยน
// ใช้ watch เดียวเพื่อป้องกันการเรียก API ซ้ำซ้อน
watch(
    () => [props.visible, props.itemCode],
    ([newVisible, newItemCode], [oldVisible, oldItemCode]) => {
        // เรียก fetchProductDetail เมื่อ:
        // 1. Dialog เปิด (visible เปลี่ยนจาก false -> true) และมี itemCode
        // 2. itemCode เปลี่ยนขณะที่ Dialog เปิดอยู่
        const dialogJustOpened = newVisible && !oldVisible;
        const itemCodeChanged = newItemCode && newItemCode !== oldItemCode;

        if (newVisible && newItemCode && (dialogJustOpened || itemCodeChanged)) {
            // รีเซ็ตค่าต่างๆ
            product.value = null;
            images.value = [];
            quantity.value = '1';
            selectedUnitIndex.value = 0;
            showFullDescription.value = false;
            isFullScreenDetail.value = false;
            loading.value = true;

            // โหลดข้อมูลสินค้า แล้วเริ่มนับ 5 นาทีเพื่อรีเฟรชเบื้องหลัง (REQ1)
            fetchProductDetail().finally(() => silentRefresh.start());
        } else if (!newVisible && oldVisible) {
            silentRefresh.stop();
        }
    }
);

onMounted(() => {
    // หากมี itemCode และ visible = true ตั้งแต่เริ่มต้น ให้โหลดข้อมูล
    if (props.visible && props.itemCode) {
        fetchProductDetail().finally(() => silentRefresh.start());
    }
});

function goToLogin() {
    emit('update:visible', false);
    router.push('/auth/login');
}

function goToProductPage() {
    if (!product.value?.code) return;
    emit('show-full-detail', product.value.code);
    closeDialog();
}

// ฟังก์ชันสำหรับจัดรูปแบบตัวเลข
function toDialogNumber(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function formatNumber(value) {
    const num = toDialogNumber(value, 0);
    return num.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// ดึงข้อมูลสินค้า
async function fetchProductDetail() {
    if (!props.itemCode) {
        toast.add({
            severity: 'error',
            summary: t('productDetail.error'),
            detail: t('productDetail.missingProductCode'),
            life: 3000
        });
        emit('update:visible', false);
        return;
    }

    loading.value = true;
    try {
        // ดึงข้อมูลสินค้าชุดหลัก
        const result = await ProductService.getProductSetByItemCode(props.itemCode);

        // Process the data to set sold_out based on balance_qty
        if (result.data) {
            result.data.sold_out = resolveOrderableSoldOut(result.data);

            // ตรวจสอบว่ามี promotion หรือไม่ ถ้าไม่มีให้กำหนดเป็น array ว่าง
            if (!result.data.promotion) {
                result.data.promotion = [];
            }

            // Check other units if available
            if (result.data.otherUnits && result.data.otherUnits.length > 0) {
                result.data.otherUnits.forEach((unit) => {
                    unit.preorder_allowed = unit.preorder_allowed ?? result.data.preorder_allowed ?? 0;
                    unit.preorder_mode = unit.preorder_mode ?? result.data.preorder_mode ?? 'default';
                    unit.sold_out = resolveOrderableSoldOut(unit);
                    // ตรวจสอบว่ามี promotion หรือไม่ ถ้าไม่มีให้กำหนดเป็น array ว่าง
                    if (!unit.promotion) {
                        unit.promotion = [];
                    }
                });
            }
        }

        product.value = result.data;

        // ดึงรายการสินค้าย่อยในชุด
        await fetchProductSetItems();

        // สร้างรูปภาพสำหรับแกลลอรี่
        const mainImage = {
            itemImageSrc: product.value.image,
            thumbnailImageSrc: product.value.image,
            alt: productDisplayName.value
        };

        // ถ้ามีหลายหน่วย ให้สร้างรูปภาพเดียวกันหลายๆ รูป
        images.value = [mainImage];

        // จำลองรูปภาพเพิ่มเติม (เพื่อให้แกลลอรี่ดูดีขึ้น)
        if (product.value.otherUnits && product.value.otherUnits.length > 0) {
            // เพิ่มรูปภาพเดียวกันอีก 1-2 รูป เพื่อให้แกลลอรี่ดูดีขึ้น
            images.value.push(mainImage);
        }

        await refreshSelectedUnitPrice();
    } catch (error) {
        console.error('Error fetching product detail:', error);
        toast.add({
            severity: 'error',
            summary: t('productDetail.error'),
            detail: t('productDetail.loadProductFailed'),
            life: 3000
        });
        emit('update:visible', false);
    } finally {
        loading.value = false;
    }
}

// รีเฟรชสต็อก/ราคาของสินค้าชุดเบื้องหลัง (REQ1) — merge เฉพาะฟิลด์ที่เปลี่ยน ไม่โหลดรูปใหม่
const REFRESHABLE_FIELDS = ['balance_qty', 'sold_out', 'price', 'price1', 'price2', 'is_promotion', 'promotion', 'discount_promotion', 'preorder_allowed', 'preorder_mode'];

function mergeRefreshableFields(target, source) {
    if (!target || !source) return;
    for (const key of REFRESHABLE_FIELDS) {
        if (source[key] !== undefined) target[key] = source[key];
    }
}

async function refreshStockAndPriceSilently() {
    if (!props.itemCode || !product.value) return;

    const result = await ProductService.getProductSetByItemCode(props.itemCode);
    const fresh = result?.data;
    if (!fresh || !product.value) return;

    mergeRefreshableFields(product.value, fresh);

    if (Array.isArray(fresh.otherUnits) && Array.isArray(product.value.otherUnits)) {
        const freshByUnit = new Map(fresh.otherUnits.map((u) => [u.unit_code, u]));
        for (const unit of product.value.otherUnits) {
            mergeRefreshableFields(unit, freshByUnit.get(unit.unit_code));
        }
    }

    await refreshSelectedUnitPrice({ silent: true });
}

const silentRefresh = useSilentRefresh(refreshStockAndPriceSilently);

async function refreshSelectedUnitPrice(options = {}) {
    if (!isLoggedIn.value || !product.value || !currentUnit.value) return;

    const unitSource = getSelectedUnitSource();
    if (!unitSource?.unit_code) return;

    // silent = รีเฟรชเบื้องหลัง ห้ามแตะ priceLoading เพราะทำให้ปุ่มเพิ่มลงตะกร้า disabled (REQ1)
    const silent = options.silent === true;
    if (!silent) priceLoading.value = true;
    try {
        const priceResult = await ProductService.getProductPrice(product.value.code, unitSource.unit_code, quantity.value || '1', localStorage.getItem('_userCode') || '', {
            barcode: unitSource.barcode || product.value.barcode || ''
        });

        if (priceResult?.price) {
            unitSource.price = priceResult.price;
            unitSource.type = priceResult.type ?? unitSource.type;
            unitSource.mode = priceResult.mode ?? unitSource.mode;
            unitSource.price_type = priceResult.roworder ?? priceResult.price_type ?? unitSource.price_type;
        }
    } catch (error) {
        console.warn(`Unable to refresh set price for ${product.value.code}/${unitSource.unit_code}`, error);
    } finally {
        if (!silent) priceLoading.value = false;
    }
}

// ดึงรายการสินค้าย่อยที่รวมอยู่ในชุด
async function fetchProductSetItems() {
    if (!props.itemCode) return;

    loadingSetItems.value = true;
    try {
        const result = await ProductService.getProductSetItem(props.itemCode);
        setItems.value = result.data || [];
    } catch (error) {
        console.error('Error fetching product set items:', error);
        toast.add({
            severity: 'warn',
            summary: t('productDetail.productSetIncomplete'),
            detail: t('productDetail.productSetLoadFailed'),
            life: 3000
        });
        setItems.value = [];
    } finally {
        loadingSetItems.value = false;
    }
}

const quantityAtMaxStock = computed(() => {
    const currentQty = toOrderQty(quantity.value);

    // ถึงลิมิตต่อคำสั่งซื้อ = ปุ่มบวกก็ต้องกดไม่ได้ ไม่ว่าสต็อกจะเหลือเท่าไร (REQ3)
    const remainingAllowance = remainingAllowanceToAdd.value;
    if (remainingAllowance !== null && currentQty >= remainingAllowance) return true;

    if (!currentUnit.value || isPreorderAllowed(currentUnit.value)) return false;

    const maxStock = remainingStockToAdd.value;

    return maxStock >= 0 && currentQty >= maxStock;
});

// แสดง overlay สำหรับแชร์
const isSoldOut = computed(() => currentUnit.value?.sold_out === '1');
const isPreorderOnlyAvailable = computed(() => {
    if (!currentUnit.value || !isPreorderAllowed(currentUnit.value)) return false;
    const balanceQty = toStockQty(currentUnit.value.balance_qty);
    return balanceQty !== null && balanceQty <= 0;
});

const currentPrice = computed(() => toDialogNumber(currentUnit.value?.price, 0));

const hasValidPrice = computed(() => !isLoggedIn.value || currentPrice.value > 0);

const preorderPreview = computed(() => {
    if (!currentUnit.value) return { readyQty: 0, preorderQty: 0, totalQty: 0, hasPreorder: false, isBlockedByPreorderSetting: false };
    return getPreorderSplit({
        qty: getNumericQuantity(),
        balance_qty: remainingStockToAdd.value,
        preorder_allowed: currentUnit.value.preorder_allowed
    });
});

const addToCartLabel = computed(() => {
    if (preorderPreview.value.isBlockedByPreorderSetting || exceedsAvailableStock.value) {
        return t('productDetail.adjustQtyToStock');
    }
    if (preorderPreview.value.hasPreorder) {
        return t('productDetail.addToCartWithPreorder', {
            ready: preorderPreview.value.readyQty,
            preorder: preorderPreview.value.preorderQty
        });
    }
    return t('productDetail.addToCart');
});
const preorderActionHint = computed(() => {
    if (!currentUnit.value || !isLoggedIn.value || isSoldOut.value) return '';
    if (preorderPreview.value.isBlockedByPreorderSetting) return t('productDetail.preorderBlockedHint');
    if (preorderPreview.value.hasPreorder) return t('productDetail.preorderSplitHint');
    if (isPreorderAllowed(currentUnit.value) && remainingStockToAdd.value > 0) {
        return t('productDetail.preorderStartHint', { qty: remainingStockToAdd.value, unit: currentUnit.value.unit_code });
    }
    if (isPreorderAllowed(currentUnit.value)) return t('productDetail.preorderOnlyHint');
    return '';
});

const addToCartDisabled = computed(() => {
    // ถึงลิมิตต่อคำสั่งซื้อแล้ว (นับรวมของในตะกร้า) กดเพิ่มไม่ได้อีก (REQ3)
    if (remainingAllowanceToAdd.value !== null && remainingAllowanceToAdd.value <= 0) return true;
    if (!isLoggedIn.value) return false;
    const quantityOverReadyStock = !isPreorderAllowed(currentUnit.value) && getNumericQuantity() > remainingStockToAdd.value;
    return !currentUnit.value || isSoldOut.value || preorderPreview.value.isBlockedByPreorderSetting || !hasValidPrice.value || exceedsAvailableStock.value || getNumericQuantity() <= 0 || quantityOverReadyStock || priceLoading.value || addingToCart.value;
});

function toggleShareMenu(event) {
    shareOverlay.value.toggle(event);
}

function shareToFacebook() {
    if (!product.value) return;

    // สร้าง URL ที่มีพารามิเตอร์ของสินค้า
    const baseUrl = window.location.origin;
    const productPath = `/product/${product.value.code}`;
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(baseUrl + productPath)}`;

    window.open(shareUrl, '_blank', 'width=600,height=400');
    shareOverlay.value.hide();
}

function shareToLine() {
    if (!product.value) return;

    // สร้าง URL ที่มีพารามิเตอร์ของสินค้า
    const baseUrl = window.location.origin;
    const productPath = `/product/${product.value.code}`;
    const shareUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(baseUrl + productPath)}`;

    window.open(shareUrl, '_blank', 'width=600,height=600');
    shareOverlay.value.hide();
}

function copyLink() {
    if (!product.value) return;

    // สร้าง URL ที่มีพารามิเตอร์ของสินค้า
    const baseUrl = window.location.origin;
    const productPath = `/app/product-detail/${product.value.code}`;
    const fullUrl = baseUrl + productPath;

    navigator.clipboard
        .writeText(fullUrl)
        .then(() => {
            toast.add({
                severity: 'success',
                summary: t('productDetail.linkCopied'),
                detail: t('productDetail.linkCopiedClipboard'),
                life: 3000
            });
        })
        .catch((error) => {
            console.error('Error copying link:', error);
            toast.add({
                severity: 'error',
                summary: t('productDetail.error'),
                detail: t('productDetail.copyFailed'),
                life: 3000
            });
        });

    shareOverlay.value.hide();
}

function incrementQuantity() {
    if (product.value && currentUnit.value && currentUnit.value.sold_out !== '1') {
        // แปลงค่าเป็นตัวเลขก่อนบวก
        const currentValue = toOrderQty(quantity.value);

        // ตรวจสอบว่าจำนวนที่จะเพิ่ม + จำนวนที่มีในตะกร้าแล้ว ไม่เกินจำนวนคงเหลือ
        if (!isPreorderAllowed(currentUnit.value) && (exceedsAvailableStock.value || currentValue >= remainingStockToAdd.value)) {
            // ถ้าเกินแล้ว ไม่ให้เพิ่ม และแจ้งเตือนผู้ใช้
            toast.add({
                severity: 'info',
                summary: t('productDetail.stockInfo'),
                detail: t('productDetail.cartStockLimit', { inCart: quantityInCart.value, remaining: remainingStockToAdd.value, unit: currentUnit.value.unit_code }),
                life: 3000
            });
            return;
        }

        // ห้ามเกินจำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3)
        const remainingAllowance = remainingAllowanceToAdd.value;
        if (remainingAllowance !== null && currentValue + 1 > remainingAllowance) {
            toast.add({
                severity: 'warn',
                summary: t('productDetail.stockInfo'),
                detail: t('productDetail.maxAllowanceHint', { max: maxAllowanceForUnit.value, unit: currentUnit.value.unit_code }),
                life: 4000
            });
            return;
        }

        quantity.value = (currentValue + 1).toString();
    }
}

function decrementQuantity() {
    // แปลงค่าเป็นตัวเลขก่อนลบ
    const currentValue = toOrderQty(quantity.value);
    if (currentValue > 1) {
        quantity.value = (currentValue - 1).toString();
    }
}

function addToCart() {
    if (!product.value) return;
    if (!isLoggedIn.value) {
        goToLogin();
        return;
    }

    // เตรียมข้อมูลสินค้าสำหรับเพิ่มลงตะกร้า
    const unit = currentUnit.value;
    if (!unit || !(toDialogNumber(unit.price, 0) > 0)) {
        toast.add({
            severity: 'warn',
            summary: t('productDetail.productPriceMissing'),
            detail: t('productDetail.selectUnitAgain'),
            life: 3000
        });
        return;
    }

    const cartItem = {
        id: product.value.id || product.value.code,
        item_code: product.value.code,
        code: product.value.code,
        name: product.value.name,
        item_name: product.value.name,
        price: toDialogNumber(unit.price, 0),
        image: product.value.image,
        category: product.value.category || '',
        unit: unit.unit_code,
        unit_code: unit.unit_code,
        barcode: unit.barcode || product.value.barcode || '',
        wh_code: unit.wh_code || product.value.wh_code || '',
        shelf_code: unit.shelf_code || product.value.shelf_code || '',
        stand_value: unit.stand_value || product.value.stand_value || '1',
        divide_value: unit.divide_value || product.value.divide_value || '1',
        ratio: unit.ratio || product.value.ratio || '1',
        balance_qty: unit.balance_qty ?? product.value.balance_qty ?? 0,
        preorder_allowed: unit.preorder_allowed ?? product.value.preorder_allowed ?? 0,
        preorder_mode: unit.preorder_mode ?? product.value.preorder_mode ?? 'default',
        tax_type: unit.tax_type ?? product.value.tax_type,
        item_type: '3' // เพิ่ม item_type สำหรับสินค้าชุด
    };

    // แสดงการโหลดเฉพาะปุ่มเพิ่มลงตะกร้า ไม่ใช่ทั้ง dialog
    addingToCart.value = true;

    // ตรวจสอบว่าสินค้านี้มีในตะกร้าแล้วหรือไม่ โดยเช็คทั้ง item_code และ unit_code
    const existingCartItem = cartStore.cartItems.find((item) => item.item_code === cartItem.item_code && item.unit_code === cartItem.unit_code);

    let finalQty = toOrderQty(quantity.value) || 1;

    // ถ้ามีสินค้านี้ในตะกร้าแล้ว ให้เพิ่มจำนวนเดิม + จำนวนที่ต้องการเพิ่ม
    if (existingCartItem) {
        finalQty = toOrderQty(existingCartItem.qty) + toOrderQty(quantity.value);
        cartItem.qty = finalQty;
    }

    cartStore
        .addToCart(cartItem, finalQty)
        .then(() => {
            // แจ้งให้คอมโพเนนต์แม่ทราบว่ามีการเพิ่มสินค้าลงตะกร้าแล้ว
            emit('added-to-cart', cartItem);

            // แสดง toast แจ้งเตือน
            // toast.add({
            //     severity: 'success',
            //     summary: 'เพิ่มสินค้าแล้ว',
            //     detail: `เพิ่ม ${cartItem.name} ลงในตะกร้าแล้ว`,
            //     life: 3000
            // });
        })
        .catch((err) => {
            console.error('Error adding to cart:', err);
            toast.add({
                severity: 'error',
                summary: t('productDetail.error'),
                detail: t('productDetail.addCartFailed'),
                life: 3000
            });
        })
        .finally(() => {
            addingToCart.value = false;
        });
}

// คำนวณจำนวนสินค้าย่อยตามจำนวนสินค้าชุดที่เลือก
function calculateSetItemQty(itemQty) {
    const mainQty = toOrderQty(quantity.value) || 1;
    return mainQty * toDialogNumber(itemQty, 0);
}

function formatSetQty(value) {
    const qty = toDialogNumber(value, NaN);
    if (!Number.isFinite(qty)) return '0.00';
    return qty.toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function getSetItemKey(item, index = 0) {
    return [
        item?.line_number ?? '',
        item?.roworder ?? '',
        item?.item_code ?? '',
        item?.unit_code ?? '',
        index
    ].join(':');
}

// เปลี่ยนหน่วยสินค้า
function changeUnit(index) {
    selectedUnitIndex.value = index;
    // รีเซ็ตจำนวนเมื่อเปลี่ยนหน่วย
    quantity.value = '1';
    refreshSelectedUnitPrice();
}

// ฟังก์ชันเปลี่ยนสถานะรายการโปรด
function toggleFavorite() {
    if (!product.value) return;

    // เก็บค่า favorite_item เดิมไว้
    const oldFavoriteStatus = product.value.favorite_item || '0';

    // สลับค่า favorite_item ระหว่าง "0" และ "1"
    product.value.favorite_item = product.value.favorite_item === '1' ? '0' : '1';

    // emit event เพื่อแจ้งให้ ProductList ทราบว่ามีการเปลี่ยนแปลงสถานะรายการโปรด
    emit('favorite-changed', {
        itemCode: product.value.id || product.value.code,
        isFavorite: product.value.favorite_item === '1'
    });

    // เรียกใช้งาน API เพื่ออัปเดตสถานะรายการโปรด
    ProductService.updateFavoriteStatus(product.value.id || product.value.code, product.value.favorite_item).catch((error) => {
        console.error('Error updating favorite status:', error);
        // กรณีมีข้อผิดพลาด ให้คืนค่าสถานะเดิม
        product.value.favorite_item = oldFavoriteStatus;

        // emit event เพื่อแจ้งให้ ProductList ทราบว่ามีการเปลี่ยนแปลงกลับคืน
        emit('favorite-changed', {
            itemCode: product.value.id || product.value.code,
            isFavorite: product.value.favorite_item === '1'
        });

        toast.add({
            severity: 'error',
            summary: t('productDetail.error'),
            detail: t('productDetail.favoriteUpdateFailed'),
            life: 3000
        });
    });
}

function validateQuantity() {
    // ถ้าค่าว่างเปล่าหรือไม่ใช่ตัวเลข ให้กำหนดเป็น 1
    if (quantity.value === '' || toOrderQty(quantity.value) <= 0) {
        quantity.value = '1';
        return;
    }

    // แปลงให้เป็นตัวเลข
    let numValue = toOrderQty(quantity.value);

    // ตรวจสอบว่าไม่ต่ำกว่า 1
    if (numValue < 1) {
        quantity.value = '1';
        return;
    }

    // ตรวจสอบจำนวนสูงสุดตามสต็อกที่เหลือหลังจากมีในตะกร้าแล้ว
    if (currentUnit.value && currentUnit.value.balance_qty && !isPreorderAllowed(currentUnit.value)) {
        if (numValue > remainingStockToAdd.value) {
            numValue = remainingStockToAdd.value;
            quantity.value = numValue.toString();
            toast.add({
                severity: 'info',
                summary: t('productDetail.stockInfo'),
                detail: t('productDetail.cartStockLimit', { inCart: quantityInCart.value, remaining: remainingStockToAdd.value, unit: currentUnit.value.unit_code }),
                life: 3000
            });
        }
    }

    // จำกัดตามจำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3) — นับรวมที่มีในตะกร้าแล้ว
    const remainingAllowance = remainingAllowanceToAdd.value;
    if (remainingAllowance !== null && numValue > remainingAllowance) {
        numValue = Math.max(1, remainingAllowance);
        quantity.value = numValue.toString();
        toast.add({
            severity: 'warn',
            summary: t('productDetail.stockInfo'),
            detail: t('productDetail.maxAllowanceHint', { max: maxAllowanceForUnit.value, unit: currentUnit.value?.unit_code || '' }),
            life: 4000
        });
    }

    // ตัดศูนย์นำหน้า
    quantity.value = numValue.toString();
}

function getNumericQuantity() {
    return toOrderQty(quantity.value);
}

function handleQuantityKeydown(event) {
    // อนุญาตให้กดปุ่มตัวเลข 0-9 บนคีย์บอร์ดหลักหรือปุ่มตัวเลขด้านข้าง
    const isNumber = /^[0-9]$/.test(event.key);
    // อนุญาตให้กดปุ่ม backspace, delete, tab, arrows
    const isControl = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight'].includes(event.key);

    if (!isNumber && !isControl) {
        event.preventDefault();
    }
}

function closeDialog() {
    isFullScreenDetail.value = false;
    emit('update:visible', false);
}

const dialogVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value)
});
</script>

<template>
    <Dialog
        v-model:visible="dialogVisible"
        modal
        :header="productDisplayName || t('productDetail.productDetail')"
        :style="dialogStyle"
        :breakpoints="dialogBreakpoints"
        :closable="false"
        :closeOnEscape="true"
        :dismissableMask="true"
        :baseZIndex="baseZIndex"
        @hide="closeDialog"
        :class="dialogClass"
    >
        <template #header>
            <div class="flex items-center justify-between w-full">
                <div class="text-xl font-medium">
                    {{ productDisplayName || t('productDetail.productDetail') }}
                </div>
                <div class="flex gap-2">
                    <Button v-if="product" icon="pi pi-share-alt" text rounded :aria-label="t('productDetail.shareProduct')" @click="toggleShareMenu" class="p-button-rounded p-button-text" />
                    <Button
                        v-if="product"
                        :icon="product.favorite_item === '1' ? 'pi pi-heart-fill' : 'pi pi-heart'"
                        text
                        rounded
                        :aria-label="product.favorite_item === '1' ? t('productDetail.removeFavorite') : t('productDetail.addFavorite')"
                        :aria-pressed="product.favorite_item === '1'"
                        @click="toggleFavorite"
                        :class="product.favorite_item === '1' ? 'p-button-rounded p-button-text p-button-danger' : 'p-button-rounded p-button-text'"
                    />
                    <Button v-if="product" icon="pi pi-times" text rounded :aria-label="t('productDetail.close')" class="p-button-rounded p-button-text product-set-close-button" @click="closeDialog" />
                </div>
            </div>
        </template>

        <Toast position="top-right" />
        <OverlayPanel ref="shareOverlay" dismissable>
            <div class="p-2">
                <h4 class="text-lg font-medium mb-3">{{ t('productDetail.share') }}</h4>
                <div class="flex flex-col gap-2">
                    <button
                        v-for="(item, i) in shareItems"
                        :key="i"
                        type="button"
                        class="flex items-center p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg cursor-pointer w-full border-0 bg-transparent text-left"
                        :aria-label="item.label"
                        @click="item.command"
                    >
                        <i :class="[item.icon, 'mr-2 text-lg']"></i>
                        <span>{{ item.label }}</span>
                    </button>
                </div>
            </div>
        </OverlayPanel>

        <!-- Loading state -->
        <div v-if="loading" class="flex justify-center items-center p-6" style="min-height: 300px">
            <ProgressSpinner style="width: 50px" />
        </div>

        <div v-else-if="product" class="product-detail-content">
            <!-- Product content with responsive grid layout -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Product gallery -->
                <div class="relative pt-2">
                    <Galleria v-if="images.length > 0" :value="images" :numVisible="5" :circular="true" :showThumbnails="false" :showItemNavigators="false" :responsiveOptions="galleryOptions" containerClass="w-full">
                        <template #item="slotProps">
                            <img :src="slotProps.item.itemImageSrc" :alt="productDisplayName || slotProps.item.alt" @error="$event.target.src = product.imageFallback" class="w-full object-contain" style="max-height: 300px; height: 300px" />
                        </template>
                        <template #thumbnail="slotProps">
                            <img :src="slotProps.item.thumbnailImageSrc" :alt="productDisplayName || slotProps.item.alt" @error="$event.target.src = product.imageFallback" class="rounded-sm object-contain" style="width: 70px; height: 40px" />
                        </template>
                    </Galleria>

                    <!-- ถ้าไม่มีรูปภาพ ให้แสดงรูปภาพสำรอง -->
                    <div v-else class="w-full h-[300px] flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                        <img :src="product.imageFallback" :alt="productDisplayName" class="max-h-[250px] max-w-full object-contain" />
                    </div>

                    <!-- Tags positioned on the gallery -->
                    <div class="absolute top-3 left-3 flex flex-col gap-2">
                        <Tag
                            v-if="currentUnit"
                            :value="isPreorderOnlyAvailable ? t('productDetail.preorderLabel') : currentUnit.sold_out === '1' ? t('productDetail.soldOut') : t('productDetail.inStock')"
                            :severity="isPreorderOnlyAvailable ? 'warning' : currentUnit.sold_out === '1' ? 'danger' : 'success'"
                            class="text-xs sm:text-sm"
                        />
                    </div>

                    <!-- Product Description below gallery -->
                    <div v-if="product && product.description" class="mt-0 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg">
                        <div class="text-sm font-bold mb-2 text-gray-700 dark:text-gray-300">{{ t('productDetail.productDetail') }}</div>
                        <div class="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                            <div
                                :class="['product-set-desc-html transition-all duration-300', !showFullDescription ? 'line-clamp-2 overflow-hidden' : '']"
                                :style="!showFullDescription ? 'display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;' : ''"
                                v-html="safeProductDescription"
                            ></div>
                            <Button
                                v-if="shouldShowMoreButton"
                                @click="showFullDescription = !showFullDescription"
                                :label="showFullDescription ? t('productDetail.collapse') : t('productDetail.readMore')"
                                :aria-expanded="showFullDescription"
                                text
                                size="small"
                                class="mt-2 p-0 text-primary hover:text-primary-600 text-xs"
                            />
                        </div>
                    </div>
                </div>

                <!-- Product info -->
                <div class="product-info">
                    <div class="mb-3">
                        <div class="text-sm sm:text-base text-gray-500 dark:text-gray-400">
                            {{ t('productDetail.productCode') }}: <span class="font-medium">{{ product.code }}</span>
                        </div>
                    </div>

                    <Divider />

                    <!-- Return icon display -->
                    <div v-if="product.is_return === '1'" class="mb-3 flex items-center gap-2">
                        <img :src="returnIcon" :alt="t('productDetail.returnProduct')" style="width: 80px; height: 80px; object-fit: contain" />
                        <!-- <span class="text-sm text-yellow-700 dark:text-yellow-300 font-medium"
              >สินค้ารีเทิร์น</span
            > -->
                    </div>

                    <!-- ถ้ามีหลายหน่วยให้แสดงตัวเลือกหน่วย -->
                    <div v-if="product.otherUnits && product.otherUnits.length > 0" class="mb-4">
                        <div class="text-base font-medium mb-2">{{ t('productDetail.productUnit') }}:</div>
                        <div class="flex flex-wrap gap-2">
                            <!-- ปุ่มเลือกหน่วยหลัก -->
                            <Button :label="product.unit_code" :outlined="selectedUnitIndex !== 0" :aria-label="`${t('productDetail.selectUnit')} ${product.unit_code}`" :aria-pressed="selectedUnitIndex === 0" @click="changeUnit(0)" class="text-sm" size="small" />

                            <!-- ปุ่มเลือกหน่วยอื่นๆ -->
                            <Button v-for="(unitItem, idx) in product.otherUnits" :key="idx" :label="unitItem.unit_code" :outlined="selectedUnitIndex !== idx + 1" :aria-label="`${t('productDetail.selectUnit')} ${unitItem.unit_code}`" :aria-pressed="selectedUnitIndex === idx + 1" @click="changeUnit(idx + 1)" class="text-sm" size="small" />
                        </div>
                    </div>

                    <div v-if="currentUnit && currentUnit.sold_out === '1'" class="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 p-3 rounded-lg text-base mb-4 flex items-center">
                        <i class="pi pi-exclamation-triangle mr-2"></i>
                        <span>{{ t('productDetail.unitSoldOut') }}</span>
                    </div>
                    <div v-else-if="isPreorderOnlyAvailable" class="bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200 p-3 rounded-lg text-base mb-4 flex items-center">
                        <i class="pi pi-clock mr-2"></i>
                        <span>{{ t('productDetail.preorderOnlyHint') }}</span>
                    </div>

                    <!-- Price section -->
                    <div class="flex items-center mb-4 mt-3" v-if="currentUnit">
                        <!-- แสดงราคาเฉพาะเมื่อเข้าสู่ระบบแล้วเท่านั้น -->
                        <template v-if="isLoggedIn && priceLoading">
                            <div class="bg-gray-50 dark:bg-gray-800/30 p-3 rounded-lg w-full text-center">
                                <ProgressSpinner style="width: 22px; height: 22px" strokeWidth="4" />
                                <span class="text-base ml-2">{{ t('productDetail.checkingPrice') }}</span>
                            </div>
                        </template>
                        <template v-else-if="isLoggedIn">
                            <span class="text-2xl sm:text-3xl font-bold text-primary"> ฿{{ currentPrice.toLocaleString() }} </span>
                            <span class="text-base text-gray-500 ml-2"> / {{ currentUnit.unit_code }} </span>
                        </template>

                        <!-- แสดงข้อความแทนเมื่อยังไม่ได้เข้าสู่ระบบ -->
                        <template v-else>
                            <div class="bg-gray-50 dark:bg-gray-800/30 p-3 rounded-lg w-full text-center">
                                <i class="pi pi-lock mr-2"></i>
                                <span class="text-base">{{ t('productDetail.loginForPrice') }}</span>
                                <Button icon="pi pi-sign-in" :label="t('productDetail.login')" @click="goToLogin" class="mt-2 ml-2 p-button-sm" size="small" />
                            </div>
                        </template>
                    </div>
                    <div v-if="isLoggedIn && currentUnit && !priceLoading && !hasValidPrice" class="product-set-price-warning">
                        <i class="pi pi-exclamation-circle mr-2"></i>
                        {{ t('productDetail.noUnitPrice') }}
                    </div>

                    <!-- Promotion section -->
                    <!-- <div v-if="isLoggedIn && formattedPromotions.length > 0" class="mb-4">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-base font-bold text-green-700 dark:text-green-300">💡 ราคาโปรโมชั่น</span>
                            <span class="text-base text-orange-600 dark:text-orange-400">(ส่วนลดสินค้าจะแสดง "หน้ายืนยันคำสั่งซื้อ")</span>
                        </div>
                        <div class="space-y-1">
                            <div
                                v-for="(promo, index) in formattedPromotions"
                                :key="index"
                                class="flex justify-between items-center py-2 px-3 rounded text-sm"
                                :class="{
                                    'bg-green-100 dark:bg-green-900/30': index % 2 === 0,
                                    'bg-green-50 dark:bg-green-900/20': index % 2 === 1
                                }"
                            >
                                <span class="text-green-700 dark:text-green-300">{{ promo.displayText }}</span>
                                <span class="font-semibold text-green-600 dark:text-green-200">฿{{ promo.formattedPrice }}</span>
                            </div>
                        </div>
                    </div> -->

                    <!-- In cart badge -->
                    <div v-if="isInCart" class="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 p-3 rounded-lg text-base mb-4 flex items-center">
                        <i class="pi pi-info-circle mr-2"></i>
                        <span>{{ t('productDetail.inCart') }} <Badge :value="cartUnitSummaryText" severity="info" class="ml-1"></Badge></span>
                    </div>

                    <div v-if="currentUnit && isInCart && (hasReachedMaxAllowance || (shouldShowStock && remainingAddableQty >= 0))" class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        <template v-if="hasReachedMaxAllowance">{{ t('productDetail.maxAllowanceReached') }}</template>
                        <template v-else>{{ t('productDetail.addMore', { qty: remainingAddableQty }) }} {{ currentUnit.unit_code }}</template>
                    </div>

                    <div v-if="shouldShowStock || shouldShowSales" class="product-stats grid grid-cols-2 gap-4 mb-4">
                        <!-- คงเหลือ -->
                        <div v-if="currentUnit && shouldShowStock" class="text-base text-gray-600 dark:text-gray-300 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg">
                            <div class="font-medium mb-1">{{ t('productDetail.stock') }}:</div>
                            <div :class="toDialogNumber(currentUnit.balance_qty, 0) < 0 ? 'text-red-500 font-medium' : 'font-medium'">{{ formatNumber(currentUnit.balance_qty) }} {{ currentUnit.unit_code }}</div>
                        </div>

                        <!--ยอดขาย -->
                        <div v-if="currentUnit && shouldShowSales" :class="['text-base text-gray-600 dark:text-gray-300 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg', isSalesPopularityMode ? 'product-stat-popularity' : '']">
                            <div v-if="!isSalesPopularityMode" class="font-medium mb-1">{{ t('productDetail.sales') }}:</div>
                            <div :class="isSalesPopularityMode ? 'product-stat-stars' : toDialogNumber(currentUnit.sum_sale, 0) < 0 ? 'text-red-500 font-medium' : 'font-medium'">{{ currentSalesText || '-' }}</div>
                        </div>
                    </div>

                    <!-- รายการสินค้าในชุด -->
                    <div v-if="setItems.length > 0" class="mb-4">
                        <Divider />
                        <div class="text-base font-bold mb-3 text-gray-700 dark:text-gray-300">
                            <i class="pi pi-box mr-2"></i>{{ t('productDetail.productSetItemsThis') }}
                        </div>
                        <div class="space-y-2">
                            <div
                                v-for="(item, index) in setItems"
                                :key="getSetItemKey(item, index)"
                                class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg"
                            >
                                <!-- รูปภาพ -->
                                <div class="w-12 h-12 flex-shrink-0">
                                    <img
                                        :src="item.image"
                                        :alt="getProductDisplayName(item)"
                                        @error="$event.target.src = product.imageFallback"
                                        class="w-full h-full object-contain rounded"
                                    />
                                </div>

                                <!-- รายละเอียด -->
                                <div class="flex-grow min-w-0">
                                    <div class="text-sm font-medium truncate">{{ getProductDisplayName(item) }}</div>
                                    <div class="text-xs text-gray-500">{{ item.item_code }}</div>
                                </div>

                                    <!-- จำนวนที่คำนวณ -->
                                    <div class="text-right flex-shrink-0">
                                        <div class="text-sm font-semibold text-primary">
                                        {{ formatSetQty(calculateSetItemQty(item.qty)) }} {{ item.unit_code }}
                                    </div>
                                    <div class="text-xs text-gray-500">
                                        ({{ formatSetQty(item.qty) }} x {{ getNumericQuantity() }})
                                    </div>
                                    <div v-if="shouldShowStock" class="text-xs text-gray-400">
                                        {{ t('productDetail.stock') }}: {{ formatSetQty(item.balance_qty) }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <Divider />

                    <!-- Quantity Selector & Add to Cart Button -->
                    <div class="product-set-qty-control">
                        <button type="button" class="product-set-qty-btn" :aria-label="t('productDetail.decreaseQuantityAria')" @click="decrementQuantity" :disabled="getNumericQuantity() <= 1">
                            <i class="pi pi-minus"></i>
                        </button>
                        <input type="text" v-model="quantity" class="product-set-qty-input" inputmode="numeric" :aria-label="t('productDetail.quantityAria')" @blur="validateQuantity" @keydown="handleQuantityKeydown" />
                        <button type="button" class="product-set-qty-btn" :aria-label="t('productDetail.increaseQuantityAria')" @click="incrementQuantity" :disabled="quantityAtMaxStock">
                            <i class="pi pi-plus"></i>
                        </button>
                    </div>

                    <!-- จำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3) -->
                    <div v-if="maxAllowanceForUnit !== null && currentUnit" class="product-set-max-allowance" :class="{ 'is-exceeded': exceedsMaxAllowance }">
                        <i class="pi pi-info-circle"></i>
                        <span>{{ t('productDetail.maxAllowanceHint', { max: maxAllowanceForUnit, unit: currentUnit.unit_code }) }}</span>
                    </div>

                    <div v-if="isLoggedIn && currentUnit && !isSoldOut && preorderPreview.totalQty > 0" class="product-set-preorder-preview" :class="{ 'has-preorder': preorderPreview.hasPreorder }">
                        <div>
                            <span>{{ t('productDetail.readyNow') }}</span>
                            <strong>{{ preorderPreview.readyQty }} {{ currentUnit.unit_code }}</strong>
                        </div>
                        <div v-if="preorderPreview.hasPreorder">
                            <span>{{ t('productDetail.preorderLabel') }}</span>
                            <strong>{{ preorderPreview.preorderQty }} {{ currentUnit.unit_code }}</strong>
                        </div>
                        <div v-else-if="preorderPreview.isBlockedByPreorderSetting" class="is-blocked">
                            <span>{{ t('productDetail.preorderLabel') }}</span>
                            <strong>{{ t('productDetail.preorderNotAllowed') }}</strong>
                        </div>
                        <p v-if="preorderActionHint" class="product-set-preorder-hint">{{ preorderActionHint }}</p>
                    </div>

                    <!-- Action Buttons -->
                    <div class="product-set-action-stack gap-3 mt-4">
                        <!-- กรณีเข้าสู่ระบบแล้ว แสดงปุ่มเพิ่มลงตะกร้า -->
                        <Button
                            v-if="isLoggedIn"
                            icon="pi pi-shopping-cart"
                            :label="addToCartLabel"
                            @click="addToCart"
                            :disabled="addToCartDisabled"
                            :loading="addingToCart || priceLoading"
                            class="w-full flex items-center justify-center product-set-cart-button"
                        />
                        <!-- กรณียังไม่ได้เข้าสู่ระบบ แสดงปุ่มเข้าสู่ระบบ -->
                        <Button v-else icon="pi pi-sign-in" :label="t('productDetail.loginToOrder')" @click="goToLogin" class="w-full p-button-outlined flex items-center justify-center product-set-login-button" />
                        <Button
                            icon="pi pi-external-link"
                            :label="t('productDetail.viewMoreDetails')"
                            text
                            class="w-full product-set-detail-page-button"
                            @click="goToProductPage"
                        />
                    </div>
                </div>
            </div>
        </div>

        <div v-else-if="!loading" class="p-4 text-center">
            <div class="text-gray-500">{{ t('productDetail.productNotFound') }}</div>
        </div>
    </Dialog>
</template>

<style scoped>
:deep(.p-dialog-header) {
    padding: 1rem;
    border-bottom: 1px solid #e9ecef;
}

:deep(.p-dialog-content) {
    padding: 0.5rem 1rem 1.5rem 1rem;
}

:deep(.p-galleria) {
    background: transparent;
    border: none;
}

:deep(.p-galleria-thumbnail-container) {
    background-color: rgba(0, 0, 0, 0.03);
    padding: 0.5rem 0;
}

:deep(.p-galleria-thumbnail-item-active) {
    border: 2px solid var(--primary-color) !important;
}

:deep(.p-galleria-thumbnail-item) {
    opacity: 0.7;
    transition: all 0.2s;
}

:deep(.p-galleria-thumbnail-item:hover),
:deep(.p-galleria-thumbnail-item-active) {
    opacity: 1;
}

.overflow-x-auto::-webkit-scrollbar {
    height: 3px;
}

.overflow-x-auto::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.1);
    border-radius: 3px;
}

.cursor-pointer {
    transition: all 0.2s ease;
}

input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

/* แก้ไขสไตล์ของ dialog เมื่ออยู่บนมือถือ */
.product-set-desc-html {
    line-height: 1.7;
}

.product-set-desc-html :deep(p) {
    margin: 0 0 0.65rem;
}

.product-set-desc-html :deep(p:last-child) {
    margin-bottom: 0;
}

.product-set-desc-html :deep(ul),
.product-set-desc-html :deep(ol) {
    margin: 0.4rem 0 0.7rem 1.25rem;
    padding: 0;
}

.product-set-desc-html :deep(li) {
    margin: 0.2rem 0;
}

.product-set-desc-html :deep(h1),
.product-set-desc-html :deep(h2),
.product-set-desc-html :deep(h3) {
    margin: 0.6rem 0 0.45rem;
    color: #374151;
    font-weight: 700;
    line-height: 1.35;
}

.product-set-desc-html :deep(a) {
    color: var(--primary-color);
    text-decoration: underline;
}

.product-set-price-warning {
    display: flex;
    align-items: center;
    border: 1px solid #fecaca;
    border-radius: var(--market-radius-md, 10px);
    background: #fff7f7;
    color: #b91c1c;
    padding: 0.65rem 0.8rem;
    margin: -0.35rem 0 1rem;
    font-size: 0.9rem;
}

:deep(.product-detail-dialog .p-dialog) {
    border-radius: var(--market-radius-lg, 14px);
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
}

:deep(.product-detail-dialog .p-dialog-header) {
    border-bottom-color: var(--market-card-border, #e5e7eb);
}

:deep(.product-detail-dialog .p-button:not(.p-button-text):not(.p-button-outlined)) {
    background: var(--market-primary, var(--primary-color));
    border-color: var(--market-primary, var(--primary-color));
}

:deep(.product-detail-dialog .p-galleria-thumbnail-container) {
    background: transparent;
    padding: 0.75rem 0.25rem 0;
}

:deep(.product-detail-dialog .p-galleria-thumbnail-items) {
    gap: 0.6rem;
}

:deep(.product-detail-dialog .p-galleria-thumbnail-item) {
    border: 1px solid transparent !important;
    border-radius: var(--market-radius-md, 10px);
    opacity: 0.78;
    overflow: hidden;
    background: #fff;
}

:deep(.product-detail-dialog .p-galleria-thumbnail-item:hover) {
    border-color: color-mix(in srgb, var(--market-primary, var(--primary-color)) 30%, #dbe3ea) !important;
    opacity: 1;
}

:deep(.product-detail-dialog .p-galleria-thumbnail-item-active) {
    border-color: color-mix(in srgb, var(--market-primary, var(--primary-color)) 70%, #ffffff) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--market-primary, var(--primary-color)) 10%, transparent);
    opacity: 1 !important;
}

:deep(.product-detail-dialog .p-dialog) {
    overflow: hidden;
}

:deep(.product-detail-dialog--fullscreen.p-dialog),
:deep(.product-detail-dialog--fullscreen .p-dialog) {
    width: 100vw !important;
    height: 100dvh;
    max-width: 100vw !important;
    max-height: 100dvh !important;
    margin: 0;
    border-radius: 0;
}

:deep(.product-detail-dialog--fullscreen .p-dialog-content) {
    height: calc(100dvh - 74px);
    overflow: auto;
}

:deep(.product-detail-dialog--fullscreen .p-dialog-header) {
    border-radius: 0;
}

:deep(.product-detail-dialog--fullscreen) .product-detail-content {
    min-height: 100%;
    padding: 0.5rem 1rem 2rem;
}

:deep(.product-detail-dialog--fullscreen) .product-detail-content > .grid {
    min-height: calc(100dvh - 106px);
    align-items: start;
}

:deep(.product-detail-dialog--fullscreen) .product-info {
    padding: 0 0 6rem;
}

:deep(.product-detail-dialog--fullscreen) .p-galleria-item img {
    max-height: min(56vh, 560px) !important;
    height: min(56vh, 560px) !important;
}

:deep(.product-detail-dialog--fullscreen) .product-set-detail-page-button.p-button:disabled {
    cursor: default;
    opacity: 0.62;
}

:deep(.product-detail-dialog .p-dialog-header) {
    padding: 1rem 1.15rem;
    background: #fff;
}

:deep(.product-detail-dialog .p-dialog-title) {
    display: none;
}

:deep(.product-detail-dialog .p-dialog-header .text-xl) {
    color: var(--market-text, #111827);
    font-size: 1.05rem;
    font-weight: 800;
    line-height: 1.45;
}

:deep(.product-detail-dialog .p-dialog-header .p-button.p-button-text) {
    color: var(--market-muted, #64748b);
    border: 1px solid var(--market-card-border, #e5e7eb);
    background: #fff;
    width: 2.25rem;
    height: 2.25rem;
}

:deep(.product-detail-dialog .p-dialog-header .p-button.p-button-text:hover),
:deep(.product-detail-dialog .p-dialog-header .product-set-close-button:hover) {
    color: var(--market-primary, var(--primary-color));
    border-color: var(--market-primary, var(--primary-color));
    background: color-mix(in srgb, var(--market-primary, var(--primary-color)) 8%, #fff);
}

.product-detail-content {
    --product-set-primary: var(--market-primary, var(--primary-color, #0f9f6e));
    --product-set-border: var(--market-card-border, #e5e7eb);
    --product-set-muted: var(--market-muted, #64748b);
    --product-set-text: var(--market-text, #111827);
}

:deep(.product-detail-dialog .product-info .p-divider) {
    margin: 0.75rem 0;
}

.product-set-qty-control {
    display: flex;
    align-items: center;
    width: 132px;
    min-width: 132px;
    height: 40px;
    overflow: hidden;
    border: 1px solid var(--product-set-border);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
}

.product-set-qty-btn {
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    border: 0;
    background: #f8fafc;
    color: var(--product-set-text);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.product-set-qty-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--product-set-primary) 10%, #fff);
    color: var(--product-set-primary);
}

.product-set-qty-btn:disabled {
    cursor: default;
    opacity: 0.4;
}

.product-set-qty-input {
    width: 52px;
    min-width: 52px;
    max-width: 52px;
    height: 40px;
    flex: 0 0 52px;
    box-sizing: border-box;
    border: 0;
    border-left: 1px solid var(--product-set-border);
    border-right: 1px solid var(--product-set-border);
    background: #fff;
    color: var(--product-set-text);
    font-size: 1.05rem;
    font-weight: 700;
    text-align: center;
    outline: none;
    padding: 0;
}

/* จำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3) */
.product-set-max-allowance {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    margin-top: 0.5rem;
    padding: 0.5rem 0.65rem;
    border-radius: 6px;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    color: #9a3412;
    font-size: 0.78rem;
    line-height: 1.45;
}
.product-set-max-allowance i {
    margin-top: 0.1rem;
    flex: 0 0 auto;
}
.product-set-max-allowance.is-exceeded {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
    font-weight: 600;
}

.product-set-preorder-preview {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    border: 1px solid var(--product-set-border);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
    padding: 10px;
    margin: 10px 0 2px;
}

.product-set-preorder-preview > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--product-set-primary) 6%, #fff);
    padding: 8px 10px;
}

.product-set-preorder-preview.has-preorder > div:nth-child(2) {
    background: #fff7ed;
    color: #c2410c;
}

.product-set-preorder-preview .is-blocked {
    background: #fff2f2;
    color: #b91c1c;
}

.product-set-preorder-preview span {
    color: var(--product-set-muted);
    font-size: 0.75rem;
    font-weight: 700;
}

.product-set-preorder-preview strong {
    color: inherit;
    font-size: 0.95rem;
}

.product-set-preorder-hint {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--product-set-muted);
    font-size: 0.78rem;
    line-height: 1.45;
}

.product-set-action-stack {
    display: grid;
    gap: 0.7rem;
}

.product-stat-popularity {
    background: transparent !important;
    border: 0;
    padding: 0.75rem 0 !important;
}

.product-stat-stars {
    color: #f59e0b;
    font-weight: 800;
    letter-spacing: 0.04em;
}

:deep(.product-set-cart-button.p-button) {
    min-height: 54px;
    border-radius: var(--market-radius-md, 10px);
    font-weight: 800;
    box-shadow: 0 10px 24px color-mix(in srgb, var(--market-primary, var(--primary-color)) 22%, transparent);
}

:deep(.product-set-login-button.p-button),
:deep(.product-set-detail-page-button.p-button) {
    min-height: 44px;
    border-radius: var(--market-radius-md, 10px);
    font-weight: 800;
}

:deep(.product-set-detail-page-button.p-button) {
    color: var(--market-primary, var(--primary-color));
}

@media (max-width: 640px) {
    :deep(.p-dialog) {
        margin: 0;
        height: 100vh;
        width: 100vw !important;
        max-height: 100vh;
        border-radius: 0;
    }

    :deep(.p-dialog-content) {
        padding-bottom: 5rem;
    }

    :deep(.product-detail-dialog--fullscreen .p-dialog-content) {
        height: calc(100dvh - 66px);
    }

    :deep(.product-detail-dialog--fullscreen) .product-detail-content {
        padding: 0 0 5rem;
    }

    :deep(.product-detail-dialog--fullscreen) .product-detail-content > .grid {
        min-height: auto;
    }

    :deep(.product-detail-dialog--fullscreen) .p-galleria-item img {
        max-height: 300px !important;
        height: 300px !important;
    }

    .product-set-preorder-preview {
        grid-template-columns: 1fr;
    }
}
</style>
