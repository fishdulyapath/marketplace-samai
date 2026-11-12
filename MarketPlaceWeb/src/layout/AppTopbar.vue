<script setup>
import { getStoredAdminPermissions } from '@/utils/adminPermissions';
import MobileMainNav from './MobileMainNav.vue';
import LanguageSwitcher from './LanguageSwitcher.vue';
import CartOverlay from '@/components/cart/CartOverlay.vue';
import { useAuthenStore } from '@/stores/authen';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const appName = ref(import.meta.env.VITE_APP_NAME);
const appLogo = computed(() => resolvePublicAsset(import.meta.env.VITE_APP_LOGO || ''));
const authenStore = useAuthenStore();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const cartOpen = ref(false);

const userMenuRef = ref(null);
const userButtonRef = ref(null);
const showUserMenu = ref(false);
const authVersion = ref(0);
const t = (key, params) => languageStore.t(key, params);
const isCartPage = computed(() => {
    return router.currentRoute.value.path === '/cart';
});
const currentPath = computed(() => router.currentRoute.value.path);
const hasMobileFooter = computed(() => !['product-detail-public', 'product-detail'].includes(router.currentRoute.value.name));
const showDesktopMainNav = computed(() => !!currentPath.value);
const mainNavItems = computed(() => {
    const items = [
        { label: t('nav.home'), icon: 'pi pi-home', to: '/', match: ['/'] },
        { label: t('nav.marketplace'), icon: 'pi pi-th-large', to: '/marketplace', match: ['/marketplace'] },
        { label: t('nav.promotions'), icon: 'pi pi-tag', to: '/marketplace?category=promotions', matchQuery: { category: 'promotions' } },
        { label: t('nav.productSet'), icon: 'pi pi-box', to: '/marketplace?category=productset', matchQuery: { category: 'productset' } },
        { label: t('nav.orders'), icon: 'pi pi-shopping-bag', to: '/orders-history', authOnly: true, match: ['/orders-history'] }
    ];

    if (hasAdminAccess.value) {
        items.push({ label: t('nav.admin'), icon: 'pi pi-cog', to: '/admin', employeeOnly: true, match: ['/admin'] });
    }

    return items.filter((item) => (!item.authOnly || isAuthenticated.value) && (!item.employeeOnly || isEmployee.value));
});

const mobileMainNavItems = computed(() => [
    { label: t('nav.home'), icon: 'pi pi-home', to: '/', match: ['/'] },
    { label: t('nav.marketplace'), icon: 'pi pi-th-large', to: '/marketplace', match: ['/marketplace'] },
    { label: t('nav.cartShort'), icon: 'pi pi-shopping-cart', to: '/cart', authOnly: true, match: ['/cart'] },
    { label: t('nav.menu'), icon: 'pi pi-bars', to: '/account', authOnly: true, match: ['/account', '/favorites', '/profile', '/doc-history', '/advance-payment-history', '/orders-history', '/order-shipping-status', '/admin'] }
]);

function resolvePublicAsset(value) {
    const asset = String(value || '').trim();
    if (!asset) return '';
    if (/^(https?:|data:|blob:)/i.test(asset)) return asset;
    if (asset.startsWith('/')) return asset;
    return `${import.meta.env.BASE_URL || '/'}${asset}`;
}

// ตรวจสอบการล็อกอิน
const safeParseJson = (value, fallback = null) => {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch (error) {
        console.error('Error parsing localStorage data:', error);
        return fallback;
    }
};

const authContext = computed(() => {
    authVersion.value;
    router.currentRoute.value.fullPath;
    const userType = localStorage.getItem('_userType') || '';
    const userData = safeParseJson(localStorage.getItem('_userData'), null);
    const empData = safeParseJson(localStorage.getItem('_empData'), null);

    return {
        isAuthenticated: !!localStorage.getItem('_token'),
        userType,
        isEmployee: userType === 'employee',
        userData,
        empData
    };
});

const isAuthenticated = computed(() => authContext.value.isAuthenticated);

