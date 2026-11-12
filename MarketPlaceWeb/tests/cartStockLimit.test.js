import { describe, expect, it } from 'vitest';
import { cartStockBreakdown, hasCartStockShortage, stockQtyLimit } from '@/utils/cartStockLimit';

describe('cart stock limits across units', () => {
    const pieces = { item_code: '0002008915', unit_code: 'หลอด', ratio: 1, qty: 2, balance_qty: 31, preorder_allowed: false };
    const packs = { item_code: '0002008915', unit_code: 'แพค(6)', ratio: 6, qty: 2, balance_qty: 5, preorder_allowed: false };

    it('counts other units before allowing another pack', () => {
        expect(stockQtyLimit(packs, [pieces, packs])).toBe(4);
        expect(stockQtyLimit(pieces, [pieces, packs])).toBe(19);
    });

    it('blocks cartons when their combined base units exceed stock', () => {
        const cartons = { ...packs, unit_code: 'ลัง24', unit_standard: 'หลอด', ratio: 24, qty: 8, balance_qty: 1 };
        expect(stockQtyLimit(cartons, [pieces, cartons])).toBe(1);
        expect(hasCartStockShortage(cartons, [pieces, cartons])).toBe(true);
        expect(cartStockBreakdown(cartons, [pieces, cartons])).toMatchObject({
            requiredBase: 192, availableForLineBase: 29, maxReadyQty: 1, shortageQty: 7, baseUnit: 'หลอด'
        });
    });

    it('respects preorder and maximum allowance', () => {
        const preorder = { ...packs, preorder_allowed: true };
        expect(stockQtyLimit(preorder, [pieces, preorder])).toBe(null);
        expect(hasCartStockShortage(preorder, [pieces, preorder])).toBe(false);
        const allowance = { ...packs, max_order_qty: 3 };
        expect(stockQtyLimit(allowance, [pieces, allowance])).toBe(3);
    });

    it('does not mistake an unloaded placeholder for real stock', () => {
        const unloaded = { ...packs, balance_qty: 0 };
        expect(stockQtyLimit(unloaded, [unloaded], false)).toBe(null);
        expect(cartStockBreakdown(unloaded, [unloaded], false)).toBe(null);
    });

    it('shows ready and preorder quantities without counting shared stock twice', () => {
        const first = { ...pieces, qty: 3, balance_qty: 31, preorder_allowed: true };
        const second = { ...packs, unit_code: 'ลัง24', ratio: 24, qty: 2, balance_qty: 1, preorder_allowed: true };
        expect(cartStockBreakdown(first, [first, second])).toMatchObject({ readyQty: 3, preorderQty: 0 });
        expect(cartStockBreakdown(second, [first, second])).toMatchObject({ readyQty: 1, preorderQty: 1 });
    });

    it('shows a premium as entirely preorder when its set is incomplete', () => {
        const premium = { item_code: 'PROMO1', item_type: '4', unit_code: 'ชุด', qty: 2, balance_qty: 1, preorder_allowed: true };
        expect(cartStockBreakdown(premium, [premium])).toMatchObject({ readyQty: 0, preorderQty: 2 });
    });

    it('uses exact base stock for the shortage message when only a carton is in the cart', () => {
        const carton = { ...packs, unit_code: 'ลัง24', unit_standard: 'หลอด', ratio: 24, qty: 2, balance_qty: 1, base_balance_qty: 31 };
        expect(cartStockBreakdown(carton, [carton])).toMatchObject({ requiredBase: 48, availableForLineBase: 31, maxReadyQty: 1, baseUnit: 'หลอด' });
        const roundedOnly = { ...carton, base_balance_qty: undefined };
        expect(cartStockBreakdown(roundedOnly, [roundedOnly])).toMatchObject({ maxReadyQty: 1, baseUnit: '' });
    });
});
