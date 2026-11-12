<script setup>
import { computed, onActivated, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRouter, useRoute } from 'vue-router';
import { useToast } from 'primevue/usetoast';

import SalePremiumProducts from '@/components/catalog/SalePremiumProducts.vue';
import CategorySelection from '@/components/catalog/CategorySelection.vue';
import PromotionProducts from '@/components/catalog/PromotionProducts.vue';
import ProductList from '@/components/catalog/ProductList.vue';
import RecommendedProducts from '@/components/catalog/RecommendedProducts.vue';
import { useAuthenStore } from '@/stores/authen';
import CategoryService from '@/services/CategoryService';
import { useLanguageStore } from '@/stores/languageStore';
import { pickMasterName } from '@/utils/languageDisplay';

const mobileQuery = window.matchMedia('(max-width: 900px)');
const mobile = ref(mobileQuery.matches);
const onLayoutChange = event => { mobile.value = event.matches; };
onMounted(() => mobileQuery.addEventListener('change', onLayoutChange));
onBeforeUnmount(() => mobileQuery.removeEventListener('change', onLayoutChange));
const route = useRoute();
const router = useRouter();
const auth = useAuthenStore();
let catalogScroll = null;
onBeforeRouteLeave(to => {
    if (['cart', 'basket'].includes(to.name)) catalogScroll = { y: window.scrollY, customer: auth.userCode };
});
onActivated(async () => {
    if (catalogScroll === null) return;
    const saved = catalogScroll;
    catalogScroll = null;
    await nextTick();
    // Restore after the sticky toolbar has measured the reactivated catalog.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (route.name === 'catalog' && saved.customer === auth.userCode) {
            window.scrollTo({ top: saved.y, behavior: 'instant' });
        }
    }));
});
const languageStore = useLanguageStore();
const toast = useToast();
const categoriesLoading = ref(true);
const selectedCategory = ref(getRouteCategory());
const categoryOptions = ref([]);
const catalogProducts = ref(null);
const viewingPromoResults = computed(() => route.hash === '#catalog-products' && selectedCategory.value === 'promotions');
const showMobileShelves = computed(() => mobile.value && !viewingPromoResults.value);
const recommendationsReady = ref(false);
const promotionsReady = ref(false);
const giftsReady = ref(false);
watch(showMobileShelves, visible => {
    if (!visible) {
        recommendationsReady.value = false;
        promotionsReady.value = false;
        giftsReady.value = false;
    }
});
const specialCategoryCodes = new Set(['all', 'promotions', 'productset']);
const selectedCategoryName = computed(() => {
    if (route.query.favorite === '1') return '';
    if (specialCategoryCodes.has(selectedCategory.value)) return '';
    const category = categoryOptions.value.find((item) => item.code === selectedCategory.value);
    return category ? pickMasterName(category, languageStore.locale) || category.display_name || category.name || '' : '';
});

function getRouteCategory() {
    if (route.query.promo === '1') return 'promotions';
    return route.query.category || 'all';
}

function handleSelectCategory(categoryCode) {
    selectedCategory.value = categoryCode;
    const query = { ...route.query };
    delete query.promo;
    if (categoryCode === 'all') delete query.category;
    else query.category = categoryCode;
    router.replace({ path: route.path, query, hash: categoryCode === 'promotions' ? '#catalog-products' : '' });
}

async function loadCategoryOptions() {
    try {
        const response = await CategoryService.getCategories();
        categoryOptions.value = response?.data || [];
    } catch (error) {
        toast.add({ severity: 'error', summary: languageStore.t('common.error'), detail: languageStore.t('errors.loadCategories'), life: 5000 });
    } finally {
        categoriesLoading.value = false;
    }
}

onMounted(() => {
    loadCategoryOptions();
    if (viewingPromoResults.value) nextTick(() => catalogProducts.value?.scrollIntoView({ block: 'start' }));
});

watch(
    [() => route.query.category, () => route.query.promo],
    () => {
        if (route.name === 'catalog') selectedCategory.value = getRouteCategory();
    }
);
</script>

