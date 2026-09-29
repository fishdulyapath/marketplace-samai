import { createApiClient } from '@/api/http';
import ErpOptionService from './ErpOptionService';
import { auditProductLanguageFields } from '@/utils/languageApiCoverage';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    },
    // Add timeout and retry configuration
    timeout: 300000 // 30 seconds timeout
});

const DEFAULT_WH_CODE = import.meta.env.VITE_WH_CODE || '';

function cleanParams(params) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function cartPriceKey(item) {
    return `${item.item_code}-${item.unit_code}-${item.barcode || ''}`;
}

class CartService {
    // เพิ่มสินค้าลงตะกร้า
    async addItemToCart(cartItems) {
        return apiClient.post('service/v1/additemtocart', cartItems);
    } // ดึงรายการสินค้าในตะกร้า (รองรับ pagination และ search)
    async getCartItems(custCode, page = 1, pageSize = 50, search = '') {
        const params = {
            cust_code: custCode,
            page: page,
            page_size: pageSize
        };

        // เพิ่ม search param ถ้ามีค่า
        if (search && search.trim()) {
            params.search = search.trim();
        }

        const response = await apiClient.get('service/v1/getcartitemlist', { params });
        auditProductLanguageFields('service/v1/getcartitemlist', response.data?.data || []);
        return response;
    }

    // ดึงสินค้าในตะกร้าทั้งหมด (รวม pagination อัตโนมัติ)
    async getAllCartItems(custCode, pageSize = 50) {
        let allItems = [];
        let page = 1;
        let hasNext = true;
        let totalCount = 0;

        while (hasNext) {
            const response = await this.getCartItems(custCode, page, pageSize);
            if (response?.data?.success && response.data.data) {
                allItems = allItems.concat(response.data.data);
                hasNext = response.data.has_next;
                totalCount = response.data.total_count;
                page++;
            } else {
                hasNext = false;
            }
        }

        return {
            data: {
                success: true,
                total_count: totalCount,
                data: allItems
            }
        };
    }

    // ลบสินค้าออกจากตะกร้า
    async removeItemFromCart(custCode, itemCode, unitCode) {
        return apiClient.post('service/v1/removeitemfromcart', {
            cust_code: custCode,
            item_code: itemCode,
            unit_code: unitCode
        });
    }

    // ลบสินค้าออกจากตะกร้า (ใหม่)
    // line = { item_code, unit_code } (ไม่บังคับ) ใช้จำกัดขอบเขตการลบให้เหลือบรรทัดเดียว
    // เผื่อข้อมูลเก่าที่ guid_code ซ้ำกันข้ามหน่วยของสินค้าตัวเดียวกัน
    async deleteItem(guidCode, custCode, line = {}) {
        return apiClient.get('service/v1/deleteItem', {
            params: {
                guid_code: guidCode,
                cust_code: custCode,
                ...(line.item_code ? { item_code: line.item_code } : {}),
                ...(line.unit_code ? { unit_code: line.unit_code } : {})
            }
        });
    }

    // ล้างตะกร้าทั้งหมด
    async deleteAllItems(custCode) {
        return apiClient.get('service/v1/deleteAllItems', {
            params: {
                cust_code: custCode
            }
        });
    } // อัปเดตจำนวนสินค้าในตะกร้า (ใช้ endpoint เดียวกับ addItemToCart)
    async updateCartItemQuantity(cartItems) {
        // ใช้ endpoint เดียวกับการเพิ่มสินค้า
        return apiClient.post('service/v1/additemtocart', cartItems);
    }

    // ดึงข้อมูล balance_qty ของสินค้าในตะกร้า (lazy load stock)
    async getCartItemStock(items) {
        return apiClient.post('service/v1/getcartitemstock', { items, wh_code: DEFAULT_WH_CODE });
    }

    // ดึงข้อมูลสินค้าในตะกร้า (รองรับ pagination) - ไม่มีราคา
    async getCartOrder(custCode, page = 1, pageSize = 20) {
        const response = await apiClient.get('service/v1/getcartorder', {
            params: {
                cust_code: custCode,
                page: page,
                page_size: pageSize,
                wh_code: DEFAULT_WH_CODE
            }
        });
        auditProductLanguageFields('service/v1/getcartorder', response.data?.data || []);
        return response;
    }

