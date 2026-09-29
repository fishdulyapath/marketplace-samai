import { createApiClient } from '@/api/http';

const api = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

const servicePath = (path) => `service/v1${path}`;

export default {
    async getEmployees({ search = '', status = 'all', limit = 200 } = {}) {
        const { data } = await api.get(servicePath('/admin/employees'), {
            params: { search, status, limit }
        });
        return {
            rows: Array.isArray(data?.data) ? data.data : [],
            summary: data?.summary || { total: 0, visible: 0, hidden: 0 },
            truncated: Boolean(data?.truncated)
        };
    },

    async setVisibility(code, mobileUser) {
        const { data } = await api.post(servicePath('/admin/employees/visibility'), {
            code,
            mobile_user: Number(mobileUser) === 1 ? 1 : 0
        });
        return data?.data || null;
    }
};
