<script setup>
import ProductService from '@/services/ProductService';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName } from '@/utils/languageDisplay';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
    showLabel: {
        type: Boolean,
        default: true
    }
});

const router = useRouter();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = languageStore.t;
const showMiniCart = ref(false);
const miniCartTimeout = ref(null);
const miniCartRef = ref(null);
const cartButtonRef = ref(null);

// ตรวจสอบการล็อกอิน
const isAuthenticated = computed(() => {
    return !!localStorage.getItem('_token');
});

// ตัวช่วยแสดงจำนวนในรูปแบบที่เหมาะสม
const formatTotal = (value) => {
    return new Intl.NumberFormat('th-TH').format(value);
};

// คำนวณจำนวนสินค้าในตะกร้า
const totalItems = computed(() => cartStore.totalItems);
const totalAmount = computed(() => cartStore.totalAmount);

// แสดงเฉพาะ 3 รายการล่าสุด
const recentItems = computed(() => {
    return [...cartStore.cartItems].slice(0, 3);
});

function getItemDisplayName(item) {
    return pickProductName(item, languageStore.locale) || item?.display_name || item?.item_name || item?.name || '';
}

function getItemImage(item) {
    const itemCode = item?.item_code || item?.code || item?.id;
    if (itemCode && ProductService.shouldBypassProductImageCache(item)) {
        return ProductService.getProductImageUrl(itemCode, item);
    }
    return item?.image || (itemCode ? ProductService.getProductImageUrl(itemCode, item) : ProductService.getPlaceholderImage());
}

// มีรายการที่ไม่แสดงอีกกี่รายการ
const hiddenItemsCount = computed(() => {
    return Math.max(0, totalItems.value - recentItems.value.length);
});

const goToCart = () => {
    showMiniCart.value = false;

    // ตรวจสอบว่ามีการล็อกอินหรือไม่
    if (!isAuthenticated.value) {
        // ถ้ายังไม่ได้ล็อกอิน ให้ไปที่หน้า login พร้อม redirect กลับมาที่หน้า cart
        router.push('/auth/login?redirect=/cart');
        return;
    }

    router.push('/cart');
};

const goToLogin = () => {
    showMiniCart.value = false;
    router.push('/auth/login?redirect=/cart');
};

// ตรวจสอบขนาดจอ
const isMobileScreen = () => {
    return window.innerWidth < 640; // sm breakpoint คือ 640px ใน Tailwind
};

// แสดง/ซ่อน MiniCart เมื่อคลิกที่ไอคอนตะกร้า
const toggleMiniCart = (event) => {
    event.stopPropagation(); // ป้องกันการทำงานของ event อื่นๆ

    // ถ้าเป็นหน้าจอขนาด sm หรือเล็กกว่า ให้ไปหน้าตะกร้าโดยตรง
    if (isMobileScreen()) {
        goToCart();
        return;
    }

    // หน้าจอขนาดใหญ่กว่า sm ให้เปิด/ปิด MiniCart
    showMiniCart.value = !showMiniCart.value;
};

// แสดง MiniCart
const showMiniCartHandler = () => {
    clearTimeout(miniCartTimeout.value);
    showMiniCart.value = true;
};

// ซ่อน MiniCart หลังจากผ่านไป 300ms
const hideMiniCartWithDelay = () => {
    miniCartTimeout.value = setTimeout(() => {
        showMiniCart.value = false;
    }, 300);
};

// ลบสินค้าออกจากตะกร้า
const removeItem = (itemId, event) => {
    event.preventDefault(); // ป้องกัน router-link เปิดหน้ารายละเอียดสินค้าระหว่างกดลบ
    event.stopPropagation(); // ป้องกันการนำทางไปยังหน้ารายละเอียดสินค้า
    cartStore.removeFromCart(itemId);
};

// ตรวจสอบการคลิกนอก MiniCart
const handleClickOutside = (event) => {
    if (showMiniCart.value) {
        // ตรวจสอบว่าคลิกข้างนอก MiniCart และไม่ได้คลิกที่ปุ่มตะกร้า
        if (miniCartRef.value && !miniCartRef.value.contains(event.target) && cartButtonRef.value && !cartButtonRef.value.contains(event.target)) {
            showMiniCart.value = false;
        }
    }
};

// ตรวจสอบขนาดหน้าจอเมื่อมีการเปลี่ยนแปลง
const handleResize = () => {
    // ปิด MiniCart บนหน้าจอขนาดเล็กเสมอ
    if (isMobileScreen() && showMiniCart.value) {
        showMiniCart.value = false;
    }
};

// ลงทะเบียน event listener เมื่อคอมโพเนนต์ถูกโหลด
onMounted(() => {
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('resize', handleResize);

    // ตรวจสอบเริ่มต้น
    handleResize();
});

// ลบ event listener เมื่อคอมโพเนนต์ถูกทำลาย
onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('resize', handleResize);
    clearTimeout(miniCartTimeout.value);
});
</script>

