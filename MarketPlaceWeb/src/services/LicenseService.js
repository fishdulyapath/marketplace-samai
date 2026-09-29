import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

export default {
    async getStatus() {
        const response = await apiClient.get('service/v1/license/status');
        return response.data?.data || null;
    },

    async checkNow() {
        const response = await apiClient.post('service/v1/license/check-now');
        return response.data?.data || null;
    }
};
