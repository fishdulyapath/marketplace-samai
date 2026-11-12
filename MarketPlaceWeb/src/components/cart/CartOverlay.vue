<script setup>
// ── ตะกร้าแบบ overlay ────────────────────────────────────────────────────
//
// รีวิว 260908 สไลด์ 4: เปลี่ยนจาก dropdown เล็กๆ ที่โชว์แค่ 3 รายการ
// เป็น drawer ชิดขวาเต็มความสูง — เลื่อนดูได้ทุกรายการ ไม่มีเลขหน้า
// และแถบยอดรวม/ปุ่มสั่งซื้อ freeze อยู่ล่างสุดตลอด
//
// แก้จำนวนได้ในตัว overlay เลย ไม่ต้องเข้าหน้าตะกร้าก่อน
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import CartQuantityEditor from './CartQuantityEditor.vue';
import ProductFullDetailDialog from '@/views/pages/ProductFullDetailDialog.vue';
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import ProductService from '@/services/ProductService';
import CartService from '@/services/CartService';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName } from '@/utils/languageDisplay';
import { cartStockBreakdown, hasCartStockShortage, stockQtyLimit } from '@/utils/cartStockLimit';
import { isPreorderAllowed, toOrderQty } from '@/utils/preorderSplit';
import { normalizeMaxOrderQty } from '@/utils/cartLimits';
import { buildBaseUnitRatioText } from '@/utils/unitConversion';
import { PRODUCT_IMAGE_PLACEHOLDER } from '@/utils/productPlaceholder';

const props = defineProps({
    page: Boolean, visible: { type: Boolean, default: false }
});

const emit = defineEmits(['update:visible']);

const router = useRouter();
const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = (key, params) => languageStore.t(key, params);

const items = computed(() => cartStore.cartItems || []);
const productGroups = computed(() => {
    const groups = new Map();
    for (const item of items.value) {
        const code = item.item_code || item.id;
        if (!groups.has(code)) groups.set(code, { code, first: item, lines: [] });
        groups.get(code).lines.push(item);
    }
    return [...groups.values()];
});
const totalLines = computed(() => Math.max(cartStore.totalCartCount || 0, items.value.length));
const totalAmount = computed(() => cartStore.totalAmount);
const totalItems = computed(() => cartStore.totalItems);

// บรรทัดที่กำลังยิง API — ปิดเฉพาะบรรทัดนั้น ไม่ล็อกทั้ง overlay
const pendingKeys = ref(new Set());
const isLoading = ref(false);
const stockReady = ref(false);
const stockLoadFailed = ref(false);
const panel = ref(null);
const shortageItems = computed(() => stockReady.value ? items.value.filter((item) => hasCartStockShortage(item, items.value)) : []);

function lineKey(item) {
    return JSON.stringify([item.guid_code || item.id, item.item_code, item.unit_code]);
}

function displayName(item) {
    return pickProductName(item, languageStore.locale) || item?.display_name || item?.item_name || item?.name || '';
}

function imageOf(item) {
    const code = item?.item_code || item?.code || item?.id;
    return code ? ProductService.getProductImageUrl(code, item) : PRODUCT_IMAGE_PLACEHOLDER;
}

function onImageError(event) {
    if (event?.target && event.target.src !== PRODUCT_IMAGE_PLACEHOLDER) event.target.src = PRODUCT_IMAGE_PLACEHOLDER;
}

function ratioTextOf(item) {
    return buildBaseUnitRatioText(item);
}

