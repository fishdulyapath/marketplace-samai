<script setup>
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppMenuItem from './AppMenuItem.vue';
import EmployeeInfoDisplay from './EmployeeInfoDisplay.vue';

const cartStore = useCartStore();
const languageStore = useLanguageStore();
const router = useRouter();
const route = useRoute();
const t = (key, params) => languageStore.t(key, params);

// คำนวณจำนวนสินค้าในตะกร้า
const cartItemCount = computed(() => cartStore.totalItems);
const isLoggedIn = ref(!!localStorage.getItem('_token'));
const userName = ref('');
const isEmployee = ref(false); // Add employee state check

const refreshAuthState = () => {
    isLoggedIn.value = !!localStorage.getItem('_token');
    userName.value = '';
    isEmployee.value = false;

    if (isLoggedIn.value) {
        const userDataStr = localStorage.getItem('_userData');
        if (userDataStr) {
            try {
                const userData = JSON.parse(userDataStr);
                userName.value = userData.user_name || '';
            } catch (e) {
                console.error('Error parsing user data:', e);
            }
        }

        // Check if user is an employee
        const userType = localStorage.getItem('_userType');
        isEmployee.value = userType === 'employee';
    }
};

// ดึงข้อมูลผู้ใช้จาก localStorage
onMounted(() => {
    refreshAuthState();
});

watch(
    () => route.fullPath,
    () => {
        refreshAuthState();
    }
);

// ฟังก์ชันสำหรับออกจากระบบ
const handleLogout = () => {
    // Clear authentication token from localStorage
    localStorage.removeItem('_token');
    localStorage.removeItem('_userType');
    localStorage.removeItem('_userData');
    localStorage.removeItem('_empData');
    localStorage.removeItem('_userCode');
    localStorage.removeItem('_empCode');
    localStorage.removeItem('_adminPermissions');
    // อัพเดตสถานะการล็อกอิน
    isLoggedIn.value = false;
    isEmployee.value = false;
    // Redirect to login page
    router.push('/auth/login');
};

// สร้าง computed property สำหรับเมนูตะกร้าสินค้าที่จะอัพเดทโดยอัตโนมัติ
const cartMenuItem = computed(() => ({
    label: t('cart.cart'),
    icon: 'pi pi-fw pi-shopping-cart',
    to: '/cart',
    badge: cartItemCount.value > 0 ? cartItemCount.value.toString() : null,
    badgeClass: 'p-badge-danger'
}));

// จัดเรียงเมนูใหม่
const model = computed(() => {
    const menuItems = [];

    // 1. ส่วนแสดงข้อมูลผู้ใช้งาน (เฉพาะเมื่อล็อกอินแล้ว)
    // if (isLoggedIn.value && userName.value) {
    //     menuItems.push({
    //         label: 'โปรไฟล์',
    //         icon: 'pi pi-fw pi-user',
    //         items: [
    //             {
    //                 label: `ยินดีต้อนรับ ${userName.value}`,
    //                 icon: 'pi pi-fw pi-user',
    //                 disabled: true
    //             }
    //         ]
    //     });
    // }

    // 2. เมนูหลักร้านค้า (แสดงเสมอ)
    menuItems.push({
        label: '',
        icon: 'pi pi-fw pi-shopping-bag',
        items: [
            {
                label: t('nav.marketplace'),
                icon: 'pi pi-fw pi-shopping-bag',
                to: '/'
            },
            cartMenuItem.value
        ]
    });

    // 4. เมนูประวัติต่างๆ (เฉพาะเมื่อล็อกอินแล้ว)
    if (isLoggedIn.value) {
        menuItems.push({
            label: t('nav.myOrders'),
            icon: 'pi pi-fw pi-history',
            items: [
                { label: t('nav.orderHistory'), icon: 'pi pi-fw pi-shopping-cart', to: '/orders-history' }
            ]
        });
    }

    // 5. เมนูเข้าสู่ระบบ/ออกจากระบบ (แสดงเสมอ)
    menuItems.push({
        label: isLoggedIn.value ? t('nav.account') : t('nav.login'),
        icon: isLoggedIn.value ? 'pi pi-fw pi-user' : 'pi pi-fw pi-sign-in',
        items: [
            {
                label: t('nav.profile'),
                icon: 'pi pi-fw pi-user-edit',
                to: '/profile',
                visible: isLoggedIn.value
            },
            {
                label: isLoggedIn.value ? t('nav.logout') : t('nav.login'),
                icon: isLoggedIn.value ? 'pi pi-fw pi-sign-out' : 'pi pi-fw pi-sign-in',
                command: () => (isLoggedIn.value ? handleLogout() : router.push('/auth/login'))
            }
        ]
    });

    return menuItems;
});
</script>

<template>
    <!-- Standard user greeting -->
    <div v-if="isLoggedIn && userName && !isEmployee" class="user-info">
        <div class="user-profile">
            <i class="pi pi-user"></i>
            <div class="user-welcome">
                <span class="welcome-text">{{ t('auth.welcome') }}</span>
                <span class="user-name">{{ userName }}</span>
            </div>
        </div>
    </div>

    <!-- Employee information display -->
    <employee-info-display v-if="isLoggedIn && isEmployee" />

    <ul class="layout-menu">
        <template v-for="(item, i) in model" :key="i">
            <app-menu-item v-if="!item.separator" :item="item" :index="i"></app-menu-item>
            <li v-if="item.separator" class="menu-separator"></li>
        </template>
    </ul>
</template>

<style lang="scss" scoped>
.user-info {
    padding: 0.8rem;
    margin-bottom: 0.8rem;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    box-shadow: 0 6px 14px rgba(15, 23, 42, 0.06);
}

.user-profile {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    i {
        font-size: 1.15rem;
        color: #1d4ed8;
        background-color: #dbeafe;
        border-radius: 50%;
        padding: 0.45rem;
    }

    .user-welcome {
        display: flex;
        flex-direction: column;

        .welcome-text {
            font-size: 0.76rem;
            color: #64748b;
        }

        .user-name {
            font-weight: 600;
            color: #0f172a;
            font-size: 0.86rem;
        }
    }
}
</style>
