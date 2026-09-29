<script setup>
import ProductCard from '@/components/product/ProductCard.vue';
import ProductService from '@/services/ProductService';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName } from '@/utils/languageDisplay';
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductFullDetailDialog from '@/views/pages/ProductFullDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import ProgressSpinner from 'primevue/progressspinner';
import Skeleton from 'primevue/skeleton';
import { useToast } from 'primevue/usetoast';
import { onBeforeUnmount, onMounted, ref } from 'vue';

const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;

function getProductDisplayName(product) {
    return pickProductName(product, languageStore.locale) || product.display_name || product.item_name || '';
}

const selectedProductCode = ref('');
const showProductDetail = ref(false);
const showProductSetDetail = ref(false);
const showProductFullDetail = ref(false);

const promotionProducts = ref([]);
const promotionPage = ref(0);
const loadingPromotion = ref(true);
const hasMorePromotion = ref(true);
const initialLoading = ref(true);
const scrollContainer = ref(null);

const autoScrollInterval = ref(null);
const autoScrollDelay = 3200;
const isHovering = ref(false);

onMounted(() => {
    loadPromotionProducts(0, true);
    setTimeout(() => { startAutoScroll(); }, 1200);
});

onBeforeUnmount(() => { stopAutoScroll(); });

function startAutoScroll() {
    if (!scrollContainer.value || isHovering.value || !hasMorePromotion.value) return;
    stopAutoScroll();
    autoScrollInterval.value = setInterval(() => {
        if (!scrollContainer.value || isHovering.value || !hasMorePromotion.value) { stopAutoScroll(); return; }
        const container = scrollContainer.value;
        const maxScrollLeft = container.scrollWidth - container.clientWidth;
        if (container.scrollLeft >= maxScrollLeft - 20) {
            container.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });
        }
        setTimeout(() => {
            if (container.scrollWidth - container.scrollLeft - container.clientWidth < 300 && hasMorePromotion.value && !loadingPromotion.value) {
                loadMorePromotion();
            }
        }, 300);
    }, autoScrollDelay);
}

function stopAutoScroll() {
    if (autoScrollInterval.value) { clearInterval(autoScrollInterval.value); autoScrollInterval.value = null; }
}
function handleMouseEnter() { isHovering.value = true; stopAutoScroll(); }
function handleMouseLeave() { isHovering.value = false; startAutoScroll(); }

async function loadPromotionProducts(page = 0, reset = false) {
    loadingPromotion.value = true;
    try {
        const result = await ProductService.getProducts({ category: '', search: '', favorite: 0, isPromotion: 1 }, page);
        if (reset) { promotionProducts.value = result.data; } else { promotionProducts.value = [...promotionProducts.value, ...result.data]; }
        promotionPage.value = page;
        hasMorePromotion.value = result.data.length >= 50;
        if (!hasMorePromotion.value) stopAutoScroll();
        initialLoading.value = false;
    } catch (error) {
        console.error('Error loading promotion products:', error);
        hasMorePromotion.value = false;
        stopAutoScroll();
        toast.add({ severity: 'error', summary: t('common.error'), detail: t('errors.loadPromotionProducts'), life: 3000 });
        initialLoading.value = false;
    } finally {
        loadingPromotion.value = false;
    }
}

function loadMorePromotion() {
    if (loadingPromotion.value || !hasMorePromotion.value) return;
    loadPromotionProducts(promotionPage.value + 1);
}

function scrollLeft() {
    scrollContainer.value?.scrollBy({ left: -scrollContainer.value.clientWidth, behavior: 'smooth' });
}
function scrollRight() {
    if (!scrollContainer.value) return;
    const container = scrollContainer.value;
    container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });
    setTimeout(() => {
        if (container.scrollWidth - container.scrollLeft - container.clientWidth < 300 && hasMorePromotion.value && !loadingPromotion.value) {
            loadMorePromotion();
        }
    }, 300);
}
function handleScroll(event) {
    const container = event.target;
    if (container.scrollWidth - container.scrollLeft - container.clientWidth < 300 && hasMorePromotion.value && !loadingPromotion.value) {
        loadMorePromotion();
    }
}

