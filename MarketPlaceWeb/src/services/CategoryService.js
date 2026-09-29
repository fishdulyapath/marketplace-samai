// services/CategoryService.js
import { auditMasterLanguageFields } from '@/utils/languageApiCoverage';
import { createApiClient } from '@/api/http';
import { withMasterDisplay } from '@/utils/languageDisplay';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

function normalizeCategory(category) {
    const code = category.categoryCode || category.code || '';
    const name1 = category.categoryName || category.name_1 || category.name || '';
    const name2 = category.name_2 || '';
    return withMasterDisplay({
        code,
        name: name1,
        name_1: name1,
        name_2: name2,
        imageUrl: category.image_url || category.imageUrl || '',
        image_url: category.image_url || category.imageUrl || '',
        is_virtual: category.is_virtual === true
    });
}

export default {
    /**
     * ดึงรายการหมวดหมู่ทั้งหมด
     * @returns {Promise} รายการหมวดหมู่
     */
    getCategories() {
        return new Promise((resolve, reject) => {
            // เรียกใช้งาน API จริง
            apiClient
                .get('service/v1/getCategoryList')
                .then((response) => {
                    // ตรวจสอบว่าข้อมูลมีโครงสร้างที่ถูกต้อง
                    const categories = response.data;
                    auditMasterLanguageFields('service/v1/getCategoryList', categories.data || []);

                    const enhancedCategories = {
                        data: (categories.data || []).map(normalizeCategory),
                        success: true
                    };
                    resolve(enhancedCategories);
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API:', error);
                    reject(error);
                });
        });
    },

    async getManageCategories() {
        const response = await apiClient.get('service/v1/getCategoryList');
        auditMasterLanguageFields('service/v1/getCategoryList', response.data?.data || []);
        return {
            success: response.data?.success,
            data: (response.data?.data || []).map(normalizeCategory)
        };
    },

    async createCategory(category) {
        const response = await apiClient.post('service/v1/createCategory', {
            code: category.code,
            name_1: category.name_1,
            name_2: category.name_2,
            image_url: category.image_url || category.imageUrl || ''
        });
        return normalizeCategory(response.data?.data || {});
    },

    async updateCategory(category) {
        const response = await apiClient.post('service/v1/updateCategory', {
            code: category.code,
            name_1: category.name_1,
            name_2: category.name_2,
            image_url: category.image_url || category.imageUrl || ''
        });
        return normalizeCategory(response.data?.data || {});
    },

    async deleteCategory(code) {
        const response = await apiClient.post('service/v1/deleteCategory', { code });
        return response.data;
    }
};