<template>
    <div class="catalog-page min-h-screen">
        <Toast />
        <div class="catalog-canvas">

            <section v-if="!mobile" class="catalog-categories">
                <CategorySelection :categories="categoryOptions" :loading="categoriesLoading" :selectedCategory="selectedCategory" @select-category="handleSelectCategory" />
            </section>
            <div v-if="!mobile && !viewingPromoResults" class="catalog-shelves">
                <RecommendedProducts :key="auth.userCode" />
                <PromotionProducts />
                <SalePremiumProducts :key="'gift-' + auth.userCode" @ready="giftsReady = true" />
            </div>

            <section id="catalog-products" ref="catalogProducts" class="catalog-products">
                <ProductList :mobile="mobile" :selectedCategory="selectedCategory" :selected-category-name="selectedCategoryName" :categories="categoryOptions" :discovery-ready="!showMobileShelves || (recommendationsReady && promotionsReady && giftsReady)" @select-category="handleSelectCategory">
                    <template v-if="showMobileShelves" #discovery>
                        <RecommendedProducts :key="auth.userCode" @ready="recommendationsReady = true" />
                        <PromotionProducts @ready="promotionsReady = true" />
                        <SalePremiumProducts :key="'gift-' + auth.userCode" @ready="giftsReady = true" />
                    </template>
                </ProductList>
            </section>
        </div>
    </div>
</template>

<style scoped>
.catalog-page {
    overflow-anchor: none;
    --catalog-surface: var(--market-card-bg, #ffffff);
    --catalog-surface-soft: #fdf7ea;
    --catalog-border: var(--market-card-border, #efe3c8);
    --catalog-shadow: 0 4px 12px rgba(140, 111, 53, 0.1);
    --catalog-shadow-soft: 0 3px 8px rgba(140, 111, 53, 0.07);
    --catalog-text: #5b4a27;
    --catalog-text-muted: #9b8a67;
    --catalog-primary: var(--market-primary, #d6b36a);
    --catalog-radius-lg: 0.9rem;
    --catalog-radius-md: 0.75rem;
    --catalog-gap: 0.75rem;
    padding: 1rem 0.875rem 1.25rem;
}

.catalog-canvas {
    width: min(1280px, 100%);
    margin: 0 auto;
}

.catalog-intro {
    padding: 0.35rem 0.25rem 0.75rem;
    animation: fadeSlideIn 280ms ease;
}

.intro-kicker {
    margin: 0;
    font-size: 0.73rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #d6b36a;
}

.intro-title {
    margin: 0.2rem 0 0.1rem;
    font-size: 1.45rem;
    line-height: 1.2;
    color: var(--catalog-text);
}

.intro-subtitle {
    margin: 0;
    color: var(--catalog-text-muted);
    font-size: 0.9rem;
}

.catalog-products {
    border-radius: var(--catalog-radius-lg);
    background: transparent;
    animation: fadeSlideIn 320ms ease;
}

.catalog-shelves {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.2rem;
}
.catalog-shelves:not(:empty) {
    margin-top: var(--catalog-gap);
}

.catalog-products {
    margin-top: var(--catalog-gap);
    scroll-margin-top: 7.2rem;
}

@media (min-width: 901px) {
    .catalog-products { scroll-margin-top: var(--market-header-height, 4rem); }
}

@keyframes fadeSlideIn {
    from {
        opacity: 0;
        transform: translateY(6px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@media (max-width: 1024px) {
    .catalog-canvas {
        width: min(980px, 100%);
    }
}

@media (max-width: 900px) {
    .catalog-canvas {
        display: flex;
        flex-direction: column;
    }

    .catalog-products {
        order: -1;
        margin-top: 0;
        min-width: 0;
    }

    /* The mobile search toolbar already includes the category selector. */
    .catalog-categories {
        display: none;
    }
}

@media (max-width: 768px) {
    .catalog-page {
        padding: 0.45rem 0.45rem 0.8rem;
    }

    .intro-title {
        font-size: 1.22rem;
    }
}

@media (max-width: 480px) {
    .catalog-page {
        padding: 0.35rem 0.35rem 0.6rem;
    }

    .intro-subtitle {
        font-size: 0.82rem;
    }
}

@media (prefers-reduced-motion: reduce) {
    .catalog-intro,
    .catalog-products {
        animation: none !important;
    }
}
</style>
