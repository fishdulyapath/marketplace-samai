import { createApiClient } from '@/api/http';

// ระบบของแถมขาย (Sale Premium) — เฟส 4.1 ของ docs/sale-premium-plan.md
// ตั้งชื่อ salePremium เต็มเสมอ ห้ามย่อเป็น premium (ชนกับ param สินค้าแนะนำใน RecommendService)

const api = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

const servicePath = (path) => `service/v1${path}`;

function apiBaseUrl() {
    return String(import.meta.env.VITE_APP_API || '').replace(/\/$/, '');
}

function getImageUrl(promo = {}) {
    const guid = String(promo.image_guid || '').trim();
    if (guid) return `${apiBaseUrl()}/service/v1/imagesguid?guid_code=${encodeURIComponent(guid)}`;

    const fallbackCode = promo.free_items?.[0]?.item_code || promo.free_items?.[0]?.ic_code || '';
    return fallbackCode ? `${apiBaseUrl()}/service/v1/images?item_code=${encodeURIComponent(fallbackCode)}` : '';
}

function withImage(promo) {
    return { ...promo, image: getImageUrl(promo) };
}

export default {
    getImageUrl,

    // ----- หน้าแอดมิน -----
    async getList(search = '', includeInactive = false) {
        const { data } = await api.get(servicePath('/sale-premium/list'), {
            params: { search, include_inactive: includeInactive ? 1 : 0 }
        });
        return data?.data || [];
    },

    async getDetail(premiumCode) {
        const { data } = await api.get(servicePath('/sale-premium/detail'), {
            params: { premium_code: premiumCode }
        });
        return data?.data || null;
    },

    async save(payload) {
        const { data } = await api.post(servicePath('/sale-premium/save'), payload);
        return data;
    },

    async remove(premiumCode, empCode = '') {
        const { data } = await api.post(servicePath('/sale-premium/delete'), {
            premium_code: premiumCode,
            emp_code: empCode
        });
        return data;
    },

    // ----- หน้าร้าน -----
    async getListForSale(params = {}) {
        const { data } = await api.get(servicePath('/sale-premium/list-for-sale'), { params });
        return (data?.data || []).map(withImage);
    },

    async getDetailForSale(premiumCode, params = {}) {
        const { data } = await api.get(servicePath('/sale-premium/detail-for-sale'), {
            params: { premium_code: premiumCode, ...params }
        });
        return data?.data ? withImage(data.data) : null;
    }
};
