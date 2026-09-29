<script setup>
import ProductCard from '@/components/product/ProductCard.vue';
import ProductService from '@/services/ProductService';
import RecommendService from '@/services/RecommendService';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName } from '@/utils/languageDisplay';
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductFullDetailDialog from '@/views/pages/ProductFullDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import Skeleton from 'primevue/skeleton';
import { useToast } from 'primevue/usetoast';
import { onBeforeUnmount, onMounted, ref } from 'vue';

const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;

function getProductDisplayName(product) {
    return pickProductName(product, languageStore.locale) || product.display_name || product.item_name || '';
}

// ข้อมูลสำหรับ ProductDetailDialog
const selectedProductCode = ref('');
const showProductDetail = ref(false);
const showProductSetDetail = ref(false);
const showProductFullDetail = ref(false);

// ข้อมูลสินค้าแนะนำ
const recommendedProducts = ref([]);
const recommendedPage = ref(0);
const recommendedPerPage = ref(10);
const loadingRecommended = ref(true);
const hasMoreRecommended = ref(true);
const scrollContainer = ref(null);

// สำหรับ Skeleton Loading
const initialLoading = ref(true);

// สำหรับ Auto Scroll
const autoScrollInterval = ref(null);
const autoScrollDelay = 3000; // ตั้งเวลาให้เลื่อนทุก 3 วินาที
const isHovering = ref(false); // ใช้ตรวจสอบว่าเมาส์อยู่เหนือคอนเทนเนอร์หรือไม่

onMounted(() => {
    // โหลดข้อมูลสินค้าแนะนำหน้าแรกทันที
    loadRecommendedProducts(0, true);

    // เริ่ม auto scroll หลังจากโหลดข้อมูลเสร็จสิ้น
    setTimeout(() => {
        startAutoScroll();
    }, 1000);
});

// หยุด interval เมื่อออกจากหน้านี้
onBeforeUnmount(() => {
    stopAutoScroll();
});

// เริ่มการเลื่อนอัตโนมัติ
// แก้ไขเฉพาะฟังก์ชัน startAutoScroll เพื่อให้ใช้ระยะเลื่อนเดียวกันกับปุ่มซ้าย-ขวา
function startAutoScroll() {
    if (!scrollContainer.value || isHovering.value || !hasMoreRecommended.value) {
        return;
    }

    // ล้าง interval เดิมก่อน (ถ้ามี)
    stopAutoScroll();

    autoScrollInterval.value = setInterval(() => {
        if (!scrollContainer.value || isHovering.value || !hasMoreRecommended.value) {
            stopAutoScroll();
            return;
        }

        const container = scrollContainer.value;
        const maxScrollLeft = container.scrollWidth - container.clientWidth;

        // ถ้าเลื่อนไปจนสุดแล้ว ให้เริ่มต้นใหม่
        if (container.scrollLeft >= maxScrollLeft - 20) {
            container.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            // ใช้ระยะเลื่อนเดียวกันกับฟังก์ชัน scrollRight (เท่ากับความกว้างของ container)
            container.scrollBy({
                left: container.clientWidth,
                behavior: 'smooth'
            });
        }

        // ตรวจสอบว่าเลื่อนไปใกล้สุดทางขวาหรือไม่ เพื่อโหลดข้อมูลเพิ่ม
        setTimeout(() => {
            if (container.scrollWidth - container.scrollLeft - container.clientWidth < 300 && hasMoreRecommended.value && !loadingRecommended.value) {
                loadMoreRecommended();
            }
        }, 300);
    }, autoScrollDelay);
}

// หยุดการเลื่อนอัตโนมัติ
function stopAutoScroll() {
    if (autoScrollInterval.value) {
        clearInterval(autoScrollInterval.value);
        autoScrollInterval.value = null;
    }
}

