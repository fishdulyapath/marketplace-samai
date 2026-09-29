<script setup>
// ── ตัวเพิ่ม/ลดจำนวนที่เขียนลงตะกร้าเอง ──────────────────────────────────
//
// รีวิว 260908 สไลด์ 2: ลูกค้าอยากกด + แล้วสินค้าเข้าตะกร้าเลย ไม่ต้องกด
// "เพิ่มในรถเข็น" อีกครั้ง และกด − แล้วลดในตะกร้าเลยโดยไม่ต้องเปิดหน้าตะกร้า
//
// ตัวคอมโพเนนต์เองเป็น presentational — ไม่รู้จัก store
// ผู้เรียกเป็นคนเอา modelValue ที่ emit ออกไปเขียนลง cartStore
// (การ์ดสินค้าถูกใช้ในหน้าที่มี auth/แหล่งข้อมูลต่างกัน ดูกฎที่หัว ProductCard.vue)
//
// 🚨 ทำไมต้อง debounce: กด + รัวๆ 9 ครั้งต้องยิง API ครั้งเดียวเป็น qty=9
//    ไม่ใช่ 9 ครั้ง — cartStore.addToCart ตีความ qty เป็นจำนวนใหม่แบบสัมบูรณ์
//    (cartStore.js:389) การส่งค่าสุดท้ายค่าเดียวจึงถูกต้องอยู่แล้ว
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
    // จำนวนที่อยู่ในตะกร้าจริง — ผู้เรียกส่งมาจาก store
    modelValue: { type: [Number, String], default: 0 },
    unitLabel: { type: String, default: '' },
    // เพิ่มได้มากสุดเท่าไร (สต็อกคงเหลือ / โควตาต่อคำสั่งซื้อ) — null = ไม่จำกัด
    max: { type: Number, default: null },
    disabled: { type: Boolean, default: false },
    // กำลังยิง API อยู่ — ผู้เรียกเปิดไว้เพื่อกันกดซ้อน
    busy: { type: Boolean, default: false },
    size: { type: String, default: 'md' },
    decreaseLabel: { type: String, default: '' },
    increaseLabel: { type: String, default: '' },
    inputLabel: { type: String, default: '' },
    // ปุ่ม − ตอน qty = 1 จะกลายเป็นลบออกจากตะกร้า (0) เมื่อเปิดค่านี้
    allowZero: { type: Boolean, default: true }
});

const emit = defineEmits(['update:modelValue', 'commit']);

const DEBOUNCE_MS = 400;

function toQty(value) {
    const num = Math.trunc(Number(String(value ?? '').replace(/,/g, '').trim()));
    return Number.isFinite(num) && num > 0 ? num : 0;
}

// ค่าที่ผู้ใช้เห็นระหว่างที่ยังไม่ commit — แยกจาก modelValue เพื่อให้กดรัวได้ลื่น
const draft = ref(toQty(props.modelValue));
let timer = null;

// modelValue เปลี่ยนจากข้างนอก (โหลดตะกร้าใหม่ / สลับหน่วย) ให้ตามไป
// แต่ห้ามทับ draft ระหว่างที่ยังมี commit ค้างอยู่ ไม่งั้นเลขจะกระพริบกลับ
watch(
    () => props.modelValue,
    (next) => {
        if (timer) return;
        draft.value = toQty(next);
    }
);

const minValue = computed(() => (props.allowZero ? 0 : 1));
const canDecrease = computed(() => !props.disabled && draft.value > minValue.value);
const canIncrease = computed(() => {
    if (props.disabled) return false;
    return props.max === null || draft.value < props.max;
});

function scheduleCommit() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        emit('update:modelValue', draft.value);
        emit('commit', draft.value);
    }, DEBOUNCE_MS);
}

// ผู้เรียกต้อง flush ก่อนเปลี่ยนบริบทของ stepper (เช่น แพ็ค -> ลัง)
// เพื่อให้ commit ยังถูกประมวลผลด้วยหน่วยเดิม ไม่ไหลไปใช้ props/สถานะใหม่
function flushPending() {
    if (!timer) return false;
    clearTimeout(timer);
    timer = null;
    emit('update:modelValue', draft.value);
    emit('commit', draft.value);
    return true;
}

defineExpose({ flushPending });

function setQty(next) {
    const clamped = Math.max(minValue.value, props.max === null ? next : Math.min(next, props.max));
    if (clamped === draft.value) return;
    draft.value = clamped;
    scheduleCommit();
}

function decrease() {
    if (props.busy || !canDecrease.value) return;
    setQty(draft.value - 1);
}

function increase() {
    if (props.busy || !canIncrease.value) return;
    setQty(draft.value + 1);
}

function onInput(event) {
    draft.value = toQty(event.target.value);
}

// พิมพ์เองแล้วออกจากช่อง — commit ทันที ไม่ต้องรอ debounce
function onBlur() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    const clamped = Math.max(minValue.value, props.max === null ? draft.value : Math.min(draft.value, props.max));
    draft.value = clamped;
    if (clamped === toQty(props.modelValue)) return;
    emit('update:modelValue', clamped);
    emit('commit', clamped);
}

