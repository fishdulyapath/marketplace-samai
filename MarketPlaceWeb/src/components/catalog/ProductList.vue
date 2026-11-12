<script setup>
import SalePremiumService from '@/services/SalePremiumService';
import SalePremiumDetailDialog from './SalePremiumDetailDialog.vue';
import MobileCategoryTiles from './MobileCategoryTiles.vue';
import PromotionTag from './PromotionTag.vue';
import returnIcon from '@/assets/retun.png';
import ProductService from '@/services/ProductService';
import { formatPrice, getProductSaleUnit, isSetProduct, resolveProductListPrice, toCatalogNumber } from '@/services/catalogPrice';
import { useAuthenStore } from '@/stores/authen';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { pickMasterName, pickProductName } from '@/utils/languageDisplay';
import { cartUnitSummaries } from '@/utils/productUnitSummary';
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductFullDetailDialog from '@/views/pages/ProductFullDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import ProgressSpinner from 'primevue/progressspinner';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import Toast from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const props = defineProps({
    mobile: Boolean,
    discoveryReady: Boolean,
    selectedCategory: {
        type: String,
        default: 'all'
    },
    selectedCategoryName: {
        type: String,
        default: ''
    },
    categories: {
        type: Array,
        default: () => []
    }
});

const emit = defineEmits(['select-category']);
const authenStore = useAuthenStore();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const isAuthenticated = computed(() => authenStore.isAuthenticated);
const quantitiesInCart = computed(() => cartUnitSummaries(cartStore.cartItems, languageStore.locale));
const route = useRoute();
const t = (key, params) => languageStore.t(key, params);
const activeViewLabel = computed(() => {
    if (props.selectedCategoryName) return props.selectedCategoryName;
    if (favoriteFilterActive.value) return t('catalog.favorites');
    if (props.selectedCategory === 'promotions') return t('catalog.promotion');
    if (props.selectedCategory === 'productset') return t('catalog.productSet');
    if (props.selectedCategory === 'all') return t('catalog.allProducts');
    return t('catalog.selectedCategory');
});
const resultLabel = computed(() => t('catalog.itemCount', { count: products.value?.length || 0 }));
const compactCategoryOptions = computed(() => {
    const rows = Array.isArray(props.categories) ? props.categories : [];
    return rows.filter((category) => category?.code);
});

const toast = useToast();

// ข้อมูลสำหรับ Dialog
const selectedProductCode = ref('');
const showProductDetail = ref(false);
const showProductSetDetail = ref(false);
const showProductFullDetail = ref(false);

// ข้อมูลสินค้าและการค้นหา
const products = ref([]);
const searchQuery = ref(typeof route.query.q === 'string' ? route.query.q : '');
watch(() => route.query.q, value => { if (route.name === 'catalog') searchQuery.value = value || ''; });
const loadingProducts = ref(true);
const favoriteFilterActive = ref(false);
const instockFilterActive = ref(localStorage.getItem('_isstock') === '1');
const categorySheetOpen = ref(false);
const categoryStrip = ref(null);
const results = ref(null);
const categoryCollapsed = ref(false);
const pendingCategory = ref(null);
const waitingForSheet = ref(false);
const keepResultsInView = ref(false);
const loadingGrid = ref(null);
const resultGrid = ref(null);
const emptyResult = ref(null);
onDeactivated(() => { pendingCategory.value = null; });
function scrollToResults() {
    if (!results.value) return;
    const top = results.value.getBoundingClientRect().top + window.scrollY - getSearchStickyTopPx() - (searchStripRef.value?.offsetHeight || 0);
    window.scrollTo({ top });
}
async function chooseMobileCategory(code) {

    pendingCategory.value = code;
    keepResultsInView.value = true;
    waitingForSheet.value = categorySheetOpen.value;
    categorySheetOpen.value = false;
    selectCompactCategory(code);
    await nextTick();
    alignMobileCategory();
}
const filterSheetOpen = ref(false);
const draftFavorite = ref(false);
const draftInStock = ref(false);
const appliedFilterCount = computed(() => Number(favoriteFilterActive.value) + Number(instockFilterActive.value));
const mobileLayout = window.matchMedia('(max-width: 900px)');
function closeSheetOnDesktop(event) {
    if (!event.matches) { pendingCategory.value = null; filterSheetOpen.value = false; categorySheetOpen.value = false; }
}
const isSearching = ref(false); // เพิ่มตัวแปรสำหรับติดตามสถานะการค้นหา

// สำหรับ Skeleton Loading
const initialLoading = ref(true);

// ข้อมูลการเพจจิเนชั่น
const pagination = ref({
    total: 0,
    perPage: 50,
    totalPage: 0,
    page: 0
});
const isLoadingMore = ref(false);
const hasMoreItems = ref(true);
const observerTarget = ref(null); // element ที่จะถูกสังเกตสำหรับ Infinite Scroll

// เพิ่มตัวแปรสำหรับควบคุมการแสดงปุ่มกลับขึ้นด้านบน
const showScrollTop = ref(false);
const productListShellRef = ref(null);
const searchStripRef = ref(null);
const isSearchFloating = ref(false);
const searchStripHeight = ref(0);
const searchFixedLeft = ref(0);
const searchFixedWidth = ref(0);
const searchRightGutter = ref(0);
const compactCategoryTrackRef = ref(null);
const canCompactScrollLeft = ref(false);
const canCompactScrollRight = ref(false);
const searchFixedStyle = computed(() => {
    if (props.mobile) {
        if (isSearchFloating.value) return {};
        return {
            marginLeft: `-${Math.max(0, searchFixedLeft.value)}px`,
            marginRight: `-${searchRightGutter.value}px`
        };
    }
    if (!isSearchFloating.value) return {};
    return {
        left: `${Math.max(0, searchFixedLeft.value)}px`,
        width: `${Math.max(0, searchFixedWidth.value)}px`
    };
});
let priceLoadToken = 0;
let listRequestId = 0;

function alignMobileCategory() {
    const target = (loadingGrid.value || resultGrid.value)?.firstElementChild || emptyResult.value;
    const strip = searchStripRef.value;
    if (!props.mobile || !target?.isConnected || !strip) return;
    const toolbarBottom = getSearchStickyTopPx() + strip.getBoundingClientRect().height;
    window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - toolbarBottom - 8, behavior: 'instant' });
    updateSearchFloating();
}

// Reveal the loaded shelves and align the new first row in the same render cycle.
watch(
    () => pendingCategory.value && props.selectedCategory === pendingCategory.value
        && props.discoveryReady && !loadingProducts.value && !waitingForSheet.value,
    async ready => {
        if (!ready) return;
        const category = pendingCategory.value;
        pendingCategory.value = null;
        await nextTick();
        if (category === props.selectedCategory) alignMobileCategory();
    },
    { flush: 'post' }
);

const selectedSalePremiumCode = ref('');
const showSalePremiumDetail = ref(false);
function isSalePremiumProduct(product) {
    return String(product?.item_type ?? '') === '4' || String(product?.sale_premium_code ?? '').trim() !== '';
}

