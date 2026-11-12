<script setup>
import Dialog from 'primevue/dialog';
import { computed } from 'vue';
import ProductDetail from './ProductDetail.vue';

const props = defineProps({
    selection: Object,
    visible: {
        type: Boolean,
        default: false
    },
    itemCode: {
        type: String,
        default: ''
    }
});

const emit = defineEmits(['closed', 'update:visible', 'added-to-cart', 'favorite-changed']);

const dialogVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value)
});

function closeDialog() {
    emit('update:visible', false);
}
</script>

<template>
    <Dialog
        v-model:visible="dialogVisible"
        modal
        :showHeader="false"
        :closable="false"
        :closeOnEscape="true"
        :style="{ width: '100vw', maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh', margin: 0 }"
        class="product-full-detail-dialog"
        @hide="closeDialog"
        @after-hide="emit('closed')"
    >
        <ProductDetail
            v-if="dialogVisible && itemCode"
            :item-code="itemCode"
            :selection="selection"
            embedded
            @close="closeDialog"
            @added-to-cart="emit('added-to-cart', $event)"
            @favorite-changed="emit('favorite-changed', $event)"
        />
    </Dialog>
</template>

<style scoped>
:global(.p-dialog.product-full-detail-dialog) {
    overflow: hidden;
    border-radius: 0;
}

:global(.p-dialog.product-full-detail-dialog > .p-dialog-content) {
    height: 100dvh;
    padding: 0;
    overflow: hidden;
    background: transparent;
}
</style>
