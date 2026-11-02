import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

export default {
    async getHomeContent() {
        const response = await apiClient.get('service/v1/content/home');
        return response.data?.data || null;
    },

    async getPickerProducts(search = '', offset = 0, limit = 50) {
        const response = await apiClient.get('service/v1/admin/content/products', { params: { search, offset, limit } });
        return response.data;
    },

    async saveHomeContent(content) {
        const response = await apiClient.post('service/v1/content/home', content);
        return response.data?.data || null;
    }
};
