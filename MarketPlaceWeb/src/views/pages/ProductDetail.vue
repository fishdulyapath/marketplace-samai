<script setup>
import CartQtyStepper from '@/components/product/CartQtyStepper.vue';
import ProductCard from '@/components/product/ProductCard.vue';
import { useSilentRefresh } from '@/composables/useSilentRefresh';
import ProductService from '@/services/ProductService';
import { useAuthenStore } from '@/stores/authen';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { getRemainingAddableQty, normalizeMaxOrderQty } from '@/utils/cartLimits';
import { pickProductName } from '@/utils/languageDisplay';
import { getPreorderSplit, isPreorderAllowed, toOrderQty, toStockQty } from '@/utils/preorderSplit';
import { sanitizeProductDescription } from '@/utils/productDescription';
import { formatCartUnitSummary, summarizeCartUnits } from '@/utils/cartUnitSummary';
import { buildUnitRatioText, collectProductUnits } from '@/utils/unitConversion';
import Button from 'primevue/button';
import Galleria from 'primevue/galleria';
import OverlayPanel from 'primevue/overlaypanel';
import ProgressSpinner from 'primevue/progressspinner';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const props = defineProps({
    id: {
        type: String,
        default: ''
    },
    itemCode: {
        type: String,
        default: ''
    },
    embedded: {
        type: Boolean,
        default: false
    }
});
const emit = defineEmits(['close', 'added-to-cart', 'favorite-changed']);
const route = useRoute();
const router = useRouter();
const product = ref(null);
const images = ref([]);
// 🚨 ความหมายเปลี่ยนแล้ว (รีวิว 260908 สไลด์ 2): เดิมคือ "จำนวนที่จะเพิ่ม"
// ตอนนี้คือ "จำนวนรวมในตะกร้าของหน่วยที่เลือก" เพราะไม่มีปุ่มยืนยันแล้ว
const quantity = ref(0);
const loading = ref(true);
const priceLoading = ref(false);
const priceLoadError = ref('');
const cartQtyStepper = ref(null);
// แยกสถานะบันทึกตามสินค้า+หน่วย เพื่อให้สลับหน่วยระหว่าง request ได้อย่างปลอดภัย
const pendingCartKeys = ref(new Set());
const toast = useToast();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = languageStore.t;
const selectedUnitIndex = ref(0);
const shareOverlay = ref(null);
const isProductSet = ref(false);
const setItems = ref([]);
const loadingSetItems = ref(false);
const loadingDisplayDetail = ref(false);
const displayDetail = ref(null);
const replacementProducts = ref([]);
const suggestionProducts = ref([]);
const newProducts = ref([]);
const activeItemCode = ref(props.itemCode || props.id || route.params.id || '');

const authenStore = useAuthenStore();
const isLoggedIn = computed(() => authenStore.isAuthenticated);
const isEmbedded = computed(() => props.embedded);
const safeProductDescription = computed(() => sanitizeProductDescription(product.value?.description || ''));
// รายละเอียดโปรโมชั่นที่แอดมินพิมพ์เอง — ล้าง HTML ด้วยตัวเดียวกับรายละเอียดสินค้า
const promotionDetailHtml = computed(() => sanitizeProductDescription(currentUnit.value?.promotion_detail || product.value?.promotion_detail || ''));
function getProductDisplayName(item) {
    return item?.display_name || item?.item_name_display || pickProductName(item, languageStore.locale) || item?.item_name || item?.name || '';
}

function toProductNumber(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
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
    addFields(displayDetail.value?.hidden_detail_fields);
    addFields(displayDetail.value?.hidden_detail_fields_csv);
    return fields;
});
const isDetailFieldHidden = (key) => hiddenDetailFields.value.has(key);
const productVideoUrl = computed(() => product.value?.product_video_url || displayDetail.value?.product_video_url || '');
function extractHtmlAttribute(html, name) {
    const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = String(html || '').match(pattern);
    return match ? String(match[1] || match[2] || match[3] || '').trim() : '';
}
function toPositiveMediaSize(value) {
    const size = toProductNumber(value, 0);
    return size > 0 && size <= 10000 ? size : 0;
}
function normalizeYoutubeEmbedUrl(value) {
    const text = String(value || '').trim().replace(/&amp;/g, '&');
    if (!text) return '';
    try {
        const url = new URL(text, window.location.origin);
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        const pathParts = url.pathname.split('/').filter(Boolean);
        let videoId = '';
        if (host === 'youtu.be') {
            videoId = pathParts[0] || '';
        } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
            if (pathParts[0] === 'embed') videoId = pathParts[1] || '';
            else if (pathParts[0] === 'shorts' || pathParts[0] === 'live') videoId = pathParts[1] || '';
            else videoId = url.searchParams.get('v') || '';
        }
        if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return '';
        const embedHost = host === 'youtube-nocookie.com' ? 'www.youtube-nocookie.com' : 'www.youtube.com';
        const embed = new URL(`https://${embedHost}/embed/${videoId}`);
        const start = toPositiveMediaSize(url.searchParams.get('start'));
        if (start > 0) embed.searchParams.set('start', String(start));
        return embed.toString();
    } catch (error) {
        return '';
    }
}
function isVideoFileUrl(value) {
    return /\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(String(value || '').trim());
}
function isAllowedProductVideoSource(value) {
    const source = String(value || '').trim();
    return source.startsWith('/media/') || /^https?:\/\//i.test(source);
}
function parseProductVideoSource(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let source = raw;
    let width = 0;
    let height = 0;
    let forceIframe = false;
    if (raw.startsWith('{')) {
        try {
            const parsed = JSON.parse(raw);
            source = String(parsed.src || parsed.url || '').trim();
            width = toPositiveMediaSize(parsed.w || parsed.width);
            height = toPositiveMediaSize(parsed.h || parsed.height);
            forceIframe = parsed.t === 'iframe' || parsed.type === 'iframe';
        } catch (error) {
            return null;
        }
    } else if (/<iframe\b/i.test(raw)) {
        source = extractHtmlAttribute(raw, 'src').replace(/&amp;/g, '&');
        width = toPositiveMediaSize(extractHtmlAttribute(raw, 'width'));
        height = toPositiveMediaSize(extractHtmlAttribute(raw, 'height'));
        forceIframe = true;
    }
    if (!isAllowedProductVideoSource(source)) return null;
    const youtubeEmbedUrl = normalizeYoutubeEmbedUrl(source);
    const resolvedSource = youtubeEmbedUrl || source;
    const type = forceIframe || youtubeEmbedUrl || !isVideoFileUrl(resolvedSource) ? 'iframe' : 'video';
    return {
        type,
        src: resolvedSource,
        ratio: width > 0 && height > 0 ? `${width} / ${height}` : '16 / 9'
    };
}
const productVideoEmbed = computed(() => parseProductVideoSource(productVideoUrl.value));
const salesDisplayMode = computed(() => String(currentUnit.value?.sales_display_mode ?? product.value?.sales_display_mode ?? '0'));
const isSalesPopularityMode = computed(() => salesDisplayMode.value === '2');
const shouldShowStock = computed(() => !isDetailFieldHidden('stock'));
const shouldShowSales = computed(() => !isDetailFieldHidden('sales') && salesDisplayMode.value !== '1');
const salesStarThresholds = computed(() => {
    const values = String(currentUnit.value?.sales_star_thresholds || product.value?.sales_star_thresholds || '100,500,1000,5000')
        .split(',')
        .map((item) => toProductNumber(item, 0))
        .filter((item) => Number.isFinite(item) && item > 0)
        .slice(0, 4);
    return values.length === 4 ? values : [100, 500, 1000, 5000];
});
const currentSalesText = computed(() => {
    if (!currentUnit.value || !shouldShowSales.value) return '';
    const salesQty = toProductNumber(currentUnit.value.sum_sale, 0);
    if (isSalesPopularityMode.value) {
        const thresholds = salesStarThresholds.value;
        const count = salesQty > thresholds[3] ? 5 : salesQty > thresholds[2] ? 4 : salesQty > thresholds[1] ? 3 : salesQty > thresholds[0] ? 2 : salesQty > 0 ? 1 : 0;
        return count > 0 ? '★'.repeat(count) : '-';
    }
    return `${formatNumber(salesQty)} ${currentUnit.value.unit_code || ''}`.trim();
});
const productMetaRows = computed(() => {
    if (!product.value) return [];
    const unit = currentUnit.value;
    const detail = displayDetail.value || {};
    return [
        { key: 'code', label: t('productDetail.productCode'), value: product.value.code || '' },
        { key: 'name', label: t('productDetail.name'), value: productDisplayName.value || product.value.name || '' },
        { key: 'stock', label: t('productDetail.stock'), value: unit && shouldShowStock.value ? `${formatNumber(unit.balance_qty)} ${unit.unit_code || ''}`.trim() : '' },
        { key: 'sales', label: t('productDetail.sales'), value: currentSalesText.value },
        { key: 'width_length_height', label: t('productDetail.widthLengthHeight'), value: detail.width_length_height || '' },
        { key: 'weight', label: t('productDetail.weight'), value: detail.weight || '' },
        { key: 'category', label: t('productDetail.category'), value: (languageStore.locale === 'en' && (detail.category_name_2 || detail.item_category_2)) || detail.category_name || detail.item_category || '' },
        { key: 'brand', label: t('productDetail.brand'), value: (languageStore.locale === 'en' && (detail.brand_name_2 || detail.item_brand_2)) || detail.brand_name || detail.item_brand || '' },
        { key: 'model', label: t('productDetail.model'), value: (languageStore.locale === 'en' && (detail.model_name_2 || detail.item_model_2)) || detail.model_name || detail.item_model || '' }
    ].filter((row) => !isDetailFieldHidden(row.key) && String(row.value || '').trim() !== '');
});

const hasProductMetaRows = computed(() => productMetaRows.value.length > 0);

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

// จำนวนที่มีในตะกร้า
const quantityInCart = computed(() => {
    if (!product.value || !currentUnit.value) return 0;
    const item = cartStore.cartItems.find((item) => item.item_code === (product.value.id || product.value.code) && item.unit_code === currentUnit.value.unit_code);
    return item ? toOrderQty(item.qty) : 0;
});

// quantity คือจำนวนรวมในตะกร้าอยู่แล้ว จึงไม่ต้องบวกของเดิมซ้ำ
const totalSelectedWithCart = computed(() => toOrderQty(quantity.value));

// Maximum Allowance = จำนวนสั่งสูงสุดต่อคำสั่งซื้อ กำหนดต่อหน่วย (REQ3)
// null = ไม่จำกัด · server บังคับซ้ำอีกชั้นที่ /sendorder และ /validatecartstock
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