    // ดึงราคายืนยัน (price_confirm) สำหรับรายการสินค้า
    async getCartOrderPrice(custCode, items) {
        const priceOptions = await ErpOptionService.getPriceOptions();
        return apiClient.post('service/v1/getcartorderprice', {
            cust_code: custCode,
            ...priceOptions,
            items: items.map((item) => ({
                item_code: item.item_code,
                unit_code: item.unit_code,
                barcode: item.barcode || '',
                qty: item.qty,
                item_type: item.item_type || '1',
                tax_type: item.tax_type
            }))
        });
    }

    // ดึงข้อมูลสินค้าในตะกร้าพร้อมราคายืนยันทั้งหมด (รวม pagination อัตโนมัติ)
    async getAllCartOrders(custCode, pageSize = 20) {
        let allItems = [];
        let page = 1;
        let hasNext = true;

        while (hasNext) {
            const response = await this.getCartOrder(custCode, page, pageSize);
            if (response?.data?.success && response.data.data) {
                let items = response.data.data;

                // ดึงราคายืนยันสำหรับรายการในหน้านี้
                if (items.length > 0) {
                    try {
                        const priceResponse = await this.getCartOrderPrice(custCode, items);
                        if (priceResponse?.data?.success && priceResponse.data.data) {
                            const priceMap = new Map();
                            priceResponse.data.data.forEach((p) => {
                                const key = cartPriceKey(p);
                                priceMap.set(key, {
                                    price_confirm: p.price_confirm,
                                    defaultDiscount: p.defaultDiscount || p.default_discount || p.discount || ''
                                });
                            });

                            items = items.map((item) => {
                                const key = cartPriceKey(item);
                                const priceInfo = priceMap.get(key);
                                return {
                                    ...item,
                                    price_confirm: priceInfo?.price_confirm ?? item.price,
                                    defaultDiscount: priceInfo?.defaultDiscount || '',
                                    discount: priceInfo?.defaultDiscount || ''
                                };
                            });
                        }
                    } catch (priceError) {
                        console.error('Error fetching price_confirm:', priceError);
                    }
                }

                allItems = allItems.concat(items);
                hasNext = page * pageSize < response.data.total_count;
                page++;
            } else {
                hasNext = false;
            }
        }

        return {
            data: {
                success: true,
                total_count: allItems.length,
                data: allItems
            }
        };
    }

    // ดึงยอดรวมราคาและจำนวนสินค้าในตะกร้า (สำหรับ pagination)
    async getCartSummary(custCode) {
        return apiClient.get('service/v1/getCartSummary', {
            params: {
                cust_code: custCode
            }
        });
    }

    // ดึงยอดรวมสุดท้าย (ราคายืนยัน) สำหรับหน้าสรุปรายการสั่งซื้อ
    async getCartFinalSummary(custCode) {
        const priceOptions = await ErpOptionService.getPriceOptions();
        return apiClient.get('service/v1/getcartfinalsummary', {
            params: cleanParams({
                cust_code: custCode,
                ...priceOptions
            })
        });
    }

    // ตรวจสอบ stock ของสินค้าในตะกร้าทั้งหมด
    async validateCartStock(custCode) {
        return apiClient.get('service/v1/validatecartstock', {
            params: {
                cust_code: custCode,
                wh_code: DEFAULT_WH_CODE
            }
        });
    }

    // ดึงข้อมูลเครดิตลูกค้า
    async getCustomerCredit(custCode) {
        return apiClient.get('service/v1/getCustomerCredit', {
            params: {
                cust_code: custCode
            }
        });
    }

    // สั่งซื้อสินค้า
    async sendOrder(orderData) {
        //console.log('CartService sending order data:', JSON.stringify(orderData, null, 2));
        return apiClient.post('service/v1/sendorder', orderData);
    }

    async cancelOrder(orderData) {
        return apiClient.post('service/v1/cancelOrder', orderData);
    }
}

export default new CartService();
