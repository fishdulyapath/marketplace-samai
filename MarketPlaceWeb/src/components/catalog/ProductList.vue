<script setup>
import returnIcon from '@/assets/retun.png';
import ProductService from '@/services/ProductService';
import SalePremiumService from '@/services/SalePremiumService';
import { useAuthenStore } from '@/stores/authen';
import { useLanguageStore } from '@/stores/languageStore';
import { pickMasterName, pickProductName } from '@/utils/languageDisplay';
import ProductCard from '@/components/product/ProductCard.vue';
import SalePremiumDetailDialog from '@/components/catalog/SalePremiumDetailDialog.vue';
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductFullDetailDialog from '@/views/pages/ProductFullDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const props = defineProps({
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
    },
    // โหมดหน้า "รายการโปรดของฉัน" — ล็อกให้แสดงเฉพาะสินค้าที่กดหัวใจไว้
    // ปิดชิปสลับรายการโปรดกับแถบหมวดหมู่ เพราะหน้านี้มีหน้าที่เดียว
    favoriteOnly: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['select-category']);
const authenStore = useAuthenStore();
const languageStore = useLanguageStore();
const isAuthenticated = computed(() => authenStore.isAuthenticated);
const route = useRoute();
const router = useRouter();
const t = (key, params) => languageStore.t(key, params);
const activeViewLabel = computed(() => {
    if (props.selectedCategoryName) return props.selectedCategoryName;
    if (favoriteFilterActive.value) return t('catalog.favorites');
    if (props.selectedCategory === 'promotions') return t('catalog.promotion');
    if (props.selectedCategory === 'productset') return t('catalog.productSet');
    if (props.selectedCategory === 'all') return t('catalog.allProducts');
    return t('catalog.selectedCategory');
});
// จำนวนที่ "แสดงอยู่ตอนนี้" ไม่ใช่จำนวนสินค้าทั้งร้าน
// ไม่นับยอดจริงเพราะต้อง COUNT ด้วยเงื่อนไขเดียวกับ list (join ราคา/สต็อก/หมวด)
// วัดแล้ว 166ms เทียบกับดึงรายการ 14ms คือแพงกว่า 12 เท่า และต้องจ่ายทุกครั้งที่
// ค้นหาหรือเลื่อนหน้า — ไม่คุ้มกับตัวเลขที่ผู้ใช้แค่เหลือบมอง
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
const selectedSalePremiumCode = ref('');
const showSalePremiumDetail = ref(false);

// ข้อมูลสินค้าและการค้นหา
const products = ref([]);
const searchQuery = ref('');
const loadingProducts = ref(true);
const favoriteFilterActive = ref(props.favoriteOnly);
const instockFilterActive = ref(localStorage.getItem('_isstock') === '1');
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
const compactCategoryTrackRef = ref(null);
const canCompactScrollLeft = ref(false);
const canCompactScrollRight = ref(false);
let priceLoadToken = 0;

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

