<script setup>
import CategoryService from '@/services/CategoryService';
import MediaService from '@/services/MediaService';
import { useLanguageStore } from '@/stores/languageStore';
import { pickMasterName } from '@/utils/languageDisplay';
import Skeleton from 'primevue/skeleton';
import { useToast } from 'primevue/usetoast';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
    selectedCategory: {
        type: String,
        default: 'all'
    }
});

const emit = defineEmits(['select-category']);

const categories = ref([]);
const loading = ref(true);
const toast = useToast();
const languageStore = useLanguageStore();
const t = (key, params) => languageStore.t(key, params);

// เดิมมี 2 ชุดแยกกัน (เดสก์ท็อปวงกลม 2 แถว / มือถือเป็นชิปยาว) ทำให้ต้องแก้ทุกอย่าง 2 ที่
// ตอนนี้เหลือชุดเดียว: วงกลมเลื่อนแนวนอน ใช้ทั้งสองขนาดจอ ต่างกันแค่ขนาดวงกลมที่ยืดด้วย clamp
const trackRef = ref(null);
const itemRefs = ref({});
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

// หมวดที่รูปโหลดไม่สำเร็จ — เก็บเป็น state แทนการไปแก้ style ของ <img> ตรงๆ
// (วิธีเดิมใช้ e.target.style.display='none' ซึ่งพอ Vue re-render จะคืนค่ากลับมาแล้วรูปพังโชว์อีก)
const brokenImages = ref({});

const palette = ['#ee4d2d', '#f57224', '#0db14b', '#1890ff', '#722ed1', '#eb2f96', '#faad14', '#13c2c2', '#52c41a', '#2f54eb', '#fa541c', '#a0d911'];

const specialMap = {
    all: { bg: '#fff0eb', color: '#ee4d2d' },
    promotions: { bg: '#fff0eb', color: '#ee4d2d' },
    productset: { bg: '#e6f7ff', color: '#1890ff' }
};

function getCatColor(cat, index) {
    if (specialMap[cat.code]) return specialMap[cat.code].color;
    return palette[(index ?? 0) % palette.length];
}

function getCatBg(cat, index) {
    if (specialMap[cat.code]) return specialMap[cat.code].bg;
    return palette[(index ?? 0) % palette.length] + '18';
}

function updateScroll() {
    const el = trackRef.value;
    if (!el) return;
    canScrollLeft.value = el.scrollLeft > 4;
    canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}

function scrollTrack(dir) {
    const el = trackRef.value;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, Math.floor(el.clientWidth * 0.7)), behavior: 'smooth' });
}

function setItemRef(el, code) {
    if (el) itemRefs.value[code] = el;
}

function scrollToActive() {
    const item = itemRefs.value[props.selectedCategory];
    if (item && trackRef.value) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

function resolveCategoryImage(cat) {
    if (brokenImages.value[cat?.code]) return '';
    const url = String(cat?.imageUrl || cat?.image_url || '').trim();
    return MediaService.resolveUrl(url);
}

function handleImageError(cat) {
    brokenImages.value = { ...brokenImages.value, [cat.code]: true };
}

function getCategoryName(cat) {
    const specialCategoryKeys = {
        all: 'catalog.allProducts',
        promotions: 'catalog.promotion',
        productset: 'catalog.productSet'
    };
    return specialCategoryKeys[cat?.code] ? t(specialCategoryKeys[cat.code]) : pickMasterName(cat, languageStore.locale) || cat?.display_name || cat?.name || '';
}

// ไม่มีรูป → ใช้อักษรแรกของชื่อหมวดแทนวงกลมเปล่าที่ดูเหมือนรูปโหลดไม่ขึ้น
// ถ้าชื่อขึ้นต้นด้วยตัวเลข/สัญลักษณ์ ให้ใช้ไอคอนป้ายแทน
function getCategoryInitial(cat) {
    const name = getCategoryName(cat).trim();
    if (!name) return '';
    const first = [...name][0];
    return /[\p{L}]/u.test(first) ? first.toUpperCase() : '';
}

function handleResize() {
    updateScroll();
}

onMounted(async () => {
    try {
        const response = await CategoryService.getCategories();
        categories.value = response.data;
        loading.value = false;
        nextTick(() => {
            updateScroll();
            scrollToActive();
        });
    } catch (error) {
        console.error('Error loading categories:', error);
        loading.value = false;
        toast.add({ severity: 'error', summary: t('common.error'), detail: error.message || t('errors.loadCategories'), life: 5000 });
    }
    window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize);
});

watch(
    () => props.selectedCategory,
    () => nextTick(() => scrollToActive())
);

function selectCategory(code) {
    emit('select-category', code);
}
</script>

