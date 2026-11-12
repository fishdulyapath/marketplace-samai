<script setup>
import { computed, ref, watch } from 'vue';
import Skeleton from 'primevue/skeleton';
import PromotionTag from './PromotionTag.vue';
import { formatPrice, resolveProductListPrice } from '@/services/catalogPrice';
import { useAuthenStore } from '@/stores/authen';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName } from '@/utils/languageDisplay';

const props = defineProps({
    products: { type: Array, required: true },
    total: Number,
    limit: { type: Number, default: 5 },
    loading: Boolean
});
defineEmits(['open']);
const language = useLanguageStore();
const auth = useAuthenStore();
const missingImages = ref(new Set());
const prices = ref(new Map());
const visibleItems = computed(() => props.products.slice(0, props.limit));
const productGroups = computed(() => [visibleItems.value.slice(0, 1), visibleItems.value.slice(1)].filter(group => group.length));

watch([visibleItems, () => auth.isAuthenticated, () => auth.userCode], ([items, signedIn], _, onCleanup) => {
    prices.value = new Map();
    if (!signedIn) return;
    let current = true;
    onCleanup(() => { current = false; });
    items.forEach(async item => {
        let quote;
        try {
            const result = await resolveProductListPrice(item);
            quote = { amount: formatPrice(result.price), unit: result.unit_code };
        } catch {
            quote = { amount: '' };
        }
        if (current) prices.value.set(item.item_code, quote);
    });
}, { immediate: true });
</script>

<template>
    <section class="promo-preview" :aria-label="language.t('landing.promoSpecial')" :aria-busy="loading">
        <header class="promo-heading">
            <h2>{{ language.t('landing.promoSpecial') }}</h2>
            <span v-if="!loading && total != null" class="count">{{ language.t('catalog.itemCount', { count: total }) }}</span>
            <RouterLink v-if="!loading && products.length" class="all-link"
                :to="{ path: '/marketplace', query: { category: 'promotions' }, hash: '#catalog-products' }">
                {{ language.t('landing.viewAllPromotions') }} <i class="pi pi-arrow-right" aria-hidden="true"></i>
            </RouterLink>
        </header>
        <div v-if="loading" class="loading-preview" aria-hidden="true"><Skeleton width="100%" height="100%" /></div>
        <div v-else class="showcase">
            <div v-for="(group, index) in productGroups" :key="index" :class="index === 0 ? 'featured' : 'more-promotions'">
                <button v-for="item in group" :key="item.item_code" type="button" class="promo-item" @click="$emit('open', item)">
                    <span class="art">
                        <img v-if="item.image && !missingImages.has(item.image)" :src="item.image" alt="" @error="missingImages.add(item.image)" />
                        <i v-else class="pi pi-box" aria-hidden="true"></i>
                    </span>
                    <span class="copy">
                        <strong>{{ pickProductName(item, language.locale) || item.display_name || item.item_name || item.item_code }}</strong>
                        <PromotionTag :offer="item.promotion_tag" />
                        <span v-if="auth.isAuthenticated" class="price-line">
                            <template v-if="prices.get(item.item_code)?.amount">
                                <b>฿{{ prices.get(item.item_code).amount }}</b>
                                <small v-if="prices.get(item.item_code).unit">/ {{ prices.get(item.item_code).unit }}</small>
                            </template>
                            <small v-else-if="prices.has(item.item_code)">{{ language.t('catalog.priceNotFound') }}</small>
                            <Skeleton v-else width="4.5rem" height="1rem" />
                        </span>
                    </span>
                </button>
            </div>
        </div>
    </section>
</template>

<style scoped>
.promo-preview {
    padding: .8rem 1rem;
    min-width: 0;
    background: #fff;
    color: #202823;
    border-block: 1px solid #e2e6e2;
}
.promo-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: .2rem .65rem; padding-bottom: .55rem; border-bottom: 1px solid #e2e6e2; }
.promo-heading h2 { margin: 0; font-size: 1.35rem; line-height: 1.5; font-weight: 750; }
.count, .price-line small { color: #606b65; font-size: .85rem; }
.all-link { display: inline-flex; align-items: center; gap: .45rem; margin-inline-start: auto; padding-block: .35rem; color: #146347; font-weight: 650; }
.all-link i { font-size: .85em; }
.showcase { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); padding-top: .6rem; }
.featured { display: grid; align-items: center; }
.featured:only-child { grid-column: 1 / -1; max-width: 34rem; }
.more-promotions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-inline-start: 1px solid #e2e6e2; }
.promo-item {
    display: flex; align-items: center; gap: .8rem; min-width: 0; width: 100%;
    padding: .6rem 1rem; border: 0; background: #fff; color: inherit; font: inherit; text-align: start; cursor: pointer;
}
.more-promotions .promo-item:nth-child(n+3) { border-top: 1px solid #e9ece9; }
.art { display: flex; align-items: center; justify-content: center; flex: none; width: 4.1rem; height: 4.5rem; }
.art img { display: block; width: 100%; height: 100%; object-fit: contain; }
.art i { color: #8a968f; font-size: 1.7rem; }
.featured .art { width: 43%; height: 10.5rem; }
.featured .art i { font-size: 3rem; }
.copy { display: grid; min-width: 0; gap: .3rem; }
.copy strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.45; }
.featured strong { font-size: clamp(1.1rem, 1.5vw, 1.55rem); }
.price-line { display: flex; align-items: baseline; flex-wrap: wrap; gap: .3rem; min-height: 1.45rem; }
.price-line b { font-size: 1.16rem; color: #b33423; font-variant-numeric: tabular-nums; }
.featured .price-line b { font-size: 1.65rem; }
.promo-item:hover strong, .all-link:hover { text-decoration: underline; text-underline-offset: .2em; }
.promo-item:focus-visible, .all-link:focus-visible { outline: 2px solid #146347; outline-offset: -2px; }
.loading-preview { height: 11rem; padding-block: .6rem; }
@media (max-width: 900px) {
    .promo-preview { padding: .55rem .45rem; border-top: 0; }
    .promo-heading h2 { font-size: 1.15rem; }
    .all-link { font-size: .87rem; }
    .showcase { display: block; padding-top: 0; }
    .featured .promo-item { gap: 1rem; padding: .65rem; }
    .featured .art { width: 32%; height: 7.3rem; }
    .featured .price-line b { font-size: 1.45rem; }
    .more-promotions {
        display: flex; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity;
        border-inline-start: 0; border-top: 1px solid #e2e6e2; scrollbar-width: thin;
    }
    .more-promotions .promo-item {
        flex: 0 0 clamp(11rem, 46%, 16rem); scroll-snap-align: start;
        padding: .65rem .5rem; gap: .45rem; border-top: 0;
    }
    .more-promotions .promo-item + .promo-item { border-inline-start: 1px solid #e9ece9; }
    .more-promotions .promo-item:nth-child(n+3) { border-top: 0; }
    .more-promotions .art { width: 3.1rem; height: 4.4rem; }
    .more-promotions strong { font-size: .93rem; }
}
</style>