const isEmployee = computed(() => authContext.value.isEmployee);

const hasAdminAccess = computed(() => isEmployee.value && getStoredAdminPermissions().length > 0);
const currentCustomer = computed(() => authContext.value.userData || null);
const currentEmployee = computed(() => authContext.value.empData || null);

const currentUserLabel = computed(() => {
    if (!isAuthenticated.value) return '';

    if (isEmployee.value) {
        return currentEmployee.value?.user_name || currentEmployee.value?.name || currentEmployee.value?.user_code || t('auth.employee');
    }

    return currentCustomer.value?.user_name || currentCustomer.value?.name || currentCustomer.value?.user_code || t('auth.customer');
});

const currentCustomerLabel = computed(() => {
    const customer = currentCustomer.value;
    if (!customer) return t('auth.noCustomer');
    return `${customer.user_code || customer.code || ''} ${customer.user_name || customer.name || ''}`.trim() || t('auth.customer');
});

const totalItems = computed(() => cartStore.totalItems);

function openCart() {
    if (isCartPage.value) return;
    showUserMenu.value = false;
    cartOpen.value = true;
}

const goToLogin = () => {
    cartOpen.value = false;
    router.push('/auth/login?redirect=/cart');
};

const goToCatalog = () => {
    showUserMenu.value = false;
    router.push('/marketplace');
};

const goToHome = () => {
    showUserMenu.value = false;
    router.push('/');
};

const goToContentAdmin = () => {
    showUserMenu.value = false;
    router.push('/admin');
};

const changeCustomer = () => {
    showUserMenu.value = false;
    router.push({
        path: '/auth/login',
        query: {
            mode: 'employee',
            selectCustomer: '1',
            redirect: '/marketplace'
        }
    });
};

const goToOrderHistory = () => {
    showUserMenu.value = false;
    router.push('/orders-history');
};

const goToFavorites = () => {
    showUserMenu.value = false;
    router.push('/favorites');
};

const goToProfile = () => {
    showUserMenu.value = false;
    router.push('/profile');
};

const goToDocHistory = () => {
    showUserMenu.value = false;
    router.push('/doc-history');
};

const goToAdvancePaymentHistory = () => {
    showUserMenu.value = false;
    router.push('/advance-payment-history');
};

function goToMainNav(item) {
    showUserMenu.value = false;
    cartOpen.value = false;
    router.push(item.to);
}

function goToMobileMainNav(item) {
    cartOpen.value = false;
    showUserMenu.value = false;
    if (item.authOnly && !isAuthenticated.value) {
        router.push(`/auth/login?redirect=${encodeURIComponent(item.to)}`);
        return;
    }
    if ((item.to === '/cart' && currentPath.value === '/marketplace') || (item.to === '/marketplace' && currentPath.value === '/cart')) {
        router.push({ path: item.to, query: router.currentRoute.value.query });
        return;
    }
    router.push(item.to);
}

function isMainNavActive(item) {
    const route = router.currentRoute.value;
    if (item.matchQuery) {
        return route.path === '/marketplace' && Object.entries(item.matchQuery).every(([key, value]) => route.query[key] === value);
    }
    if (item.to === '/marketplace') {
        return route.path === '/marketplace' && !['promotions', 'productset'].includes(route.query.category);
    }
    if (item.to === '/') {
        return route.path === '/';
    }
    return (item.match || []).some((path) => route.path === path || (path !== '/' && route.path.startsWith(`${path}/`)));
}

const mobileNavProps = computed(() => ({
    items: mobileMainNavItems.value,
    activePath: mobileMainNavItems.value.find(item =>
        item.to === '/marketplace' ? currentPath.value === item.to : isMainNavActive(item)
    )?.to,
    label: t('nav.menu'),
    authenticated: isAuthenticated.value,
    cartOpen: cartOpen.value,
    totalItems: totalItems.value
}));

const handleAuthAction = async () => {
    showUserMenu.value = false;
    if (isAuthenticated.value) {
        await authenStore.logout();
    } else {
        router.push('/auth/login');
    }
};

