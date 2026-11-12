<script setup>
import { resolveCategoryImage } from '@/utils/categoryImage';
defineProps({ categories: Array, selected: String, label: Function, grid: Boolean });
defineEmits(['select']);
</script>
<template>
    <div class="category-tiles" :class="{gridView:grid}">
        <button v-for="category in categories" :key="category.code" type="button" :aria-pressed="category.code === selected" @click="$emit('select', category.code)">
            <span class="visual"><i :class="['pi', category.code === 'promotions' ? 'pi-tag' : 'pi-th-large']"></i>
                <img v-if="resolveCategoryImage(category)" :key="resolveCategoryImage(category)" :src="resolveCategoryImage(category)" alt="" loading="lazy" @error="$event.target.hidden = true">
                <i v-if="grid && category.code === selected" class="pi pi-check check"></i>
            </span>
            <span>{{ label(category) }}</span>
        </button>
    </div>
</template>
<style scoped>
.category-tiles { display:flex; overflow-x:auto; gap:.45rem; padding:.25rem; }
.category-tiles button { display:grid; align-content:start; justify-items:center; gap:.3rem; flex:0 0 4.8rem; min-width:0; border:1px solid transparent; background:transparent; color:var(--market-text); font:inherit; font-size:.86rem; overflow-wrap:anywhere; cursor:pointer; }
.visual { display:grid; place-items:center; position:relative; width:3.5rem; aspect-ratio:1; border-radius:50%; overflow:hidden; color:var(--market-primary); background:linear-gradient(135deg,var(--market-primary-soft),var(--market-surface-soft)); }
.visual img { position:absolute; width:100%; height:100%; object-fit:cover; }
.visual img[hidden] { display:none; }
[aria-pressed="true"] .visual { box-shadow:inset 0 0 0 2px var(--market-primary); outline:2px solid var(--market-primary); }
.gridView { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); overflow:visible; gap:.6rem; }
.gridView button { border:0; border-radius:.75rem; background:var(--market-card-bg); padding:0 0 .4rem; overflow:hidden; }
.gridView .visual { width:100%; border-radius:0; aspect-ratio:1.35; outline:0; box-shadow:none; }
.gridView [aria-pressed="true"] { background:var(--market-primary-soft); }
.check { position:absolute; top:.3rem; right:.3rem; padding:.3rem; border-radius:50%; background:var(--market-primary); color:white; }
</style>
