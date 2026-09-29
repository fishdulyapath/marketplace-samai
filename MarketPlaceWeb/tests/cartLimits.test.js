import { describe, expect, it } from 'vitest';
import { getRemainingAddableQty, isMaxOrderQtyReached, normalizeMaxOrderQty } from '../src/utils/cartLimits';

describe('cart order limits', () => {
    it('normalizes a positive allowance and treats zero as unlimited', () => {
        expect(normalizeMaxOrderQty('2')).toBe(2);
        expect(normalizeMaxOrderQty(0)).toBeNull();
        expect(normalizeMaxOrderQty(null)).toBeNull();
    });

    it('disables quantity increase when the cart has reached the allowance', () => {
        expect(isMaxOrderQtyReached({ qty: 2, max_order_qty: 2 })).toBe(true);
        expect(isMaxOrderQtyReached({ qty: 1, max_order_qty: 2 })).toBe(false);
        expect(isMaxOrderQtyReached({ qty: 999, max_order_qty: null })).toBe(false);
    });

    it('reports the smaller remaining quantity from stock and the order allowance', () => {
        expect(getRemainingAddableQty(3549, 0)).toBe(0);
        expect(getRemainingAddableQty(3549, 2)).toBe(2);
        expect(getRemainingAddableQty(3, 10)).toBe(3);
        expect(getRemainingAddableQty(3549, null)).toBe(3549);
    });
});
