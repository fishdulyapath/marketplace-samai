<script setup>
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
const showMiniCart = ref(false);
const miniCartTimeout = ref(null);
const cartButtonRef = ref(null);
const userMenuRef = ref(null);
const userButtonRef = ref(null);
const showUserMenu = ref(false);
const authVersion = ref(0);
const languageOptions = computed(() => languageStore.options);
const selectedLocale = computed(() => languageStore.locale);
const languageSelectLabel = computed(() => languageStore.t('language.select'));
const t = (key, params) => languageStore.t(key, params);
const isCartPage = computed(() => {
    return router.currentRoute.value.path === '/cart';
});
const currentPath = computed(() => router.currentRoute.value.path);
const showDesktopMainNav = computed(() => !!currentPath.value);
const mainNavItems = computed(() => {
    const items = [
        { label: t('nav.home'), icon: 'pi pi-home', to: '/', match: ['/'] },
        { label: t('nav.marketplace'), icon: 'pi pi-th-large', to: '/marketplace', match: ['/marketplace'] },
        { label: t('nav.promotions'), icon: 'pi pi-tag', to: '/marketplace?category=promotions', matchQuery: { category: 'promotions' } },
        { label: t('nav.productSet'), icon: 'pi pi-box', to: '/marketplace?category=productset', matchQuery: { category: 'productset' } },
        { label: t('nav.orders'), icon: 'pi pi-shopping-bag', to: '/orders-history', authOnly: true, match: ['/orders-history'] }
    ];

    if (isEmployee.value) {
        items.push({ label: t('nav.admin'), icon: 'pi pi-cog', to: '/admin', employeeOnly: true, match: ['/admin'] });
    }

    return items.filter((item) => (!item.authOnly || isAuthenticated.value) && (!item.employeeOnly || isEmployee.value));
});

// ── ช่องค้นหาบนแถบหัว ────────────────────────────────────────────────
// ไม่ย้าย state การค้นหาออกจาก ProductList (มันพันกับ debounce/โหลดราคา/ตัวกรอง)
// ที่นี่ทำหน้าที่แค่เขียน q ลง URL แล้วปล่อยให้ ProductList รับไปทำงานต่อ
const topbarSearch = ref(router.currentRoute.value.query.q || '');
const TOPBAR_SEARCH_DEBOUNCE_MS = 1500;
let topbarSearchTimeout = null;

// ผู้ใช้กด back/forward หรือกดล้างค่าในหน้าแคตตาล็อก → ช่องบนหัวต้องตามด้วย
watch(
    () => router.currentRoute.value.query.q,
    (q) => {
        const next = typeof q === 'string' ? q : '';
        if (next !== topbarSearch.value) topbarSearch.value = next;
    }
);

function submitTopbarSearch() {
    if (topbarSearchTimeout) {
        clearTimeout(topbarSearchTimeout);
        topbarSearchTimeout = null;
    }

    const q = String(topbarSearch.value || '').trim();
    const route = router.currentRoute.value;
    const query = { ...route.query };

    if (q) query.q = q;
    else delete query.q;

    // อยู่หน้าที่ค้นหาได้อยู่แล้วก็แค่เปลี่ยน query (replace ไม่ให้ประวัติรก)
    // 🚨 ต้องรวม /favorites ด้วย ไม่งั้นพิมพ์ค้นหาในหน้ารายการโปรดแล้วจะถูกเด้ง
    //    ออกไปหน้าสินค้าทั้งหมด ซึ่งไม่ใช่สิ่งที่ผู้ใช้ตั้งใจ
    const SEARCHABLE_PATHS = ['/marketplace', '/favorites'];
    if (SEARCHABLE_PATHS.includes(route.path)) router.replace({ path: route.path, query });
    else router.push({ path: '/marketplace', query: q ? { q } : {} });
}

function scheduleTopbarSearch() {
    if (topbarSearchTimeout) clearTimeout(topbarSearchTimeout);
    topbarSearchTimeout = setTimeout(() => {
        topbarSearchTimeout = null;
        submitTopbarSearch();
    }, TOPBAR_SEARCH_DEBOUNCE_MS);
}

