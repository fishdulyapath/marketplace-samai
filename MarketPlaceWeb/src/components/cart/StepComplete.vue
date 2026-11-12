<script setup>
import { computed } from 'vue';
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
const lineContactUrl = import.meta.env.VITE_APP_LINE_URL;
const salePhoneNumber = import.meta.env.VITE_APP_PHONE;

const documentRows = computed(() => {
    const types = new Map((props.orderDocuments || []).filter(row => row?.docNo).map(row => [row.docNo.trim(), row.type]));
    const saved = (props.orderNumbers || []).filter(Boolean).map(value => value.trim()).filter(Boolean);
    const numbers = [...new Set([...saved, ...types.keys()])];
    if (!numbers.length && props.orderNumber) numbers.push(props.orderNumber);
    return numbers.map((docNo, index) => {
        const type = types.get(docNo) || (props.preorder ? (numbers.length > 1 && index === 0 ? 'ready' : 'preorder') : '');
        const label = type === 'ready' ? 'orderComplete.readyDocument' : type === 'preorder' ? 'orderComplete.preorderDocument' : 'orderComplete.savedDocument';
        return { docNo, label, type };
    });
});
</script>

<template>
    <section class="receipt" :class="{ partial }" aria-labelledby="receipt-title">
        <div class="receipt-main">
            <header class="receipt-status">
                <span class="status-icon" aria-hidden="true"><i :class="partial ? 'pi pi-exclamation-triangle' : 'pi pi-check'"></i></span>
                <div>
                    <h1 id="receipt-title">{{ t(partial ? 'orderComplete.partialTitle' : 'orderComplete.pendingTitle') }}</h1>
                    <p>{{ t(partial ? 'orderComplete.partialHint' : 'orderComplete.pendingHint') }}</p>
                </div>
            </header>

            <div class="reference">
                <template v-if="documentRows.length > 1">
                    <h2>{{ t('orderComplete.savedDocuments') }}</h2>
                    <dl class="document-list">
                        <div v-for="row in documentRows" :key="row.docNo">
                            <dt>{{ t(row.label) }}</dt><dd>{{ row.docNo }}</dd>
                        </div>
                    </dl>
                </template>
                <template v-else-if="documentRows.length">
                    <h2>{{ t('orderComplete.requestNo') }}<small v-if="preorder"> · {{ t(documentRows[0].label) }}</small></h2>
                    <strong class="order-number">{{ documentRows[0].docNo }}</strong>
                </template>
                <div v-if="orderDate || orderTime" class="order-date">
                    <i class="pi pi-calendar" aria-hidden="true"></i>
                    <span>{{ t('orderComplete.orderDateTime') }}</span>
                    <strong>{{ orderDate }} {{ orderTime }} {{ orderTime ? t('orderComplete.timeSuffix') : '' }}</strong>
                </div>
            </div>

            <nav class="receipt-actions">
                <Button v-if="partial" :label="t('orderComplete.reviewCart')" icon="pi pi-shopping-cart" @click="emit('review-cart')" />
                <RouterLink to="/orders-history" class="history-link"><i class="pi pi-file" aria-hidden="true"></i>{{ t('nav.myOrders') }}</RouterLink>
                <Button :label="t('cartPage.continueShopping')" icon="pi pi-shop" :outlined="partial" @click="emit('go-to-shop')" />
            </nav>
        </div>
        <aside class="contact">
            <h2>{{ t('orderComplete.lineTitle') }}</h2>
            <p>{{ t('orderComplete.lineHint') }}</p>
            <div class="line-contact">
                <img :src="lineQrImage" alt="LINE QR" width="96" height="96" />
                <a v-if="lineContactUrl && lineContactUrl !== '#'" :href="lineContactUrl" target="_blank" rel="noopener" class="line-link">
                    LINE <i class="pi pi-external-link" aria-hidden="true"></i>
                </a>
            </div>
            <a v-if="salePhoneNumber" class="phone-link" :href="'tel:' + salePhoneNumber.replace(/[^\d+]/g, '')">
                <i class="pi pi-phone" aria-hidden="true"></i>{{ salePhoneNumber }}
            </a>
        </aside>
    </section>
