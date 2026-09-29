<script setup>
import ProductService from '@/services/ProductService';
import SalePremiumService from '@/services/SalePremiumService';
import { useAuthenStore } from '@/stores/authen';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName } from '@/utils/languageDisplay';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const props = defineProps({
    visible: { type: Boolean, default: false },
    salePremiumCode: { type: String, default: '' }
});

const emit = defineEmits(['update:visible', 'added-to-cart']);

const authenStore = useAuthenStore();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const loading = ref(false);
const adding = ref(false);
const detail = ref(null);
const errorMessage = ref('');
const quantity = ref(1);
let requestSequence = 0;

const isLoggedIn = computed(() => authenStore.isAuthenticated);
const displayName = computed(() => pickProductName(detail.value || {}, languageStore.locale) || detail.value?.premium_name || detail.value?.item_name || '');
const paidItems = computed(() => (Array.isArray(detail.value?.paid_items) ? detail.value.paid_items : []));
const freeItems = computed(() => (Array.isArray(detail.value?.free_items) ? detail.value.free_items : []));
const availableQty = computed(() => Math.max(0, Math.floor(Number(detail.value?.balance_qty ?? detail.value?.stock_qty ?? 0) || 0)));
const soldOut = computed(() => String(detail.value?.sold_out ?? '') === '1' || availableQty.value <= 0);
const preorderAllowed = computed(() => ['1', 'true'].includes(String(detail.value?.preorder_allowed ?? '').toLowerCase()) || detail.value?.preorder_allowed === true);
const price = computed(() => Number(detail.value?.price || 0));
const lineTotal = computed(() => price.value * quantity.value);
const imageUrl = computed(() => detail.value?.image || ProductService.getPlaceholderImage());
const canDecrease = computed(() => quantity.value > 1 && !adding.value);
const canIncrease = computed(() => !adding.value && (preorderAllowed.value ? quantity.value < 999 : !soldOut.value && quantity.value < availableQty.value));
const canAdd = computed(() => isLoggedIn.value && detail.value && (!soldOut.value || preorderAllowed.value) && price.value > 0 && quantity.value > 0 && !adding.value);

function formatMoney(value) {
    return Number(value || 0).toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatQty(value) {
    const numberValue = Number(value || 0);
    return numberValue.toLocaleString(languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH', {
        minimumFractionDigits: Number.isInteger(numberValue) ? 0 : 2,
        maximumFractionDigits: 2
    });
}

function itemName(item) {
    return pickProductName(item || {}, languageStore.locale) || item?.item_name || item?.name_1 || item?.item_code || '-';
}

function scaledQty(item) {
    return Number(item?.qty || 0) * quantity.value;
}

function closeDialog() {
    emit('update:visible', false);
}

function decreaseQuantity() {
    if (canDecrease.value) quantity.value -= 1;
}

function increaseQuantity() {
    if (canIncrease.value) quantity.value += 1;
}

function normalizeQuantity() {
    const parsed = Math.floor(Number(quantity.value) || 1);
    quantity.value = Math.max(1, preorderAllowed.value ? Math.min(parsed, 999) : soldOut.value ? 1 : Math.min(parsed, availableQty.value || 1));
}

function goToLogin() {
    closeDialog();
    router.push({ path: '/auth/login', query: { redirect: route.fullPath || '/marketplace' } });
}

async function loadDetail() {
    const code = String(props.salePremiumCode || '').trim();
    if (!props.visible || !code) return;

    const sequence = ++requestSequence;
    loading.value = true;
    errorMessage.value = '';
    detail.value = null;
    quantity.value = 1;

    try {
        const result = await SalePremiumService.getDetailForSale(code, {
            cust_code: localStorage.getItem('_userCode') || ''
        });
        if (sequence !== requestSequence) return;
        detail.value = result;
        if (!result) errorMessage.value = 'ไม่พบรายละเอียดโปรโมชั่น';
    } catch (error) {
        if (sequence !== requestSequence) return;
        errorMessage.value = error?.response?.data?.msg || error?.message || 'โหลดรายละเอียดโปรโมชั่นไม่สำเร็จ';
    } finally {
        if (sequence === requestSequence) loading.value = false;
    }
}

