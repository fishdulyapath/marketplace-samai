import ErpOptionService from '@/services/ErpOptionService';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const useErpOptionStore = defineStore('erpOption', () => {
    const option = ref(null);
    const loading = ref(false);
    const error = ref(null);

    const saleType = computed(() => import.meta.env.VITE_MARKETPLACE_SALE_TYPE ?? '0');
    const priceOptions = computed(() => ({
        sale_type: saleType.value,
        vat_type: option.value?.vat_type ?? '',
        vat_rate: option.value?.vat_rate ?? '',
        discout_type: option.value?.discout_type ?? option.value?.discount_type ?? 0,
        discount_type: option.value?.discount_type ?? option.value?.discout_type ?? 0
    }));

    async function load(forceRefresh = false) {
        loading.value = true;
        error.value = null;

        try {
            option.value = await ErpOptionService.getErpOption(forceRefresh);
            return option.value;
        } catch (err) {
            error.value = err;
            throw err;
        } finally {
            loading.value = false;
        }
    }

    return {
        option,
        loading,
        error,
        saleType,
        priceOptions,
        load
    };
});
