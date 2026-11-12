<script setup>
import { resolveCategoryImage } from '@/utils/categoryImage';
import { useLanguageStore } from '@/stores/languageStore';
import { pickMasterName } from '@/utils/languageDisplay';
import Skeleton from 'primevue/skeleton';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
    categories: { type: Array, required: true },
    loading: { type: Boolean, default: false },
    selectedCategory: {
        type: String,
        default: 'all'
    }
});

const emit = defineEmits(['select-category']);

const languageStore = useLanguageStore();
const t = (key, params) => languageStore.t(key, params);

// Desktop scroll
const desktopTrackRef = ref(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

// Mobile scroll
const mobileTrackRef = ref(null);
const mobileChipRefs = ref({});
const canMobileScrollLeft = ref(false);
const canMobileScrollRight = ref(false);

// Palette fallback
const palette = [
    '#ee4d2d','#f57224','#0db14b','#1890ff',
    '#722ed1','#eb2f96','#faad14','#13c2c2',
    '#52c41a','#2f54eb','#fa541c','#a0d911',
];

const specialMap = {
    all:        { bg: '#fff0eb', color: '#ee4d2d' },
    promotions: { bg: '#fff0eb', color: '#ee4d2d' },
    productset: { bg: '#e6f7ff', color: '#1890ff' },
};

function getCatColor(cat, index) {
    if (specialMap[cat.code]) return specialMap[cat.code].color;
    return palette[(index ?? 0) % palette.length];
}
function getCatBg(cat, index) {
    if (specialMap[cat.code]) return specialMap[cat.code].bg;
    const color = palette[(index ?? 0) % palette.length];
    return color + '18';
}

// ── Desktop scroll ──
function updateDesktopScroll() {
    const el = desktopTrackRef.value;
    if (!el) return;
    canScrollLeft.value = el.scrollLeft > 4;
    canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}
function scrollDesktop(dir) {
    desktopTrackRef.value?.scrollBy({ left: dir * 320, behavior: 'smooth' });
}

// ── Mobile scroll ──
function updateMobileScroll() {
    const el = mobileTrackRef.value;
    if (!el) return;
    canMobileScrollLeft.value = el.scrollLeft > 4;
    canMobileScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
}
function scrollMobile(dir) {
    mobileTrackRef.value?.scrollBy({ left: dir * 200, behavior: 'smooth' });
}
function setMobileChipRef(el, code) {
    if (el) mobileChipRefs.value[code] = el;
}
function scrollToActive() {
    const chip = mobileChipRefs.value[props.selectedCategory];
    if (chip && mobileTrackRef.value) {
        chip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}



function getCategoryName(cat) {
    const specialCategoryKeys = {
        all: 'catalog.allProducts',
        promotions: 'catalog.promotion',
        productset: 'catalog.productSet'
    };
    return specialCategoryKeys[cat?.code] ? t(specialCategoryKeys[cat.code]) : pickMasterName(cat, languageStore.locale) || cat?.display_name || cat?.name || '';
}

function handleResize() {
    updateDesktopScroll();
    updateMobileScroll();
}

watch(() => props.categories, () => {
    handleResize();
    scrollToActive();
}, { flush: 'post' });

onMounted(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize);
});

watch(() => props.selectedCategory, () => nextTick(() => scrollToActive()));

function selectCategory(code) {
    emit('select-category', code);
}
</script>

