<script setup>
import PendingOrders from '@/components/orders/PendingOrders.vue';
</script>

<template>
    <main class="p-4 md:p-6">
        <RouterLink to="/admin" class="inline-block mb-4">← จัดการหลังบ้าน</RouterLink>
        <PendingOrders admin />
    </main>
</template>
