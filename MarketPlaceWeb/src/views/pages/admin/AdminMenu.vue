<script setup>
import LicenseService from '@/services/LicenseService';
import { useLanguageStore } from '@/stores/languageStore';
import { canAccessAdminPermission } from '@/utils/adminPermissions';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const languageStore = useLanguageStore();
const t = languageStore.t;
const licenseStatus = ref(null);
const licenseLoading = ref(false);
const licenseError = ref('');

const menuItems = computed(() =>
    [
        {
            title: 'คำสั่งซื้อ',
            description: 'ดูสถานะคำสั่งซื้อทุกใบที่เข้ามา ค้นหาตามลูกค้า เลขที่ และช่วงวันที่',
            icon: 'pi pi-receipt',
            to: '/admin/orders',
            permission: 'admin.orders'
        },
        {
            title: t('adminMenu.contentTitle'),
            description: t('adminMenu.contentDescription'),
            icon: 'pi pi-home',
            to: '/admin/content',
            permission: 'admin.content'
        },
        {
            title: t('adminMenu.categoriesTitle'),
            description: t('adminMenu.categoriesDescription'),
            icon: 'pi pi-tags',
            to: '/admin/categories',
            permission: 'admin.categories'
        },
        {
            title: t('adminMenu.customersTitle'),
            description: t('adminMenu.customersDescription'),
            icon: 'pi pi-users',
            to: '/admin/customers',
            permission: 'admin.customers'
        },
        {
            title: 'รายงาน',
            description: 'รายงานตะกร้าสินค้าของลูกค้า และรายงานสินค้าที่แสดงขายบนเว็บ',
            icon: 'pi pi-chart-bar',
            to: '/admin/reports',
            permission: 'admin.reports'
        },
        {
            title: t('adminMenu.employeesTitle'),
            description: t('adminMenu.employeesDescription'),
            icon: 'pi pi-user-edit',
            to: '/admin/employees',
            permission: 'admin.employees'
        },
        {
            title: t('adminMenu.inventoryTitle'),
            description: t('adminMenu.inventoryDescription'),
            icon: 'pi pi-box',
            to: '/admin/inventory',
            permission: 'admin.inventory'
        },
        {
            title: t('adminMenu.productsTitle'),
            description: t('adminMenu.productsDescription'),
            icon: 'pi pi-tag',
            to: '/admin/products',
            permission: 'admin.products'
        },
        {
            title: t('adminMenu.productParticipationTitle'),
            description: t('adminMenu.productParticipationDescription'),
            icon: 'pi pi-check-square',
            to: '/admin/product-participation',
            permission: 'admin.productParticipation'
        },
        {
            title: 'จัดการตั้งค่าการขาย',
            description: 'ตั้งค่าสต๊อกที่แสดง สินค้าใหม่ สินค้าแนะนำ และประวัติเอกสาร',
            icon: 'pi pi-sliders-h',
            to: '/admin/sales-settings',
            permission: 'admin.salesSettings'
        },
        {
            title: 'จัดการโปรโมชันของแถม',
            description: 'ตั้งเงื่อนไข "ซื้อครบแถม" และรายการของแถมสำหรับหน้าร้าน',
            icon: 'pi pi-gift',
            to: '/admin/sale-premium',
            permission: 'admin.salePremium'
        },
        {
            title: 'กำหนดสิทธิ์',
            description: 'กำหนดหน้าจอหลังบ้านที่พนักงานแต่ละคนเข้าใช้งานได้',
            icon: 'pi pi-shield',
            to: '/admin/permissions',
            permission: 'admin.permissions'
        }
    ].filter((item) => canAccessAdminPermission(item.permission))
);

const licenseStatusText = computed(() => {
    const status = licenseStatus.value?.status;
    if (status === 'active') return 'ใช้งาน';
    if (status === 'blocked') return 'ปิดใช้งาน';
    if (status === 'grace') return 'ช่วงผ่อนผัน';
    if (status === 'checking') return 'กำลังตรวจสอบ';
    if (status === 'disabled') return 'ปิดระบบตรวจสอบ';
    return 'ไม่ทราบสถานะ';
});

