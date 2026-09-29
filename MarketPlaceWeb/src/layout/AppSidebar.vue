<!-- DEAD: not mounted — AppLayout.vue ไม่ import ไฟล์นี้ (เมนูอยู่บน AppTopbar ทั้งหมด)
     ทำให้ AppMenu.vue / AppMenuItem.vue / _menu.scss ที่ต่อจากนี้ตายตามไปด้วย
     ไม่ลบทิ้งเพราะเป็นโครงเดิมของเทมเพลต Sakai ที่อาจต้องใช้ถ้ากลับมาทำ sidebar -->
<script setup>
import AppMenu from './AppMenu.vue';
</script>

<template>
    <div class="layout-sidebar">
        <div class="sidebar-brand">
            <span class="brand-dot"></span>
            <div class="brand-text-wrap">
                <p class="brand-title">Marketplace</p>
                <p class="brand-subtitle">Smart ordering workspace</p>
            </div>
        </div>
        <app-menu></app-menu>
    </div>
</template>

<style lang="scss" scoped>
.sidebar-brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.3rem 0 1rem;
    padding: 0.7rem 0.85rem;
    border-radius: 0.8rem;
    background: linear-gradient(120deg, rgba(226, 238, 255, 0.72) 0%, rgba(240, 249, 255, 0.68) 100%);
    border: 1px solid rgba(185, 211, 247, 0.8);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.brand-dot {
    width: 0.62rem;
    height: 0.62rem;
    border-radius: 999px;
    background: #1d4ed8;
    box-shadow: 0 0 0 0.25rem rgba(29, 78, 216, 0.16);
}

.brand-text-wrap {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.brand-title,
.brand-subtitle {
    margin: 0;
}

.brand-title {
    font-size: 0.86rem;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: 0.01em;
}

.brand-subtitle {
    font-size: 0.73rem;
    color: #475569;
}

@media (max-width: 991px) {
    .sidebar-brand {
        margin-top: 0;
    }
}

@media (min-width: 992px) and (max-width: 1200px) {
    .sidebar-brand {
        justify-content: center;
        padding-left: 0.55rem;
        padding-right: 0.55rem;
    }

    .brand-title {
        font-size: 0.8rem;
    }
}
</style>