function getProductSaleUnit(product) {
    return product.online_sale_unit || product.unit_code || product.start_sale_unit || product.unit_standard || product.unit_cost || '';
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

// เปลี่ยนหมวดแล้วรายการสินค้าถูกล้างเพื่อโหลดชุดใหม่ ความสูงหน้าหดวูบ browser จึง
// ดัน scroll ขึ้นไปเอง (มักถึงบนสุด) — ตรึง viewport ไว้ที่หัวกล่องสินค้าแทน
// offset ใช้ค่า top จริงของแถบค้นหา sticky เพื่อไม่ให้หัวกล่องมุดใต้ topbar
function scrollToProductListShell() {
    const shell = productListShellRef.value;
    if (!shell) return;
    const stickyTop = searchStripRef.value ? parseFloat(getComputedStyle(searchStripRef.value).top) || 0 : 0;
    const targetTop = shell.getBoundingClientRect().top + window.scrollY - stickyTop;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
}

// ตรึงสองจังหวะ: ทันทีที่กด (กันหน้าหดตอนเริ่มโหลด) และซ้ำอีกครั้งหลังรายการหมวดใหม่
// render เสร็จ (response มาช้า หน้าหด/ขยายอีกรอบ browser อาจหนีบ scroll หนีไปได้)
let pinShellAfterReload = false;

function selectCompactCategory(categoryCode) {
    pinShellAfterReload = true;
    emit('select-category', categoryCode || 'all');
    nextTick(scrollToProductListShell);
}

// ลบ updateSearchFloating/getSearchStickyTopPx ทิ้งแล้ว — เดิมสลับแถบค้นหาเป็น position:fixed เอง
// ตรวจบนเบราว์เซอร์จริงแล้วพบว่า isSearchFloating ไม่เคยเป็น true เลย (scroll 1500px ก็ไม่ติด)
// ขณะที่ position:sticky ทำงานถูกต้องอยู่แล้ว เพราะไม่มี ancestor ตัวใดตั้ง overflow ไว้
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

function toCatalogNumber(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function formatPrice(value) {
    const price = toCatalogNumber(value, NaN);
    if (!Number.isFinite(price) || price <= 0) return '';
    return price.toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function hasSalePrice(value) {
    const price = toCatalogNumber(value, NaN);
    return Number.isFinite(price) && price > 0;
}

function getUnitStandValue(unit) {
    const standValue = toCatalogNumber(unit?.stand_value, NaN);
    return Number.isFinite(standValue) && standValue > 0 ? standValue : Number.POSITIVE_INFINITY;
}

function pickSmallestStandValueUnit(productDetail) {
    const units = [productDetail, ...(productDetail?.otherUnits || [])].filter((unit) => unit?.unit_code);
    if (!units.length) return productDetail;
    return [...units].sort((a, b) => {
        const standDiff = getUnitStandValue(a) - getUnitStandValue(b);
        if (standDiff !== 0) return standDiff;
        return String(a.unit_code || '').localeCompare(String(b.unit_code || ''), 'th');
    })[0];
}

function getSetDetailSaleUnit(productDetail, listProduct) {
    const preferredUnit = listProduct?.online_sale_unit || '';
    const units = [productDetail, ...(productDetail?.otherUnits || [])].filter((unit) => unit?.unit_code);
    return units.find((unit) => unit.unit_code === preferredUnit) || pickSmallestStandValueUnit(productDetail);
}

async function resolveProductListPrice(product) {
    if (isSetProduct(product)) {
        const setResult = await ProductService.getProductSetByItemCode(product.item_code);
        const selectedUnit = getSetDetailSaleUnit(setResult?.data, product);

        return {
            price: hasSalePrice(selectedUnit?.price) ? selectedUnit.price : 0,
            unit_code: selectedUnit?.unit_code || getProductSaleUnit(product),
            barcode: selectedUnit?.barcode || product.barcode || '',
            wh_code: selectedUnit?.wh_code || product.wh_code || '',
            shelf_code: selectedUnit?.shelf_code || product.shelf_code || '',
            ratio: selectedUnit?.ratio || product.ratio || '1',
            stand_value: selectedUnit?.stand_value || product.stand_value || '1',
            divide_value: selectedUnit?.divide_value || product.divide_value || '1'
        };
    }

    if (!product.online_sale_unit) {
        try {
            const detailResult = await ProductService.getProductByItemCode(product.item_code);
            const selectedUnit = pickSmallestStandValueUnit(detailResult?.data);
            if (selectedUnit?.unit_code) {
                return {
                    price: hasSalePrice(selectedUnit.price) ? selectedUnit.price : 0,
                    unit_code: selectedUnit.unit_code,
                    barcode: selectedUnit.barcode || product.barcode || '',
                    wh_code: selectedUnit.wh_code || product.wh_code || '',
                    shelf_code: selectedUnit.shelf_code || product.shelf_code || '',
                    ratio: selectedUnit.ratio || product.ratio || '1',
                    stand_value: selectedUnit.stand_value || product.stand_value || '1',
                    divide_value: selectedUnit.divide_value || product.divide_value || '1'
                };
            }
        } catch (error) {
            console.warn(`Unable to resolve visible sale unit for ${product.item_code}`, error);
        }
    }

    const unitCode = getProductSaleUnit(product);

    const priceResult = await ProductService.getProductPrice(product.item_code, unitCode, '1', localStorage.getItem('_userCode') || '', {
        barcode: product.barcode || ''
    });

    return {
        price: hasSalePrice(priceResult?.price) ? priceResult.price : 0,
        unit_code: unitCode,
        barcode: product.barcode || priceResult?.barcode || ''
    };
}

async function loadProductPrices(targetProducts) {
    if (!isAuthenticated.value || !Array.isArray(targetProducts) || targetProducts.length === 0) return;

    const currentToken = ++priceLoadToken;
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
    // โหมด favoriteOnly ล็อกไว้เสมอ ไม่ให้ query มาปลดออกได้
    favoriteFilterActive.value = props.favoriteOnly || route.query.favorite === '1';

    // คำค้นจาก URL (ช่องค้นหาบนแถบหัวเขียน ?q= มาให้) — เข้าเส้นทาง debounce เดิมผ่าน watch(searchQuery)
    if (typeof route.query.q === 'string' && route.query.q !== searchQuery.value) {
        searchQuery.value = route.query.q;
    }

    if (localStorage.getItem('_isstock') === null) {
        localStorage.setItem('_isstock', '0');
    }

    // โหลดข้อมูลสินค้าทันที
    loadProducts();

    // ตั้งค่า Intersection Observer หลังจากโหลดข้อมูลเสร็จ
    nextTick(() => {
        setupInfiniteScroll();
    });

    // เพิ่ม event listener สำหรับการเลื่อน
    window.addEventListener('scroll', checkScrollPosition);
    window.addEventListener('resize', updateCompactCategoryScroll);
    nextTick(() => {
        updateCompactCategoryScroll();
    });
});

onUnmounted(() => {
    // ทำความสะอาด observer เมื่อออกจากหน้า
    if (observer) {
        observer.disconnect();
    }

    // ลบ event listener เมื่อออกจากหน้า
    window.removeEventListener('scroll', checkScrollPosition);
    window.removeEventListener('resize', updateCompactCategoryScroll);
});

// ตั้งค่า Intersection Observer สำหรับการโหลดข้อมูลแบบ Infinite Scroll
let observer;
function setupInfiniteScroll() {
    // สร้าง IntersectionObserver ใหม่
    observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting && !isLoadingMore.value && hasMoreItems.value && !initialLoading.value) {
                loadMoreProducts();
            }
        },
        { threshold: 0.1, rootMargin: '100px' }
    );

    // เริ่มสังเกต element เมื่อมีการสร้าง element แล้ว
    setTimeout(() => {
        if (observerTarget.value) {
            observer.observe(observerTarget.value);
        } else {
            console.warn('Observer target not found');
        }
    }, 500);
}

