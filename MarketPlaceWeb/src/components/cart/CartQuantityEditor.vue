<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useLanguageStore } from '@/stores/languageStore';

const props = defineProps({
    qty: Number, unit: String, name: String, active: Boolean, disabled: Boolean,
    max: { type: Number, default: null }, save: { type: Function, required: true }
});
const emit = defineEmits(['edit', 'close']);
const { t } = useLanguageStore();
const draft = ref('');
const input = ref(null);
const saving = ref(false);
const valid = computed(() => /^\d+$/.test(draft.value) && Number.isSafeInteger(Number(draft.value))
    && Number(draft.value) >= 1 && (props.max === null || Number(draft.value) <= props.max));
watch(() => props.active, async active => {
    if (!active) return;
    draft.value = String(props.qty);
    await nextTick();
    input.value?.select();
});
async function confirm() {
    if (!valid.value || saving.value || props.disabled) return;
    saving.value = true;
    try {
        if (Number(draft.value) === props.qty || await props.save(Number(draft.value)) !== false) emit('close');
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <button v-if="!active" type="button" class="edit" :disabled="disabled"
        :aria-label="[t('cart.editQty'), name, unit, qty].join(' ')" @click="emit('edit')">
        {{ qty }} <i class="pi pi-pencil" />
    </button>
    <div v-else class="controls" @keydown.esc.stop="!saving && emit('close')">
        <button type="button" :disabled="saving || Number(draft) <= 1" :aria-label="t('productDetail.decreaseQuantityAria')" @click="draft = String(Number(draft) - 1)">−</button>
        <input ref="input" v-model="draft" type="text" inputmode="numeric" :disabled="saving" :aria-invalid="!valid"
            :aria-label="t('productDetail.quantityAria') + ' ' + unit" @keydown.enter.prevent="confirm" />
        <button type="button" :disabled="saving || (max !== null && Number(draft) >= max)" :aria-label="t('productDetail.increaseQuantityAria')" @click="draft = String((Number(draft) || 0) + 1)">+</button>
        <button type="button" class="confirm" :aria-label="t('common.confirm')" :disabled="saving || !valid" @click="confirm"><i class="pi pi-check" /></button>
        <button type="button" :aria-label="t('common.cancel')" :disabled="saving" @click="emit('close')"><i class="pi pi-times" /></button>
    </div>
</template>

<style scoped>
.edit,.controls button,.controls input { min-height:40px; border:1px solid var(--market-card-border); border-radius:8px; background:var(--market-card-bg,white); color:inherit; text-align:center; }
.edit { min-width:62px; padding:0 .65rem; }
.edit i { margin-inline-start:.35rem; color:var(--market-muted); }
.controls { display:flex; align-items:center; }
.controls button { min-width:32px; }
.controls input { width:44px; }
.controls .confirm { background:var(--market-primary); color:white; }
button:disabled { opacity:.5; }
</style>