function shouldIncludeSalePremium() {
    return !favoriteFilterActive.value && ['all', 'promotions'].includes(props.selectedCategory);
}

function normalizeSalePremiumProduct(promo) {
    return {
        ...promo,
        item_code: promo.sale_premium_code || promo.item_code,
        item_name: promo.name_1 || promo.item_name,
        item_type: '4',
        is_promotion: '1',
        favorite_item: 0,
        imageFallback: ProductService.getPlaceholderImage(),
        price_unit_code: promo.unit_standard || promo.condition_unit_code || '',
        _priceLoaded: true,
        _priceLoading: false,
        _priceError: false
    };
}

function getProductDisplayName(product) {
    return pickProductName(product, languageStore.locale) || product.display_name || product.item_name || '';
}

function getProductCategoryDisplay(product) {
    return product.category_display || product.category || '';
}

function getCompactCategoryName(category) {
    const specialCategoryKeys = {
        all: 'catalog.allProducts',
        promotions: 'catalog.promotion',
        productset: 'catalog.productSet'
    };
    return specialCategoryKeys[category?.code] ? t(specialCategoryKeys[category.code]) : pickMasterName(category, languageStore.locale) || category?.display_name || category?.name || category?.code || '';
}

function selectCompactCategory(categoryCode) {
    emit('select-category', categoryCode || 'all');

}

function getSearchStickyTopPx() {
    const source = productListShellRef.value || document.documentElement;
    const raw = window.getComputedStyle(source).getPropertyValue('--product-search-sticky-top').trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return 0;
    if (raw.endsWith('rem')) {
        const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
        return value * rootFontSize;
    }
    return value;
}

function updateSearchFloating() {
    const shell = productListShellRef.value;
    const strip = searchStripRef.value;
    if (!shell || !strip) return;

    const top = getSearchStickyTopPx();
    const shellRect = shell.getBoundingClientRect();
    const height = strip.offsetHeight || searchStripHeight.value || 0;

    const toolbarStart = categoryStrip.value?.getBoundingClientRect().bottom ?? shellRect.top;
    categoryCollapsed.value = !!categoryStrip.value && toolbarStart <= top + 1;
    searchStripHeight.value = height;
    searchFixedLeft.value = shellRect.left;
    searchFixedWidth.value = shellRect.width;
    if (props.mobile) searchRightGutter.value = Math.max(0, document.documentElement.clientWidth - shellRect.right);
    isSearchFloating.value = toolbarStart <= top && shellRect.bottom > top + height + 12;
}

function updateCompactCategoryScroll() {
    const el = compactCategoryTrackRef.value;
    if (!el) {
        canCompactScrollLeft.value = false;
        canCompactScrollRight.value = false;
        return;
    }

    canCompactScrollLeft.value = el.scrollLeft > 4;
    canCompactScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}

function scrollCompactCategories(direction) {
    const el = compactCategoryTrackRef.value;
    if (!el) return;
    const distance = Math.max(220, Math.floor(el.clientWidth * 0.72));
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = Math.max(0, Math.min(maxScroll, el.scrollLeft + direction * distance));
    updateCompactCategoryScroll();
}

async function loadProductPrices(targetProducts) {
    if (!isAuthenticated.value || !Array.isArray(targetProducts) || targetProducts.length === 0) return;

    const currentToken = priceLoadToken;
    const productsToPrice = targetProducts.filter((product) => product.item_code && !isSalePremiumProduct(product));

    productsToPrice.forEach((product) => {
        product._priceLoading = true;
        product._priceError = false;
        product.price_unit_code = getProductSaleUnit(product);
    });

    const batchSize = 8;
    for (let index = 0; index < productsToPrice.length; index += batchSize) {
        if (currentToken !== priceLoadToken) return;

        const batch = productsToPrice.slice(index, index + batchSize);
        await Promise.all(
            batch.map(async (product) => {
                try {
                    const priceResult = await resolveProductListPrice(product);
                    if (currentToken !== priceLoadToken) return;

                    if (priceResult) {
                        product.price = priceResult.price;
                        product.price_unit_code = priceResult.unit_code || getProductSaleUnit(product);
                        product.barcode = priceResult.barcode || product.barcode || '';
                        product.wh_code = priceResult.wh_code || product.wh_code || '';
                        product.shelf_code = priceResult.shelf_code || product.shelf_code || '';
                        product.ratio = priceResult.ratio || product.ratio || '1';
                        product.stand_value = priceResult.stand_value || product.stand_value || '1';
                        product.divide_value = priceResult.divide_value || product.divide_value || '1';
                        product._priceLoaded = true;
                        product._priceError = false;
                    } else {
                        product.price = 0;
                        product._priceLoaded = false;
                        product._priceError = true;
                    }
                } catch (error) {
                    if (currentToken !== priceLoadToken) return;
                    product._priceError = true;
                    console.warn(`Unable to load price for ${product.item_code}`, error);
                } finally {
                    if (currentToken === priceLoadToken) {
                        product._priceLoading = false;
                    }
                }
            })
        );
    }
}

onMounted(() => {
    // ตรวจสอบค่า favorite จาก query parameters
    favoriteFilterActive.value = route.query.favorite === '1';

    if (localStorage.getItem('_isstock') === null) {
        localStorage.setItem('_isstock', '0');
    }

    // โหลดข้อมูลสินค้าทันที
    loadProducts();

    // เพิ่ม event listener สำหรับการเลื่อน
    window.addEventListener('scroll', checkScrollPosition);
    window.addEventListener('resize', updateSearchFloating);
    window.addEventListener('resize', updateCompactCategoryScroll);
    mobileLayout.addEventListener('change', closeSheetOnDesktop);
    nextTick(() => {
        updateSearchFloating();
        updateCompactCategoryScroll();
    });
});

onUnmounted(() => {
    listRequestId++;
    // ทำความสะอาด observer เมื่อออกจากหน้า
    if (observer) {
        observer.disconnect();
    }

    // ลบ event listener เมื่อออกจากหน้า
    window.removeEventListener('scroll', checkScrollPosition);
    window.removeEventListener('resize', updateSearchFloating);
    window.removeEventListener('resize', updateCompactCategoryScroll);
    mobileLayout.removeEventListener('change', closeSheetOnDesktop);
    clearTimeout(searchTimeout);
});

// ตั้งค่า Intersection Observer สำหรับการโหลดข้อมูลแบบ Infinite Scroll
let observer;
watch(observerTarget, (target) => {
    observer?.disconnect();
    if (!target) return;
    observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !initialLoading.value) loadMoreProducts();
    }, { threshold: 0.1, rootMargin: '100px' });
    observer.observe(target);
}, { flush: 'post' });

// ฟังก์ชันตรวจสอบตำแหน่งการเลื่อน
function checkScrollPosition() {
    // แสดงปุ่มเมื่อเลื่อนลงมากกว่า 300px
    showScrollTop.value = window.scrollY > 300;
    updateSearchFloating();
}