// ฟังก์ชันตรวจสอบตำแหน่งการเลื่อน
function checkScrollPosition() {
    // แสดงปุ่มเมื่อเลื่อนลงมากกว่า 300px
    showScrollTop.value = window.scrollY > 300;
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
    loadingProducts.value = true;
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
            updateCompactCategoryScroll();
            if (observer) {
                observer.disconnect();
            }
            setupInfiniteScroll();
        });
    } catch (error) {
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
        if (pinShellAfterReload) {
            pinShellAfterReload = false;
            nextTick(scrollToProductListShell);
        }
        loadingProducts.value = false;
        isSearching.value = false; // รีเซ็ตสถานะการค้นหา เมื่อโหลดเสร็จ
    }
}

// โหลดข้อมูลสินค้าเพิ่มเติม (สำหรับ infinite scroll)
async function loadMoreProducts() {
    if (isLoadingMore.value || !hasMoreItems.value) return;

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

        // เพิ่มข้อมูลลงในอาร์เรย์ products เดิม
        products.value = [...products.value, ...result.data];
        pagination.value.page = nextPage;
        loadProductPrices(result.data);

        // ตรวจสอบว่ายังมีข้อมูลให้โหลดต่อหรือไม่
        hasMoreItems.value = result.data.length >= pagination.value.perPage;
    } catch (error) {
        console.error('Error loading more products:', error);
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('errors.loadMoreProducts'),
            life: 3000
        });
    } finally {
        isLoadingMore.value = false;
    }
}