function viewProductDetail(product) {
    selectedProductCode.value = product.item_code;
    showProductFullDetail.value = false;
    if (String(product?.item_type || '') === '3') {
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
function handleAddedToCart(cartItem) {
    // toast.add({ severity: 'success', summary: 'เพิ่มสินค้าแล้ว', detail: `เพิ่ม ${cartItem.name} ลงตะกร้า จำนวน ${cartItem.qty} ${cartItem.unit}`, life: 1000 });
}
</script>

<template>
    <!-- RULE: hide-empty-section — render เฉพาะตอนโหลดครั้งแรก หรือมีข้อมูลจริง -->
    <div v-if="initialLoading || promotionProducts.length" class="promo-root">
        <section class="promo-shell">
            <!-- Header — Shopee orange gradient -->
            <div class="promo-head">
                <div class="promo-head-left">
                    <span class="promo-flash-icon"><i class="pi pi-bolt"></i></span>
                    <div>
                        <h2 class="promo-title">{{ t('landing.promoSpecial') }}</h2>
                        <p class="promo-subtitle">{{ t('landing.promoSpecialSubtitle') }}</p>
                    </div>
                </div>
                <div class="promo-head-right">
                    <button type="button" class="promo-nav-btn" :aria-label="t('landing.scrollLeft')" @click="scrollLeft">
                        <i class="pi pi-chevron-left"></i>
                    </button>
                    <button type="button" class="promo-nav-btn" :aria-label="t('landing.scrollRight')" @click="scrollRight">
                        <i class="pi pi-chevron-right"></i>
                    </button>
                </div>
            </div>

            <!-- Product strip -->
            <div class="promo-body">
                <div
                    ref="scrollContainer"
                    class="promo-track"
                    @scroll="handleScroll"
                    @mouseenter="handleMouseEnter"
                    @mouseleave="handleMouseLeave"
                >
                    <!-- Skeleton -->
                    <template v-if="initialLoading">
                        <div v-for="i in 7" :key="i" class="shop-card shop-card--rail promo-card">
                            <Skeleton height="140px" class="promo-card-img-skeleton" />
                            <div class="promo-card-body">
                                <Skeleton width="80%" height="11px" class="mb-1" />
                                <Skeleton width="50%" height="14px" />
                            </div>
                        </div>
                    </template>

                    <!-- Products -->
                    <template v-else>
                        <!-- เดิมเป็น <div @click> เปล่าๆ ไม่มี role/tabindex — กดด้วยคีย์บอร์ดไม่ได้เลย
                             ย้ายมาใช้ ProductCard จึงได้ปุ่มที่โฟกัสและกด Enter/Space ได้ตามมาตรฐาน -->
                        <ProductCard
                            v-for="product in promotionProducts"
                            :key="product.item_code"
                            variant="rail"
                            class="promo-card"
                            :name="getProductDisplayName(product)"
                            :image="product.image"
                            :fallback-image="product.imageFallback"
                            :aria-label="`${t('productDetail.viewMoreDetails')} ${getProductDisplayName(product)}`"
                            @select="viewProductDetail(product)"
                        >
                            <template #badges>
                                <span class="promo-badge">{{ t('landing.promoBadge') }}</span>
                            </template>
                        </ProductCard>

                        <div v-if="loadingPromotion && promotionProducts.length > 0" class="promo-loading">
                            <ProgressSpinner style="width: 28px; height: 28px" />
                        </div>
                    </template>
                </div>
            </div>
        </section>

        <ProductDetailDialog
            :visible="showProductDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductDetail = $event"
            @added-to-cart="handleAddedToCart"
            @show-full-detail="openFullProductDetail"
        />

        <ProductSetDialog
            :visible="showProductSetDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductSetDetail = $event"
            @added-to-cart="handleAddedToCart"
            @show-full-detail="openFullProductDetail"
        />

        <ProductFullDetailDialog
            :visible="showProductFullDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductFullDetail = $event"
            @added-to-cart="handleAddedToCart"
        />
    </div>
</template>

<style scoped>
/* ── Root ── */
.promo-shell {
    border-radius: 10px;
    overflow: hidden;
    background: var(--market-card-bg, #fff);
    border: 1px solid var(--market-card-border, #e8dcc4);
    box-shadow: var(--shop-shadow-1);
}

/* ── Header ── */
.promo-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.8rem 0.9rem;
    background: linear-gradient(180deg, color-mix(in srgb, var(--market-card-bg, #fff) 94%, var(--market-accent, #f97316)) 0%, var(--market-card-bg, #fff) 100%);
    border-bottom: 1px solid var(--market-card-border, #efe3c8);
}

.promo-head-left {
    display: flex;
    align-items: center;
    gap: 0.6rem;
}

.promo-flash-icon {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--market-accent-soft, #fff1e8);
    color: var(--market-accent, #f97316);
    font-size: 0.9rem;
    flex: 0 0 auto;
}

.promo-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 800;
    color: var(--market-text, #2f2412);
}

.promo-subtitle {
    margin: 0.15rem 0 0;
    font-size: 0.74rem;
    color: var(--market-muted, #8a6f37);
}

.promo-head-right {
    display: flex;
    gap: 6px;
}

.promo-nav-btn {
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--market-accent, #f97316) 35%, var(--market-card-border, #efe3c8));
    background: var(--market-card-bg, #fff);
    color: var(--market-accent, #f97316);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    cursor: pointer;
    transition: background 0.14s, color 0.14s, transform 0.14s;
    outline: none;
}
.promo-nav-btn:hover {
    background: var(--market-accent, #f97316);
    color: #fff;
    transform: translateY(-1px);
}

/* ── Product strip ── */
.promo-body {
    background: color-mix(in srgb, var(--market-accent, #f97316) 5%, var(--market-card-bg, #fff));
    padding: 12px 0;
}

.promo-track {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    scroll-behavior: smooth;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding: 0 1rem;
}
.promo-track::-webkit-scrollbar { display: none; }

/* ── Card ── */
.promo-card {
    flex-shrink: 0;
    /* ความกว้างมาจาก .shop-card--rail (โทเคน --shop-rail-card-w) */
    background: var(--market-card-bg, #fff);
    border-radius: 7px;
    overflow: hidden;
    cursor: pointer;
    border: 1px solid var(--market-card-border, #f0e0dc);
    transition: transform 0.18s, box-shadow 0.18s;
    position: relative;
}
.promo-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--market-accent, #f97316) 36%, var(--market-card-border, #efe3c8));
    box-shadow: var(--shop-shadow-3);
}

/* กรอบรูป/ชื่อสินค้า มาจาก ProductCard + shop-card.scss แล้ว
   เหลือแค่ที่ทำให้การ์ดโปรโมชันต่างจากการ์ดปกติ */

/* ป้ายอยู่ใน .shop-card-badges ที่จัดตำแหน่ง absolute ให้แล้ว จึงไม่ต้องจัดเอง */
.promo-badge {
    background: var(--market-accent, #f97316);
    color: #fff;
    font-size: 0.6rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.04em;
}

/* ชื่อสินค้าบนการ์ดโปรฯ หนากว่าการ์ดปกติเล็กน้อยเพื่อให้แถวนี้เด่นขึ้น */
.promo-card :deep(.shop-card-name) {
    font-size: 0.82rem;
    font-weight: 700;
}

/* .promo-card-body ยังใช้อยู่ในโครง skeleton ตอนโหลด */
.promo-card-body {
    padding: 0.55rem 0.65rem 0.7rem;
}

/* Loading spinner */
.promo-loading {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 60px;
}

/* Mobile */
@media (max-width: 640px) {
    .promo-title { font-size: 0.9rem; }
    /* ความกว้าง/สัดส่วนรูปปรับตาม clamp + aspect-ratio ในโทเคนแล้ว ไม่ต้อง override ต่อจอ */
}

@media (prefers-reduced-motion: reduce) {
    .promo-card { transition: none !important; }
}
</style>
