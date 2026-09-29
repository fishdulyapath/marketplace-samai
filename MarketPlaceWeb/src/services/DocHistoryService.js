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

class DocHistoryService {
    // ดึงรายการเอกสาร
    async getDocList(custCode, transFlag = '') {
        return apiClient.get('service/v1/getDocList', {
            params: {
                cust_code: custCode,
                trans_flag: transFlag
            }
        });
    }

    // ดึงรายละเอียดเอกสาร
    async getDocDetail(custCode, docNo) {
        const response = await apiClient.get('service/v1/getDocDetail', {
            params: {
                cust_code: custCode,
                doc_no: docNo
            }
        });
        auditProductLanguageTree('service/v1/getDocDetail.items', response.data?.data?.items || []);
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

    // ดึงยอดเงินคงค้าง
    async getTotalBalance(custCode) {
        return apiClient.get('service/v1/getTotalBalance', {
            params: {
                cust_code: custCode
            }
        });
    }

    // ดึงรายการเงินล่วงหน้า
    async getAdvancePayments(custCode) {
        return apiClient.get('service/v1/getAdvancePayment', {
            params: {
                cust_code: custCode
            }
        });
    }
}

export default new DocHistoryService();