</template>

<style scoped>
.receipt {
    --status-color: var(--market-primary, #08794e);
    --tint: color-mix(in srgb, var(--status-color) 7%, var(--market-card-bg, white));
    display: grid;
    grid-template-columns: minmax(0, 1.65fr) minmax(13rem, 1fr);
    gap: clamp(1.3rem, 3vw, 3rem);
    max-width: 68rem;
    margin: clamp(.5rem, 2vw, 1.6rem) auto;
    padding: clamp(1rem, 3vw, 2rem);
    border: 1px solid var(--market-card-border);
    border-top: .35rem solid var(--status-color);
    border-radius: 1rem;
    background: var(--market-card-bg, white);
    color: var(--market-text);
    box-shadow: 0 6px 24px rgb(31 54 43 / 6%);
    overflow-wrap: anywhere;
}
.receipt.partial { --status-color: #986014; }
.receipt-main { min-width: 0; }
.receipt-status { display: flex; gap: .9rem; align-items: flex-start; }
.status-icon { display: grid; place-items: center; flex: none; width: 3.15rem; height: 3.15rem; border-radius: 50%; background: var(--tint); color: var(--status-color); }
.status-icon i { font-size: 1.5rem; }
.receipt h1 { margin: 0; font-size: clamp(1.5rem, 2.6vw, 2.1rem); font-weight: 750; line-height: 1.25; }
.receipt p { margin: .35rem 0 0; color: var(--market-muted); line-height: 1.5; }
.reference { margin-block: 1.15rem; padding: 1rem; background: var(--tint); border-radius: .75rem; }
.reference h2 { margin: 0; font-size: .95rem; font-weight: 600; }
.order-number { display: block; margin-top: .25rem; font-size: clamp(1.25rem, 2.4vw, 1.85rem); color: var(--status-color); line-height: 1.3; }
.order-date { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .5rem; margin-top: .8rem; font-size: .88rem; }
.order-date span, .document-list dt { color: var(--market-muted); }
.document-list { margin: .4rem 0 0; }
.document-list > div { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: .2rem .6rem; padding-block: .55rem; border-bottom: 1px solid var(--market-card-border); }
.document-list dd { margin: 0; font-weight: 700; }
.receipt-actions { display: flex; gap: .6rem; flex-wrap: wrap; padding-top: 1rem; border-top: 1px dashed var(--market-card-border); }
.history-link, .receipt-actions :deep(.p-button) { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; min-height: 2.85rem; }
.history-link { padding: .45rem .9rem; border-radius: .5rem; border: 1px solid var(--market-primary); color: var(--market-primary); font-weight: 650; }
.contact { align-self: start; border-inline-start: 1px solid var(--market-card-border); padding-inline-start: clamp(1rem, 2.5vw, 2rem); }
.contact h2 { margin: 0; font-size: 1.1rem; font-weight: 700; }
.line-contact { display: flex; align-items: center; flex-wrap: wrap; gap: 1rem; margin-top: .9rem; }
.line-contact img { width: 6rem; height: 6rem; object-fit: contain; }
.line-link, .phone-link { display: inline-flex; align-items: center; gap: .55rem; min-height: 2.75rem; font-weight: 650; }
.line-link { padding: .4rem .85rem; border-radius: .55rem; color: #116e44; background: #e9f7ef; }
.phone-link { margin-top: .4rem; color: var(--market-text); text-decoration: underline; text-underline-offset: .15em; }
@media (max-width: 720px) {
    .receipt { grid-template-columns: 1fr; gap: 1rem; margin: 0 auto; }
    .contact { border-inline-start: 0; border-top: 1px solid var(--market-card-border); padding: 1rem 0 0; }
    .receipt-actions { display: grid; }
    .line-contact img { width: 5rem; height: 5rem; }
}
</style>
