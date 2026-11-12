<script setup>
import { computed } from 'vue';
import { useLanguageStore } from '@/stores/languageStore';

const props = defineProps({ offer: Object });
const language = useLanguageStore();
const label = computed(() => {
    const offer = props.offer;
    if (!offer) return '';
    const qty = Number(offer.quantity);
    const discount = String(offer.discount || '').trim();
    const values = { qty: qty.toLocaleString(language.locale), unit: offer.unit || '' };
    if (!discount) return qty > 1 ? language.t('catalog.promoAtQuantity', values) : '';

    // Complex ERP discount formulas are explained in the product detail, not abbreviated as percentages.
    const percent = /^(\d+(?:\.\d+)?)%$/.exec(discount);
    const text = percent
        ? language.t('catalog.promoPercent', { value: Number(percent[1]).toLocaleString(language.locale, { maximumFractionDigits: 8 }) })
        : language.t('catalog.promoDiscount');
    return qty > 1 ? language.t('catalog.promoDiscountAtQuantity', { ...values, discount: text }) : text;
});
</script>

<template>
    <span v-if="label" class="promo-condition">{{ label }}</span>
</template>

<style scoped>
.promo-condition {
    display: inline-block;
    justify-self: start;
    width: fit-content;
    max-width: 100%;
    color: #a3440a;
    font-size: .78rem;
    font-weight: 600;
    line-height: 1.45;
    overflow-wrap: anywhere;
}
</style>
