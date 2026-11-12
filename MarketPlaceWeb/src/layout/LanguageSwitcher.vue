<script setup>
import Drawer from 'primevue/drawer';
import Popover from 'primevue/popover';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useLanguageStore } from '@/stores/languageStore';
import LanguageFlag from './LanguageFlag.vue';
import LanguageOptions from './LanguageOptions.vue';

const language = useLanguageStore();
const trigger = ref(null);
const popover = ref(null);
const menuOpen = ref(false);
const sheetOpen = ref(false);
const mobile = window.matchMedia('(max-width: 900px)');

function toggle(event) {
    if (mobile.matches) sheetOpen.value = true;
    else popover.value.toggle(event);
}

function close() {
    sheetOpen.value = false;
    popover.value?.hide();
}

function choose(code) {
    language.setLocale(code);
    close();
    trigger.value?.focus();
}

onMounted(() => mobile.addEventListener('change', close));
onBeforeUnmount(() => mobile.removeEventListener('change', close));
</script>

<template>
    <button ref="trigger" class="language-trigger" type="button" aria-haspopup="dialog"
        :aria-expanded="sheetOpen || menuOpen" :aria-label="language.t('language.select') + ' · ' + language.currentOption.label" @click="toggle">
        <i class="pi pi-globe language-globe" aria-hidden="true"></i>
        <LanguageFlag :locale="language.locale" />
        <span class="language-full" :lang="language.locale">{{ language.currentOption.label }}</span>
        <span class="language-short">{{ language.currentOption.shortLabel }}</span>
        <i :class="['pi', menuOpen || sheetOpen ? 'pi-chevron-up' : 'pi-chevron-down']" aria-hidden="true"></i>
    </button>
    <Popover ref="popover" :aria-label="language.t('language.select')" @show="menuOpen = true" @hide="menuOpen = false">
        <LanguageOptions @select="choose" />
    </Popover>
    <Drawer v-model:visible="sheetOpen" position="bottom" role="dialog" :header="language.t('language.select')"
        :aria-label="language.t('language.select')" :block-scroll="true" :close-button-props="{ 'aria-label': language.t('common.close') }"
        :style="{ height: 'auto', maxHeight: '85dvh', borderRadius: '1.25rem 1.25rem 0 0' }">
        <LanguageOptions @select="choose" />
    </Drawer>
</template>

<style scoped>
.language-trigger {
    --flag-width: 1.55rem;
    display: inline-flex; align-items: center; justify-content: center; gap: .45rem;
    min-height: 2.6rem; padding: .35rem .75rem; white-space: nowrap;
    border: 1px solid var(--market-card-border); border-radius: 999px;
    background: var(--market-card-bg, white); color: var(--market-header-text); font-weight: 700; cursor: pointer;
}
.language-trigger:hover, .language-trigger[aria-expanded="true"] { border-color: var(--market-primary); }
.language-trigger:focus-visible { outline: 2px solid var(--market-primary); outline-offset: 2px; }
.language-trigger .pi-chevron-down, .language-trigger .pi-chevron-up { font-size: .7rem; }
.language-globe { border-inline-end: 1px solid var(--market-card-border); padding-inline-end: .5rem; }
.language-short { display: none; }
@media (max-width: 900px) {
    .language-trigger { --flag-width: 1.3rem; padding-inline: .5rem; gap: .3rem; border-radius: .65rem; background: transparent; }
    .language-globe, .language-full { display: none; }
    .language-short { display: inline; }
}
</style>
