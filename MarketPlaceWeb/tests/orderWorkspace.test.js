import { describe, expect, it } from 'vitest';
import { createOrderDraftStore, DRAFT_TTL, remainingQty, requestAge, unassignedRows } from '../src/utils/orderWorkspace';
const memory = () => {
    const data = new Map();
    return {
        get length() {
            return data.size;
        },
        key: (i) => [...data.keys()][i],
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: (key) => data.delete(key)
    };
};
const doc = () => ({
    doc_no: 'MPR001',
    cust_code: 'C1',
    telephone: 'private',
    address: 'private',
    total_amount: 100,
    items: [
        {
            line_number: 1,
            item_code: 'P1',
            qty: 10,
            unit_code: 'EA',
            price: 10,
            sum_amount: 100,
            allocations: [
                { item_code: 'A', qty: 6, wh_code: 'W1', shelf_code: 'S1' },
                { item_code: 'B', qty: 4, wh_code: '', shelf_code: '' }
            ]
        }
    ]
});
describe('workspace drafts', () => {
    it('restores minimal allocations without storing customer contact data', () => {
        const storage = memory(),
            store = createOrderDraftStore(storage, 'api', 'EMP');
        const source = doc();
        store.save(source, 1000);
        expect(storage.getItem(storage.key(0))).not.toMatch(/private|telephone|address/);
        const fresh = doc();
        fresh.items[0].allocations = [];
        expect(store.restore(fresh, 2000).status).toBe('restored');
        expect(fresh.items[0].allocations).toEqual(source.items[0].allocations);
    });
    it('isolates employees and API scopes and refuses anonymous saves', () => {
        const storage = memory();
        createOrderDraftStore(storage, 'api', 'EMP').save(doc());
        expect(createOrderDraftStore(storage, 'api', 'OTHER').restore(doc()).status).toBe('none');
        expect(createOrderDraftStore(storage, 'api-other', 'EMP').restore(doc()).status).toBe('none');
        expect(() => createOrderDraftStore(storage, 'api', '').save(doc())).toThrow();
    });
    it.each(['qty', 'price', 'unit_code', 'tax_type'])('discards drafts when source %s changed', (field) => {
        const storage = memory(),
            store = createOrderDraftStore(storage, 'api', 'EMP');
        store.save(doc());
        const fresh = doc();
        fresh.items[0][field] = 'different';
        expect(store.restore(fresh).status).toBe('discarded');
        expect(storage.length).toBe(0);
    });
    it('expires drafts and removes only the current owner on completion', () => {
        const storage = memory(),
            store = createOrderDraftStore(storage, 'api', 'EMP');
        store.save(doc(), 1000);
        expect(store.restore(doc(), DRAFT_TTL + 2000).status).toBe('discarded');
        store.save(doc());
        createOrderDraftStore(storage, 'api', 'OTHER').save(doc());
        store.remove('MPR001');
        expect(storage.length).toBe(1);
    });
    it('rejects corrupt data and keeps invalid/incomplete quantities for visible validation rather than silently confirming', () => {
        const storage = memory(),
            store = createOrderDraftStore(storage, 'api', 'EMP');
        store.save(doc());
        storage.setItem(storage.key(0), 'bad');
        expect(store.restore(doc()).status).toBe('discarded');
        const incomplete = doc();
        incomplete.items[0].allocations[0].qty = null;
        store.save(incomplete);
        const fresh = doc();
        expect(store.restore(fresh).status).toBe('restored');
        expect(fresh.items[0].allocations[0].qty).toBeNull();
    });
    it('surfaces storage quota failures to the workspace', () => {
        const storage = memory();
        storage.setItem = () => {
            throw new Error('quota');
        };
        expect(() => createOrderDraftStore(storage, 'api', 'EMP').save(doc())).toThrow('quota');
    });
});
describe('workspace speed helpers', () => {
    it('fills remaining quantities with decimal precision and reports over-allocation', () => {
        expect(remainingQty({ qty: 0.3 }, [{ qty: 0.1 }, { qty: 0.1 }])).toBe(0.1);
        expect(remainingQty({ qty: 10 }, [{ qty: 6 }, { qty: 1 }], 1)).toBe(4);
        expect(remainingQty({ qty: 10 }, [{ qty: 11 }])).toBe(-1);
    });
    it('bulk fills only fully blank locations within the selected lines', () => {
        const source = doc();
        source.items.push({
            line_number: 2,
            allocations: [
                { wh_code: 'W2', shelf_code: '' },
                { wh_code: '', shelf_code: '' }
            ]
        });
        expect(unassignedRows(source.items).length).toBe(2);
        expect(unassignedRows(source.items, [1]).length).toBe(1);
        expect(unassignedRows(source.items, []).length).toBe(0);
    });
    it('formats queue age without inventing missing timestamps', () => {
        expect(requestAge('2026-09-30T00:00:00Z', Date.parse('2026-09-30T02:00:00Z'))).toBe('รอ 2 ชม.');
        expect(requestAge(undefined)).toBe('ไม่ทราบเวลารับคำขอ');
    });
});