// ฟังก์ชันสำหรับเลื่อนกลับไปด้านบนสุด
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// โหลดข้อมูลสินค้าหน้าแรก
async function loadProducts() {
    priceLoadToken++;
    initialLoading.value = true;
    products.value = [];
    const requestId = ++listRequestId;
    loadingProducts.value = true;
    isLoadingMore.value = false;
    try {
        const isProductSet = props.selectedCategory === 'productset';
        const filters = {
            category: props.selectedCategory === 'promotions' || isProductSet ? '' : props.selectedCategory !== 'all' ? props.selectedCategory : '',
            search: searchQuery.value,
            favorite: favoriteFilterActive.value ? 1 : 0,
            isPromotion: props.selectedCategory === 'promotions' ? 1 : 0,
            isproductset: isProductSet ? 1 : 0
        };

        const [result, salePremiumRows] = await Promise.all([
            ProductService.getProducts(filters, 0),
            shouldIncludeSalePremium()
                ? SalePremiumService.getListForSale({
                      cust_code: localStorage.getItem('_userCode') || '',
                      search: searchQuery.value,
                      is_stock: instockFilterActive.value ? '1' : '0',
                      limit: 100
                  })
                : Promise.resolve([])
        ]);
        if (requestId !== listRequestId) return;

        // รีเซ็ตและเพิ่มข้อมูลใหม่
        products.value = [...salePremiumRows.map(normalizeSalePremiumProduct), ...result.data];
        pagination.value.page = 0;
        loadProductPrices(products.value);

        // ตรวจสอบว่ายังมีข้อมูลให้โหลดต่อหรือไม่
        hasMoreItems.value = result.data.length >= pagination.value.perPage;

        // หลังจากโหลดข้อมูลเสร็จ ยกเลิกสถานะการโหลด
        initialLoading.value = false;

        // หลังจากโหลดข้อมูลแล้ว ลองติดตั้ง observer อีกครั้ง
        nextTick(() => {
            updateSearchFloating();
            updateCompactCategoryScroll();

        });
    } catch (error) {
        if (requestId !== listRequestId) return;
        console.error('Error loading products:', error);
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('errors.loadProducts'),
            life: 3000
        });
        // แม้จะมีข้อผิดพลาด ก็ยังต้องยกเลิกสถานะการโหลด
        initialLoading.value = false;
    } finally {
        if (requestId === listRequestId) {
            loadingProducts.value = false;
            isSearching.value = false;
        }
    }
}

// โหลดข้อมูลสินค้าเพิ่มเติม (สำหรับ infinite scroll)
async function loadMoreProducts() {
    if (loadingProducts.value || isLoadingMore.value || !hasMoreItems.value) return;

    const requestId = listRequestId;
    isLoadingMore.value = true;

    try {
        const isProductSet = props.selectedCategory === 'productset';
        const filters = {
            category: props.selectedCategory === 'promotions' || isProductSet ? '' : props.selectedCategory !== 'all' ? props.selectedCategory : '',
            search: searchQuery.value,
            favorite: favoriteFilterActive.value ? 1 : 0,
            isPromotion: props.selectedCategory === 'promotions' ? 1 : 0,
            isproductset: isProductSet ? 1 : 0
        };

        const nextPage = pagination.value.page + 1;
        const result = await ProductService.getProducts(filters, nextPage);
        if (requestId !== listRequestId) return;

        // เพิ่มข้อมูลลงในอาร์เรย์ products เดิม
        products.value = [...products.value, ...result.data];
        pagination.value.page = nextPage;
        if (result.data.length) loadProductPrices(products.value.slice(-result.data.length));

        // ตรวจสอบว่ายังมีข้อมูลให้โหลดต่อหรือไม่
        hasMoreItems.value = result.data.length >= pagination.value.perPage;
    } catch (error) {
        if (requestId !== listRequestId) return;
        console.error('Error loading more products:', error);
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('errors.loadMoreProducts'),
            life: 3000
        });
    } finally {
        if (requestId === listRequestId) isLoadingMore.value = false;
    }
}

// ฟังก์ชันที่เรียกจากปุ่มเพื่อโหลดข้อมูลเพิ่มเติม (กรณี infinite scroll ไม่ทำงาน)
function handleLoadMore() {
    if (!isLoadingMore.value && hasMoreItems.value) {
        loadMoreProducts();
    }
}

function getInventoryStatus(soldOut) {
    return soldOut === '1' ? 'OUTOFSTOCK' : 'INSTOCK';
}

function getInventoryLabel(soldOut) {
    return soldOut === '1' ? t('productDetail.soldOut') : '';
}

function shouldShowPreorderBadge(product) {
    return toCatalogNumber(product?.preorder_only_available, 0) === 1;
}

function shouldShowOutOfStockBadge(product) {
    return !shouldShowPreorderBadge(product) && product?.sold_out === '1';
}

// เพิ่มฟังก์ชัน debounce สำหรับการค้นหา
let searchTimeout = null;
function debouncedSearch() {
    // ยกเลิก timeout เดิมถ้ามี
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }

    // แสดงสถานะกำลังค้นหา
    isSearching.value = true;

    searchTimeout = setTimeout(() => {
        filterProducts();
        if (searchQuery.value.trim()) nextTick(scrollToResults);
        nextTick(updateCompactCategoryScroll);
        // เมื่อส่งคำขอไปแล้ว ให้ยังคงแสดงสถานะกำลังค้นหาต่อไป
        // สถานะนี้จะถูกรีเซ็ตใน loadProducts เมื่อโหลดเสร็จ
    }, 1000);
}

// กรองและเรียงลำดับสินค้า
function filterProducts() {
    clearTimeout(searchTimeout);
    // รีเซ็ตการเพจจิเนชั่น
    pagination.value.page = 0;
    hasMoreItems.value = true;

    // โหลดข้อมูลใหม่
    loadProducts();
}

// เพิ่มฟังก์ชันล้างการค้นหา
function clearSearch() {
    searchQuery.value = '';
    filterProducts();
}

function setFilters(favorite, inStock) {
    favoriteFilterActive.value = favorite;
    instockFilterActive.value = inStock;
    localStorage.setItem('_favorite', favorite ? '1' : '0');
    localStorage.setItem('_isstock', inStock ? '1' : '0');
    filterProducts();
}

function openFilterSheet() {
    draftFavorite.value = favoriteFilterActive.value;
    draftInStock.value = instockFilterActive.value;
    filterSheetOpen.value = true;
}

function applyMobileFilters() {
    filterSheetOpen.value = false;
    if (draftFavorite.value !== favoriteFilterActive.value || draftInStock.value !== instockFilterActive.value) {
        setFilters(draftFavorite.value, draftInStock.value);
    }
}