// จัดการเมื่อเมาส์อยู่เหนือคอนเทนเนอร์
function handleMouseEnter() {
    isHovering.value = true;
    stopAutoScroll();
}

// จัดการเมื่อเมาส์ออกจากคอนเทนเนอร์
function handleMouseLeave() {
    isHovering.value = false;
    startAutoScroll();
}

// โหลดข้อมูลสินค้าแนะนำ
async function loadRecommendedProducts(page = 0, reset = false) {
    loadingRecommended.value = true;
    try {
        const result = await RecommendService.getRecommendedProducts(recommendedPerPage.value, page, recommendedPerPage.value);

        if (reset) {
            recommendedProducts.value = result.data;
        } else {
            recommendedProducts.value = [...recommendedProducts.value, ...result.data];
        }

        recommendedPage.value = page;

        // ตรวจสอบว่ามีสินค้าเพิ่มเติมหรือไม่
        const hasDataReturned = result.data && result.data.length > 0;

        // ถ้าไม่มีข้อมูลกลับมา หรือไม่มีหน้าถัดไป ให้หยุด
        hasMoreRecommended.value = hasDataReturned && result.data.length >= recommendedPerPage.value;


        // ถ้าไม่มีข้อมูลเพิ่มเติม ให้หยุด auto scroll
        if (!hasMoreRecommended.value) {
            stopAutoScroll();
        }

        // หลังจากโหลดข้อมูลสำเร็จ ยกเลิกสถานะการโหลดเริ่มต้น
        initialLoading.value = false;
    } catch (error) {
        console.error('Error loading recommended products:', error);
        // เมื่อเกิดข้อผิดพลาด ให้หยุด auto scroll ด้วย
        hasMoreRecommended.value = false;
        stopAutoScroll();

        // แสดง Toast แจ้งเตือนเมื่อเกิดข้อผิดพลาด
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('errors.loadRecommendedProducts'),
            life: 3000
        });
        initialLoading.value = false;
    } finally {
        loadingRecommended.value = false;
    }
}

// โหลดสินค้าแนะนำหน้าถัดไป
function loadMoreRecommended() {
    if (loadingRecommended.value || !hasMoreRecommended.value) {
        return;
    }

    const nextPage = recommendedPage.value + 1;
    loadRecommendedProducts(nextPage);
}

// เลื่อนไปทางซ้าย
function scrollLeft() {
    if (scrollContainer.value) {
        scrollContainer.value.scrollBy({
            left: -scrollContainer.value.clientWidth,
            behavior: 'smooth'
        });
    }
}

// ติดตามการเลื่อนของคอนเทนเนอร์
function handleScroll(event) {
    const container = event.target;
    // ถ้าเลื่อนไปใกล้สุดทางขวา และยังมีข้อมูลให้โหลด
    if (container.scrollWidth - container.scrollLeft - container.clientWidth < 300 && hasMoreRecommended.value && !loadingRecommended.value) {
        loadMoreRecommended();
    }
}

// เลื่อนไปทางขวา
function scrollRight() {
    if (scrollContainer.value) {
        const container = scrollContainer.value;
        container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });

        // ตรวจสอบว่าเลื่อนไปใกล้สุดทางขวาหรือยัง
        setTimeout(() => {
            if (container.scrollWidth - container.scrollLeft - container.clientWidth < 300 && hasMoreRecommended.value && !loadingRecommended.value) {
                loadMoreRecommended();
            }
        }, 300);
    }
}

function getInventoryStatus(soldOut) {
    return soldOut === '1' ? 'OUTOFSTOCK' : 'INSTOCK';
}

// ดูรายละเอียดสินค้า (เปลี่ยนเป็นเปิด Dialog แทน)
function viewProductDetail(product) {
    selectedProductCode.value = product.item_code;
    showProductFullDetail.value = false;
    if (String(product?.item_type || '') === '3') {
        showProductDetail.value = false;
        showProductSetDetail.value = true;
        return;
    }

    showProductSetDetail.value = false;
    showProductDetail.value = true;
}

