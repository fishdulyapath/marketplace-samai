<script setup>
import { getProductImageUrl, getProductMarketplaceParticipation, setProductMarketplaceParticipation } from '@/services/productManageService';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const toast = useToast();

const BATCH_SIZE = 120;
const SCROLL_THRESHOLD = 260;

const searchText = ref('');
const notJoinedProducts = ref([]);
const joinedProducts = ref([]);
const notJoinedCount = ref(0);
const joinedCount = ref(0);
const isInitialLoading = ref(false);
const loadingMore = ref({ not_joined: false, joined: false });
const cursors = ref({ not_joined: '', joined: '' });
const updatingCodes = ref(new Set());
const skeletonRows = Array.from({ length: 8 }, (_, index) => index + 1);
let productLoadSeq = 0;

const PLACEHOLDER_IMG =
  'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22 viewBox=%220 0 48 48%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23e5e7eb%22/%3E%3Cpath d=%22M12 34l8-10 6 7 4-5 6 8z%22 fill=%22%239ca3af%22/%3E%3Ccircle cx=%2218%22 cy=%2218%22 r=%223%22 fill=%22%239ca3af%22/%3E%3C/svg%3E';

const resultSummary = computed(() => `${notJoinedCount.value.toLocaleString('th-TH')} ยังไม่เข้าร่วม / ${joinedCount.value.toLocaleString('th-TH')} เข้าร่วมแล้ว`);
const isAnyLoading = computed(() => isInitialLoading.value || loadingMore.value.not_joined || loadingMore.value.joined);
const isUpdatingAny = computed(() => updatingCodes.value.size > 0);
const isParticipationBusy = computed(() => isAnyLoading.value || isUpdatingAny.value);

function getSideProducts(side) {
  return side === 'joined' ? joinedProducts.value : notJoinedProducts.value;
}

function getSideCount(side) {
  return side === 'joined' ? joinedCount.value : notJoinedCount.value;
}

function hasMore(side) {
  return getSideProducts(side).length < getSideCount(side);
}

function setSideLoading(side, value) {
  loadingMore.value = { ...loadingMore.value, [side]: value };
}

function onImgError(event) {
  event.target.src = PLACEHOLDER_IMG;
}

function isUpdating(code) {
  return updatingCodes.value.has(code);
}

function setUpdating(code, value) {
  const next = new Set(updatingCodes.value);
  if (value) next.add(code);
  else next.delete(code);
  updatingCodes.value = next;
}

function normalizeProduct(product, joined) {
  return {
    ...product,
    item_pattern: joined ? '[W]' : '',
    joined,
  };
}

function sortProducts(items) {
  return [...items].sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
}

function mergeProducts(current, incoming) {
  const byCode = new Map(current.map((product) => [product.code, product]));
  incoming.forEach((product) => byCode.set(product.code, product));
  return sortProducts([...byCode.values()]);
}

function updateCursor(side, rows) {
  const last = rows[rows.length - 1];
  if (!last?.code) return;
  cursors.value = { ...cursors.value, [side]: last.code };
}

function resetLists() {
  notJoinedProducts.value = [];
  joinedProducts.value = [];
  notJoinedCount.value = 0;
  joinedCount.value = 0;
  cursors.value = { not_joined: '', joined: '' };
}