<template>
    <!-- RULE: hide-empty-section — หมวดหมู่โหลดครั้งเดียวใน onMounted จึงใช้ loading ได้ -->
    <div v-if="loading || categories.length" class="cat-root">
        <div v-if="loading" class="cat-track">
            <div v-for="i in 10" :key="i" class="cat-item">
                <Skeleton shape="circle" class="cat-skeleton-circle" />
                <Skeleton width="52px" height="10px" class="mt-1" />
            </div>
        </div>

        <div v-else class="cat-wrap">
            <button v-if="canScrollLeft" type="button" class="cat-arrow cat-arrow--left" :aria-label="t('landing.scrollLeft')" @click="scrollTrack(-1)">
                <i class="pi pi-chevron-left"></i>
            </button>

            <div ref="trackRef" class="cat-track" @scroll="updateScroll">
                <button
                    v-for="(cat, i) in categories"
                    :key="cat.code"
                    :ref="(el) => setItemRef(el, cat.code)"
                    type="button"
                    :class="['cat-item', selectedCategory === cat.code ? 'is-active' : '']"
                    :aria-pressed="selectedCategory === cat.code"
                    :aria-label="`${t('common.select')} ${getCategoryName(cat)}`"
                    @click="selectCategory(cat.code)"
                >
                    <span class="cat-circle" :style="{ background: getCatBg(cat, i), color: getCatColor(cat, i) }">
                        <img v-if="resolveCategoryImage(cat)" :src="resolveCategoryImage(cat)" :alt="getCategoryName(cat)" class="cat-img" loading="lazy" decoding="async" @error="handleImageError(cat)" />
                        <span v-else-if="getCategoryInitial(cat)" class="cat-initial">{{ getCategoryInitial(cat) }}</span>
                        <i v-else class="pi pi-tag"></i>
                    </span>

                    <span class="cat-label" :style="selectedCategory === cat.code ? { color: getCatColor(cat, i) } : {}">{{ getCategoryName(cat) }}</span>

                    <span v-if="selectedCategory === cat.code" class="cat-underline" :style="{ background: getCatColor(cat, i) }"></span>
                </button>
            </div>

            <button v-if="canScrollRight" type="button" class="cat-arrow cat-arrow--right" :aria-label="t('landing.scrollRight')" @click="scrollTrack(1)">
                <i class="pi pi-chevron-right"></i>
            </button>
        </div>
    </div>
</template>

<style scoped>
.cat-root {
    background: var(--shop-surface);
    border: 1px solid var(--shop-border);
    border-radius: var(--shop-radius-card);
    box-shadow: var(--shop-shadow-1);
    overflow: hidden;
}

.cat-wrap {
    position: relative;
}

/* เรียงหมวดหมู่ 2 แถว แล้วเลื่อนแนวนอนเป็นชุดคอลัมน์ */
.cat-track {
    display: grid;
    grid-template-rows: repeat(2, auto);
    grid-auto-flow: column;
    grid-auto-columns: clamp(4.2rem, 17vw, 5.6rem);
    gap: clamp(0.15rem, 1vw, 0.5rem);
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding: 0.75rem 0.5rem 0.5rem;
}

.cat-track::-webkit-scrollbar {
    display: none;
}

.cat-item {
    position: relative;
    scroll-snap-align: center;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.15rem 0.55rem;
    border: 0;
    background: transparent;
    cursor: pointer;
}

/* วงกลมยืดตามจอ — เดิม fix 64px ทำให้มือถือเล็กกินพื้นที่เกินไป */
.cat-circle {
    width: clamp(3.25rem, 12vw, 4.5rem);
    height: clamp(3.25rem, 12vw, 4.5rem);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition: transform 0.14s ease;
}

.cat-item:hover .cat-circle {
    transform: scale(1.06);
}

.cat-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

/* ตัวอักษรแรกของชื่อหมวด ใช้เมื่อไม่มีรูปหรือรูปโหลดไม่ขึ้น */
.cat-initial {
    font-size: clamp(1.1rem, 4.5vw, 1.5rem);
    font-weight: 900;
    line-height: 1;
}

.cat-circle .pi {
    font-size: 1.1rem;
    opacity: 0.75;
}

.cat-label {
    width: 100%;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--market-text);
    font-size: clamp(0.66rem, 2.4vw, 0.76rem);
    font-weight: 600;
    line-height: 1.3;
    text-align: center;
}

.cat-item.is-active .cat-label {
    font-weight: 800;
}

.cat-underline {
    position: absolute;
    left: 50%;
    bottom: 0.15rem;
    transform: translateX(-50%);
    width: 1.6rem;
    height: 2px;
    border-radius: 2px;
}

.cat-skeleton-circle {
    width: clamp(3.25rem, 12vw, 4.5rem) !important;
    height: clamp(3.25rem, 12vw, 4.5rem) !important;
}

.cat-arrow {
    position: absolute;
    top: 45%;
    transform: translateY(-50%);
    z-index: 10;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    background: var(--shop-surface);
    border: 1px solid var(--shop-border);
    color: var(--market-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.7rem;
    box-shadow: var(--shop-shadow-2);
}

.cat-arrow--left {
    left: 0.25rem;
}

.cat-arrow--right {
    right: 0.25rem;
}

/* บนอุปกรณ์สัมผัสไม่ต้องมีปุ่มลูกศร ผู้ใช้ปัดเอาได้และปุ่มบังหมวดที่อยู่ริม */
@media (hover: none) {
    .cat-arrow {
        display: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .cat-item:hover .cat-circle {
        transform: none;
    }
}
</style>
