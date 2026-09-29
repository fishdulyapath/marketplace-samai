<script setup>
import CompanyService from '@/services/CompanyService';
import CustomerService from '@/services/CustomerService';
import EmployeeService from '@/services/EmployeeService';
import { useAuthenStore } from '@/stores/authen';
import { useCartStore } from '@/stores/cartStore'; // เพิ่ม import cartStore
import { useLanguageStore } from '@/stores/languageStore';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const router = useRouter();
const route = useRoute();
const languageStore = useLanguageStore();
const t = languageStore.t;
// const appName = ref(import.meta.env.VITE_APP_NAME);

// Environment variables for company info
const companyName = ref(import.meta.env.VITE_APP_COMPANY_NAME || '');
const companyLogo = ref(import.meta.env.VITE_APP_LOGO || '');
const allowStaffLogin = computed(() => String(import.meta.env.VITE_ENABLE_STAFF_LOGIN || 'true').toLowerCase() !== 'false');

const displayCompanyName = computed(() => companyName.value?.trim() || t('authPage.onlineStore'));

const fallbackLogoSvg =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='#0ea5e9'/><stop offset='100%' stop-color='#6366f1'/></linearGradient></defs><rect width='160' height='160' rx='30' fill='url(#g)'/><circle cx='48' cy='52' r='18' fill='rgba(255,255,255,0.95)'/><path d='M30 110c7-21 27-28 43-28s36 7 43 28' fill='none' stroke='rgba(255,255,255,0.95)' stroke-width='10' stroke-linecap='round'/><rect x='94' y='38' width='38' height='12' rx='6' fill='rgba(255,255,255,0.92)'/><rect x='94' y='58' width='28' height='12' rx='6' fill='rgba(255,255,255,0.72)'/></svg>"
    );

function resolvePublicAsset(value) {
    const asset = String(value || '').trim();
    if (!asset) return '';
    if (/^(https?:|data:|blob:)/i.test(asset)) return asset;
    if (asset.startsWith('/')) return asset;
    return `${import.meta.env.BASE_URL || '/'}${asset}`;
}

// Create the full logo path for proper asset loading
const getLogoPath = computed(() => {
    const logoName = companyLogo.value?.trim();
    if (!logoName) {
        return fallbackLogoSvg;
    }

    return resolvePublicAsset(logoName);
});

const loadCompanyProfile = async () => {
    try {
        const profile = await CompanyService.getCompanyProfile();
        if (!profile) return;

        companyName.value = profile.company_name_1 || profile.company_name || profile.name || companyName.value;
    } catch (error) {
        console.warn('ไม่สามารถโหลดข้อมูลบริษัทได้:', error);
    }
};

const loadCustomerSelection = async (fallbackRedirect = '/marketplace') => {
    try {
        isSearching.value = true;
        const data = await CustomerService.getCustomers('', 50);

        if (Array.isArray(data) && data.length > 0) {
            customerOptions.value = data;
            selectedCustomer.value = null;
            showCustomerSearch.value = true;
            showEmployeeSelection.value = false;
            return true;
        }

        console.warn('ไม่พบข้อมูลลูกค้า ข้ามการเลือกลูกค้า');
        router.push(fallbackRedirect);
        return false;
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการโหลดข้อมูลลูกค้า:', error);
        router.push(fallbackRedirect);
        return false;
    } finally {
        isSearching.value = false;
    }
};

// Add authentication store
const authenStore = useAuthenStore();
const cartStore = useCartStore(); // เพิ่ม cartStore

const hasSavedCredentials = ref(false);

// Form refs
const username = ref('');
const password = ref('');
const userType = ref('customer'); // Default to customer login
const rememberMe = ref(false);

const redirectTarget = computed(() => {
    const redirect = route.query.redirect;
    return typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '';
});

const isBackOfficeRedirect = computed(() => redirectTarget.value.startsWith('/admin'));

const getRedirectTarget = (fallback = '/') => redirectTarget.value || fallback;

// Customer search (for employee login)
const showCustomerSearch = ref(false);
const selectedCustomer = ref(null);
const isSearching = ref(false);
const isConfirmingCustomer = ref(false);
const customerOptions = ref([]);