async function loadProducts() {
  if (isParticipationBusy.value) return;
  const requestId = ++productLoadSeq;
  const requestSearch = searchText.value.trim();
  isInitialLoading.value = true;
  resetLists();
  try {
    const data = await getProductMarketplaceParticipation({
      search: requestSearch,
      limit: BATCH_SIZE,
    });
    if (requestId !== productLoadSeq) return;
    const notJoinedRows = data.not_joined || [];
    const joinedRows = data.joined || [];
    notJoinedProducts.value = notJoinedRows;
    joinedProducts.value = joinedRows;
    notJoinedCount.value = data.not_joined_count || 0;
    joinedCount.value = data.joined_count || 0;
    updateCursor('not_joined', notJoinedRows);
    updateCursor('joined', joinedRows);
  } catch (error) {
    if (requestId !== productLoadSeq) return;
    toast.add({ severity: 'error', summary: 'โหลดสินค้าไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
    resetLists();
  } finally {
    if (requestId === productLoadSeq) isInitialLoading.value = false;
  }
}

async function loadMore(side) {
  if (isInitialLoading.value || isUpdatingAny.value || loadingMore.value[side] || !hasMore(side)) return;
  const requestId = productLoadSeq;
  const requestSearch = searchText.value.trim();
  const requestCursor = cursors.value[side];
  setSideLoading(side, true);
  try {
    const data = await getProductMarketplaceParticipation({
      search: requestSearch,
      limit: BATCH_SIZE,
      side,
      cursor_code: requestCursor,
    });
    if (requestId !== productLoadSeq) return;
    const rows = side === 'joined' ? data.joined || [] : data.not_joined || [];
    if (side === 'joined') {
      joinedProducts.value = mergeProducts(joinedProducts.value, rows);
      joinedCount.value = data.joined_count || joinedCount.value;
    } else {
      notJoinedProducts.value = mergeProducts(notJoinedProducts.value, rows);
      notJoinedCount.value = data.not_joined_count || notJoinedCount.value;
    }
    updateCursor(side, rows);
  } catch (error) {
    if (requestId !== productLoadSeq) return;
    toast.add({ severity: 'error', summary: 'โหลดสินค้าเพิ่มไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3000 });
  } finally {
    if (requestId === productLoadSeq) setSideLoading(side, false);
  }
}

function onSearch() {
  if (isParticipationBusy.value) return;
  loadProducts();
}

function onProductScroll(side, event) {
  const target = event.target;
  if (!target) return;
  const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - SCROLL_THRESHOLD;
  if (nearBottom) loadMore(side);
}

async function toggleProduct(product, nextJoined) {
  if (!product?.code || isParticipationBusy.value || isUpdating(product.code)) return;
  setUpdating(product.code, true);

  try {
    const response = await setProductMarketplaceParticipation({
      code: product.code,
      joined: nextJoined,
    });
    if (!response.success) throw new Error(response.message || 'บันทึกไม่สำเร็จ');

    const updated = normalizeProduct(response.data || product, nextJoined);
    if (nextJoined) {
      notJoinedProducts.value = notJoinedProducts.value.filter((item) => item.code !== product.code);
      joinedProducts.value = mergeProducts(joinedProducts.value, [updated]);
      notJoinedCount.value = Math.max(0, notJoinedCount.value - 1);
      joinedCount.value += 1;
    } else {
      joinedProducts.value = joinedProducts.value.filter((item) => item.code !== product.code);
      notJoinedProducts.value = mergeProducts(notJoinedProducts.value, [updated]);
      joinedCount.value = Math.max(0, joinedCount.value - 1);
      notJoinedCount.value += 1;
    }

    toast.add({
      severity: 'success',
      summary: nextJoined ? 'เข้าร่วม marketplace แล้ว' : 'นำออกจาก marketplace แล้ว',
      detail: `${updated.code} - ${updated.name_1 || '-'}`,
      life: 1800,
    });
  } catch (error) {
    toast.add({ severity: 'error', summary: 'อัปเดตสินค้าไม่สำเร็จ', detail: error?.response?.data?.message || error.message, life: 3500 });
  } finally {
    setUpdating(product.code, false);
  }
}

onMounted(() => {
  loadProducts();
});
</script>

<template>
  <main class="participation-page">
    <header class="page-header">
      <Button icon="pi pi-arrow-left" text rounded severity="secondary" aria-label="กลับหน้าจัดการหลังบ้าน" :disabled="isParticipationBusy" @click="router.push('/admin')" />
      <div class="page-heading">
        <p>MARKETPLACE PRODUCTS</p>
        <h1>กำหนดสินค้าเข้าร่วม</h1>
        <span>{{ resultSummary }}</span>
      </div>
      <Button icon="pi pi-refresh" outlined aria-label="โหลดรายการสินค้าใหม่" :loading="isAnyLoading" :disabled="isParticipationBusy" @click="loadProducts" />
    </header>

    <section class="search-band">
      <InputText v-model="searchText" placeholder="ค้นหารหัสสินค้า / บาร์โค้ด / ชื่อสินค้า" aria-label="ค้นหารหัสสินค้า บาร์โค้ด หรือชื่อสินค้า" class="search-input" :disabled="isParticipationBusy" @keyup.enter="onSearch" />
      <Button icon="pi pi-search" aria-label="ค้นหาสินค้าเข้าร่วม" :loading="isInitialLoading" :disabled="isParticipationBusy" @click="onSearch" />
    </section>

    <section class="product-columns">
      <article class="product-panel not-joined">
        <div class="panel-head">
          <div>
            <h2>สินค้าที่ยังไม่ได้เข้าร่วม</h2>
            <span>{{ notJoinedProducts.length.toLocaleString('th-TH') }} / {{ notJoinedCount.toLocaleString('th-TH') }} รายการ</span>
          </div>
          <i class="pi pi-arrow-right"></i>
        </div>

        <div class="product-list" @scroll="onProductScroll('not_joined', $event)">
          <template v-if="isInitialLoading">
            <div v-for="row in skeletonRows" :key="`not-joined-skeleton-${row}`" class="product-row skeleton-row">
              <span class="skeleton-box skeleton-image"></span>
              <span class="product-main">
                <span class="skeleton-box skeleton-code"></span>
                <span class="skeleton-box skeleton-name"></span>
                <span class="skeleton-box skeleton-sub"></span>
              </span>
              <span class="skeleton-box skeleton-icon"></span>
            </div>
          </template>
          <template v-else>
            <button
              v-for="product in notJoinedProducts"
              :key="product.code"
              type="button"
              class="product-row"
              :aria-label="`เพิ่มสินค้า ${product.code} ${product.name_1 || ''} เข้าร่วม marketplace`"
              :disabled="isParticipationBusy || isUpdating(product.code)"
              @click="toggleProduct(product, true)"
            >
              <img :src="getProductImageUrl(product.code)" alt="" loading="lazy" @error="onImgError" />
              <span class="product-main">
                <strong>{{ product.code }}</strong>
                <span>{{ product.name_1 || '-' }}</span>
                <small v-if="product.name_eng_1">{{ product.name_eng_1 }}</small>
              </span>
              <i :class="isUpdating(product.code) ? 'pi pi-spin pi-spinner' : 'pi pi-plus-circle'"></i>
            </button>
            <div v-if="loadingMore.not_joined" class="load-more-state">
              <i class="pi pi-spin pi-spinner"></i>
              <span>กำลังโหลดสินค้าเพิ่ม...</span>
            </div>
            <div v-else-if="notJoinedProducts.length && !hasMore('not_joined')" class="load-more-state done">โหลดครบแล้ว</div>
            <div v-if="!notJoinedProducts.length" class="empty-state">ไม่พบสินค้าที่ยังไม่ได้เข้าร่วม</div>
          </template>
        </div>
      </article>

      <article class="product-panel joined">
        <div class="panel-head">
          <div>
            <h2>สินค้าเข้าร่วมแล้ว</h2>
            <span>{{ joinedProducts.length.toLocaleString('th-TH') }} / {{ joinedCount.toLocaleString('th-TH') }} รายการ</span>
          </div>
          <i class="pi pi-check-circle"></i>
        </div>

        <div class="product-list" @scroll="onProductScroll('joined', $event)">
          <template v-if="isInitialLoading">
            <div v-for="row in skeletonRows" :key="`joined-skeleton-${row}`" class="product-row skeleton-row">
              <span class="skeleton-box skeleton-image"></span>
              <span class="product-main">
                <span class="skeleton-box skeleton-code"></span>
                <span class="skeleton-box skeleton-name"></span>
                <span class="skeleton-box skeleton-sub"></span>
              </span>
              <span class="skeleton-box skeleton-icon"></span>
            </div>
          </template>
          <template v-else>
            <button
              v-for="product in joinedProducts"
              :key="product.code"
              type="button"
              class="product-row"
              :aria-label="`นำสินค้า ${product.code} ${product.name_1 || ''} ออกจาก marketplace`"
              :disabled="isParticipationBusy || isUpdating(product.code)"
              @click="toggleProduct(product, false)"
            >
              <img :src="getProductImageUrl(product.code)" alt="" loading="lazy" @error="onImgError" />
              <span class="product-main">
                <strong>{{ product.code }}</strong>
                <span>{{ product.name_1 || '-' }}</span>
                <small v-if="product.name_eng_1">{{ product.name_eng_1 }}</small>
              </span>
              <i :class="isUpdating(product.code) ? 'pi pi-spin pi-spinner' : 'pi pi-minus-circle'"></i>
            </button>
            <div v-if="loadingMore.joined" class="load-more-state">
              <i class="pi pi-spin pi-spinner"></i>
              <span>กำลังโหลดสินค้าเพิ่ม...</span>
            </div>
            <div v-else-if="joinedProducts.length && !hasMore('joined')" class="load-more-state done">โหลดครบแล้ว</div>
            <div v-if="!joinedProducts.length" class="empty-state">ยังไม่มีสินค้าเข้าร่วม</div>
          </template>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.participation-page {
  min-height: calc(100vh - 5rem);
  padding: clamp(1rem, 3vw, 1.5rem);
  background: linear-gradient(180deg, var(--market-card-bg, #fff) 0%, var(--market-surface-soft, #f7f1e5) 100%);
  color: var(--market-text, #243142);
}

.page-header,
.search-band,
.product-columns {
  max-width: 1220px;
  margin-left: auto;
  margin-right: auto;
}

.page-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.page-heading {
  min-width: 0;
}

.page-heading p {
  margin: 0;
  color: var(--market-primary, #0f9f6e);
  font-size: 0.75rem;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.page-heading h1 {
  margin: 0.2rem 0;
  font-size: clamp(1.5rem, 3vw, 2.1rem);
}

.page-heading span,
.panel-head span,
.product-main small {
  color: var(--market-muted, #64748b);
}

.search-band {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.search-input {
  width: 100%;
}

.product-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.product-panel {
  display: flex;
  flex-direction: column;
  min-height: 30rem;
  border: 1px solid var(--market-card-border, #e2e8f0);
  border-radius: 8px;
  background: var(--market-card-bg, #fff);
  box-shadow: 0 12px 26px var(--market-shadow, rgba(15, 23, 42, 0.08));
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 4.7rem;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--market-card-border, #e2e8f0);
}

.panel-head h2 {
  margin: 0 0 0.15rem;
  font-size: 1.05rem;
}

.panel-head > i {
  color: var(--market-primary, #0f9f6e);
  font-size: 1.35rem;
}

.product-list {
  display: grid;
  align-content: start;
  gap: 0.5rem;
  height: min(62vh, 42rem);
  padding: 0.75rem;
  overflow: auto;
}

.product-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  min-height: 4.5rem;
  border: 1px solid var(--market-card-border, #e2e8f0);
  border-radius: 8px;
  background: color-mix(in srgb, var(--market-card-bg, #fff) 94%, var(--market-primary, #0f9f6e) 6%);
  color: inherit;
  cursor: pointer;
  padding: 0.65rem;
  text-align: left;
}

.product-row:hover:not(:disabled) {
  border-color: var(--market-primary, #0f9f6e);
}

.product-row:disabled {
  cursor: wait;
  opacity: 0.7;
}

.product-row img {
  width: 48px;
  height: 48px;
  border: 1px solid var(--market-card-border, #e2e8f0);
  border-radius: 6px;
  object-fit: cover;
}

.product-main {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
}

.product-main strong,
.product-main span,
.product-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.product-main strong {
  font-size: 0.84rem;
}

.product-main span {
  font-size: 0.92rem;
}

.product-row > i {
  color: var(--market-primary, #0f9f6e);
  font-size: 1.1rem;
}

.joined .product-row {
  background: color-mix(in srgb, #ecfdf5 72%, var(--market-card-bg, #fff) 28%);
}

.not-joined .product-row {
  background: color-mix(in srgb, #f8fafc 76%, var(--market-card-bg, #fff) 24%);
}

.empty-state,
.load-more-state {
  display: grid;
  place-items: center;
  gap: 0.45rem;
  min-height: 5rem;
  color: var(--market-muted, #64748b);
  font-size: 0.86rem;
  text-align: center;
}

.empty-state {
  min-height: 12rem;
}

.load-more-state.done {
  min-height: 3rem;
  font-size: 0.8rem;
}

.skeleton-row {
  cursor: default;
  pointer-events: none;
}

.skeleton-box {
  display: block;
  border-radius: 6px;
  background: linear-gradient(90deg, #eef2f7 0%, #f8fafc 48%, #eef2f7 100%);
  background-size: 220% 100%;
  animation: skeleton-loading 1.1s ease-in-out infinite;
}

.skeleton-image {
  width: 48px;
  height: 48px;
}

.skeleton-code {
  width: 36%;
  height: 0.8rem;
}

.skeleton-name {
  width: 82%;
  height: 0.95rem;
}

.skeleton-sub {
  width: 48%;
  height: 0.72rem;
}

.skeleton-icon {
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
}

@keyframes skeleton-loading {
  0% {
    background-position: 120% 0;
  }
  100% {
    background-position: -120% 0;
  }
}

@media (max-width: 860px) {
  .page-header,
  .search-band,
  .product-columns {
    grid-template-columns: 1fr;
  }

  .page-header :deep(.p-button),
  .search-band :deep(.p-button) {
    width: 100%;
    justify-content: center;
  }

  .product-list {
    height: auto;
    max-height: 34rem;
  }
}
</style>