// ฟังก์ชันที่เรียกจากปุ่มเพื่อโหลดข้อมูลเพิ่มเติม (กรณี infinite scroll ไม่ทำงาน)
function handleLoadMore() {
    if (!isLoadingMore.value && hasMoreItems.value) {
        loadMoreProducts();
    }
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
        nextTick(updateCompactCategoryScroll);
        // เมื่อส่งคำขอไปแล้ว ให้ยังคงแสดงสถานะกำลังค้นหาต่อไป
        // สถานะนี้จะถูกรีเซ็ตใน loadProducts เมื่อโหลดเสร็จ
    }, 1000);
}

// กรองและเรียงลำดับสินค้า
function filterProducts() {
    // รีเซ็ตการเพจจิเนชั่น
    pagination.value.page = 0;
    hasMoreItems.value = true;

    // โหลดข้อมูลใหม่
    loadProducts();
}

// เพิ่มฟังก์ชันล้างการค้นหา
function clearSearch() {
    searchQuery.value = '';

    // ต้องลบ q ออกจาก URL ด้วย ไม่งั้น watch(route.query.q) จะเติมคำค้นกลับมาทันที
    if (route.query.q) {
        const query = { ...route.query };
        delete query.q;
        router.replace({ path: route.path, query });
    }

    filterProducts();
}

function toggleFavoriteFilter() {
    // หน้ารายการโปรดปิดตัวกรองนี้ไม่ได้ ไม่งั้นจะกลายเป็นหน้าสินค้าทั้งหมด
    if (props.favoriteOnly) return;
    favoriteFilterActive.value = !favoriteFilterActive.value;
    localStorage.setItem('_favorite', favoriteFilterActive.value ? '1' : '0');
    filterProducts();
}

function toggleInstockFilter() {
    instockFilterActive.value = !instockFilterActive.value;
    localStorage.setItem('_isstock', instockFilterActive.value ? '1' : '0');
    filterProducts();
}