function openFullProductDetail(itemCode) {
    selectedProductCode.value = itemCode;
    showProductDetail.value = false;
    showProductSetDetail.value = false;
    showProductFullDetail.value = true;
}

// ฟังก์ชันสำหรับรับการเพิ่มสินค้าลงตะกร้าจาก Dialog
function handleAddedToCart(cartItem) {
    //   toast.add({
    //     severity: "success",
    //     summary: "เพิ่มสินค้าแล้ว",
    //     detail: `เพิ่ม ${cartItem.name} ลงในตะกร้าแล้ว จำนวน ${cartItem.qty} ${cartItem.unit}`,
    //     life: 1000,
    //   });
}

// ฟังก์ชันเปลี่ยนสถานะรายการโปรด
function toggleFavorite(product, event) {
    if (event) {
        event.stopPropagation();
    }

    // เก็บค่า favorite_item เดิมไว้
    const oldFavoriteStatus = product.favorite_item;

    // สลับค่า favorite_item ระหว่าง "0" และ "1"
    product.favorite_item = product.favorite_item === '1' ? '0' : '1';

    // เรียกใช้งาน API เพื่ออัปเดตสถานะรายการโปรด
    ProductService.updateFavoriteStatus(product.item_code, product.favorite_item).catch((error) => {
        console.error('Error updating favorite status:', error);
        // กรณีมีข้อผิดพลาด ให้คืนค่าสถานะเดิม
        product.favorite_item = oldFavoriteStatus;
        toast.add({
            severity: 'error',
            summary: t('common.error'),
            detail: t('errors.updateFavorite'),
            life: 3000
        });
    });
}

// ฟังก์ชันสำหรับรับการเปลี่ยนแปลงสถานะรายการโปรดจาก Dialog
function handleFavoriteChanged(data) {
    // หาสินค้าในรายการและอัพเดทสถานะ
    const productToUpdate = recommendedProducts.value.find((p) => p.item_code === data.itemCode);
    if (productToUpdate) {
        productToUpdate.favorite_item = data.isFavorite ? '1' : '0';
    }
}
</script>