async function addToCart() {
    if (!isLoggedIn.value) {
        goToLogin();
        return;
    }
    if (!canAdd.value) return;

    adding.value = true;
    try {
        const item = {
            item_code: detail.value.sale_premium_code || detail.value.item_code,
            item_name: detail.value.premium_name || detail.value.item_name,
            unit_code: detail.value.unit_code || 'ชิ้น',
            price: price.value,
            image: imageUrl.value,
            image_guid: detail.value.image_guid || '',
            item_type: '4',
            is_promotion: '1',
            balance_qty: availableQty.value,
            sold_out: detail.value.sold_out || '0',
            wh_code: detail.value.wh_code || '',
            shelf_code: detail.value.shelf_code || '',
            stand_value: detail.value.stand_value || 1,
            divide_value: detail.value.divide_value || 1,
            ratio: detail.value.ratio || 1,
            tax_type: detail.value.tax_type ?? 0,
            sale_premium_code: detail.value.sale_premium_code || detail.value.item_code,
            sale_premium_name: detail.value.sale_premium_name || detail.value.item_name,
            sale_premium_data: JSON.stringify({
                image_guid: detail.value.image_guid || '',
                free_items: freeItems.value
            })
        };

        await cartStore.addToCart(item, quantity.value);
        emit('added-to-cart', item);
        toast.add({ severity: 'success', summary: 'เพิ่มโปรโมชันลงตะกร้าแล้ว', detail: displayName.value, life: 2000 });
    } catch (error) {
        const message = error?.message === 'LOGIN_REQUIRED' || String(error?.message || '').includes('LOGIN_REQUIRED') ? 'กรุณาเข้าสู่ระบบก่อนสั่งซื้อ' : error?.message || 'เพิ่มลงตะกร้าไม่สำเร็จ';
        toast.add({ severity: 'warn', summary: 'ไม่สำเร็จ', detail: message, life: 3500 });
    } finally {
        adding.value = false;
    }
}

watch(
    () => [props.visible, props.salePremiumCode],
    ([visible]) => {
        if (visible) loadDetail();
        else requestSequence += 1;
    },
    { immediate: true }
);
</script>

