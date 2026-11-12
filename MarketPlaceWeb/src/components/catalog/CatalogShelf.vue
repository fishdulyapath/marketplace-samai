<script setup>
import Skeleton from 'primevue/skeleton';
import { ref, watch } from 'vue';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName } from '@/utils/languageDisplay';

const props = defineProps({
    products: { type: Array, required: true },
    promotion: Boolean,
    initialLoading: Boolean,
    loadingMore: Boolean
});
const emit = defineEmits(['open', 'track', 'scroll', 'previous', 'next', 'pause', 'resume']);
const language = useLanguageStore();
const t = language.t;
const track = ref(null);
const rail = ref(null);
const canGoBack = ref(false);
const canGoNext = ref(false);
watch(() => [props.products.length, props.initialLoading], updateArrows, { flush: 'post' });

function updateArrows() {
    const el = track.value;
    canGoBack.value = !!el && el.scrollLeft > 1;
    canGoNext.value = !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}
watch([track, rail], ([viewport, content], _, onCleanup) => {
    emit('track', viewport);
    if (!viewport || !content) return;
    const observer = new ResizeObserver(updateArrows);
    observer.observe(viewport);
    observer.observe(content);
    updateArrows();
    onCleanup(() => observer.disconnect());
}, { flush: 'post' });

function nameOf(item) {
    return pickProductName(item, language.locale) || item.display_name || item.item_name || item.item_code;
}
</script>

<template>
    <section v-if="initialLoading || products.length" class="shelf" :class="{ promotion }"
        :aria-label="t(promotion ? 'landing.promoSpecial' : 'landing.recommendedTitle')">
        <header class="shelf-head">
            <h2><i :class="promotion ? 'pi pi-bolt' : 'pi pi-sparkles'" aria-hidden="true"></i>{{ t(promotion ? 'landing.promoSpecial' : 'landing.recommendedTitle') }}</h2>
            <div v-if="!initialLoading && (canGoBack || canGoNext)" class="arrows">
                <button type="button" :disabled="!canGoBack" :aria-label="t('landing.scrollLeft')" @click="emit('previous')"><i class="pi pi-angle-left"></i></button>
                <button type="button" :disabled="!canGoNext" :aria-label="t('landing.scrollRight')" @click="emit('next')"><i class="pi pi-angle-right"></i></button>
            </div>
        </header>
        <div ref="track" class="shelf-track" @scroll="updateArrows(); emit('scroll', $event)" @mouseenter="emit('pause')" @mouseleave="emit('resume')">
            <div ref="rail" class="shelf-rail">
                <template v-if="initialLoading">
                    <div v-for="n in 4" :key="n" class="tile placeholder" aria-hidden="true">
                        <Skeleton width="100%" height="5rem" /><Skeleton width="74%" height=".8rem" />
                    </div>
                </template>
                <template v-else>
                    <article v-for="product in props.products" :key="product.item_code" class="tile">
                        <button class="product" type="button" :title="nameOf(product)" @click="emit('open', product)">
                            <span class="photo">
                                <img :src="product.image" alt="" loading="lazy" @error="$event.target.src !== product.imageFallback && ($event.target.src = product.imageFallback)" />
                            </span>
                            <span class="caption">
                                <small>{{ product.category_display || product.category || product.item_code }}</small>
                                <small v-if="!promotion" class="desktop-sku">SKU: {{ product.item_code }}</small>
                                <strong>{{ nameOf(product) }}</strong>
                            </span>
                        </button>
                        <slot name="action" :product="product" />
                    </article>
                    <i v-if="loadingMore" class="pi pi-spin pi-spinner more" :aria-label="t('catalog.loadingMore')"></i>
                </template>
            </div>
        </div>
    </section>
</template>

