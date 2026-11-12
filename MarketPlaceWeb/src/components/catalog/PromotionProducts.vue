<script setup>
import PromotionPreview from './PromotionPreview.vue';
import ProductService from '@/services/ProductService';
import { useAuthenStore } from '@/stores/authen';
import { useLanguageStore } from '@/stores/languageStore';
import ProductDetailDialog from '@/views/pages/ProductDetailDialog.vue';
import ProductFullDetailDialog from '@/views/pages/ProductFullDetailDialog.vue';
import ProductSetDialog from '@/views/pages/ProductSetDialog.vue';
import { useToast } from 'primevue/usetoast';
import { ref, watch } from 'vue';

const toast = useToast();
const props = defineProps({ previewLimit: { type: Number, default: 5 } });
const emit = defineEmits(['ready']);
const promotionTotal = ref();
const auth = useAuthenStore();
const languageStore = useLanguageStore();
const t = languageStore.t;


const selectedProductCode = ref('');
const showProductDetail = ref(false);
const showProductSetDetail = ref(false);
const showProductFullDetail = ref(false);

const promotionProducts = ref([]);
const initialLoading = ref(true);

watch(() => auth.userCode, async (_, previous, onCleanup) => {
    let current = true;
    onCleanup(() => { current = false; });
    initialLoading.value = true;
    promotionProducts.value = [];
    promotionTotal.value = undefined;
    try {
        const limit = props.previewLimit + 1;
        const result = await ProductService.getProducts({ isPromotion: 1, promotionPreview: true, limit }, 0);
        if (!current) return;
        promotionProducts.value = result.data;
        promotionTotal.value = result.promotionTotal ?? (result.data.length < limit ? result.data.length : undefined);
    } catch (error) {
        if (!current) return;
        console.error('Error loading promotion products:', error);
        toast.add({ severity: 'error', summary: t('common.error'), detail: t('errors.loadPromotionProducts'), life: 3000 });
    } finally {
        if (current) {
            initialLoading.value = false;
            emit('ready');
        }
    }
}, { immediate: true });

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

const fullSelection = ref(null);
function openFullProductDetail(itemCode, selection = null) {
    fullSelection.value = selection;
    selectedProductCode.value = itemCode;
    showProductDetail.value = false;
    showProductSetDetail.value = false;
    showProductFullDetail.value = true;
}
function handleAddedToCart(cartItem) {
    // toast.add({ severity: 'success', summary: 'เพิ่มสินค้าแล้ว', detail: `เพิ่ม ${cartItem.name} ลงตะกร้า จำนวน ${cartItem.qty} ${cartItem.unit}`, life: 1000 });
}
</script>

<template>
    <div v-if="initialLoading || promotionProducts.length" class="shelf-container">
        <Toast position="top-right" />
        <PromotionPreview :products="promotionProducts" :total="promotionTotal" :limit="previewLimit" :loading="initialLoading" @open="viewProductDetail" />

        <ProductDetailDialog
            :visible="showProductDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductDetail = $event"
            @added-to-cart="handleAddedToCart"
            @show-full-detail="openFullProductDetail"
        />

        <ProductSetDialog
            :visible="showProductSetDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductSetDetail = $event"
            @added-to-cart="handleAddedToCart"
            @show-full-detail="openFullProductDetail"
        />

        <ProductFullDetailDialog :selection="fullSelection"
            :visible="showProductFullDetail"
            :item-code="selectedProductCode"
            @update:visible="showProductFullDetail = $event"
            @added-to-cart="handleAddedToCart"
        />
    </div>
</template>

<style scoped>
.shelf-container { min-width: 0; }
</style>
