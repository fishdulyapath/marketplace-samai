<script setup>
import InputMask from 'primevue/inputmask';

const schedule = defineModel({ type: Object, required: true });
defineProps({ disabled: Boolean });
const weekdays = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
</script>

<template>
    <fieldset class="pickup-settings" :disabled="disabled">
        <div class="rules">
            <label>จองล่วงหน้าได้ (วัน) <input v-model.number="schedule.days_ahead" type="number" min="0" max="365" step="1" required /></label>
            <label>เวลาเตรียมสินค้าสำหรับวันนี้ (ชั่วโมง) <input v-model.number="schedule.lead_hours" type="number" min="0" max="24" step="1" required /></label>
        </div>
        <details v-for="(day, i) in schedule.days" :key="i">
            <summary>วัน{{ weekdays[i] }} · {{ day.enabled ? day.slots.length + ' รอบ' : 'ปิดรับ' }}</summary>
            <label><input v-model="day.enabled" type="checkbox" /> เปิดรับสินค้าวัน{{ weekdays[i] }}</label>
            <template v-if="day.enabled">
                <div v-for="(slot, j) in day.slots" :key="j" class="slot">
                    <InputMask v-model="slot.start" mask="99:99" inputmode="numeric" placeholder="ชั่วโมง:นาที" :aria-label="'เวลาเริ่มรอบที่ ' + (j + 1) + ' แบบ 24 ชั่วโมง'" required />
                    <span>ถึง</span>
                    <InputMask v-model="slot.end" mask="99:99" inputmode="numeric" placeholder="ชั่วโมง:นาที" :aria-label="'เวลาสิ้นสุดรอบที่ ' + (j + 1) + ' แบบ 24 ชั่วโมง'" required />
                    <Button type="button" text severity="danger" icon="pi pi-trash" :aria-label="'ลบรอบที่ ' + (j + 1)" @click="day.slots.splice(j, 1)" />
                </div>
                <Button type="button" size="small" severity="info" label="เพิ่มรอบ" icon="pi pi-plus" @click="day.slots.push({ start: '', end: '' })" />
            </template>
        </details>
    </fieldset>
</template>

<style scoped>
.pickup-settings { min-width: 0; margin: 0; padding: 0; border: 0; }
summary { font-weight: 700; cursor: pointer; padding-block: .3rem; }
.rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: .5rem 1rem; }
.rules label { display: grid; gap: .35rem; }
input:not([type=checkbox]) { width: 100%; min-width: 0; padding: .45rem; border: 1px solid #cbd5e1; border-radius: .4rem; }
details { margin-top: .6rem; border-top: 1px solid #e2e8f0; padding-top: .5rem; }
.slot { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; align-items: center; gap: .4rem; max-width: 27rem; margin-block: .45rem; }
.slot input { box-sizing: border-box; }
.slot button { min-width: 2.5rem; min-height: 2.5rem; }
</style>
