<script setup>
// ── หน้ารายการโปรดของฉัน ─────────────────────────────────────────────────
//
// รีวิว 260908 สไลด์ 9: กดหัวใจแล้วไม่รู้จะไปดูที่ไหน
// ต้องเป็น "หน้าของตัวเอง" ไม่ใช่แค่ติ๊ก filter บนหน้าสินค้าทั้งหมด
//
// ใช้ ProductList ตัวเดิมในโหมด favoriteOnly เพื่อให้ได้ทุกอย่างเหมือนหน้าปกติ:
// ค้นหา · การ์ดสินค้า · กดหัวใจ · เปิด dialog · ปรับจำนวนลงตะกร้า · โหลดต่อเนื่อง
import { useRouter } from 'vue-router';
import ProductList from '@/components/catalog/ProductList.vue';
import { useLanguageStore } from '@/stores/languageStore';

const router = useRouter();
const languageStore = useLanguageStore();
const t = (key, params) => languageStore.t(key, params);

function goToCatalog() {
    router.push('/marketplace');
}
</script>

<template>
    <div class="favorites-page">
        <div class="favorites-head">
            <button type="button" class="favorites-back" @click="goToCatalog">
                <i class="pi pi-arrow-left"></i>
                <span>{{ t('catalog.backToCatalog') }}</span>
            </button>

            <div class="favorites-title">
                <i class="pi pi-heart-fill"></i>
                <div>
                    <h1>{{ t('nav.myFavorites') }}</h1>
                    <p>{{ t('catalog.favoritesSubtitle') }}</p>
                </div>
            </div>
        </div>

        <ProductList :favorite-only="true" />
    </div>
</template>

<style scoped>
.favorites-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.favorites-head {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.9rem 1rem;
    border-radius: var(--market-radius-lg, 18px);
    background: var(--market-card-bg, #fff);
    border: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 86%, transparent);
}

.favorites-back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid var(--market-card-border, #e2e8f0);
    background: transparent;
    color: var(--market-muted, #64748b);
    border-radius: 999px;
    padding: 0.4rem 0.9rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}

.favorites-back:hover {
    background: var(--market-surface-soft, #f8fafc);
    color: var(--market-text, #1e293b);
}

.favorites-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.favorites-title > i {
    font-size: 1.35rem;
    color: #e11d48;
}

.favorites-title h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--market-text, #1e293b);
}

.favorites-title p {
    margin: 0.15rem 0 0;
    font-size: 0.82rem;
    color: var(--market-muted, #64748b);
}

@media (max-width: 640px) {
    .favorites-head {
        padding: 0.75rem 0.85rem;
    }

    .favorites-title h1 {
        font-size: 1rem;
    }
}
</style>
