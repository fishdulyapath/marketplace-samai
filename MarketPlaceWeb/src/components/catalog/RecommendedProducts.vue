<script setup>
import CatalogShelf from './CatalogShelf.vue';
import ProductService from '@/services/ProductService';
import RecommendService from '@/services/RecommendService';
import { useLanguageStore } from '@/stores/languageStore';
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductFullDetailDialog from '@/views/pages/ProductFullDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';
import { onBeforeUnmount, onMounted, ref } from 'vue';

const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;


// ข้อมูลสำหรับ ProductDetailDialog
const selectedProductCode = ref('');
const showProductDetail = ref(false);
const showProductSetDetail = ref(false);
const showProductFullDetail = ref(false);

// ข้อมูลสินค้าแนะนำ
const recommendedProducts = ref([]);
const emit = defineEmits(['ready']);
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
        if (reset) emit('ready');
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
    product.favorite_item = String(product.favorite_item) === '1' ? '0' : '1';

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
    <div v-if="initialLoading || recommendedProducts.length" class="shelf-container">
        <Toast position="top-right" />
        <CatalogShelf :products="recommendedProducts" :initial-loading="initialLoading" :loading-more="loadingRecommended"
            @track="scrollContainer = $event" @scroll="handleScroll" @previous="scrollLeft" @next="scrollRight"
            @pause="handleMouseEnter" @resume="handleMouseLeave" @open="viewProductDetail">
            <template #action="{ product }">
                <Button :icon="String(product.favorite_item) === '1' ? 'pi pi-heart-fill' : 'pi pi-heart'" text rounded
                    :aria-pressed="String(product.favorite_item) === '1'"
                    :aria-label="t(String(product.favorite_item) === '1' ? 'productDetail.removeFavorite' : 'productDetail.addFavorite')"
                    class="favorite-action" @click="toggleFavorite(product, $event)" />
            </template>
        </CatalogShelf>

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
.shelf-container { min-width: 0; }
.favorite-action { position: absolute; top: .25rem; right: .25rem; width: 2rem; height: 2rem; background: var(--market-card-bg, white); }
.favorite-action[aria-pressed="true"] { color: #bd3151; }
@media (max-width: 900px) { .favorite-action { border-radius: 50%; background: #fff; width: 2rem; height: 2rem; } }
</style>