// เปิด Dialog แสดงรายละเอียดสินค้า
function viewProductDetail(product) {
    if (isSalePremiumProduct(product)) {
        selectedSalePremiumCode.value = product.sale_premium_code || product.item_code;
        showProductDetail.value = false;
        showProductSetDetail.value = false;
        showProductFullDetail.value = false;
        showSalePremiumDetail.value = true;
        return;
    }
    selectedProductCode.value = product.item_code;
    showProductFullDetail.value = false;
    if (isSetProduct(product)) {
        showProductDetail.value = false;
        showProductSetDetail.value = true;
        return;
    }

    showProductSetDetail.value = false;
    showProductDetail.value = true;
}

function openFullProductDetail(itemCode) {
    selectedProductCode.value = itemCode;
    showProductDetail.value = false;
    showProductSetDetail.value = false;
    showProductFullDetail.value = true;
}

// จัดการเมื่อมีการเพิ่มสินค้าลงตะกร้าจาก Dialog
function handleAddedToCart(cartItem) {
    // toast.add({
    //     severity: 'success',
    //     summary: 'เพิ่มสินค้าแล้ว',
    //     detail: `เพิ่ม ${cartItem.name} ลงในตะกร้าแล้ว จำนวน ${cartItem.qty} ${cartItem.unit}`,
    //     life: 1000
    // });
}

// ล้างตัวกรองทั้งหมด
function clearFilters() {
    searchQuery.value = '';
    setFilters(false, false);
}

// ฟังก์ชันเปลี่ยนสถานะรายการโปรด
function toggleFavorite(product, event) {
    // หยุดการกระจายของ event
    if (event) {
        event.stopPropagation();
    }

    // เก็บค่า favorite_item เดิมไว้
    const oldFavoriteStatus = product.favorite_item;

    // สลับค่า favorite_item ระหว่าง "0" และ "1"
    product.favorite_item = Number(product.favorite_item) === 1 ? '0' : '1';

    // อัพเดตสถานะโดยไม่ต้องโหลดข้อมูลใหม่ทั้งหมด
    // ให้ส่งคำขอไปที่ API แบบเดิม แต่ไม่ต้องรอผลลัพธ์เพื่อแสดงการเปลี่ยนแปลงในหน้าจอ
    ProductService.updateFavoriteStatus(product.item_code, product.favorite_item).catch((error) => {
        console.error('Error updating favorite status:', error);
        // กรณีมีข้อผิดพลาด ให้คืนค่าสถานะเดิม
        product.favorite_item = oldFavoriteStatus;
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('errors.updateFavorite'),
            life: 3000
        });
    });
}

// ติดตามการเปลี่ยนแปลงของตัวกรอง
watch(
    [() => props.selectedCategory, () => route.query.favorite, () => route.query.timestamp],
    ([category, favorite], [previousCategory, previousFavorite]) => {
        if (route.name !== 'catalog') return;
        if (!props.mobile && category !== previousCategory) nextTick(scrollToResults);
        if (favorite !== previousFavorite) favoriteFilterActive.value = favorite === '1';
        filterProducts();
    }
);

// แยกการติดตามการเปลี่ยนแปลงของ searchQuery ออกมา และใช้ debouncedSearch
watch(compactCategoryOptions, () => nextTick(updateCompactCategoryScroll), { deep: false });

watch(searchQuery, debouncedSearch, { flush: 'sync' });

watch([isAuthenticated, () => authenStore.userCode], () => {
    priceLoadToken++;
    products.value = [];
    filterProducts();
});

function handleFavoriteChanged(data) {
    // หาสินค้าในรายการและอัพเดทสถานะ
    const productToUpdate = products.value.find((p) => p.item_code === data.itemCode);
    if (productToUpdate) {
        productToUpdate.favorite_item = data.isFavorite ? '1' : '0';
    }
}
</script>

