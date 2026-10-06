<script setup>
import DatePicker from 'primevue/datepicker';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { useLanguageStore } from '@/stores/languageStore';

defineProps({
    customAddress: String,
    customTelephone: String,
    sendDate: { type: [Date, String], default: null },
    sendDays: { type: Number, default: 0 },
    minDate: { type: Date, default: null },
    dateInputId: { type: String, default: 'send-date' },
    loading: Boolean,
    loadError: Boolean,
    issue: String
});
const emit = defineEmits(['update:sendDate', 'set-address', 'set-telephone', 'retry']);
const { t } = useLanguageStore();
</script>

<template>
    <fieldset class="mb-4 min-w-0" :aria-busy="loading">
        <legend class="font-medium mb-2">{{ t('reviewOrder.deliveryInfo') }}</legend>
        <p v-if="loading" role="status" class="text-sm text-color-secondary mb-2">กำลังดึงที่อยู่และเบอร์โทรศัพท์ลูกค้า…</p>
        <div v-if="loadError" role="status" class="text-sm text-orange-700 mb-2">
            ดึงข้อมูลลูกค้าไม่สำเร็จ กรุณาตรวจสอบหรือกรอกที่อยู่และเบอร์โทรศัพท์
            <button type="button" class="underline ml-1" @click="emit('retry')">ลองใหม่</button>
        </div>
        <div class="confirmation-subcard p-4 rounded-lg space-y-3">
            <div class="grid grid-cols-2 gap-3">
                <label class="block min-w-0">
                    <span class="block text-sm font-medium mb-1">{{ t('reviewOrder.deliveryDate') }}</span>
                    <DatePicker :input-id="dateInputId" :model-value="sendDate" @update:model-value="emit('update:sendDate', $event)" date-format="dd/mm/yy" :min-date="minDate" class="w-full" :placeholder="t('reviewOrder.selectDeliveryDate')" />
                </label>
                <label class="block min-w-0">
                    <span class="block text-sm font-medium mb-1">{{ t('reviewOrder.deliveryDays') }}</span>
                    <InputText :model-value="`${sendDays} ${t('reviewOrder.daySuffix')}`" readonly class="w-full" :aria-label="t('reviewOrder.deliveryDays')" />
                </label>
            </div>
            <label class="block">
                <span class="block text-sm font-medium mb-1">{{ t('reviewOrder.deliveryAddress') }} <span class="text-red-500">*</span></span>
                <Textarea :model-value="customAddress" @update:model-value="emit('set-address', $event)" rows="3" class="w-full" :placeholder="t('reviewOrder.deliveryAddressPlaceholder')" :aria-label="t('reviewOrder.deliveryAddress')" :invalid="issue === 'requireDeliveryAddress'" autocomplete="street-address" />
            </label>
            <label class="block">
                <span class="block text-sm font-medium mb-1">{{ t('reviewOrder.phone') }} <span class="text-red-500">*</span></span>
                <InputText :model-value="customTelephone" @update:model-value="emit('set-telephone', $event)" type="tel" class="w-full" :placeholder="t('reviewOrder.phonePlaceholder')" :aria-label="t('reviewOrder.phone')" :invalid="issue === 'requireDeliveryPhone'" autocomplete="tel" />
            </label>
        </div>
        <p v-if="issue === 'requireDeliveryAddress' || issue === 'requireDeliveryPhone'" role="status" class="text-sm text-orange-700 mt-2">{{ t(`reviewOrder.${issue}`) }}</p>
    </fieldset>
</template>
