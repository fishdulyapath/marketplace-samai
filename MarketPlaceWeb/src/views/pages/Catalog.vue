<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import CategorySelection from '@/components/catalog/CategorySelection.vue';
import PromotionProducts from '@/components/catalog/PromotionProducts.vue';
import SalePremiumProducts from '@/components/catalog/SalePremiumProducts.vue';
import ProductList from '@/components/catalog/ProductList.vue';
import RecommendedProducts from '@/components/catalog/RecommendedProducts.vue';
import CategoryService from '@/services/CategoryService';
import { useLanguageStore } from '@/stores/languageStore';
import { pickMasterName } from '@/utils/languageDisplay';

const route = useRoute();
const languageStore = useLanguageStore();
const selectedCategory = ref(getRouteCategory());
const categoryOptions = ref([]);
const specialCategoryCodes = new Set(['all', 'promotions', 'productset']);
const hasSearchQuery = computed(() => {
    const query = Array.isArray(route.query.q) ? route.query.q[0] : route.query.q;
    return typeof query === 'string' && query.trim().length > 0;
});
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
}

async function loadCategoryOptions() {
    try {
        const response = await CategoryService.getCategories();
        categoryOptions.value = response?.data || [];
    } catch (error) {
        console.error('Error loading category names:', error);
    }
}

onMounted(() => {
    loadCategoryOptions();
});

watch(
    () => [route.query.category, route.query.promo, languageStore.locale],
    () => {
        selectedCategory.value = getRouteCategory();
    }
);
</script>

<template>
    <div class="catalog-page min-h-screen">
        <!-- ไม่มี <section> ห่อแต่ละกล่องแล้ว — ให้ component เป็นลูกตรงของ flex canvas
             เพราะกล่องที่ไม่มีสินค้าจะไม่ render root ของตัวเอง ถ้ายังมี wrapper ครอบอยู่
             จะเหลือ margin/gap ค้างเป็นช่องว่างลอย (Toast กลางอยู่ที่ AppLayout แล้ว) -->
        <div class="catalog-canvas">
            <CategorySelection v-if="!hasSearchQuery" :selectedCategory="selectedCategory" @select-category="handleSelectCategory" />

            <RecommendedProducts v-if="!hasSearchQuery" />

            <PromotionProducts v-if="!hasSearchQuery" />

            <SalePremiumProducts v-if="!hasSearchQuery" />

            <ProductList :selectedCategory="selectedCategory" :selected-category-name="selectedCategoryName" :categories="categoryOptions" @select-category="handleSelectCategory" />
        </div>
    </div>
</template>

<style scoped>
/* ตัวแปร --catalog-* เดิมฝังโทนครีม-ทองไว้ตายตัว (#fffefb / #d6b36a / #5b4a27)
   ทำให้เปลี่ยนธีมในหน้าแอดมินแล้วหน้าแคตตาล็อกไม่เปลี่ยนตาม — ตอนนี้ map เข้าโทเคนกลางหมด */
.catalog-page {
    --catalog-bg: var(--shop-page-bg);
    --catalog-surface: var(--shop-surface);
    --catalog-surface-soft: var(--shop-surface-sunken);
    --catalog-border: var(--shop-border);
    --catalog-shadow: var(--shop-shadow-2);
    --catalog-shadow-soft: var(--shop-shadow-1);
    --catalog-text: var(--market-text);
    --catalog-text-muted: var(--market-muted);
    --catalog-primary: var(--market-primary);
    --catalog-radius-lg: 0.9rem;
    --catalog-radius-md: 0.75rem;
    --catalog-gap: clamp(0.5rem, 1.5vw, 0.9rem);
    /* พื้นหลังเรียบแทน gradient 3 สต็อป — สไตล์แอปช้อปปิ้งใช้พื้นเทาอ่อนตัวเดียวให้การ์ดขาวเด่น */
    background: var(--shop-page-bg);
    /* clamp แทน media query 3 ชั้น (1024/768/480): ระยะขอบไล่ต่อเนื่องตามความกว้างจริง
       ไม่กระโดดที่เส้นแบ่ง และไม่มีช่วงจอที่ตกไปใช้ค่าของอีกชั้นโดยไม่ตั้งใจ */
    padding: clamp(0.35rem, 1.1vw, 1rem) clamp(0.35rem, 0.9vw, 0.875rem) clamp(0.6rem, 1.3vw, 1.25rem);
}

.catalog-canvas {
    width: min(1280px, 100%);
    margin: 0 auto;
    /* flex + gap แทน margin-top ของ wrapper แต่ละกล่อง:
       กล่องที่ซ่อนตัวเองจะหลุดจาก flow ทั้งหมด gap จึงหายตามไปด้วย ไม่เหลือช่องว่างค้าง */
    display: flex;
    flex-direction: column;
    gap: var(--catalog-gap);
}

/* fade ด้วย opacity อย่างเดียว ห้ามใช้ transform:
   ProductList มีแถบค้นหา position:sticky อยู่ข้างใน ถ้า ancestor มี transform
   จะกลายเป็น containing block ทำให้ sticky offset เพี้ยนตามระยะ translate */
.catalog-canvas > * {
    animation: fadeIn 280ms ease;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
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
    color: var(--market-primary);
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

@media (max-width: 768px) {
    .intro-title {
        font-size: 1.22rem;
    }
}

@media (max-width: 480px) {
    .intro-subtitle {
        font-size: 0.82rem;
    }
}

@media (prefers-reduced-motion: reduce) {
    .catalog-intro,
    .catalog-canvas > * {
        animation: none !important;
    }
}
</style>