function onKeydown(event) {
    if (event.key === 'Enter') {
        event.target.blur();
        return;
    }
    // อนุญาตเฉพาะตัวเลขและปุ่มควบคุม
    if (event.key.length === 1 && !/[0-9]/.test(event.key)) event.preventDefault();
}

onBeforeUnmount(() => {
    // ค้าง commit อยู่แล้วคอมโพเนนต์ถูกถอด (ปิด dialog / เปลี่ยนหน้า) → ส่งให้ทันที
    // ไม่งั้นสิ่งที่ผู้ใช้กดไปจะหายเงียบๆ
    flushPending();
});
</script>

<template>
    <div class="cqs" :class="[`cqs--${size}`, { 'cqs--busy': busy }]" :aria-busy="busy" @click.stop>
        <button class="cqs-btn" type="button" :aria-label="decreaseLabel" :aria-disabled="busy || !canDecrease" :disabled="!canDecrease" @click.stop="decrease">
            <i :class="draft === 1 && allowZero ? 'pi pi-trash' : 'pi pi-minus'"></i>
        </button>

        <input
            class="cqs-input"
            type="text"
            inputmode="numeric"
            :value="draft"
            :aria-label="inputLabel"
            :disabled="disabled"
            :readonly="busy"
            @click.stop
            @input="onInput"
            @blur="onBlur"
            @keydown="onKeydown"
        />

        <button class="cqs-btn" type="button" :aria-label="increaseLabel" :aria-disabled="busy || !canIncrease" :disabled="!canIncrease" @click.stop="increase">
            <i class="pi pi-plus"></i>
        </button>

        <span v-if="unitLabel" class="cqs-unit">{{ unitLabel }}</span>
    </div>
</template>

<style scoped>
/* หน้าตาเดียวกับ .spd-qty-* เดิมในหน้ารายละเอียด เพื่อไม่ให้ผู้ใช้รู้สึกว่าเป็นคนละตัว */
.cqs {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.cqs > .cqs-btn:first-of-type,
.cqs-input,
.cqs > .cqs-btn:last-of-type {
    border: 1px solid #d0d0d0;
}

.cqs-btn {
    width: 36px;
    height: 36px;
    background: #f5f5f5;
    cursor: pointer;
    color: #333;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.14s;
    flex: none;
}

.cqs-btn:first-of-type {
    border-radius: 2px 0 0 2px;
    border-right: none;
}

.cqs-btn:last-of-type {
    border-radius: 0 2px 2px 0;
    border-left: none;
}

.cqs-btn:hover:not(:disabled) {
    background: #e8e8e8;
}

.cqs-btn:disabled {
    opacity: 0.4;
    cursor: default;
}

.cqs-input {
    width: 52px;
    text-align: center;
    font-size: 1.05rem;
    font-weight: 500;
    color: #212121;
    outline: none;
    height: 36px;
    background: #fff;
    padding: 0;
    /* ปุ่มสองข้างเป็นคนวาดขอบซ้าย/ขวาให้แล้ว */
    border-radius: 0;
}

.cqs-input:disabled {
    background: #fafafa;
    color: #9e9e9e;
}

.cqs-unit {
    font-size: 0.8rem;
    color: #666;
}

/* ขนาดเล็กสำหรับการ์ดในกริด ซึ่งกว้างแค่ครึ่งจอบนมือถือ */
.cqs--sm .cqs-btn {
    width: 30px;
    height: 30px;
    font-size: 0.75rem;
}

.cqs--sm .cqs-input {
    width: 40px;
    height: 30px;
    font-size: 0.9rem;
}

/* มือถือ: ขยายพื้นที่กดให้ถึงเกณฑ์นิ้วโป้ง (เดิมหน้ารายละเอียดมี media query
   ขยาย .spd-qty-* เป็น 40px อยู่แล้ว ย้ายมาไว้ในคอมโพเนนต์ให้ใช้ได้ทุกที่) */
@media (max-width: 640px) {
    .cqs-btn {
        width: 40px;
        height: 40px;
    }

    .cqs-input {
        width: 56px;
        height: 40px;
        font-size: 1.1rem;
    }

    .cqs--sm .cqs-btn {
        width: 36px;
        height: 36px;
    }

    .cqs--sm .cqs-input {
        width: 46px;
        height: 36px;
    }
}

.cqs--busy {
    pointer-events: none;
}

@media (prefers-color-scheme: dark) {
    .cqs > .cqs-btn:first-of-type,
    .cqs-input,
    .cqs > .cqs-btn:last-of-type {
        border-color: #3f3f46;
    }

    .cqs-btn {
        background: #27272a;
        color: #e4e4e7;
    }

    .cqs-btn:hover:not(:disabled) {
        background: #3f3f46;
    }

    .cqs-input {
        background: #18181b;
        color: #f4f4f5;
    }

    .cqs-input:disabled {
        background: #1f1f23;
        color: #71717a;
    }

    .cqs-unit {
        color: #a1a1aa;
    }
}
</style>