function clearTopbarSearch() {
    if (topbarSearchTimeout) {
        clearTimeout(topbarSearchTimeout);
        topbarSearchTimeout = null;
    }
    topbarSearch.value = '';
    submitTopbarSearch();
}

// แถบเมนูล่างบนมือถือ — 5 ปุ่มแบบแอปช้อปปิ้ง
// 'คำสั่งซื้อ' มี authOnly ถ้ายังไม่ล็อกอินจะเหลือ 4 ปุ่ม ซึ่ง grid auto-fit รองรับเอง
const mobileMainNavItems = computed(() =>
    [
        { label: t('nav.home'), icon: 'pi pi-home', to: '/', match: ['/'] },
        { label: t('nav.marketplace'), icon: 'pi pi-th-large', to: '/marketplace', match: ['/marketplace'] },
        { label: t('cart.cart'), icon: 'pi pi-shopping-cart', to: '/cart', match: ['/cart'], badge: true },
        { label: t('nav.orders'), icon: 'pi pi-shopping-bag', to: '/orders-history', authOnly: true, match: ['/orders-history'] },
        { label: t('nav.account'), icon: 'pi pi-user', to: '/profile', match: ['/profile'] }
    ].filter((item) => !item.authOnly || isAuthenticated.value)
);

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

// ตัวช่วยแสดงจำนวนในรูปแบบที่เหมาะสม
// คำนวณจำนวนสินค้าในตะกร้า
const totalItems = computed(() => cartStore.totalItems);
const totalAmount = computed(() => cartStore.totalAmount);
const totalCartLines = computed(() => Math.max(cartStore.totalCartCount || 0, cartStore.cartItems.length));

const goToCart = async () => {
    showMiniCart.value = false;

    // ตรวจสอบว่ามีการล็อกอินหรือไม่
    if (!isAuthenticated.value) {
        // ถ้ายังไม่ได้ล็อกอิน ให้ไปที่หน้า login พร้อม redirect กลับมาที่หน้า cart
        router.push('/auth/login?redirect=/cart');
        return;
    }

    try {
        // ตรวจสอบให้แน่ใจว่าข้อมูลตะกร้าถูกโหลดก่อนนำทางไป
        await cartStore.loadCartItems();
        // นำทางไปยังหน้าตะกร้า
        router.push('/cart');
    } catch (error) {
        console.error('Error loading cart items:', error);
    }
};

const goToLogin = () => {
    showMiniCart.value = false;
    router.push('/auth/login?redirect=/cart');
};

const goToCatalog = () => {
    showUserMenu.value = false;
    router.push('/marketplace');
};

