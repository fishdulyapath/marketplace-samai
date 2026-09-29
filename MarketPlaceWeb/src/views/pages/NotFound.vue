<script setup>
// หน้า 404 ของหน้าร้าน
//
// ของเดิมเป็นเทมเพลต sakai ของ PrimeVue ที่ไม่ได้แก้เลย — พาดหัวอังกฤษ
// ข้อความ Lorem ipsum ("Ultricies mi quis hendrerit dolor") ลิงก์ปลอม 3 อัน
// ที่ชี้กลับ / ทั้งหมด ปุ่ม "Go to Dashboard" และ FloatingConfigurator (ปุ่มลอยเปลี่ยนธีม)
// ที่ไม่ควรโผล่ให้ลูกค้าเห็น ทั้งหน้ายังอยู่นอก AppLayout จึงไม่มีหัวร้าน/เมนู/ตะกร้า
// ลูกค้าที่พิมพ์ URL ผิดจึงตกไปอยู่หน้าที่ออกไปไหนไม่ได้เลย
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useLanguageStore } from '@/stores/languageStore';

const route = useRoute();
const languageStore = useLanguageStore();
const t = (key, params) => languageStore.t(key, params);

const isAuthenticated = computed(() => !!localStorage.getItem('_token'));

// ที่อยู่ที่ลูกค้าพยายามเปิด — ช่วยให้เห็นว่าพิมพ์ตกตรงไหน
// catch-all ใน router แนบมาให้ทาง query.from ถ้าเปิด /pages/notfound ตรงๆ จะไม่มีค่า
// แล้วไม่ต้องโชว์แถวนี้เลย
//
// ค่านี้มาจากแถบที่อยู่ของผู้ใช้ ถือเป็นข้อความที่ควบคุมไม่ได้
// จึงตัดความยาวกันดันการ์ดล้น และผูกด้วย {{ }} เท่านั้น (Vue escape ให้) ห้าม v-html
function decodePath(value) {
    // fullPath เป็น URL-encoded ที่อยู่ภาษาไทยจึงกลายเป็น %E0%B8%AA... อ่านไม่ออก
    // ถอดรหัสก่อนแสดง แต่ลำดับ % ที่ไม่ถูกต้องจะทำให้ decodeURIComponent โยน error
    // ถ้าถอดไม่ได้ก็แสดงของเดิมไป ดีกว่าหน้าพัง
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

const attemptedPath = computed(() => {
    const raw = decodePath(String(route.query.from || '').trim());
    if (!raw) return '';
    return raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
});

const shortcuts = computed(() =>
    [
        { key: 'marketplace', to: '/marketplace', icon: 'pi pi-th-large', authOnly: false },
        { key: 'promotions', to: '/marketplace?category=promotions', icon: 'pi pi-tag', authOnly: false },
        { key: 'orders', to: '/orders-history', icon: 'pi pi-shopping-bag', authOnly: true }
    ].filter((item) => !item.authOnly || isAuthenticated.value)
);
</script>

<template>
    <div class="nf-wrap">
        <div class="nf-card">
            <span class="nf-code">{{ t('notFound.code') }}</span>
            <h1 class="nf-title">{{ t('notFound.title') }}</h1>
            <p class="nf-desc">{{ t('notFound.description') }}</p>

            <div v-if="attemptedPath" class="nf-path">
                <span class="nf-path__label">{{ t('notFound.attempted') }}</span>
                <code class="nf-path__value">{{ attemptedPath }}</code>
            </div>

            <div class="nf-links">
                <router-link v-for="item in shortcuts" :key="item.key" :to="item.to" class="nf-link">
                    <span class="nf-link__icon"><i :class="item.icon"></i></span>
                    <span class="nf-link__text">
                        <span class="nf-link__title">{{ t('notFound.' + item.key) }}</span>
                        <span class="nf-link__hint">{{ t('notFound.' + item.key + 'Hint') }}</span>
                    </span>
                    <i class="pi pi-angle-right nf-link__chevron"></i>
                </router-link>
            </div>

            <router-link to="/" class="nf-home">
                <i class="pi pi-home"></i>
                <span>{{ t('notFound.backHome') }}</span>
            </router-link>
        </div>
    </div>
</template>

<style scoped>
.nf-wrap {
    display: flex;
    justify-content: center;
    padding: 2.5rem 1rem 4rem;
}

.nf-card {
    width: 100%;
    max-width: 640px;
    background: var(--market-card-bg, #ffffff);
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 18px;
    padding: 2.5rem 1.75rem;
    text-align: center;
}

.nf-code {
    display: inline-block;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--market-primary, #0f9f6e);
    background: color-mix(in srgb, var(--market-primary, #0f9f6e), transparent 88%);
    border-radius: 999px;
    padding: 0.3rem 0.85rem;
}

.nf-title {
    margin: 0.9rem 0 0;
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--market-text, #1f2937);
}

.nf-desc {
    margin: 0.6rem auto 0;
    max-width: 30rem;
    font-size: 0.95rem;
    line-height: 1.65;
    color: color-mix(in srgb, var(--market-text, #1f2937), transparent 35%);
}

.nf-path {
    margin-top: 1.25rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: center;
    font-size: 0.82rem;
}

.nf-path__label {
    color: color-mix(in srgb, var(--market-text, #1f2937), transparent 50%);
}

.nf-path__value {
    /* เส้นทางยาวๆ ต้องตัดบรรทัดได้ ไม่ดันการ์ดจนล้นจอมือถือ */
    max-width: 100%;
    overflow-wrap: anywhere;
    background: var(--market-page-bg, #f4f6f8);
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 8px;
    padding: 0.2rem 0.5rem;
    color: var(--market-text, #1f2937);
}

.nf-links {
    margin-top: 1.75rem;
    display: grid;
    gap: 0.65rem;
    text-align: start;
}

.nf-link {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    /* ปุ่มสูงอย่างน้อย 56px กดง่ายบนมือถือ */
    min-height: 56px;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--market-card-border, #e6ebef);
    border-radius: 12px;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s ease, background 0.15s ease;
}

.nf-link:hover,
.nf-link:focus-visible {
    border-color: var(--market-primary, #0f9f6e);
    background: color-mix(in srgb, var(--market-primary, #0f9f6e), transparent 95%);
}

.nf-link__icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 10px;
    background: color-mix(in srgb, var(--market-primary, #0f9f6e), transparent 88%);
    color: var(--market-primary, #0f9f6e);
}

.nf-link__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.nf-link__title {
    font-weight: 600;
    color: var(--market-text, #1f2937);
}

.nf-link__hint {
    font-size: 0.82rem;
    color: color-mix(in srgb, var(--market-text, #1f2937), transparent 40%);
}

.nf-link__chevron {
    margin-inline-start: auto;
    color: color-mix(in srgb, var(--market-text, #1f2937), transparent 55%);
}

.nf-home {
    margin-top: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 44px;
    padding: 0.65rem 1.5rem;
    border-radius: 10px;
    background: var(--market-primary, #0f9f6e);
    color: #ffffff;
    font-weight: 600;
    text-decoration: none;
}

.nf-home:hover,
.nf-home:focus-visible {
    filter: brightness(0.95);
}

@media (max-width: 480px) {
    .nf-card {
        padding: 2rem 1.1rem;
    }

    .nf-title {
        font-size: 1.35rem;
    }
}
</style>
