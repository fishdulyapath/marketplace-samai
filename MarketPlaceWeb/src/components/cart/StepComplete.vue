<script setup>
import { computed, ref } from 'vue';
import lineQrImage from '@/assets/line.png';
import { useLanguageStore } from '@/stores/languageStore';

const props = defineProps({
    orderNumber: {
        type: String,
        default: ''
    },
    orderNumbers: {
        type: Array,
        default: () => []
    },
    orderDocuments: {
        type: Array,
        default: () => []
    },
    orderDate: {
        type: String,
        default: ''
    },
    orderTime: {
        type: String,
        default: ''
    },
    partial: {
        type: Boolean,
        default: false
    },
    preorder: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['go-to-shop', 'review-cart']);
const languageStore = useLanguageStore();
const t = languageStore.t;
const lineContactUrl = ref(import.meta.env.VITE_APP_LINE_URL || '#');
const salePhoneNumber = ref(import.meta.env.VITE_APP_PHONE || '');

// เลขที่เอกสารมาจาก server เท่านั้น — ห้ามสุ่มเลขปลอมให้ลูกค้าเห็น เพราะค้นในระบบไม่เจอ (REQ4)
const displayOrderNumber = ref(props.orderNumber || '');

// Use provided date and time or generate current ones
const displayOrderDate = ref(
    props.orderDate ||
        new Date().toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        })
);

const displayOrderTime = ref(
    props.orderTime ||
        new Date().toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit'
        })
);
const displayOrderNumbers = computed(() => {
    const numbers = Array.isArray(props.orderNumbers) ? props.orderNumbers.filter(Boolean) : [];
    return numbers.length > 0 ? numbers : [displayOrderNumber.value].filter(Boolean);
});
const isPartial = computed(() => props.partial);
const completionTitle = computed(() => (isPartial.value ? t('orderComplete.partialTitle') : t('orderComplete.title')));
const completionSubtitle = computed(() => (isPartial.value ? t('orderComplete.partialHint') : t('orderComplete.subtitle')));
const completionStatusTitle = computed(() => (isPartial.value ? t('orderComplete.partialTitle') : t('orderComplete.successTitle')));
const completionStatusHint = computed(() => (isPartial.value ? t('orderComplete.partialHint') : t('orderComplete.successHint')));
const referenceOrderText = computed(() => displayOrderNumbers.value.join(', ') || displayOrderNumber.value);
const showDocumentList = computed(() => isPartial.value || props.preorder || displayOrderNumbers.value.length > 1);
function getDocumentLabel(type) {
    if (type === 'ready') return t('orderComplete.readyDocument');
    if (type === 'preorder') return t('orderComplete.preorderDocument');
    return t('orderComplete.savedDocument');
}
const documentRows = computed(() => {
    const explicitRows = Array.isArray(props.orderDocuments) ? props.orderDocuments.filter((item) => item?.docNo) : [];
    if (explicitRows.length > 0) {
        return explicitRows.map((item) => ({
            docNo: item.docNo,
            label: getDocumentLabel(item.type),
        }));
    }

    const hasMultipleDocs = displayOrderNumbers.value.length > 1;
    return displayOrderNumbers.value.map((docNo, index) => {
        let label = t('orderComplete.savedDocument');
        if (props.preorder && hasMultipleDocs) {
            label = index === 0 ? t('orderComplete.readyDocument') : t('orderComplete.preorderDocument');
        } else if (props.preorder) {
            label = t('orderComplete.preorderDocument');
        }
        return { docNo, label };
    });
});
</script>

