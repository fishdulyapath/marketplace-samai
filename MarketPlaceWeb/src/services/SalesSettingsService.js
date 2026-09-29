import { createApiClient } from '@/api/http';

const api = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

const servicePath = (path) => `service/v1${path}`;

export default {
    async getSettings(options = {}) {
        const params = {};
        if (options.includeFeatured === false) params.include_featured = 0;
        const { data } = await api.get(servicePath('/sales-settings'), { params });
        return data?.data || {};
    },

    async saveSettings(body) {
        const { data } = await api.post(servicePath('/sales-settings'), body);
        return data;
    },

    async searchProducts(search = '', limit = 50) {
        const { data } = await api.get(servicePath('/sales-settings/product-search'), {
            params: { search, limit }
        });
        return data?.data || [];
    },

    async getFeaturedProducts(featureType = '') {
        const { data } = await api.get(servicePath('/sales-settings/featured-products'), {
            params: { feature_type: featureType }
        });
        return data?.data || [];
    },

    async getProductPreorderSettings(search = '', limit = 50) {
        const { data } = await api.get(servicePath('/sales-settings/product-preorder-settings'), {
            params: { search, limit }
        });
        return data?.data || [];
    },

    async saveProductPreorderSetting(body) {
        const { data } = await api.post(servicePath('/sales-settings/product-preorder-settings'), body);
        return data;
    },

    async saveFeaturedProduct(body) {
        const { data } = await api.post(servicePath('/sales-settings/featured-products'), body);
        return data;
    },

    async deleteFeaturedProduct(body) {
        const { data } = await api.post(servicePath('/sales-settings/featured-products/delete'), body);
        return data;
    }
};