<template>
    <!-- RULE: hide-empty-section — render เฉพาะตอนโหลดครั้งแรก หรือมีข้อมูลจริง
         ใช้ initialLoading ไม่ใช่ loadingRecommended เพราะตัวหลังเป็น true ทุกครั้งที่โหลดหน้าถัดไป
         Toast ถูกลบออก (AppLayout มีตัวกลางอยู่แล้ว) เพื่อให้ root มี element เดียวที่ v-if คุมได้ -->
    <div v-if="initialLoading || recommendedProducts.length" class="recommend-root">
        <!-- ส่วนสินค้าแนะนำด้านบน -->
        <section class="mb-1 relative recommend-shell">
            <div class="flex justify-between items-center px-4 py-3 recommend-head">
                <div>
                    <h2 class="recommend-title m-0 flex items-center gap-2">
                        <i class="pi pi-sparkles"></i>
                        <span>{{ t('landing.recommendedTitle') }}</span>
                    </h2>
                    <p class="recommend-subtitle m-0">{{ t('landing.recommendSubtitle') }}</p>
                </div>

                <!-- ปุ่มเลื่อนซ้าย-ขวา -->
                <div class="flex gap-2">
                    <Button icon="pi pi-chevron-left" rounded outlined size="small" class="recommend-nav-btn" :aria-label="t('landing.scrollLeft')" @click="scrollLeft" />
                    <Button icon="pi pi-chevron-right" rounded outlined size="small" class="recommend-nav-btn" :aria-label="t('landing.scrollRight')" @click="scrollRight" />
                </div>
            </div>

            <div class="relative">
                <!-- คอนเทนเนอร์สำหรับการเลื่อน -->
                <div ref="scrollContainer" class="overflow-x-auto py-3 hide-scrollbar" @scroll="handleScroll" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">
                    <div class="flex gap-3 px-4" style="width: max-content; min-width: 100%">
                        <!-- Skeleton Loading -->
                        <template v-if="initialLoading">
                            <div v-for="i in 5" :key="i" class="shop-card shop-card--rail recommend-card">
                                <Skeleton height="136px" />
                                <div class="p-2">
                                    <Skeleton width="80%" height="12px" class="mb-1" />
                                    <Skeleton width="100%" height="14px" class="mb-2" />
                                    <div class="flex justify-between items-center mt-2">
                                        <Skeleton width="50%" height="16px" />
                                        <Skeleton shape="circle" size="24px" />
                                    </div>
                                </div>
                            </div>
                        </template>

                        <!-- Actual Products -->
                        <template v-else>
                            <ProductCard
                                v-for="product in recommendedProducts"
                                :key="product.item_code"
                                variant="rail"
                                class="recommend-card hoverable"
                                :name="getProductDisplayName(product)"
                                :image="product.image"
                                :fallback-image="product.imageFallback"
                                :aria-label="`${t('productDetail.viewMoreDetails')} ${getProductDisplayName(product)}`"
                                @select="viewProductDetail(product)"
                            >
                                <!-- ปุ่มหัวใจต้องอยู่ใน slot media เพราะเป็น interactive ที่ต้อง @click.stop เอง
                                     การ์ดกลางไม่รู้จักตรรกะ favorite (ดูกฎในหัวไฟล์ ProductCard.vue) -->
                                <template #media>
                                    <div class="absolute right-1 top-1 cursor-pointer">
                                        <Button
                                            :icon="product.favorite_item === '1' ? 'pi pi-heart-fill' : 'pi pi-heart'"
                                            text
                                            rounded
                                            :aria-label="product.favorite_item === '1' ? t('productDetail.removeFavorite') : t('productDetail.addFavorite')"
                                            :aria-pressed="product.favorite_item === '1'"
                                            @click.stop="toggleFavorite(product, $event)"
                                            :class="product.favorite_item === '1' ? 'p-button-rounded p-button-text p-button-danger' : 'p-button-rounded p-button-text'"
                                            style="width: 1.5rem; height: 1.5rem; font-size: 0.7rem"
                                        />
                                    </div>
                                </template>

                                <template #eyebrow>
                                    <div class="recommend-category">
                                        {{ product.category_display || product.category }}
                                    </div>
                                </template>
                            </ProductCard>

                            <!-- ตัวแสดงสถานะการโหลด -->
                            <div v-if="loadingRecommended && recommendedProducts.length > 0" class="flex items-center justify-center min-w-[60px]">
                                <ProgressSpinner style="width: 30px" />
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        </section>

        <!-- ProductDetailDialog -->
        <ProductDetailDialog
            :visible="showProductDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductDetail = $event"
            @added-to-cart="handleAddedToCart"
            @favorite-changed="handleFavoriteChanged"
            @show-full-detail="openFullProductDetail"
        />

        <ProductSetDialog
            :visible="showProductSetDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductSetDetail = $event"
            @added-to-cart="handleAddedToCart"
            @favorite-changed="handleFavoriteChanged"
            @show-full-detail="openFullProductDetail"
        />

        <ProductFullDetailDialog
            :visible="showProductFullDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductFullDetail = $event"
            @added-to-cart="handleAddedToCart"
            @favorite-changed="handleFavoriteChanged"
        />
    </div>
</template>

