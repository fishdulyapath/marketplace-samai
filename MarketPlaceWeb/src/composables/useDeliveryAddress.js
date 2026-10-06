import { computed, onScopeDispose, ref, toValue, watch } from 'vue';

const text = (value) => String(value ?? '').trim();
const codeOf = (customer) => text(customer?.code || customer?.user_code || customer?.cust_code);

// Keep shipping edits local to this order, never write them back to customer master.
export function useDeliveryAddress({ customerCode, customer, draft = () => ({}), loadCustomer }) {
    const profile = ref({});
    const customAddress = ref('');
    const customTelephone = ref('');
    const loading = ref(false);
    const loadError = ref(false);
    const currentAddress = computed(() => text(profile.value.address));
    const currentTelephone = computed(() => text(profile.value.telephone));
    const deliveryAddress = computed(() => text(customAddress.value));
    const deliveryTelephone = computed(() => text(customTelephone.value));
    let generation = 0;
    let initialized = false;
    let edited = false;

    function markEdited() {
        edited = true;
    }

    function setAddress(value) {
        markEdited();
        customAddress.value = value;
    }

    function setTelephone(value) {
        markEdited();
        customTelephone.value = value;
    }

    async function refresh() {
        const code = text(toValue(customerCode));
        const request = ++generation;
        loadError.value = false;
        if (!code) { loading.value = false; return; }
        loading.value = true;
        try {
            const result = await loadCustomer(code);
            if (request !== generation) return;
            if (!result || codeOf(result).toUpperCase() !== code.toUpperCase()) throw new Error('Customer not found');
            profile.value = result;
            if (!edited) {
                customAddress.value = currentAddress.value;
                customTelephone.value = currentTelephone.value;
            }
        } catch {
            if (request === generation) loadError.value = true;
        } finally {
            if (request === generation) loading.value = false;
        }
    }

    watch(() => text(toValue(customerCode)), (code) => {
        const fallback = toValue(customer) || {};
        profile.value = codeOf(fallback).toUpperCase() === code.toUpperCase() ? fallback : {};
        const saved = initialized ? {} : toValue(draft) || {};
        // CartView may have seeded orderData from the same cached profile, not a user edit.
        edited = (!!text(saved.deliveryAddress) && text(saved.deliveryAddress) !== currentAddress.value) ||
            (!!text(saved.deliveryTelephone) && text(saved.deliveryTelephone) !== currentTelephone.value);
        customAddress.value = edited ? (saved.deliveryAddress ?? currentAddress.value) : currentAddress.value;
        customTelephone.value = edited ? (saved.deliveryTelephone ?? currentTelephone.value) : currentTelephone.value;
        initialized = true;
        void refresh();
    }, { immediate: true, flush: 'sync' });
    onScopeDispose(() => { generation++; });

    return { currentAddress, currentTelephone, customAddress, customTelephone,
        deliveryAddress, deliveryTelephone, loading, loadError, refresh, setAddress, setTelephone };
}
