import { describe, expect, it } from 'vitest';
import { allocationError, allocationPayload } from '../src/utils/orderAllocations';

const source = { line_number: 1, item_code: 'DISPLAY', qty: 10, unit_code: 'EA', wh_code: 'W1', shelf_code: 'S1' };
const part = (item_code, qty, wh_code = 'W1', shelf_code = 'S1') => ({ item_code, qty, wh_code, shelf_code });
describe('pending allocations', () => {
    it('accepts many physical products and locations without any stock gate', () => {
        expect(allocationError(source, [part('A', 6), part('B', 4, 'W2', 'S2')])).toBe('');
    });
    it('rejects incomplete quantities, totals and duplicate locations', () => {
        for (const rows of [[], [part('A', 9)], [part('A', 11)], [part('A', 10, '', '')], [part('A', 6), part('A', 4)]]) expect(allocationError(source, rows)).not.toBe('');
    });
    it('keeps legacy payloads and flattens splits without copying client prices', () => {
        expect(allocationPayload([source])).toEqual([{ line_number: 1, wh_code: 'W1', shelf_code: 'S1' }]);
        expect(allocationPayload([{ ...source, allocations: [{ ...part('A', 10), price: 1 }] }])).toEqual([{ line_number: 1, ...part('A', 10) }]);
    });
});