// เพิ่มส่วนสำหรับเลือกพนักงาน (สำหรับลูกค้า)
const showEmployeeSelection = ref(false);
const selectedEmployee = ref(null);
const isSearchingEmployee = ref(false);
const isConfirmingEmployee = ref(false);
const employeeOptions = ref([]);
const skipEmployeeSelection = ref(false);

const getFilterValue = (event) => {
    if (typeof event === 'string') return event;
    return event?.value || event?.query || '';
};

const handleCustomerLoginSuccess = () => {
    if (rememberMe.value) localStorage.setItem('_savedUserType', 'customer');
    // 🚨 ห้ามพาลูกค้าเข้า /admin ตาม redirect
    //    เคสจริง: โดนเด้งจากหน้าหลังบ้านมาที่ login?redirect=/admin/orders
    //    แล้วล็อกอินด้วยบัญชีลูกค้า — ล็อกอิน "สำเร็จ" แต่ push ไป /admin
    //    router guard เห็นเป็นลูกค้าจึงเด้งกลับหน้า login ทันที
    //    ผู้ใช้เห็นหน้า login อีกรอบ เข้าใจว่ารหัสผิด ทั้งที่เข้าระบบแล้ว
    router.push(isBackOfficeRedirect.value ? '/' : getRedirectTarget('/'));
};

const handleEmployeeLoginSuccess = async () => {
    if (rememberMe.value) localStorage.setItem('_savedUserType', 'employee');
    if (isBackOfficeRedirect.value) {
        router.push(getRedirectTarget('/admin/content'));
        return;
    }
    await loadCustomerSelection(getRedirectTarget('/marketplace'));
};

onMounted(() => {
    authenStore.loginErrorMsg = '';
    loadCompanyProfile();

    // ตรวจสอบว่า localStorage พร้อมใช้งานหรือไม่
    try {
        if (typeof localStorage !== 'undefined') {
            const savedUserType = localStorage.getItem('_savedUserType');
            const savedUsername = localStorage.getItem('_savedUsername');
            const shouldRemember = localStorage.getItem('_rememberMe') === 'true';

            // ตรวจสอบว่ามีข้อมูลที่ถูกจัดเก็บหรือไม่
            hasSavedCredentials.value = !!savedUsername;

            // คืนสถานะ checkbox เสมอ ไม่ผูกกับการมี savedUserType
            // (เดิมอยู่ใน if ทำให้ถ้าเคยติ๊กไว้แต่ล็อกอินไม่สำเร็จ checkbox จะไม่ติ๊กกลับ)
            rememberMe.value = shouldRemember;

            // ถ้ามีข้อมูลที่บันทึกไว้ ให้นำมาใส่ในฟอร์ม
            if (savedUserType && savedUsername) {
                userType.value = savedUserType === 'employee' && !allowStaffLogin.value ? 'customer' : savedUserType;
                username.value = savedUsername;
                localStorage.removeItem('_savedPassword');
            }
        }
    } catch (e) {
        console.error('ไม่สามารถเข้าถึง localStorage ได้:', e);
    }

    const requestedMode = route.query.mode;
    if (requestedMode === 'employee' && allowStaffLogin.value) {
        userType.value = 'employee';
    } else if (requestedMode === 'customer') {
        userType.value = 'customer';
    }

    if (route.query.selectCustomer === '1' && localStorage.getItem('_userType') === 'employee') {
        loadCustomerSelection(getRedirectTarget('/marketplace'));
    }
});