<style scoped>
.shelf {
    --tone: var(--market-primary, #6853a4);
    min-width: 0;
    overflow: hidden;
    color: var(--market-text, #202837);
    background: var(--market-card-bg, #fff);
    border: 1px solid var(--market-card-border, #dfe3eb);
    border-radius: 1rem;
}
.shelf.promotion { --tone: var(--market-accent, #bb4061); }
.shelf-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .65rem .85rem; }
.shelf-head h2 { display: flex; align-items: center; gap: .6rem; margin: 0; font-size: 1.05rem; font-weight: 750; }
.shelf-head h2 i { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: .65rem; color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, white); }
.arrows { display: flex; gap: .25rem; }
.arrows button { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; border: 1px solid var(--market-card-border); cursor: pointer; }
.arrows button:disabled { opacity: .4; cursor: default; }
.shelf-track { overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--tone) 35%, transparent) transparent; }
.shelf-rail { display: flex; align-items: stretch; width: max-content; gap: .55rem; padding: .1rem .85rem .8rem; }
.tile { position: relative; width: 10rem; border-radius: .7rem; background: var(--market-card-bg, white); }
.product { display: grid; width: 100%; gap: .45rem; border-radius: inherit; text-align: start; color: inherit; cursor: pointer; }
.photo { display: grid; place-items: center; height: 7rem; border: 1px solid var(--market-card-border); border-radius: .7rem; overflow: hidden; background: #fff; }
.photo img { display: block; width: 100%; height: 100%; padding: .35rem; object-fit: contain; }
.caption { display: grid; gap: .15rem; padding-inline: .15rem; }
.caption small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .73rem; color: var(--market-muted); }
.caption .desktop-sku { display: none; }
.caption strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size: .9rem; line-height: 1.4; }
.product:hover .photo { border-color: var(--tone); }
.shelf button:focus-visible { outline: 2px solid var(--tone); outline-offset: -2px; }
.placeholder { display: grid; gap: .6rem; padding: .3rem; }
.more { align-self: center; color: var(--tone); }
@media (min-width: 901px) {
    .shelf:not(.promotion) { --tone: #12664e; border: 0; border-radius: 0; background: transparent; }
    .shelf-head { gap: .9rem; padding: .25rem 0 .8rem; }
    .shelf-head h2 { flex: 1; font-size: 1.45rem; gap: 1rem; }
    .shelf-head h2::after { content: ''; flex: 1; height: 1px; background: var(--tone); }
    .shelf-head h2 i { display: none; }
    .shelf-track { container-type: inline-size; }
    .shelf-rail { gap: .75rem; padding: 0 0 .4rem; }
    .tile { width: calc((100cqw - 3rem) / 5); }
    .photo { aspect-ratio: 5 / 4; height: auto; border: 0; }
    .photo img { min-height: 0; mix-blend-mode: multiply; }
    .caption { padding: 0; }
    .caption small:first-child { display: none; }
    .caption .desktop-sku { display: block; order: 1; font-size: .83rem; }
    .caption strong { font-size: 1rem; }
}
@media (max-width: 900px) {
    .shelf { border: 0; border-radius: 0; }
    .shelf-head { padding: .5rem .35rem; }
    .shelf-head h2 { flex: 1; font-size: 1.2rem; line-height: 1.45; gap: .5rem; color: #18263b; }
    .shelf-head h2 i { width: auto; height: auto; font-size: 1.2rem; color: #087c53; background: transparent; }
    .shelf-head h2::after { content: ''; flex: 1; height: 1px; background: #ccd3da; }
    .arrows { display: none; }
    .shelf-track { margin-inline: .35rem; container-type: inline-size; scroll-snap-type: x proximity; scrollbar-width: none; }
    .shelf-rail { gap: .5rem; padding: 0 0 .35rem; }
    .tile { width: calc((100cqw - 1rem) / 3); scroll-snap-align: start; }
    .photo { height: auto; aspect-ratio: 1; border: 0; }
    .photo img { min-height: 0; mix-blend-mode: multiply; }
    .caption small { display: none; }
    .caption strong { font-size: .9rem; }
}
</style>
