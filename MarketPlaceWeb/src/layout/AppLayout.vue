<script setup>
// นำเข้าคอมโพเนนต์ส่วนประกอบของเลย์เอาท์
import AppTopbar from './AppTopbar.vue';
import ContentService from '@/services/ContentService';
import { onMounted } from 'vue';

// ⚠️ ต้องตรงกับ styles.scss (:root) และ Landing.vue (fallbackContent.theme) เป๊ะทั้ง 3 ที่
const defaultTheme = {
    preset: 'cleanGreen',
    basePreset: 'cleanGreen',
    primaryColor: '#0f9f6e',
    accentColor: '#f97316',
    headerBackground: '#ffffff',
    headerTextColor: '#064e3b',
    backgroundColor: '#f7f9f8',
    productCardBackground: '#ffffff',
    productImageBackground: '#ffffff',
    productCardBorder: '#dde8e3',
    footerBackground: '#ffffff',
    footerTextColor: '#1f2937'
};

function isColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

// ── ประกันว่าข้อความบนแถบหัวอ่านออกเสมอ ────────────────────────────────
//
// สีพื้นหัวกับสีข้อความหัวเป็นคนละฟิลด์ในหน้าแอดมิน แอดมินจึงเลือกคู่ที่กลืนกันได้
// (เช่นข้อความขาวบนหัวขาว) แล้วชื่อร้านจะหายไปเลย
// ถ้าคู่ที่เลือกมา contrast ต่ำกว่าเกณฑ์ ให้สลับเป็นดำหรือขาวตามความสว่างของพื้นแทน
const WCAG_AA_NORMAL_TEXT = 4.5;

