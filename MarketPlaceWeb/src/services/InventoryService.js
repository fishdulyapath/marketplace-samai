import { auditMasterLanguageFields, auditProductLanguageFields } from '@/utils/languageApiCoverage';
import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    },
    timeout: 300000
});

class InventoryService {
    async getWarehouseList() {
        const { data } = await apiClient.get('service/v1/getWarehouseList');
        auditMasterLanguageFields('service/v1/getWarehouseList', data.data || []);
        return data.data || [];
    }

    async getShelfList(whCode) {
        const { data } = await apiClient.get('service/v1/getShelfList', {
            params: { wh_code: whCode }
        });
        auditMasterLanguageFields('service/v1/getShelfList', data.data || []);
        return data.data || [];
    }

    async getInventoryBalance(itemCode, whCode, shelfCode) {
        const { data } = await apiClient.get('service/v1/getInventoryBalance', {
            params: {
                item_code: itemCode,
                wh_code: whCode,
                shelf_code: shelfCode
            }
        });
        return Number(data.data?.sum_balance_qty ?? 0);
    }

    async getProductByBarcode(barcode) {
        const { data } = await apiClient.get('service/v1/getProductByBarcode', {
            params: { barcode }
        });
        auditProductLanguageFields('service/v1/getProductByBarcode', data.data);
        return data.success ? data.data : null;
    }

    async adjustStock(payload) {
        const { data } = await apiClient.post('service/v1/adjustStock', payload);
        return data;
    }
}

export default new InventoryService();
