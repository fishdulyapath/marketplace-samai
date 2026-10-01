<script setup>
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { useLanguageStore } from '@/stores/languageStore';

defineProps({
    addressType: String,
    currentAddress: String,
    currentTelephone: String,
    customAddress: String,
    customTelephone: String,
    loading: Boolean,
    loadError: Boolean,
    issue: String
});
const emit = defineEmits(['select-type', 'set-address', 'set-telephone', 'retry']);
const { t } = useLanguageStore();
</script>

<template>
    <fieldset class="mb-4 min-w-0" :aria-busy="loading">
        <legend class="font-medium mb-2">{{ t('reviewOrder.selectDeliveryAddress') }}</legend>
        <p v-if="loading" role="status" class="text-sm text-color-secondary mb-2">กำลังดึงที่อยู่และเบอร์โทรศัพท์ลูกค้า…</p>
        <div v-if="loadError" role="status" class="text-sm text-orange-700 mb-2">
            ดึงข้อมูลลูกค้าไม่สำเร็จ กรุณาตรวจสอบหรือกรอกที่อยู่และเบอร์โทรศัพท์
            <button type="button" class="underline ml-1" @click="emit('retry')">ลองใหม่</button>
        </div>
        <div class="flex flex-col gap-3">
            <label v-if="currentAddress" class="p-3 border rounded-lg cursor-pointer" :class="addressType === 'current' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30' : 'border-surface-200 dark:border-surface-700'">
                <span class="flex items-center gap-2 font-medium mb-1">
                    <input type="radio" name="delivery-address-type" value="current" :checked="addressType === 'current'" @change="emit('select-type', 'current')" />
                    {{ t('reviewOrder.useCurrentAddress') }}
                </span>
                <span class="block whitespace-pre-line break-words text-color-secondary">{{ currentAddress }}</span>
                <span class="block text-color-secondary mt-1">{{ t('reviewOrder.phoneLabel') }} {{ currentTelephone || t('reviewOrder.notSpecified') }}</span>
            </label>
            <div class="p-3 border rounded-lg" :class="addressType === 'custom' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30' : 'border-surface-200 dark:border-surface-700'">
                <label class="flex items-center gap-2 font-medium mb-3 cursor-pointer">
                    <input type="radio" name="delivery-address-type" value="custom" :checked="addressType === 'custom'" @change="emit('select-type', 'custom')" />
                    {{ t('reviewOrder.customAddressTitle') }}
                </label>
                <label class="block mb-3">
                    <span class="block text-sm mb-1">{{ t('reviewOrder.deliveryAddress') }} <span class="text-red-500">*</span></span>
                    <Textarea :model-value="customAddress" @update:model-value="emit('set-address', $event)" rows="3" class="w-full" :placeholder="t('reviewOrder.deliveryAddressPlaceholder')" :disabled="addressType !== 'custom'" :aria-label="t('reviewOrder.deliveryAddress')" :invalid="issue === 'requireDeliveryAddress'" autocomplete="street-address" />
                </label>
                <label class="block">
                    <span class="block text-sm mb-1">{{ t('reviewOrder.phone') }} <span class="text-red-500">*</span></span>
                    <InputText :model-value="customTelephone" @update:model-value="emit('set-telephone', $event)" type="tel" class="w-full" :placeholder="t('reviewOrder.phonePlaceholder')" :disabled="addressType !== 'custom'" :aria-label="t('reviewOrder.phone')" :invalid="issue === 'requireDeliveryPhone'" autocomplete="tel" />
                </label>
                <small class="block text-color-secondary mt-2">ใช้สำหรับคำสั่งซื้อนี้เท่านั้น ไม่เปลี่ยนที่อยู่ในข้อมูลลูกค้า</small>
            </div>
        </div>
        <p v-if="issue === 'requireDeliveryAddress' || issue === 'requireDeliveryPhone'" role="status" class="text-sm text-orange-700 mt-2">{{ t(`reviewOrder.${issue}`) }}</p>
    </fieldset>
</template>