const licenseStatusClass = computed(() => licenseStatus.value?.status || 'unknown');

const licenseExpireText = computed(() => {
    return formatBangkokDate(licenseStatus.value?.expire_at, 'ไม่กำหนด');
});

const licenseLastCheckedText = computed(() => {
    return formatBangkokDateTime(licenseStatus.value?.last_checked_at, 'ยังไม่เคยตรวจ');
});

function formatBangkokDate(value, fallback = '-') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-GB', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatBangkokDateTime(value, fallback = '-') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-GB', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

onMounted(() => {
    loadLicenseStatus();
});

async function loadLicenseStatus() {
    licenseLoading.value = true;
    licenseError.value = '';
    try {
        licenseStatus.value = await LicenseService.getStatus();
    } catch (error) {
        licenseStatus.value = null;
        licenseError.value = error?.response?.data?.message || error.message || 'ตรวจสอบ license ไม่ได้';
    } finally {
        licenseLoading.value = false;
    }
}

async function checkLicenseNow() {
    licenseLoading.value = true;
    licenseError.value = '';
    try {
        licenseStatus.value = await LicenseService.checkNow();
    } catch (error) {
        licenseStatus.value = null;
        licenseError.value = error?.response?.data?.message || error.message || 'ตรวจสอบ license ไม่ได้';
    } finally {
        licenseLoading.value = false;
    }
}
</script>

<template>
    <main class="admin-menu-page">
        <header class="admin-menu-head">
            <p>{{ t('adminMenu.eyebrow') }}</p>
            <h1>{{ t('adminMenu.title') }}</h1>
            <span>{{ t('adminMenu.subtitle') }}</span>
        </header>

        <section class="admin-menu-grid">
            <button v-for="item in menuItems" :key="item.to" type="button" class="admin-menu-card" :aria-label="item.title" @click="router.push(item.to)">
                <i :class="item.icon"></i>
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
                <small>{{ t('adminMenu.openPage') }} <i class="pi pi-arrow-right"></i></small>
            </button>
        </section>

        <footer class="admin-license-footer">
            <div class="license-footer-title">
                <i class="pi pi-shield"></i>
                <div>
                    <strong>Marketplace License</strong>
                    <span>สถานะการใช้งานของร้านนี้</span>
                </div>
            </div>

            <div v-if="licenseLoading" class="license-footer-muted">
                <i class="pi pi-spin pi-spinner"></i>
                <span>กำลังตรวจสอบ license...</span>
            </div>

            <div v-else-if="licenseStatus" class="license-footer-grid">

                <div>
                    <small>License Key</small>
                    <strong>{{ licenseStatus.license_key || '-' }}</strong>
                </div>
                <div>
                    <small>สถานะ</small>
                    <strong :class="['license-state', licenseStatusClass]">{{ licenseStatusText }}</strong>
                </div>

                <div>
                    <small>ตรวจสอบล่าสุด (GMT+7)</small>
                    <strong>{{ licenseLastCheckedText }}</strong>
                </div>
                <button type="button" class="license-check-button" :disabled="licenseLoading" @click="checkLicenseNow">
                    <i class="pi pi-refresh" :class="{ 'pi-spin': licenseLoading }"></i>
                    <span>ตรวจสอบสถานะ</span>
                </button>
            </div>

            <div v-else class="license-footer-muted">
                <i class="pi pi-exclamation-circle"></i>
                <span>{{ licenseError || 'ตรวจสอบ license ไม่ได้' }}</span>
                <button type="button" class="license-refresh-button" @click="loadLicenseStatus">ลองใหม่</button>
            </div>
        </footer>
    </main>
</template>

