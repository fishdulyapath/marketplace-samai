<script setup>
// หน้า "ไม่มีสิทธิ์เข้าถึง" ของงานหลังบ้าน
//
// router guard ส่งมาที่นี่เมื่อพนักงานล็อกอินแล้วแต่ไม่มีสิทธิ์ของหน้านั้น
// (meta.adminPermission ไม่ผ่าน) — เป็นเคสที่เจอได้จริงทุกวันเมื่อสิทธิ์ยังไม่ถูกตั้ง
//
// ของเดิมเป็นเทมเพลต sakai ของ PrimeVue ที่ไม่ได้แก้: พาดหัวอังกฤษ "Access Denied"
// สะกดผิด ("permisions") รูป /demo/images/ ที่ไม่มีในโปรเจกต์ ปุ่ม "Go to Dashboard"
// ที่ชี้ไปหน้าที่ไม่มีอยู่ และ FloatingConfigurator (ปุ่มลอยเปลี่ยนธีมของเทมเพลต)
// พนักงานที่ถูกเด้งมาจึงไม่รู้ว่าต้องทำอะไรต่อ และออกไปไหนไม่ได้
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useLanguageStore } from '@/stores/languageStore';

const router = useRouter();
const languageStore = useLanguageStore();
const t = (key, params) => languageStore.t(key, params);

const empCode = computed(() => localStorage.getItem('_empCode') || '');
const isEmployee = computed(() => localStorage.getItem('_userType') === 'employee');

function goBack() {
    if (window.history.length > 1) router.back();
    else router.push('/');
}
</script>

<template>
    <div class="ad-wrap">
        <div class="ad-card">
            <span class="ad-badge"><i class="pi pi-lock"></i> {{ t('accessDenied.badge') }}</span>
            <h1 class="ad-title">{{ t('accessDenied.title') }}</h1>
            <p class="ad-desc">{{ t('accessDenied.description') }}</p>

            <div v-if="isEmployee" class="ad-user">
                <span class="ad-user__label">{{ t('accessDenied.signedInAs') }}</span>
                <code class="ad-user__value">{{ empCode || '-' }}</code>
            </div>

            <div class="ad-links">
                <router-link to="/admin/orders" class="ad-link">
                    <i class="pi pi-shopping-bag ad-link__icon"></i>
                    <span class="ad-link__text">{{ t('accessDenied.backOffice') }}</span>
                    <i class="pi pi-angle-right ad-link__chevron"></i>
                </router-link>
            </div>

            <p class="ad-hint">{{ t('accessDenied.contactAdmin') }}</p>

            <div class="ad-actions">
                <button type="button" class="ad-btn ad-btn--ghost" @click="goBack">
                    <i class="pi pi-arrow-left"></i>
                    <span>{{ t('accessDenied.goBack') }}</span>
                </button>
                <router-link to="/" class="ad-btn ad-btn--primary">
                    <i class="pi pi-home"></i>
                    <span>{{ t('accessDenied.goHome') }}</span>
                </router-link>
            </div>
        </div>
    </div>
</template>

<style scoped>
.ad-wrap {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
    padding: 3rem 1rem;
    background: var(--market-page-bg, #f6f8f9);
}

.ad-card {
    width: 100%;
    max-width: 560px;
    background: var(--market-card-bg, #ffffff);
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 18px;
    padding: 2.25rem 1.75rem;
    text-align: center;
}

.ad-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #b45309;
    background: #fef3c7;
    border-radius: 999px;
    padding: 0.3rem 0.85rem;
}

.ad-title {
    margin: 0.9rem 0 0;
    font-size: 1.55rem;
    font-weight: 700;
    color: var(--market-text, #1f2937);
}

.ad-desc {
    margin: 0.6rem auto 0;
    max-width: 28rem;
    font-size: 0.95rem;
    color: #6b7280;
    line-height: 1.6;
}

.ad-user {
    margin-top: 1.1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #6b7280;
}

.ad-user__value {
    background: #f3f4f6;
    border-radius: 6px;
    padding: 0.15rem 0.5rem;
    font-weight: 700;
    color: #374151;
}

.ad-links {
    margin-top: 1.5rem;
    text-align: start;
}

.ad-links__head {
    margin: 0 0 0.5rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: #6b7280;
}

.ad-link {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
    margin-bottom: 0.5rem;
    text-decoration: none;
    color: var(--market-text, #1f2937);
}

.ad-link:hover {
    border-color: var(--market-primary, #0f9f6e);
    background: color-mix(in srgb, var(--market-primary, #0f9f6e), transparent 94%);
}

.ad-link__icon {
    color: var(--market-primary, #0f9f6e);
}

.ad-link__text {
    flex: 1;
    font-size: 0.9rem;
    font-weight: 600;
}

.ad-link__chevron {
    color: #9ca3af;
    font-size: 0.8rem;
}

.ad-hint {
    margin: 1.25rem 0 0;
    font-size: 0.85rem;
    color: #9ca3af;
}

.ad-actions {
    margin-top: 1.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    justify-content: center;
}

.ad-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 42px;
    padding: 0.5rem 1.3rem;
    border-radius: 10px;
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
}

.ad-btn--primary {
    border: 1px solid var(--market-primary, #0f9f6e);
    background: var(--market-primary, #0f9f6e);
    color: #fff;
}

.ad-btn--ghost {
    border: 1px solid var(--market-card-border, #e6ebef);
    background: var(--market-card-bg, #fff);
    color: #374151;
}

.ad-btn--ghost:hover {
    border-color: #9ca3af;
}
</style>
