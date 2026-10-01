import { auditProductLanguageTree } from '@/utils/languageApiCoverage';
import { createApiClient } from '@/api/http';
const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

function apiBaseUrl() {
    return import.meta.env.VITE_APP_API.endsWith('/') ? import.meta.env.VITE_APP_API.slice(0, -1) : import.meta.env.VITE_APP_API;
}

class OrderHistoryService {
    // ดึงประวัติการสั่งซื้อตาม customer code
    async getOrderHistory(custCode, status = '', page = 1, pageSize = 40, filters = {}) {
        return apiClient.get('service/v1/getOrderHistory', {
            params: {
                view: 'mpr',
                search: filters.search || '',
                date_from: filters.dateFrom || '',
                date_to: filters.dateTo || '',
                cust_code: custCode,
                status: status,
                page: page,
                page_size: pageSize
            }
        });
    }

    // ดึงส่วนหัวของคำสั่งซื้อ (Header)
    async getOrderHeader(custCode, docNo) {
        return apiClient.get('service/v1/getOrderHeader', {
            params: {
                view: 'mpr',
                cust_code: custCode,
                doc_no: docNo
            }
        });
    }

    // ดึงรายการสินค้าในคำสั่งซื้อ (พร้อม pagination และ search)
    async getOrderDetail(custCode, docNo, page = 1, pageSize = 20, search = '') {
        const params = {
            view: 'mpr',
            cust_code: custCode,
            doc_no: docNo,
            page: page,
            page_size: pageSize
        };

        if (search && search.trim()) {
            params.q = search.trim();
        }

        const response = await apiClient.get('service/v1/getOrderDetail', {
            params
        });
        auditProductLanguageTree('service/v1/getOrderDetail.items', response.data?.data?.items || []);
        return response;
    }

    getDeliveryProofImageUrl(docNo, custCode, index = 0) {
        const params = new URLSearchParams({
            doc_no: docNo || '',
            cust_code: custCode || '',
            index: String(index || 0)
        });
        return `${apiBaseUrl()}/service/v1/delivery-proof-image?${params.toString()}`;
    }

    // ดึงรายการสินค้าทั้งหมด (รวม pagination อัตโนมัติ)
    async getAllOrderDetails(custCode, docNo, pageSize = 20) {
        let allItems = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const response = await this.getOrderDetail(custCode, docNo, page, pageSize);
            if (response?.data?.success && response.data.data?.items) {
                allItems = allItems.concat(response.data.data.items);
                const paging = response.data.paging;
                hasMore = page < paging.total_pages;
                page++;
            } else {
                hasMore = false;
            }
        }

        return allItems;
    }

    // ชำระเงินผ่าน QR Promptpay
    async payOrder(paymentData) {
        return apiClient.post('service/v1/pay', paymentData);
    }
}

export default new OrderHistoryService();