// รายการโปรดของฉัน (รีวิว 260908 สไลด์ 9) — เดิมกดหัวใจแล้วไม่มีทางเข้าไปดู
const goToFavorites = () => {
    showUserMenu.value = false;
    router.push('/favorites');
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

const goToProfile = () => {
    showUserMenu.value = false;
    router.push('/profile');
};

function goToMainNav(item) {
    showUserMenu.value = false;
    showMiniCart.value = false;
    router.push(item.to);
}

function goToMobileMainNav(item) {
    showUserMenu.value = false;
    showMiniCart.value = false;
    if (item.authOnly && !isAuthenticated.value) {
        router.push(`/auth/login?redirect=${encodeURIComponent(item.to)}`);
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
        return route.path === '/marketplace' && !route.query.category;
    }
    if (item.to === '/') {
        return route.path === '/';
    }
    return (item.match || []).some((path) => route.path === path || (path !== '/' && route.path.startsWith(`${path}/`)));
}

function isMobileMainNavActive(item) {
    const route = router.currentRoute.value;
    if (item.to === '/marketplace') {
        return route.path === '/marketplace';
    }
    return isMainNavActive(item);
}

const handleAuthAction = async () => {
    showUserMenu.value = false;
    if (isAuthenticated.value) {
        await authenStore.logout();
    } else {
        router.push('/auth/login');
    }
};

const handleLanguageChange = (event) => {
    languageStore.setLocale(event.target.value);
    showUserMenu.value = false;
};

const toggleUserMenu = (event) => {
    event.stopPropagation();
    showUserMenu.value = !showUserMenu.value;
};

// จอแคบจริงๆ (< sm) → กดตะกร้าแล้วไปหน้า /cart เลย ไม่เปิด MiniCart ที่แสดงไม่พอ
// 🚨 ห้ามเปลี่ยนเป็น isMobileNav (lg) — แท็บเล็ตจะเลิกเห็น MiniCart ทั้งที่จอกว้างพอ
// (คอมเมนต์เดิมเขียนว่า "sm breakpoint คือ 640px ใน Tailwind" ซึ่งผิด — config ตั้ง sm ไว้ 576px)
// เปลี่ยนจากการนำทางไปหน้าตะกร้าเป็นการแสดง MiniCart
const toggleMiniCart = async (event) => {
    event.stopPropagation();

    // ถ้าอยู่ในหน้า CartView ให้ไม่ทำอะไร และไม่แสดง MiniCart
    if (isCartPage.value) {
        return;
    }

    // เดิมจอเล็กจะเด้งไปหน้า /cart เพราะ dropdown แคบเกินจะใช้งานได้
    // ตอนนี้ overlay เต็มจอบนมือถืออยู่แล้ว จึงเปิดได้ทุกขนาดจอ
    // (CartOverlay โหลดตะกร้าล่าสุดเองตอนถูกเปิด)
    showMiniCart.value = !showMiniCart.value;
};

// ตรวจสอบการคลิกนอกเมนูผู้ใช้
// (ตะกร้าไม่ต้องเช็คแล้ว — CartOverlay มี scrim ปิดตัวเองอยู่)
const handleClickOutside = (event) => {
    if (showUserMenu.value) {
        const clickedOutsideMenu = userMenuRef.value && !userMenuRef.value.contains(event.target);
        const clickedOutsideButton = userButtonRef.value && !userButtonRef.value.contains(event.target);
        if (clickedOutsideMenu && clickedOutsideButton) {
            showUserMenu.value = false;
        }
    }
};

// ตรวจสอบขนาดหน้าจอเมื่อมีการเปลี่ยนแปลง
// (ตะกร้า overlay ใช้ได้ทุกขนาดจอแล้ว จึงไม่ต้องปิดตอนย่อจออีก)
const handleResize = () => {};

// ลงทะเบียน event listener เมื่อคอมโพเนนต์ถูกโหลด
onMounted(() => {
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('resize', handleResize);

    // ตรวจสอบเริ่มต้น
    handleResize();

    // ตรวจสอบการเปลี่ยนแปลงของ localStorage
    window.addEventListener('storage', checkAuthStatus);
    window.addEventListener('marketplace-auth-updated', checkAuthStatus);

    // เพิ่ม watcher เพื่อดักการเปลี่ยนแปลงของเส้นทาง
    watch(
        () => router.currentRoute.value.path,
        (newPath) => {
            // ถ้าเข้าหน้า CartView ให้ปิด MiniCart
            if (newPath === '/cart') {
                showMiniCart.value = false;
            }

            showUserMenu.value = false;
        }
    );
});

// ลบ event listener เมื่อคอมโพเนนต์ถูกทำลาย
onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('storage', checkAuthStatus);
    window.removeEventListener('marketplace-auth-updated', checkAuthStatus);
    clearTimeout(miniCartTimeout.value);
    if (topbarSearchTimeout) clearTimeout(topbarSearchTimeout);
});

// ตรวจสอบสถานะการล็อกอิน
const checkAuthStatus = () => {
    // อัพเดทสถานะการล็อกอินเมื่อมีการเปลี่ยนแปลงใน localStorage
    authVersion.value += 1;
};

</script>

