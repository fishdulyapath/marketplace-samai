import { describe, expect, it } from 'vitest';
import { clearPendingCheckout, pendingCheckoutIdentity } from '../src/utils/pendingCheckout';

function memoryStorage() {
    const values = new Map();
    return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

describe('pending checkout retry identity', () => {
    it('reuses the request and reserved QT across reloads despite regenerated timestamps', () => {
        const storage = memoryStorage();
        const first = pendingCheckoutIdentity('C1', { doc_no: 'QT1', doc_time: '10:00', items: [{ qty: 1 }] }, { storage, requestId: 'r1', docNo: 'QT1', now: 1 });
        const retry = pendingCheckoutIdentity('C1', { doc_no: 'QT2', doc_time: '10:01', items: [{ qty: 1 }] }, { storage, requestId: 'r2', docNo: 'QT2', now: 2 });
        expect(retry).toEqual(first);
    });
    it('starts a fresh request after cart changes or a successful checkout', () => {
        const storage = memoryStorage();
        pendingCheckoutIdentity('C1', { qty: 1 }, { storage, requestId: 'r1', docNo: 'QT1', now: 1 });
        expect(pendingCheckoutIdentity('C1', { qty: 2 }, { storage, requestId: 'r2', docNo: 'QT2', now: 2 }).requestId).toBe('r2');
        clearPendingCheckout('C1', storage);
        expect(pendingCheckoutIdentity('C1', { qty: 2 }, { storage, requestId: 'r3', docNo: 'QT3', now: 3 }).requestId).toBe('r3');
    });
});