const toggleUserMenu = (event) => {
    event.stopPropagation();
    showUserMenu.value = !showUserMenu.value;
};

function closeAccountMenu() {
    showUserMenu.value = false;
    userButtonRef.value?.focus();
}

const handleClickOutside = (event) => {
    if (showUserMenu.value) {
        const clickedOutsideMenu = userMenuRef.value && !userMenuRef.value.contains(event.target);
        const clickedOutsideButton = userButtonRef.value && !userButtonRef.value.contains(event.target);
        if (clickedOutsideMenu && clickedOutsideButton) {
            showUserMenu.value = false;
        }
    }
};

// ลงทะเบียน event listener เมื่อคอมโพเนนต์ถูกโหลด
onMounted(() => {
    document.addEventListener('click', handleClickOutside);
    // ตรวจสอบการเปลี่ยนแปลงของ localStorage
    window.addEventListener('storage', checkAuthStatus);
    window.addEventListener('marketplace-auth-updated', checkAuthStatus);

    // เพิ่ม watcher เพื่อดักการเปลี่ยนแปลงของเส้นทาง
    watch(
        () => router.currentRoute.value.path,
        () => {
            cartOpen.value = false;
            showUserMenu.value = false;
        }
    );
});

// ลบ event listener เมื่อคอมโพเนนต์ถูกทำลาย
onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('storage', checkAuthStatus);
    window.removeEventListener('marketplace-auth-updated', checkAuthStatus);
});

// ตรวจสอบสถานะการล็อกอิน
const checkAuthStatus = () => {
    // อัพเดทสถานะการล็อกอินเมื่อมีการเปลี่ยนแปลงใน localStorage
    authVersion.value += 1;
};

</script>