<template>
    <div class="relative">
        <!-- OverlayBadge อยู่ด้านนอกปุ่มเพื่อให้แสดง value ได้ถูกต้อง -->
        <OverlayBadge :value="totalItems" severity="danger">
            <button ref="cartButtonRef" type="button" :aria-label="t('cart.cart')" class="layout-topbar-action flex items-center justify-center" @click="toggleMiniCart" @mouseenter="showMiniCartHandler" @mouseleave="hideMiniCartWithDelay">
                <i class="pi pi-shopping-cart" style="font-size: 1.5rem" />
                <span v-if="props.showLabel" class="hidden sm:inline-block ml-2">{{ t('cart.cart') }}</span>
            </button>
        </OverlayBadge>

        <!-- Mini Cart Dropdown -->
        <div v-if="showMiniCart" ref="miniCartRef" class="absolute top-full right-0 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg z-50 p-4 mt-2" @mouseenter="showMiniCartHandler" @mouseleave="hideMiniCartWithDelay">
            <div class="flex justify-between items-center pb-2 mb-4 border-b border-gray-100 dark:border-gray-700">
                <h3 class="text-base font-semibold m-0">{{ t('cart.cart') }}</h3>
                <span class="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 py-1 px-2 rounded-full"> {{ t('cart.itemCount', { count: totalItems }) }} </span>
            </div>

            <div v-if="recentItems.length === 0" class="flex flex-col items-center justify-center py-8 text-gray-500">
                <i class="pi pi-shopping-cart text-3xl text-gray-300 mb-2"></i>
                <p>{{ t('cart.empty') }}</p>

                <!-- เพิ่มปุ่ม Login สำหรับตะกร้าว่างเมื่อยังไม่ได้เข้าสู่ระบบ -->
                <div v-if="!isAuthenticated" class="mt-4 w-full">
                    <div class="mb-3 text-center text-xs text-gray-500">{{ t('miniCart.loginRequired') }}</div>
                    <Button :label="t('nav.login')" icon="pi pi-sign-in" class="w-full text-sm" @click="goToLogin" />
                </div>
            </div>

            <div v-else>
                <div class="max-h-72 overflow-y-auto">
                    <router-link v-for="item in recentItems" :key="item.id" :to="`/products/${item.id}`" class="flex items-center py-3 border-b border-gray-100 dark:border-gray-700 no-underline text-inherit hover:bg-gray-50 dark:hover:bg-gray-700">
                        <div class="w-12 h-12 mr-3 rounded overflow-hidden border border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <img :src="getItemImage(item)" :alt="getItemDisplayName(item)" class="w-full h-full object-contain" />
                        </div>
                        <div class="flex-1">
                            <div class="text-sm font-medium mb-1 truncate max-w-[180px]">{{ getItemDisplayName(item) }}</div>
                            <div class="text-xs text-gray-500 dark:text-gray-400">{{ item.quantity }} x ฿{{ formatTotal(item.price) }}</div>
                        </div>
                        <button type="button" class="bg-transparent border-0 cursor-pointer p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full" :aria-label="`${t('cart.remove')} ${getItemDisplayName(item)}`" @click="(e) => removeItem(item.id, e)">
                            <i class="pi pi-times text-xs"></i>
                        </button>
                    </router-link>
                </div>

                <div v-if="hiddenItemsCount > 0" class="text-center text-xs text-gray-500 py-2 italic">{{ t('cart.moreItems', { count: hiddenItemsCount }) }}</div>

                <div class="flex justify-between items-center py-3 mt-2 border-t border-gray-100 dark:border-gray-700 font-medium">
                    <span>{{ t('cart.total') }}</span>
                    <span class="text-base font-semibold text-primary">฿{{ formatTotal(totalAmount) }}</span>
                </div>

                <!-- ปุ่มกดเมื่อเข้าสู่ระบบแล้ว -->
                <div v-if="isAuthenticated" class="grid grid-cols-2 gap-2 mt-4">
                    <Button :label="t('miniCart.viewCart')" class="p-button-outlined text-sm p-2" @click="goToCart" />
                    <Button :label="t('cart.checkout')" severity="success" class="text-sm p-2" @click="goToCart" />
                </div>

                <!-- ปุ่มกดเมื่อยังไม่ได้เข้าสู่ระบบ -->
                <div v-else class="mt-4">
                    <div class="mb-3 text-center text-xs text-gray-500">{{ t('miniCart.loginRequired') }}</div>
                    <Button :label="t('nav.login')" icon="pi pi-sign-in" class="w-full text-sm" @click="goToLogin" />
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* Override OverlayBadge default styles */
:deep(.p-overlay-badge) {
    margin-right: 0.5rem;
}

/* Override dark mode styles that can't be handled by Tailwind */
:deep(.dark) .layout-topbar-action {
    background-color: var(--surface-overlay);
    color: var(--text-color);
}
</style>