<template>
    <Dialog
        :visible="visible"
        modal
        :draggable="false"
        :closable="false"
        dismissable-mask
        class="sale-premium-detail-dialog"
        :style="{ width: 'min(920px, calc(100vw - 2rem))' }"
        :content-style="{ padding: '0', overflow: 'auto' }"
        @update:visible="emit('update:visible', $event)"
    >
        <div v-if="loading" class="spd-loading">
            <ProgressSpinner style="width: 48px; height: 48px" />
            <span>กำลังโหลดรายละเอียดโปรโมชั่น...</span>
        </div>

        <div v-else-if="errorMessage" class="spd-error">
            <i class="pi pi-exclamation-circle"></i>
            <strong>ไม่สามารถแสดงรายละเอียดได้</strong>
            <span>{{ errorMessage }}</span>
            <div class="spd-error-actions">
                <Button label="ลองอีกครั้ง" icon="pi pi-refresh" outlined @click="loadDetail" />
                <Button label="ปิด" severity="secondary" text @click="closeDialog" />
            </div>
        </div>

        <div v-else-if="detail" class="spd-shell">
            <header class="spd-header">
                <div class="spd-header-copy">
                    <div class="spd-title-row">
                        <Tag value="โปรโมชั่นของแถม" icon="pi pi-gift" severity="danger" />
                        <h2>{{ displayName }}</h2>
                    </div>
                    <span class="spd-code">รหัสโปรโมชั่น: {{ detail.sale_premium_code || detail.item_code }}</span>
                </div>
                <button type="button" class="spd-close" aria-label="ปิด" @click="closeDialog">
                    <i class="pi pi-times"></i>
                </button>
            </header>

            <div class="spd-body">
                <section class="spd-image-panel">
                    <div class="spd-image-wrap">
                        <span v-if="soldOut && !preorderAllowed" class="spd-soldout">สินค้าหมด</span>
                        <img :src="imageUrl" :alt="displayName" @error="$event.target.src = ProductService.getPlaceholderImage()" />
                    </div>
                    <p v-if="detail.remark" class="spd-remark">{{ detail.remark }}</p>
                </section>

                <section class="spd-info-panel">
                    <div class="spd-summary-grid">
                        <div class="spd-summary-card is-price">
                            <span>ราคาต่อชุด</span>
                            <strong v-if="isLoggedIn">฿{{ formatMoney(price) }}</strong>
                            <strong v-else class="is-login-price">เข้าสู่ระบบเพื่อดูราคา</strong>
                        </div>
                        <div class="spd-summary-card">
                            <span>พร้อมสั่ง</span>
                            <strong :class="{ 'is-empty': soldOut }">{{ formatQty(availableQty) }} ชุด</strong>
                            <small v-if="soldOut && preorderAllowed" class="spd-preorder-note">เปิดรับ Preorder ทั้งชุด</small>
                        </div>
                    </div>

                    <div class="spd-bundle-box">
                        <div class="spd-section-title">
                            <i class="pi pi-box"></i>
                            <span>ภายใน 1 ชุด</span>
                        </div>

                        <div class="spd-group-label">สินค้าที่ซื้อ</div>
                        <div class="spd-lines">
                            <div v-for="item in paidItems" :key="`paid-${item.item_code}-${item.unit_code}-${item.line_number}`" class="spd-line is-paid">
                                <div class="spd-line-copy">
                                    <strong>{{ itemName(item) }}</strong>
                                    <span>{{ item.item_code }} · {{ item.unit_code }}</span>
                                </div>
                                <div class="spd-line-qty">
                                    <span>{{ formatQty(item.qty) }} × {{ quantity }}</span>
                                    <strong>{{ formatQty(scaledQty(item)) }} {{ item.unit_code }}</strong>
                                </div>
                            </div>
                        </div>

                        <div class="spd-group-label is-free"><i class="pi pi-gift"></i> ของแถมที่ได้รับ</div>
                        <div class="spd-lines">
                            <div v-for="item in freeItems" :key="`free-${item.item_code}-${item.unit_code}-${item.line_number}`" class="spd-line is-free">
                                <div class="spd-line-copy">
                                    <strong>{{ itemName(item) }}</strong>
                                    <span>{{ item.item_code }} · {{ item.unit_code }}</span>
                                </div>
                                <div class="spd-line-qty">
                                    <span>{{ formatQty(item.qty) }} × {{ quantity }}</span>
                                    <strong>{{ formatQty(scaledQty(item)) }} {{ item.unit_code }}</strong>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="spd-quantity-row">
                        <div>
                            <span class="spd-quantity-label">จำนวนชุด</span>
                            <small v-if="isLoggedIn">รวม ฿{{ formatMoney(lineTotal) }}</small>
                        </div>
                        <div class="spd-quantity-control">
                            <button type="button" aria-label="ลดจำนวนชุด" :disabled="!canDecrease" @click="decreaseQuantity"><i class="pi pi-minus"></i></button>
                            <input v-model.number="quantity" type="number" min="1" :max="availableQty || 1" aria-label="จำนวนชุด" @blur="normalizeQuantity" @change="normalizeQuantity" />
                            <button type="button" aria-label="เพิ่มจำนวนชุด" :disabled="!canIncrease" @click="increaseQuantity"><i class="pi pi-plus"></i></button>
                        </div>
                    </div>
                </section>
            </div>

            <footer class="spd-footer">
                <Button label="ปิด" severity="secondary" outlined class="spd-secondary-action" @click="closeDialog" />
                <Button
                    v-if="isLoggedIn"
                    :label="soldOut && preorderAllowed ? 'เพิ่มลงตะกร้า (Preorder)' : soldOut ? 'สินค้าหมด' : 'เพิ่มลงตะกร้า'"
                    icon="pi pi-shopping-cart"
                    class="spd-primary-action"
                    :loading="adding"
                    :disabled="!canAdd"
                    @click="addToCart"
                />
                <Button v-else label="เข้าสู่ระบบเพื่อสั่งซื้อ" icon="pi pi-sign-in" class="spd-primary-action" @click="goToLogin" />
            </footer>
        </div>
    </Dialog>
