// stores/authen.js
import router from '@/router';
import UserService from '@/services/UserService';
import { useCartStore } from '@/stores/cartStore'; // เพิ่มการนำเข้า cart store
import { clearActivity, markActivity } from '@/composables/useIdleLogout';
import { clearStoredAdminPermissions, saveStoredAdminPermissions } from '@/utils/adminPermissions';
import { defineStore } from 'pinia';

export const useAuthenStore = defineStore('authen', {
    state: () => ({
        loginSuccess: false,
        loginErrorMsg: '',
        token: localStorage.getItem('_token') || '',
        loading: false,
        userType: localStorage.getItem('_userType') || '', // 'customer' หรือ 'employee'
        userData: JSON.parse(localStorage.getItem('_userData') || '{}'),
        empData: JSON.parse(localStorage.getItem('_empData') || '{}'),
        userCode: localStorage.getItem('_userCode') || '',
        empCode: localStorage.getItem('_empCode') || '',
        contactCode: localStorage.getItem('_contactCode') || ''
    }),

    getters: {
        isAuthenticated: (state) => !!state.token,
        isCustomer: (state) => state.userType === 'customer',
        isEmployee: (state) => state.userType === 'employee',
        fullName: (state) => {
            if (state.userType === 'customer') {
                return state.userData?.user_name || '';
            }
            return state.empData?.user_name || '';
        },
        userAddress: (state) => {
            if (state.userType === 'customer') {
                return state.userData?.address || '';
            }
            return state.empData?.address || '';
        },
        userTelephone: (state) => {
            if (state.userType === 'customer') {
                return state.userData?.telephone || '';
            }
            return state.empData?.telephone || '';
        }
    },

    actions: {
        /**
         * ลงชื่อเข้าใช้สำหรับลูกค้า
         * @param {string} userCode รหัสลูกค้า
         * @param {string} password รหัสผ่าน
         * @param {string} returnUrl URL สำหรับ redirect หลังจากลงชื่อเข้าใช้สำเร็จ
         */
        async loginCustomer(userCode, password, options = {}) {
            this.loading = true;
            this.loginErrorMsg = '';
            const silentFailure = Boolean(options.silentFailure);

            try {
                const response = await UserService.loginCustomer(userCode, password);

                if (response.success && response.data && response.data.length > 0) {
                    const userData = response.data[0];

                    // รีเซ็ตข้อมูลตะกร้าก่อนที่จะโหลดข้อมูลใหม่
                    const cartStore = useCartStore();
                    cartStore.resetCartStore();

                    // บันทึกข้อมูลลง state และ localStorage
                    // token ต้องมาจาก server เท่านั้น — ของเดิมเป็นสตริงที่ client ปั้นเอง
                    // ('CUSTOMER_TOKEN_' + Date.now()) ซึ่ง server ไม่เคยตรวจ เป็นแค่ธงให้ UI
                    // ถ้า server รุ่นเก่ายังไม่ส่ง token มา จะไม่มี token ให้แนบ แล้วโหมด enforce
                    // จะปฏิเสธ ซึ่งเป็นพฤติกรรมที่ถูกต้อง (ต้องอัปเดต backend ก่อน)
                    this.token = userData.token || '';
                    this.userType = 'customer';
                    this.userData = userData;
                    this.empData = {}; // ล้างข้อมูลพนักงาน
                    this.userCode = userData.user_code;
                    this.contactCode = userData.contact_code || '';
                    this.empCode = ''; // ล้างรหัสพนักงาน
                    this.loginSuccess = true;

                    localStorage.setItem('_token', this.token);
                    markActivity(); // เริ่มนับ idle ใหม่ทุกครั้งที่ล็อกอินสำเร็จ (REQ2)
                    localStorage.setItem('_userType', 'customer');
                    localStorage.setItem('_userData', JSON.stringify(userData));
                    localStorage.removeItem('_empData'); // ล้างข้อมูลพนักงานออกจาก localStorage
                    localStorage.setItem('_userCode', userData.user_code);
                    if (this.contactCode) {
                        localStorage.setItem('_contactCode', this.contactCode);
                    } else {
                        localStorage.removeItem('_contactCode');
                    }
                    localStorage.removeItem('_empCode'); // ล้างรหัสพนักงานออกจาก localStorage
                    clearStoredAdminPermissions();

                    // โหลดข้อมูลตะกร้าสำหรับลูกค้าคนนี้ โดยบังคับให้รีเฟรชข้อมูลใหม่
                    try {
                        await cartStore.loadCartItems(true);
                    } catch (error) {
                        console.error('Error loading cart items after login:', error);
                    }

                    return true; // เพิ่มการ return true เพื่อบอกว่าล็อกอินสำเร็จ
                } else {
                    throw new Error('รหัสลูกค้าหรือรหัสผ่านไม่ถูกต้อง');
                }
            } catch (error) {
                if (silentFailure) {
                    console.warn('ไม่พบข้อมูลลูกค้า กำลังลองวิธีเข้าสู่ระบบถัดไป:', error.message || error);
                } else {
                    console.error('การลงชื่อเข้าใช้ลูกค้าล้มเหลว:', error);
                }
                this.loginSuccess = false;
                this.loginErrorMsg = error.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่อีกครั้ง';
                return false; // เพิ่มการ return false เพื่อบอกว่าล็อกอินไม่สำเร็จ
            } finally {
                this.loading = false;
            }
        },

        /**
         * ลงชื่อเข้าใช้สำหรับพนักงาน
         * @param {string} empCode รหัสพนักงาน
         * @param {string} password รหัสผ่าน
         * @param {string} returnUrl URL สำหรับ redirect หลังจากลงชื่อเข้าใช้สำเร็จ
         */
        async loginEmployee(empCode, password) {
            this.loading = true;
            this.loginErrorMsg = '';

            try {
                const response = await UserService.loginEmployee(empCode, password);

                if (response.success && response.data && response.data.length > 0) {
                    const empData = response.data[0];

                    // รีเซ็ตข้อมูลตะกร้าก่อนที่จะโหลดข้อมูลใหม่
                    const cartStore = useCartStore();
                    cartStore.resetCartStore();

                    // บันทึกข้อมูลลง state และ localStorage
                    // เหตุผลเดียวกับฝั่งลูกค้า — token ต้องเป็นตัวที่ server เซ็นมา
                    this.token = empData.token || '';
                    this.userType = 'employee';
                    this.empData = empData;
                    this.userData = {}; // ล้างข้อมูลลูกค้า
                    this.empCode = empData.user_code;
                    this.userCode = ''; // ล้างรหัสลูกค้า
                    this.contactCode = '';
                    this.loginSuccess = true;

                    localStorage.setItem('_token', this.token);
                    markActivity(); // เริ่มนับ idle ใหม่ทุกครั้งที่ล็อกอินสำเร็จ (REQ2)
                    localStorage.setItem('_userType', 'employee');
                    localStorage.setItem('_empData', JSON.stringify(empData));
                    localStorage.removeItem('_userData'); // ล้างข้อมูลลูกค้าออกจาก localStorage
                    localStorage.setItem('_empCode', empData.user_code);
                    localStorage.removeItem('_userCode'); // ล้างรหัสลูกค้าออกจาก localStorage
                    localStorage.removeItem('_contactCode');
                    saveStoredAdminPermissions(empData.admin_permissions || [], empData.admin_permission_custom);

                    // โหลดข้อมูลตะกร้าสำหรับพนักงานคนนี้ โดยบังคับให้รีเฟรชข้อมูลใหม่
                    try {
                        await cartStore.loadCartItems(true);
                    } catch (error) {
                        console.error('Error loading cart items after login:', error);
                    }

                    return true; // เพิ่มการ return ค่าเพื่อให้หน้า login รู้ว่าล็อกอินสำเร็จ
                } else {
                    throw new Error('รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง');
                }
            } catch (error) {
                console.error('การลงชื่อเข้าใช้พนักงานล้มเหลว:', error);
                this.loginSuccess = false;
                this.loginErrorMsg = error.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่อีกครั้ง';
                return false; // เพิ่มการ return ค่าเพื่อให้หน้า login รู้ว่าล็อกอินไม่สำเร็จ
            } finally {
                this.loading = false;
            }
        },

        /**
         * ลงชื่อเข้าใช้ (สำหรับความเข้ากันได้กับโค้ดเดิม)
         * @param {string} username รหัสผู้ใช้
         * @param {string} password รหัสผ่าน
         * @param {string} returnUrl URL สำหรับ redirect หลังจากลงชื่อเข้าใช้สำเร็จ
         */
        async login(username, password, returnUrl = '') {
            // ใช้ login ลูกค้าเป็นค่าเริ่มต้น
            await this.loginCustomer(username, password, returnUrl);
        },

        /**
         * ออกจากระบบ
         */
        async logout() {
            // เรียกใช้ cartStore เพื่อล้างข้อมูลตะกร้า
            const cartStore = useCartStore();
            try {
                // เปลี่ยนจาก clearCart เป็น resetCartStore เพื่อรีเซ็ตข้อมูลตะกร้าอย่างสมบูรณ์
                cartStore.resetCartStore();
            } catch (error) {
                console.error('Error resetting cart during logout:', error);
            }

            // ล้างข้อมูลออกจาก state
            this.token = '';
            this.userType = '';
            this.userData = {};
            this.empData = {};
            this.userCode = '';
            this.empCode = '';
            this.contactCode = '';
            this.loginSuccess = false;

            // ล้างข้อมูลออกจาก localStorage
            clearActivity(); // หยุดนับ idle (REQ2)
            localStorage.removeItem('_token');
            localStorage.removeItem('_userType');
            localStorage.removeItem('_userData');
            localStorage.removeItem('_empData');
            localStorage.removeItem('_userCode');
            localStorage.removeItem('_empCode');
            localStorage.removeItem('_contactCode');
            clearStoredAdminPermissions();

            // นำทางกลับไปยังหน้า login และลบประวัติก่อนหน้าออก เพื่อป้องกันการกด Back กลับมา
            router.replace('/auth/login');
        },

        /**
         * ตรวจสอบสถานะการลงชื่อเข้าใช้
         * @returns {boolean} สถานะการลงชื่อเข้าใช้
         */
        checkAuth() {
            if (!this.token) {
                router.push('/auth/login');
                return false;
            }
            return true;
        }
    }
});
