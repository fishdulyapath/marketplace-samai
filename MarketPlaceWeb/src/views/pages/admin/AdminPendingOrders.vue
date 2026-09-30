<script setup>
import PendingOrderWorkspace from '@/components/orders/PendingOrderWorkspace.vue';
import { useAuthenStore } from '@/stores/authen';
const auth = useAuthenStore();
</script>

<template>
    <main class="p-2 md:p-4">
        <RouterLink to="/admin" class="inline-block mb-4">← จัดการหลังบ้าน</RouterLink>
        <PendingOrderWorkspace :employee-code="auth.isEmployee ? auth.empCode : ''" />
    </main>
</template>