</template>

<style scoped>
.spd-loading,
.spd-error {
    min-height: 24rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.85rem;
    padding: 2rem;
    text-align: center;
    color: var(--market-muted, #64748b);
}

.spd-error > i { font-size: 2rem; color: #f97316; }
.spd-error > strong { color: var(--market-text, #172033); font-size: 1.05rem; }
.spd-error-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }

.spd-shell { background: var(--market-card-bg, #fff); color: var(--market-text, #172033); }

.spd-header {
    min-height: 5.25rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--market-card-border, #e2e8f0);
}

.spd-header-copy { min-width: 0; }
.spd-title-row { display: flex; align-items: center; gap: 0.65rem; min-width: 0; }
.spd-title-row h2 { margin: 0; font-size: 1.2rem; line-height: 1.35; overflow-wrap: anywhere; }
.spd-code { display: block; margin-top: 0.35rem; color: var(--market-muted, #64748b); font-size: 0.8rem; }

.spd-close {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 999px;
    border: 1px solid var(--market-card-border, #cbd5e1);
    background: transparent;
    color: var(--market-muted, #64748b);
    cursor: pointer;
    flex: 0 0 auto;
}
.spd-close:hover { border-color: var(--market-primary, #059669); color: var(--market-primary, #059669); }
.spd-close:focus-visible { outline: 2px solid var(--market-primary, #059669); outline-offset: 2px; }

.spd-body { display: grid; grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.18fr); gap: 1rem; padding: 1rem; }
.spd-image-panel,
.spd-info-panel { min-width: 0; }

.spd-image-panel {
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 14px;
    padding: 0.85rem;
    background: color-mix(in srgb, var(--market-card-bg, #fff) 96%, var(--market-primary, #059669));
}

.spd-image-wrap {
    position: relative;
    min-height: 22rem;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 10px;
    background: var(--market-product-image-bg, #f8fafc);
}
.spd-image-wrap img { width: 100%; height: 22rem; object-fit: contain; }
.spd-soldout { position: absolute; z-index: 1; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.48); color: #fff; font-size: 1.2rem; font-weight: 800; }
.spd-remark { margin: 0.8rem 0 0; color: var(--market-muted, #64748b); font-size: 0.85rem; white-space: pre-wrap; }

.spd-info-panel { display: flex; flex-direction: column; gap: 0.85rem; }
.spd-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; }
.spd-summary-card { min-height: 6rem; display: flex; flex-direction: column; justify-content: center; gap: 0.35rem; padding: 0.85rem 1rem; border: 1px solid var(--market-card-border, #e2e8f0); border-radius: 12px; background: var(--market-card-bg, #fff); }
.spd-summary-card span { color: var(--market-muted, #64748b); font-size: 0.78rem; font-weight: 700; }
.spd-summary-card strong { font-size: 1.25rem; }
.spd-summary-card.is-price { background: color-mix(in srgb, var(--market-card-bg, #fff) 92%, var(--market-primary, #059669)); border-color: color-mix(in srgb, var(--market-card-border, #e2e8f0) 70%, var(--market-primary, #059669)); }
.spd-summary-card.is-price strong { color: var(--market-primary, #059669); font-size: 1.55rem; }
.spd-summary-card .is-login-price { font-size: 0.9rem; }
.spd-summary-card .is-empty { color: #dc2626; }
.spd-preorder-note { color: #2563eb; font-size: 0.72rem; font-weight: 700; }

.spd-bundle-box { border: 1px solid var(--market-card-border, #e2e8f0); border-radius: 12px; padding: 0.85rem; }
.spd-section-title { display: flex; align-items: center; gap: 0.45rem; margin-bottom: 0.7rem; font-size: 0.92rem; font-weight: 800; }
.spd-section-title i { color: var(--market-primary, #059669); }
.spd-group-label { margin: 0.55rem 0 0.35rem; color: var(--market-muted, #64748b); font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; }
.spd-group-label.is-free { color: #db2777; }
.spd-lines { display: flex; flex-direction: column; gap: 0.45rem; }
.spd-line { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.65rem 0.7rem; border-radius: 9px; border: 1px solid #dbe5ef; background: #f8fafc; }
.spd-line.is-free { border-color: #fbcfe8; background: #fdf2f8; }
.spd-line-copy { min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.spd-line-copy strong { font-size: 0.84rem; line-height: 1.35; }
.spd-line-copy span { color: #64748b; font-size: 0.7rem; }
.spd-line-qty { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 0.1rem; font-size: 0.72rem; color: #64748b; }
.spd-line-qty strong { color: var(--market-primary, #059669); font-size: 0.85rem; }
.spd-line.is-free .spd-line-qty strong { color: #db2777; }

.spd-quantity-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.75rem 0.85rem; border: 1px solid var(--market-card-border, #e2e8f0); border-radius: 12px; }
.spd-quantity-row > div:first-child { display: flex; flex-direction: column; gap: 0.15rem; }
.spd-quantity-label { font-weight: 800; font-size: 0.85rem; }
.spd-quantity-row small { color: var(--market-primary, #059669); font-weight: 700; }
.spd-quantity-control { display: grid; grid-template-columns: 2.4rem 4.2rem 2.4rem; height: 2.4rem; }
.spd-quantity-control button,
.spd-quantity-control input { border: 1px solid #cbd5e1; background: #fff; color: #172033; text-align: center; }
.spd-quantity-control button { cursor: pointer; }
.spd-quantity-control button:first-child { border-radius: 8px 0 0 8px; }
.spd-quantity-control button:last-child { border-radius: 0 8px 8px 0; }
.spd-quantity-control input { width: 100%; border-left: 0; border-right: 0; font: inherit; font-weight: 700; }
.spd-quantity-control input::-webkit-outer-spin-button,
.spd-quantity-control input::-webkit-inner-spin-button { appearance: none; margin: 0; }
.spd-quantity-control button:disabled { color: #cbd5e1; cursor: not-allowed; }

.spd-footer { display: flex; gap: 0.7rem; padding: 0.9rem 1rem calc(0.9rem + env(safe-area-inset-bottom)); border-top: 1px solid var(--market-card-border, #e2e8f0); background: var(--market-card-bg, #fff); }
.spd-secondary-action { flex: 0 0 7rem; }
.spd-primary-action { flex: 1; }

@media (max-width: 760px) {
    .spd-header { align-items: flex-start; padding: 0.85rem 1rem; }
    .spd-title-row { align-items: flex-start; flex-direction: column; gap: 0.4rem; }
    .spd-body { grid-template-columns: 1fr; padding: 0.75rem; }
    .spd-image-wrap { min-height: 10.5rem; }
    .spd-image-wrap img { height: 10.5rem; }
    .spd-footer { position: sticky; bottom: 0; z-index: 2; }
}

@media (max-width: 480px) {
    .spd-summary-grid { grid-template-columns: 1fr; }
    .spd-summary-card { min-height: 4.75rem; }
    .spd-line { align-items: flex-start; }
    .spd-quantity-row { align-items: flex-start; flex-direction: column; }
    .spd-quantity-control { width: 100%; grid-template-columns: 2.6rem 1fr 2.6rem; }
    .spd-secondary-action { flex-basis: 5.5rem; }
}
</style>