<template>
    <div ref="productListShellRef" class="product-list-shell">
        <Toast position="top-right" />

        <section v-if="mobile" ref="categoryStrip" class="mobile-category-strip">
            <button class="browse-categories" type="button" aria-haspopup="dialog" @click="categorySheetOpen = true">{{ t('catalog.browseCategories') }} <i class="pi pi-chevron-down"></i></button>
            <MobileCategoryTiles :categories="compactCategoryOptions" :selected="selectedCategory" :label="getCompactCategoryName" @select="chooseMobileCategory" />
        </section>

        <!-- ช่องค้นหา -->
        <div v-if="isSearchFloating" class="search-strip-spacer" :style="{ height: `${searchStripHeight}px` }"></div>
        <div ref="searchStripRef" class="search-strip" :class="{ 'is-floating': isSearchFloating }" :style="searchFixedStyle">
            <div class="search-strip-head">
                <div class="search-context">
                    <p class="search-title">{{ activeViewLabel }}</p>
                    <p class="search-subtitle">{{ resultLabel }}</p>
                </div>
                <div class="search-actions">
                    <button type="button" class="filter-chip favorite-chip" :class="{ active: favoriteFilterActive }" :aria-pressed="favoriteFilterActive" :aria-label="t('catalog.favoriteProducts')" @click="setFilters(!favoriteFilterActive, instockFilterActive)">
                        <i class="pi" :class="favoriteFilterActive ? 'pi-heart-fill' : 'pi-heart'"></i>
                        {{ t('catalog.favoriteProducts') }}
                    </button>
                    <button type="button" class="filter-chip" :class="{ active: instockFilterActive }" :aria-pressed="instockFilterActive" :aria-label="t('catalog.inStockOnly')" @click="setFilters(favoriteFilterActive, !instockFilterActive)">
                        <i class="pi pi-check-circle"></i>
                        {{ t('catalog.inStockOnly') }}
                    </button>
                </div>
            </div>
            <div class="catalog-search-toolbar">
                <IconField iconPosition="left" class="w-full">
                    <InputText v-model="searchQuery" type="text" :placeholder="t('catalog.searchPlaceholder')" :aria-label="t('catalog.searchPlaceholder')" class="w-full modern-search-input" />
                    <InputIcon v-if="!isSearching && !searchQuery" class="pi pi-search search-spinner" />
                    <button v-else-if="!isSearching && searchQuery" type="button" class="search-icon-button pi pi-times" :aria-label="t('common.clearSearch')" @click="clearSearch"></button>
                    <InputIcon v-else class="pi pi-spin pi-spinner search-spinner" />
                </IconField>
                <button v-if="mobile && categoryCollapsed" type="button" class="mobile-filter-trigger category-trigger" aria-haspopup="dialog" :aria-expanded="categorySheetOpen" @click="categorySheetOpen = true">
                    <span>{{ getCompactCategoryName(compactCategoryOptions.find(c => c.code === selectedCategory) || { code: selectedCategory }) }}</span><i class="pi pi-chevron-down"></i>
                </button>
                <button type="button" :aria-label="t('catalog.filterButton')" class="mobile-filter-trigger" :class="{ active: appliedFilterCount }"
                    aria-haspopup="dialog" :aria-expanded="filterSheetOpen" @click="openFilterSheet">
                    <i class="pi pi-sliders-h" aria-hidden="true"></i>
                    <span v-if="!categoryCollapsed">{{ t('catalog.filterButton') }}</span><span v-if="appliedFilterCount">({{ appliedFilterCount }})</span>
                </button>
            </div>
            <div v-if="!mobile && compactCategoryOptions.length" class="compact-category-scroller">
                <button type="button" class="compact-category-arrow" :class="{ disabled: !canCompactScrollLeft }" :disabled="!canCompactScrollLeft" aria-label="เลื่อนหมวดหมู่ไปทางซ้าย" @click="scrollCompactCategories(-1)">
                    <i class="pi pi-chevron-left"></i>
                </button>
                <div ref="compactCategoryTrackRef" class="compact-category-row" aria-label="Product categories" @scroll="updateCompactCategoryScroll">
                    <button
                        v-for="category in compactCategoryOptions"
                        :key="`sticky-${category.code}`"
                        type="button"
                        class="compact-category-chip"
                        :class="{ active: selectedCategory === category.code }"
                        :aria-pressed="selectedCategory === category.code"
                        :title="getCompactCategoryName(category)"
                        @click="selectCompactCategory(category.code)"
                    >
                        {{ getCompactCategoryName(category) }}
                    </button>
                </div>
                <button type="button" class="compact-category-arrow" :class="{ disabled: !canCompactScrollRight }" :disabled="!canCompactScrollRight" aria-label="เลื่อนหมวดหมู่ไปทางขวา" @click="scrollCompactCategories(1)">
                    <i class="pi pi-chevron-right"></i>
                </button>
            </div>
        </div>

        <div v-if="mobile" v-show="!pendingCategory" class="mobile-discovery">
            <slot name="discovery" />
        </div>
        <Dialog v-model:visible="categorySheetOpen" @after-hide="waitingForSheet = false" modal dismissableMask blockScroll position="bottom" :draggable="false" class="catalog-filter-sheet catalog-category-sheet" :header="t('catalog.chooseCategory')" :closeButtonProps="{ text: true, severity: 'secondary', class: 'catalog-filter-close', 'aria-label': t('common.close') }">
            <MobileCategoryTiles grid :categories="compactCategoryOptions" :selected="selectedCategory" :label="getCompactCategoryName" @select="chooseMobileCategory" />
        </Dialog>
        <Dialog v-model:visible="filterSheetOpen" modal dismissableMask position="bottom" :draggable="false"
            class="catalog-filter-sheet" :header="t('catalog.filterTitle')" :closeButtonProps="{ text: true, severity: 'secondary', class: 'catalog-filter-close', 'aria-label': t('common.close') }">
            <div class="filter-sheet-options">
                <label for="catalog-mobile-favorite">
                    {{ t('catalog.favoriteProducts') }}
                    <ToggleSwitch inputId="catalog-mobile-favorite" v-model="draftFavorite" />
                </label>
                <label for="catalog-mobile-stock">
                    {{ t('catalog.inStockOnly') }}
                    <ToggleSwitch inputId="catalog-mobile-stock" v-model="draftInStock" />
                </label>
            </div>
            <template #footer>
                <div class="filter-sheet-actions">
                    <button type="button" class="sheet-clear" @click="draftFavorite = false; draftInStock = false">{{ t('common.clearFilters') }}</button>
                    <Button type="button" :label="t('catalog.showProducts')" @click="applyMobileFilters" />
                </div>
            </template>
        </Dialog>

        <!-- เนื้อหาหลัก -->
        <main ref="results" class="pb-6" :class="{ 'aligned-mobile-results': mobile && keepResultsInView }">
            <h2 v-if="mobile" class="results-heading">{{ activeViewLabel }}</h2>
            <!-- Skeleton Loading -->
            <div v-if="initialLoading || pendingCategory" ref="loadingGrid" class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
                <div v-for="i in 8" :key="i" class="catalog-card skeleton-card">
                    <Skeleton height="200px" />
                    <div class="p-3">
                        <Skeleton width="30%" height="12px" class="mb-1" />
                        <Skeleton width="90%" height="16px" class="mb-2" />
                        <Skeleton width="50%" height="12px" class="mb-2" />
                        <div class="flex justify-between items-center">
                            <Skeleton width="40%" height="24px" />
                            <Skeleton shape="circle" size="36px" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- ตารางแสดงสินค้า -->
            <div v-else-if="products && products.length > 0" ref="resultGrid" class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
                <!-- ส่วนแสดงสินค้า -->
                <div
                    v-for="product in products"
                    :key="product.item_code"
                    class="catalog-card cursor-pointer"
                    role="button"
                    tabindex="0"
                    :aria-label="`${t('productDetail.viewMoreDetails')} ${getProductDisplayName(product)}`"
                    :aria-describedby="isAuthenticated && quantitiesInCart.has(product.item_code) ? 'catalog-qty-' + encodeURIComponent(product.item_code) : undefined"
                    @click="viewProductDetail(product)"
                    @keydown.enter.prevent="viewProductDetail(product)"
                    @keydown.space.prevent="viewProductDetail(product)"
                >
                    <div class="relative product-image-wrap">
                        <img :src="product.image" :alt="getProductDisplayName(product)" class="w-full aspect-square object-contain" @error="$event.target.src = product.imageFallback" />

                        <!-- สถานะสินค้าและ promotion tag -->
                        <div class="absolute top-2 left-2 flex gap-1.5 flex-wrap items-start product-status-badges">
                            <Tag v-if="shouldShowPreorderBadge(product)" :value="t('productDetail.preorderLabel')" class="inventory-tag is-preorder" />
                            <Tag v-if="shouldShowOutOfStockBadge(product)" :value="getInventoryLabel(product.sold_out)" class="inventory-tag is-out" />

                        </div>

                        <!-- แสดงปุ่มรายการโปรด (สามารถคลิกได้) -->
                        <div v-if="isAuthenticated && !isSalePremiumProduct(product)" class="absolute right-2 top-2 cursor-pointer" @click.stop="toggleFavorite(product, $event)">
                            <Button
                                :icon="product.favorite_item === '1' || product.favorite_item === 1 ? 'pi pi-heart-fill' : 'pi pi-heart'"
                                text
                                rounded
                                :aria-label="t('catalog.favoriteAria')"
                                :class="product.favorite_item === '1' || product.favorite_item === 1 ? 'p-button-rounded p-button-text p-button-danger' : 'p-button-rounded p-button-text'"
                                style="width: 2rem; height: 2rem"
                            />
                        </div>
                    </div>

                    <div class="p-3 product-content-wrap">
                        <!-- รหัสสินค้า -->
                        <!-- <div class="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                            รหัส: {{ product.item_code }}
                            <img v-if="product.is_return === '1'" :src="returnIcon" alt="นโยบายการคืนสินค้า" class="w-6 h-6 object-contain" />
                        </div> -->

                        <!-- ชื่อสินค้า -->
                        <div class="mb-2 font-medium text-sm line-clamp-2 product-name justify-center" v-tooltip="getProductDisplayName(product)">
                            <Tag v-if="isSalePremiumProduct(product)" :value="t('catalog.freeGift')" severity="danger" />
                            <Tag v-else-if="selectedCategory !== 'promotions' && product.is_promotion === '1'" value="PROMOTION" class="promotion-tag" />
                            <span> {{ getProductDisplayName(product) }}</span>
                        </div>
                        <PromotionTag v-if="!isSalePremiumProduct(product) && selectedCategory === 'promotions'" :offer="product.promotion_tag" />

                        <!-- หมวดหมู่ -->
                        <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            {{ getProductCategoryDisplay(product) }}
                        </div>

                        <div v-if="isAuthenticated" class="product-price-row">
                            <Skeleton v-if="product._priceLoading" width="90px" height="18px" />
                            <template v-else-if="formatPrice(product.price)">
                                <span class="product-price">฿{{ formatPrice(product.price) }}</span>
                                <span class="product-price-unit">/ {{ product.price_unit_code || getProductSaleUnit(product) }}</span>
                            </template>
                            <span v-else-if="product._priceError" class="product-price-muted">{{ t('catalog.priceNotFound') }}</span>
                            <span v-else class="product-price-muted">{{ t('catalog.waitingPrice') }}</span>
                            <img v-if="product.is_return === '1'" :src="returnIcon" :alt="t('productDetail.returnAlt')" class="product-return-icon" />
                        </div>
                        <div v-if="isAuthenticated && quantitiesInCart.has(product.item_code)"
                            :id="'catalog-qty-' + encodeURIComponent(product.item_code)" class="product-cart-quantity">
                            <i class="pi pi-shopping-cart" aria-hidden="true"></i>
                            <span><span class="sr-only">{{ t('productDetail.inCart') }} </span>{{ quantitiesInCart.get(product.item_code) }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- สถานะว่าง (ไม่พบสินค้า) -->
            <div v-else-if="!loadingProducts && !initialLoading && products && products.length === 0" class="flex justify-center p-8">
                <div ref="emptyResult" class="empty-state-box rounded-lg p-6 w-full max-w-md">
                    <div class="flex flex-col items-center text-center">
                        <i class="pi pi-search text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
                        <h3 class="text-xl font-medium mb-2">{{ t('catalog.emptyTitle') }}</h3>
                        <p class="text-gray-500 dark:text-gray-400 mb-4">{{ t('catalog.emptyHint') }}</p>
                        <Button :label="t('catalog.clearFilters')" icon="pi pi-filter-slash" outlined class="w-full sm:w-auto" @click="clearFilters" />
                    </div>
                </div>
            </div>

            <!-- สถานะกำลังโหลด -->
            <div v-else-if="loadingProducts && !initialLoading" class="flex justify-center p-8">
                <div class="text-center">
                    <ProgressSpinner style="width: 50px" class="mb-4" />
                    <p class="text-gray-500">{{ t('catalog.loadingProducts') }}</p>
                </div>
            </div>

            <!-- ส่วนแสดงการโหลดเพิ่มเติม -->
            <div v-if="products && products.length > 0" class="p-4 flex justify-center">
                <div ref="observerTarget" id="observer-target" class="w-full text-center">
                    <div v-if="isLoadingMore" class="flex justify-center items-center">
                        <ProgressSpinner style="width: 30px" />
                        <span class="ml-2 text-gray-500">{{ t('catalog.loadingMore') }}</span>
                    </div>
                    <div v-else-if="!hasMoreItems" class="text-gray-500">{{ t('catalog.allLoaded') }}</div>
                    <div v-if="!hasMoreItems" class="text-gray-500">
                        <Button :label="t('catalog.clearFilters')" icon="pi pi-filter-slash" outlined class="w-full sm:w-auto" @click="clearFilters" />
                    </div>
                    <div v-else>
                        <p class="text-gray-500 mb-2">{{ t('catalog.scrollToLoad') }}</p>
                        <!-- เพิ่มปุ่มโหลดเพิ่มเติม กรณี infinite scroll ไม่ทำงาน -->
                        <Button :label="t('catalog.loadMore')" icon="pi pi-arrow-down" outlined @click="handleLoadMore" :disabled="isLoadingMore || !hasMoreItems" />
                    </div>
                </div>
            </div>
        </main>

        <!-- ปุ่มกลับขึ้นด้านบน -->
        <Button v-show="showScrollTop" icon="pi pi-arrow-up" class="back-to-top-btn" @click="scrollToTop" :aria-label="t('catalog.backToTop')" />

        <!-- Product Detail Dialog -->
        <ProductDetailDialog
            :visible="showProductDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductDetail = $event"
            @added-to-cart="handleAddedToCart"
            @favorite-changed="handleFavoriteChanged"
            @show-full-detail="openFullProductDetail"
        />

        <!-- Product Set Detail Dialog -->
        <SalePremiumDetailDialog v-model:visible="showSalePremiumDetail" :sale-premium-code="selectedSalePremiumCode" />
        <ProductSetDialog
            :visible="showProductSetDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductSetDetail = $event"
            @added-to-cart="handleAddedToCart"
            @favorite-changed="handleFavoriteChanged"
            @show-full-detail="openFullProductDetail"
        />

        <ProductFullDetailDialog
            :visible="showProductFullDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductFullDetail = $event"
            @added-to-cart="handleAddedToCart"
            @favorite-changed="handleFavoriteChanged"
        />
    </div>
</template>

<style scoped>
.product-list-shell {
    --product-search-sticky-top: var(--market-header-height, 4rem);
    border-radius: var(--catalog-radius-lg, 0.9rem);
    background: var(--catalog-surface, #ffffff);
    animation: listFadeIn 300ms ease;
}

.search-strip {
    position: sticky;
    top: var(--product-search-sticky-top);
    z-index: 120;
    margin: 0;
    padding: 0.8rem;
    border-radius: 0;
    border: 1px solid var(--market-card-border, #efe3c8);
    border-top: none;
    border-left: none;
    border-right: none;
    background: color-mix(in srgb, var(--market-card-bg, #ffffff) 92%, var(--market-header-bg, #f7ebcf));
    box-shadow: 0 10px 22px rgba(140, 111, 53, 0.16);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
}

.search-strip.is-floating {
    position: fixed;
    top: var(--product-search-sticky-top);
    z-index: 995;
    border-radius: 0 0 var(--catalog-radius-lg, 0.9rem) var(--catalog-radius-lg, 0.9rem);
}

.search-strip-spacer {
    flex: 0 0 auto;
}

.search-strip-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.8rem;
    gap: 1rem;
    flex-wrap: nowrap;
}

.search-context {
    min-width: 0;
}

.search-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: nowrap;
    justify-content: flex-end;
    flex-shrink: 0;
}

.filter-chip {
    border: 1px solid #efe1c4;
    background: #ffffff;
    color: #5b4a27;
    border-radius: 999px;
    padding: 0.4rem 0.75rem;
    font-size: 0.78rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
}

.filter-chip.active {
    border-color: #d6b36a;
    color: #6f5c33;
    background: #fbf0d9;
}

.filter-chip.favorite-chip.active {
    border-color: #ef4444;
    color: #b91c1c;
    background: #fef2f2;
}

.filter-chip:nth-child(2).active {
    border-color: #ddc89a;
    color: #6f5c33;
    background: #fcf6e8;
}

.search-title {
    margin: 0;
    font-size: 0.98rem;
    font-weight: 700;
    color: #5b4a27;
    max-width: min(42rem, 58vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.search-subtitle {
    margin: 0;
    font-size: 0.78rem;
    color: #9b8a67;
}

.search-pill {
    font-size: 0.72rem;
    font-weight: 700;
    color: #6f5c33;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    background: #f5e7c4;
}

.modern-search-input {
    border-radius: 0.75rem;
    border: 1px solid #cbd5e1;
    box-shadow: none;
}

.compact-category-scroller {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.65rem;
    min-width: 0;
}

.compact-category-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    flex: 1 1 auto;
    padding-bottom: 0.08rem;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
}

.compact-category-row::-webkit-scrollbar {
    display: none;
}

.compact-category-arrow {
    width: 2rem;
    height: 2rem;
    border: 1px solid color-mix(in srgb, var(--market-card-border, #efe1c4) 82%, var(--market-primary, #0f9f6e));
    background: color-mix(in srgb, var(--market-card-bg, #ffffff) 94%, var(--market-header-bg, #f7ebcf));
    color: var(--market-primary, #0f9f6e);
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    cursor: pointer;
    box-shadow: 0 4px 10px color-mix(in srgb, var(--market-header-text, #5b4a27) 10%, transparent);
    transition:
        transform 160ms ease,
        opacity 160ms ease,
        background 160ms ease;
}

.compact-category-arrow:hover:not(:disabled) {
    background: var(--market-primary, #0f9f6e);
    color: #ffffff;
    transform: translateY(-1px);
}

.compact-category-arrow:disabled,
.compact-category-arrow.disabled {
    opacity: 0.36;
    cursor: default;
    box-shadow: none;
}

.compact-category-chip {
    border: 1px solid color-mix(in srgb, var(--market-card-border, #efe1c4) 80%, var(--market-primary, #0f9f6e));
    background: color-mix(in srgb, var(--market-card-bg, #ffffff) 94%, var(--market-header-bg, #f7ebcf));
    color: var(--market-header-text, #5b4a27);
    border-radius: 999px;
    padding: 0.42rem 0.8rem;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.1;
    white-space: nowrap;
    cursor: pointer;
    max-width: 11.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 0 auto;
    transition:
        background 160ms ease,
        color 160ms ease,
        border-color 160ms ease,
        transform 160ms ease;
}

.compact-category-chip:hover {
    border-color: var(--market-primary, #0f9f6e);
    color: var(--market-primary, #0f9f6e);
    transform: translateY(-1px);
}

.compact-category-chip.active {
    border-color: var(--market-primary, #0f9f6e);
    background: var(--market-primary, #0f9f6e);
    color: #ffffff;
}

@keyframes listFadeIn {
    from {
        opacity: 0;
        transform: translateY(6px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* สไตล์สำหรับ infinite scroll */
#observer-target {
    min-height: 100px;
    margin: 20px 0;
    position: relative;
}

.product-status-badges {
    z-index: 2;
}

:deep(.inventory-tag.p-tag),
:deep(.promotion-tag.p-tag) {
    font-size: 0.63rem !important;
    font-weight: 700 !important;
    letter-spacing: 0.02em !important;
    border: 1px solid transparent !important;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(1px);
}

:deep(.inventory-tag.is-in.p-tag) {
    background: #ecfdf3 !important;
    color: #047857 !important;
    border-color: #a7f3d0 !important;
}

:deep(.inventory-tag.is-out.p-tag) {
    background: #fef2f2 !important;
    color: #b91c1c !important;
    border-color: #fecaca !important;
}

:deep(.inventory-tag.is-preorder.p-tag) {
    background: #fff7ed !important;
    color: #c2410c !important;
    border-color: #fed7aa !important;
}

:deep(.promotion-tag.p-tag) {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important;
    color: #ffffff !important;
    border-color: #fcd34d !important;
}

.catalog-card {
    border: 1px solid var(--market-card-border, #efe1c4);
    border-radius: 0.9rem;
    overflow: hidden;
    background: var(--market-card-bg, #ffffff);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
    transition:
        transform 0.2s ease,
        box-shadow 0.2s ease;
    min-height: 100%;
    animation: cardStaggerIn 260ms ease both;
}

.catalog-card:nth-child(2n) {
    animation-delay: 25ms;
}

.catalog-card:nth-child(3n) {
    animation-delay: 45ms;
}

.catalog-card:nth-child(4n) {
    animation-delay: 70ms;
}

.catalog-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(140, 111, 53, 0.16);
}

@keyframes cardStaggerIn {
    from {
        opacity: 0;
        transform: translateY(8px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.skeleton-card {
    pointer-events: none;
}

.product-image-wrap {
    background: linear-gradient(180deg, #f8fafc, #ffffff);
}

.product-content-wrap {
    background: var(--market-card-bg, #ffffff);
}

.product-name {
    color: #5b4a27;
    line-height: 1.4;
    font-size: 0.97rem;
}

.product-price-row {
    min-height: 24px;
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    margin-top: 0.35rem;
}

.product-cart-quantity {
    display: flex;
    align-items: baseline;
    gap: .4rem;
    margin-top: .35rem;
    color: var(--market-primary, #167458);
    font-size: .85rem;
    font-weight: 600;
    overflow-wrap: anywhere;
}

.product-cart-quantity i { font-size: .9em; }

.product-return-icon {
    width: 3.8rem;
    height: 3.8rem;
    object-fit: contain;
    flex: 0 0 auto;
    align-self: center;
    margin-left: auto;
}

.product-price {
    color: var(--market-primary, #0f9f6e);
    font-weight: 800;
    font-size: 1rem;
}

.product-price-unit,
.product-price-muted {
    color: #8a7658;
    font-size: 0.78rem;
}

.empty-state-box {
    border: 1px solid var(--market-card-border, #efe1c4);
    background: var(--market-card-bg, #ffffff);
    box-shadow: 0 4px 10px rgba(140, 111, 53, 0.1);
}

/* สไตล์สำหรับ spinner การค้นหา */
:deep(.search-spinner) {
    margin-right: 0.5rem;
}

/* สไตล์สำหรับไอคอนปิดการค้นหา */
:deep(.search-spinner.pi-times) {
    cursor: pointer;
}

/* สไตล์สำหรับปุ่มกลับขึ้นด้านบน */
.search-icon-button {
    position: absolute;
    top: 50%;
    right: 0.35rem;
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: #7a6b55;
    cursor: pointer;
    transform: translateY(-50%);
}

.search-icon-button:hover,
.search-icon-button:focus-visible {
    background: rgba(15, 159, 110, 0.1);
    color: var(--market-primary, #0f9f6e);
    outline: none;
}

.back-to-top-btn {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 99;
    border-radius: 50%;
    width: 3rem;
    height: 3rem;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    animation: fadeIn 0.3s;
    transition: transform 0.2s;
}

.back-to-top-btn:hover {
    transform: translateY(-3px);
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@media (max-width: 768px) {
    .product-list-shell {
        --product-search-sticky-top: 7.45rem;
        border-radius: 0;
    }

    .search-strip {
        margin: 0;
        padding: 0.62rem 0.65rem;
        border-radius: 0;
        border-top: none;
        border-left: none;
        border-right: none;
    }

    .search-strip-head {
        align-items: flex-start;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 0.55rem;
    }

    .search-actions {
        width: 100%;
        justify-content: flex-start;
        gap: 0.45rem;
        flex-wrap: wrap;
    }

    .search-pill {
        font-size: 0.7rem;
        padding: 0.3rem 0.7rem;
    }

    .filter-chip {
        padding: 0.38rem 0.68rem;
        font-size: 0.76rem;
    }

    .search-title {
        max-width: calc(100vw - 2rem);
    }

    .search-subtitle {
        display: none;
    }

    .modern-search-input {
        min-height: 2.35rem;
        border-radius: 0.68rem;
    }

    .compact-category-scroller {
        margin-top: 0.5rem;
        gap: 0.38rem;
    }

    .compact-category-row {
        gap: 0.38rem;
    }

    .compact-category-arrow {
        width: 1.85rem;
        height: 1.85rem;
    }

    .compact-category-chip {
        max-width: 9.2rem;
        padding: 0.38rem 0.7rem;
        font-size: 0.75rem;
    }

    :deep(.inventory-tag.p-tag),
    :deep(.promotion-tag.p-tag) {
        font-size: 0.6rem !important;
        padding: 0.2rem 0.45rem !important;
    }

    .catalog-card {
        border-radius: 0.8rem;
    }

    .back-to-top-btn {
        width: 2.8rem;
        height: 2.8rem;
        bottom: 18px;
        right: 18px;
    }
}

@media (max-width: 480px) {
    .product-list-shell {
        --product-search-sticky-top: 7.35rem;
    }

    .search-strip {
        margin: 0;
        padding: 0.58rem 0.55rem;
        border-radius: 0;
        border-top: none;
        border-left: none;
        border-right: none;
    }

    .search-title {
        font-size: 0.95rem;
    }

    .grid {
        gap: 0.8rem;
        padding: 0.75rem;
    }
}

.mobile-filter-trigger {
    display: none;
}

@media (max-width: 900px) {
    .product-list-shell {
        --product-search-sticky-top: var(--market-header-height, 4rem);
    }

    .search-strip {
        padding: .5rem .65rem;
        background: var(--market-card-bg, white);
        box-shadow: 0 3px 10px rgb(60 49 26 / 7%);
    }

    .search-strip.is-floating {
        inset-inline: 0;
        border-radius: 0;
    }

    .search-strip-head, .compact-category-arrow { display: none; }
    .catalog-search-toolbar {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: stretch;
        gap: .45rem;
    }

    .modern-search-input { height: 44px; border-radius: .7rem; padding-inline-end: 2.5rem; }
    .mobile-filter-trigger {
        display: inline-flex; align-items: center; justify-content: center; gap: .35rem;
        min-height: 44px; padding-inline: .75rem; border-radius: .7rem;
        border: 1px solid var(--market-card-border, #dfd7c6);
        color: var(--market-header-text, #55432b); background: var(--market-card-bg, #fff);
        font: inherit; font-weight: 600; cursor: pointer;
    }
    .mobile-filter-trigger.active {
        border-color: var(--market-primary, #0f9f6e);
        color: var(--market-primary, #0f9f6e);
    }

    .compact-category-scroller { margin-top: .35rem; }
    .compact-category-row { gap: .4rem; padding-block: 2px; }
    .compact-category-chip { min-height: 32px; padding-inline: .8rem; }
    .back-to-top-btn { bottom: calc(var(--market-mobile-nav-height, 64px) + env(safe-area-inset-bottom) + 8px); }
}

:global(.p-dialog.catalog-filter-sheet) {
    width: min(100%, 36rem); max-width: 100%; max-height: 90dvh; margin: 0;
    border-radius: 1.25rem 1.25rem 0 0;
    padding: .5rem .2rem env(safe-area-inset-bottom);
    background: var(--market-card-bg, #fff); overflow: auto;
}
:global(.catalog-filter-sheet::before) {
    content: ''; flex: none; width: 2.75rem; height: 4px; align-self: center;
    background: #c7c9cf; border-radius: 4px;
}
:global(.catalog-filter-sheet .p-button.catalog-filter-close) {
    color: #56616a;
    background: transparent;
    border-color: transparent;
}
:global(.catalog-filter-sheet .catalog-filter-close:hover) { background: #f1f3f4; }
:global(.catalog-filter-sheet .catalog-filter-close:focus-visible) { outline: 2px solid #56616a; outline-offset: 2px; }
.mobile-discovery { display:grid; gap:.65rem; padding:.4rem; }
.mobile-discovery > * { min-width:0; }
.mobile-category-strip { padding: .4rem; }
.mobile-discovery:empty { display: none; }
/* Short categories also need enough scroll range to place their first row below the toolbar. */
.aligned-mobile-results { min-height: calc(100dvh - var(--product-search-sticky-top)); }
.aligned-mobile-results .catalog-card { animation: none; }
.browse-categories,.results-heading { font-weight:700; color:var(--market-text); padding:.55rem; }
.browse-categories { background:none; border:0; cursor:pointer; }
.catalog-search-toolbar:has(.category-trigger) { grid-template-columns:minmax(0,1fr) auto auto; }
.category-trigger span { max-width:24vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
:global(.p-dialog.catalog-category-sheet) { overflow:hidden; max-height:78dvh; color:var(--market-text); }
@media (max-width: 900px) {
    :global(.p-dialog-mask.p-dialog-bottom .p-dialog.catalog-category-sheet) {
        margin: 0;
        width: 100%;
        max-width: 100%;
    }
}
:global(.catalog-category-sheet .p-dialog-content) { overflow-y:auto; overscroll-behavior:contain; min-height:0; background:var(--market-card-bg); }
:global(.catalog-category-sheet .p-dialog-header) { flex:none; color:var(--market-text); background:var(--market-card-bg); }
.filter-sheet-options label {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    min-height: 52px; border-top: 1px solid #e8e8e3; cursor: pointer;
}
.filter-sheet-actions { display: flex; width: 100%; align-items: center; gap: .8rem; }
.filter-sheet-actions button { flex: 1; min-height: 44px; }
.sheet-clear {
    background: transparent; border: 0; font: inherit; font-weight: 600; text-decoration: underline;
    text-underline-offset: .2em; color: var(--market-primary, #15815c); cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
    .product-list-shell,
    .catalog-card,
    .back-to-top-btn {
        animation: none !important;
        transition: none !important;
    }

    .catalog-card:hover,
    .back-to-top-btn:hover {
        transform: none !important;
    }
}
@media (max-width: 900px) {
    main > .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.product-list-shell { --product-search-sticky-top: var(--app-topbar-h); }
</style>
