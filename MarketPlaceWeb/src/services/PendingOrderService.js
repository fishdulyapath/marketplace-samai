import { createApiClient } from '@/api/http';

const api = createApiClient({ baseURL: import.meta.env.VITE_APP_API });
const path = (docNo) => `service/v1/pending-orders/${encodeURIComponent(docNo)}`;
const adminPath = (docNo) => `service/v1/admin/pending-orders/${encodeURIComponent(docNo)}`;

export default {
    async list(admin, params) {
        const { data } = await api.get(`service/v1/${admin ? 'admin/' : ''}pending-orders`, { params });
        return data;
    },
    async detail(docNo) {
        const { data } = await api.get(path(docNo));
        return data.data;
    },
    async quote(docNo, allocations) {
        const { data } = await api.post(`${adminPath(docNo)}/quote`, { allocations });
        return data.data;
    },
    async confirm(docNo, allocations, pricingFingerprint) {
        const { data } = await api.post(`${adminPath(docNo)}/confirm`, { allocations, pricing_fingerprint: pricingFingerprint });
        return data;
    },
    async options(docNo, lineNumber) {
        const { data } = await api.get(`${adminPath(docNo)}/items/${encodeURIComponent(lineNumber)}/options`);
        return data.data;
    },
    async reject(docNo, reason) {
        const { data } = await api.post(`${adminPath(docNo)}/reject`, { reason });
        return data;
    },
    async cancel(docNo) {
        const { data } = await api.post(`${path(docNo)}/cancel`);
        return data;
    }
};
