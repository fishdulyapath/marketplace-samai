import { describe, expect, it, vi } from 'vitest';
import { resolveHomeProductSections } from '../src/utils/homeSections';

const makeDefault = (type) => ({ id: type, mode: type });

describe('resolveHomeProductSections', () => {
    it('ยังไม่เคยตั้งค่า → ใส่ค่าเริ่มต้น new + recommend ให้มีอะไรแสดง', () => {
        expect(resolveHomeProductSections([], makeDefault).map((s) => s.id)).toEqual(['new', 'recommend']);
        expect(resolveHomeProductSections(null, makeDefault)).toHaveLength(2);
        expect(resolveHomeProductSections(undefined, makeDefault)).toHaveLength(2);
    });

    it('>>> แอดมินตั้งค่าไว้แล้ว → ไม่ยัด section กลับเข้าไปอีก', () => {
        const configured = [{ id: 'promotion', mode: 'promotion' }];
        const result = resolveHomeProductSections(configured, makeDefault);

        expect(result.map((s) => s.id)).toEqual(['promotion']);
    });

    it('>>> ตั้งค่าไว้แล้วแต่ไม่มี new/recommend ก็ต้องไม่ถูกยัดกลับ (พฤติกรรมเดิมที่แก้)', () => {
        const configured = [{ id: 'flash', mode: 'manual' }, { id: 'promotion', mode: 'promotion' }];
        const factory = vi.fn(makeDefault);

        const result = resolveHomeProductSections(configured, factory);

        expect(result).toHaveLength(2);
        expect(factory).not.toHaveBeenCalled(); // ไม่เรียกสร้าง default = ไม่ยิง API เปล่า
    });

    it('คืน array ใหม่เสมอ ไม่แก้ของเดิม', () => {
        const configured = [{ id: 'a' }];
        const result = resolveHomeProductSections(configured, makeDefault);

        result.push({ id: 'b' });
        expect(configured).toHaveLength(1);
    });

    it('ไม่มี factory ส่งมา → คืน array ว่าง ไม่ throw', () => {
        expect(resolveHomeProductSections([], null)).toEqual([]);
    });
});
