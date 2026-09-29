// services/UserService.js
import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: {
        'Content-Type': 'application/json'
    }
});

export default {
    /**
     * ลงชื่อเข้าใช้สำหรับลูกค้า
     * @param {string} userCode รหัสลูกค้า
     * @param {string} password รหัสผ่าน
     * @returns {Promise} ข้อมูลลูกค้า
     */
    loginCustomer(userCode, password) {
        return new Promise((resolve, reject) => {
            apiClient
                .get('service/v1/logincus', {
                    params: {
                        user_code: userCode,
                        password: password
                    }
                })
                .then((response) => {
                    if (response.data && response.data.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error('รหัสลูกค้าหรือรหัสผ่านไม่ถูกต้อง'));
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเข้าสู่ระบบลูกค้า:', error);
                    reject(error);
                });
        });
    },

    /**
     * ลงชื่อเข้าใช้สำหรับพนักงาน
     * @param {string} userCode รหัสพนักงาน
     * @param {string} password รหัสผ่าน
     * @returns {Promise} ข้อมูลพนักงาน
     */
    loginEmployee(userCode, password) {
        return new Promise((resolve, reject) => {
            apiClient
                .get('service/v1/loginemp', {
                    params: {
                        user_code: userCode,
                        password: password
                    }
                })
                .then((response) => {
                    if (response.data && response.data.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error('รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง'));
                    }
                })
                .catch((error) => {
                    console.error('เกิดข้อผิดพลาดในการเข้าสู่ระบบพนักงาน:', error);
                    reject(error);
                });
        });
    }
};
