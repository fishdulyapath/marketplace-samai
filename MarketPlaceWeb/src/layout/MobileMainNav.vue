<script setup>
defineProps({
    items: Array, activePath: String, label: String, authenticated: Boolean,
    cartOpen: Boolean, totalItems: Number, disabled: Boolean
});
defineEmits(['navigate']);
</script>

<template>
    <nav  class="mobile-main-nav" :aria-label="label">
        <button v-for="item in items" :key="item.to" type="button" class="mobile-main-nav-item"
            :class="{ active: activePath === item.to }"
            :aria-current="activePath === item.to ? (cartOpen ? 'true' : 'page') : undefined"
            :disabled="disabled" @click="$emit('navigate', item, $event)">
            <span class="mobile-nav-icon">
                <i :class="item.icon" aria-hidden="true"></i>
                <span v-if="item.to === '/basket' && authenticated && totalItems > 0" class="mobile-cart-badge">{{ totalItems > 99 ? '99+' : totalItems }}</span>
            </span>
            <span>{{ item.label }}</span>
        </button>
    </nav>
</template>

<style scoped>
.mobile-main-nav { display:none; }
@media (max-width:900px) {
    .mobile-main-nav {
        position: fixed;
        inset: auto 0 0;
        z-index: 996;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        align-items: stretch;
        box-sizing: border-box;
        height: calc(var(--market-mobile-nav-height, 64px) + env(safe-area-inset-bottom));
        padding: 4px max(5px, env(safe-area-inset-right)) calc(4px + env(safe-area-inset-bottom)) max(5px, env(safe-area-inset-left));
        border-top: 1px solid #dfe8e4;
        background: var(--market-card-bg, #fff);
        box-shadow: 0 -4px 15px rgb(26 60 42 / 6%);
    }

    .mobile-main-nav-item {
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        border: 0;
        padding: 3px 1px;
        border-radius: 10px;
        background: transparent;
        color: #52606a;
        font-size: clamp(10px, 2.7vw, 12px);
        line-height: 1.25;
        font-weight: 600;
        cursor: pointer;
    }

    .mobile-main-nav-item.active {
        color: color-mix(in srgb, var(--market-primary, #078954) 77%, #122d22);
        background: color-mix(in srgb, var(--market-primary, #078954) 13%, #fff);
    }

    .mobile-main-nav-item:focus-visible {
        outline: 2px solid var(--market-primary, #078954);
        outline-offset: -2px;
    }

    .mobile-nav-icon {
        display: inline-flex;
        position: relative;
    }

    .mobile-nav-icon i { font-size: 20px; }
    .mobile-cart-badge {
        position: absolute;
        top: -6px;
        left: calc(100% - 6px);
        min-width: 16px;
        border-radius: 10px;
        padding: 1px 4px;
        background: #b64012;
        color: #fff;
        font-size: 10px;
        line-height: 14px;
        font-weight: 700;
    }

}
</style>
