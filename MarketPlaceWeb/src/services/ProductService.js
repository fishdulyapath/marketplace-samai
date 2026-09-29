// services/ProductService.js
import ErpOptionService from '@/services/ErpOptionService';
import { createApiClient } from '@/api/http';
import { PRODUCT_IMAGE_PLACEHOLDER } from '@/utils/productPlaceholder';
import { auditProductLanguageFields } from '@/utils/languageApiCoverage';
import { withProductDisplay } from '@/utils/languageDisplay';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

const DEFAULT_WH_CODE = import.meta.env.VITE_WH_CODE || '';

function cleanParams(params) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function shouldBypassProductImageCache() {
    return true;
}

export default {
    /**
     * ดึงรายการสินค้าทั้งหมด
     * @param {Object} filters - ตัวกรองต่างๆ (หมวดหมู่, การค้นหา)
     * @param {Number} page - หน้าที่ต้องการดึงข้อมูล
     * @returns {Promise} รายการสินค้าที่กรองแล้ว
     */
    getProducts(filters = {}, page = 0) {
        const limit = Math.max(1, Math.min(Number(filters.limit) || 50, 100));
        const offset = page * limit;
        const category = filters.category || '';
        const search = filters.search || '';
        const custCode = localStorage.getItem('_userCode') || '';
        const favorite = filters.favorite !== undefined ? filters.favorite : 0;
        const instockValue = localStorage.getItem('_isstock');
        // แปลงค่า _isstock: null หรือ '0' = 0 (แสดงทั้งหมด), '1' = 1 (แสดงเฉพาะที่มีคงเหลือ)
        const ispromotion = filters.isPromotion !== undefined ? filters.isPromotion : 0;
        const isproductset = filters.isproductset !== undefined ? filters.isproductset : 0;
        const instock = isproductset ? 0 : instockValue === '1' ? 1 : 0;
        const includeAllPattern = filters.includeAllPattern ? 1 : undefined;
        const premium = filters.premium !== undefined ? filters.premium : 0;
        const featureType = filters.featureType || filters.feature_type || '';

        return new Promise((resolve, reject) => {
            // เรียกใช้งาน API จริง
            apiClient
                .get('service/v1/getProductList', {
                    params: cleanParams({
                        cust_code: custCode || '',
                        search: search,
                        category: category,
                        offset: offset,
                        premium: premium,
                        feature_type: featureType,
                        limit: limit,
                        favorite: favorite,
                        isstock: instock,
                        ispromotion: ispromotion,
                        isproductset: isproductset,
                        include_all_pattern: includeAllPattern
                    })
                })
                .then((response) => {
                    // ตรวจสอบว่าข้อมูลมีรูปแบบที่ถูกต้อง
                    if (response.data && response.data.data && Array.isArray(response.data.data)) {
                        auditProductLanguageFields('service/v1/getProductList', response.data.data);

                        // เพิ่มข้อมูลเพิ่มเติมให้กับสินค้าแต่ละรายการ
                        const enhancedData = response.data.data.map((product) => {
                            return withProductDisplay({
                                ...product,
                                // ใช้ API สำหรับดึงรูปภาพสินค้า
                                image: this.getProductImageUrl(product.item_code, product),
                                // สำรองรูปภาพ (เผื่อต้องใช้เป็น fallback)
                                imageFallback: this.getPlaceholderImage(),
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
     * ดึงข้อมูลสินค้าตามรหัสสินค้า
     * @param {string} itemCode - รหัสสินค้า
     * @returns {Promise} ข้อมูลสินค้า
     */
    async getProductByItemCode(itemCode) {
        const custCode = localStorage.getItem('_userCode') || '';
        const priceOptions = await ErpOptionService.getPriceOptions();

        return new Promise((resolve, reject) => {
            // เรียกใช้งาน API
            apiClient
                .get('service/v1/getProductDetail', {
                    params: cleanParams({
                        cust_code: custCode || '',
                        item_code: itemCode,
                        show_promotion: '1',
                        wh_code: DEFAULT_WH_CODE,
                        ...priceOptions
                    })
                })
                .then((response) => {
                    if (response.data && response.data.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
                        auditProductLanguageFields('service/v1/getProductDetail', response.data.data);

                        // สินค้า 1 รายการอาจมีหลายหน่วย (unit) ให้เลือกตัวแรกเป็นค่าเริ่มต้น
                        const primaryProduct = response.data.data[0];
                        const otherUnits = response.data.data.slice(1).map((unit) => withProductDisplay(unit));

                        // เพิ่มข้อมูลเพิ่มเติม
                        const enhancedProduct = withProductDisplay({
                            ...primaryProduct,
                            image: this.getProductImageUrl(primaryProduct.item_code, primaryProduct),
                            imageFallback: this.getPlaceholderImage(),
                            category: primaryProduct.category || '',
                            description: primaryProduct.description || '', // ใช้ description จริงจาก API
                            otherUnits: otherUnits,
                            // แปลงข้อมูลให้ตรงกับที่ ProductDetail.vue ใช้
                            id: primaryProduct.item_code,
                            name: primaryProduct.item_name,
                            inventoryStatus: primaryProduct.sold_out === '1' ? 'OUTOFSTOCK' : 'INSTOCK',
                            code: primaryProduct.item_code,
                            specifications: [
                                { name: 'บาร์โค้ด', value: primaryProduct.barcode || 'ไม่ระบุ' },
                                { name: 'หน่วย', value: primaryProduct.unit_code || 'ไม่ระบุ' },
                                { name: 'คงเหลือ', value: parseFloat(primaryProduct.balance_qty).toFixed(2) + ' ' + primaryProduct.unit_code }
                            ]
                        });

                        resolve({ data: enhancedProduct });
                    } else {
                        reject({ error: 'ไม่พบสินค้า' });
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API:', error);
                    reject(error);
                });
        });
    },


     /**
     * ดึงข้อมูลสินค้าชุดตามรหัสสินค้า
     * @param {string} itemCode - รหัสสินค้า
     * @returns {Promise} ข้อมูลสินค้า
     */
    getProductSetByItemCode(itemCode) {
        const custCode = localStorage.getItem('_userCode') || '';

        return new Promise((resolve, reject) => {
            // เรียกใช้งาน API
            apiClient
                .get('service/v1/getProductSetDetail', {
                    params: {
                        cust_code: custCode || '',
                        item_code: itemCode,
                        wh_code: DEFAULT_WH_CODE
                    }
                })
                .then((response) => {
                    if (response.data && response.data.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
                        auditProductLanguageFields('service/v1/getProductSetDetail', response.data.data);

                        // สินค้า 1 รายการอาจมีหลายหน่วย (unit) ให้เลือกตัวแรกเป็นค่าเริ่มต้น
                        const primaryProduct = response.data.data[0];
                        const otherUnits = response.data.data.slice(1).map((unit) => withProductDisplay(unit));

                        // เพิ่มข้อมูลเพิ่มเติม
                        const enhancedProduct = withProductDisplay({
                            ...primaryProduct,
                            image: this.getProductImageUrl(primaryProduct.item_code, primaryProduct),
                            imageFallback: this.getPlaceholderImage(),
                            category: primaryProduct.category || '',
                            description: primaryProduct.description || '', // ใช้ description จริงจาก API
                            otherUnits: otherUnits,
                            // แปลงข้อมูลให้ตรงกับที่ ProductDetail.vue ใช้
                            id: primaryProduct.item_code,
                            name: primaryProduct.item_name,
                            inventoryStatus: primaryProduct.sold_out === '1' ? 'OUTOFSTOCK' : 'INSTOCK',
                            code: primaryProduct.item_code,
                            specifications: [
                                { name: 'บาร์โค้ด', value: primaryProduct.barcode || 'ไม่ระบุ' },
                                { name: 'หน่วย', value: primaryProduct.unit_code || 'ไม่ระบุ' },
                                { name: 'คงเหลือ', value: parseFloat(primaryProduct.balance_qty).toFixed(2) + ' ' + primaryProduct.unit_code }
                            ]
                        });

                        resolve({ data: enhancedProduct });
                    } else {
                        reject({ error: 'ไม่พบสินค้า' });
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API:', error);
                    reject(error);
                });
        });
    },

    /**
     * สร้าง URL รูปภาพสินค้าจาก API
     * @param {string} itemCode - รหัสสินค้า
     * @returns {string} URL รูปภาพสินค้า
     */
    shouldBypassProductImageCache,

    getProductImageUrl(itemCode, cacheOptions = {}) {
        // ใช้ endpoint สำหรับดึงรูปภาพสินค้า
        const baseUrl = import.meta.env.VITE_APP_API.endsWith('/') ? import.meta.env.VITE_APP_API.slice(0, -1) : import.meta.env.VITE_APP_API;

        return `${baseUrl}/service/v1/images?item_code=${encodeURIComponent(itemCode || '')}`;
    },

    /**
     * สร้าง URL รูปภาพตัวอย่างสำหรับสินค้าที่ไม่มีรูปภาพ
     * @returns {string} URL รูปภาพตัวอย่าง
     */
    getPlaceholderImage() {
        return PRODUCT_IMAGE_PLACEHOLDER;
    },

    /**
     * ดึงรายการรูปภาพสินค้าทั้งหมดจาก guid
     * @param {string} itemCode - รหัสสินค้า
     * @returns {Promise<Array>} รายการ { guid_code }
     */
    getImageList(itemCode) {
        return new Promise((resolve, reject) => {
            apiClient
                .get('service/v1/getImageList', {
                    params: { item_code: itemCode }
                })
                .then((response) => {
                    if (response.data && response.data.success && Array.isArray(response.data.data)) {
                        resolve(response.data.data);
                    } else {
                        resolve([]);
                    }
                })
                .catch(() => resolve([]));
        });
    },

    /**
     * สร้าง URL รูปภาพสินค้าจาก guid_code
     * @param {string} guidCode
     * @returns {string}
     */
    getProductImageByGuid(guidCode, cacheOptions = {}) {
        const baseUrl = import.meta.env.VITE_APP_API.endsWith('/') ? import.meta.env.VITE_APP_API.slice(0, -1) : import.meta.env.VITE_APP_API;
        return `${baseUrl}/service/v1/imagesguid?guid_code=${encodeURIComponent(guidCode || '')}`;
    },

    async getProductDisplayDetail(itemCode) {
        const response = await apiClient.get('service/v1/getProductDisplayDetail', {
            params: { item_code: itemCode }
        });

        const data = response.data?.data || {};
        auditProductLanguageFields('service/v1/getProductDisplayDetail.detail', data.detail);
        auditProductLanguageFields('service/v1/getProductDisplayDetail.replacements', data.replacements || []);
        auditProductLanguageFields('service/v1/getProductDisplayDetail.suggestions', data.suggestions || []);

        const enhanceRelated = (items = []) =>
            items.map((item) => withProductDisplay({
                ...item,
                image: this.getProductImageUrl(item.item_code, item),
                imageFallback: this.getPlaceholderImage()
            }));

        return {
            success: response.data?.success === true,
            detail: data.detail || null,
            replacements: enhanceRelated(data.replacements || []),
            suggestions: enhanceRelated(data.suggestions || [])
        };
    },

    /**
     * อัพเดตสถานะรายการโปรด (ถูกใจ) ของสินค้า
     * @param {string} itemCode - รหัสสินค้า
     * @param {string|number} status - สถานะการถูกใจ (0=ไม่ถูกใจ, 1=ถูกใจ)
     * @returns {Promise} ผลลัพธ์การอัพเดตสถานะ
     */
    updateFavoriteStatus(itemCode, status) {
        const custCode = localStorage.getItem('_userCode') || '';

        if (!custCode) {
            return Promise.reject(new Error('ไม่พบรหัสลูกค้า กรุณาเข้าสู่ระบบ'));
        }

        return new Promise((resolve, reject) => {
            apiClient
                .get('service/v1/setfav', {
                    params: {
                        status: status === '1' ? 1 : 0,
                        cust_code: custCode,
                        item_code: itemCode
                    }
                })
                .then((response) => {
                    if (response.data && response.data.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error('ไม่สามารถอัพเดตสถานะรายการโปรดได้'));
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API:', error);
                    reject(error);
                });
        });
    },

    getProductBalancePrice(custCode, itemCode, unitCode) {
        return apiClient.get('service/v1/getProductBalancePrice', {
            params: {
                cust_code: custCode,
                item_code: itemCode,
                unit_code: unitCode,
                wh_code: DEFAULT_WH_CODE
            }
        }).then((response) => {
            auditProductLanguageFields('service/v1/getProductBalancePrice', response.data?.data || []);
            return response;
        });
    },

    async getProductPrice(itemCode, unitCode, qty = '1', custCode = localStorage.getItem('_userCode') || '', extraOptions = {}) {
        const priceOptions = await ErpOptionService.getPriceOptions();
        const response = await apiClient.get('service/v1/getProductPrice', {
            params: cleanParams({
                item_code: itemCode,
                unit_code: unitCode,
                qty,
                cust_code: custCode || '',
                ...priceOptions,
                ...extraOptions
            })
        });

        return response.data?.data?.[0] || null;
    },

    /**
     * ดึงรายการสินค้าย่อยที่รวมอยู่ในชุดสินค้า
     * @param {string} itemCode - รหัสสินค้าชุด
     * @returns {Promise} รายการสินค้าย่อยในชุด
     */
    getProductSetItem(itemCode) {
        return new Promise((resolve, reject) => {
            apiClient
                .get('service/v1/getProductSetItem', {
                    params: {
                        item_code: itemCode,
                        wh_code: DEFAULT_WH_CODE
                    }
                })
                .then((response) => {
                    if (response.data && response.data.success && Array.isArray(response.data.data)) {
                        auditProductLanguageFields('service/v1/getProductSetItem', response.data.data);

                        // เพิ่มรูปภาพให้กับแต่ละสินค้าย่อย
                        const enhancedItems = response.data.data.map((item) => withProductDisplay({
                            ...item,
                            image: this.getProductImageUrl(item.item_code, item)
                        }));

                        resolve({
                            data: enhancedItems,
                            success: true
                        });
                    } else {
                        reject({ error: 'ไม่พบรายการสินค้าในชุด' });
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API getProductSetItem:', error);
                    reject(error);
                });
        });
    }
};