// แก้ไขฟังก์ชัน doLogin
const doLogin = async (e) => {
    if (e) {
        e.preventDefault();
    }
    if (authenStore.loading) return;

    const inputUsername = String(username.value || '').trim();
    const inputPassword = String(password.value || '').trim();

    username.value = inputUsername;
    password.value = inputPassword;

    if (!inputUsername || !inputPassword) {
        authenStore.loginErrorMsg = t('authPage.loginRequired');
        return;
    }

    try {
        if (typeof localStorage !== 'undefined') {
            if (rememberMe.value) {
                localStorage.setItem('_savedUsername', inputUsername);
                localStorage.setItem('_rememberMe', 'true');
                hasSavedCredentials.value = true;
            } else {
                localStorage.removeItem('_savedUserType');
                localStorage.removeItem('_savedUsername');
                localStorage.removeItem('_savedPassword');
                localStorage.removeItem('_rememberMe');
                hasSavedCredentials.value = false;
            }
        }
    } catch (e) {
        console.error('ไม่สามารถบันทึกข้อมูลใน localStorage ได้:', e);
    }

    // ถ้าเลือกโหมดพนักงาน ให้ลองล็อกอินพนักงานก่อน
    if (allowStaffLogin.value && userType.value === 'employee') {
        authenStore.loginErrorMsg = '';
        const employeeSuccess = await authenStore.loginEmployee(inputUsername, inputPassword);

        if (employeeSuccess && authenStore.isAuthenticated && authenStore.isEmployee) {
            await handleEmployeeLoginSuccess();
            return;
        }

        // 🚨 เดิมจบตรงนี้เลย = ลูกค้าล็อกอินไม่ได้ถาวร
        //    โหมดถูกกำหนดจาก _savedUserType ที่จำไว้ตอน "จำฉันไว้" หรือจาก ?mode=employee
        //    เครื่องที่เคยมีพนักงานล็อกอิน จะค้างโหมดพนักงานตลอด และหน้านี้ไม่มีปุ่มสลับโหมดให้
        //    ลูกค้าที่มากรอกรหัสถูกทุกอย่างจึงขึ้น "ไม่พบข้อมูลผู้ใช้" โดยไม่มีทางออก
        //    (ทางเดียวคือรู้ว่าต้องพิมพ์ ?mode=customer เองที่แถบที่อยู่)
        //    ยิงจริงแล้ว: OR-99985 / 1234 ผ่าน /logincus ได้ token ปกติ แต่หน้าจอเข้าไม่ได้
        //    ทำให้สมมาตรกับโหมดลูกค้าที่มี fallback ไปพนักงานอยู่แล้ว
        const customerFallback = await authenStore.loginCustomer(inputUsername, inputPassword, { silentFailure: true });

        if (customerFallback && authenStore.isAuthenticated && authenStore.isCustomer) {
            handleCustomerLoginSuccess();
            return;
        }

        authenStore.loginErrorMsg = 'ไม่พบข้อมูลผู้ใช้ กรุณาตรวจสอบรหัสและรหัสผ่านอีกครั้ง';
        return;
    }

    // โหมดลูกค้า: ลอง login ลูกค้าก่อน ถ้าไม่พบจึง fallback ไป login พนักงาน
    authenStore.loginErrorMsg = '';
    const customerSuccess = await authenStore.loginCustomer(inputUsername, inputPassword, { silentFailure: allowStaffLogin.value });

    if (customerSuccess && authenStore.isAuthenticated && authenStore.isCustomer) {
        handleCustomerLoginSuccess();
        return;
    }

    if (allowStaffLogin.value) {
        authenStore.loginErrorMsg = '';
        const employeeSuccess = await authenStore.loginEmployee(inputUsername, inputPassword);

        if (employeeSuccess && authenStore.isAuthenticated && authenStore.isEmployee) {
            await handleEmployeeLoginSuccess();
            return;
        }
    }

    // ทั้งสองไม่ผ่าน
    authenStore.loginErrorMsg = 'ไม่พบข้อมูลผู้ใช้ กรุณาตรวจสอบรหัสและรหัสผ่านอีกครั้ง';
};


// Confirm customer selection and proceed
const confirmCustomerSelection = async () => {
    if (!selectedCustomer.value || isConfirmingCustomer.value) return;

    const customer = selectedCustomer.value;
    isConfirmingCustomer.value = true;

    // Store customer data in localStorage แยกจากข้อมูลพนักงาน
    localStorage.setItem('_userCode', customer.code);
    localStorage.removeItem('_contactCode');
    localStorage.setItem(
        '_userData',
        JSON.stringify({
            user_code: customer.code,
            user_name: customer.name,
            address: customer.address,
            tax_id: customer.tax_id,
            telephone: customer.telephone
        })
    );

    // อัพเดตค่าใน store ด้วย
    authenStore.userData = {
        user_code: customer.code,
        user_name: customer.name,
        address: customer.address,
        tax_id: customer.tax_id
    };
    authenStore.userCode = customer.code;
    authenStore.contactCode = '';

    // โหลดข้อมูลตะกร้าสินค้าของลูกค้าทันที
    try {
        await cartStore.loadCartItemsForCustomer(customer.code);
    } catch (error) {
        console.error('Error loading cart items for customer:', error);
    }

    // Close the search panel and navigate to home
    showCustomerSearch.value = false;
    router.push(getRedirectTarget('/marketplace'));
};

