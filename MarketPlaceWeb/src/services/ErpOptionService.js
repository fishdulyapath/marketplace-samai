import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

let erpOptionCache = null;
let erpOptionPromise = null;

function normalizeErpOption(option = {}) {
    const discountType = option.discout_type ?? option.discount_type ?? 0;

    return {
        ...option,
        vat_type: option.vat_type ?? '',
        vat_rate: option.vat_rate ?? '',
        discout_type: discountType,
        discount_type: discountType
    };
}

function getMarketplaceSaleType() {
    return import.meta.env.VITE_MARKETPLACE_SALE_TYPE ?? '0';
}

export default {
    async getErpOption(forceRefresh = false) {
        if (!forceRefresh && erpOptionCache) return erpOptionCache;
        if (!forceRefresh && erpOptionPromise) return erpOptionPromise;

        erpOptionPromise = apiClient
            .get('service/v1/getErpOption')
            .then((response) => {
                erpOptionCache = normalizeErpOption(response.data?.data || {});
                return erpOptionCache;
            })
            .finally(() => {
                erpOptionPromise = null;
            });

        return erpOptionPromise;
    },

    async getPriceOptions() {
        let erpOption = {};

        try {
            erpOption = await this.getErpOption();
        } catch (error) {
            console.warn('Unable to load ERP option, price API will use backend defaults.', error);
        }

        return {
            sale_type: getMarketplaceSaleType(),
            vat_type: erpOption.vat_type ?? '',
            vat_rate: erpOption.vat_rate ?? '',
            discout_type: erpOption.discout_type ?? 0,
            discount_type: erpOption.discount_type ?? erpOption.discout_type ?? 0
        };
    },

    clearCache() {
        erpOptionCache = null;
        erpOptionPromise = null;
    }
};