<template>
    <div class="cat-root">

        <!-- ══════════════════════════════════════════════════
             DESKTOP — Shopee-style 2-row horizontal scroll
        ══════════════════════════════════════════════════════ -->
        <div class="cat-desktop hidden md:block">
            <!-- Loading -->
            <div v-if="loading" class="cat-d-track">
                <div class="cat-d-inner">
                    <div v-for="i in 10" :key="i" class="cat-d-item">
                        <Skeleton shape="circle" size="64px" class="mb-2" />
                        <Skeleton width="56px" height="11px" />
                    </div>
                </div>
            </div>

            <!-- Scroll container -->
            <div v-else class="cat-d-wrap">
                <!-- Left arrow -->
                <button v-if="canScrollLeft" type="button" class="cat-d-arrow cat-d-arrow--left" aria-label="เลื่อนหมวดหมู่ไปทางซ้าย" @click="scrollDesktop(-1)">
                    <i class="pi pi-chevron-left"></i>
                </button>

                <div ref="desktopTrackRef" class="cat-d-track" @scroll="updateDesktopScroll">
                    <!-- 2-row grid inside scrollable track -->
                    <div class="cat-d-inner">
                        <button
                            v-for="(cat, i) in categories"
                            :key="cat.code"
                            type="button"
                            :class="['cat-d-item', selectedCategory === cat.code ? 'cat-d-item--active' : '']"
                            :aria-pressed="selectedCategory === cat.code"
                            :aria-label="`${t('common.select')} ${getCategoryName(cat)}`"
                            @click="selectCategory(cat.code)"
                        >
                            <!-- Circle -->
                            <div
                                class="cat-d-circle"
                                :style="{ background: getCatBg(cat, i) }"
                            >
                                <i class="pi pi-th-large" aria-hidden="true"></i>
                                <img
                                    v-if="resolveCategoryImage(cat)"
                                    :src="resolveCategoryImage(cat)"
                                    :alt="getCategoryName(cat)"
                                    class="cat-d-img"
                                    @error="(e) => e.target.style.display = 'none'"
                                />
                            </div>
                            <!-- Label -->
                            <span
                                class="cat-d-label"
                                :style="selectedCategory === cat.code ? { color: getCatColor(cat, i) } : {}"
                            >{{ getCategoryName(cat) }}</span>
                            <!-- Active underline -->
                            <span v-if="selectedCategory === cat.code" class="cat-d-underline" :style="{ background: getCatColor(cat, i) }"></span>
                        </button>
                    </div>
                </div>

                <!-- Right arrow -->
                <button v-if="canScrollRight" type="button" class="cat-d-arrow cat-d-arrow--right" aria-label="เลื่อนหมวดหมู่ไปทางขวา" @click="scrollDesktop(1)">
                    <i class="pi pi-chevron-right"></i>
                </button>
            </div>
        </div>

        <!-- ══════════════════════════════════════════════════
             MOBILE — horizontal scroll chips
        ══════════════════════════════════════════════════════ -->
        <div class="cat-mobile md:hidden">
            <div v-if="loading" class="cat-m-track">
                <Skeleton v-for="i in 8" :key="i" height="32px" :width="`${60 + (i % 3) * 20}px`" class="rounded-full shrink-0" />
            </div>

            <div v-else class="cat-m-wrap">
                <button v-if="canMobileScrollLeft" type="button" class="cat-m-arrow cat-m-arrow--left" aria-label="เลื่อนหมวดหมู่ไปทางซ้าย" @click="scrollMobile(-1)">
                    <i class="pi pi-chevron-left"></i>
                </button>
                <div v-if="canMobileScrollLeft" class="cat-m-fade cat-m-fade--left"></div>

                <div ref="mobileTrackRef" class="cat-m-track" @scroll="updateMobileScroll">
                    <button
                        v-for="(cat, i) in categories"
                        :key="cat.code"
                        type="button"
                        :ref="(el) => setMobileChipRef(el, cat.code)"
                        :class="['cat-m-chip', selectedCategory === cat.code ? 'cat-m-chip--active' : '']"
                        :aria-pressed="selectedCategory === cat.code"
                        :aria-label="`${t('common.select')} ${getCategoryName(cat)}`"
                        :style="selectedCategory === cat.code
                            ? { borderColor: getCatColor(cat, i), color: getCatColor(cat, i), background: getCatBg(cat, i) }
                            : { borderColor: '#e8d8b0', color: '#6b5533' }"
                        @click="selectCategory(cat.code)"
                    >
                        <img
                            v-if="resolveCategoryImage(cat)"
                            :src="resolveCategoryImage(cat)"
                            :alt="getCategoryName(cat)"
                            class="cat-m-img"
                            @error="(e) => e.target.style.display = 'none'"
                        />
                        {{ getCategoryName(cat) }}
                    </button>
                </div>

                <div v-if="canMobileScrollRight" class="cat-m-fade cat-m-fade--right"></div>
                <button v-if="canMobileScrollRight" type="button" class="cat-m-arrow cat-m-arrow--right" aria-label="เลื่อนหมวดหมู่ไปทางขวา" @click="scrollMobile(1)">
                    <i class="pi pi-chevron-right"></i>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* ── Root ── */