function formatMoney(value) {
    return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function lineTotal(item) {
    return (Number(item?.price) || 0) * toOrderQty(item?.qty);
}

// getcartitemlist contains a placeholder balance; fetch real stock before editing.
function maxQtyOf(item) {
    return stockQtyLimit(item, items.value, stockReady.value);
}

function draftExceedsLimit(item) {
    const max = maxQtyOf(item);
    return editingKey.value === lineKey(item) && stockReady.value && max !== null && Number(draftQty.value) > max;
}

function quantityLimitText(item) {
    const allowance = normalizeMaxOrderQty(item.max_order_qty);
    const stock = stockBreakdown(item);
    if (allowance !== null && (isPreorderAllowed(item) || !stock || allowance <= stock.maxReadyQty)) {
        return t('productDetail.maxAllowanceHint', { max: formatQty(allowance), unit: item.unit_code || '' });
    }
    return t('cartPage.stockAtLimit');
}

function stockBreakdown(item) {
    return cartStockBreakdown(item, items.value, stockReady.value);
}

function formatQty(value) {
    return new Intl.NumberFormat(languageStore.locale === 'en' ? 'en-US' : 'th-TH', { maximumFractionDigits: 2 }).format(value);
}

function stockNeedText(item) {
    const stock = stockBreakdown(item);
    if (!stock) return '';
    if (stock.baseUnit && stock.ratio !== 1) {
        return t('cartPage.stockNeedAvailableBase', {
            required: formatQty(stock.requiredBase), available: formatQty(stock.availableForLineBase), unit: stock.baseUnit
        });
    }
    return t('cartPage.stockNeedAvailableQty', {
        required: formatQty(stock.requestedQty), available: formatQty(stock.maxReadyQty), unit: item.unit_code || ''
    });
}

function focusFirstStockIssue() {
    panel.value?.querySelector('[data-stock-issue="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function adjustToStock(item) {
    const max = maxQtyOf(item);
    if (max > 0) await saveQuantity(item, max);
    else await removeLine(item);
}

async function loadStock() {
    stockReady.value = false;
    stockLoadFailed.value = false;
    saveError.value = '';
    const normal = items.value.filter((item) => String(item.item_type) !== '3' && String(item.item_type) !== '4');
    const sets = items.value.filter((item) => String(item.item_type) === '3');
    try {
        if (normal.length) {
            const stockRequests = new Map();
            for (const item of normal) {
                for (const unit_code of [item.unit_code, item.unit_standard].filter(Boolean)) {
                    stockRequests.set(JSON.stringify([item.item_code, unit_code]), { item_code: item.item_code, unit_code });
                }
            }
            const response = await CartService.getCartItemStock([...stockRequests.values()]);
            if (!response?.data?.success) throw new Error(t('cartPage.stockCheckFailedDetail'));
            const balances = new Map(response.data.data.map((row) => [JSON.stringify([row.item_code, row.unit_code]), row.balance_qty]));
            for (const item of normal) {
                const key = JSON.stringify([item.item_code, item.unit_code]);
                if (!balances.has(key)) throw new Error(t('cartPage.stockCheckFailedDetail'));
                item.balance_qty = balances.get(key);
                const baseKey = JSON.stringify([item.item_code, item.unit_standard]);
                if (item.unit_standard && balances.has(baseKey)) item.base_balance_qty = balances.get(baseKey);
            }
        }
        for (const item of sets) {
            const response = await ProductService.getProductSetByItemCode(item.item_code);
            if (response?.data?.balance_qty === undefined) throw new Error(t('cartPage.stockCheckFailedDetail'));
            item.balance_qty = response.data.balance_qty;
        }
        stockReady.value = true;
    } catch (error) {
        stockLoadFailed.value = true;
        saveError.value = error.message || t('cartPage.stockCheckFailedDetail');
    }
}

const editingKey = ref(null);
const draftQty = ref('');
function editQuantity(item) {
    draftQty.value = String(toOrderQty(item.qty));
    editingKey.value = lineKey(item);
}
const saveError = ref('');
async function saveQuantity(item, nextQty) {
    const key = lineKey(item);
    if (pendingKeys.value.has(key)) return;

    const qty = Math.max(0, Math.trunc(Number(nextQty) || 0));
    if (qty === toOrderQty(item.qty)) return true;
    if (qty > toOrderQty(item.qty) && (!stockReady.value || (maxQtyOf(item) !== null && qty > maxQtyOf(item)))) return false;
    saveError.value = '';

    // Set ใน ref ต้องสร้างใหม่ Vue ถึงจะเห็นการเปลี่ยนแปลง
    pendingKeys.value = new Set(pendingKeys.value).add(key);
    try {
        if (qty === 0) {
            await cartStore.removeFromCart(item);
        } else {
            await cartStore.updateCartItem({ ...item, qty, quantity: qty });
            await cartStore.fetchCartSummary();
        }
        return true;
    } catch (err) {
        saveError.value = err.message || t('common.error');
        // ยิงไม่สำเร็จ — ดึงตะกร้าจริงกลับมาให้เลขตรงกับฐานข้อมูล
        await cartStore.loadCartItems(true).catch(() => {});
        return false;
    } finally {
        const next = new Set(pendingKeys.value);
        next.delete(key);
        pendingKeys.value = next;
    }
}

async function removeLine(item) {
    await saveQuantity(item, 0);
}

function close() {
    if (!pendingKeys.value.size) emit('update:visible', false);
}

function goToCart() {
    if (editingKey.value || pendingKeys.value.size) return;
    if (shortageItems.value.length) {
        focusFirstStockIssue();
        return;
    }
    close();
    router.push({ path: '/cart', query: router.currentRoute.value.query });
}

// คลิกชื่อ/รูปในตะกร้า → เปิด dialog สั่งสินค้า (ไม่ใช่หน้ารายละเอียดเต็ม)
// เปิดซ้อนบน drawer ไปเลย ปิด dialog แล้วยังจัดการตะกร้าต่อได้ทันที
// ต้องตั้ง baseZIndex สูงกว่า drawer (1200) ไม่งั้น dialog จะไปอยู่ข้างหลัง
const DIALOG_Z_INDEX = 1300;
const selectedProductCode = ref('');
const selectedProductIsSet = ref(false);
const showProductDialog = ref(false);
const fullDetail = ref(false);
const fullSelection = ref(null);
function openFullProductDetail(code, selection = null) {
    selectedProductCode.value = code;
    fullSelection.value = selection;
    showProductDialog.value = false;
    fullDetail.value = true;
}

function openProductDialog(item) {
    const code = String(item?.item_code || item?.code || '').trim();
    if (!code) return;
    selectedProductCode.value = code;
    selectedProductIsSet.value = String(item?.item_type ?? '0') === '3';
    showProductDialog.value = true;
}

// ปิด dialog แล้วดึงตะกร้าใหม่ เผื่อผู้ใช้เพิ่ม/แก้จำนวนของหน่วยอื่นไป
watch(showProductDialog, async (open) => {
    if (open) return;
    // PrimeVue Dialog คืนค่า body overflow ตอนปิด ทำให้ drawer เลื่อนหน้าหลังได้อีก
    if (typeof document !== 'undefined' && !props.page && props.visible) document.body.style.overflow = 'hidden';
    await cartStore.loadCartItems(true).then(loadStock).catch(() => {});
});

// เปิด overlay ครั้งใดให้ดึงตะกร้าล่าสุดเสมอ — ผู้ใช้อาจแก้จากอีกแท็บ
watch(
    () => props.visible,
    async (open) => {
        editingKey.value = null;
        saveError.value = '';
        if (!open) return;
        stockReady.value = false;
        stockLoadFailed.value = false;
        try {
            isLoading.value = true;
            await cartStore.loadCartItems(true, true);
            await loadStock();
        } catch (err) {
            console.error('CartOverlay load failed:', err);
        } finally {
            isLoading.value = false;
        }
    }, { immediate: true }
);

// เปิด drawer แล้วล็อกไม่ให้หน้าข้างหลังเลื่อน (สำคัญมากบนมือถือ)
watch(
    () => props.visible,
    (open) => {
        if (props.page || typeof document === 'undefined') return;
        document.body.style.overflow = open ? 'hidden' : '';
    }
);

function onKeydown(event) {
    if (event.key === 'Escape' && props.visible && !showProductDialog.value && !fullDetail.value) close();
}

if (typeof window !== 'undefined') window.addEventListener('keydown', onKeydown);

onBeforeUnmount(() => {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
    if (!props.page && typeof document !== 'undefined') document.body.style.overflow = '';
});
</script>

<template>
    <Teleport to="body" :disabled="page">
        <Transition name="cart-overlay">
            <div v-if="visible" class="cart-overlay-root" :class="{ 'basket-page': page }">
                <div v-if="!page" class="cart-overlay-scrim" @click="close"></div>

                <aside ref="panel" class="cart-overlay-panel" :role="page ? 'region' : 'dialog'" :aria-modal="page ? undefined : true" :aria-label="t('cart.cart')">
                    <!-- หัว: คงที่ -->
                    <header class="cart-overlay-head">
                        <i class="pi pi-shopping-cart cart-mark" aria-hidden="true"></i>
                        <div>
                            <h2>{{ t('cart.cart') }}</h2>
                            <span>{{ t('cart.itemCount', { count: totalLines }) }}</span>
                        </div>
                        <button type="button" v-if="!page" class="cart-overlay-close" :aria-label="t('common.close')" @click="close">
                            <i class="pi pi-times"></i>
                        </button>
                    </header>

                    <!-- ตัวรายการ: ส่วนเดียวที่ scroll ได้ ไหลไปเรื่อยๆ ไม่มีเลขหน้า -->
                    <div class="cart-overlay-body">
                        <div v-if="isLoading && items.length === 0" class="cart-overlay-state">
                            <i class="pi pi-spin pi-spinner"></i>
                        </div>

                        <div v-else-if="items.length === 0" class="cart-overlay-state">
                            <i class="pi pi-shopping-cart"></i>
                            <p>{{ t('cart.empty') }}</p>
                        </div>

                        <ul v-else class="cart-overlay-list">
                            <li v-for="group in productGroups" :key="group.code" class="cart-overlay-product">
                                <button class="cart-group-title" type="button" @click="openProductDialog(group.first)">
                                    <img :src="imageOf(group.first)" alt="" loading="lazy" @error="onImageError" />
                                    <strong>{{ displayName(group.first) }}</strong>
                                </button>
                                <div v-for="item in group.lines" :key="lineKey(item)" class="cart-unit-row" :class="{ editing: editingKey === lineKey(item) }" :data-stock-issue="stockReady && hasCartStockShortage(item, items) ? 'true' : null">
                                    <div class="cart-unit-label"><strong>{{ item.unit_code }}</strong><small>฿{{ formatMoney(item.price) }}</small>
                                        <small v-if="ratioTextOf(item)">{{ ratioTextOf(item) }}</small></div>
                                    <div class="cart-unit-editor"><CartQuantityEditor v-model:draft="draftQty" :qty="toOrderQty(item.qty)" :unit="item.unit_code" :name="displayName(item)"
                                        :active="editingKey === lineKey(item)" :max="maxQtyOf(item)" :disabled="pendingKeys.size > 0 || !stockReady"
                                        :save="qty => saveQuantity(item, qty)" @edit="editQuantity(item)" @close="editingKey = null" /></div>
                                    <strong class="cart-unit-total">฿{{ formatMoney(lineTotal(item)) }}</strong>
                                    <button type="button" class="cart-overlay-remove" :aria-label="t('cart.remove')"  :disabled="pendingKeys.size > 0 || !!editingKey" @click="removeLine(item)">
                                    <i class="pi pi-trash"></i>
                                    </button>
                                    <div v-if="editingKey !== lineKey(item) && stockReady && hasCartStockShortage(item, items)" class="cart-stock-guide cart-stock-guide--shortage" role="alert">
                                        <div class="cart-stock-guide-copy">
                                            <strong>{{ t('cartPage.stockNotEnough') }}</strong>
                                            <span>{{ stockNeedText(item) }}</span>
                                            <small>{{ t('cartPage.stockCanOrder', { qty: formatQty(maxQtyOf(item)), unit: item.unit_code || '' }) }}</small>
                                        </div>
                                        <button type="button" class="cart-stock-guide-action" :disabled="pendingKeys.size > 0 || !!editingKey" @click="adjustToStock(item)">
                                            {{ maxQtyOf(item) > 0 ? t('cartPage.stockAdjustTo', { qty: formatQty(maxQtyOf(item)), unit: item.unit_code || '' }) : t('cartPage.removeItem') }}
                                        </button>
                                    </div>
                                    <div v-else-if="stockBreakdown(item)?.preorderQty > 0" class="cart-stock-guide cart-stock-guide--preorder">
                                        <div class="cart-stock-pills">
                                            <span>{{ t('cartPage.stockReadyQty', { qty: formatQty(stockBreakdown(item).readyQty), unit: item.unit_code || '' }) }}</span>
                                            <span>{{ t('cartPage.stockPreorderQty', { qty: formatQty(stockBreakdown(item).preorderQty), unit: item.unit_code || '' }) }}</span>
                                        </div>
                                        <small>{{ t('cartPage.stockPreorderHint') }}</small>
                                    </div>
                                    <div v-else-if="draftExceedsLimit(item)" class="cart-stock-guide cart-stock-guide--limit" role="status">
                                        <i class="pi pi-info-circle" aria-hidden="true"></i>
                                        <span>{{ quantityLimitText(item) }}</span>
                                        <button v-if="maxQtyOf(item) > 0" type="button" class="cart-stock-guide-action" @click="draftQty = String(maxQtyOf(item))">{{ t('cartPage.stockAdjustTo', { qty: maxQtyOf(item), unit: item.unit_code }) }}</button>
                                    </div>
                                    <div v-else-if="stockLoadFailed" class="cart-stock-guide cart-stock-guide--limit" role="status">
                                        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                                        <span>{{ t('cartPage.stockCheckFailedDetail') }}</span>
                                        <button type="button" class="cart-stock-guide-action" @click="loadStock">{{ t('cartPage.refreshStock') }}</button>
                                    </div>
                                </div>
                            </li>
                        </ul>
                    </div>

                    <!-- ท้าย: freeze ไว้ตลอด ไม่เลื่อนตามรายการ -->
                    <footer class="cart-overlay-foot">
                        <p v-if="saveError" role="alert">{{ saveError }}</p>
                        <p v-if="shortageItems.length" class="cart-overlay-stock-reason" role="status">{{ t('cartPage.mustFixStock', { count: shortageItems.length }) }}</p>
                        <div class="cart-overlay-sum">
                            <span>{{ t('common.amount') }}</span>
                            <strong>฿{{ formatMoney(totalAmount) }}</strong>
                        </div>
                        <div class="cart-overlay-sum cart-overlay-sum--sub">
                            <span>{{ t('cart.itemCount', { count: totalLines }) }}</span>
                            <span>{{ totalItems }} {{ t('common.piece') }}</span>
                        </div>
                        <button type="button" class="cart-overlay-cta" :disabled="!!editingKey || pendingKeys.size > 0 || isLoading || items.length === 0" @click="goToCart">
                            <i class="pi pi-shopping-cart"></i>
                            {{ shortageItems.length ? t('cartPage.stockGoFix') : t('cart.continueOrder') }}
                        </button>
                    </footer>
                </aside>

                <!-- dialog สั่งสินค้า — ซ้อนบน drawer เพื่อให้ปิดแล้วกลับมาจัดการตะกร้าต่อได้ -->
                <ProductDetailDialog
                    v-if="selectedProductCode && !selectedProductIsSet"
                    v-model:visible="showProductDialog"
                    :itemCode="selectedProductCode"
                    :baseZIndex="DIALOG_Z_INDEX"
                    @show-full-detail="openFullProductDetail"
                />
                <ProductSetDialog
                    v-if="selectedProductCode && selectedProductIsSet"
                    v-model:visible="showProductDialog"
                    :itemCode="selectedProductCode"
                    :baseZIndex="DIALOG_Z_INDEX"
                    @show-full-detail="openFullProductDetail"
                />
                <ProductFullDetailDialog v-model:visible="fullDetail" :item-code="selectedProductCode"
                    :selection="fullSelection" :baseZIndex="DIALOG_Z_INDEX" />
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.cart-overlay-root {
    position: fixed;
    inset: 0;
    /* เหนือ topbar (997) และแถบเมนูล่าง (996) */
    z-index: 1200;
    display: flex;
    justify-content: flex-end;
}

.cart-overlay-scrim {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
}

.cart-overlay-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(640px, 100vw);
    height: 100%;
    background: var(--market-card-bg, #fff);
    box-shadow: -18px 0 42px rgba(15, 23, 42, 0.18);
}

.cart-overlay-head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.1rem;
    border-bottom: 1px solid var(--market-card-border, #e2e8f0);
}

.cart-overlay-head h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--market-text, #1e293b);
}

.cart-overlay-head span {
    font-size: 0.8rem;
    color: var(--market-muted, #64748b);
}

.cart-overlay-close {
    border: none;
    background: transparent;
    color: var(--market-muted, #64748b);
    width: 40px;
    height: 40px;
    border-radius: 999px;
    cursor: pointer;
    flex: none;
}

.cart-overlay-close:hover {
    background: var(--market-surface-soft, #f1f5f9);
}

/* 🚨 ส่วนเดียวที่ scroll ได้ — หัวกับท้ายต้องอยู่กับที่ (รีวิว 260908 สไลด์ 4) */
.cart-overlay-body {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
}

.cart-overlay-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 3rem 1rem;
    color: var(--market-muted, #94a3b8);
}

.cart-overlay-state i {
    font-size: 1.75rem;
}

.cart-overlay-state p {
    margin: 0;
    font-size: 0.9rem;
}

.cart-overlay-list {
    list-style: none;
    margin: 0;
    padding: 0;
}

.cart-overlay-line {
    display: flex;
    gap: 0.75rem;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--market-card-border, #e2e8f0) 70%, transparent);
}

.cart-overlay-thumb {
    flex: none;
    width: 60px;
    height: 60px;
    padding: 0;
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
    cursor: pointer;
}

.cart-overlay-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.cart-overlay-info {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}

.cart-overlay-name {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    font-size: 0.88rem;
    line-height: 1.35;
    color: var(--market-text, #1e293b);
    text-align: left;
    cursor: pointer;
    /* ชื่อยาวไม่ควรดันความกว้างจนปุ่มลบหลุดขอบ */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.cart-overlay-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--market-muted, #64748b);
}

.cart-overlay-unit {
    border: 1px solid var(--market-card-border, #e2e8f0);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
}

.cart-overlay-price {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    flex-wrap: wrap;
}

.cart-overlay-price strong {
    font-size: 0.95rem;
    color: var(--market-primary, #16a34a);
}

.cart-overlay-price small {
    font-size: 0.72rem;
    color: var(--market-muted, #94a3b8);
}

.cart-overlay-remove {
    flex: none;
    align-self: flex-start;
    border: none;
    background: transparent;
    color: var(--market-muted, #94a3b8);
    width: 34px;
    height: 34px;
    border-radius: 999px;
    cursor: pointer;
}

.cart-overlay-remove:hover:not(:disabled) {
    background: #fef2f2;
    color: #dc2626;
}

.cart-overlay-remove:disabled {
    opacity: 0.4;
    cursor: default;
}

.cart-overlay-foot {
    flex: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.9rem 1.1rem calc(0.9rem + var(--app-safe-bottom, 0px));
    border-top: 1px solid var(--market-card-border, #e2e8f0);
    background: var(--market-card-bg, #fff);
}

.cart-overlay-sum {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 0.9rem;
    color: var(--market-text, #1e293b);
}

.cart-overlay-sum strong {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--market-primary, #16a34a);
}

.cart-overlay-sum--sub {
    display: none;
}

.cart-overlay-cta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 46px;
    border: none;
    border-radius: 12px;
    background: var(--market-primary, #16a34a);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
}

.cart-overlay-cta:disabled {
    opacity: 0.5;
    cursor: default;
}

/* มือถือ: drawer เต็มจอ ปุ่มใหญ่ขึ้น */
@media (max-width: 640px) {
    .cart-overlay-panel {
        width: 100vw;
    }

    .cart-overlay-cta {
        min-height: 50px;
    }
}

.cart-overlay-head, .cart-overlay-foot { background:linear-gradient(105deg,var(--market-header-bg,#fff),var(--market-primary-soft,#edf6f0)); }
.cart-overlay-head { justify-content:flex-start; gap:.75rem; }
.cart-mark { font-size:1.5rem; color:var(--market-primary); }
.cart-overlay-close { margin-inline-start:auto; }
.cart-overlay-product { padding:.8rem 1rem; border-bottom:1px solid var(--market-card-border); }
.cart-group-title { display:flex; align-items:center; gap:.8rem; text-align:start; background:transparent; border:0; padding:0; }
.cart-group-title img { width:52px; height:52px; object-fit:contain; border:1px solid var(--market-card-border); border-radius:.6rem; }
.cart-unit-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto 2rem; align-items:center; gap:.6rem; margin-top:.7rem; }
.cart-unit-editor { min-width:0; }
.cart-unit-row small { display:block; color:var(--market-muted); font-size:.8rem; }
.cart-unit-total { color:var(--market-primary); }
.cart-stock-guide { grid-column:1 / -1; display:flex; justify-content:space-between; align-items:center; gap:.65rem; padding:.7rem .8rem; border-radius:.65rem; font-size:.83rem; line-height:1.45; }
.cart-stock-guide--shortage, .cart-stock-guide--limit { background:#fff1ed; border:1px solid #f3d2c9; color:#b52f21; }
.cart-stock-guide--preorder { display:block; background:#fff8e9; border:1px solid #f0dfb9; color:#875c12; }
.cart-stock-guide--limit { justify-content:flex-start; font-weight:700; }
.cart-stock-guide-copy { display:grid; gap:.15rem; min-width:0; }
.cart-stock-guide-copy strong { font-weight:700; }
.cart-stock-guide-copy small, .cart-stock-guide--preorder small { color:inherit; opacity:.85; }
.cart-stock-guide-action { flex:none; padding:.46rem .7rem; color:#9e3828; background:#fff; border:1px solid #e9a995; border-radius:.55rem; font-weight:700; cursor:pointer; }
.cart-stock-guide-action:hover:not(:disabled) { background:#fff8f5; }
.cart-stock-guide-action:disabled { opacity:.55; cursor:default; }
.cart-stock-pills { display:flex; flex-wrap:wrap; gap:.4rem; margin-bottom:.25rem; }
.cart-stock-pills span { padding:.22rem .55rem; border-radius:999px; background:#fff0cf; font-weight:700; }
.cart-stock-pills span:first-child { background:#e5f5ee; color:#0a5948; }
.cart-overlay-stock-reason { color:#9e3828; font-size:.85rem; font-weight:700; }
.cart-overlay-foot .cart-overlay-sum { display:block; }
.cart-overlay-foot .cart-overlay-sum--sub { display:none; }
.cart-overlay-foot .cart-overlay-sum > span { display:block; font-size:.74rem; }
.cart-overlay-foot .cart-overlay-sum strong { display:block; font-size:1.45rem; }
.cart-overlay-foot > p { grid-column:1 / -1; }
.cart-overlay-head h2 { font-size:1.45rem; }
.cart-overlay-head { padding-block:.85rem; }
.cart-overlay-cta { border-radius:8px; }
.cart-overlay-enter-active,
.cart-overlay-leave-active {
    transition: opacity 0.18s ease;
}

.cart-overlay-enter-active .cart-overlay-panel,
.cart-overlay-leave-active .cart-overlay-panel {
    transition: transform 0.22s ease;
}

.cart-overlay-enter-from,
.cart-overlay-leave-to {
    opacity: 0;
}

.cart-overlay-enter-from .cart-overlay-panel,
.cart-overlay-leave-to .cart-overlay-panel {
    transform: translateX(100%);
}

@media (prefers-reduced-motion: reduce) {
    .cart-overlay-enter-active,
    .cart-overlay-leave-active,
    .cart-overlay-enter-active .cart-overlay-panel,
    .cart-overlay-leave-active .cart-overlay-panel {
        transition: none;
    }
}
.basket-page { position:relative; inset:auto; z-index:auto; height:calc(100dvh - 9rem); max-width:1100px; margin:auto; }
.basket-page .cart-overlay-panel { width:100%; box-shadow:none; }
.basket-page .cart-overlay-list { padding:12px; }
.basket-page .cart-overlay-product { border:1px solid var(--market-card-border); border-radius:12px; margin-bottom:10px; padding:14px; }
.cart-unit-row.editing { background:var(--market-primary-soft); border-radius:8px; }
@media(max-width:900px) {
    .basket-page { position:fixed; inset:var(--market-header-height,4rem) 0 calc(var(--market-mobile-nav-height,64px) + env(safe-area-inset-bottom)); height:auto; }
    .cart-unit-row.editing { grid-template-columns:minmax(0,1fr) auto; grid-template-areas:'label label' 'editor editor' 'total remove'; padding:.5rem; row-gap:.3rem; }
    .cart-unit-row.editing .cart-unit-label { grid-area:label; }
    .cart-unit-row.editing .cart-unit-editor { grid-area:editor; justify-self:end; }
    .cart-unit-row.editing .cart-unit-total { grid-area:total; }
    .cart-unit-row.editing .cart-overlay-remove { grid-area:remove; }
    .cart-unit-row.editing .cart-stock-guide { grid-column:1 / -1; }
    .cart-stock-guide--shortage, .cart-stock-guide--limit {
        display:grid; grid-template-columns:auto minmax(0,1fr); align-items:start;
        justify-content:start; min-width:0; overflow-wrap:anywhere;
    }
    .cart-stock-guide--limit > i { margin-top:.2em; }
    .cart-stock-guide-copy, .cart-stock-guide-action { grid-column:1 / -1; }
    .cart-stock-guide-action { justify-self:start; max-width:100%; white-space:normal; }
}
</style>
