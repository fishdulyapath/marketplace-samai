// services/RecommendService.js
import { auditProductLanguageFields } from '@/utils/languageApiCoverage';
import { createApiClient } from '@/api/http';
import { PRODUCT_IMAGE_PLACEHOLDER } from '@/utils/productPlaceholder';
import { withProductDisplay } from '@/utils/languageDisplay';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

export default {
    /**
     * ดึงสินค้าแนะนำจาก API
     * @param {number} perPage - จำนวนรายการต่อหน้า
     * @param {number} page - หน้าที่ต้องการ (เริ่มจาก 0)
     * @param {number} limit - จำนวนสินค้าที่ต้องการ
     * @returns {Promise} รายการสินค้าแนะนำ
     */
    getRecommendedProducts(perPage = 5, page = 0, limit = 10) {
        const offset = page * perPage;

        const custCode = localStorage.getItem('_userCode') || '';
        const instockValue = localStorage.getItem('_isstock');
        // แปลงค่า _isstock: null หรือ '0' = 0 (แสดงทั้งหมด), '1' = 1 (แสดงเฉพาะที่มีคงเหลือ)
        const instock = instockValue === '1' ? 1 : 0;

        return new Promise((resolve, reject) => {
            // เรียกใช้งาน API จริง
            apiClient
                .get(`service/v1/getProductList`, {
                    params: {
                        cust_code: custCode || '',
                        search: '',
                        category: '',
                        offset: offset,
                        premium: 1,
                        feature_type: 'recommend',
                        limit: limit,
                        favorite: 0,
                        isstock: instock
                    }
                })
                .then((response) => {
                    // ตรวจสอบว่าข้อมูลมีรูปแบบที่ถูกต้อง
                    if (response.data && response.data.data && Array.isArray(response.data.data)) {
                        auditProductLanguageFields('service/v1/getProductList?premium=1', response.data.data);

                        // เพิ่ม URL รูปภาพสำหรับแต่ละสินค้า (ถ้า API ไม่ส่งมา)
                        const enhancedData = response.data.data.map((product) => {
                            return withProductDisplay({
                                ...product,
                                // ใช้ API สำหรับดึงรูปภาพสินค้า
                                image: this.getProductImageUrl(product.item_code, product),
                                // สำรองรูปภาพ (ไม่ได้ใช้โดยตรง แต่เก็บไว้เผื่อต้องใช้เป็น fallback)
                                imageFallback: this.getPlaceholderImage(product.item_code),
                                // ถ้า API ไม่ส่งราคามา ให้กำหนดเป็น 0
                                price: product.price || 0,
                                // ถ้า API ไม่ส่งหมวดหมู่มา ให้กำหนดเป็นค่าว่าง
                                category: product.category || ''
                            });
                        });

                        const result = {
                            pagination: response.data.pagination,
                            data: enhancedData,
                            success: response.data.success
                        };

                        resolve(result);
                    } else {
                        console.error('รูปแบบข้อมูล API ไม่ถูกต้อง:', response.data);
                        reject(new Error('รูปแบบข้อมูลไม่ถูกต้อง'));
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API:', error);
                    reject(error);
                });
        });
    },

    /**
     * ตรวจสอบว่ามีหน้าถัดไปหรือไม่
     * @param {number} currentPage - หน้าปัจจุบัน
     * @param {object} pagination - ข้อมูลการแบ่งหน้า
     * @returns {boolean} มีหน้าถัดไปหรือไม่
     */
    hasNextPage(currentPage, pagination) {
        if (pagination && pagination.totalPage) {
            return currentPage < pagination.totalPage - 1;
        }

        // หากไม่มีข้อมูล pagination จะสมมติว่ามีหน้าถัดไป
        // จนกว่าจะได้รับข้อมูลว่าไม่มีสินค้าเพิ่มเติม
        return true;
    },

    /**
     * สร้าง URL รูปภาพสำหรับสินค้าที่ไม่มีรูปภาพ
     * @param {string} itemCode - รหัสสินค้า
     * @returns {string} URL รูปภาพตัวอย่าง
     */
    /**
     * สร้าง URL รูปภาพสินค้าจาก API
     * @param {string} itemCode - รหัสสินค้า
     * @returns {string} URL รูปภาพสินค้า
     */
    getProductImageUrl(itemCode) {
        // ใช้ endpoint ที่คุณให้มาเพื่อดึงรูปภาพสินค้า
        const baseUrl = import.meta.env.VITE_APP_API.endsWith('/') ? import.meta.env.VITE_APP_API.slice(0, -1) : import.meta.env.VITE_APP_API;

        return `${baseUrl}/service/v1/images?item_code=${encodeURIComponent(itemCode || '')}`;
    },

    /**
     * สร้าง URL รูปภาพตัวอย่างสำหรับสินค้าที่ไม่มีรูปภาพ (fallback)
     * @returns {string} URL รูปภาพตัวอย่าง
     */
    getPlaceholderImage() {
        // ใช้รูปภาพ No Image Available ตามที่กำหนด
        return PRODUCT_IMAGE_PLACEHOLDER;
    },

    /**
     * สร้าง hash code จาก string
     * @param {string} str - string ที่ต้องการแปลง
     * @returns {number} hash code
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }
};
