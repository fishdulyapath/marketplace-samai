<script setup>
import { useIdleLogout } from '@/composables/useIdleLogout';
import { useErpOptionStore } from '@/stores/erpOptionStore';
import { onMounted } from 'vue';

const erpOptionStore = useErpOptionStore();

// ติดที่ root เพราะครอบทุกหน้ารวม /auth/login และ /cart (ซึ่งไม่มี requiresAuth)
// router guard อย่างเดียวไม่พอ
useIdleLogout();

onMounted(() => {
    erpOptionStore.load().catch(() => {});
});
</script>

<template>
    <router-view />
</template>

<style scoped></style>