// เพิ่มฟังก์ชันยืนยันการเลือกพนักงานและดำเนินการต่อ
const confirmEmployeeSelection = () => {
    if (isConfirmingEmployee.value) return;
    isConfirmingEmployee.value = true;

    // บันทึกข้อมูลพนักงานที่เลือก
    if (selectedEmployee.value) {
        // บันทึกรหัสพนักงานที่ดูแลลูกค้านี้
        localStorage.setItem('_empCode', selectedEmployee.value.code);
        localStorage.setItem('_empData', JSON.stringify(selectedEmployee.value));
    }

    // ปิดหน้าค้นหาและนำทางไปหน้าหลัก
    showEmployeeSelection.value = false;
    router.push('/');
};

// เพิ่มฟังก์ชันข้ามการเลือกพนักงาน
const skipEmployeeSelectionFn = () => {
    if (isConfirmingEmployee.value) return;
    isConfirmingEmployee.value = true;

    // ล้างข้อมูลพนักงานที่เคยเลือกไว้ (ถ้ามี)
    localStorage.removeItem('_empCode');
    localStorage.removeItem('_empData');

    // ปิดหน้าค้นหาและนำทางไปหน้าหลัก
    showEmployeeSelection.value = false;
    router.push('/');
};

// Handle customer filtering in Select
const filterCustomers = async (event) => {
    try {
        isSearching.value = true;

        // ดึงค่าที่ผู้ใช้พิมพ์ค้นหาจาก event
        const searchTerm = getFilterValue(event);

        // ถ้าข้อความค้นหาสั้นเกินไป ให้โหลดข้อมูลเริ่มต้น
        if (searchTerm.trim().length < 2) {
            const data = await CustomerService.getCustomers('', 50);
            if (Array.isArray(data) && data.length > 0) {
                customerOptions.value = data;
            } else {
                customerOptions.value = [];
            }
            return;
        }

        // เพิ่มการจำกัดจำนวนผลลัพธ์ที่จะแสดง
        const data = await CustomerService.getCustomers(searchTerm, 100);
        if (Array.isArray(data) && data.length > 0) {
            customerOptions.value = data;
        } else {
            console.warn('ไม่พบลูกค้าที่ตรงกับคำค้นหา');
            customerOptions.value = [];
        }
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการค้นหาลูกค้า:', error);
        customerOptions.value = [];
    } finally {
        isSearching.value = false;
    }
};

// เพิ่มฟังก์ชันค้นหาพนักงาน
const filterEmployees = async (event) => {
    try {
        isSearchingEmployee.value = true;

        // ดึงค่าที่ผู้ใช้พิมพ์ค้นหาจาก event
        const searchTerm = getFilterValue(event);

        // ถ้าข้อความค้นหาสั้นเกินไป ให้โหลดข้อมูลเริ่มต้น
        if (searchTerm.trim().length < 2) {
            const data = await EmployeeService.getEmployees('', 50);
            if (Array.isArray(data) && data.length > 0) {
                employeeOptions.value = data;
            } else {
                employeeOptions.value = [];
            }
            return;
        }

        // เพิ่มการจำกัดจำนวนผลลัพธ์ที่จะแสดง
        const data = await EmployeeService.getEmployees(searchTerm, 100);
        if (Array.isArray(data) && data.length > 0) {
            employeeOptions.value = data;
        } else {
            console.warn('ไม่พบพนักงานที่ตรงกับคำค้นหา');
            employeeOptions.value = [];
        }
    } catch (error) {
        console.error('เกิดข้อผิดพลาดในการค้นหาพนักงาน:', error);
        employeeOptions.value = [];
    } finally {
        isSearchingEmployee.value = false;
    }
};
// Computed property to determine if the form should be shown
const showLoginForm = computed(() => {
    return !showCustomerSearch.value && !showEmployeeSelection.value;
});

const loginTitle = computed(() => {
    if (showCustomerSearch.value) return t('authPage.selectCustomer');
    if (showEmployeeSelection.value) return t('authPage.selectEmployee');
    return userType.value === 'employee' ? t('auth.employeeLogin') : t('auth.customerLogin');
});

const loginStatusText = computed(() => {
    if (showCustomerSearch.value) return t('authPage.selectCustomerHint');
    if (showEmployeeSelection.value) return t('authPage.selectEmployeeHint');
    return userType.value === 'employee' ? t('authPage.employeeLoginHint') : t('authPage.customerLoginHint');
});