.cat-root {
    background: #ffffff;
    border-radius: 4px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    overflow: hidden;
}

/* ══════════════════════════════════════════════
   DESKTOP
══════════════════════════════════════════════ */
.cat-desktop {
    padding: 0;
}

.cat-d-wrap {
    position: relative;
}

.cat-d-track {
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding: 16px 8px 4px;
}
.cat-d-track::-webkit-scrollbar { display: none; }

/* 2-row grid: เรียง column-first, สูง 2 แถวพอดี */
.cat-d-inner {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(2, auto);
    gap: 4px 0;
    width: max-content;
}

.cat-d-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 12px 10px;
    width: 96px;
    border: none;
    background: transparent;
    cursor: pointer;
    outline: none;
    user-select: none;
    position: relative;
    transition: background 0.15s;
    border-radius: 4px;
}
.cat-d-item:hover { background: #fafafa; }
.cat-d-item--active { background: #fafafa; }

.cat-d-circle {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
}
.cat-d-item:hover .cat-d-circle,
.cat-d-item--active .cat-d-circle {
    position: relative;
    transform: scale(1.06);
}

.cat-d-img {
    position: absolute; inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.cat-d-label {
    font-size: 0.85rem;
    color: #333;
    text-align: center;
    line-height: 1.3;
    max-width: 80px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: normal;
    word-break: break-word;
    font-weight: 600;
    transition: color 0.15s;
}
.cat-d-item--active .cat-d-label {
    font-weight: 600;
}

/* Active underline (Shopee style) */
.cat-d-underline {
    position: absolute;
    bottom: 0;
    left: 16px;
    right: 16px;
    height: 2px;
    border-radius: 2px;
}

/* Scroll arrows */
.cat-d-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid #e0e0e0;
    color: #555;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.7rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: box-shadow 0.14s;
}
.cat-d-arrow:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
.cat-d-arrow--left  { left: 2px; }
.cat-d-arrow--right { right: 2px; }

/* Divider between 2 rows */
.cat-d-inner::after {
    content: '';
    display: none;
}

/* ══════════════════════════════════════════════
   MOBILE
══════════════════════════════════════════════ */
.cat-mobile { padding: 8px 0; }

.cat-m-wrap {
    position: relative;
    display: flex;
    align-items: center;
}

.cat-m-track {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    scroll-behavior: smooth;
    padding: 4px 12px;
    scrollbar-width: none;
    -ms-overflow-style: none;
    flex: 1;
    min-width: 0;
}
.cat-m-track::-webkit-scrollbar { display: none; }

.cat-m-img {
    width: 20px;
    height: 20px;
    object-fit: cover;
    border-radius: 50%;
    margin-right: 5px;
    flex-shrink: 0;
}

.cat-m-chip {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    border: 1.5px solid #e8d8b0;
    background: #fff;
    color: #6b5533;
    flex-shrink: 0;
    outline: none;
    user-select: none;
    transition: all 0.14s;
}
.cat-m-chip:hover { background: #fafafa; }
.cat-m-chip--active { font-weight: 600; }

/* Mobile arrows */
.cat-m-arrow {
    position: absolute;
    z-index: 10;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid #e0e0e0;
    color: #555;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.6rem;
    box-shadow: 0 2px 6px rgba(0,0,0,0.12);
}
.cat-m-arrow--left  { left: 2px; }
.cat-m-arrow--right { right: 2px; }

/* Fade edges */
.cat-m-fade {
    position: absolute;
    top: 0; bottom: 0;
    width: 36px;
    pointer-events: none;
    z-index: 5;
}
.cat-m-fade--left  { left: 0;  background: linear-gradient(to right, #fff 30%, transparent); }
.cat-m-fade--right { right: 0; background: linear-gradient(to left,  #fff 30%, transparent); }

/* Divider between 2 rows on desktop */
.cat-d-row-divider {
    grid-column: 1 / -1;
    height: 1px;
    background: #f5f5f5;
    margin: 0 8px;
}

@media (prefers-reduced-motion: reduce) {
    .cat-d-item, .cat-m-chip { transition: none !important; }
}
</style>