<style scoped>
.admin-menu-page {
    min-height: calc(100vh - 5rem);
    padding: clamp(1rem, 3vw, 2rem);
    background: radial-gradient(circle at top right, color-mix(in srgb, var(--market-accent, #f97316) 12%, transparent), transparent 34%), linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #f7f1e5) 100%);
    color: var(--market-text, #4b3a1d);
}

.admin-menu-head {
    margin: 0 auto 1.25rem;
    max-width: 980px;
}

.admin-menu-head p {
    margin: 0;
    color: var(--market-primary, #0f9f6e);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.admin-menu-head h1 {
    margin: 0.2rem 0;
    color: var(--market-text, #4b3a1d);
    font-size: clamp(1.7rem, 4vw, 2.45rem);
}

.admin-menu-head span {
    color: var(--market-muted, #8a7650);
}

.admin-menu-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1rem;
    max-width: 980px;
    margin: 0 auto;
}

.admin-menu-card {
    display: grid;
    gap: 0.7rem;
    min-height: 13rem;
    padding: 1.2rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.9rem;
    background: var(--market-card-bg, #fff);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(120, 86, 28, 0.09));
    color: var(--market-text, #4b3a1d);
    cursor: pointer;
    text-align: left;
}

.admin-menu-card > i {
    width: 3rem;
    height: 3rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.9rem;
    background: var(--market-primary-soft, #f3ead5);
    color: var(--market-primary, #0f9f6e);
    font-size: 1.3rem;
}

.admin-menu-card strong {
    font-size: 1.15rem;
}

.admin-menu-card span {
    color: var(--market-muted, #7b6844);
    line-height: 1.55;
}

.admin-menu-card small {
    align-self: end;
    color: var(--market-primary, #0f9f6e);
    font-weight: 800;
}

.admin-license-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    max-width: 980px;
    margin: 1rem auto 0;
    padding: 0.85rem 1rem;
    border: 1px solid var(--market-card-border, #eadcbc);
    border-radius: 0.9rem;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 90%, var(--market-primary, #0f9f6e) 10%);
    box-shadow: 0 12px 26px var(--market-shadow, rgba(120, 86, 28, 0.07));
}

.license-footer-title,
.license-footer-muted {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
}

.license-footer-title > i {
    width: 2.2rem;
    height: 2.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--market-primary, #0f9f6e) 12%, transparent);
    color: var(--market-primary, #0f9f6e);
}

.license-footer-title div {
    display: grid;
    gap: 0.1rem;
}

.license-footer-title strong {
    color: var(--market-text, #4b3a1d);
}

.license-footer-title span,
.license-footer-muted {
    color: var(--market-muted, #8a7650);
    font-size: 0.82rem;
}

.license-footer-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(8rem, auto));
    gap: 0.65rem;
}

.license-footer-grid div {
    display: grid;
    gap: 0.12rem;
    min-width: 8rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--market-card-border, #eadcbc) 76%, transparent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 86%, #ffffff 14%);
}

.license-footer-grid small {
    color: var(--market-muted, #8a7650);
    font-size: 0.72rem;
}

.license-footer-grid strong {
    color: var(--market-text, #4b3a1d);
    font-size: 0.9rem;
}

.license-state.active {
    color: #059669;
}

.license-state.blocked {
    color: #dc2626;
}

.license-state.grace,
.license-state.checking {
    color: #d97706;
}

.license-refresh-button {
    border: 0;
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    background: var(--market-primary, #0f9f6e);
    color: #fff;
    cursor: pointer;
    font-weight: 800;
}

.license-check-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-width: 9.5rem;
    border: 0;
    border-radius: 0.75rem;
    padding: 0.55rem 0.75rem;
    background: var(--market-primary, #0f9f6e);
    color: #fff;
    cursor: pointer;
    font-weight: 900;
}

.license-check-button:disabled {
    cursor: wait;
    opacity: 0.72;
}

@media (max-width: 760px) {
    .admin-license-footer {
        align-items: stretch;
        flex-direction: column;
    }

    .license-footer-grid {
        grid-template-columns: 1fr;
    }
}
</style>