const goToStorefront = () => {
    router.push('/');
};

/// logout function
const logout = () => {
    authenStore.logout();
    showCustomerSearch.value = false;
    showEmployeeSelection.value = false;
    selectedCustomer.value = null;
    selectedEmployee.value = null;
    isConfirmingCustomer.value = false;
    isConfirmingEmployee.value = false;

    // ไม่ลบข้อมูลที่จดจำไว้ เพื่อให้สามารถล็อกอินได้ง่ายในครั้งถัดไป
    // เฉพาะดึงข้อมูลที่บันทึกไว้มาใส่ในฟอร์ม
    const savedUserType = localStorage.getItem('_savedUserType');
    const savedUsername = localStorage.getItem('_savedUsername');

    if (savedUserType && savedUsername) {
        userType.value = savedUserType === 'employee' && !allowStaffLogin.value ? 'customer' : savedUserType;
        username.value = savedUsername;
        localStorage.removeItem('_savedPassword');
        password.value = '';
        rememberMe.value = localStorage.getItem('_rememberMe') === 'true';
    } else {
        username.value = '';
        password.value = '';
        rememberMe.value = false;
    }

    authenStore.loginErrorMsg = '';
    skipEmployeeSelection.value = false;
};

// Add LINE contact URL if not already defined
const lineContactUrl = ref(import.meta.env.VITE_APP_LINE_URL || '#');
</script>
<template>
    <div class="auth-shell min-h-screen">
        <div class="auth-bg-shape shape-a"></div>
        <div class="auth-bg-shape shape-b"></div>
        <div class="auth-bg-shape shape-c"></div>

        <div class="auth-container">
            <section class="auth-card-wrap">
                <div class="auth-card">
                    <Button icon="pi pi-arrow-left" :label="t('common.backToStore')" severity="secondary" text class="back-store-btn" @click="goToStorefront" />

                    <div class="auth-header text-center mb-5">
                        <img :src="getLogoPath" :alt="displayCompanyName" class="auth-logo" />
                        <h2 class="auth-title">{{ loginTitle }}</h2>
                        <p class="auth-status">{{ loginStatusText }}</p>
                    </div>

                    <div v-if="showCustomerSearch" class="selection-section">
                        <div v-if="isSearching && customerOptions.length === 0" class="loading-state">
                            <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="4" />
                        </div>

                        <label for="customer-selection" class="field-label">{{ t('authPage.searchCustomer') }}</label>
                        <Select
                            inputId="customer-selection"
                            v-model="selectedCustomer"
                            :options="customerOptions"
                            optionLabel="name"
                            dataKey="code"
                            :placeholder="t('authPage.selectCustomer')"
                            :aria-label="t('authPage.searchCustomer')"
                            class="w-full"
                            :loading="isSearching"
                            filter
                            :filterFields="['code', 'name']"
                            @filter="filterCustomers"
                            :filterPlaceholder="t('authPage.customerSearchPlaceholder')"
                            :showClear="true"
                            overlayClass="auth-select-overlay"
                            :overlayStyle="{ maxWidth: 'min(34rem, calc(100vw - 1rem))' }"
                            :emptyMessage="t('authPage.noCustomerFound')"
                            :emptyFilterMessage="t('authPage.noCustomerMatch')"
                        >
                            <template #value="slotProps">
                                <div v-if="slotProps.value" class="select-value-row">
                                    <i class="pi pi-user mr-2 text-primary"></i>
                                    <div class="select-text-truncate">{{ slotProps.value.code ? slotProps.value.code : '' }} {{ slotProps.value.name ? slotProps.value.name : '' }}</div>
                                </div>
                                <span v-else>{{ slotProps.placeholder }}</span>
                            </template>
                            <template #option="slotProps">
                                <div class="select-option-row" v-if="slotProps && slotProps.option">
                                    <div class="font-bold select-text-truncate">{{ slotProps.option.code }}</div>
                                    <div class="select-text-truncate">{{ slotProps.option.name }}</div>
                                </div>
                            </template>
                        </Select>
                        <small class="hint-text">{{ t('authPage.searchHint') }}</small>

                        <div v-if="selectedCustomer" class="detail-card mt-4">
                            <div class="detail-head"><i class="pi pi-user-edit"></i> {{ t('authPage.customerInfo') }}</div>
                            <div class="detail-row"><span>{{ t('common.code') }}</span><strong>{{ selectedCustomer.code }}</strong></div>
                            <div class="detail-row"><span>{{ t('common.name') }}</span><strong>{{ selectedCustomer.name }}</strong></div>
                            <div class="detail-row" v-if="selectedCustomer.tax_id"><span>{{ t('authPage.taxId') }}</span><strong>{{ selectedCustomer.tax_id }}</strong></div>
                            <div class="detail-row"><span>{{ t('authPage.address') }}</span><strong>{{ selectedCustomer.address }}</strong></div>
                            <div class="action-row mt-3">
                                <Button icon="pi pi-times" :label="t('common.cancel')" severity="secondary" outlined class="w-full" :disabled="isConfirmingCustomer" @click="selectedCustomer = null" />
                                <Button icon="pi pi-check" :label="t('authPage.useCustomer')" severity="success" class="w-full" :loading="isConfirmingCustomer" :disabled="isConfirmingCustomer" @click="confirmCustomerSelection" />
                            </div>
                        </div>

                        <Button :label="t('nav.logout')" icon="pi pi-sign-out" severity="secondary" outlined class="w-full mt-4" :disabled="isConfirmingCustomer" @click="logout()" />
                    </div>

                    <div v-if="showEmployeeSelection" class="selection-section">
                        <div v-if="isSearchingEmployee && employeeOptions.length === 0" class="loading-state">
                            <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="4" />
                        </div>

                        <label for="employee-selection" class="field-label">{{ t('authPage.selectEmployee') }}</label>
                        <Select
                            inputId="employee-selection"
                            v-model="selectedEmployee"
                            :options="employeeOptions"
                            optionLabel="name"
                            dataKey="code"
                            :placeholder="t('authPage.selectEmployee')"
                            :aria-label="t('authPage.selectEmployee')"
                            class="w-full"
                            :loading="isSearchingEmployee"
                            filter
                            :filterFields="['code', 'name']"
                            @filter="filterEmployees"
                            :filterPlaceholder="t('authPage.employeeSearchPlaceholder')"
                            :showClear="true"
                            overlayClass="auth-select-overlay"
                            :overlayStyle="{ maxWidth: 'min(34rem, calc(100vw - 1rem))' }"
                            :emptyMessage="t('authPage.noEmployeeFound')"
                            :emptyFilterMessage="t('authPage.noEmployeeMatch')"
                        >
                            <template #value="slotProps">
                                <div v-if="slotProps.value" class="select-value-row">
                                    <i class="pi pi-user mr-2 text-primary"></i>
                                    <div class="select-text-truncate">{{ slotProps.value.code ? slotProps.value.code : '' }} {{ slotProps.value.name ? slotProps.value.name : '' }}</div>
                                </div>
                                <span v-else>{{ slotProps.placeholder }}</span>
                            </template>
                            <template #option="slotProps">
                                <div class="select-option-row" v-if="slotProps && slotProps.option">
                                    <div class="font-bold select-text-truncate">{{ slotProps.option.code }}</div>
                                    <div class="select-text-truncate">{{ slotProps.option.name }}</div>
                                </div>
                            </template>
                        </Select>
                        <small class="hint-text">{{ t('authPage.searchHint') }}</small>

                        <div v-if="selectedEmployee" class="detail-card mt-4">
                            <div class="detail-head"><i class="pi pi-id-card"></i> {{ t('authPage.employeeInfo') }}</div>
                            <div class="detail-row"><span>{{ t('common.code') }}</span><strong>{{ selectedEmployee.code }}</strong></div>
                            <div class="detail-row"><span>{{ t('common.name') }}</span><strong>{{ selectedEmployee.name }}</strong></div>
                            <div class="action-row mt-3">
                                <Button icon="pi pi-times" :label="t('common.cancel')" severity="secondary" outlined class="w-full" :disabled="isConfirmingEmployee" @click="selectedEmployee = null" />
                                <Button icon="pi pi-check" :label="t('authPage.useEmployee')" severity="success" class="w-full" :loading="isConfirmingEmployee" :disabled="isConfirmingEmployee" @click="confirmEmployeeSelection" />
                            </div>
                        </div>

                        <Button :label="t('authPage.skipEmployee')" icon="pi pi-step-forward" severity="success" outlined class="w-full mt-4" :loading="isConfirmingEmployee && !selectedEmployee" :disabled="isConfirmingEmployee" @click="skipEmployeeSelectionFn" />
                        <Button :label="t('nav.logout')" icon="pi pi-sign-out" severity="secondary" outlined class="w-full mt-3" :disabled="isConfirmingEmployee" @click="logout()" />
                    </div>

                    <div v-if="showLoginForm">
                        <form @submit="doLogin" class="form-stack">
                            <label for="user-code" class="field-label">{{ t('authPage.code') }}</label>
                            <InputText
                                id="user-code"
                                type="text"
                                :placeholder="t('authPage.code')"
                                class="w-full"
                                v-model="username"
                                autocomplete="username"
                            />

                            <label for="password1" class="field-label">{{ t('authPage.password') }}</label>
                            <Password inputId="password1" v-model="password" :placeholder="t('authPage.password')" :toggleMask="true" fluid :feedback="false" autocomplete="current-password" />

                            <div class="remember-row">
                                <div class="flex items-center">
                                    <Checkbox v-model="rememberMe" id="rememberMe" binary class="mr-2"></Checkbox>
                                    <label for="rememberMe" class="text-sm">{{ t('authPage.rememberMe') }}</label>
                                </div>
                            </div>

                            <transition name="slide-fade">
                                <div v-if="authenStore.loginErrorMsg" class="error-box" role="alert" aria-live="assertive">
                                    <i class="pi pi-exclamation-triangle"></i>
                                    <span>{{ authenStore.loginErrorMsg }}</span>
                                </div>
                            </transition>

                            <Button :label="userType === 'customer' ? t('authPage.loginAndShop') : t('authPage.employeeLoginButton')" icon="pi pi-sign-in" class="w-full login-btn" type="submit" :loading="authenStore.loading" :disabled="authenStore.loading" />

                        </form>
                    </div>

                    <a v-if="lineContactUrl !== '#'" :href="lineContactUrl" target="_blank" rel="noopener" class="line-wrap">
                        <p class="line-caption">{{ t('authPage.lineCaption') }}</p>
                        <img src="../../../assets/line.png" alt="LINE Contact" class="line-image" />
                    </a>
                    <div v-else class="line-wrap">
                        <p class="line-caption">{{ t('authPage.lineCaption') }}</p>
                        <img src="../../../assets/line.png" alt="LINE Contact" class="line-image" />
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
:root {
    --auth-bg-main: #f5fbff;
    --auth-text-main: #0f172a;
}

