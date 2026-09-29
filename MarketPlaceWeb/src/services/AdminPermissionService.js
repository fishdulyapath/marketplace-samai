import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

export default {
    async getPermissionPages() {
        const response = await apiClient.get('service/v1/adminPermissionPages');
        return response.data?.data || [];
    },

    async getPermissions(userCode) {
        const response = await apiClient.get('service/v1/getAdminPermissions', {
            params: { user_code: userCode }
        });
        return response.data?.data || null;
    },

    async savePermissions(userCode, permissions) {
        const response = await apiClient.post('service/v1/saveAdminPermissions', {
            user_code: userCode,
            permissions
        });
        return response.data?.data || null;
    }
};