<template>
    <div class="layout-topbar">
        <div class="layout-topbar-logo-container">
            <router-link to="/" class="layout-topbar-logo">
                <img v-if="appLogo" :src="appLogo" :alt="appName" class="topbar-app-logo" />
                <span>{{ appName }}</span>
            </router-link>
        </div>

        <!-- ช่องค้นหาบนแถบหัว — ค้นได้จากทุกหน้า ไม่ต้องเข้าหน้าแคตตาล็อกก่อน
             ส่ง q ลง URL แล้วให้ ProductList รับผ่าน watch (URL เป็นแหล่งความจริงเดียว)
             ทำให้ลิงก์ผลค้นหาแชร์ได้และปุ่ม back ของเบราว์เซอร์ทำงานถูก -->
        <form class="topbar-search" role="search" @submit.prevent="submitTopbarSearch">
            <i class="pi pi-search topbar-search-icon"></i>
            <input
                v-model="topbarSearch"
                type="search"
                class="topbar-search-input"
                :placeholder="t('catalog.searchPlaceholder')"
                :aria-label="t('catalog.searchPlaceholder')"
                enterkeyhint="search"
                @input="scheduleTopbarSearch"
            />
            <button v-if="topbarSearch" type="button" class="topbar-search-clear" :aria-label="t('common.clearSearch')" @click="clearTopbarSearch">
                <i class="pi pi-times"></i>
            </button>
        </form>

        <div class="layout-topbar-actions">
            <div class="layout-config-menu">
                <div class="language-switcher" :title="languageSelectLabel" @click.stop>
                    <i class="pi pi-globe"></i>
                    <select class="language-select" :value="selectedLocale" :aria-label="languageSelectLabel" @change="handleLanguageChange">
                        <option v-for="option in languageOptions" :key="option.code" :value="option.code">
                            {{ option.shortLabel }}
                        </option>
                    </select>
                </div>

                <!-- Cart Icon with OverlayBadge and MiniCart -->
                <div class="relative">
                    <!-- OverlayBadge แสดงเฉพาะเมื่อล็อกอินแล้วและมีสินค้าในตะกร้า -->
                    <OverlayBadge v-if="isAuthenticated" :value="totalItems" severity="danger">
                        <button ref="cartButtonRef" type="button" class="layout-topbar-action flex items-center justify-center" @click="toggleMiniCart">
                            <i class="pi pi-shopping-cart" style="font-size: 1.5rem" />
                            <span class="hidden sm:inline-block ml-2">{{ t('cart.cart') }}</span>
                        </button>
                    </OverlayBadge>

                    <!-- ปุ่มล็อกอินเมื่อไม่มี token -->
                    <button v-else ref="cartButtonRef" type="button" class="layout-topbar-action flex items-center justify-center" @click="goToLogin">
                        <i class="pi pi-sign-in" />
                        <span class="hidden sm:inline-block ml-2">{{ t('nav.login') }}</span>
                    </button>

                    <!-- ตะกร้าแบบ overlay แทน dropdown เดิมที่โชว์ได้แค่ 3 รายการ
                         (รีวิว 260908 สไลด์ 4) — ตัวคอมโพเนนต์ teleport ไป body เอง -->
                    <CartOverlay v-if="isAuthenticated" v-model:visible="showMiniCart" />
                </div>

                <div class="relative">
                    <button ref="userButtonRef" type="button" class="layout-topbar-action flex items-center justify-center" @click="toggleUserMenu">
                        <i class="pi pi-user"></i>
                        <span class="hidden sm:inline-block ml-2">{{ t('nav.menu') }}</span>
                    </button>

                    <div v-if="showUserMenu" ref="userMenuRef" class="user-menu-dropdown">
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

                        <button v-if="isAuthenticated" type="button" class="user-menu-item" @click="goToFavorites">
                            <i class="pi pi-heart"></i>
                            {{ t('nav.myFavorites') }}
                        </button>

                        <button v-if="isAuthenticated" type="button" class="user-menu-item" @click="goToOrderHistory">
                            <i class="pi pi-shopping-cart"></i>
                            {{ t('nav.myOrders') }}
                        </button>

                        <button v-if="isAuthenticated" type="button" class="user-menu-item" @click="goToProfile">
                            <i class="pi pi-user-edit"></i>
                            {{ t('nav.profile') }}
                        </button>

                        <button v-if="isEmployee" type="button" class="user-menu-item" @click="goToContentAdmin">
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

    <nav v-if="showDesktopMainNav" class="desktop-main-nav" :aria-label="t('nav.menu')">
        <div class="desktop-main-nav-inner">
            <button v-for="item in mainNavItems" :key="item.to" type="button" class="desktop-main-nav-item" :class="{ active: isMainNavActive(item) }" @click="goToMainNav(item)">
                <i :class="item.icon"></i>
                <span>{{ item.label }}</span>
            </button>
        </div>
    </nav>

    <nav v-if="showDesktopMainNav" class="mobile-main-nav" :aria-label="t('nav.menu')">
        <button v-for="item in mobileMainNavItems" :key="item.to" type="button" class="mobile-main-nav-item" :class="{ active: isMobileMainNavActive(item) }" @click="goToMobileMainNav(item)">
            <span class="mobile-main-nav-icon">
                <i :class="item.icon"></i>
                <span v-if="item.badge && isAuthenticated && totalItems > 0" class="mobile-main-nav-badge">{{ totalItems > 99 ? '99+' : totalItems }}</span>
            </span>
            <span class="mobile-main-nav-label">{{ item.label }}</span>
        </button>
    </nav>