<template>
    <div class="complete-shell">
        <section class="complete-hero">
            <div class="complete-hero-copy">
                <p class="complete-eyebrow">{{ t('orderComplete.eyebrow') }}</p>
                <h2 class="complete-title">{{ completionTitle }}</h2>
                <p class="complete-subtitle">{{ completionSubtitle }}</p>
            </div>

            <div :class="['complete-celebration-card', { 'complete-celebration-card--partial': isPartial }]">
                <div :class="['success-badge', { 'success-badge--partial': isPartial }]">
                    <i :class="[isPartial ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle', 'text-4xl']"></i>
                </div>
                <strong>{{ completionStatusTitle }}</strong>
                <span>{{ completionStatusHint }}</span>
            </div>
        </section>

        <section class="complete-grid">
            <div class="complete-card complete-order-card">
                <div class="complete-order-header">
                    <h3>{{ t('orderComplete.orderInfo') }}</h3>
                    <p>{{ t('orderComplete.keepReference') }}</p>
                </div>

                <div class="complete-order-details">
                    <div class="complete-detail-row">
                        <span class="complete-muted">{{ t('orderComplete.orderNo') }}</span>
                        <strong>{{ referenceOrderText }}</strong>
                    </div>
                    <div class="complete-detail-row">
                        <span class="complete-muted">{{ t('orderComplete.orderDateTime') }}</span>
                        <strong>{{ displayOrderDate }} {{ displayOrderTime }} {{ t('orderComplete.timeSuffix') }}</strong>
                    </div>
                </div>

                <div v-if="showDocumentList" class="complete-doc-list">
                    <span class="complete-muted">{{ t('orderComplete.savedDocuments') }}</span>
                    <div class="complete-doc-pills">
                        <div v-for="row in documentRows" :key="row.docNo" class="complete-doc-pill">
                            <span>{{ row.label }}</span>
                            <strong>{{ row.docNo }}</strong>
                        </div>
                    </div>
                </div>

                <div v-if="isPartial" class="complete-partial-alert">
                    <i class="pi pi-exclamation-triangle"></i>
                    <span>
                        <strong>{{ t('orderComplete.partialTitle') }}</strong>
                        <small>{{ t('orderComplete.partialHint') }}</small>
                    </span>
                </div>

                <div class="complete-highlight-strip">
                    <span>{{ t('orderComplete.referenceReady') }}</span>
                    <strong>{{ referenceOrderText }}</strong>
                </div>
            </div>

            <div class="complete-card complete-inner-card">
                <h3 class="font-bold text-lg mb-3">{{ t('orderComplete.moreInfo') }}</h3>
                <ul class="space-y-3 text-left list-disc pl-5">
                    <li>{{ t('orderComplete.checkStatus') }}</li>
                    <li>{{ t('orderComplete.notifySales', { orderNo: referenceOrderText }) }}</li>
                    <li>{{ t('orderComplete.contactSales') }} {{ salePhoneNumber || '' }}</li>
                </ul>

                <div class="complete-line-contact">
                    <div class="complete-line-copy">
                        <strong>{{ t('orderComplete.lineTitle') }}</strong>
                        <span>{{ t('orderComplete.lineHint') }}</span>
                    </div>
                    <a v-if="lineContactUrl !== '#'" :href="lineContactUrl" target="_blank" rel="noopener" class="complete-line-link">
                        <img :src="lineQrImage" alt="LINE Contact" />
                        <span>เพิ่มเพื่อน LINE</span>
                    </a>
                    <div v-else class="complete-line-link">
                        <img :src="lineQrImage" alt="LINE Contact" />
                        <span>LINE</span>
                    </div>
                </div>
            </div>
        </section>

        <div class="complete-actions">
            <Button v-if="isPartial" :label="t('orderComplete.reviewCart')" icon="pi pi-shopping-cart" @click="emit('review-cart')" />
            <Button :label="t('orderComplete.backToShop')" icon="pi pi-store" :outlined="isPartial" @click="emit('go-to-shop')" />
        </div>
    </div>
</template>

