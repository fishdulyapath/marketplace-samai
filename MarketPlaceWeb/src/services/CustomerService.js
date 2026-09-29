// services/CustomerService.js
import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API || 'http://43.229.149.11:8998/v1',
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json'
    }
});

function normalizeCustomer(customer = {}) {
    const code = customer.code || customer.user_code || customer.customer_code || customer.cust_code || '';
    const name = customer.name || customer.user_name || customer.customer_name || customer.cust_name || customer.name_1 || '';

    return {
        ...customer,
        code,
        name,
        name_1: customer.name_1 || name,
        user_code: customer.user_code || code,
        user_name: customer.user_name || name,
        address: customer.address || customer.address_1 || '',
        telephone: customer.telephone || customer.telephone_number || customer.phone || '',
        email: customer.email || '',
        website: customer.website || customer.gps || '',
        gps: customer.gps || customer.website || '',
        price_level: customer.price_level ?? 0,
        tax_id: customer.tax_id || customer.tax_number || '',
        group_main: customer.group_main || '',
        group_sub_1: customer.group_sub_1 || '',
        group_sub_3: customer.group_sub_3 || '',
        group_sub_4: customer.group_sub_4 || '',
        logistic_area: customer.logistic_area || '',
        logistic_area_name: customer.logistic_area_name || '',
        sale_code: customer.sale_code || '',
        sale_name: customer.sale_name || '',
        dimension_1: customer.dimension_1 || '',
        dimension_1_name: customer.dimension_1_name || '',
        credit_money: customer.credit_money ?? 0,
        credit_money_max: customer.credit_money_max ?? 0,
        credit_day: customer.credit_day ?? 0,
        password: customer.password || ''
    };
}

export default {
    /**
     * ดึงรายการลูกค้าตามคำค้นหา
     * @param {string} search คำค้นหา (ชื่อหรือรหัสลูกค้า)
     * @param {number} limit จำนวนรายการสูงสุดที่ต้องการ (ค่าเริ่มต้น: ไม่จำกัด)
     * @returns {Promise} รายการลูกค้าที่ตรงกับคำค้นหา
     */
    getCustomers(search = '', limit = null) {
        return new Promise((resolve, reject) => {
            // แสดง URL ที่กำลังเรียก
            //console.log(`กำลังเรียก API: ${apiClient.defaults.baseURL}/service/v1/getCustomerList?search=${encodeURIComponent(search)}`);
            //console.log('ค่าพารามิเตอร์ search ที่ส่งไป:', search);

            apiClient
                .get('service/v1/getCustomerList', {
                    params: {
                        search: search
                    }
                })
                .then((response) => {
                    //console.log('Response จาก API:', response);
                    // เพิ่ม log เพื่อดูโครงสร้างข้อมูลที่ API ส่งกลับมา
                    let results = [];

                    if (response.data && Array.isArray(response.data)) {
                        results = response.data;
                    } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
                        // บางครั้ง API อาจส่งข้อมูลมาในรูปแบบ { data: [...] }
                        results = response.data.data;
                    } else {
                        console.warn('รูปแบบข้อมูลไม่ตรงตามที่คาดหวัง:', response.data);
                        results = [];
                    }

                    // จำกัดจำนวนผลลัพธ์ถ้ามีการระบุ limit
                    if (limit && Number(limit) > 0 && results.length > Number(limit)) {
                        results = results.slice(0, Number(limit));
                    }

                    resolve(results.map(normalizeCustomer).filter((customer) => customer.code || customer.name));
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API ค้นหาลูกค้า:', error);
                    reject(error);
                });
        });
    },

    /**
     * ดึงข้อมูลลูกค้าตามรหัสลูกค้า
     * @param {string} code รหัสลูกค้า
     * @returns {Promise} ข้อมูลลูกค้า
     */
    getCustomerByCode(code) {
        return new Promise((resolve, reject) => {
            apiClient
                .get('service/v1/getCustomerList', {
                    params: {
                        code: code
                    }
                })
                .then((response) => {
                    let results = [];
                    if (response.data && Array.isArray(response.data)) {
                        results = response.data;
                    } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
                        results = response.data.data;
                    }

                    if (results.length > 0) {
                        resolve(normalizeCustomer(results[0]));
                    } else {
                        reject(new Error('ไม่พบข้อมูลลูกค้า'));
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API ดึงข้อมูลลูกค้า:', error);
                    reject(error);
                });
        });
    },

    async getCustomerManageList({ search = '', limit = 30, offset = 0 } = {}) {
        const response = await apiClient.get('service/v1/getCustomerManageList', {
            params: { search, limit, offset }
        });
        return {
            success: response.data?.success,
            data: (response.data?.data || []).map(normalizeCustomer),
            pagination: response.data?.pagination || { total: 0, limit, offset, current_page: 1, total_page: 1 }
        };
    },

    async getCustomerDetail(code) {
        const response = await apiClient.get('service/v1/getCustomerDetail', {
            params: { code }
        });
        return response.data?.data ? normalizeCustomer(response.data.data) : null;
    },

    async getNextCustomerCode() {
        const response = await apiClient.get('service/v1/getNextCustomerCode');
        return response.data?.code || '';
    },

    async getDimensions(search = '') {
        const response = await apiClient.get('service/v1/getDimensionList', {
            params: { search }
        });
        return response.data?.data || [];
    },

    async getLogisticAreas(search = '') {
        const response = await apiClient.get('service/v1/getLogisticAreaList', {
            params: { search }
        });
        return response.data?.data || [];
    },

    async createCustomer(customer) {
        const response = await apiClient.post('service/v1/createCustomer', customer);
        return normalizeCustomer(response.data?.data || {});
    },

    async updateCustomer(customer) {
        const response = await apiClient.post('service/v1/updateCustomer', customer);
        return normalizeCustomer(response.data?.data || {});
    },

    async updateCustomerProfile(customer) {
        const response = await apiClient.post('service/v1/updateCustomerProfile', customer);
        return normalizeCustomer(response.data?.data || {});
    },

    async deleteCustomer(code) {
        const response = await apiClient.post('service/v1/deleteCustomer', { code });
        return response.data;
    }
};