<template>
    <div class="layout-topbar" :class="{ 'with-mobile-footer': hasMobileFooter }">
        <div class="layout-topbar-logo-container">
            <router-link to="/" class="layout-topbar-logo">
                <img v-if="appLogo" :src="appLogo" :alt="appName" class="topbar-app-logo" />
                <span>{{ appName }}</span>
            </router-link>
        </div>

        <nav v-if="showDesktopMainNav" class="desktop-main-nav" :aria-label="t('nav.menu')">
            <button
                v-for="item in mainNavItems"
                :key="item.to"
                type="button"
                class="desktop-main-nav-item"
                :class="{ active: isMainNavActive(item), 'admin-link': item.employeeOnly }"
                :aria-current="isMainNavActive(item) ? 'page' : undefined"
                @click="goToMainNav(item)"
            >
                <i :class="item.icon" aria-hidden="true"></i>
                <span>{{ item.label }}</span>
            </button>
        </nav>

        <div class="layout-topbar-actions">
            <div class="layout-config-menu">
                <LanguageSwitcher :key="currentPath" />

                <!-- Cart Icon with OverlayBadge and MiniCart -->
                <div class="relative topbar-cart">
                    <!-- OverlayBadge แสดงเฉพาะเมื่อล็อกอินแล้วและมีสินค้าในตะกร้า -->
                    <OverlayBadge v-if="isAuthenticated" :value="totalItems" severity="danger">
                        <button type="button" class="layout-topbar-action flex items-center justify-center" aria-haspopup="dialog" :aria-expanded="cartOpen" :aria-label="t('cart.cart')" @click="openCart">
                            <i class="pi pi-shopping-cart" style="font-size: 1.5rem" />
                            <span class="hidden sm:inline-block ml-2">{{ t('cart.cart') }}</span>
                        </button>
                    </OverlayBadge>

                    <!-- ปุ่มล็อกอินเมื่อไม่มี token -->
                    <button v-else type="button" class="layout-topbar-action flex items-center justify-center" @click="goToLogin">
                        <i class="pi pi-sign-in" />
                        <span class="hidden sm:inline-block ml-2">{{ t('nav.login') }}</span>
                    </button>


                </div>

                <div class="relative">
                    <button ref="userButtonRef" type="button" class="layout-topbar-action topbar-user flex items-center justify-center" @click="toggleUserMenu">
                        <i class="pi pi-user"></i>
                        <span class="hidden sm:inline-block ml-2">{{ t('nav.menu') }}</span>
                    </button>

                    <div v-if="showUserMenu" id="storefront-account-menu" ref="userMenuRef" class="user-menu-dropdown" @keydown.esc.stop="closeAccountMenu">
                        <div v-if="isAuthenticated" class="user-menu-summary">
                            <span>{{ isEmployee ? t('auth.employeeLogin') : t('auth.customerLogin') }}</span>
                            <strong>{{ currentUserLabel }}</strong>
                            <small v-if="isEmployee">{{ t('auth.selectedCustomer', { name: currentCustomerLabel }) }}</small>
                        </div>
                        <button v-if="isEmployee" type="button" class="user-menu-item highlight" @click="changeCustomer">
                            <i class="pi pi-sync"></i>
                            {{ t('auth.changeCustomer') }}
                        </button>
                        <button type="button" class="user-menu-item" @click="goToHome">
                            <i class="pi pi-home"></i>
                            {{ t('nav.home') }}
                        </button>

                        <button type="button" class="user-menu-item" @click="goToCatalog">
                            <i class="pi pi-list"></i>
                            {{ t('nav.catalog') }}
                        </button>

                        <button v-if="isAuthenticated" type="button" class="user-menu-item" @click="goToOrderHistory">
                            <i class="pi pi-shopping-cart"></i>
                            {{ t('nav.myOrders') }}
                        </button>

                        <button v-if="isAuthenticated" type="button" class="user-menu-item" @click="goToFavorites">
                            <i class="pi pi-heart"></i>
                            {{ t('nav.myFavorites') }}
                        </button>

                        <button v-if="isAuthenticated" type="button" class="user-menu-item" @click="goToProfile">
                            <i class="pi pi-user-edit"></i>
                            {{ t('nav.profile') }}
                        </button>

                        <button v-if="isAuthenticated" type="button" class="user-menu-item" @click="goToDocHistory">
                            <i class="pi pi-fw pi-file"></i>
                            {{ t('nav.documentHistory') }}
                        </button>

                        <button v-if="isAuthenticated" type="button" class="user-menu-item" @click="goToAdvancePaymentHistory">
                            <i class="pi pi-fw pi-wallet"></i>
                            {{ t('nav.advancePaymentHistory') }}
                        </button>

                        <button v-if="hasAdminAccess" type="button" class="user-menu-item" @click="goToContentAdmin">
                            <i class="pi pi-pencil"></i>
                            {{ t('nav.admin') }}
                        </button>
                        <button type="button" class="user-menu-item danger" @click="handleAuthAction">
                            <i class="pi" :class="isAuthenticated ? 'pi-sign-out' : 'pi-sign-in'"></i>
                            {{ isAuthenticated ? t('nav.logout') : t('nav.login') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <MobileMainNav v-if="hasMobileFooter" v-bind="mobileNavProps" @navigate="goToMobileMainNav" />
    <CartOverlay v-if="isAuthenticated" v-model:visible="cartOpen" />
</template>

<style scoped>
.layout-topbar {
    background: var(--market-header-bg, #f7ebcf);
    border-radius: 0;
    margin: 0;
    width: 100vw;
    max-width: 100vw;
    margin-left: calc(50% - 50vw);
    margin-right: calc(50% - 50vw);
    box-shadow: 0 6px 16px color-mix(in srgb, var(--market-header-text, #5b4a27) 18%, transparent);
}

@media (min-width: 901px) {
    .layout-topbar {
        width: 100%;
        margin-inline: 0;
        padding-inline: clamp(1rem, 2vw, 2.25rem);
        gap: clamp(.6rem, 1.4vw, 1.75rem);
        background: #fff;
        border-bottom: 1px solid color-mix(in srgb, var(--market-primary) 15%, white);
        box-shadow: none;
    }

    .layout-topbar .layout-topbar-logo-container {
        width: auto;
        max-width: 23%;
        min-width: 0;
    }

    .layout-topbar-logo { min-width: 0; }
    .layout-topbar-logo span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .desktop-main-nav {
        display: flex;
        align-self: stretch;
        align-items: stretch;
        gap: clamp(.1rem, .65vw, .85rem);
        min-width: 0;
        margin-inline-end: auto;
        overflow-x: auto;
        scrollbar-width: thin;
    }

    .desktop-main-nav-item {
        position: relative;
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: .4rem;
        padding: 0 clamp(.25rem, .5vw, .65rem);
        border: 0;
        background: transparent;
        color: #303044;
        white-space: nowrap;
        font-size: .95rem;
        font-weight: 600;
        cursor: pointer;
    }

    .desktop-main-nav-item:hover,
    .desktop-main-nav-item.active { color: var(--market-primary); }

    .desktop-main-nav-item.active::after {
        content: '';
        position: absolute;
        inset-inline: .25rem;
        bottom: .25rem;
        height: 3px;
        border-radius: 3px;
        background: currentColor;
    }

    .desktop-main-nav-item:focus-visible {
        outline: 2px solid var(--market-primary);
        outline-offset: -3px;
    }

    .desktop-main-nav-item.admin-link::before {
        content: '';
        height: 1.25rem;
        width: 1px;
        margin-inline-end: .45rem;
        background: var(--market-card-border);
    }

    .layout-topbar .layout-topbar-actions { margin-left: 0; flex: none; }

    :global(.layout-main-container) { padding-top: 4rem !important; }
}

@media (min-width: 901px) and (max-width: 1200px) {
    .layout-topbar { gap: .6rem; padding-inline: .75rem; }
    .layout-topbar .layout-topbar-logo-container { max-width: 13rem; }
    .layout-topbar .layout-config-menu { gap: .4rem; }
    .desktop-main-nav { gap: .12rem; }
    .desktop-main-nav-item { padding-inline: .35rem; gap: .25rem; font-size: .9rem; }
}

@media (min-width: 901px) and (max-width: 980px) {
    .desktop-main-nav-item i { display: none; }
}

:deep(.layout-topbar-logo span) {
    font-family: 'Raleway', sans-serif;
    font-weight: 900;
    font-size: 1.25rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: linear-gradient(135deg, var(--market-primary, #0f9f6e) 0%, var(--market-accent, #f97316) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

.topbar-app-logo {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0;
    object-fit: contain;
}

:deep(.layout-topbar-action) {
    background: color-mix(in srgb, var(--market-card-bg, #fff) 88%, var(--market-header-bg, #f7ebcf));
    border: 1px solid color-mix(in srgb, var(--market-card-border, #efe3c8) 78%, var(--market-primary, #0f9f6e));
    color: var(--market-header-text, #5b4a27);
    border-radius: 999px;
    padding: 0.38rem 0.72rem;
    transition: all 160ms ease;
}

:deep(.layout-topbar-action:hover) {
    background: var(--market-card-bg, #fff);
    color: var(--market-primary, #0f9f6e);
    transform: translateY(-1px);
}

.topbar-account-context {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    max-width: 320px;
    min-height: 2.75rem;
    padding: 0.38rem 0.75rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 88%, var(--market-header-bg, #f7ebcf));
    border: 1px solid color-mix(in srgb, var(--market-card-border, #efe3c8) 78%, var(--market-primary, #0f9f6e));
    color: var(--market-header-text, #5b4a27);
}

.topbar-account-context.employee {
    background: var(--market-primary-soft, rgba(236, 253, 245, 0.9));
    border-color: color-mix(in srgb, var(--market-primary, #0f9f6e) 32%, var(--market-card-border, #efe3c8));
    color: var(--market-primary, #047857);
}

.topbar-account-context > i {
    width: 1.85rem;
    height: 1.85rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 76%, transparent);
    flex: 0 0 auto;
}

.account-context-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.15;
}

.account-context-label,
.account-context-text small {
    font-size: 0.7rem;
    opacity: 0.78;
}

.account-context-text strong {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.86rem;
}

.account-context-text small {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 0.12rem;
}

.user-menu-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 0.45rem);
    min-width: 220px;
    border-radius: 0.8rem;
    background: linear-gradient(140deg, var(--market-card-bg, #ffffff) 0%, var(--market-surface-soft, #fdf8ee) 100%);
    border: 1px solid var(--market-card-border, #efe3c8);
    box-shadow: 0 10px 22px var(--market-shadow, rgba(140, 111, 53, 0.2));
    padding: 0.35rem;
    z-index: 1200;
}

.user-menu-summary {
    display: grid;
    gap: 0.15rem;
    margin: 0.15rem 0.15rem 0.35rem;
    padding: 0.7rem;
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 88%, transparent);
    border: 1px solid var(--market-card-border, #efe3c8);
    color: var(--market-text, #5b4a27);
}

.user-menu-summary span,
.user-menu-summary small {
    color: var(--market-muted, #8a6f37);
    font-size: 0.74rem;
}

.user-menu-summary strong {
    font-size: 0.9rem;
    overflow-wrap: anywhere;
}

.user-menu-item {
    width: 100%;
    border: none;
    background: transparent;
    padding: 0.65rem 0.7rem;
    border-radius: 0.55rem;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    color: var(--market-text, #5b4a27);
    text-align: left;
    font-size: 0.88rem;
    cursor: pointer;
}

.user-menu-item:hover {
    background: var(--market-primary-soft, color-mix(in srgb, var(--market-primary, #0f9f6e) 10%, #fff));
    color: var(--market-primary, #0f9f6e);
}

.user-menu-item.highlight {
    color: var(--market-primary, #047857);
    background: var(--market-primary-soft, #ecfdf5);
}

.user-menu-item.highlight:hover {
    background: color-mix(in srgb, var(--market-primary, #0f9f6e) 18%, var(--market-card-bg, #fff));
}

.user-menu-item.danger {
    color: var(--market-text, #5b4a27);
}

@media (max-width: 900px) {
    .desktop-main-nav {
        display: none;
    }

    :global(.layout-wrapper) {
        --market-mobile-nav-height: 64px;
        --market-header-height: 4rem;
    }

    .with-mobile-footer .topbar-cart,
    .with-mobile-footer .topbar-user {
        display: none;
    }

    .with-mobile-footer .user-menu-dropdown {
        position: fixed;
        top: auto;
        right: max(8px, env(safe-area-inset-right));
        bottom: calc(var(--market-mobile-nav-height) + env(safe-area-inset-bottom) + 4px);
        max-height: calc(100dvh - var(--market-mobile-nav-height) - env(safe-area-inset-bottom) - var(--market-header-height) - 10px);
        overflow-y: auto;
        overscroll-behavior: contain;
    }

    :global(.layout-main-container) { padding-top: var(--market-header-height, 4rem) !important; }
    :global(.layout-wrapper:has(.cart-step-shell) > .layout-topbar) { position: relative; }
    :global(.layout-wrapper:has(.cart-step-shell) > .layout-main-container) { padding-top: 0 !important; }
    :global(.mobile-main-nav ~ .layout-main-container) {
        padding-bottom: calc(var(--market-mobile-nav-height) + env(safe-area-inset-bottom));
    }
    :global(.mobile-main-nav ~ .layout-main-container .footer-actions) {
        bottom: calc(var(--market-mobile-nav-height) + env(safe-area-inset-bottom) + .25rem);
    }

    .topbar-account-context {
        max-width: 210px;
    }

    .account-context-text strong,
    .account-context-text small {
        max-width: 9rem;
    }
}

@media (max-width: 640px) {
    .topbar-account-context {
        max-width: 2.75rem;
        width: 2.75rem;
        padding: 0.38rem;
        justify-content: center;
    }

    .account-context-text {
        display: none;
    }

    .user-menu-dropdown {
        min-width: 190px;
        right: -0.4rem;
    }

}
</style>
