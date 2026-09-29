<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useLanguageStore } from '@/stores/languageStore';

const router = useRouter();
const languageStore = useLanguageStore();
const t = languageStore.t;

// ตัวแปรสถานะ
const isEmployee = ref(false);
const employeeData = ref(null);
const userData = ref(null);
const storeName = ref('');

// ดึงข้อมูลเมื่อคอมโพเนนต์ถูกโหลด
onMounted(() => {
    // ตรวจสอบว่าผู้ใช้เป็นพนักงานหรือไม่
    const userType = localStorage.getItem('_userType');
    isEmployee.value = userType === 'employee';

    // ถ้าผู้ใช้เป็นพนักงาน ให้ดึงข้อมูลพนักงาน
    if (isEmployee.value) {
        const empDataStr = localStorage.getItem('_empData');
        const userDataStr = localStorage.getItem('_userData');

        if (empDataStr) {
            try {
                employeeData.value = JSON.parse(empDataStr);
            } catch (e) {
                console.error('Error parsing employee data:', e);
            }
        }

        if (userDataStr) {
            try {
                userData.value = JSON.parse(userDataStr);
                // ดึงชื่อร้านค้าจากข้อมูลผู้ใช้
                storeName.value = userData.value.user_name || '';
            } catch (e) {
                console.error('Error parsing user data:', e);
            }
        }
    }
});

const changeCustomer = () => {
    router.push({
        path: '/auth/login',
        query: {
            mode: 'employee',
            selectCustomer: '1',
            redirect: '/marketplace'
        }
    });
};
</script>

<template>
    <!-- แสดงข้อมูลพนักงาน -->
    <div v-if="isEmployee && employeeData" class="user-info employee-info">
        <div class="user-profile">
            <i class="pi pi-id-card"></i>
            <div class="user-welcome">
                <span class="welcome-text">{{ t('employeeInfo.helloEmployee') }}</span>
                <span class="user-name">{{ employeeData.user_code }} ~ {{ employeeData.user_name }}</span>
                <span class="welcome-text mt-2">{{ t('employeeInfo.orderingForCustomer') }}</span>
                <span v-if="userData" class="user-name customer-name">{{ userData.user_code }} ~ {{ userData.user_name }}</span>
                <span v-else class="user-name customer-name muted">{{ t('employeeInfo.noCustomer') }}</span>
                <button type="button" class="change-customer-btn" @click="changeCustomer">
                    <i class="pi pi-sync"></i>
                    {{ t('employeeInfo.changeCustomer') }}
                </button>
            </div>
        </div>
    </div>
</template>

<style lang="scss" scoped>
.user-info {
    padding: 1rem;
    margin-bottom: 1rem;
    background-color: var(--surface-card, #ffffff);
    border-radius: 6px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.user-profile {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;

    i {
        font-size: 1.5rem;
        color: var(--primary-color, #3b82f6);
        background-color: var(--primary-50, #eff6ff);
        border-radius: 50%;
        padding: 0.5rem;
    }

    .user-welcome {
        display: flex;
        flex-direction: column;

        .welcome-text {
            font-size: 0.875rem;
            color: var(--text-color-secondary, #6c757d);
        }

        .user-name {
            font-weight: 600;
            color: var(--text-color, #495057);
            line-height: 1.35;
            overflow-wrap: anywhere;
        }

        .customer-name {
            color: #047857;
        }

        .muted {
            color: #b45309;
        }
    }
}

.change-customer-btn {
    margin-top: 0.55rem;
    border: 1px solid #a7f3d0;
    background: #ecfdf5;
    color: #047857;
    border-radius: 0.6rem;
    padding: 0.45rem 0.65rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
}

.change-customer-btn:hover {
    background: #d1fae5;
}
</style>