// เปิด Dialog แสดงรายละเอียดสินค้า
function isSetProduct(product) {
    return String(product?.item_type || '') === '3';
}

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
    showSalePremiumDetail.value = false;
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
function handleAddedToCart() {
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
    filterProducts();
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
    product.favorite_item = product.favorite_item === '1' ? '0' : '1';

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

// คำค้นจากแถบหัว: AppTopbar debounce 1.5 วินาทีก่อนเขียน URL มาแล้ว
// จึงโหลดทันทีเมื่อ q เปลี่ยน ไม่ debounce ซ้ำอีก 1 วินาทีจนผู้ใช้ต้องรอรวม 2.5 วินาที
let syncingSearchFromRoute = false;
watch(
    () => route.query.q,
    (q) => {
        const next = typeof q === 'string' ? q : '';
        if (next !== searchQuery.value) {
            syncingSearchFromRoute = true;
            searchQuery.value = next;
            syncingSearchFromRoute = false;
        }
    }
);

// ติดตามการเปลี่ยนแปลงของตัวกรอง
watch(
    [() => props.selectedCategory, () => route.query.favorite, () => route.query.timestamp],
    () => {
        // อัปเดตสถานะ favoriteFilterActive จาก query parameters
        // 🚨 โหมด favoriteOnly ต้องไม่ถูกเขียนทับ — หน้ารายการโปรดไม่มี ?favorite=1 ใน URL
        //    พอค้นหาแล้ว query เปลี่ยน watcher นี้จะยิงและปลดตัวกรองทิ้ง
        //    ผลคือสินค้าที่ไม่ได้กดหัวใจโผล่มาในหน้ารายการโปรด
        favoriteFilterActive.value = props.favoriteOnly || route.query.favorite === '1';
        filterProducts();
    },
    { deep: true }
);

// แยกการติดตามการเปลี่ยนแปลงของ searchQuery ออกมา และใช้ debouncedSearch
watch(compactCategoryOptions, () => nextTick(updateCompactCategoryScroll), { deep: false });

watch(
    searchQuery,
    () => {
        if (syncingSearchFromRoute) {
            if (searchTimeout) clearTimeout(searchTimeout);
            isSearching.value = true;
            filterProducts();
            nextTick(updateCompactCategoryScroll);
            return;
        }
        debouncedSearch();
    },
    { flush: 'sync' }
);

watch(isAuthenticated, (loggedIn) => {
    priceLoadToken++;
    if (loggedIn) {
        loadProductPrices(products.value);
    }
});

// ติดตามการเปลี่ยนแปลงของ products เพื่อตรวจสอบ observer
watch(
    products,
    () => {
        nextTick(() => {
            // ตรวจสอบและรีเซ็ต observer เมื่อข้อมูลเปลี่ยน
            if (observerTarget.value && !initialLoading.value) {
                if (observer) {
                    observer.disconnect();
                }
                setupInfiniteScroll();
            }
        });
    },
    { deep: false }
);

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
        <!-- ช่องค้นหา -->
        <div ref="searchStripRef" class="search-strip">
            <div class="search-strip-head">
                <div class="search-context">
                    <p class="search-title">{{ activeViewLabel }}</p>
                    <p class="search-subtitle">
                        <i v-if="isSearching" class="pi pi-spin pi-spinner"></i>
                        {{ resultLabel }}
                    </p>
                </div>
                <div class="search-actions">
                    <button v-if="!favoriteOnly" type="button" class="filter-chip favorite-chip" :class="{ active: favoriteFilterActive }" :aria-pressed="favoriteFilterActive" :aria-label="t('catalog.favoriteProducts')" @click="toggleFavoriteFilter">
                        <i class="pi" :class="favoriteFilterActive ? 'pi-heart-fill' : 'pi-heart'"></i>
                        {{ t('catalog.favoriteProducts') }}
                    </button>
                    <button type="button" class="filter-chip" :class="{ active: instockFilterActive }" :aria-pressed="instockFilterActive" :aria-label="t('catalog.inStockOnly')" @click="toggleInstockFilter">
                        <i class="pi pi-check-circle"></i>
                        {{ t('catalog.inStockOnly') }}
                    </button>
                </div>
            </div>
            <!-- ช่องค้นหาย้ายขึ้นไปอยู่บนแถบหัวแล้ว (ค้นได้จากทุกหน้า)
                 แต่ searchQuery / debounce / isSearching ยังอยู่ครบใน <script>
                 เพราะรับคำค้นจาก ?q= ใน URL ผ่าน watch — ห้ามลบ state พวกนั้น
                 ป้ายคำค้นปัจจุบันแสดงเป็นชิปด้านล่างให้กดล้างได้ -->
            <div v-if="searchQuery" class="active-search-chip">
                <i class="pi pi-search"></i>
                <span>{{ searchQuery }}</span>
                <button type="button" :aria-label="t('common.clearSearch')" @click="clearSearch">
                    <i class="pi pi-times"></i>
                </button>
            </div>
            <div v-if="compactCategoryOptions.length && !favoriteOnly" class="compact-category-scroller">
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

        <!-- เนื้อหาหลัก -->
        <main class="pb-6">
            <!-- Skeleton Loading -->
            <div v-if="initialLoading" class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
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
            <div v-else-if="products && products.length > 0" class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
                <!-- ส่วนแสดงสินค้า -->
                <ProductCard
                    v-for="product in products"
                    :key="`${product.item_type || '0'}:${product.item_code}`"
                    class="catalog-card"
                    :name="getProductDisplayName(product)"
                    :image="product.image"
                    :fallback-image="product.imageFallback"
                    :aria-label="`${t('productDetail.viewMoreDetails')} ${getProductDisplayName(product)}`"
                    @select="viewProductDetail(product)"
                >
                    <template #badges>
                        <Tag v-if="isSalePremiumProduct(product)" value="ของแถม" severity="danger" icon="pi pi-gift" class="sale-premium-tag" />
                        <Tag v-if="product.is_promotion === '1' && !isSalePremiumProduct(product)" value="PROMOTION" class="promotion-tag" />
                        <Tag v-if="shouldShowPreorderBadge(product)" :value="t('productDetail.preorderLabel')" class="inventory-tag is-preorder" />
                        <Tag v-if="shouldShowOutOfStockBadge(product)" :value="getInventoryLabel(product.sold_out)" class="inventory-tag is-out" />
                    </template>

                    <template #media>
                        <!-- ไอคอน "คืนสินค้าได้" ทับที่มุมล่างซ้ายของรูป
                             เดิมอยู่ในแถวราคาและสูง 3.8rem ทำให้แถวราคาสูงไม่เท่ากันระหว่างการ์ด
                             ที่มีกับไม่มีไอคอน (การ์ดในแถวเดียวกันจึงสูงไม่เท่ากัน) -->
                        <img v-if="product.is_return === '1'" :src="returnIcon" :alt="t('productDetail.returnAlt')" class="product-return-icon" />

                        <!-- ปุ่มรายการโปรด — @click.stop กันไม่ให้ไปเปิด dialog ของการ์ด -->
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
                    </template>

                    <!-- หมวดหมู่ (ซ่อนเมื่อไม่มีข้อมูล — API ของหน้า list ไม่ส่ง category มา) -->
                    <template v-if="getProductCategoryDisplay(product)" #eyebrow>
                        <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            {{ getProductCategoryDisplay(product) }}
                        </div>
                    </template>
                    <!-- ราคาอยู่ใน slot เพราะมี 4 สถานะเฉพาะของหน้านี้
                         (กำลังโหลด / มีราคา / หาราคาไม่เจอ / รอราคา) และ formatPrice ของหน้านี้รับ price ไม่ใช่ product -->
                    <template v-if="isAuthenticated" #price>
                        <div class="shop-card-price-row product-price-row">
                            <Skeleton v-if="product._priceLoading" width="90px" height="18px" />
                            <template v-else-if="formatPrice(product.price)">
                                <span class="shop-card-price product-price">฿{{ formatPrice(product.price) }}</span>
                                <span class="shop-card-unit product-price-unit">/ {{ isSalePremiumProduct(product) ? 'ชุด' : product.price_unit_code || getProductSaleUnit(product) }}</span>
                            </template>
                            <span v-else-if="product._priceError" class="product-price-muted">{{ t('catalog.priceNotFound') }}</span>
                            <span v-else class="product-price-muted">{{ t('catalog.waitingPrice') }}</span>
                        </div>
                    </template>
                </ProductCard>
            </div>

            <!-- สถานะว่าง (ไม่พบสินค้า) -->
            <div v-else-if="!loadingProducts && !initialLoading && products && products.length === 0" class="flex justify-center p-8">
                <div class="empty-state-box rounded-lg p-6 w-full max-w-md">
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

        <SalePremiumDetailDialog
            :visible="showSalePremiumDetail"
            :sale-premium-code="selectedSalePremiumCode"
            @update:visible="showSalePremiumDetail = $event"
            @added-to-cart="handleAddedToCart"
        />
    </div>
</template>

<style scoped>
.product-list-shell {
    --product-search-sticky-top: var(--app-header-total-h);
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
    /* พื้นขาวล้วน — เดิมผสมสีแถบหัวเข้ามา 8% ทำให้เป็นเขียวจางๆ ที่กลืนกับชิปจนอ่านไม่ออก */
    background: #ffffff;
    box-shadow: var(--shop-shadow-3);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
}



/* ชิปแสดงคำค้นปัจจุบัน — มาแทนช่องค้นหาที่ย้ายขึ้นแถบหัวไปแล้ว */
.active-search-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    max-width: 100%;
    padding: 0.3rem 0.4rem 0.3rem 0.7rem;
    border-radius: var(--shop-radius-pill);
    background: var(--market-primary-soft);
    border: 1px solid color-mix(in srgb, var(--market-primary) 28%, transparent);
    color: var(--market-primary);
    font-size: 0.85rem;
    font-weight: 700;
}