// ฟังก์ชันสำหรับตรวจสอบว่าเกินยอดคงเหลือหรือไม่
const exceedsAvailableStock = computed(() => {
    if (!currentUnit.value) return false;

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

// สต็อกทั้งหมดของหน่วยนี้ (ไม่หักของในตะกร้า) — quantity เป็นยอดรวมแล้ว
const maxStockForUnit = computed(() => {
    if (!currentUnit.value) return 0;
    const stock = toStockQty(currentUnit.value.balance_qty);
    return stock === null ? 0 : Math.max(0, Math.trunc(stock));
});

// เพดานที่ stepper กดขึ้นได้ — null = ไม่จำกัด
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

// หน่วยสินค้าที่กำลังเลือก
function getSelectedUnitSource() {
    if (!product.value) return null;
    if (selectedUnitIndex.value === 0) return product.value;
    return product.value.otherUnits?.[selectedUnitIndex.value - 1] || null;
}

const currentUnit = computed(() => {
    const unit = getSelectedUnitSource();
    if (!unit) return null;

    return {
        ...unit,
        item_code: unit.item_code || product.value.code,
        item_name: unit.item_name || product.value.name,
        preorder_allowed: unit.preorder_allowed ?? product.value.preorder_allowed ?? 0,
        preorder_mode: unit.preorder_mode ?? product.value.preorder_mode ?? 'default',
        promotion: Array.isArray(unit.promotion) ? unit.promotion : [],
        discount_promotion: Array.isArray(unit.discount_promotion) ? unit.discount_promotion : [],
        sold_out: resolveOrderableSoldOut({
            ...unit,
            preorder_allowed: unit.preorder_allowed ?? product.value.preorder_allowed ?? 0
        })
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

const isSoldOut = computed(() => currentUnit.value?.sold_out === '1');
const isPreorderOnlyAvailable = computed(() => {
    if (!currentUnit.value || !isPreorderAllowed(currentUnit.value)) return false;
    const stockQty = toStockQty(currentUnit.value.balance_qty);
    return stockQty !== null && stockQty <= 0;
});
const detailStockBadge = computed(() => {
    if (isSoldOut.value) {
        return { text: t('productDetail.soldOut'), className: 'is-out' };
    }
    if (isPreorderOnlyAvailable.value) {
        return { text: t('productDetail.preorderLabel'), className: 'is-preorder' };
    }
    return { text: t('productDetail.inStock'), className: '' };
});
const currentPrice = computed(() => toProductNumber(currentUnit.value?.price, 0));
const hasValidPrice = computed(() => !isLoggedIn.value || currentPrice.value > 0);
const hasPriceError = computed(() => !!priceLoadError.value);
const soldOutDetailText = computed(() => {
    if (!currentUnit.value) return t('productDetail.unitSoldOut');
    const stockQty = toStockQty(currentUnit.value.balance_qty);
    if (!isPreorderAllowed(currentUnit.value) && stockQty !== null && stockQty <= 0) {
        return t('productDetail.preorderOutOfStockHint');
    }
    return t('productDetail.unitSoldOut');
});
const priceWarningText = computed(() => {
    if (priceLoadError.value && priceLoadError.value !== 'ZERO_PRICE') {
        return t('productDetail.priceCheckFailed');
    }
    return t('productDetail.noUnitPrice');
});
const availableStockQtyForThisAdd = computed(() => {
    if (!currentUnit.value) return 0;
    const stockQty = toStockQty(currentUnit.value.balance_qty);
    if (stockQty === null) return null;
    return Math.max(0, stockQty - quantityInCart.value);
});
const availableStockForThisAdd = computed(() => availableStockQtyForThisAdd.value ?? 0);
const preorderPreview = computed(() => {
    if (!currentUnit.value) return { readyQty: 0, preorderQty: 0, totalQty: 0, hasPreorder: false };
    return getPreorderSplit({
        qty: toOrderQty(quantity.value),
        balance_qty: maxStockForUnit.value,
        preorder_allowed: currentUnit.value.preorder_allowed,
    });
});
const cartPreorderPreview = computed(() => {
    if (!currentUnit.value) return { readyQty: 0, preorderQty: 0, totalQty: 0, hasPreorder: false };
    return getPreorderSplit({
        qty: toOrderQty(quantity.value),
        balance_qty: currentUnit.value.balance_qty,
        preorder_allowed: currentUnit.value.preorder_allowed,
    });
});
const preorderCanStart = computed(() => isLoggedIn.value && currentUnit.value && !isSoldOut.value && isPreorderAllowed(currentUnit.value));
const preorderCanStartWithinAllowance = computed(() => {
    if (!preorderCanStart.value) return false;
    const allowance = remainingAllowanceToAdd.value;
    return allowance === null || allowance > availableStockForThisAdd.value;
});
const preorderActionHint = computed(() => {
    if (!currentUnit.value || !isLoggedIn.value || isSoldOut.value) return '';
    if (preorderPreview.value.isBlockedByPreorderSetting) return t('productDetail.preorderBlockedHint');
    if (preorderPreview.value.hasPreorder) return t('productDetail.preorderSplitHint');
    if (preorderCanStart.value && availableStockForThisAdd.value > 0) return t('productDetail.preorderStartHint', { qty: availableStockForThisAdd.value, unit: currentUnit.value.unit_code });
    if (preorderCanStart.value) return t('productDetail.preorderOnlyHint');
    return '';
});

function getUserFacingErrorMessage(err, fallback) {
    const responseData = err?.response?.data;
    if (typeof responseData === 'string' && responseData.trim()) return responseData.trim();
    if (responseData && typeof responseData === 'object') {
        const apiMessage = String(responseData.message || responseData.msg || responseData.ERROR || '').trim();
        if (apiMessage) return apiMessage;
    }
    return String(err?.message || '').trim() || fallback;
}

const setItemSummary = computed(() => {
    if (!isProductSet.value || setItems.value.length === 0) return [];
    return setItems.value.map((item, index) => ({
        ...item,
        setKey: getSetItemKey(item, index),
        displayName: getProductDisplayName(item),
        displayQty: formatSetQty(calculateSetItemQty(item.qty)),
        baseQty: formatSetQty(item.qty),
        balanceText: toProductNumber(item.balance_qty, null) !== null ? formatSetQty(item.balance_qty) : item.balance_qty || '-'
    }));
});

const formattedPromotions = computed(() => {
    if (!currentUnit.value || !currentUnit.value.promotion || currentUnit.value.promotion.length === 0) {
        return [];
    }

    const sortedPromotions = [...currentUnit.value.promotion].sort((a, b) => {
        return toProductNumber(a.line_number, 0) - toProductNumber(b.line_number, 0);
    });

    return sortedPromotions.map((promo, index) => {
        const fromQty = toProductNumber(promo.from_qty, 0);
        const toQty = toProductNumber(promo.to_qty, 0);
        const price = toProductNumber(promo.price, 0);
        const unitName = promo.unit_name || currentUnit.value.unit_code;
        const isLastItem = index === sortedPromotions.length - 1 || toQty >= 9999;
        const displayText = isLastItem
            ? t('productDetail.buyFromQty', { from: fromQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), unit: unitName })
            : t('productDetail.buyFromToQty', { from: fromQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), to: toQty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'), unit: unitName });

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
        return toProductNumber(a.from_qty, 0) - toProductNumber(b.from_qty, 0);
    });

    return sortedDiscounts.map((promo, index) => {
        const fromQty = toProductNumber(promo.from_qty, 0);
        const toQty = toProductNumber(promo.to_qty, 0);
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

function goToLogin() {
    router.push('/auth/login');
}

function getProductShareUrl() {
    if (!product.value) return window.location.href;
    const baseUrl = window.location.origin;
    const appBase = import.meta.env.BASE_URL || '/app/';
    const normalizedBase = appBase.endsWith('/') ? appBase : `${appBase}/`;
    return `${baseUrl}${normalizedBase}product/${encodeURIComponent(product.value.code)}`;
}

function toggleShareMenu(event) {
    shareOverlay.value?.toggle(event);
}

function shareToFacebook() {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getProductShareUrl())}`, '_blank', 'width=600,height=420');
    shareOverlay.value?.hide();
}

function shareToLine() {
    window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(getProductShareUrl())}`, '_blank', 'width=600,height=600');
    shareOverlay.value?.hide();
}

async function copyLink() {
    const shareUrl = getProductShareUrl();
    try {
        await navigator.clipboard.writeText(shareUrl);
        toast.add({
            severity: 'success',
            summary: t('productDetail.linkCopied'),
            detail: t('productDetail.linkCopiedShare'),
            life: 2200
        });
    } catch (error) {
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        toast.add({
            severity: 'success',
            summary: t('productDetail.linkCopied'),
            life: 2200
        });
    } finally {
        shareOverlay.value?.hide();
    }
}

// ฟังก์ชันสำหรับจัดรูปแบบตัวเลข
function formatNumber(value) {
    const num = toProductNumber(value, null);
    if (num === null) return '0.00';
    return num.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatSetQty(value) {
    const qty = toProductNumber(value, null);
    if (qty === null) return '0.00';
    return qty.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function calculateSetItemQty(itemQty) {
    const mainQty = toProductNumber(quantity.value, 1);
    return mainQty * toProductNumber(itemQty, 0);
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

function resolveOrderableSoldOut(unit) {
    if (!unit) return '1';
    if (isPreorderAllowed(unit)) return '0';
    const balanceQty = toStockQty(unit.balance_qty);
    if (balanceQty !== null && balanceQty <= 0) return '1';
    return String(unit.sold_out ?? '0');
}

function normalizeProductDetailData(data) {
    if (!data) return null;
    data.sold_out = resolveOrderableSoldOut(data);
    if (!data.promotion) data.promotion = [];
    if (!data.discount_promotion) data.discount_promotion = [];

    if (data.otherUnits && data.otherUnits.length > 0) {
        data.otherUnits.forEach((unit) => {
            unit.preorder_allowed = unit.preorder_allowed ?? data.preorder_allowed ?? 0;
            unit.preorder_mode = unit.preorder_mode ?? data.preorder_mode ?? 'default';
            unit.sold_out = resolveOrderableSoldOut(unit);
            if (!unit.promotion) unit.promotion = [];
            if (!unit.discount_promotion) unit.discount_promotion = [];
        });
    }

    return data;
}

async function fetchProductImages() {
    if (!product.value) {
        images.value = [];
        return;
    }

    const fallbackImage = product.value.image || product.value.imageFallback || ProductService.getPlaceholderImage();
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
            return;
        }
    } catch (error) {
        console.warn(`Unable to load image list for ${product.value.code}`, error);
    }

    images.value = [{
        itemImageSrc: fallbackImage,
        thumbnailImageSrc: fallbackImage,
        alt: productDisplayName.value
    }];
}

async function fetchProductSetItems(itemCode) {
    loadingSetItems.value = true;
    try {
        const result = await ProductService.getProductSetItem(itemCode);
        setItems.value = result.data || [];
        cartStore.setItemsCache[itemCode] = setItems.value;
    } catch (error) {
        console.error('Error fetching product set items:', error);
        setItems.value = [];
        toast.add({
            severity: 'warn',
            summary: t('productDetail.productSetIncomplete'),
            detail: t('productDetail.productSetLoadFailed'),
            life: 3000
        });
    } finally {
        loadingSetItems.value = false;
    }
}

function resetDisplayDetail() {
    displayDetail.value = null;
    replacementProducts.value = [];
    suggestionProducts.value = [];
    newProducts.value = [];
}

async function fetchProductDisplayDetail(itemCode) {
    if (!itemCode) return;
    loadingDisplayDetail.value = true;
    try {
        const [displayResult, featuredNewResult] = await Promise.allSettled([
            ProductService.getProductDisplayDetail(itemCode),
            ProductService.getProducts({ premium: 1, featureType: 'new', includeAllPattern: true, limit: 8 }, 0)
        ]);

        if (displayResult.status === 'fulfilled') {
            const result = displayResult.value || {};
            displayDetail.value = result.detail || null;
            replacementProducts.value = result.replacements || [];
            suggestionProducts.value = result.suggestions || [];
        } else {
            console.warn(`Unable to load display detail for ${itemCode}`, displayResult.reason);
            displayDetail.value = null;
            replacementProducts.value = [];
            suggestionProducts.value = [];
        }

        if (featuredNewResult.status === 'fulfilled') {
            newProducts.value = (featuredNewResult.value?.data || []).filter((item) => item.item_code !== itemCode).slice(0, 8);
        } else {
            console.warn('Unable to load new products for product detail:', featuredNewResult.reason);
            newProducts.value = [];
        }
    } catch (error) {
        console.warn(`Unable to load display detail for ${itemCode}`, error);
        resetDisplayDetail();
    } finally {
        loadingDisplayDetail.value = false;
    }
}

function openRelatedProduct(itemCode) {
    if (!itemCode || itemCode === product.value?.code) return;
    if (isEmbedded.value) {
        activeItemCode.value = itemCode;
        selectedUnitIndex.value = 0;
        quantity.value = 1;
        loading.value = true;
        fetchProductDetail(itemCode).finally(() => {
            loading.value = false;
        });
        return;
    }
    router.push(`/product/${encodeURIComponent(itemCode)}`);
}

async function loadProductSetDetail(itemCode, requireSet = false) {
    resetDisplayDetail();
    const result = await ProductService.getProductSetByItemCode(itemCode);
    const normalizedProduct = normalizeProductDetailData(result.data);
    const productIsSet = String(normalizedProduct?.item_type || '') === '3';
    if (requireSet && !productIsSet) {
        throw new Error(t('productDetail.productSetNotFound'));
    }

    isProductSet.value = productIsSet;
    product.value = normalizedProduct;
    if (productIsSet) {
        await fetchProductSetItems(itemCode);
    } else {
        setItems.value = [];
    }
    await fetchProductImages();
    await refreshSelectedUnitPrice();
    fetchProductDisplayDetail(itemCode);
}

onMounted(async () => {
    try {
        loading.value = true;
        await fetchProductDetail();
        silentRefresh.start(); // เริ่มนับ 5 นาทีเพื่อรีเฟรชเบื้องหลัง (REQ1)
    } catch (error) {
        console.error('Error fetching data:', error);
        toast.add({
            severity: 'error',
            summary: t('productDetail.error'),
            detail: t('productDetail.loadProductFailed'),
            life: 3000
        });
    } finally {
        loading.value = false;
    }
});

// ดึงข้อมูลสินค้า
watch(
    () => route.params.id,
    async (nextId, oldId) => {
        if (isEmbedded.value) return;
        if (!nextId || nextId === oldId) return;
        try {
            loading.value = true;
            activeItemCode.value = nextId;
            selectedUnitIndex.value = 0;
            quantity.value = 1;
            await fetchProductDetail();
        } finally {
            loading.value = false;
        }
    }
);

watch(
    () => props.itemCode,
    async (nextCode, oldCode) => {
        if (!isEmbedded.value || !nextCode || nextCode === oldCode) return;
        try {
            loading.value = true;
            activeItemCode.value = nextCode;
            selectedUnitIndex.value = 0;
            quantity.value = 1;
            await fetchProductDetail(nextCode);
        } finally {
            loading.value = false;
        }
    }
);

async function fetchProductDetail(itemCodeArg = '') {
    const itemCode = itemCodeArg || activeItemCode.value || props.itemCode || props.id || route.params.id;
    activeItemCode.value = itemCode || '';
    resetDisplayDetail();
    if (!itemCode) {
        toast.add({
            severity: 'error',
            summary: t('productDetail.error'),
            detail: t('productDetail.missingProductCode'),
            life: 3000
        });
        return;
    }

    try {
        let result;
        try {
            result = await ProductService.getProductByItemCode(itemCode);
        } catch (normalProductError) {
            await loadProductSetDetail(itemCode, true);
            return;
        }

        if (String(result.data?.item_type || '') === '3') {
            await loadProductSetDetail(itemCode, true);
            return;
        }

        isProductSet.value = false;
        setItems.value = [];
        product.value = normalizeProductDetailData(result.data);
        await fetchProductImages();

        await refreshSelectedUnitPrice();
        fetchProductDisplayDetail(itemCode);
    } catch (error) {
        console.error('Error fetching product detail:', error);
        toast.add({
            severity: 'error',
            summary: t('productDetail.error'),
            detail: t('productDetail.loadProductFailed'),
            life: 3000
        });
    }
}

async function refreshSelectedUnitPrice(options = {}) {
    // silent = รีเฟรชเบื้องหลัง ห้ามแตะ priceLoading เพราะทำให้ปุ่มเพิ่มลงตะกร้า disabled (REQ1)
    const silent = options.silent === true;
    priceLoadError.value = '';
    if (!isLoggedIn.value || !product.value || !currentUnit.value) return;

    if (isProductSet.value) {
        if (!(currentPrice.value > 0)) {
            priceLoadError.value = 'ZERO_PRICE';
        }
        return;
    }

    const unitSource = getSelectedUnitSource();
    if (!unitSource?.unit_code) return;

    if (!silent) priceLoading.value = true;
    try {
        const priceResult = await ProductService.getProductPrice(product.value.code, unitSource.unit_code, quantity.value || '1', localStorage.getItem('_userCode') || '', {
            barcode: unitSource.barcode || product.value.barcode || ''
        });

        if (priceResult) {
            const nextPrice = priceResult.price ?? unitSource.price;
            unitSource.price = nextPrice;
            unitSource.type = priceResult.type ?? unitSource.type;
            unitSource.mode = priceResult.mode ?? unitSource.mode;
            unitSource.price_type = priceResult.roworder ?? priceResult.price_type ?? unitSource.price_type;
            if (!(toProductNumber(nextPrice, 0) > 0)) {
                priceLoadError.value = 'ZERO_PRICE';
            }
        } else {
            priceLoadError.value = 'NO_PRICE_RESULT';
        }
    } catch (error) {
        console.warn(`Unable to refresh price for ${product.value.code}/${unitSource.unit_code}`, error);
        priceLoadError.value = 'PRICE_ERROR';
    } finally {
        if (!silent) priceLoading.value = false;
    }
}

// รีเฟรชสต็อก/ราคาเบื้องหลังทุก 5 นาที (REQ1) — merge เฉพาะฟิลด์ที่เปลี่ยน ไม่โหลดรูปใหม่
const REFRESHABLE_FIELDS = ['balance_qty', 'sold_out', 'price', 'price1', 'price2', 'is_promotion', 'promotion', 'discount_promotion', 'preorder_allowed', 'preorder_mode', 'max_order_qty_by_unit'];

function mergeRefreshableFields(target, source) {
    if (!target || !source) return;
    for (const key of REFRESHABLE_FIELDS) {
        if (source[key] !== undefined) target[key] = source[key];
    }
}

async function refreshStockAndPriceSilently() {
    const code = product.value?.code;
    if (!code) return;

    const result = isProductSet.value ? await ProductService.getProductSetByItemCode(code) : await ProductService.getProductByItemCode(code);
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

// ปุ่มลัดเหล่านี้เคยแค่ตั้งค่า quantity แล้วรอผู้ใช้กดยืนยัน
// ตอนไม่มีปุ่มยืนยันแล้ว ต้อง commit ลงตะกร้าเองไม่งั้นกดแล้วไม่เกิดอะไรขึ้น
function setQuantityToReadyStock() {
    if (!currentUnit.value) return;
    const readyQty = remainingAddableQty.value;
    if (readyQty > 0) commitCartQty(quantityInCart.value + readyQty);
}

function startPreorderQuantity() {
    if (!currentUnit.value || !isPreorderAllowed(currentUnit.value) || !preorderCanStartWithinAllowance.value) return;
    commitCartQty(quantityInCart.value + Math.max(1, availableStockForThisAdd.value + 1));
}

function adjustQuantityToAvailableStock() {
    if (!currentUnit.value) return;
    const readyQty = remainingAddableQty.value;
    if (readyQty > 0) commitCartQty(quantityInCart.value + readyQty);
}

// ดึงจำนวนจริงของหน่วยที่เลือกจากตะกร้ามาใส่ stepper
function syncQuantityFromCart() {
    quantity.value = quantityInCart.value;
}

// สลับหน่วย / ตะกร้าเปลี่ยนจากที่อื่น → เลขบน stepper ต้องตามทันที
watch(quantityInCart, syncQuantityFromCart, { immediate: true });

// เขียนจำนวนใหม่ลงตะกร้าโดยตรง — nextQty คือ "จำนวนรวมที่ต้องการ" ไม่ใช่ส่วนต่าง
function commitCartQty(nextQty) {
    if (!product.value) return;
    if (!isLoggedIn.value) {
        goToLogin();
        return;
    }

    // จับหน่วยไว้ตั้งแต่เข้าฟังก์ชัน หลัง CartQtyStepper flush ก่อน changeUnit
    // ห้ามอ่าน currentUnit ใหม่หลังเริ่มงาน async เพราะผู้ใช้อาจสลับหน่วยไปแล้ว
    const unit = currentUnit.value;
    if (!unit) {
        toast.add({
            severity: 'warn',
            summary: t('productDetail.missingUnit'),
            detail: t('productDetail.selectUnitAgain'),
            life: 3000
        });
        syncQuantityFromCart();
        return;
    }
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

    if (isSoldOut.value) {
        toast.add({
            severity: 'warn',
            summary: t('productDetail.soldOut'),
            detail: soldOutDetailText.value,
            life: 3000
        });
        syncQuantityFromCart();
        return;
    }

    if (preorderPreview.value.isBlockedByPreorderSetting) {
        toast.add({
            severity: 'warn',
            summary: t('productDetail.preorderNotAllowed'),
            detail: preorderActionHint.value || t('productDetail.preorderBlockedHint'),
            life: 3200
        });
        syncQuantityFromCart();
        return;
    }

    // ด่านสุดท้ายฝั่ง UI ก่อนยิง API — เกินลิมิตต่อคำสั่งซื้อไม่ให้เพิ่ม (REQ3)
    if (exceedsMaxAllowance.value) {
        toast.add({
            severity: 'warn',
            summary: t('productDetail.stockInfo'),
            detail: t('productDetail.maxAllowanceHint', { max: maxAllowanceForUnit.value, unit: unit.unit_code }),
            life: 4000
        });
        syncQuantityFromCart();
        return;
    }

    if (priceLoading.value || priceLoadError.value) {
        toast.add({
            severity: 'warn',
            summary: t('productDetail.cannotOrderYet'),
            detail: priceLoadError.value ? t('productDetail.priceCheckFailed') : t('productDetail.waitPriceCheck'),
            life: 3000
        });
        syncQuantityFromCart();
        return;
    }

    const unitPrice = toProductNumber(unit.price, 0);
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
        item_type: isProductSet.value ? '3' : unit.item_type || product.value.item_type || '0',
        is_promotion: unit.is_promotion || product.value.is_promotion || '0',
        balance_qty: unit.balance_qty,
        sold_out: unit.sold_out,
        preorder_allowed: unit.preorder_allowed ?? product.value.preorder_allowed ?? 0,
        sub_item: isProductSet.value ? setItems.value : []
    };
    if (isProductSet.value) {
        cartStore.setItemsCache[cartItem.item_code] = setItems.value;
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
            severity: 'warn',
            summary: t('productDetail.stockExceeded'),
            detail: t('productDetail.stockExceededDetail', { balance: finalQty, unit: unit.unit_code }),
            life: 3000
        });
    }

    setCartUnitBusy(pendingKey, true);
    cartItem.qty = finalQty;

    cartStore
        .addToCart(cartItem, finalQty)
        .then(() => {
            emit('added-to-cart', cartItem);
            toast.add({
                severity: 'success',
                summary: t('productDetail.addedToCart'),
                detail: `${productDisplayName.value || product.value.name} (${unit.unit_code}) x ${finalQty}`,
                life: 3000
            });

            // เพิ่ม log หลังจากเพิ่มสินค้าสำเร็จ
            //console.log('===== AFTER ADD TO CART =====');
            //console.log('การเพิ่มสินค้าสำเร็จ!');
            //console.log('จำนวนรายการในตะกร้าหลังเพิ่ม:', cartStore.cartItems.length);
            //console.log('จำนวนชิ้นสินค้าทั้งหมดในตะกร้า:', cartStore.totalItems);
            //console.log('============================');
        })
        .catch((err) => {
            console.error('Error adding to cart:', err);
            const message = getUserFacingErrorMessage(err, t('productDetail.addCartFailed'));
            const isPendingMessage = message.includes('กำลัง') || message.toLowerCase().includes('please wait');
            toast.add({
                severity: isPendingMessage ? 'warn' : 'error',
                summary: isPendingMessage ? t('productDetail.cannotOrderYet') : t('productDetail.error'),
                detail: message,
                life: message.length > 120 ? 5200 : 3000
            });

            // เพิ่ม log เมื่อเกิดข้อผิดพลาด
            console.error('===== ADD TO CART ERROR =====');
            console.error('ข้อผิดพลาด:', err);
            console.error('==============================');
        })
        .finally(() => {
            setCartUnitBusy(pendingKey, false);
            // ดึงค่าจริงจากตะกร้ากลับมา — สำเร็จก็ตรงอยู่แล้ว ล้มเหลวก็เด้งกลับค่าเดิม
            syncQuantityFromCart();
        });
}
// เปลี่ยนหน่วยสินค้า
// 🚨 ห้ามรีเซ็ตเป็น 1 อีก — ไม่มีปุ่มยืนยันแล้ว การตั้งค่าเองจะกลายเป็นการสั่งซื้อ
//    โดยที่ผู้ใช้ไม่ได้กด ปล่อยให้ watcher ดึงจำนวนจริงของหน่วยใหม่มาแทน
function changeUnit(index) {
    if (index !== selectedUnitIndex.value) cartQtyStepper.value?.flushPending();
    selectedUnitIndex.value = index;
    refreshSelectedUnitPrice();
}

function goBack() {
    if (isEmbedded.value) {
        emit('close');
        return;
    }
    router.push('/marketplace');
}

// ฟังก์ชันเปลี่ยนสถานะ{{ t('productDetail.favorite') }}
function toggleFavorite() {
    if (!product.value) return;

    // เก็บค่า favorite_item เดิมไว้
    const oldFavoriteStatus = product.value.favorite_item || '0';

    // สลับค่า favorite_item ระหว่าง "0" และ "1"
    product.value.favorite_item = product.value.favorite_item === '1' ? '0' : '1';

    toast.add({
        severity: 'success',
        summary: product.value.favorite_item === '1' ? t('productDetail.addedFavorite') : t('productDetail.removedFavorite'),
        detail: product.value.favorite_item === '1' ? t('productDetail.addedFavoriteDetail', { name: productDisplayName.value || product.value.name }) : t('productDetail.removedFavoriteDetail', { name: productDisplayName.value || product.value.name }),
        life: 3000
    });

    // เรียกใช้งาน API เพื่ออัปเดตสถานะ{{ t('productDetail.favorite') }}
    emit('favorite-changed', { itemCode: product.value.code, isFavorite: product.value.favorite_item === '1' });

    ProductService.updateFavoriteStatus(product.value.id || product.value.code, product.value.favorite_item).catch((error) => {
        console.error('Error updating favorite status:', error);
        // กรณีมีข้อผิดพลาด ให้คืนค่าสถานะเดิม
        product.value.favorite_item = oldFavoriteStatus;
        toast.add({
            severity: 'error',
            summary: t('productDetail.error'),
            detail: t('productDetail.favoriteUpdateFailed'),
            life: 3000
        });
    });
}
</script>

<template>
    <div class="product-detail-page" :class="{ 'is-embedded': isEmbedded }">
        <Toast position="top-right" />
        <OverlayPanel ref="shareOverlay" dismissable>
            <div class="detail-share-menu">
                <div class="detail-share-title">{{ t('productDetail.shareProduct') }}</div>
                <button type="button" @click="shareToFacebook">
                    <i class="pi pi-facebook"></i>
                    Facebook
                </button>
                <button type="button" @click="shareToLine">
                    <i class="pi pi-comment"></i>
                    LINE
                </button>
                <button type="button" @click="copyLink">
                    <i class="pi pi-copy"></i>
                    {{ t('productDetail.copyLink') }}
                </button>
            </div>
        </OverlayPanel>

        <header class="detail-header">
            <Button icon="pi pi-times" text rounded :aria-label="t('productDetail.close')" @click="goBack" class="detail-back-btn" />
            <h1>{{ productDisplayName || t('productDetail.productDetail') }}</h1>
            <button v-if="product" type="button" class="detail-icon-btn" @click="toggleShareMenu" :aria-label="t('productDetail.shareProduct')">
                <i class="pi pi-share-alt"></i>
            </button>
            <button v-if="product" type="button" class="detail-icon-btn" :class="{ 'is-active': product.favorite_item === '1' }" :aria-pressed="product.favorite_item === '1'" @click="toggleFavorite" :aria-label="t('productDetail.favorite')">
                <i :class="product.favorite_item === '1' ? 'pi pi-heart-fill' : 'pi pi-heart'"></i>
            </button>
        </header>

        <div v-if="loading" class="detail-loading">
            <ProgressSpinner style="width: 50px" />
        </div>

        <main v-else-if="product" class="detail-main" :class="{ 'has-mobile-actions': !isLoggedIn }">
            <section class="detail-top">
                <div class="detail-gallery-card">
                    <div class="detail-status-row">
                        <span class="detail-stock-badge" :class="detailStockBadge.className">
                            {{ detailStockBadge.text }}
                        </span>
                        <span v-if="isProductSet" class="detail-set-badge">{{ t('productDetail.productSet') }}</span>
                        <span v-if="product.is_return === '1'" class="detail-return-badge">{{ t('productDetail.returnProduct') }}</span>
                    </div>

                    <Galleria
                        v-if="images.length > 0"
                        :value="images"
                        :numVisible="5"
                        :circular="true"
                        :showThumbnails="images.length > 1"
                        :showItemNavigators="images.length > 1"
                        :responsiveOptions="galleryOptions"
                        containerClass="detail-galleria"
                    >
                        <template #item="slotProps">
                            <img :src="slotProps.item.itemImageSrc" :alt="productDisplayName || slotProps.item.alt" @error="$event.target.src = product.imageFallback" class="detail-main-image" />
                        </template>
                        <template #thumbnail="slotProps">
                            <div class="detail-thumb">
                                <img :src="slotProps.item.thumbnailImageSrc" :alt="productDisplayName || slotProps.item.alt" @error="$event.target.src = product.imageFallback" />
                            </div>
                        </template>
                    </Galleria>

                    <div v-else class="detail-image-empty">
                        <img :src="product.imageFallback" :alt="productDisplayName" />
                    </div>
                </div>

                <aside class="detail-purchase-card">
                    <div class="detail-title-row">
                        <div>
                            <div class="detail-code">{{ t('productDetail.productCode') }}: {{ product.code }}</div>
                            <h2>{{ productDisplayName }}</h2>
                        </div>
                        <div class="detail-title-actions">
                            <button type="button" class="detail-soft-action" @click="toggleShareMenu">
                                <i class="pi pi-share-alt"></i>
                                {{ t('productDetail.share') }}
                            </button>
                            <button type="button" class="detail-soft-action" :class="{ 'is-active': product.favorite_item === '1' }" @click="toggleFavorite">
                                <i :class="product.favorite_item === '1' ? 'pi pi-heart-fill' : 'pi pi-heart'"></i>
                                {{ t('productDetail.favorite') }}
                            </button>
                        </div>
                    </div>

                    <div class="detail-stats">
                        <span v-if="shouldShowStock">{{ t('productDetail.stock') }} <strong>{{ currentUnit ? formatNumber(currentUnit.balance_qty) : '-' }}</strong> {{ currentUnit?.unit_code }}</span>
                        <span v-if="shouldShowSales" :class="{ 'is-popularity': isSalesPopularityMode }">
                            <template v-if="!isSalesPopularityMode">{{ t('productDetail.sales') }} </template>
                            <strong>{{ currentSalesText || '-' }}</strong>
                        </span>
                    </div>

                    <div class="detail-price-box" v-if="currentUnit">
                        <template v-if="isLoggedIn && priceLoading">
                            <div class="detail-muted-row">
                                <i class="pi pi-spin pi-spinner"></i>
                                <span>{{ t('productDetail.checkingPrice') }}</span>
                            </div>
                        </template>
                        <template v-else-if="isLoggedIn">
                            <span class="detail-currency">฿</span>
                            <span class="detail-price">{{ currentPrice.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', { minimumFractionDigits: 2 }) }}</span>
                            <span class="detail-price-unit">/ {{ currentUnit.unit_code }}</span>
                        </template>
                        <template v-else>
                            <div class="detail-login-box">
                                <i class="pi pi-lock"></i>
                                <span>{{ t('productDetail.loginForPrice') }}</span>
                                <button type="button" @click="goToLogin">{{ t('productDetail.login') }}</button>
                            </div>
                        </template>
                    </div>

                    <div v-if="isLoggedIn && currentUnit && !priceLoading && (!hasValidPrice || priceLoadError)" class="detail-warning">
                        <i class="pi pi-exclamation-circle"></i>
                        <span>{{ priceWarningText }}</span>
                        <button v-if="priceLoadError" type="button" class="detail-warning-action" @click="refreshSelectedUnitPrice">{{ t('productDetail.priceCheckAgain') }}</button>
                    </div>

                    <div v-if="product.otherUnits && product.otherUnits.length > 0" class="detail-control-row">
                        <div class="detail-label">{{ t('productDetail.unit') }}</div>
                        <div class="detail-unit-list">
                            <button type="button" :class="['detail-unit-btn', selectedUnitIndex === 0 ? 'is-active' : '']" :aria-pressed="selectedUnitIndex === 0" :aria-label="`${t('productDetail.selectUnit')} ${product.unit_code}`" @click="changeUnit(0)">{{ product.unit_code }}</button>
                            <button v-for="(unitItem, idx) in product.otherUnits" :key="idx" type="button" :class="['detail-unit-btn', selectedUnitIndex === idx + 1 ? 'is-active' : '']" :aria-pressed="selectedUnitIndex === idx + 1" :aria-label="`${t('productDetail.selectUnit')} ${unitItem.unit_code}`" @click="changeUnit(idx + 1)">
                                {{ unitItem.unit_code }}
                            </button>
                        </div>
                    </div>

                    <!-- ตัวคูณหน่วย — ลูกค้าไม่รู้ว่า 1 ลังมีกี่แพ็ค (รีวิว 260908 สไลด์ 1) -->
                    <div v-if="unitRatioText" class="detail-unit-ratio">
                        <i class="pi pi-box"></i>
                        <span>{{ unitRatioText }}</span>
                    </div>

                    <div v-if="isSoldOut" class="detail-soldout">
                        <i class="pi pi-ban"></i>
                        {{ soldOutDetailText }}
                    </div>

                    <!-- รายละเอียดโปรโมชั่นที่แอดมินพิมพ์เอง (dimension_39) -->
                    <div v-if="promotionDetailHtml" class="detail-offer-box is-custom">
                        <div class="detail-offer-title">{{ t('productDetail.promotion') }}</div>
                        <!-- eslint-disable-next-line vue/no-v-html -- ผ่าน sanitizeProductDescription แล้ว -->
                        <div class="detail-offer-html" v-html="promotionDetailHtml"></div>
                    </div>

                    <div v-if="isLoggedIn && formattedPromotions.length > 0" class="detail-offer-box">
                        <div class="detail-offer-title">{{ t('productDetail.promotion') }}</div>
                        <div v-for="(promo, idx) in formattedPromotions" :key="idx" class="detail-offer-line">
                            <span>{{ promo.displayText }}</span>
                            <strong>฿{{ promo.formattedPrice }}</strong>
                        </div>
                    </div>

                    <div v-if="isLoggedIn && formattedDiscountPromotions.length > 0" class="detail-offer-box is-discount">
                        <div class="detail-offer-title">{{ t('productDetail.discount') }}</div>
                        <div v-for="(promo, idx) in formattedDiscountPromotions" :key="idx" class="detail-offer-line">
                            <span>{{ promo.displayText }}</span>
                            <strong>{{ promo.discountText }}</strong>
                        </div>
                    </div>

                    <!-- จำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3) -->
                    <div v-if="maxAllowanceForUnit !== null && currentUnit" class="detail-max-allowance" :class="{ 'is-exceeded': exceedsMaxAllowance }">
                        <i class="pi pi-info-circle"></i>
                        <span>{{ t('productDetail.maxAllowanceHint', { max: maxAllowanceForUnit, unit: currentUnit.unit_code }) }}</span>
                    </div>

                    <!-- แสดงทุกหน่วยที่มีในตะกร้า ไม่ใช่เฉพาะหน่วยที่เลือกอยู่ -->
                    <div v-if="hasAnyUnitInCart" class="detail-incart">
                        <i class="pi pi-shopping-cart"></i>
                        {{ t('productDetail.inCart') }} <strong>{{ cartUnitSummaryText }}</strong>
                        <span v-if="hasReachedMaxAllowance">{{ t('productDetail.maxAllowanceReached') }}</span>
                        <span v-else-if="cartPreorderPreview.hasPreorder">{{ t('productDetail.cartPreorderSplit', { ready: cartPreorderPreview.readyQty, preorder: cartPreorderPreview.preorderQty }) }}</span>
                        <span v-else-if="shouldShowStock && remainingAddableQty >= 0">{{ t('productDetail.addMore', { qty: remainingAddableQty }) }}</span>
                    </div>

                    <!-- RULE: hide-empty-section — กล่องสรุปสินค้าในชุดฝั่งซื้อ ใช้เงื่อนไขเดียวกับ section ด้านล่าง -->
                    <div v-if="isProductSet && (loadingSetItems || setItemSummary.length)" class="detail-set-box">
                        <div class="detail-set-head">
                            <div>
                                <div class="detail-set-title">{{ t('productDetail.productSetItemsThis') }}</div>
                                <div class="detail-set-subtitle">{{ t('productDetail.productSetCountHint') }}</div>
                            </div>
                            <span>{{ t('productDetail.itemCount', { count: setItems.length }) }}</span>
                        </div>

                        <div v-if="loadingSetItems" class="detail-set-loading">
                            <i class="pi pi-spin pi-spinner"></i>
                            {{ t('productDetail.loadingProductSet') }}
                        </div>
                        <div v-else-if="setItemSummary.length > 0" class="detail-set-list">
                            <div v-for="item in setItemSummary" :key="item.setKey" class="detail-set-item">
                                <img :src="item.image" :alt="item.displayName" loading="lazy" decoding="async" @error="$event.target.src = product.imageFallback" />
                                <div class="detail-set-info">
                                    <strong>{{ item.displayName }}</strong>
                                    <span>{{ item.item_code }}</span>
                                </div>
                                <div class="detail-set-qty">
                                    <strong>{{ item.displayQty }} {{ item.unit_code }}</strong>
                                    <span>({{ item.baseQty }} x {{ quantity }})</span>
                                    <em>{{ t('productDetail.stock') }} {{ item.balanceText }}</em>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div v-if="currentUnit && !isSoldOut" class="detail-control-row">
                        <div class="detail-label">{{ t('productDetail.quantity') }}</div>
                        <div class="detail-quantity-panel">
                            <!-- กด +/- แล้วเข้า/ออกตะกร้าทันที ไม่มีปุ่มยืนยันอีกแล้ว -->
                            <CartQtyStepper
                                ref="cartQtyStepper"
                                :model-value="quantityInCart"
                                :max="maxCartQtyForUnit"
                                :busy="isCurrentCartUnitBusy"
                                :disabled="!isLoggedIn || !hasValidPrice || priceLoading"
                                :decrease-label="t('productDetail.decreaseQuantityAria')"
                                :increase-label="t('productDetail.increaseQuantityAria')"
                                :input-label="t('productDetail.quantityAria')"
                                @commit="commitCartQty"
                            />
                            <div v-if="isLoggedIn && currentUnit" class="detail-quick-qty-actions">
                                <button v-if="remainingAddableQty > 0" type="button" @click="setQuantityToReadyStock">
                                    <i class="pi pi-check-circle"></i>
                                    {{ t('productDetail.readyQtyButton', { qty: remainingAddableQty, unit: currentUnit.unit_code }) }}
                                </button>
                                <button v-if="preorderCanStartWithinAllowance" type="button" class="is-preorder" @click="startPreorderQuantity">
                                    <i class="pi pi-clock"></i>
                                    {{ availableStockForThisAdd > 0 ? t('productDetail.startPreorderButton') : t('productDetail.preorderOneButton') }}
                                </button>
                                <button v-else-if="preorderPreview.isBlockedByPreorderSetting && remainingAddableQty > 0" type="button" class="is-warning" @click="adjustQuantityToAvailableStock">
                                    <i class="pi pi-refresh"></i>
                                    {{ t('productDetail.adjustToReadyStock') }}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div v-if="isLoggedIn && currentUnit && !isSoldOut && preorderPreview.totalQty > 0" class="detail-preorder-preview" :class="{ 'has-preorder': preorderPreview.hasPreorder }">
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
                        <p v-if="preorderActionHint" class="detail-preorder-hint">{{ preorderActionHint }}</p>
                    </div>

                    <!-- ปุ่ม "เพิ่มไปยังรถเข็น" ถูกตัดออกตามรีวิว 260908 — ตัวเพิ่ม/ลดจำนวน
                         ด้านบนเขียนลงตะกร้าเองแล้ว กล่องนี้จึงเหลือไว้ให้ปุ่มเข้าสู่ระบบเท่านั้น
                         ต้อง v-if ที่กล่อง ไม่ใช่ที่ปุ่ม ไม่งั้นเหลือแถบว่างมีขอบ/เงาค้างอยู่ -->
                    <div v-if="!isLoggedIn" class="detail-actions">
                        <button type="button" class="detail-primary-btn is-outline" @click="goToLogin">
                            <i class="pi pi-sign-in"></i>
                            {{ t('productDetail.loginToOrder') }}
                        </button>
                    </div>
                </aside>
            </section>

            <!-- RULE: hide-empty-section — สินค้าชุดที่ดึงรายการย่อยไม่ได้ ไม่ต้องโชว์หัวข้อเปล่า -->
            <section v-if="isProductSet && (loadingSetItems || setItemSummary.length)" class="product-detail-section product-set-section">
                <div class="product-detail-section-head">
                    <div>
                        <span class="section-kicker">{{ t('productDetail.productSetKicker') }}</span>
                        <h2>{{ t('productDetail.productSetItems') }}</h2>
                    </div>
                    <span class="product-set-count">{{ t('productDetail.itemCount', { count: setItems.length }) }}</span>
                </div>
                <div v-if="loadingSetItems" class="detail-set-loading">
                    <i class="pi pi-spin pi-spinner"></i>
                    {{ t('productDetail.loadingProductSet') }}
                </div>
                <div v-else-if="setItemSummary.length > 0" class="product-set-grid">
                    <div v-for="item in setItemSummary" :key="item.setKey" class="product-set-card">
                        <img :src="item.image" :alt="item.displayName" loading="lazy" decoding="async" @error="$event.target.src = product.imageFallback" />
                        <div class="product-set-card-body">
                            <strong>{{ item.displayName }}</strong>
                            <span>{{ item.item_code }}</span>
                            <div class="product-set-card-meta">
                                <span>{{ t('productDetail.perSet', { qty: item.baseQty, unit: item.unit_code }) }}</span>
                                <span>{{ t('productDetail.totalQty', { qty: item.displayQty, unit: item.unit_code }) }}</span>
                            </div>
                        </div>
                        <div class="product-set-balance">{{ t('productDetail.stock') }} {{ item.balanceText }}</div>
                    </div>
                </div>
            </section>

            <!-- RULE: hide-empty-section — สินค้าที่ไม่มีทั้งคำอธิบาย ข้อมูลจำเพาะ และวิดีโอ
                 ไม่ต้องโชว์หัวข้อ "รายละเอียดสินค้า" คู่กับข้อความ "ไม่มีรายละเอียด" -->
            <section
                v-if="loadingDisplayDetail || hasProductMetaRows || safeProductDescription || productVideoEmbed"
                id="product-full-description"
                class="product-detail-section"
            >
                <div class="product-detail-section-head">
                    <div>
                        <span class="section-kicker">{{ t('productDetail.productDetailKicker') }}</span>
                        <h2>{{ t('productDetail.productDetail') }}</h2>
                    </div>
                </div>
                <div class="product-detail-content-grid">
                    <aside v-if="hasProductMetaRows" class="product-meta-card">
                        <div class="product-meta-title">{{ t('productDetail.productInfo') }}</div>
                        <div v-if="loadingDisplayDetail" class="product-meta-loading">
                            <i class="pi pi-spin pi-spinner"></i>
                            <span>{{ t('productDetail.loadingMoreInfo') }}</span>
                        </div>
                        <dl>
                            <template v-for="row in productMetaRows" :key="row.label">
                                <dt>{{ row.label }}</dt>
                                <dd>{{ row.value }}</dd>
                            </template>
                        </dl>
                    </aside>
                    <div v-if="safeProductDescription" class="product-description-card">
                        <div class="product-description-html" v-html="safeProductDescription"></div>
                    </div>
                </div>
                <div v-if="productVideoEmbed" class="product-video-card">
                    <div class="product-video-card-head">
                        <span class="section-kicker">{{ t('productDetail.productVideoKicker') }}</span>
                        <h3>{{ t('productDetail.productVideo') }}</h3>
                    </div>
                    <div class="product-video-frame" :style="{ '--product-video-ratio': productVideoEmbed.ratio }">
                        <iframe
                            v-if="productVideoEmbed.type === 'iframe'"
                            :src="productVideoEmbed.src"
                            :title="productDisplayName"
                            frameborder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            referrerpolicy="strict-origin-when-cross-origin"
                            allowfullscreen
                        ></iframe>
                        <video v-else :src="productVideoEmbed.src" controls preload="metadata"></video>
                    </div>
                </div>
            </section>

            <section v-if="replacementProducts.length > 0" class="product-detail-section related-product-section">
                <div class="product-detail-section-head">
                    <div>
                        <span class="section-kicker">{{ t('productDetail.replacementKicker') }}</span>
                        <h2>{{ t('productDetail.replacementProducts') }}</h2>
                    </div>
                </div>
                <div class="related-product-grid">
                    <ProductCard
                        v-for="item in replacementProducts"
                        :key="`replacement-${item.item_code}`"
                        variant="mini"
                        :name="getProductDisplayName(item)"
                        :image="item.image"
                        :fallback-image="item.imageFallback"
                        :aria-label="`${t('productDetail.viewMoreDetails')} ${getProductDisplayName(item)}`"
                        @select="openRelatedProduct(item.item_code)"
                    >
                        <template #eyebrow>
                            <span class="related-product-code">{{ item.item_code }}</span>
                        </template>
                    </ProductCard>
                </div>
            </section>

            <section v-if="suggestionProducts.length > 0" class="product-detail-section related-product-section">
                <div class="product-detail-section-head">
                    <div>
                        <span class="section-kicker">{{ t('productDetail.recommendedKicker') }}</span>
                        <h2>{{ t('productDetail.recommendedProducts') }}</h2>
                    </div>
                </div>
                <div class="related-product-grid">
                    <ProductCard
                        v-for="item in suggestionProducts"
                        :key="`suggestion-${item.item_code}`"
                        variant="mini"
                        :name="getProductDisplayName(item)"
                        :image="item.image"
                        :fallback-image="item.imageFallback"
                        :aria-label="`${t('productDetail.viewMoreDetails')} ${getProductDisplayName(item)}`"
                        @select="openRelatedProduct(item.item_code)"
                    >
                        <template #eyebrow>
                            <span class="related-product-code">{{ item.item_code }}</span>
                        </template>
                    </ProductCard>
                </div>
            </section>

            <section v-if="newProducts.length > 0" class="product-detail-section related-product-section">
                <div class="product-detail-section-head">
                    <div>
                        <span class="section-kicker">{{ t('productDetail.newProductKicker') }}</span>
                        <h2>{{ t('productDetail.newProducts') }}</h2>
                    </div>
                </div>
                <div class="related-product-grid">
                    <ProductCard
                        v-for="item in newProducts"
                        :key="`new-${item.item_code}`"
                        variant="mini"
                        :name="getProductDisplayName(item)"
                        :image="item.image"
                        :fallback-image="item.imageFallback"
                        :aria-label="`${t('productDetail.viewMoreDetails')} ${getProductDisplayName(item)}`"
                        @select="openRelatedProduct(item.item_code)"
                    >
                        <template #eyebrow>
                            <span class="related-product-code">{{ item.item_code }}</span>
                        </template>
                    </ProductCard>
                </div>
            </section>

            <div v-if="!isLoggedIn" class="detail-mobile-actions">
                <button type="button" class="detail-primary-btn is-outline" @click="goToLogin">
                    <i class="pi pi-sign-in"></i>
                    {{ t('productDetail.loginToOrder') }}
                </button>
            </div>
        </main>

        <div v-else class="detail-empty">
            <i class="pi pi-inbox"></i>
            <span>{{ t('productDetail.productNotFound') }}</span>
        </div>
    </div>
</template>

<style scoped>
.product-detail-page {
    min-height: 100vh;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 88%, #f1f5f9);
    color: var(--market-text, #111827);
    --detail-primary: var(--market-primary, var(--primary-color, #0f9f6e));
    --detail-border: var(--market-card-border, #e5e7eb);
    --detail-card: var(--market-card-bg, #ffffff);
    --detail-radius: var(--market-radius-lg, 14px);
}

.product-detail-page.is-embedded {
    height: 100dvh;
    min-height: 100dvh;
    overflow: auto;
}

.product-detail-page.is-embedded .detail-header {
    top: 0;
}

.detail-header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    border-bottom: 1px solid var(--detail-border);
    background: color-mix(in srgb, var(--detail-card) 94%, transparent);
    padding: 0.7rem clamp(0.9rem, 3vw, 1.4rem);
    backdrop-filter: blur(10px);
}

.detail-header h1 {
    flex: 1;
    margin: 0;
    overflow: hidden;
    color: var(--market-text, #111827);
    font-size: 0.95rem;
    font-weight: 800;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.detail-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid var(--detail-border);
    border-radius: 999px;
    background: #fff;
    color: #64748b;
    cursor: pointer;
}

.detail-icon-btn:hover,
.detail-icon-btn.is-active {
    border-color: var(--detail-primary);
    color: var(--detail-primary);
}

.detail-share-menu {
    display: grid;
    gap: 0.25rem;
    min-width: 170px;
    padding: 0.35rem;
}

.detail-share-title {
    padding: 0.35rem 0.45rem;
    color: #334155;
    font-size: 0.82rem;
    font-weight: 900;
}

.detail-share-menu button {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    border: 0;
    border-radius: var(--market-radius-md, 10px);
    background: transparent;
    color: #334155;
    cursor: pointer;
    font-weight: 700;
    padding: 0.55rem 0.6rem;
    text-align: left;
}

.detail-share-menu button:hover {
    background: color-mix(in srgb, var(--detail-primary) 8%, #fff);
    color: var(--detail-primary);
}

.detail-loading,
.detail-empty {
    display: flex;
    min-height: 55vh;
    align-items: center;
    justify-content: center;
}

.detail-empty {
    flex-direction: column;
    gap: 0.5rem;
    color: #94a3b8;
}

.detail-main {
    padding: clamp(0.8rem, 2vw, 1.25rem);
    padding-bottom: clamp(0.8rem, 2vw, 1.25rem);
}

.detail-main.has-mobile-actions {
    padding-bottom: 5.5rem;
}

.detail-top {
    display: grid;
    grid-template-columns: minmax(320px, 0.95fr) minmax(360px, 1.05fr);
    gap: clamp(1rem, 2vw, 1.35rem);
    max-width: 1180px;
    margin: 0 auto;
    align-items: start;
}

.detail-gallery-card,
.detail-purchase-card,
.product-detail-section {
    border: 1px solid var(--detail-border);
    border-radius: var(--detail-radius);
    background: var(--detail-card);
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
}

.detail-gallery-card {
    position: sticky;
    top: 4.6rem;
    overflow: hidden;
    padding: clamp(0.8rem, 2vw, 1.1rem);
}

.detail-status-row {
    display: flex;
    min-height: 2rem;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
}

.detail-stock-badge,
.detail-set-badge,
.detail-return-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 800;
}

.detail-stock-badge {
    background: color-mix(in srgb, var(--detail-primary) 12%, #fff);
    color: var(--detail-primary);
}

.detail-stock-badge.is-out {
    background: #fee2e2;
    color: #b91c1c;
}

.detail-stock-badge.is-preorder {
    background: #fff7ed;
    color: #c2410c;
}

.detail-return-badge {
    background: #fff7ed;
    color: #c2410c;
}

.detail-set-badge {
    background: color-mix(in srgb, var(--detail-primary) 16%, #fff);
    color: var(--detail-primary);
}

:deep(.detail-galleria) {
    width: 100%;
}

:deep(.detail-galleria .p-galleria-item-wrapper) {
    border-radius: calc(var(--detail-radius) - 2px);
    background: color-mix(in srgb, var(--detail-primary) 4%, #f8fafc);
}

.detail-main-image {
    display: block;
    width: 100%;
    height: min(52vh, 460px);
    min-height: 320px;
    object-fit: contain;
    padding: 0.75rem;
}

:deep(.detail-galleria .p-galleria-thumbnail-container) {
    background: transparent;
    padding: 0.85rem 0.25rem 0;
}

:deep(.detail-galleria .p-galleria-thumbnail-items) {
    gap: 0.65rem;
}

:deep(.detail-galleria .p-galleria-thumbnail-item) {
    border: 1px solid transparent !important;
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
    opacity: 0.78;
    overflow: hidden;
}

:deep(.detail-galleria .p-galleria-thumbnail-item:hover) {
    border-color: color-mix(in srgb, var(--detail-primary) 30%, #dbe3ea) !important;
    opacity: 1;
}

:deep(.detail-galleria .p-galleria-thumbnail-item-active) {
    border-color: color-mix(in srgb, var(--detail-primary) 70%, #ffffff) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--detail-primary) 10%, transparent);
    opacity: 1 !important;
}

.detail-thumb {
    display: flex;
    width: 70px;
    height: 58px;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
}

.detail-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.detail-image-empty {
    display: flex;
    min-height: 360px;
    align-items: center;
    justify-content: center;
    border-radius: var(--detail-radius);
    background: #f1f5f9;
}

.detail-image-empty img {
    max-width: 80%;
    max-height: 320px;
    object-fit: contain;
}

.detail-purchase-card {
    position: sticky;
    top: 4.6rem;
    padding: clamp(1rem, 2vw, 1.3rem);
}

.detail-title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
}

.detail-title-row h2 {
    margin: 0.35rem 0 0;
    color: var(--market-text, #111827);
    font-size: clamp(1.25rem, 2.4vw, 1.75rem);
    font-weight: 900;
    line-height: 1.35;
}

.detail-code {
    color: #64748b;
    font-size: 0.86rem;
}

.detail-title-actions {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.45rem;
}

.detail-soft-action {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.1rem;
    border: 1px solid var(--detail-border);
    border-radius: 999px;
    background: #fff;
    color: #475569;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 800;
    padding: 0.35rem 0.7rem;
}

.detail-soft-action:hover,
.detail-soft-action.is-active {
    border-color: var(--detail-primary);
    color: var(--detail-primary);
}

.detail-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.9rem 0;
}

.detail-stats span {
    border: 1px solid var(--detail-border);
    border-radius: 999px;
    color: #64748b;
    padding: 0.35rem 0.65rem;
    font-size: 0.8rem;
}

.detail-stats strong {
    color: var(--market-text, #111827);
}

.detail-stats span.is-popularity {
    border: 0;
    background: transparent;
    color: #f59e0b;
    padding: 0.35rem 0;
}

.detail-stats span.is-popularity strong {
    color: #f59e0b;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
}

.detail-price-box {
    border: 1px solid color-mix(in srgb, var(--detail-primary) 18%, #fff);
    border-radius: var(--detail-radius);
    background: color-mix(in srgb, var(--detail-primary) 7%, #fff);
    padding: 0.9rem 1rem;
}

.detail-currency,
.detail-price {
    color: var(--detail-primary);
    font-weight: 900;
}

.detail-currency {
    margin-right: 0.1rem;
    font-size: 1.05rem;
}

.detail-price {
    font-size: clamp(1.65rem, 4vw, 2.25rem);
}

.detail-price-unit {
    margin-left: 0.3rem;
    color: #64748b;
}

.detail-login-box,
.detail-muted-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    color: #475569;
}

.detail-login-box button {
    border: 0;
    border-radius: 999px;
    background: var(--detail-primary);
    color: #fff;
    cursor: pointer;
    font-weight: 800;
    padding: 0.4rem 0.75rem;
}

.detail-warning,
.detail-soldout,
.detail-incart {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    border-radius: var(--market-radius-md, 10px);
    margin-top: 0.75rem;
    padding: 0.7rem 0.8rem;
    font-size: 0.9rem;
}

/* จำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3) */
.detail-max-allowance {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    margin-top: 0.75rem;
    padding: 0.5rem 0.65rem;
    border-radius: var(--market-radius-md, 10px);
    background: #fff7ed;
    border: 1px solid #fed7aa;
    color: #9a3412;
    font-size: 0.85rem;
    line-height: 1.45;
}
.detail-max-allowance i {
    margin-top: 0.1rem;
    flex: 0 0 auto;
}
.detail-max-allowance.is-exceeded {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
    font-weight: 600;
}

.detail-warning,
.detail-soldout {
    border: 1px solid #fecaca;
    background: #fff7f7;
    color: #b91c1c;
}

.detail-warning span {
    flex: 1;
}

.detail-warning-action {
    margin-left: auto;
    border: 1px solid #fecaca;
    border-radius: 999px;
    background: #fff;
    color: #b91c1c;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 800;
    padding: 0.32rem 0.65rem;
    white-space: nowrap;
}

.detail-incart {
    border: 1px solid color-mix(in srgb, var(--detail-primary) 20%, #fff);
    background: color-mix(in srgb, var(--detail-primary) 7%, #fff);
    color: var(--detail-primary);
}

.detail-incart span {
    margin-left: auto;
    color: #64748b;
    font-size: 0.8rem;
}

.detail-preorder-preview {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    margin-top: 0.85rem;
}

.detail-preorder-preview > div {
    min-height: 58px;
    border: 1px solid #dbeafe;
    border-radius: var(--market-radius-md, 10px);
    background: #eff6ff;
    color: #1e3a8a;
    display: grid;
    align-content: center;
    gap: 0.1rem;
    padding: 0.65rem 0.75rem;
}

.detail-preorder-preview.has-preorder > div:last-child {
    border-color: #fed7aa;
    background: #fff7ed;
    color: #9a3412;
}

.detail-preorder-preview .is-blocked {
    border-color: #fecaca;
    background: #fff7f7;
    color: #b91c1c;
}

.detail-preorder-preview span {
    color: inherit;
    font-size: 0.74rem;
    font-weight: 800;
    opacity: 0.78;
}

.detail-preorder-preview strong {
    font-size: 0.9rem;
    line-height: 1.2;
}

.detail-preorder-hint {
    grid-column: 1 / -1;
    margin: 0;
    color: #64748b;
    font-size: 0.82rem;
    line-height: 1.35;
}

.detail-control-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 0.85rem;
    margin-top: 0.9rem;
    align-items: center;
}

.detail-label {
    color: #64748b;
    font-size: 0.82rem;
    font-weight: 800;
}

/* ── ตัวคูณหน่วย: 1 ลัง = 8 แพ็ค ── */
.detail-unit-ratio {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.35rem;
    font-size: 0.82rem;
    color: var(--text-color-secondary, #6b7280);
}

.detail-unit-ratio i {
    font-size: 0.78rem;
}

.detail-unit-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.detail-unit-btn {
    min-height: 2.15rem;
    border: 1px solid var(--detail-border);
    border-radius: 999px;
    background: #fff;
    color: #334155;
    cursor: pointer;
    font-weight: 700;
    padding: 0.35rem 0.85rem;
}

.detail-unit-btn:hover,
.detail-unit-btn.is-active {
    border-color: var(--detail-primary);
    background: color-mix(in srgb, var(--detail-primary) 8%, #fff);
    color: var(--detail-primary);
}

.detail-offer-box {
    margin-top: 0.85rem;
    border: 1px solid color-mix(in srgb, var(--detail-primary) 16%, #fff);
    border-radius: var(--market-radius-md, 10px);
    background: color-mix(in srgb, var(--detail-primary) 5%, #fff);
    padding: 0.8rem;
}

.detail-offer-box.is-custom {
    border-color: #fed7aa;
    background: #fff7ed;
}

.detail-offer-html {
    color: var(--detail-text, #1f2937);
    font-size: 0.9rem;
    line-height: 1.55;
}

.detail-offer-html :deep(p) {
    margin: 0 0 0.35rem;
}

.detail-offer-html :deep(p:last-child) {
    margin-bottom: 0;
}

.detail-offer-box.is-discount {
    border-color: #bbf7d0;
    background: #f0fdf4;
}

.detail-offer-title {
    margin-bottom: 0.5rem;
    color: var(--detail-primary);
    font-size: 0.86rem;
    font-weight: 900;
}

.detail-offer-box.is-discount .detail-offer-title,
.detail-offer-box.is-discount strong {
    color: #047857;
}

.detail-offer-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    border-radius: 0.6rem;
    background: #fff;
    padding: 0.55rem 0.65rem;
    font-size: 0.86rem;
}

.detail-offer-line + .detail-offer-line {
    margin-top: 0.45rem;
}

.detail-offer-line span {
    color: #334155;
}

.detail-offer-line strong {
    color: var(--detail-primary);
    white-space: nowrap;
}

.detail-summary-box {
    margin-top: 0.9rem;
    border: 1px solid var(--detail-border);
    border-radius: var(--detail-radius);
    background: #fff;
    padding: 0.85rem;
}

.detail-summary-title {
    margin-bottom: 0.4rem;
    color: var(--market-text, #111827);
    font-weight: 900;
}

.detail-summary-box p {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    color: #475569;
    line-height: 1.65;
}

.detail-summary-box a {
    display: inline-flex;
    margin-top: 0.55rem;
    color: var(--detail-primary);
    font-weight: 800;
    text-decoration: none;
}

.detail-set-box {
    margin-top: 0.9rem;
    border: 1px solid color-mix(in srgb, var(--detail-primary) 18%, #fff);
    border-radius: var(--detail-radius);
    background: color-mix(in srgb, var(--detail-primary) 5%, #fff);
    padding: 0.85rem;
}

.detail-set-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.7rem;
}

.detail-set-title {
    color: var(--market-text, #111827);
    font-weight: 900;
}

.detail-set-subtitle {
    margin-top: 0.15rem;
    color: #64748b;
    font-size: 0.78rem;
}

.detail-set-head > span,
.product-set-count {
    flex: 0 0 auto;
    border-radius: 999px;
    background: #fff;
    color: var(--detail-primary);
    font-size: 0.78rem;
    font-weight: 900;
    padding: 0.32rem 0.6rem;
}

.detail-set-loading,
.detail-set-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
    color: #64748b;
    padding: 1rem;
}

.detail-set-list {
    display: grid;
    gap: 0.55rem;
    max-height: 300px;
    overflow: auto;
    padding-right: 0.2rem;
}

.detail-set-item {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) auto;
    gap: 0.65rem;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--detail-primary) 10%, #fff);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
    padding: 0.55rem;
}

.detail-set-item img,
.product-set-card img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.detail-set-item img {
    width: 48px;
    height: 48px;
}

.detail-set-info {
    min-width: 0;
}

.detail-set-info strong,
.product-set-card-body strong {
    display: block;
    overflow: hidden;
    color: var(--market-text, #111827);
    font-size: 0.86rem;
    font-weight: 900;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.detail-set-info span,
.product-set-card-body span,
.detail-set-qty span,
.detail-set-qty em {
    color: #64748b;
    font-size: 0.76rem;
    font-style: normal;
}

.detail-set-qty {
    display: grid;
    gap: 0.12rem;
    text-align: right;
}

.detail-set-qty strong {
    color: var(--detail-primary);
    font-size: 0.84rem;
    white-space: nowrap;
}

.product-set-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.8rem;
}

.product-set-card {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 0.75rem;
    position: relative;
    border: 1px solid var(--detail-border);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
    padding: 0.75rem;
}

.product-set-card > img {
    width: 64px;
    height: 64px;
    border-radius: calc(var(--market-radius-md, 10px) - 2px);
    background: #f8fafc;
}

.product-set-card-body {
    min-width: 0;
}

.product-set-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.55rem;
}

.product-set-card-meta span {
    border-radius: 999px;
    background: color-mix(in srgb, var(--detail-primary) 7%, #fff);
    color: var(--detail-primary);
    font-size: 0.74rem;
    font-weight: 800;
    padding: 0.25rem 0.5rem;
}

.product-set-balance {
    grid-column: 1 / -1;
    border-top: 1px solid #f1f5f9;
    color: #64748b;
    font-size: 0.76rem;
    padding-top: 0.55rem;
}

.detail-quantity-panel {
    display: grid;
    gap: 0.55rem;
    min-width: 0;
}

.detail-qty-wrap {
    display: inline-grid;
    grid-template-columns: 2.4rem 3.25rem 2.4rem;
    overflow: hidden;
    width: max-content;
    border: 1px solid var(--detail-border);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
}

.detail-qty-wrap button {
    border: 0;
    background: #f8fafc;
    color: #334155;
    cursor: pointer;
}

.detail-qty-wrap button:disabled {
    cursor: default;
    opacity: 0.42;
}

.detail-qty-wrap span {
    display: flex;
    align-items: center;
    justify-content: center;
    border-left: 1px solid var(--detail-border);
    border-right: 1px solid var(--detail-border);
    font-weight: 800;
}

.detail-quick-qty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
}

.detail-quick-qty-actions button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2.05rem;
    border: 1px solid #dbeafe;
    border-radius: var(--market-radius-sm, 8px);
    background: #eff6ff;
    color: #1e40af;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 900;
    padding: 0.35rem 0.6rem;
}

.detail-quick-qty-actions button.is-preorder {
    border-color: #fed7aa;
    background: #fff7ed;
    color: #9a3412;
}

.detail-quick-qty-actions button.is-warning {
    border-color: #fecaca;
    background: #fff7f7;
    color: #b91c1c;
}

.detail-actions {
    margin-top: 1rem;
}

.detail-primary-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.9rem;
    border: 1px solid var(--detail-primary);
    border-radius: var(--market-radius-md, 10px);
    background: var(--detail-primary);
    color: #fff;
    cursor: pointer;
    font-weight: 900;
}

.detail-primary-btn.is-outline {
    background: color-mix(in srgb, var(--detail-primary) 8%, #fff);
    color: var(--detail-primary);
}

.detail-primary-btn:disabled {
    cursor: default;
    opacity: 0.48;
}

.product-detail-section {
    max-width: 1180px;
    margin: 1.15rem auto 2rem;
    padding: clamp(1rem, 2vw, 1.5rem);
}

.product-detail-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--detail-border);
    padding-bottom: 0.85rem;
}

.product-detail-section-head h2 {
    margin: 0;
    color: var(--market-text, #111827);
    font-size: clamp(1.15rem, 2vw, 1.5rem);
}

.section-kicker {
    display: block;
    margin-bottom: 0.25rem;
    color: var(--detail-primary);
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
}

.product-detail-content-grid {
    display: grid;
    grid-template-columns: minmax(220px, 0.32fr) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
}

.product-meta-card,
.product-description-card {
    border: 1px solid var(--detail-border);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
}

.product-meta-card {
    position: sticky;
    top: 4.7rem;
    overflow: hidden;
}

.product-meta-title {
    border-bottom: 1px solid var(--detail-border);
    background: color-mix(in srgb, var(--detail-primary) 6%, #fff);
    color: var(--market-text, #111827);
    font-weight: 900;
    padding: 0.8rem 0.9rem;
}

.product-meta-loading {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border-bottom: 1px solid #f1f5f9;
    color: #64748b;
    font-size: 0.82rem;
    font-weight: 700;
    padding: 0.65rem 0.9rem;
}

.product-meta-card dl {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
    margin: 0;
}

.product-meta-card dt,
.product-meta-card dd {
    margin: 0;
    padding: 0.65rem 0.9rem;
}

.product-meta-card dt {
    padding-bottom: 0.15rem;
    color: #64748b;
    font-size: 0.76rem;
    font-weight: 800;
}

.product-meta-card dd {
    border-bottom: 1px solid #f1f5f9;
    color: var(--market-text, #111827);
    font-weight: 800;
    overflow-wrap: anywhere;
}

.product-description-card {
    min-width: 0;
    padding: clamp(0.9rem, 2vw, 1.15rem);
}

.product-video-card {
    margin-top: 1rem;
    overflow: hidden;
    border: 1px solid var(--detail-border);
    border-radius: var(--market-radius-md, 10px);
    background: #fff;
}

.product-video-card-head {
    padding: 0.85rem 1rem 0;
}

.product-video-card-head h3 {
    margin: 0.15rem 0 0.8rem;
    color: var(--market-text, #111827);
    font-size: 1.05rem;
    font-weight: 900;
    line-height: 1.35;
}

.product-video-frame {
    width: 100%;
    aspect-ratio: var(--product-video-ratio, 16 / 9);
    min-height: 220px;
    max-height: min(72vh, 680px);
    background: #020617;
}

.product-video-frame iframe,
.product-video-frame video {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: #020617;
    object-fit: contain;
}

.product-description-html {
    color: color-mix(in srgb, var(--market-text, #111827) 84%, #fff);
    font-size: 1rem;
    line-height: 1.8;
}

.product-description-html :deep(p) {
    margin: 0 0 0.85rem;
}

.product-description-html :deep(ul),
.product-description-html :deep(ol) {
    margin: 0.5rem 0 1rem 1.35rem;
    padding: 0;
}

.product-description-html :deep(li) {
    margin: 0.25rem 0;
}

.product-description-html :deep(h1),
.product-description-html :deep(h2),
.product-description-html :deep(h3) {
    margin: 1rem 0 0.5rem;
    color: var(--market-text, #111827);
    font-weight: 900;
    line-height: 1.35;
}

.product-description-html :deep(a) {
    color: var(--detail-primary);
    text-decoration: underline;
}

.product-description-empty {
    border-radius: var(--market-radius-md, 10px);
    background: #f8fafc;
    color: #64748b;
    padding: 1rem;
    text-align: center;
}

.related-product-section {
    margin-top: -0.6rem;
}

.related-product-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 0.85rem;
}

/* กรอบ/เงา/รูป/ชื่อ ย้ายไปอยู่กับ ProductCard + shop-card.scss แล้ว
   (ของเดิม hardcode #fff / #f8fafc / #64748b ซึ่งไม่ตามธีมที่แอดมินตั้ง)
   เหลือแค่รหัสสินค้าที่เป็นบรรทัดเฉพาะของหน้านี้ */
.related-product-code {
    display: block;
    color: var(--market-muted);
    font-size: 0.76rem;
    margin-bottom: 0.15rem;
}

.detail-mobile-actions {
    display: none;
}

@media (max-width: 860px) {
    .detail-top {
        grid-template-columns: 1fr;
    }

    .detail-gallery-card,
    .detail-purchase-card,
    .product-meta-card {
        position: static;
    }

    .product-detail-content-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .detail-header {
        padding: 0.55rem 0.75rem;
    }

    .detail-main {
        padding: 0.75rem;
        /* พ้นแถบเมนูล่างที่ fixed อยู่ */
        padding-bottom: calc(var(--app-bottomnav-h) + var(--app-safe-bottom) + 0.75rem);
    }

    .detail-main.has-mobile-actions {
        /* บวกความสูงแถบปุ่มเข้าสู่ระบบที่ลอยอยู่เหนือแถบเมนู */
        padding-bottom: 5.75rem;
    }

    .detail-gallery-card,
    .detail-purchase-card,
    .product-detail-section {
        border-radius: var(--market-radius-md, 10px);
    }

    .detail-main-image {
        height: 295px;
        min-height: 260px;
    }

    .detail-purchase-card {
        padding: 0.95rem;
    }

    .detail-title-row h2 {
        font-size: 1.12rem;
    }

    .detail-title-row {
        display: block;
    }

    .detail-title-actions {
        justify-content: flex-start;
        margin-top: 0.7rem;
    }

    .detail-control-row {
        grid-template-columns: 1fr;
        gap: 0.5rem;
    }

    .detail-stats span,
    .detail-offer-line,
    .detail-summary-box p {
        font-size: 0.82rem;
    }

    .detail-set-item {
        grid-template-columns: 44px minmax(0, 1fr);
    }

    .detail-set-qty {
        grid-column: 1 / -1;
        border-top: 1px solid #f1f5f9;
        padding-top: 0.45rem;
        text-align: left;
    }

    .product-set-grid {
        grid-template-columns: 1fr;
    }

    .detail-actions {
        display: none;
    }

    .detail-mobile-actions {
        position: fixed;
        right: 0;
        /* วางเหนือแถบเมนูล่าง และไม่ต้องบวก safe-area เองแล้วเพราะแถบเมนูรับไปให้ */
        bottom: calc(var(--app-bottomnav-h) + var(--app-safe-bottom));
        left: 0;
        /* 995: อยู่เหนือเนื้อหาแต่ต่ำกว่าแถบเมนู (996) และ topbar (997) */
        z-index: 995;
        display: block;
        border-top: 1px solid var(--detail-border);
        background: var(--shop-surface);
        padding: 0.65rem 0.9rem;
        box-shadow: 0 -10px 28px rgba(15, 23, 42, 0.1);
    }
}
</style>
