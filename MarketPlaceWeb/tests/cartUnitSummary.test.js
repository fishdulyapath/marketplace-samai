import { describe, expect, it } from 'vitest';
import { formatCartUnitSummary, summarizeCartUnits } from '@/utils/cartUnitSummary';

const CART = [
    { item_code: 'G04-0001', unit_code: 'แพ็ค', qty: '3' },
    { item_code: 'G04-0001', unit_code: 'ลัง', qty: 6 },
    { item_code: 'G07-0020', unit_code: 'ขวด', qty: 2 }
];

describe('summarizeCartUnits', () => {
    it('รวมเฉพาะสินค้าที่สนใจ แยกตามหน่วย', () => {
        expect(summarizeCartUnits(CART, 'G04-0001')).toEqual([
            { unit_code: 'แพ็ค', qty: 3 },
            { unit_code: 'ลัง', qty: 6 }
        ]);
    });

    it('เรียงตามลำดับหน่วยที่ส่งมา (หน่วยขายหลักของ SML มาก่อน)', () => {
        expect(summarizeCartUnits(CART, 'G04-0001', ['ลัง', 'แพ็ค'])).toEqual([
            { unit_code: 'ลัง', qty: 6 },
            { unit_code: 'แพ็ค', qty: 3 }
        ]);
    });

    it('หน่วยที่ไม่อยู่ในลำดับถูกต่อท้าย ไม่ใช่ถูกตัดทิ้ง', () => {
        const result = summarizeCartUnits(CART, 'G04-0001', ['ลัง']);
        expect(result.map((r) => r.unit_code)).toEqual(['ลัง', 'แพ็ค']);
    });

    it('รวมยอดเมื่อหน่วยเดียวกันมาหลายบรรทัด (barcode ต่างกัน)', () => {
        const cart = [
            { item_code: 'A', unit_code: 'ชิ้น', qty: 2, barcode: '111' },
            { item_code: 'A', unit_code: 'ชิ้น', qty: 5, barcode: '222' }
        ];
        expect(summarizeCartUnits(cart, 'A')).toEqual([{ unit_code: 'ชิ้น', qty: 7 }]);
    });

    it('ข้ามบรรทัดที่จำนวนเป็น 0 หรือไม่มีหน่วย', () => {
        const cart = [
            { item_code: 'A', unit_code: 'ชิ้น', qty: 0 },
            { item_code: 'A', unit_code: '', qty: 4 },
            { item_code: 'A', unit_code: 'ลัง', qty: 1 }
        ];
        expect(summarizeCartUnits(cart, 'A')).toEqual([{ unit_code: 'ลัง', qty: 1 }]);
    });

    it('คืนลิสต์ว่างเมื่อไม่มีของหรือข้อมูลไม่ครบ', () => {
        expect(summarizeCartUnits(CART, 'ไม่มีจริง')).toEqual([]);
        expect(summarizeCartUnits(CART, '')).toEqual([]);
        expect(summarizeCartUnits(null, 'G04-0001')).toEqual([]);
    });
});

describe('formatCartUnitSummary', () => {
    it('ต่อข้อความทุกหน่วยเข้าด้วยกัน', () => {
        expect(formatCartUnitSummary([{ unit_code: 'ลัง', qty: 6 }, { unit_code: 'แพ็ค', qty: 3 }])).toBe('6 ลัง 3 แพ็ค');
    });

    it('หน่วยเดียวก็แสดงปกติ', () => {
        expect(formatCartUnitSummary([{ unit_code: 'ชิ้น', qty: 4 }])).toBe('4 ชิ้น');
    });

    it('ไม่มีอะไรให้แสดงคืนค่าว่าง', () => {
        expect(formatCartUnitSummary([])).toBe('');
        expect(formatCartUnitSummary(null)).toBe('');
    });
});