.active-search-chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.active-search-chip button {
    flex: 0 0 auto;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0.15rem;
    line-height: 1;
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
    border: 1px solid var(--shop-border);
    background: #ffffff;
    color: var(--market-text);
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
    /* เดิม hardcode สีครีม #6f5c33 / #fbf0d9 ค้างจากธีมเก่า ไม่เปลี่ยนตามที่แอดมินตั้ง */
    border-color: var(--market-primary);
    color: color-mix(in srgb, var(--market-primary) 78%, #000000);
    background: color-mix(in srgb, var(--market-primary) 12%, #ffffff);
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
    color: var(--market-text);
    max-width: min(42rem, 58vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.search-subtitle {
    margin: 0;
    font-size: 0.78rem;
    color: var(--market-muted);
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

/* 🚨 เดิมใช้ color: var(--market-header-text) ซึ่งเป็น "สีข้อความของแถบหัว" = ขาว
 *    พอเอามาใช้บนชิปพื้นอ่อน กลายเป็นขาวบนขาว มองไม่เห็นตัวหนังสือเลย
 *    (สมัยธีมครีม ค่านี้เป็นน้ำตาลเข้มจึงบังเอิญอ่านออก พอ P3 เปลี่ยนหัวเป็นเขียวทึบก็พังทันที)
 *    บทเรียนเดียวกับชื่อร้านบนแถบหัว — โทเคนของแถบหัวห้ามเอามาใช้บนพื้นผิวสีอ่อน */
.compact-category-chip {
    border: 1px solid var(--shop-border);
    background: #ffffff;
    color: var(--market-text);
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
    /* ผสมดำ 18% ลงในสีหลัก — ขาวบน #0F9F6E ตรงๆ ได้ contrast แค่ 3.38 (เกณฑ์ 4.5)
       ผสมแล้วเข้มพอให้ตัวอักษรขาวอ่านออกจริง โดยยังเป็นสีแบรนด์เดียวกัน */
    border-color: color-mix(in srgb, var(--market-primary, #0f9f6e) 82%, #000000);
    background: color-mix(in srgb, var(--market-primary, #0f9f6e) 82%, #000000);
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

:deep(.inventory-tag.p-tag),
:deep(.promotion-tag.p-tag) {
    font-size: 0.63rem !important;
    font-weight: 700 !important;
    letter-spacing: 0.02em !important;
    border: 1px solid transparent !important;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(1px);
}

:deep(.sale-premium-tag.p-tag) {
    background: #fce7f3 !important;
    color: #be185d !important;
    border-color: #f9a8d4 !important;
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

/* พื้น/ขอบ/เงา/hover มาจาก .shop-card (assets/shop-card.scss) แล้ว
   ที่นี่เหลือเฉพาะสิ่งที่เป็นของกริดหน้านี้จริงๆ */
.catalog-card {
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
    box-shadow: var(--shop-shadow-2);
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

/* พื้นหลังกล่องรูป/เนื้อหา — ต้องใช้ :deep เพราะ markup อยู่ใน ProductCard แล้ว */
.catalog-card :deep(.shop-card-media) {
    background: var(--market-product-image-bg, var(--shop-surface));
}

.catalog-card :deep(.shop-card-body) {
    background: var(--market-card-bg, #ffffff);
}





/* วางทับมุมล่างซ้ายของรูป ไม่กินพื้นที่ในแถวราคาอีกต่อไป */
.product-return-icon {
    position: absolute;
    left: 0.4rem;
    bottom: 0.4rem;
    z-index: 2;
    width: 2.2rem;
    height: 2.2rem;
    object-fit: contain;
}



.product-price-unit,
.product-price-muted {
    color: var(--market-muted);
    font-size: 0.78rem;
}

.empty-state-box {
    border: 1px solid var(--market-card-border, #efe1c4);
    background: var(--market-card-bg, #ffffff);
    box-shadow: var(--shop-shadow-2);
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
    /* ยกให้พ้นแถบเมนูล่างบนมือถือ (บนเดสก์ท็อป --app-bottomnav-h = 0 จึงกลับเป็น 20px เท่าเดิม) */
    bottom: calc(var(--app-bottomnav-h) + var(--app-safe-bottom) + 20px);
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
        right: 18px;
    }
}

@media (max-width: 480px) {
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
</style>
