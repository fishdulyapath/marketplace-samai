// services/EmployeeService.js
import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API || 'http://43.229.149.11:8998/v1',
    headers: {
        'Content-Type': 'application/json'
    }
});

export default {
    /**
     * ดึงรายการพนักงานตามคำค้นหา
     * @param {string} search คำค้นหา (ชื่อหรือรหัสพนักงาน)
     * @param {number} limit จำนวนรายการสูงสุดที่ต้องการ (ค่าเริ่มต้น: ไม่จำกัด)
     * @returns {Promise} รายการพนักงานที่ตรงกับคำค้นหา
     */
    getEmployees(search = '', limit = null, options = {}) {
        return new Promise((resolve, reject) => {
            //console.log(`กำลังเรียก API: ${apiClient.defaults.baseURL}/service/v1/getEmployeeList?search=${encodeURIComponent(search)}`);

            apiClient
                .get('service/v1/getEmployeeList', {
                    params: {
                        search: search,
                        selectable_only: options.selectableOnly ? 1 : undefined
                    }
                })
                .then((response) => {
                    let results = [];

                    if (response.data && response.data.data && Array.isArray(response.data.data)) {
                        results = response.data.data;
                    } else if (response.data && Array.isArray(response.data)) {
                        results = response.data;
                    } else {
                        console.warn('รูปแบบข้อมูลพนักงานไม่ตรงตามที่คาดหวัง:', response.data);
                        results = [];
                    }

                    // จำกัดจำนวนผลลัพธ์ถ้ามีการระบุ limit
                    if (limit && Number(limit) > 0 && results.length > Number(limit)) {
                        results = results.slice(0, Number(limit));
                    }

                    resolve(results);
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API ค้นหาพนักงาน:', error);
                    reject(error);
                });
        });
    },

    /**
     * ดึงข้อมูลพนักงานตามรหัสพนักงาน
     * @param {string} code รหัสพนักงาน
     * @returns {Promise} ข้อมูลพนักงาน
     */
    getEmployeeByCode(code, options = {}) {
        return new Promise((resolve, reject) => {
            apiClient
                .get('service/v1/getEmployeeList', {
                    params: {
                        code: code,
                        selectable_only: options.selectableOnly ? 1 : undefined
                    }
                })
                .then((response) => {
                    if (response.data && response.data.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
                        resolve(response.data.data[0]);
                    } else if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                        resolve(response.data[0]);
                    } else {
                        reject(new Error('ไม่พบข้อมูลพนักงาน'));
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเรียก API ดึงข้อมูลพนักงาน:', error);
                    reject(error);
                });
        });
    }
};
