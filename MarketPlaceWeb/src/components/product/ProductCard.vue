<script setup>
// ── การ์ดสินค้ากลาง ──────────────────────────────────────────────────────
//
// รวม markup การ์ดที่เคยเขียนซ้ำ 6 ชุด (กริดแคตตาล็อก, สินค้าแนะนำ, โปรโมชัน,
// สินค้าเกี่ยวข้องในหน้ารายละเอียด, การ์ดหน้าแรก) ให้เหลือที่เดียว
// สไตล์ยังอยู่ใน assets/shop-card.scss เหมือนเดิม ไฟล์นี้คุมแค่โครงสร้าง + พฤติกรรม
//
// กฎเหล็ก 2 ข้อ (อย่าละเมิด ไม่งั้นจะพังเป็นลูกโซ่):
//   1. presentational ล้วน — ห้าม import service/store/router ใดๆ
//      การ์ดตัวนี้ถูกใช้ในหน้าที่มี auth/สิทธิ์/แหล่งข้อมูลต่างกัน ถ้าดึง store เข้ามา
//      จะกลายเป็นว่าเปลี่ยนที่นี่ทีเดียวแล้วกระทบทุกหน้าโดยไม่รู้ตัว
//   2. ห้ามคำนวณหรือ format ราคาเอง — ส่งเข้ามาทาง <slot name="price">
//      เพราะแต่ละหน้ามี formatPrice() คนละตัว (บางที่รับ product ทั้งก้อน
//      บางที่รับ product.price) และมีสถานะ loading/error ของราคาต่างกัน
//
// ปุ่มหัวใจ/ไอคอนคืนสินค้า วางผ่าน <slot name="media"> เพราะเป็น interactive
// ที่ต้อง @click.stop เอง — การ์ดไม่ควรรู้จักตรรกะ favorite
import { ref, watch } from 'vue';

const props = defineProps({
    // ชื่อที่แสดง — ผู้เรียกแปลง/เลือกภาษามาให้แล้ว (getProductDisplayName)
    name: { type: String, default: '' },
    image: { type: String, default: '' },
    // รูปสำรองเมื่อโหลดรูปหลักไม่ได้ (ปกติคือ PRODUCT_IMAGE_PLACEHOLDER)
    fallbackImage: { type: String, default: '' },
    // grid = การ์ดในกริด · rail = การ์ดในแถวเลื่อนแนวนอน · mini = การ์ดเล็กใต้หน้ารายละเอียด
    variant: { type: String, default: 'grid' },
    lazy: { type: Boolean, default: true },
    ariaLabel: { type: String, default: '' },
    // ชื่อสินค้ามัก clamp 2 บรรทัด tooltip จึงช่วยให้อ่านชื่อเต็มได้บนเดสก์ท็อป
    tooltip: { type: Boolean, default: true }
});

const emit = defineEmits(['select']);

// สลับไปรูปสำรองเมื่อ error — เก็บเป็น state แทนการเขียน $event.target.src ตรงๆ
// เพราะถ้ารูปสำรองพังด้วยจะเข้าลูป error ไม่รู้จบ (เดิมทุกหน้าเขียนแบบนั้น)
const failed = ref(false);
watch(
    () => props.image,
    () => {
        failed.value = false;
    }
);

function onImageError() {
    if (!props.fallbackImage || failed.value) return;
    failed.value = true;
}

function select(event) {
    emit('select', event);
}
</script>

<template>
    <!-- ใช้ div + role=button ไม่ใช่ <button> จริง เพราะการ์ดมีปุ่มหัวใจซ้อนอยู่ข้างใน
         ซึ่ง HTML ห้าม <button> ซ้อน <button> (เบราว์เซอร์จะดึงปุ่มในออกมานอก DOM) -->
    <div
        class="shop-card product-card"
        :class="[`product-card--${variant}`, { 'shop-card--rail': variant === 'rail' }]"
        role="button"
        tabindex="0"
        :aria-label="ariaLabel || name"
        @click="select"
        @keydown.enter.prevent="select"
        @keydown.space.prevent="select"
    >
        <div class="shop-card-media product-card-media">
            <img :src="failed ? fallbackImage : image" :alt="name" :loading="lazy ? 'lazy' : 'eager'" decoding="async" @error="onImageError" />

            <!-- ป้ายสถานะมุมบนซ้าย: โปรโมชัน / พรีออเดอร์ / สินค้าหมด -->
            <div v-if="$slots.badges" class="shop-card-badges">
                <slot name="badges" />
            </div>

            <!-- ทับบนรูปแบบอิสระ: ปุ่มหัวใจ, ไอคอนคืนสินค้า -->
            <slot name="media" />
        </div>

        <div class="shop-card-body">
            <slot name="eyebrow" />

            <div v-if="tooltip" v-tooltip="name" class="shop-card-name">{{ name }}</div>
            <div v-else class="shop-card-name">{{ name }}</div>

            <slot name="price" />
            <slot name="footer" />
        </div>
    </div>
</template>

<style scoped>
.product-card {
    cursor: pointer;
    /* รีเซ็ตค่าที่ติดมาจาก <button>/<div> ของแต่ละหน้า ให้การ์ดหน้าตาเท่ากันทุกที่ */
    padding: 0;
    text-align: left;
    font: inherit;
    color: inherit;
}

.product-card:focus-visible {
    outline: 2px solid var(--market-primary);
    outline-offset: 2px;
}

/* การ์ดเล็กใต้หน้ารายละเอียด — ชื่อบรรทัดเดียวพอ ไม่ต้องจองความสูง 2 บรรทัด */
.product-card--mini :deep(.shop-card-name) {
    font-size: 0.85rem;
    min-height: 2.4em;
}
</style>