function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relativeLuminance([r, g, b]) {
    const channel = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
    const l1 = relativeLuminance(a);
    const l2 = relativeLuminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// เรียงจาก "สวยที่สุด" ไป "อ่านออกที่สุด" — ดำสนิท/ขาวสนิทเก็บไว้เป็นไม้ตาย
// เพราะพื้นโทนกลางอย่างเทา #808080 ตัวอักษร #111827 ได้แค่ 4.49 (ขาดไป 0.008)
// แต่ดำสนิทได้ 5.32
const TEXT_CANDIDATES = ['#111827', '#FFFFFF', '#000000'];

function readableTextOn(background, preferred) {
    if (!isColor(background)) return preferred;
    const bg = hexToRgb(background);

    // ไม่ใช้เกณฑ์ความสว่าง 0.5 ตัดสินว่าพื้น "เข้ม/สว่าง" เพราะสีโทนกลางอย่างส้ม #F97316
    // ความสว่าง 0.40 (นับเป็นเข้ม → เลือกขาว) แต่ขาวบนส้มได้แค่ 2.80 — เทียบตัวเลขตรงๆ แทน
    const candidates = [preferred, ...TEXT_CANDIDATES].filter(isColor);
    const scored = candidates.map((color) => ({ color, ratio: contrastRatio(hexToRgb(color), bg) }));

    const firstPassing = scored.find((c) => c.ratio >= WCAG_AA_NORMAL_TEXT);
    if (firstPassing) return firstPassing.color;

    // ไม่มีตัวไหนผ่านเกณฑ์ (พื้นโทนกลางจัดๆ) — เอาตัวที่อ่านออกที่สุดเท่าที่มี
    return scored.reduce((best, c) => (c.ratio > best.ratio ? c : best)).color;
}

function applyTheme(theme = {}) {
    const merged = { ...defaultTheme, ...theme };
    const root = document.documentElement;
    // ไม่แก้ค่าที่แอดมินบันทึกไว้ — แค่ไม่ใช้ค่านั้นตอนวาดถ้ามันอ่านไม่ออก
    const headerText = readableTextOn(merged.headerBackground, merged.headerTextColor);
    const pairs = {
        '--market-primary': merged.primaryColor,
        '--market-accent': merged.accentColor,
        '--market-header-bg': merged.headerBackground,
        '--market-header-text': headerText,
        '--market-page-bg': merged.backgroundColor,
        '--market-card-bg': merged.productCardBackground,
        // เดิมตกหล่นคีย์นี้ ทำให้พื้นหลังรูปสินค้าที่แอดมินตั้งไว้ไม่มีผลกับหน้าแคตตาล็อก
        // (Landing.vue เซ็ตให้ ทำให้ค่าค้างข้ามหน้าแบบเดาไม่ได้)
        '--market-product-image-bg': merged.productImageBackground,
        '--market-card-border': merged.productCardBorder,
        '--market-footer-bg': merged.footerBackground,
        '--market-footer-text': merged.footerTextColor,
        '--market-text': merged.footerTextColor,
        '--market-surface': merged.productCardBackground,
        '--market-border': merged.productCardBorder,
        '--p-primary-color': merged.primaryColor,
        '--p-button-primary-background': merged.primaryColor,
        '--p-button-primary-border-color': merged.primaryColor,
        '--p-button-primary-hover-background': merged.primaryColor,
        '--p-button-primary-hover-border-color': merged.primaryColor,
        '--p-button-outlined-primary-color': merged.primaryColor,
        '--p-button-outlined-primary-border-color': merged.primaryColor,
        '--primary-color': merged.primaryColor
    };

    Object.entries(pairs).forEach(([key, value]) => {
        if (isColor(value)) root.style.setProperty(key, value);
    });
}

onMounted(async () => {
    applyTheme(defaultTheme);
    try {
        const home = await ContentService.getHomeContent();
        applyTheme(home?.theme || defaultTheme);
    } catch (error) {
        console.warn('Unable to load marketplace theme:', error);
    }
});
</script>

<template>
    <div class="layout-wrapper layout-no-sidebar">
        <!-- ส่วนหัวของแอป -->
        <app-topbar></app-topbar>

        <!-- คอนเทนเนอร์หลัก -->
        <div class="layout-main-container">
            <!-- พื้นที่หลักสำหรับแสดงหน้าต่างๆ -->
            <div class="layout-main">
                <!-- key เป็น path ไม่ใช่ fullPath: ถ้าใช้ fullPath ทุกครั้งที่ query เปลี่ยน
                     (เช่น พิมพ์ค้นหาแล้วเขียน ?q= ลง URL) หน้าจะถูก unmount/mount ใหม่ทั้งตัว
                     → สินค้าโหลดใหม่หมด ราคาที่โหลดแล้วหาย timer auto-refresh รีเซ็ต
                     หน้าที่อ่าน query ในนี้ (Catalog, ProductList) มี watch รับการเปลี่ยนอยู่แล้ว
                     ส่วน /auth/login อยู่นอก AppLayout จึงไม่ได้รับผลจาก key ตัวนี้ -->
                <router-view :key="$route.path" />
            </div>

            <!-- ส่วนท้ายของแอป -->
            <!-- <app-footer></app-footer> -->
        </div>
    </div>

    <!-- คอมโพเนนต์แสดงการแจ้งเตือน -->
    <Toast />
    <ConfirmDialog />
</template>

<style scoped>
.layout-no-sidebar :global(.layout-main-container) {
    margin-left: 0 !important;
    /* clamp แทน media query — !important ยังต้องมีเพราะ _main.scss ใช้ padding แบบ shorthand
       ซึ่งจะรีเซ็ตค่าที่ตั้งไว้ตรงนี้ทิ้ง */
    padding-left: clamp(0.4rem, 0.8vw, 0.65rem) !important;
    /* ต้องมี !important เหมือนฝั่งซ้าย ไม่งั้น shorthand ของ _main.scss ชนะ
       แล้วขอบซ้าย-ขวาไม่เท่ากัน (วัดจริงได้ 5.6px vs 7px) */
    padding-right: clamp(0.4rem, 0.8vw, 0.65rem) !important;
}

.layout-no-sidebar :global(.layout-main) {
    width: min(1380px, 100%);
    margin: 0 auto;
}
</style>
