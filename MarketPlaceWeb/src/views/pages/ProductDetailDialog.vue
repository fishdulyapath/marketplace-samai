<!-- ProductDetailDialog.vue -->

<script setup>
import returnIcon from '@/assets/retun.png';
import CartQtyStepper from '@/components/product/CartQtyStepper.vue';
import { useSilentRefresh } from '@/composables/useSilentRefresh';
import ProductService from '@/services/ProductService';
import { useAuthenStore } from '@/stores/authen';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { getRemainingAddableQty, normalizeMaxOrderQty } from '@/utils/cartLimits';
import { pickProductName } from '@/utils/languageDisplay';
import { productDescriptionText, sanitizeProductDescription } from '@/utils/productDescription';
import { getPreorderSplit, isPreorderAllowed, toOrderQty, toStockQty } from '@/utils/preorderSplit';
import { formatCartUnitSummary, summarizeCartUnits } from '@/utils/cartUnitSummary';
import { buildUnitRatioText, collectProductUnits } from '@/utils/unitConversion';
import Dialog from 'primevue/dialog';
import Galleria from 'primevue/galleria';
import OverlayPanel from 'primevue/overlaypanel';
import ProgressSpinner from 'primevue/progressspinner';
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
// 🚨 ความหมายเปลี่ยนแล้ว (รีวิว 260908 สไลด์ 2): เดิมคือ "จำนวนที่จะเพิ่ม"
// ตอนนี้คือ "จำนวนรวมในตะกร้าของหน่วยที่เลือก" เพราะไม่มีปุ่มยืนยันแล้ว
// กด +/- แล้วเขียนลงตะกร้าเลย ค่าที่เห็นจึงต้องตรงกับตะกร้าเสมอ
const quantity = ref('0');
const loading = ref(true);
const priceLoading = ref(false);
const cartQtyStepper = ref(null);
// แยกสถานะบันทึกตามสินค้า+หน่วย เพื่อไม่ให้ request ของแพ็คไปล็อก/กระพริบที่ลัง
const pendingCartKeys = ref(new Set());
const toast = useToast();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = languageStore.t;
const selectedUnitIndex = ref(0);
const shareOverlay = ref(null); // อ้างอิงถึง OverlayPanel สำหรับแชร์
const showFullDescription = ref(false); // สำหรับควบคุมการแสดงรายละเอียดแบบเต็ม
const isFullScreenDetail = ref(false);

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
        : { width: '95vw', maxWidth: '960px', padding: 0 }
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

const safeProductDescription = computed(() => sanitizeProductDescription(product.value?.description || ''));
// รายละเอียดโปรโมชั่นที่แอดมินพิมพ์เอง — ล้าง HTML ด้วยตัวเดียวกับรายละเอียดสินค้า
const promotionDetailHtml = computed(() => sanitizeProductDescription(currentUnit.value?.promotion_detail || product.value?.promotion_detail || ''));
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

// quantity คือจำนวนรวมในตะกร้าอยู่แล้ว จึงไม่ต้องบวกของเดิมซ้ำ
const totalSelectedWithCart = computed(() => toOrderQty(quantity.value));

// Maximum Allowance = จำนวนสั่งสูงสุดต่อคำสั่งซื้อ กำหนดต่อหน่วย (REQ3)
// null = ไม่จำกัด · server บังคับซ้ำอีกชั้นที่ /sendorder
const maxAllowanceForUnit = computed(() => {
    const map = product.value?.max_order_qty_by_unit;
    const unitCode = currentUnit.value?.unit_code;
    if (!map || !unitCode) return null;
    return normalizeMaxOrderQty(map[unitCode]);
});

const remainingAllowanceToAdd = computed(() => {
    const max = maxAllowanceForUnit.value;
    if (max === null) return null;
    return Math.max(0, max - quantityInCart.value);
});

const exceedsMaxAllowance = computed(() => {
    const max = maxAllowanceForUnit.value;
    return max !== null && totalSelectedWithCart.value > max;
});

const exceedsAvailableStock = computed(() => {
    if (!currentUnit.value || isPreorderAllowed(currentUnit.value)) return false;
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

// สต็อกทั้งหมดของหน่วยนี้ (ไม่หักของที่อยู่ในตะกร้า) — quantity เป็นยอดรวมแล้ว
const maxStockForUnit = computed(() => {
    if (!currentUnit.value) return 0;
    const stock = toStockQty(currentUnit.value.balance_qty);
    return stock === null ? 0 : Math.max(0, Math.trunc(stock));
});

// เพดานที่ stepper กดขึ้นได้ — null = ไม่จำกัด
// พรีออเดอร์สั่งเกินสต็อกได้ จึงติดแค่โควตาต่อคำสั่งซื้อ
const maxCartQtyForUnit = computed(() => {
    const allowance = maxAllowanceForUnit.value;
    if (currentUnit.value && isPreorderAllowed(currentUnit.value)) return allowance;
    if (allowance === null) return maxStockForUnit.value;
    return Math.min(allowance, maxStockForUnit.value);
});

// "1 ลัง = 8 แพ็ค = 24 ถุง" (รีวิว 260908 สไลด์ 1)
const unitRatioText = computed(() => buildUnitRatioText(collectProductUnits(product.value), currentUnit.value?.unit_code));

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
const hasAnyUnitInCart = computed(() => cartUnitLines.value.length > 0);

const hasReachedMaxAllowance = computed(() => remainingAllowanceToAdd.value !== null && remainingAllowanceToAdd.value <= 0);
const remainingAddableQty = computed(() => getRemainingAddableQty(remainingStockToAdd.value, remainingAllowanceToAdd.value));

// หน่วยสินค้าที่กำลังเลือก
function getSelectedUnitSource() {
    if (!product.value) return null;
    if (selectedUnitIndex.value === 0) return product.value;
    return product.value.otherUnits?.[selectedUnitIndex.value - 1] || null;
}

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
        discount_promotion: Array.isArray(unit.discount_promotion) ? unit.discount_promotion : [],
        sold_out: resolveOrderableSoldOut({ ...unit, preorder_allowed: preorderAllowed })
    };
});

function cartUnitKey(unit = currentUnit.value) {
    if (!product.value || !unit?.unit_code) return '';
    return `${unit.item_code || product.value.id || product.value.code}::${unit.unit_code}`;
}

const currentCartUnitKey = computed(() => cartUnitKey());
const isCurrentCartUnitBusy = computed(() => pendingCartKeys.value.has(currentCartUnitKey.value));

function setCartUnitBusy(key, busy) {
    if (!key) return;
    const next = new Set(pendingCartKeys.value);
    if (busy) next.add(key);
    else next.delete(key);
    pendingCartKeys.value = next;
}

function resolveOrderableSoldOut(unit) {
    if (!unit) return '1';
    if (isPreorderAllowed(unit)) return '0';
    const balanceQty = toStockQty(unit.balance_qty);
    if (balanceQty !== null && balanceQty <= 0) return '1';
    return String(unit.sold_out ?? '0');
}

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

