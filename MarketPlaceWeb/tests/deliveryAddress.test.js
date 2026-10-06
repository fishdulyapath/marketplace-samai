import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useDeliveryAddress } from '../src/composables/useDeliveryAddress';
import { getCheckoutFormIssue } from '../src/utils/checkoutReadiness';

const scopes = [];
const fresh = { code: 'B00063', address: '123 ถนนเชียงใหม่', telephone: '0812345678' };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup({ customer = { user_code: 'B00063' }, draft = {}, load = vi.fn().mockResolvedValue(fresh) } = {}) {
    const code = ref('B00063');
    const scope = effectScope(); scopes.push(scope);
    const state = scope.run(() => useDeliveryAddress({ customerCode: code, customer, draft, loadCustomer: load }));
    return { state, code, load, scope };
}
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });

describe('checkout delivery address', () => {
    it('fetches and prefills the latest customer address and phone', async () => {
        const { state: s, load } = setup();
        expect(s.loading.value).toBe(true);
        await flush();
        expect(load).toHaveBeenCalledWith('B00063');
        expect(s.deliveryAddress.value).toBe(fresh.address);
        expect(s.customTelephone.value).toBe(fresh.telephone);
        expect(s.loading.value).toBe(false);
    });
    it('refreshes cached profile defaults seeded by CartView', async () => {
        const { state: s } = setup({ customer: { ...fresh, address: 'old' }, draft: { deliveryAddress: 'old', deliveryTelephone: fresh.telephone } });
        await flush();
        expect(s.deliveryAddress.value).toBe(fresh.address);
    });
    it('preserves a custom draft supplied by the checkout', async () => {
        const { state: s } = setup({ draft: { deliveryAddress: 'สาขาใหม่', deliveryTelephone: '0899999999' } });
        await flush();
        expect(s.deliveryAddress.value).toBe('สาขาใหม่');
    });
    it('keeps direct checkout edits without mutating the customer master profile', async () => {
        const { state: s } = setup(); await flush();
        s.setAddress('  บ้านใหม่  '); s.setTelephone(' 0899999999 ');
        expect(s.deliveryAddress.value).toBe('บ้านใหม่');
        expect(s.deliveryTelephone.value).toBe('0899999999');
        expect(s.currentAddress.value).toBe(fresh.address);
    });
    it('does not overwrite typing with a late response', async () => {
        let resolve;
        const { state: s } = setup({ load: () => new Promise(r => { resolve = r; }) });
        s.setAddress('กรอกระหว่างโหลด'); s.setTelephone('0899999999');
        resolve(fresh); await flush();
        expect(s.currentAddress.value).toBe(fresh.address);
        expect(s.deliveryAddress.value).toBe('กรอกระหว่างโหลด');
    });
    it('selects editable fields when either master field is missing', async () => {
        const { state: s } = setup({ load: async () => ({ ...fresh, telephone: '' }) });
        await flush();
        expect(s.customAddress.value).toBe(fresh.address);
        expect(getCheckoutFormIssue({ deliveryMethod: 'delivery', deliveryAddress: s.deliveryAddress.value, deliveryTelephone: s.deliveryTelephone.value })).toBe('requireDeliveryPhone');
    });
    it('clearing an edited field stays empty for validation and does not fall back to master', async () => {
        const { state: s } = setup(); await flush(); s.setAddress('   ');
        expect(s.deliveryAddress.value).toBe('');
        expect(getCheckoutFormIssue({ deliveryMethod: 'delivery', deliveryAddress: s.deliveryAddress.value })).toBe('requireDeliveryAddress');
    });
    it('allows manual entry after a failed fetch and preserves edits during retry', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fresh);
        const { state: s } = setup({ load }); await flush();
        expect(s.loadError.value).toBe(true);
        s.setAddress('บ้านที่กรอกเอง'); s.setTelephone('0899999999');
        await s.refresh();
        expect(s.loadError.value).toBe(false);
        expect(s.deliveryAddress.value).toBe('บ้านที่กรอกเอง');
    });
    it('resets edits and ignores an old response when employee changes customer', async () => {
        const pending = {};
        const { state: s, code } = setup({ load: code => new Promise(resolve => { pending[code] = resolve; }) });
        s.setAddress('ของลูกค้าเดิม');
        code.value = 'B00064';
        expect(s.customAddress.value).toBe('');
        pending.B00064({ ...fresh, code: 'B00064', address: 'ลูกค้าใหม่' }); await flush();
        pending.B00063(fresh); await flush();
        expect(s.deliveryAddress.value).toBe('ลูกค้าใหม่');
    });
    it('rejects a response for another customer', async () => {
        const { state: s } = setup({ load: async () => ({ ...fresh, code: 'OTHER' }) }); await flush();
        expect(s.loadError.value).toBe(true);
        expect(s.currentAddress.value).toBe('');
    });
    it('invalidates in-flight requests when the customer is cleared', async () => {
        let resolve;
        const { state: s, code } = setup({ load: () => new Promise(r => { resolve = r; }) });
        code.value = ''; resolve(fresh); await flush();
        expect(s.deliveryAddress.value).toBe('');
        expect(s.loading.value).toBe(false);
    });
});
