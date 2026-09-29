import { describe, expect, it } from 'vitest';
import { buildUnitRatioText, collectProductUnits } from '@/utils/unitConversion';

const UNITS = [
    { unit_code: 'ถุง', ratio: 1 },
    { unit_code: 'แพ็ค', ratio: 3 },
    { unit_code: 'ลัง', ratio: 24 }
];

describe('buildUnitRatioText', () => {
    it('ไล่หน่วยที่เล็กกว่าทั้งหมดจากใหญ่ไปเล็ก', () => {
        expect(buildUnitRatioText(UNITS, 'ลัง')).toBe('1 ลัง = 8 แพ็ค = 24 ถุง');
    });

    it('เทียบเฉพาะหน่วยที่เล็กกว่าหน่วยที่เลือก', () => {
        expect(buildUnitRatioText(UNITS, 'แพ็ค')).toBe('1 แพ็ค = 3 ถุง');
    });

    it('หน่วยเล็กสุดไม่มีอะไรให้เทียบ', () => {
        expect(buildUnitRatioText(UNITS, 'ถุง')).toBe('');
    });

    it('สินค้าหน่วยเดียวไม่แสดงข้อความ', () => {
        expect(buildUnitRatioText([{ unit_code: 'ชิ้น', ratio: 1 }], 'ชิ้น')).toBe('');
    });

    it('ถอยไปใช้ stand_value/divide_value เมื่อ ERP ไม่ได้ตั้ง ratio', () => {
        const units = [
            { unit_code: 'ชิ้น', stand_value: 1, divide_value: 1 },
            { unit_code: 'โหล', stand_value: 12, divide_value: 1 }
        ];
        expect(buildUnitRatioText(units, 'โหล')).toBe('1 โหล = 12 ชิ้น');
    });

    it('ตัดทศนิยมท้ายที่ไม่จำเป็นทิ้ง แต่คงค่าที่ไม่ลงตัวไว้', () => {
        const units = [
            { unit_code: 'ขีด', ratio: 1 },
            { unit_code: 'กก.', ratio: 10 },
            { unit_code: 'ถุง', ratio: 15 }
        ];
        expect(buildUnitRatioText(units, 'ถุง')).toBe('1 ถุง = 1.5 กก. = 15 ขีด');
    });

    it('ข้ามหน่วยที่ ratio ใช้ไม่ได้แทนที่จะพัง', () => {
        const units = [
            { unit_code: 'ถุง', ratio: 1 },
            { unit_code: 'เศษ', ratio: 0 },
            { unit_code: 'ลัง', ratio: 24 }
        ];
        expect(buildUnitRatioText(units, 'ลัง')).toBe('1 ลัง = 24 ถุง');
    });

    it('คืนค่าว่างเมื่อไม่พบหน่วยที่เลือกหรือข้อมูลไม่ครบ', () => {
        expect(buildUnitRatioText(UNITS, 'ไม่มีจริง')).toBe('');
        expect(buildUnitRatioText(UNITS, '')).toBe('');
        expect(buildUnitRatioText(null, 'ลัง')).toBe('');
    });
});

describe('collectProductUnits', () => {
    it('รวมหน่วยหลักไว้หน้าสุดตามรูปทรงที่ ProductService คืนมา', () => {
        const product = { unit_code: 'ลัง', ratio: 24, otherUnits: [{ unit_code: 'แพ็ค', ratio: 3 }] };
        expect(collectProductUnits(product).map((u) => u.unit_code)).toEqual(['ลัง', 'แพ็ค']);
    });

    it('ทนต่อสินค้าที่ไม่มี otherUnits', () => {
        expect(collectProductUnits({ unit_code: 'ชิ้น' })).toHaveLength(1);
        expect(collectProductUnits(null)).toEqual([]);
    });
});