const formattedDiscountPromotions = computed(() => {
    if (!currentUnit.value || !currentUnit.value.discount_promotion || currentUnit.value.discount_promotion.length === 0) {
        return [];
    }

    const sortedDiscounts = [...currentUnit.value.discount_promotion].sort((a, b) => {
        return toDialogNumber(a.from_qty, 0) - toDialogNumber(b.from_qty, 0);
    });

    return sortedDiscounts.map((promo, index) => {
        const fromQty = toDialogNumber(promo.from_qty, 0);
        const toQty = toDialogNumber(promo.to_qty, 0);
        const unitName = promo.unit_name || currentUnit.value.unit_code;
        const isLastItem = index === sortedDiscounts.length - 1 || toQty >= 9999;
        const displayText = isLastItem
            ? t('productDetail.buyFromQty', { from: fromQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), unit: unitName })
            : t('productDetail.buyFromToQty', { from: fromQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), to: toQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), unit: unitName });

        return {
            ...promo,
            displayText,
            discountText: promo.discount || '-'
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
            // ปิด dialog แล้วต้องหยุด timer ไม่งั้นยิง API ทิ้งไว้เรื่อยๆ
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
// รีเฟรชสต็อก/ราคาเบื้องหลัง (REQ1)
// merge เฉพาะฟิลด์ที่เปลี่ยนได้จริงลงใน object เดิม — ห้าม replace product.value ทั้งก้อน
// และห้ามโหลดรูปใหม่ ไม่งั้น Galleria จะกระพริบให้ผู้ใช้เห็น
const REFRESHABLE_FIELDS = ['balance_qty', 'sold_out', 'price', 'price1', 'price2', 'is_promotion', 'promotion', 'discount_promotion', 'preorder_allowed', 'preorder_mode', 'max_order_qty_by_unit'];

function mergeRefreshableFields(target, source) {
    if (!target || !source) return;
    for (const key of REFRESHABLE_FIELDS) {
        if (source[key] !== undefined) target[key] = source[key];
    }
}

async function refreshStockAndPriceSilently() {
    if (!props.itemCode || !product.value) return;

    const result = await ProductService.getProductByItemCode(props.itemCode);
    const fresh = result?.data;
    if (!fresh || !product.value) return;

    fresh.sold_out = resolveOrderableSoldOut(fresh);
    mergeRefreshableFields(product.value, fresh);

    // จับคู่หน่วยด้วย unit_code เพราะลำดับใน otherUnits อาจไม่คงที่
    if (Array.isArray(fresh.otherUnits) && Array.isArray(product.value.otherUnits)) {
        const freshByUnit = new Map(fresh.otherUnits.map((u) => [u.unit_code, u]));
        for (const unit of product.value.otherUnits) {
            const freshUnit = freshByUnit.get(unit.unit_code);
            if (!freshUnit) continue;
            freshUnit.preorder_allowed = freshUnit.preorder_allowed ?? fresh.preorder_allowed ?? 0;
            freshUnit.sold_out = resolveOrderableSoldOut(freshUnit);
            mergeRefreshableFields(unit, freshUnit);
        }
    }

    // ราคาของหน่วยที่เลือกอยู่ mutate in-place อยู่แล้ว และไม่แตะ priceLoading
    await refreshSelectedUnitPrice({ silent: true });
}

const silentRefresh = useSilentRefresh(refreshStockAndPriceSilently);

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
        const result = await ProductService.getProductByItemCode(props.itemCode);

        // Process the data to set sold_out based on balance_qty
        if (result.data) {
            result.data.sold_out = resolveOrderableSoldOut(result.data);

            // ตรวจสอบว่ามี promotion หรือไม่ ถ้าไม่มีให้กำหนดเป็น array ว่าง
            if (!result.data.promotion) {
                result.data.promotion = [];
            }
            if (!result.data.discount_promotion) {
                result.data.discount_promotion = [];
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
                    if (!unit.discount_promotion) {
                        unit.discount_promotion = [];
                    }
                });
            }
        }

        product.value = result.data;

        // โหลดรูปภาพจาก API
        await fetchProductImages();
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

async function fetchProductImages() {
    if (!product.value || !product.value.code) {
        images.value = [{ itemImageSrc: ProductService.getPlaceholderImage(), thumbnailImageSrc: ProductService.getPlaceholderImage(), alt: productDisplayName.value || product.value?.name || t('common.product') }];
        return;
    }
    try {
        const imageList = await ProductService.getImageList(product.value.code);
        if (imageList && imageList.length > 0) {
            const imageCacheOptions = product.value;
            images.value = imageList.map((img) => ({
                itemImageSrc: ProductService.getProductImageByGuid(img.guid_code, imageCacheOptions),
                thumbnailImageSrc: ProductService.getProductImageByGuid(img.guid_code, imageCacheOptions),
                alt: productDisplayName.value,
                guid_code: img.guid_code
            }));
        } else {
            images.value = [{
                itemImageSrc: product.value.image || ProductService.getPlaceholderImage(),
                thumbnailImageSrc: product.value.image || ProductService.getPlaceholderImage(),
                alt: productDisplayName.value
            }];
        }
    } catch {
        images.value = [{
            itemImageSrc: product.value.image || ProductService.getPlaceholderImage(),
            thumbnailImageSrc: product.value.image || ProductService.getPlaceholderImage(),
            alt: productDisplayName.value
        }];
    }
}

async function refreshSelectedUnitPrice(options = {}) {
    if (!isLoggedIn.value || !product.value || !currentUnit.value) return;

    const unitSource = getSelectedUnitSource();
    if (!unitSource?.unit_code) return;

    // silent = รีเฟรชเบื้องหลัง ห้ามแตะ priceLoading เพราะมันทำให้ปุ่มเพิ่มลงตะกร้า disabled (REQ1)
    const silent = options.silent === true;
    if (!silent) priceLoading.value = true;
    try {
        const priceResult = await ProductService.getProductPrice(product.value.code, unitSource.unit_code, quantity.value || '1', localStorage.getItem('_userCode') || '', {
            barcode: unitSource.barcode || product.value.barcode || ''
        });

        if (priceResult) {
            unitSource.price = priceResult.price ?? unitSource.price;
            unitSource.type = priceResult.type ?? unitSource.type;
            unitSource.mode = priceResult.mode ?? unitSource.mode;
            unitSource.price_type = priceResult.roworder ?? priceResult.price_type ?? unitSource.price_type;
        }
    } catch (error) {
        console.warn(`Unable to refresh price for ${product.value.code}/${unitSource.unit_code}`, error);
    } finally {
        if (!silent) priceLoading.value = false;
    }
}

