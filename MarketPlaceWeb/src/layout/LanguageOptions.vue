<script setup>
import { useLanguageStore } from '@/stores/languageStore';
import LanguageFlag from './LanguageFlag.vue';

const language = useLanguageStore();
const emit = defineEmits(['select']);
</script>

<template>
    <div class="language-options" role="group" :aria-label="language.t('language.select')">
        <button v-for="option in language.options" :key="option.code" type="button" class="language-option"
            :aria-pressed="option.code === language.locale" :autofocus="option.code === language.locale"
            @click="emit('select', option.code)">
            <LanguageFlag :locale="option.code" />
            <span class="native-name" :lang="option.code">{{ option.label }}</span>
            <small>{{ option.shortLabel }}</small>
            <span class="selection-mark" aria-hidden="true"><i v-if="option.code === language.locale" class="pi pi-check"></i></span>
        </button>
    </div>
</template>

<style scoped>
.language-options { display: grid; grid-template-columns: repeat(3, minmax(6rem, 1fr)); gap: .35rem; }
.language-option {
    position: relative; display: grid; justify-items: center; align-content: center; gap: .35rem;
    min-height: 6.4rem; padding: .65rem .8rem; border: 1px solid var(--market-card-border); border-radius: .7rem;
    color: var(--market-text); background: var(--market-card-bg, white); cursor: pointer;
}
.language-option:hover, .language-option[aria-pressed="true"] { border-color: var(--market-primary); background: var(--market-primary-soft, #e6f4ed); }
.language-option:focus-visible { outline: 2px solid var(--market-primary); outline-offset: 1px; }
.native-name { font-weight: 700; }
.language-option small { color: var(--market-muted); font-size: .78rem; }
.selection-mark { position: absolute; top: .3rem; right: .3rem; display: grid; place-items: center; width: 1.25rem; height: 1.25rem; border-radius: 50%; }
[aria-pressed="true"] .selection-mark { color: white; background: var(--market-primary); }
.selection-mark i { font-size: .68rem; }
@media (max-width: 900px) {
    .language-options { grid-template-columns: 1fr; padding-bottom: env(safe-area-inset-bottom); }
    .language-option { display: flex; align-items: center; justify-content: flex-start; gap: .8rem; min-height: 3.7rem; }
    .selection-mark { position: static; margin-inline-start: auto; border: 1px solid var(--market-card-border); }
    .selection-mark i { font-size: .8rem; }
}
</style>
