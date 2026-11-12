<script setup>
import '@/assets/demo/flags/flags.css';

defineProps({ locale: { type: String, required: true } });
const country = { th: 'th', en: 'gb', lo: 'la' };
</script>

<template>
    <span aria-hidden="true" :class="['flag', 'language-flag', 'flag-' + country[locale]]"></span>
</template>

<style scoped>
.flag.language-flag { width: var(--flag-width, 2.4rem); height: auto; aspect-ratio: 44 / 30; flex: none; border-radius: .22rem; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 8%); }
</style>