// แสดง overlay สำหรับแชร์
const isSoldOut = computed(() => currentUnit.value?.sold_out === '1');
const preorderPreview = computed(() => {
    if (!currentUnit.value) return { readyQty: 0, preorderQty: 0, totalQty: 0, hasPreorder: false, isBlockedByPreorderSetting: false };
    return getPreorderSplit({
        qty: toOrderQty(quantity.value),
        balance_qty: maxStockForUnit.value,
        preorder_allowed: currentUnit.value.preorder_allowed
    });
});
const isPreorderOnlyAvailable = computed(() => {
    if (!currentUnit.value || !isPreorderAllowed(currentUnit.value)) return false;
    const stockQty = toStockQty(currentUnit.value.balance_qty);
    return stockQty !== null && stockQty <= 0;
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

const currentPrice = computed(() => toDialogNumber(currentUnit.value?.price, 0));

const hasValidPrice = computed(() => !isLoggedIn.value || currentPrice.value > 0);

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

// ดึงจำนวนจริงของหน่วยที่เลือกจากตะกร้ามาใส่ stepper
// เรียกทุกครั้งหลังยิง API และเมื่อสลับหน่วย/โหลดสินค้าใหม่
function syncQuantityFromCart() {
    quantity.value = String(quantityInCart.value);
}

// สลับหน่วย / ตะกร้าเปลี่ยนจากที่อื่น → เลขบน stepper ต้องตามทันที
watch(quantityInCart, syncQuantityFromCart, { immediate: true });

// เขียนจำนวนใหม่ลงตะกร้าโดยตรง — nextQty คือ "จำนวนรวมที่ต้องการ" ไม่ใช่ส่วนต่าง
// (cartStore.addToCart ตีความแบบสัมบูรณ์อยู่แล้ว ดู cartStore.js:389)
function commitCartQty(nextQty) {
    if (!product.value) return;
    if (!isLoggedIn.value) {
        goToLogin();
        return;
    }

    // จับหน่วยไว้ตั้งแต่เข้าฟังก์ชัน หลัง CartQtyStepper flush ก่อน changeUnit
    // ห้ามอ่าน currentUnit ใหม่หลังเริ่มงาน async เพราะผู้ใช้อาจสลับหน่วยไปแล้ว
    const unit = currentUnit.value;
    if (!unit) return;
    const pendingKey = cartUnitKey(unit);
    if (pendingCartKeys.value.has(pendingKey)) return;

    const requested = Math.max(0, Math.trunc(Number(nextQty) || 0));

    // ลดจนเหลือ 0 = เอาออกจากตะกร้า
    if (requested === 0) {
        const line = cartStore.cartItems.find((item) => item.item_code === (unit.item_code || product.value.code) && item.unit_code === unit.unit_code);
        if (!line) return;
        setCartUnitBusy(pendingKey, true);
        cartStore
            .removeFromCart(line.guid_code || line.id)
            .catch((err) => {
                console.error('Error removing from cart:', err);
                toast.add({ severity: 'error', summary: t('productDetail.error'), detail: t('productDetail.addCartFailed'), life: 3000 });
            })
            .finally(() => {
                setCartUnitBusy(pendingKey, false);
                syncQuantityFromCart();
            });
        return;
    }

    // ปุ่มยืนยันหายไปแล้ว การกัน "สั่งเกิน" จึงต้องมาอยู่ตรงนี้แทน
    const cap = maxCartQtyForUnit.value;
    const finalQty = cap === null ? requested : Math.min(requested, cap);
    if (finalQty <= 0) {
        syncQuantityFromCart();
        return;
    }
    if (finalQty < requested) {
        toast.add({
            severity: 'info',
            summary: t('productDetail.stockInfo'),
            detail: t('productDetail.stockTotal', { qty: finalQty, unit: unit.unit_code }),
            life: 3000
        });
    }

    // เตรียมข้อมูลสินค้าสำหรับเพิ่มลงตะกร้า
    const unitPrice = toDialogNumber(unit.price, 0);
    if (unitPrice <= 0) {
        toast.add({
            severity: 'warn',
            summary: t('productDetail.productPriceMissing'),
            detail: t('productDetail.selectUnitAgain'),
            life: 3000
        });
        syncQuantityFromCart();
        return;
    }
    const cartItem = {
        id: product.value.id || product.value.code,
        item_code: unit.item_code || product.value.code,
        code: product.value.code,
        name: product.value.name,
        item_name: unit.item_name || product.value.name,
        price: unitPrice,
        image: product.value.image,
        category: product.value.category || '',
        unit: unit.unit_code,
        unit_code: unit.unit_code,
        barcode: unit.barcode || product.value.barcode || '',
        wh_code: unit.wh_code || '',
        shelf_code: unit.shelf_code || '',
        stand_value: unit.stand_value || '1',
        divide_value: unit.divide_value || '1',
        ratio: unit.ratio || '1',
        item_type: unit.item_type || product.value.item_type || '0',
        is_promotion: unit.is_promotion || product.value.is_promotion || '0',
        balance_qty: unit.balance_qty,
        preorder_allowed: unit.preorder_allowed ?? product.value.preorder_allowed ?? 0,
        preorder_mode: unit.preorder_mode ?? product.value.preorder_mode ?? 'default',
        tax_type: unit.tax_type ?? product.value.tax_type ?? 0
    };

    // ปิด stepper ระหว่างยิง API กันกดซ้อนจนจำนวนเพี้ยน
    setCartUnitBusy(pendingKey, true);
    cartItem.qty = finalQty;

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
            setCartUnitBusy(pendingKey, false);
            // ดึงค่าจริงจากตะกร้ากลับมา — สำเร็จก็ตรงอยู่แล้ว ล้มเหลวก็เด้งกลับค่าเดิม
            syncQuantityFromCart();
        });
}