<style scoped>
.recommend-shell {
    border-radius: 10px;
    border: 1px solid var(--market-card-border, #e8dcc4);
    background: var(--market-card-bg, #fff);
    box-shadow: var(--shop-shadow-1);
    animation: recommendFadeIn 280ms ease;
    overflow: hidden;
}

.recommend-head {
    padding: 0.8rem 0.9rem;
    border-bottom: 1px solid var(--market-card-border, #efe3c8);
    background: linear-gradient(180deg, color-mix(in srgb, var(--market-card-bg, #fff) 96%, var(--market-primary, #0f9f6e)) 0%, var(--market-card-bg, #fff) 100%);
}

.recommend-title {
    font-size: 1rem;
    font-weight: 800;
    color: var(--market-text, #2f2412);
}

.recommend-title i {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--market-primary, #0f9f6e);
    background: var(--market-primary-soft, #ecfdf5);
    font-size: 0.86rem;
}

.recommend-subtitle {
    margin-top: 0.15rem;
    font-size: 0.74rem;
    color: var(--market-muted, #8a6f37);
}

.recommend-card {
    border: 1px solid var(--market-card-border, #efe1c4);
    border-radius: 7px;
    overflow: hidden;
    background: var(--market-card-bg, #fff);
    box-shadow: var(--shop-shadow-1);
}

.recommend-card.hoverable {
    transition:
        transform 0.2s ease,
        box-shadow 0.2s ease;
}

.recommend-card.hoverable:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--market-primary, #0f9f6e) 30%, var(--market-card-border, #efe3c8));
    box-shadow: var(--shop-shadow-3);
}

/* กรอบรูป (aspect-ratio กัน CLS) และชื่อสินค้า มาจาก ProductCard + shop-card.scss แล้ว */

/* ชื่อสินค้าบนแถวแนะนำหนากว่าการ์ดในกริดเล็กน้อย ให้อ่านง่ายในกล่องแคบ */
.recommend-card :deep(.shop-card-name) {
    font-size: 0.82rem;
    font-weight: 700;
    line-height: 1.38;
}

.recommend-category {
    font-size: 0.7rem;
    color: var(--market-muted, #8a6f37);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 0.2rem;
}

:deep(.recommend-nav-btn.p-button) {
    width: 1.9rem;
    height: 1.9rem;
}

@keyframes recommendFadeIn {
    from {
        opacity: 0;
        transform: translateY(5px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@media (max-width: 1024px) {
    .recommend-head {
        padding: 0.85rem;
    }
}

@media (max-width: 640px) {
    .recommend-shell {
        border-radius: 0.75rem;
    }

    .recommend-head {
        padding: 0.75rem;
    }

    .recommend-title {
        font-size: 0.95rem;
    }

    .recommend-subtitle {
        font-size: 0.75rem;
    }

    :deep(.recommend-nav-btn.p-button) {
        width: 1.7rem;
        height: 1.7rem;
    }
}

@media (prefers-reduced-motion: reduce) {
    .recommend-shell,
    .recommend-card,
    .recommend-card.hoverable {
        animation: none !important;
        transition: none !important;
        transform: none !important;
    }
}

/* ซ่อน scrollbar แต่ยังใช้ scroll ได้ */
.hide-scrollbar {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
    scroll-behavior: smooth; /* ให้การเลื่อนสมูทขึ้น */
}

.hide-scrollbar::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
}

/* อนิเมชันสำหรับโหลดเพิ่มเติม */
@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

.fade-in {
    animation: fadeIn 0.3s ease-in-out;
}

/* สไตล์สำหรับปุ่มรายการโปรดขนาดเล็ก */
:deep(.p-button.p-button-text.p-button-rounded) {
    width: 1.5rem !important;
    height: 1.5rem !important;
    padding: 0 !important;
    background-color: rgba(255, 255, 255, 0.8);
}

:deep(.p-button.p-button-text.p-button-rounded.p-button-danger) {
    background-color: rgba(220, 53, 69, 0.9);
}

:deep(.p-button.p-button-text.p-button-rounded .p-button-icon) {
    font-size: 0.7rem;
}

:deep(.p-button.p-button-text.p-button-rounded.p-button-danger .p-button-icon) {
    color: white;
}
</style>
