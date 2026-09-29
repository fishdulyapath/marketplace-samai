import { describe, expect, it } from 'vitest';
import { getOrderTotalBeforeVat } from '../src/utils/orderTaxTotals';

describe('order total before VAT', () => {
    it('uses the ERP taxable base for a taxable order', () => {
        expect(getOrderTotalBeforeVat({ total_before_vat: 124, total_except_vat: 0, total_amount: 132.68, total_vat_value: 8.68 })).toBe(124);
    });

    it('includes both taxable and VAT-exempt lines', () => {
        expect(getOrderTotalBeforeVat({ total_before_vat: 100, total_except_vat: 50 })).toBe(150);
    });

    it('falls back to total minus VAT for responses from an older API', () => {
        expect(getOrderTotalBeforeVat({ total_amount: 132.68, total_vat_value: 8.68 })).toBeCloseTo(124, 8);
    });
});