// เปลี่ยนหน่วยสินค้า
// 🚨 ห้ามรีเซ็ตเป็น '1' อีก — ไม่มีปุ่มยืนยันแล้ว การตั้งค่าเองจะกลายเป็น
//    การสั่งซื้อโดยที่ผู้ใช้ไม่ได้กด ปล่อยให้ watcher ด้านล่างดึงจำนวนจริง
//    ของหน่วยใหม่จากตะกร้ามาแทน (0 ถ้าหน่วยนั้นยังไม่มีในตะกร้า)
function changeUnit(index) {
    if (index !== selectedUnitIndex.value) cartQtyStepper.value?.flushPending();
    selectedUnitIndex.value = index;
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
        :style="dialogStyle"
        :breakpoints="dialogBreakpoints"
        :closable="true"
        :closeOnEscape="true"
        :dismissableMask="true"
        :baseZIndex="baseZIndex"
        :showHeader="false"
        @hide="closeDialog"
        :class="dialogClass"
    >
        <Toast position="top-right" />

        <OverlayPanel ref="shareOverlay" dismissable>
            <div class="p-2 min-w-[160px]">
                <h4 class="text-sm font-semibold mb-2" style="color:#333">{{ t('productDetail.shareProduct') }}</h4>
                <div class="flex flex-col gap-1">
                    <button v-for="(item, i) in shareItems" :key="i" type="button" class="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer text-sm w-full border-0 bg-transparent text-left" :aria-label="item.label" @click="item.command">
                        <i :class="[item.icon, 'text-base']" style="color:var(--market-primary, var(--primary-color, #0f9f6e))"></i>
                        <span>{{ item.label }}</span>
                    </button>
                </div>
            </div>

        </OverlayPanel>

        <!-- Loading -->
        <div v-if="loading" class="flex justify-center items-center" style="min-height:360px">
            <ProgressSpinner style="width:48px" />
        </div>

        <!-- Content -->
        <div v-else-if="product" class="spd-root">

            <!-- ── Close button ── -->
            <button class="spd-close-btn spd-floating-close-btn" type="button" @click="closeDialog" :aria-label="t('productDetail.close')">
                <i class="pi pi-times"></i>
            </button>

            <div class="spd-layout">

                <!-- ═══ LEFT: รูปสินค้า ═══ -->
                <div class="spd-img-col">
                    <div class="spd-main-img-wrap">
                        <!-- Sold out overlay -->
                        <div v-if="isSoldOut" class="spd-soldout-overlay">
                            <span>{{ t('productDetail.soldOut') }}</span>
                        </div>
                        <div v-else-if="isPreorderOnlyAvailable" class="spd-preorder-overlay">
                            <span>{{ t('productDetail.preorderLabel') }}</span>
                        </div>
                        <!-- Return badge -->
                        <div v-if="product.is_return === '1'" class="spd-return-badge">
                            <img :src="returnIcon" :alt="t('productDetail.returnAlt')" style="height:58px;width:auto" />
                        </div>
                        <!-- Galleria -->
                        <Galleria
                            :value="images"
                            :numVisible="5"
                            :circular="true"
                            :showThumbnails="images.length > 1"
                            :showItemNavigators="images.length > 1"
                            containerClass="spd-galleria"
                        >
                            <template #item="slotProps">
                                <img
                                    :src="slotProps.item.itemImageSrc"
                                    :alt="productDisplayName || slotProps.item.alt"
                                    class="spd-main-img"
                                    @error="$event.target.src = ProductService.getPlaceholderImage()"
                                />
                            </template>
                            <template #thumbnail="slotProps">
                                <div class="spd-thumb-wrap">
                                    <img
                                        :src="slotProps.item.thumbnailImageSrc"
                                        :alt="productDisplayName || slotProps.item.alt"
                                        class="spd-thumb-img"
                                        @error="$event.target.src = ProductService.getPlaceholderImage()"
                                    />
                                </div>
                            </template>
                        </Galleria>
                    </div>

                    <!-- รายละเอียดสินค้า: desktop/tablet แสดงใต้รูป -->
                    <div v-if="product.description" class="spd-desc-box spd-left-desc-box">
                        <div class="spd-desc-title">{{ t('productDetail.productDetail') }}</div>
                        <div :class="['spd-desc-text', !showFullDescription ? 'spd-desc-clamp' : '']" v-html="safeProductDescription"></div>
                        <button v-if="shouldShowMoreButton" type="button" class="spd-more-btn" :aria-expanded="showFullDescription" @click="showFullDescription = !showFullDescription">
                            {{ showFullDescription ? t('productDetail.collapse') : t('productDetail.readMore') }}
                        </button>
                    </div>
                </div>

                <!-- ═══ RIGHT: ข้อมูลสินค้า ═══ -->
                <div class="spd-info-col">

                    <!-- ชื่อสินค้า -->
                    <div class="spd-title-row">
                        <h1 class="spd-name">{{ productDisplayName }}</h1>
                        <div class="spd-top-actions">
                            <button class="spd-share-btn" type="button" @click="toggleShareMenu" :aria-label="t('productDetail.shareProduct')">
                                <i class="pi pi-share-alt"></i>
                            </button>
                            <button class="spd-favorite-btn" type="button" :class="{ 'is-favorite': product.favorite_item === '1' }" :aria-pressed="product.favorite_item === '1'" @click="toggleFavorite" :aria-label="product.favorite_item === '1' ? t('productDetail.removeFavorite') : t('productDetail.addFavorite')">
                                <i :class="product.favorite_item === '1' ? 'pi pi-heart-fill' : 'pi pi-heart'"></i>
                            </button>
                            <button class="spd-close-btn" type="button" @click="closeDialog" :aria-label="t('productDetail.close')">
                                <i class="pi pi-times"></i>
                            </button>
                        </div>
                    </div>

                    <!-- รหัส -->
                    <div class="spd-code">{{ t('productDetail.productCode') }}: <span>{{ product.code }}</span></div>

                    <!-- ยอดขาย + คงเหลือ -->
                    <div v-if="shouldShowSales || shouldShowStock" class="spd-stats-row">
                        <span v-if="shouldShowSales" class="spd-stat-item" :class="{ 'is-popularity': isSalesPopularityMode }">
                            <template v-if="!isSalesPopularityMode">{{ t('productDetail.sales') }} </template>
                            <strong>{{ currentSalesText || '-' }}</strong>
                        </span>
                        <span v-if="!isSalesPopularityMode && shouldShowSales && shouldShowStock" class="spd-stat-divider">|</span>
                        <span v-if="shouldShowStock" class="spd-stat-item" :class="toStockQty(currentUnit?.balance_qty) <= 0 ? 'spd-stat-low' : ''">
                            {{ t('productDetail.stock') }} <strong>{{ currentUnit ? formatNumber(currentUnit.balance_qty) : '-' }}</strong> {{ currentUnit?.unit_code }}
                        </span>
                    </div>

                    <!-- ── ราคา ── -->
                    <div class="spd-price-box">
                        <template v-if="isLoggedIn && currentUnit && priceLoading">
                            <div class="spd-login-prompt">
                                <i class="pi pi-spin pi-spinner mr-2"></i>
                                <span>{{ t('productDetail.checkingPrice') }}</span>
                            </div>
                        </template>
                        <template v-else-if="isLoggedIn && currentUnit">
                            <span class="spd-currency">฿</span>
                            <span class="spd-price">{{ toDialogNumber(currentUnit.price, 0).toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', { minimumFractionDigits: 2 }) }}</span>
                            <span class="spd-unit">/ {{ currentUnit.unit_code }}</span>
                        </template>
                        <template v-else-if="!isLoggedIn">
                            <div class="spd-login-prompt">
                                <i class="pi pi-lock mr-2"></i>
                                <span>{{ t('productDetail.loginForPrice') }}</span>
                                <button class="spd-login-link" type="button" @click="goToLogin">{{ t('productDetail.login') }}</button>
                            </div>
                        </template>
                    </div>
                    <div v-if="isLoggedIn && currentUnit && !priceLoading && !hasValidPrice" class="spd-price-warning">
                        <i class="pi pi-exclamation-circle"></i>
                        {{ t('productDetail.noUnitPrice') }}
                    </div>

                    <!-- ── หน่วยสินค้า ── -->
                    <div v-if="product.otherUnits && product.otherUnits.length > 0" class="spd-row">
                        <div class="spd-row-label">{{ t('productDetail.productUnit') }}</div>
                        <div class="flex flex-wrap gap-2">
                            <button
                                type="button"
                                :class="['spd-unit-btn', selectedUnitIndex === 0 ? 'spd-unit-btn--active' : '']"
                                :aria-pressed="selectedUnitIndex === 0"
                                :aria-label="`${t('productDetail.selectUnit')} ${product.unit_code}`"
                                @click="changeUnit(0)"
                            >{{ product.unit_code }}</button>
                            <button
                                v-for="(unitItem, idx) in product.otherUnits"
                                :key="idx"
                                type="button"
                                :class="['spd-unit-btn', selectedUnitIndex === idx + 1 ? 'spd-unit-btn--active' : '']"
                                :aria-pressed="selectedUnitIndex === idx + 1"
                                :aria-label="`${t('productDetail.selectUnit')} ${unitItem.unit_code}`"
                                @click="changeUnit(idx + 1)"
                            >{{ unitItem.unit_code }}</button>
                        </div>
                    </div>

                    <!-- ตัวคูณหน่วย — ลูกค้าไม่รู้ว่า 1 ลังมีกี่แพ็ค (รีวิว 260908 สไลด์ 1) -->
                    <div v-if="unitRatioText" class="spd-unit-ratio">
                        <i class="pi pi-box"></i>
                        <span>{{ unitRatioText }}</span>
                    </div>

                    <!-- ── รายละเอียดโปรโมชั่นที่แอดมินพิมพ์เอง (dimension_39) ── -->
                    <div v-if="promotionDetailHtml" class="spd-offer-box is-custom">
                        <div class="spd-offer-title">{{ t('productDetail.promotion') }}</div>
                        <!-- eslint-disable-next-line vue/no-v-html -- ผ่าน sanitizeProductDescription แล้ว
                             ตัวเดียวกับที่ใช้กับช่องรายละเอียดสินค้า -->
                        <div class="spd-offer-html" v-html="promotionDetailHtml"></div>
                    </div>

                    <!-- ── โปรโมชั่นของหน่วยที่เลือก ── -->
                    <div v-if="isLoggedIn && formattedPromotions.length > 0" class="spd-offer-box">
                        <div class="spd-offer-title">{{ t('productDetail.promotion') }}</div>
                        <div v-for="(promo, idx) in formattedPromotions" :key="idx" class="spd-offer-line">
                            <span>{{ promo.displayText }}</span>
                            <strong>฿{{ promo.formattedPrice }}</strong>
                        </div>
                    </div>

                    <!-- ── ส่วนลดของหน่วยที่เลือก ── -->
                    <div v-if="isLoggedIn && formattedDiscountPromotions.length > 0" class="spd-offer-box is-discount">
                        <div class="spd-offer-title">{{ t('productDetail.discount') }}</div>
                        <div v-for="(promo, idx) in formattedDiscountPromotions" :key="idx" class="spd-offer-line">
                            <span>{{ promo.displayText }}</span>
                            <strong>{{ promo.discountText }}</strong>
                        </div>
                    </div>

                    <!-- ── สินค้าหมด ── -->
                    <div v-if="isSoldOut" class="spd-alert-soldout">
                        <i class="pi pi-ban mr-2"></i>{{ t('productDetail.unitSoldOut') }}
                    </div>
                    <div v-else-if="isPreorderOnlyAvailable" class="spd-alert-preorder">
                        <i class="pi pi-clock mr-2"></i>{{ t('productDetail.preorderOnlyHint') }}
                    </div>

                    <!-- ── ในตะกร้า ── -->
                    <!-- แสดงทุกหน่วยที่มีในตะกร้า ไม่ใช่เฉพาะหน่วยที่เลือกอยู่ -->
                    <div v-if="hasAnyUnitInCart" class="spd-incart-bar">
                        <i class="pi pi-shopping-cart mr-1"></i>
                        {{ t('productDetail.inCart') }} <strong class="mx-1">{{ cartUnitSummaryText }}</strong>
                        <span v-if="hasReachedMaxAllowance" class="ml-auto text-xs" style="color:#888">{{ t('productDetail.maxAllowanceReached') }}</span>
                        <span v-else-if="shouldShowStock && remainingAddableQty >= 0" class="ml-auto text-xs" style="color:#888">{{ t('productDetail.addMore', { qty: remainingAddableQty }) }}</span>
                    </div>

                    <!-- ── จำนวน ── -->
                    <div class="spd-row spd-qty-row">
                        <div class="spd-row-label">{{ t('productDetail.quantity') }}</div>
                        <!-- กด +/- แล้วเข้า/ออกตะกร้าทันที ไม่มีปุ่มยืนยันอีกแล้ว -->
                        <CartQtyStepper
                            ref="cartQtyStepper"
                            :model-value="quantityInCart"
                            :max="maxCartQtyForUnit"
                            :busy="isCurrentCartUnitBusy"
                            :disabled="!isLoggedIn || (isSoldOut && quantityInCart === 0) || !hasValidPrice || priceLoading"
                            :decrease-label="t('productDetail.decreaseQuantityAria')"
                            :increase-label="t('productDetail.increaseQuantityAria')"
                            :input-label="t('productDetail.quantityAria')"
                            @commit="commitCartQty"
                        />
                    </div>

                    <!-- จำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3) -->
                    <div v-if="maxAllowanceForUnit !== null && currentUnit" class="spd-max-allowance" :class="{ 'is-exceeded': exceedsMaxAllowance }">
                        <i class="pi pi-info-circle"></i>
                        <span>{{ t('productDetail.maxAllowanceHint', { max: maxAllowanceForUnit, unit: currentUnit.unit_code }) }}</span>
                    </div>

                    <div v-if="isLoggedIn && currentUnit && !isSoldOut && preorderPreview.totalQty > 0" class="spd-preorder-preview" :class="{ 'has-preorder': preorderPreview.hasPreorder }">
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
                        <p v-if="preorderActionHint" class="spd-preorder-hint">{{ preorderActionHint }}</p>
                    </div>

                    <!-- ── ปุ่ม action ── -->
                    <!-- แถบปุ่มล่างเหลือไว้เฉพาะตอนยังไม่ล็อกอิน (ปุ่มเข้าสู่ระบบ)
                         ล็อกอินแล้วไม่มีปุ่มอะไรต้องกดที่นี่ — ตัวเพิ่ม/ลดจำนวนด้านบน
                         เขียนลงตะกร้าเองแล้ว และปุ่มปิดอยู่มุมบนขวาของ dialog -->
                    <div class="spd-actions" v-if="!isLoggedIn">
                        <button class="spd-btn-buy w-full" type="button" @click="goToLogin">
                            <i class="pi pi-sign-in mr-2"></i>{{ t('productDetail.loginToOrder') }}
                        </button>
                    </div>

                    <!-- ── แชร์ & รายการโปรด ── -->
                    <div class="spd-share-row">
                        <span class="spd-share-label">{{ t('productDetail.shareLabel') }}</span>
                        <button class="spd-share-btn" type="button" :aria-label="t('productDetail.shareProduct')" @click="toggleShareMenu">
                            <i class="pi pi-share-alt"></i>
                        </button>
                        <button class="spd-favorite-btn" type="button" :class="{ 'is-favorite': product.favorite_item === '1' }" :aria-pressed="product.favorite_item === '1'" @click="toggleFavorite" :aria-label="product.favorite_item === '1' ? t('productDetail.removeFavorite') : t('productDetail.addFavorite')">
                            <i :class="product.favorite_item === '1' ? 'pi pi-heart-fill' : 'pi pi-heart'"></i>
                        </button>
                    </div>

                    <button class="spd-detail-page-btn" type="button" :aria-label="t('productDetail.viewMoreDetails')" @click="goToProductPage">
                        <i class="pi pi-external-link"></i>
                        {{ t('productDetail.viewMoreDetails') }}
                    </button>
                </div>
            </div>
        </div>

        <!-- Empty -->
        <div v-else-if="!loading" class="flex flex-col items-center justify-center p-10" style="color:#aaa;min-height:200px">
            <i class="pi pi-inbox text-4xl mb-3"></i>
            <span>{{ t('productDetail.productNotFound') }}</span>
        </div>
    </Dialog>
</template>

<style scoped>
/* ══════════════════════════════════════════════
   Dialog shell — Shopee-style clean white
══════════════════════════════════════════════ */
/* ── Dialog reset ── */
:deep(.product-detail-dialog .p-dialog) {
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 4px 32px rgba(0,0,0,0.18);
    border: none;
}
:deep(.p-dialog-content) {
    padding: 0 !important;
    background: #fff;
}

/* ══════════════════════════════════════════════
   Root wrapper
══════════════════════════════════════════════ */
.spd-root {
    position: relative;
    background: #fff;
    --spd-primary: var(--market-primary, var(--primary-color, #0f9f6e));
    --spd-accent: var(--market-accent, #f97316);
    --spd-card-border: var(--market-card-border, #e5e7eb);
}

/* Close button */
.spd-close-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 20;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    background: rgba(0,0,0,0.35);
    color: #fff;
    font-size: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
}
.spd-close-btn:hover { background: rgba(0,0,0,0.55); }

/* ══════════════════════════════════════════════
   Layout — 2 columns
══════════════════════════════════════════════ */
.spd-layout {
    display: grid;
    grid-template-columns: 380px 1fr;
    align-items: start;
    min-height: 480px;
}

/* ══════════════════════════════════════════════
   LEFT — Image column
══════════════════════════════════════════════ */
.spd-img-col {
    background: #f5f5f5;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px;
    align-self: stretch;
}

.spd-main-img-wrap {
    position: relative;
    width: 100%;
    background: #fff;
    border: 1px solid #eee;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
}

.spd-main-img {
    width: 100%;
    height: 320px;
    object-fit: contain;
    padding: 8px;
    display: block;
}

/* ── Galleria ── */
:deep(.spd-galleria) {
    width: 100%;
}
:deep(.spd-galleria .p-galleria-item-wrapper) {
    background: #fff;
}
:deep(.spd-galleria .p-galleria-thumbnail-container) {
    background: #f5f5f5;
    padding: 8px 4px;
}
:deep(.spd-galleria .p-galleria-thumbnail-item) {
    opacity: 0.65;
    transition: all 0.2s;
    border: 2px solid transparent;
    border-radius: 4px;
    overflow: hidden;
}
:deep(.spd-galleria .p-galleria-thumbnail-item:hover) {
    opacity: 0.9;
}
:deep(.spd-galleria .p-galleria-thumbnail-item-active) {
    opacity: 1 !important;
    border-color: #ee4d2d !important;
}
:deep(.spd-galleria .p-galleria-item-nav) {
    background: rgba(255,255,255,0.85);
    border-radius: 50%;
    width: 36px;
    height: 36px;
    margin: 0 6px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}
:deep(.spd-galleria .p-galleria-item-nav:hover) {
    background: #fff;
}
:deep(.spd-galleria .p-galleria-item-nav .p-icon) {
    font-size: 0.9rem;
    color: #555;
}

.spd-thumb-wrap {
    width: 64px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    border-radius: 2px;
    overflow: hidden;
}
.spd-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.spd-soldout-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 5;
    color: #fff;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.05em;
}

.spd-preorder-overlay {
    position: absolute;
    left: 8px;
    top: 8px;
    z-index: 5;
    background: #fff7ed;
    color: #c2410c;
    border: 1px solid #fed7aa;
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 800;
}

.spd-return-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 6;
    background: rgba(255,255,255,0.9);
    border-radius: 4px;
    padding: 3px 5px;
}

/* ══════════════════════════════════════════════
   RIGHT — Info column
══════════════════════════════════════════════ */
.spd-info-col {
    padding: 24px 28px 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    max-height: 80vh;
}

/* ชื่อสินค้า */
.spd-name {
    font-size: 1.4rem;
    font-weight: 600;
    color: #212121;
    line-height: 1.5;
    margin: 0 0 8px;
}

/* รหัส */
.spd-code {
    font-size: 0.9rem;
    color: #999;
    margin-bottom: 6px;
}
.spd-code span { color: #555; }

/* สถิติ */
.spd-stats-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.95rem;
    color: #767676;
    padding-bottom: 12px;
    border-bottom: 1px solid #f0f0f0;
    margin-bottom: 0;
}
.spd-stat-item strong { color: #333; }
.spd-stat-divider { color: #ddd; }
.spd-stat-low strong { color: #ee4d2d; }

/* ── ราคา ── */
.spd-price-box {
    background: #fafafa;
    padding: 14px 16px;
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 0;
}
.spd-currency {
    font-size: 1.15rem;
    color: #ee4d2d;
    font-weight: 500;
    align-self: flex-start;
    margin-top: 4px;
}
.spd-price {
    font-size: 2.2rem;
    font-weight: 500;
    color: #ee4d2d;
    line-height: 1;
}
.spd-unit {
    font-size: 1rem;
    color: #999;
}

/* login prompt */
.spd-login-prompt {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 1rem;
    color: #555;
}
.spd-login-link {
    background: none;
    border: 1px solid #ee4d2d;
    color: #ee4d2d;
    padding: 3px 10px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 0.95rem;
    transition: background 0.14s;
}
.spd-login-link:hover { background: #fff0ee; }

/* ── row label ── */
.spd-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #f5f5f5;
}
.spd-row-label {
    flex-shrink: 0;
    width: 80px;
    font-size: 0.95rem;
    color: #999;
    padding-top: 2px;
}

/* ── โปรโมชั่น / ส่วนลด ── */
.spd-offer-box {
    margin: 10px 0;
    border: 1px solid color-mix(in srgb, var(--spd-primary) 18%, #fff);
    border-radius: 10px;
    background: color-mix(in srgb, var(--spd-primary) 6%, #fff);
    padding: 0.8rem;
}
.spd-offer-box.is-custom {
    border-color: #fed7aa;
    background: #fff7ed;
}
.spd-offer-html {
    color: var(--market-text, #4a3300);
    font-size: 0.88rem;
    line-height: 1.5;
}
.spd-offer-html :deep(p) {
    margin: 0 0 0.35rem;
}
.spd-offer-html :deep(p:last-child) {
    margin-bottom: 0;
}
.spd-offer-box.is-discount {
    border-color: #bbf7d0;
    background: #f0fdf4;
}
.spd-offer-title {
    margin-bottom: 0.5rem;
    color: var(--spd-primary);
    font-size: 0.86rem;
    font-weight: 900;
}
.spd-offer-box.is-discount .spd-offer-title,
.spd-offer-box.is-discount strong {
    color: #047857;
}
.spd-offer-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    border-radius: 0.6rem;
    background: #fff;
    padding: 0.55rem 0.65rem;
    font-size: 0.86rem;
}
.spd-offer-line + .spd-offer-line {
    margin-top: 0.45rem;
}
.spd-offer-line span {
    color: #334155;
}
.spd-offer-line strong {
    color: var(--spd-primary);
    white-space: nowrap;
}

/* ── หน่วย ── */
.spd-unit-btn {
    padding: 5px 16px;
    border-radius: 2px;
    font-size: 0.95rem;
    border: 1px solid #d0d0d0;
    background: #fff;
    color: #333;
    cursor: pointer;
    transition: all 0.14s;
    position: relative;
}
.spd-unit-btn:hover { border-color: #ee4d2d; color: #ee4d2d; }
.spd-unit-btn--active {
    border-color: #ee4d2d;
    color: #ee4d2d;
    background: #fff8f7;
}


/* ── สินค้าหมด ── */
.spd-alert-soldout {
    display: flex;
    align-items: center;
    background: #fff2f2;
    border: 1px solid #fca5a5;
    color: #dc2626;
    padding: 8px 14px;
    border-radius: 2px;
    font-size: 0.95rem;
    margin: 8px 0;
}

/* ── ในตะกร้า ── */
.spd-alert-preorder {
    display: flex;
    align-items: center;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    color: #c2410c;
    padding: 8px 14px;
    border-radius: 2px;
    font-size: 0.95rem;
    margin: 8px 0;
}

.spd-incart-bar {
    display: flex;
    align-items: center;
    background: #fff8f7;
    border: 1px solid #ffddd9;
    color: #c84b37;
    padding: 7px 14px;
    border-radius: 2px;
    font-size: 0.95rem;
    gap: 4px;
    margin: 4px 0;
}

/* ── จำนวน ── */
.spd-qty-row { align-items: center; }

/* ── ตัวคูณหน่วย: 1 ลัง = 8 แพ็ค ── */
.spd-unit-ratio {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.4rem;
    font-size: 0.8rem;
    color: var(--spd-muted, #6b7280);
}
.spd-unit-ratio i { font-size: 0.75rem; }

/* ── จำนวนสั่งสูงสุดต่อคำสั่งซื้อ ── */
.spd-max-allowance {
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
.spd-max-allowance i {
    margin-top: 0.1rem;
    flex: 0 0 auto;
}
.spd-max-allowance.is-exceeded {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
    font-weight: 600;
}

/* ── ปุ่ม action ── */
.spd-actions {
    display: flex;
    gap: 12px;
    padding: 16px 0 8px;
}

.spd-btn-buy {
    flex: 1;
    height: 44px;
    border: none;
    background: #ee4d2d;
    color: #fff;
    font-size: 1.05rem;
    font-weight: 500;
    border-radius: 2px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.14s;
}
.spd-btn-buy:hover:not(:disabled) { background: #d73211; }
.spd-btn-buy:disabled { opacity: 0.45; cursor: default; }

/* ── แชร์ ── */
.spd-share-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0 10px;
    border-bottom: 1px solid #f5f5f5;
}
.spd-share-label { font-size: 0.95rem; color: #999; }
.spd-share-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid #d0d0d0;
    background: #fff;
    color: #555;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 0.14s, color 0.14s;
}
.spd-share-btn:hover { border-color: #ee4d2d; color: #ee4d2d; }

/* ── รายละเอียด ── */
.spd-desc-box {
    padding: 10px 0 4px;
}
.spd-desc-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: #333;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.spd-desc-text {
    font-size: 0.95rem;
    color: #555;
    line-height: 1.7;
}
.spd-desc-text :deep(p) { margin: 0 0 0.65rem; }
.spd-desc-text :deep(p:last-child) { margin-bottom: 0; }
.spd-desc-text :deep(ul),
.spd-desc-text :deep(ol) {
    margin: 0.4rem 0 0.7rem 1.25rem;
    padding: 0;
}
.spd-desc-text :deep(li) { margin: 0.2rem 0; }
.spd-desc-text :deep(h1),
.spd-desc-text :deep(h2),
.spd-desc-text :deep(h3) {
    margin: 0.6rem 0 0.45rem;
    color: #333;
    font-weight: 700;
    line-height: 1.35;
}
.spd-desc-text :deep(a) {
    color: #ee4d2d;
    text-decoration: underline;
}
.spd-desc-clamp {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.spd-more-btn {
    background: none;
    border: none;
    color: var(--spd-primary);
    font-size: 0.9rem;
    cursor: pointer;
    padding: 4px 0 0;
    display: block;
}

.spd-detail-page-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.75rem;
    border: 1px solid var(--spd-primary);
    border-radius: 8px;
    background: color-mix(in srgb, var(--spd-primary) 8%, #fff);
    color: var(--spd-primary);
    cursor: pointer;
    font-weight: 700;
    padding: 0.55rem 0.8rem;
}

.spd-detail-page-btn:hover {
    background: color-mix(in srgb, var(--spd-primary) 14%, #fff);
}

/* ══════════════════════════════════════════════
   Mobile
══════════════════════════════════════════════ */
@media (max-width: 640px) {
    :deep(.p-dialog) {
        margin: 0;
        height: 100dvh;
        width: 100vw !important;
        max-height: 100dvh;
        border-radius: 0;
    }
    .spd-layout {
        grid-template-columns: 1fr;
    }

    :deep(.product-detail-dialog--fullscreen) .spd-layout {
        min-height: 100dvh;
        height: auto;
    }
    .spd-img-col {
        padding: 8px;
    }
    .spd-main-img-wrap {
        max-height: 260px;
    }
    .spd-info-col {
        padding: 16px;
        max-height: none;
    }
    .spd-price { font-size: 1.5rem; }
    .spd-actions { flex-direction: row; align-items: stretch; }
    .spd-btn-buy { width: auto; flex: 1; }

}

/* Tablet */
@media (min-width: 641px) and (max-width: 860px) {
    .spd-layout { grid-template-columns: 280px 1fr; }
    .spd-price { font-size: 1.6rem; }
}

input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

/* Modern quick-order dialog overrides */
:deep(.product-detail-dialog .p-dialog) {
    border-radius: var(--market-radius-lg, 14px);
    max-height: min(92vh, 900px);
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
}

.spd-root {
    --spd-primary: var(--market-primary, var(--primary-color, #0f9f6e));
    --spd-accent: var(--market-accent, #f97316);
    --spd-card: var(--market-card-bg, #ffffff);
    --spd-border: var(--market-card-border, #e5e7eb);
    --spd-muted: var(--market-muted, #64748b);
    --spd-text: var(--market-text, #111827);
}

.spd-layout {
    grid-template-columns: minmax(300px, 390px) minmax(0, 1fr);
    background: var(--spd-card);
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
    height: 100%;
}

:deep(.product-detail-dialog--fullscreen) .spd-root,
:deep(.product-detail-dialog--fullscreen) .spd-layout {
    height: 100%;
}

:deep(.product-detail-dialog--fullscreen) .spd-layout {
    grid-template-columns: minmax(360px, 44vw) minmax(0, 1fr);
}

:deep(.product-detail-dialog--fullscreen) .spd-img-col {
    overflow: auto;
    padding: 18px;
}

:deep(.product-detail-dialog--fullscreen) .spd-info-col {
    height: 100dvh;
    max-height: none;
    overflow: auto;
    padding: 28px 32px 120px;
}

:deep(.product-detail-dialog--fullscreen) .spd-main-img {
    height: min(58vh, 560px);
}

:deep(.product-detail-dialog--fullscreen) .spd-left-desc-box {
    max-height: none;
}

:deep(.product-detail-dialog--fullscreen) .spd-detail-page-btn:disabled {
    cursor: default;
    opacity: 0.62;
}

.spd-img-col {
    padding: 8px;
    background: color-mix(in srgb, var(--spd-primary) 5%, #f8fafc);
    border-right: 1px solid var(--spd-border);
}

.spd-main-img-wrap {
    border-radius: var(--market-radius-lg, 12px);
    border-color: var(--spd-border);
    overflow: hidden;
    background: #fff;
}

.spd-main-img {
    height: 330px;
    object-fit: contain;
}

.spd-info-col {
    padding: 22px 24px;
    max-height: 86vh;
}

.spd-title-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
}

.spd-name {
    margin: 0;
    color: var(--spd-text);
    font-size: 1.25rem;
    line-height: 1.45;
    font-weight: 800;
}

.spd-top-actions {
    display: flex;
    gap: 8px;
}

.spd-code {
    color: var(--spd-muted);
    margin-top: 6px;
}

.spd-stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 0 10px;
    border-bottom: 0;
}

.spd-stat-divider {
    display: none;
}

.spd-stat-item {
    border: 1px solid var(--spd-border);
    border-radius: 999px;
    background: #fff;
    color: var(--spd-muted);
    padding: 6px 10px;
    font-size: 0.78rem;
}

.spd-stat-item strong {
    color: var(--spd-text);
}

.spd-stat-item.is-popularity {
    border: 0;
    background: transparent;
    color: #f59e0b;
    padding: 6px 0;
}

.spd-stat-item.is-popularity strong {
    color: #f59e0b;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
}

.spd-price-box {
    border: 1px solid color-mix(in srgb, var(--spd-primary) 18%, #fff);
    border-radius: var(--market-radius-lg, 12px);
    background: color-mix(in srgb, var(--spd-primary) 7%, #fff);
    margin: 2px 0 10px;
    padding: 14px 16px;
}

.spd-currency,
.spd-price {
    color: var(--spd-primary);
}

.spd-unit {
    color: var(--spd-muted);
}

.spd-price-warning {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: -2px 0 10px;
    border: 1px solid #fecaca;
    border-radius: var(--market-radius-md, 10px);
    background: #fff7f7;
    color: #b91c1c;
    padding: 9px 12px;
    font-size: 0.86rem;
}

.spd-row {
    align-items: flex-start;
    gap: 12px;
    padding: 9px 0;
    border-bottom: 0;
}

.spd-row-label {
    width: 78px;
    color: var(--spd-muted);
    font-size: 0.82rem;
    font-weight: 800;
}

.spd-promo-list {
    gap: 8px;
}

.spd-promo-item {
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border: 1px solid var(--spd-border);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
    padding: 8px 10px;
}

.spd-promo-tag {
    border: 0;
    background: transparent;
    color: var(--spd-text);
    padding: 0;
}

.spd-promo-price {
    color: var(--spd-primary);
    white-space: nowrap;
}

.spd-discount-promo-value {
    color: #059669;
}

.spd-unit-btn {
    border-radius: 999px;
    border-color: var(--spd-border);
    min-height: 34px;
}

.spd-unit-btn:hover,
.spd-unit-btn--active {
    border-color: var(--spd-primary);
    color: var(--spd-primary);
    background: color-mix(in srgb, var(--spd-primary) 8%, #fff);
}

.spd-alert-soldout,
.spd-alert-preorder,
.spd-incart-bar {
    border-radius: var(--market-radius-md, 10px);
}

.spd-incart-bar {
    background: color-mix(in srgb, var(--spd-primary) 7%, #fff);
    border-color: color-mix(in srgb, var(--spd-primary) 20%, #fff);
    color: var(--spd-primary);
}

.spd-preorder-preview {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    border: 1px solid var(--spd-border);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
    padding: 10px;
    margin: 2px 0 10px;
}

.spd-preorder-preview > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--spd-primary) 6%, #fff);
    padding: 8px 10px;
}

.spd-preorder-preview.has-preorder > div:nth-child(2) {
    background: #fff7ed;
    color: #c2410c;
}

.spd-preorder-preview .is-blocked {
    background: #fff2f2;
    color: #b91c1c;
}

.spd-preorder-preview span {
    color: var(--spd-muted);
    font-size: 0.75rem;
    font-weight: 700;
}

.spd-preorder-preview strong {
    color: inherit;
    font-size: 0.95rem;
}

.spd-preorder-hint {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--spd-muted);
    font-size: 0.78rem;
    line-height: 1.45;
}


.spd-actions {
    position: sticky;
    bottom: 0;
    z-index: 8;
    margin: 0 -24px;
    padding: 16px 24px 10px;
    background: linear-gradient(to top, #fff 84%, rgba(255, 255, 255, 0));
}

.spd-btn-buy {
    background: var(--spd-primary);
}

.spd-btn-buy:hover:not(:disabled) {
    background: color-mix(in srgb, var(--spd-primary) 88%, #000);
}

.spd-share-row {
    display: none;
}

.spd-share-btn,
.spd-favorite-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid #d0d0d0;
    background: #fff;
    color: #555;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 0.14s, color 0.14s;
}

.spd-share-btn:hover,
.spd-favorite-btn:hover {
    border-color: var(--spd-primary);
    color: var(--spd-primary);
}
.spd-favorite-btn.is-favorite {
    border-color: var(--spd-primary);
    color: var(--spd-primary);
}

.spd-desc-box {
    margin-top: 10px;
    border: 1px solid var(--spd-border);
    border-radius: var(--market-radius-lg, 12px);
    background: #fff;
    padding: 13px;
}

.spd-left-desc-box {
width: 100%;
    max-height: 230px;
    overflow: auto;
}

.spd-desc-title {
    margin-bottom: 8px;
    color: var(--spd-text);
    letter-spacing: 0;
    text-transform: none;
}

.spd-desc-clamp {
    -webkit-line-clamp: 3;
    line-clamp: 3;
}

.spd-detail-page-btn {
    width: 100%;
    justify-content: center;
    border-radius: var(--market-radius-md, 10px);
}

.spd-close-btn {
    position: static;
    inset: auto;
    z-index: auto;
    width: 34px;
    height: 34px;
    border: 1px solid var(--spd-border);
    background: #fff;
    color: var(--spd-muted);
    box-shadow: none;
}

.spd-close-btn:hover {
    background: color-mix(in srgb, var(--spd-primary) 8%, #fff);
    border-color: var(--spd-primary);
    color: var(--spd-primary);
}

.spd-floating-close-btn {
    display: none;
}

:deep(.spd-galleria .p-galleria-thumbnail-container) {
    background: transparent;
    padding: 12px 8px 2px;
}

:deep(.spd-galleria .p-galleria-thumbnail-items) {
    gap: 10px;
}

:deep(.spd-galleria .p-galleria-thumbnail-item) {
    border: 1px solid transparent !important;
    border-radius: var(--market-radius-md, 10px);
    opacity: 0.78;
    margin: 0;
    background: #fff;
}

:deep(.spd-galleria .p-galleria-thumbnail-item:hover) {
    border-color: color-mix(in srgb, var(--spd-primary) 30%, #dbe3ea) !important;
    opacity: 1;
}

:deep(.spd-galleria .p-galleria-thumbnail-item-active) {
    border-color: color-mix(in srgb, var(--spd-primary) 70%, #ffffff) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--spd-primary) 10%, transparent);
    opacity: 1 !important;
}

.spd-thumb-wrap {
    width: 66px;
    height: 58px;
    border-radius: var(--market-radius-md, 9px);
    padding: 4px;
}

.spd-thumb-img {
    object-fit: contain;
}

@media (max-width: 640px) {
    :deep(.product-detail-dialog .p-dialog) {
        width: 100vw !important;
        height: 100dvh;
        max-height: 100dvh;
        border-radius: 0;
    }

    .spd-layout {
        grid-template-columns: 1fr;
    }

    .spd-img-col {
        padding: 8px;
        border-right: 0;
        border-bottom: 1px solid var(--spd-border);
    }

    .spd-left-desc-box {
        display: none;
    }

    .spd-close-btn {
        top: 10px;
        left: 10px;
    }

    .spd-main-img {
        height: 250px;
    }

    .spd-info-col {
        padding: 16px 16px 88px;
        height: auto;
        max-height: none;
        overflow: visible;
    }

    .spd-title-row {
        gap: 10px;
    }

    .spd-name {
        font-size: 1.08rem;
    }

    .spd-row {
        display: block;
    }

    .spd-row-label {
        width: auto;
        margin-bottom: 8px;
    }

    .spd-preorder-preview {
        grid-template-columns: 1fr;
    }

    .spd-actions {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        margin: 0;
        padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
        border-top: 1px solid var(--spd-border);
        background: #fff;
        box-shadow: 0 -10px 28px rgba(15, 23, 42, 0.1);
    }
}
</style>