</template>

<style scoped>
.layout-topbar {
    background: var(--market-header-bg, #f7ebcf);
    border-bottom: 1px solid var(--shop-header-divider);
    border-radius: 0;
    margin: 0;
    /* เดิมใช้สูตร full-bleed (width:100vw + margin ติดลบ) ซึ่งใช้กับกล่องที่อยู่ในคอนเทนเนอร์แคบ
       แต่แถบนี้เป็น position:fixed; left:0; right:0 อยู่แล้ว — containing block จึงเท่ากับ
       viewport ที่หัก scrollbar ไปแล้ว พอบวก 100vw (ซึ่งรวม scrollbar) ทับเข้าไป
       แถบเลยเลื่อนออกนอกจอข้างละครึ่งของ scrollbar (วัดได้ left = -7.5px ที่จอ 768)
       ปล่อยให้ width: 100% ของ _topbar.scss ทำงานตามเดิมจึงตรงพอดี */
    box-shadow: 0 2px 8px color-mix(in srgb, var(--market-header-text, #5b4a27) 8%, transparent);
}

/* บนมือถือซ่อนชื่อร้านที่เป็นข้อความ เหลือแค่โลโก้รูป เพื่อคืนพื้นที่ให้ช่องค้นหา
   (ชื่อร้านยังอยู่ใน alt ของรูปและใน <title> ของหน้า) */
@media (max-width: 575.98px) {
    :deep(.layout-topbar-logo span) {
        display: none;
    }

    .topbar-search {
        margin-left: 0.5rem;
        margin-right: 0.5rem;
    }
}

/* ── ช่องค้นหาบนแถบหัว ── */
.topbar-search {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 34rem;
    margin: 0 clamp(0.5rem, 2vw, 1.25rem);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 2.4rem;
    padding: 0 0.85rem;
    border-radius: var(--shop-radius-pill);
    background: var(--shop-search-bg);
    border: 1px solid color-mix(in srgb, var(--market-primary) 16%, var(--shop-border));
    box-shadow: none;
}

.topbar-search:focus-within {
    border-color: var(--market-primary);
    box-shadow: 0 0 0 3px var(--market-primary-soft);
}

.topbar-search-icon {
    color: var(--market-primary);
    font-size: 1rem;
    flex: 0 0 auto;
}

.topbar-search-input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--shop-search-on);
    font-size: 0.92rem;
    /* ซ่อนกากบาทของ input[type=search] ที่เบราว์เซอร์ใส่มาเอง เพราะมีปุ่มล้างของเราแล้ว */
    &::-webkit-search-cancel-button {
        appearance: none;
    }
}

.topbar-search-input::placeholder {
    color: var(--shop-search-placeholder);
}

.topbar-search-clear {
    flex: 0 0 auto;
    border: 0;
    background: transparent;
    color: var(--market-muted);
    cursor: pointer;
    padding: 0.2rem;
    line-height: 1;
}

.topbar-search-clear:hover {
    color: var(--market-text);
}

.desktop-main-nav {
    position: fixed;
    z-index: 996;
    left: 0;
    top: var(--app-topbar-h);
    /* min-height ล็อกความสูงให้ตรงกับตัวแปร — ของเดิมสูงตามเนื้อหา (45.5px บ้าง 47px บ้าง)
       ทำให้ padding-top ที่คำนวณไว้ล่วงหน้าไม่มีทางตรงกับความสูงจริง */
    min-height: var(--app-subnav-h);
    display: flex;
    align-items: center;
    width: 100%;
    background: var(--shop-header-bg);
    border-bottom: 1px solid var(--shop-header-divider);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--market-text) 8%, transparent);
}

