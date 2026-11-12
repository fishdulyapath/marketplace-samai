<script setup>
import { useLanguageStore } from '@/stores/languageStore';

const quantity = defineModel({ type: Number, required: true });
const props = defineProps({
    loggedIn: Boolean, needsCustomer: Boolean, busy: Boolean, disabled: Boolean,
    max: { type: Number, default: null }, unit: { type: String, default: '' }
});
const emit = defineEmits(['add', 'login']);
const { t } = useLanguageStore();

function setQuantity(value) {
    const next = Math.max(1, Math.trunc(Number(value)) || 1);
    quantity.value = props.max === null ? next : Math.min(next, Math.max(1, props.max));
}
</script>

<template>
    <footer class="purchase-actions" @click.stop>
        <div v-if="loggedIn" class="quantity-controls">
            <button type="button" :aria-label="t('productDetail.decreaseQuantityAria')" :disabled="busy || quantity <= 1" @click="setQuantity(quantity - 1)">−</button>
            <input type="number" inputmode="numeric" min="1" :max="max ?? undefined" :value="quantity" :disabled="busy" :aria-label="t('productDetail.quantityAria')" @change="setQuantity($event.target.value); $event.target.value = quantity" />
            <button type="button" :aria-label="t('productDetail.increaseQuantityAria')" :disabled="busy || (max !== null && quantity >= max)" @click="setQuantity(quantity + 1)">+</button>
        </div>
        <button type="button" class="submit" :disabled="loggedIn && (busy || disabled || (max !== null && quantity > max))" @click="loggedIn ? emit('add') : emit('login')">
            <i :class="loggedIn ? 'pi pi-shopping-cart' : 'pi pi-sign-in'"></i>
            <template v-if="loggedIn"><span class="mobile-label">{{ t('cart.addButton') }}</span><span class="desktop-label">{{ t('productDetail.addToCartAlt') }}</span></template>
            <template v-else>{{ t(needsCustomer ? 'reviewOrder.selectCustomer' : 'productDetail.loginToOrder') }}</template>
        </button>
    </footer>
</template>

<style scoped>
.purchase-actions { display:flex; align-items:center; gap:.75rem; padding:.75rem; border-top:1px solid var(--market-card-border); background:var(--market-card-bg,white); }
.quantity-controls { display:flex; align-items:center; }
.quantity-controls button,.quantity-controls input { width:2.75rem; min-height:44px; border:1px solid var(--market-card-border); border-radius:999px; text-align:center; color:inherit; background:white; }
.quantity-controls input { appearance:textfield; border:0; }
.quantity-controls input::-webkit-inner-spin-button { appearance:none; }
.submit { flex:1; min-height:46px; padding:.5rem; border:0; border-radius:.7rem; background:var(--market-primary,#087d55); color:white; font-weight:700; }
.submit i { margin-inline:.25rem; }
.mobile-label { display:none; }
@media(max-width:900px) { .desktop-label { display:none; } .mobile-label { display:inline; } }
button:disabled { opacity:.55; }
</style>