.auth-shell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 1.25rem;
    background:
        radial-gradient(circle at 12% 18%, #9be7ff 0%, transparent 40%),
        radial-gradient(circle at 82% 8%, #ffd780 0%, transparent 36%),
        radial-gradient(circle at 78% 82%, #d2b6ff 0%, transparent 30%),
        linear-gradient(155deg, #f7fcff 0%, #ecf5ff 52%, #fffaf1 100%);
    font-family: 'Kanit', 'Sarabun', 'Noto Sans Thai', sans-serif;
}

.auth-bg-shape {
    position: absolute;
    border-radius: 999px;
    filter: blur(40px);
    opacity: 0.4;
    pointer-events: none;
}

.shape-a {
    width: 15rem;
    height: 15rem;
    left: -3rem;
    top: 12%;
    background: #00d4ff;
}

.shape-b {
    width: 18rem;
    height: 18rem;
    right: -4rem;
    top: 10%;
    background: #ff9f66;
}

.shape-c {
    width: 17rem;
    height: 17rem;
    right: 22%;
    bottom: -6rem;
    background: #a78bfa;
}

.auth-container {
    width: min(34rem, 100%);
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
}

.auth-card-wrap {
    display: flex;
    justify-content: center;
}

.auth-card {
    width: 100%;
    max-width: 34rem;
    border-radius: 1.5rem;
    padding: 1.1rem 1.25rem 1.25rem;
    background: rgba(255, 255, 255, 0.82);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.6);
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.13);
}

.back-store-btn {
    margin: -0.25rem 0 0.35rem -0.4rem;
    color: #475569;
}

.auth-header {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.auth-logo {
    display: block;
    width: min(180px, 70%);
    height: 112px;
    object-fit: contain;
    margin: 0 auto;
}

.auth-title {
    margin: 0.85rem 0 0.3rem;
    font-size: 1.45rem;
    font-weight: 700;
    color: #0f172a;
}

.auth-status {
    margin: 0;
    font-size: 0.9rem;
    color: #475569;
    line-height: 1.55;
}

.field-label {
    display: block;
    margin: 0.85rem 0 0.4rem;
    font-weight: 600;
    color: #0f172a;
}

.form-stack {
    display: grid;
    gap: 0.15rem;
}

.remember-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.8rem;
    margin-bottom: 0.8rem;
}

.error-box {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
    padding: 0.65rem 0.8rem;
    border-radius: 0.7rem;
    border: 1px solid #fecaca;
    background: #fff1f2;
    color: #be123c;
    font-size: 0.88rem;
}

.login-btn {
    margin-top: 0.9rem;
    border-radius: 0.85rem;
    background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
    border: none;
    box-shadow: 0 10px 18px rgba(37, 99, 235, 0.26);
}

.selection-section {
    display: grid;
    gap: 0.45rem;
    min-width: 0;
}

.selection-section :deep(.p-select),
.selection-section :deep(.p-select-label),
.selection-section :deep(.p-select-overlay),
.selection-section :deep(.p-select-list-container),
.selection-section :deep(.p-select-option) {
    min-width: 0;
    max-width: 100%;
}

.selection-section :deep(.p-select-label) {
    overflow: hidden;
}

.select-value-row {
    display: flex;
    align-items: center;
    min-width: 0;
    max-width: 100%;
}

.select-option-row {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
}

.select-text-truncate {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

:global(.auth-select-overlay) {
    max-width: min(34rem, calc(100vw - 1rem)) !important;
    overflow-x: hidden;
}

:global(.auth-select-overlay .p-select-list-container),
:global(.auth-select-overlay .p-select-list),
:global(.auth-select-overlay .p-select-option),
:global(.auth-select-overlay .select-option-row),
:global(.auth-select-overlay .select-text-truncate) {
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
}

:global(.auth-select-overlay .p-select-option) {
    white-space: normal;
}

:global(.auth-select-overlay .select-text-truncate) {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.loading-state {
    display: flex;
    justify-content: center;
    padding: 0.8rem 0;
}

.hint-text {
    display: inline-block;
    margin-top: 0.4rem;
    color: #64748b;
}

.detail-card {
    border: 1px solid #dbeafe;
    border-radius: 0.95rem;
    padding: 0.9rem;
    background: linear-gradient(180deg, #f8fbff 0%, #f1f8ff 100%);
}

.detail-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #0c4a6e;
    font-weight: 700;
    margin-bottom: 0.55rem;
}

.detail-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.4rem 0;
    border-bottom: 1px dashed #c7ddff;
    font-size: 0.9rem;
}

.detail-row:last-child {
    border-bottom: none;
}

.detail-row span {
    color: #334155;
}

.detail-row strong {
    color: #0f172a;
    text-align: right;
    overflow-wrap: anywhere;
}

.action-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
}

.line-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin-top: 1rem;
}

.login-type-buttons :deep(.p-togglebutton),
.login-type-buttons :deep(.p-button) {
    min-width: 7rem;
}

.line-caption {
    margin: 0 0 0.5rem;
    color: #0f172a;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: center;
}

.line-image {
    width: 12rem;
    max-width: 70%;
    border-radius: 0.85rem;
    box-shadow: 0 12px 20px rgba(15, 23, 42, 0.1);
}

.slide-fade-enter-active,
.slide-fade-leave-active {
    transition: all 0.24s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
    opacity: 0;
    transform: translateY(-6px);
}

@media (min-width: 960px) {
    .auth-card {
        padding: 1.6rem;
    }

    .action-row {
        grid-template-columns: 1fr 1fr;
    }
}

@media (max-width: 420px) {
    .auth-shell {
        padding: 0.65rem;
        align-items: flex-start;
    }

    .auth-card {
        padding: 1rem;
        border-radius: 1rem;
    }

    .auth-logo {
        width: min(160px, 76%);
        height: 96px;
    }

    .auth-title {
        font-size: 1.25rem;
    }

    .detail-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.15rem;
    }

    .detail-row strong {
        text-align: left;
    }

    .line-wrap {
        display: none;
    }
}
</style>
