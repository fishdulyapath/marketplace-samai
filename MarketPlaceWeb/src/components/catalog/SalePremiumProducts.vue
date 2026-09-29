<script setup>
// แถบโปรโมชันของแถม (Sale Premium) บนหน้าร้าน — เฟส 4.4 ของ docs/sale-premium-plan.md
// แสดงเฉพาะเมื่อ feature flag เปิด (list-for-sale คืน [] เมื่อปิด → คอมโพเนนต์ซ่อนตัวเอง)
import SalePremiumService from '@/services/SalePremiumService';
import ProductService from '@/services/ProductService';
import SalePremiumDetailDialog from '@/components/catalog/SalePremiumDetailDialog.vue';
import ProductCard from '@/components/product/ProductCard.vue';
import { useAuthenStore } from '@/stores/authen';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName } from '@/utils/languageDisplay';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const authenStore = useAuthenStore();
const languageStore = useLanguageStore();
const route = useRoute();

const promos = ref([]);
const loading = ref(true);
const selectedSalePremiumCode = ref('');
const showSalePremiumDetail = ref(false);

function custCode() {
    return localStorage.getItem('_userCode') || '';
}

function displayName(promo) {
    return pickProductName(promo, languageStore.locale) || promo.name_1 || promo.item_name || '';
}

function openDetail(promo) {
    selectedSalePremiumCode.value = promo.sale_premium_code || promo.item_code;
    showSalePremiumDetail.value = true;
}

async function load() {
    loading.value = true;
    try {
        promos.value = await SalePremiumService.getListForSale({
            cust_code: custCode(),
            search: typeof route.query.q === 'string' ? route.query.q : '',
            is_stock: '1',
            limit: 30
        });
    } catch (err) {
        console.error('load sale premium failed:', err);
        promos.value = [];
    } finally {
        loading.value = false;
    }
}

onMounted(load);
watch(() => route.query.q, load);
</script>

<template>
    <section v-if="loading || promos.length" class="sp-shell">
        <div class="sp-head">
            <span class="sp-icon"><i class="pi pi-gift"></i></span>
            <div>
                <h2 class="sp-title">โปรโมชันของแถม</h2>
                <p class="sp-subtitle">ซื้อครบตามเงื่อนไข รับของแถมทันที</p>
            </div>
        </div>

        <div class="sp-track">
            <template v-if="loading">
                <div v-for="i in 4" :key="i" class="shop-card shop-card--rail sp-card">
                    <Skeleton height="18px" width="70%" class="mb-2" />
                    <Skeleton height="12px" width="90%" class="mb-1" />
                    <Skeleton height="32px" width="100%" />
                </div>
            </template>

            <template v-else>
                <ProductCard
                    v-for="promo in promos"
                    :key="promo.sale_premium_code"
                    variant="rail"
                    class="sp-card"
                    :name="displayName(promo)"
                    :image="promo.image"
                    :fallback-image="ProductService.getPlaceholderImage()"
                    :aria-label="`ดูรายละเอียดเพิ่มเติม ${displayName(promo)}`"
                    @select="openDetail(promo)"
                >
                    <template #badges>
                        <Tag value="ของแถม" severity="danger" icon="pi pi-gift" class="sp-premium-tag" />
                    </template>
                    <template v-if="authenStore.isAuthenticated" #price>
                        <div class="shop-card-price-row">
                            <span class="shop-card-price sp-price">฿{{ Number(promo.price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</span>
                            <span class="shop-card-unit">/ ชุด</span>
                        </div>
                    </template>
                </ProductCard>
            </template>
        </div>
    </section>

    <SalePremiumDetailDialog
        :visible="showSalePremiumDetail"
        :sale-premium-code="selectedSalePremiumCode"
        @update:visible="showSalePremiumDetail = $event"
    />
</template>

<style scoped>
.sp-shell {
    border-radius: 10px;
    overflow: hidden;
    background: var(--market-card-bg, #fff);
    border: 1px solid var(--market-card-border, #e8dcc4);
    box-shadow: var(--shop-shadow-1);
    margin-bottom: 1rem;
}
.sp-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.8rem 0.9rem;
    background: linear-gradient(180deg, color-mix(in srgb, var(--market-card-bg, #fff) 92%, #ec4899) 0%, var(--market-card-bg, #fff) 100%);
    border-bottom: 1px solid var(--market-card-border, #efe3c8);
}
.sp-icon {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #fce7f3;
    color: #db2777;
    flex: 0 0 auto;
}
.sp-title { margin: 0; font-size: 1rem; font-weight: 800; color: var(--market-text, #2f2412); }
.sp-subtitle { margin: 0.15rem 0 0; font-size: 0.74rem; color: var(--market-muted, #8a6f37); }

.sp-track {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    padding: 12px 1rem;
    scrollbar-width: thin;
}
.sp-card {
    flex-shrink: 0;
}
.sp-price { font-size: 1rem; font-weight: 800; color: #db2777; }

:deep(.sp-premium-tag.p-tag) {
    background: #fce7f3;
    color: #be185d;
    border: 1px solid #f9a8d4;
}
</style>