<style scoped>
.complete-shell {
    background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--market-accent, #f97316) 16%, transparent), transparent 24%),
        linear-gradient(180deg, var(--market-card-bg, #fffefb) 0%, var(--market-surface-soft, #fdf9f1) 100%);
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1.5rem;
    padding: 1.5rem;
}

.complete-hero {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(16rem, 0.8fr);
    gap: 1rem;
    margin-bottom: 1rem;
}

.complete-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--market-primary, #b28b46);
    margin-bottom: 0.5rem;
}

.complete-celebration-card,
.complete-card {
    background: var(--market-card-bg, #fffdf8);
    border: 1px solid var(--market-card-border, #efe3c8);
    border-radius: 1.25rem;
    box-shadow: 0 10px 18px var(--market-shadow, rgba(140, 111, 53, 0.08));
}

.complete-celebration-card {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    text-align: center;
}

.complete-celebration-card--partial {
    background: color-mix(in srgb, #f59e0b 10%, var(--market-card-bg, #fffdf8));
    border-color: color-mix(in srgb, #f59e0b 42%, var(--market-card-border, #efe3c8));
}

.success-badge {
    background: var(--market-primary-soft, #f9f2e1);
    color: var(--market-primary, #9a7a38);
    border: 1px solid var(--market-card-border, #ebddbf);
    width: 5rem;
    height: 5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
}

.success-badge--partial {
    background: color-mix(in srgb, #f59e0b 18%, #fff);
    border-color: color-mix(in srgb, #f59e0b 52%, var(--market-card-border, #ebddbf));
    color: #92400e;
}

.complete-title {
    color: var(--market-text, #5b4a27);
    margin: 0;
}

.complete-subtitle {
    color: var(--market-muted, #9b8a67);
    margin-top: 0.5rem;
}

.complete-card {
    padding: 1.25rem;
}

.complete-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    gap: 1rem;
}

.complete-order-header h3 {
    margin: 0;
    color: var(--market-text, #5b4a27);
}

.complete-order-header p {
    margin: 0.3rem 0 0;
    color: var(--market-muted, #9b8a67);
}

.complete-order-details {
    display: grid;
    gap: 0.8rem;
    margin: 1rem 0;
}

.complete-detail-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
}

.complete-highlight-strip {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    padding: 0.9rem 1rem;
    border-radius: 1rem;
    background: var(--market-primary-soft, #f8efd9);
    color: var(--market-primary, #6a5428);
}

.complete-doc-list {
    display: grid;
    gap: 0.55rem;
    margin: 0 0 1rem;
}

.complete-doc-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.complete-doc-pill {
    display: inline-grid;
    gap: 0.1rem;
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    border: 1px solid var(--market-card-border, #ebddbf);
    border-radius: 999px;
    background: var(--market-card-bg, #fffdf8);
    color: var(--market-text, #5b4a27);
    padding: 0.35rem 0.75rem;
    font-size: 0.86rem;
}

.complete-doc-pill span {
    color: var(--market-muted, #9b8a67);
    font-size: 0.72rem;
    font-weight: 800;
}

.complete-partial-alert {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    margin: 0 0 1rem;
    padding: 0.85rem;
    border: 1px solid color-mix(in srgb, #f59e0b 45%, var(--market-card-border, #ebddbf));
    border-radius: 0.9rem;
    background: color-mix(in srgb, #f59e0b 11%, var(--market-card-bg, #fffdf8));
    color: #92400e;
}

.complete-partial-alert i {
    margin-top: 0.15rem;
}

.complete-partial-alert span {
    display: grid;
    gap: 0.2rem;
}

.complete-partial-alert small {
    line-height: 1.45;
}

.complete-inner-card {
    background: var(--market-surface-soft, #fdf7ea);
    border: 1px solid var(--market-card-border, #ebddbf);
}

.complete-line-contact {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    margin-top: 1rem;
    padding: 1rem;
    border: 1px solid color-mix(in srgb, #06c755 22%, var(--market-card-border, #ebddbf));
    border-radius: 1rem;
    background: color-mix(in srgb, #06c755 8%, var(--market-card-bg, #fffdf8));
}

.complete-line-copy {
    display: grid;
    gap: 0.25rem;
}

.complete-line-copy strong {
    color: var(--market-text, #5b4a27);
}

.complete-line-copy span {
    color: var(--market-muted, #9b8a67);
    font-size: 0.9rem;
    line-height: 1.45;
}

.complete-line-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: #049642;
    font-weight: 800;
    text-decoration: none;
}

.complete-line-link img {
    width: 5.25rem;
    height: 5.25rem;
    object-fit: contain;
    border-radius: 0.35rem;
}

.complete-muted {
    color: var(--market-muted, #9b8a67);
}

.complete-actions {
    margin-top: 1.25rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: center;
}

:deep(.complete-shell .p-button:not(.p-button-text):not(.p-button-outlined)) {
    background: linear-gradient(120deg, var(--market-primary, #e6c885) 0%, color-mix(in srgb, var(--market-primary, #d3af67) 74%, var(--market-accent, #f97316)) 100%);
    border-color: var(--market-primary, #d3af67);
    color: var(--market-card-bg, #5b4a27);
}

:deep(.complete-shell .p-button:not(.p-button-text):not(.p-button-outlined):hover) {
    background: linear-gradient(120deg, color-mix(in srgb, var(--market-primary, #ddbf79) 90%, #fff) 0%, var(--market-primary, #c8a45d) 100%);
    border-color: var(--market-primary, #c8a45d);
}

@media (max-width: 900px) {
    .complete-hero,
    .complete-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .complete-shell {
        padding: 1rem;
    }

    .complete-detail-row,
    .complete-highlight-strip {
        flex-direction: column;
        align-items: flex-start;
    }

    .complete-line-contact {
        grid-template-columns: 1fr;
    }

    .complete-line-link {
        justify-content: flex-start;
    }
}
</style>
