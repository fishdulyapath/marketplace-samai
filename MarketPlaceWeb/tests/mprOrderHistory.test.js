import { describe, it, expect } from 'vitest';
import { orderLineKey, paymentDetails, payableAmount } from '../src/utils/mprOrderHistory';

describe('MPR presentation and ERP action identities', () => {
    it('same product in repeated lines keeps separate keys', () => {
        const items = [1, 2, 3].map(line => ({ doc_no: 'MPR1', line_number: line, item_code: 'P1', unit_code: 'EA' }));
        expect(new Set(items.map(orderLineKey)).size).toBe(3);
    });
    it('legacy lines without a saved line number fall back to product identity', () => {
        expect(orderLineKey({ doc_no: 'OLD', ref_guid: '', item_code: 'A', unit_code: 'EA' })).not.toBe(
            orderLineKey({ doc_no: 'OLD', ref_guid: '', item_code: 'B', unit_code: 'EA' })
        );
    });
    it('payment targets real invoices and outstanding money, never MPR totals', () => {
        const order = { doc_no: 'MPR1', total_amount: 1000, payment_documents: [
            { doc_no: 'INV1', doc_date: '2026-09-30', total_amount: 200 },
            { doc_no: 'INV2', doc_date: '2026-09-30', total_amount: 100 }
        ] };
        expect(payableAmount(order)).toBe(300);
        expect(paymentDetails([order]).map(row => row.doc_no)).toEqual(['INV1', 'INV2']);
        expect(paymentDetails([order, order])).toHaveLength(2);
    });
    it('closed invoices never fall back to charging the request snapshot', () => {
        expect(paymentDetails([{ doc_no: 'MPR1', total_amount: 1000, inv_doc_no: 'INV1', payment_documents: [] }])).toEqual([]);
    });
    it('legacy invoices retain a compatible payment shape', () => {
        expect(paymentDetails([{ inv_doc_no: 'INV-OLD', inv_doc_date: '2026-09-30', total_amount: 100, balance: 50 }])).toEqual([
            { trans_flag: '44', doc_no: 'INV-OLD', doc_date: '2026-09-30', total_amount: 50 }
        ]);
    });
});
