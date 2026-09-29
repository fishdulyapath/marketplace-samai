<script setup>
// หน้าแจ้งข้อผิดพลาดทั่วไป
//
// ของเดิมเป็นเทมเพลต sakai ของ PrimeVue ที่ไม่ได้แก้: พาดหัวอังกฤษสะกดผิด
// ("Error Occured") รูป /demo/images/error/ ที่ไม่มีในโปรเจกต์ ปุ่ม "Go to Dashboard"
// ที่ชี้ไปหน้าที่ไม่มีอยู่ และ FloatingConfigurator (ปุ่มลอยเปลี่ยนธีมของเทมเพลต)
//
// ตอนนี้ยังไม่มีโค้ดส่วนไหน navigate มาที่นี่ (route /auth/error มีไว้เฉยๆ)
// แต่เข้าถึงได้จากการพิมพ์ URL ตรง จึงต้องไม่ใช่หน้าเทมเพลตค้าง
// และเผื่อวันหลังมีคนใช้จริง — รับข้อความจาก query.message ได้
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useLanguageStore } from '@/stores/languageStore';

const route = useRoute();
const router = useRouter();
const languageStore = useLanguageStore();
const t = (key, params) => languageStore.t(key, params);

// ข้อความจาก query เป็นค่าที่ควบคุมไม่ได้ — ตัดความยาวกันดันการ์ดล้น
// และผูกด้วย {{ }} เท่านั้น (Vue escape ให้) ห้าม v-html
const detail = computed(() => String(route.query.message || '').slice(0, 300));

function retry() {
    const back = String(route.query.from || '');
    if (back.startsWith('/')) router.replace(back);
    else window.location.reload();
}
</script>

<template>
    <div class="er-wrap">
        <div class="er-card">
            <span class="er-badge"><i class="pi pi-exclamation-triangle"></i> {{ t('errorPage.badge') }}</span>
            <h1 class="er-title">{{ t('errorPage.title') }}</h1>
            <p class="er-desc">{{ t('errorPage.description') }}</p>

            <div v-if="detail" class="er-detail">
                <span class="er-detail__label">{{ t('errorPage.detail') }}</span>
                <code class="er-detail__value">{{ detail }}</code>
            </div>

            <div class="er-actions">
                <button type="button" class="er-btn er-btn--ghost" @click="retry">
                    <i class="pi pi-refresh"></i>
                    <span>{{ t('errorPage.retry') }}</span>
                </button>
                <router-link to="/" class="er-btn er-btn--primary">
                    <i class="pi pi-home"></i>
                    <span>{{ t('errorPage.goHome') }}</span>
                </router-link>
            </div>
        </div>
    </div>
</template>

<style scoped>
.er-wrap {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
    padding: 3rem 1rem;
    background: var(--market-page-bg, #f6f8f9);
}

.er-card {
    width: 100%;
    max-width: 560px;
    background: var(--market-card-bg, #ffffff);
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 18px;
    padding: 2.25rem 1.75rem;
    text-align: center;
}

.er-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #b91c1c;
    background: #fee2e2;
    border-radius: 999px;
    padding: 0.3rem 0.85rem;
}

.er-title {
    margin: 0.9rem 0 0;
    font-size: 1.55rem;
    font-weight: 700;
    color: var(--market-text, #1f2937);
}

.er-desc {
    margin: 0.6rem auto 0;
    max-width: 28rem;
    font-size: 0.95rem;
    color: #6b7280;
    line-height: 1.6;
}

.er-detail {
    margin-top: 1.25rem;
    text-align: start;
    background: #f9fafb;
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
    padding: 0.75rem 0.9rem;
}

.er-detail__label {
    display: block;
    font-size: 0.75rem;
    color: #9ca3af;
    margin-bottom: 0.25rem;
}

.er-detail__value {
    font-size: 0.85rem;
    color: #374151;
    overflow-wrap: anywhere;
}

.er-actions {
    margin-top: 1.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    justify-content: center;
}

.er-btn {
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

.er-btn--primary {
    border: 1px solid var(--market-primary, #0f9f6e);
    background: var(--market-primary, #0f9f6e);
    color: #fff;
}

.er-btn--ghost {
    border: 1px solid var(--market-card-border, #e6ebef);
    background: var(--market-card-bg, #fff);
    color: #374151;
}

.er-btn--ghost:hover {
    border-color: #9ca3af;
}
</style>
