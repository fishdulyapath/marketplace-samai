import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

export default {
    async getCompanyProfile() {
        const response = await apiClient.get('service/v1/getCompanyProfile');
        const data = response.data?.data;
        if (Array.isArray(data)) return data[0] || null;
        return data || null;
    }
};