.desktop-main-nav-inner {
    width: min(1380px, 100%);
    margin: 0 auto;
    padding: 0.2rem 1.05rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    overflow-x: auto;
    scrollbar-width: none;
}

.desktop-main-nav-inner::-webkit-scrollbar {
    display: none;
}

.desktop-main-nav-item {
    border: 0;
    background: transparent;
    color: var(--shop-header-on);
    border-radius: 999px;
    padding: 0.55rem 0.85rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.92rem;
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    min-height: 40px;
    transition: background 160ms ease, color 160ms ease, transform 160ms ease;
}

/* hover/active ต้องอิงสีตัวอักษรของหัว ไม่ใช่ primary
   เพราะบนพื้นหัวสีทึบ ปุ่มสี primary จะกลืนไปกับพื้น (เขียวบนเขียว) */
.desktop-main-nav-item:hover {
    background: color-mix(in srgb, var(--shop-header-on, #fff) 16%, transparent);
    color: var(--shop-header-on);
    transform: translateY(-1px);
}

.desktop-main-nav-item.active {
    background: var(--shop-header-on);
    color: var(--shop-header-bg);
    box-shadow: var(--shop-shadow-1);
}

.desktop-main-nav-item:focus-visible,
.mobile-main-nav-item:focus-visible,
.topbar-search-clear:focus-visible,
.language-select:focus-visible,
:deep(.layout-topbar-action:focus-visible) {
    outline: 3px solid color-mix(in srgb, var(--market-primary) 38%, transparent);
    outline-offset: 2px;
}

.mobile-main-nav {
    display: none;
}

/* เนื้อหาเริ่มพอดีใต้แถบตรึง — ค่าเดียวกับที่แถบค้นหา sticky ใช้ จึงไม่มีทางเหลื่อมกันอีก
   ด้านล่างเว้นที่ให้แถบเมนูมือถือ (บนเดสก์ท็อป --app-bottomnav-h เป็น 0 จึงไม่มีผล) */
:global(.layout-main-container) {
    padding-top: var(--app-header-total-h) !important;
    /* ต้องมี !important เหมือน padding-top เพราะ _main.scss ตั้ง padding แบบ shorthand
       (padding: 5rem 0.5rem 0 2rem) ซึ่งจะ reset padding-bottom เป็น 0 ทับค่านี้ */
    padding-bottom: calc(var(--app-bottomnav-h) + var(--app-safe-bottom) + 0.75rem) !important;
}

/* ชื่อร้านบนแถบหัว
 *
 * เดิมระบายด้วย linear-gradient(primary → accent) + -webkit-text-fill-color: transparent
 * ซึ่งทำให้ค่า color ที่ตั้งไว้ไม่มีผลเลย และสีที่เห็นจริงคือสีแบรนด์ที่เลือกมาให้เด่นบน
 * "การ์ดพื้นขาว" ไม่ใช่บนแถบหัว วัดจริงได้ contrast 1.52 (primary) และ 1.84 (accent)
 * เทียบกับเกณฑ์ WCAG AA ที่ต้องได้ 4.5 — อ่านแทบไม่ออกทั้งบนหัวเข้มและหัวอ่อน
 *
 * เปลี่ยนมาใช้สีข้อความของแถบหัวที่ผูกกับธีม ซึ่ง applyTheme() การันตี contrast ให้แล้ว */
:deep(.layout-topbar-logo span) {
    font-family: 'Raleway', sans-serif;
    font-weight: 900;
    font-size: 1.25rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--shop-header-on, var(--market-header-text, #ffffff));
}

.topbar-app-logo {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0;
    object-fit: contain;
}

.language-switcher {
    min-height: 2.55rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.34rem 0.55rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--shop-header-on, #fff) 14%, transparent);
    border: 1px solid var(--shop-header-divider);
    color: var(--shop-header-on);
}

.language-switcher i {
    font-size: 0.95rem;
}

.language-select {
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
}

:deep(.layout-topbar-action) {
    background: color-mix(in srgb, var(--shop-header-on, #fff) 14%, transparent);
    border: 1px solid var(--shop-header-divider);
    color: var(--shop-header-on);
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
    background: color-mix(in srgb, var(--shop-header-on, #fff) 14%, transparent);
    border: 1px solid var(--shop-header-divider);
    color: var(--shop-header-on);
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

.mini-cart-dropdown {
    background: linear-gradient(180deg, var(--market-card-bg, #ffffff) 0%, var(--market-surface-soft, #fdf8ee) 100%);
    border: 1px solid var(--market-card-border, #efe3c8);
    color: var(--market-text, #2f2412);
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

@media (max-width: 991.98px) {
    .desktop-main-nav {
        display: none;
    }

    /* แถบเมนูล่าง — พื้นขาวเพื่อให้แยกจากเนื้อหา และรองรับ safe area ของ iPhone
       z-index 996 เท่าเดิม: ต่ำกว่า topbar (997) และต่ำกว่า dialog/toast ของ PrimeVue */
    .mobile-main-nav {
        position: fixed;
        z-index: 996;
        left: 0;
        right: 0;
        top: auto;
        bottom: 0;
        width: 100%;
        /* height ตายตัว (ไม่ใช่ min-height) เพื่อให้ความสูงจริงเท่าตัวแปรเป๊ะเสมอ
           ปุ่มลอยทุกตัวคำนวณตำแหน่งจากตัวแปรนี้ ถ้าไม่ตรงจะโดนแถบเมนูทับ */
        height: calc(var(--app-bottomnav-h) + var(--app-safe-bottom));
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
        align-content: center;
        gap: 0.15rem;
        padding: 0.3rem 0.25rem calc(0.3rem + var(--app-safe-bottom));
        background: var(--shop-surface);
        border-top: 1px solid var(--shop-border);
        border-bottom: none;
        box-shadow: 0 -6px 18px color-mix(in srgb, var(--market-text) 10%, transparent);
    }

    /* ไอคอนบน ข้อความล่าง แบบแอปมือถือ */
    .mobile-main-nav-item {
        min-width: 0;
        border: 0;
        border-radius: var(--shop-radius-sm);
        background: transparent;
        color: var(--market-muted);
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.15rem;
        padding: 0.3rem 0.15rem;
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
    }

    .mobile-main-nav-icon {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
    }

    .mobile-main-nav-item i {
        font-size: 1.15rem;
        flex: 0 0 auto;
    }

    .mobile-main-nav-badge {
        position: absolute;
        top: -0.4rem;
        left: 0.65rem;
        min-width: 1.05rem;
        padding: 0 0.22rem;
        border-radius: var(--shop-radius-pill);
        background: var(--shop-badge-promo-bg);
        color: var(--shop-badge-promo-on);
        font-size: 0.62rem;
        font-weight: 800;
        line-height: 1.05rem;
        text-align: center;
    }

    .mobile-main-nav-label {
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 0.68rem;
    }

    /* ตัวที่เลือกอยู่: เปลี่ยนสีไอคอน+ข้อความ ไม่ใช่ถมพื้นเต็มปุ่ม
       เพราะแถบล่างปุ่มเล็กและติดกัน ถมพื้นแล้วดูหนักและอ่านยาก */
    .mobile-main-nav-item.active {
        background: var(--market-primary-soft);
        color: var(--market-primary);
        box-shadow: none;
    }

    /* padding-top ของมือถือไม่ต้องเขียนซ้ำแล้ว — --app-subnav-h สลับค่าเองที่ media query
       ใน styles.scss ซึ่งเป็นจุดเดียวที่คุมทั้ง nav, padding และ sticky-top พร้อมกัน */

    .topbar-account-context {
        max-width: 210px;
    }

    .account-context-text strong,
    .account-context-text small {
        max-width: 9rem;
    }
}

@media (max-width: 640px) {
    .mobile-main-nav {
        padding: 0.42rem 0.5rem;
        gap: 0.32rem;
    }

    .mobile-main-nav-item {
        padding: 0.54rem 0.25rem;
        font-size: 0.78rem;
    }

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

    .language-switcher {
        padding: 0.36rem 0.48rem;
    }

    .language-switcher i {
        display: none;
    }
}
</style>
