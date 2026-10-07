import { describe, expect, it } from 'vitest';
import { buildPickupRemark, getAvailablePickupSlots, getPickupDateRange } from '@/utils/pickupSlots';

// 8 กันยายน 2569 (ค.ศ. 2026) เวลา 10:15 น.
const NOW = new Date(2026, 8, 8, 10, 15, 0);

function hoursOf(slots) {
    return slots.map((s) => s.startHour);
}

describe('getAvailablePickupSlots', () => {
    it('วันนี้ตัด slot ที่เริ่มเร็วกว่า now + 3 ชั่วโมงออก', () => {
        // 10:15 ปัดขึ้นเป็น 11 + 3 = 14 → เริ่มได้ที่ 14:00
        expect(hoursOf(getAvailablePickupSlots(NOW, NOW))).toEqual([14, 15, 16]);
    });

    it('เวลาลงตัวพอดีก็ยังต้องบวก 3 ชั่วโมงเต็ม', () => {
        const now = new Date(2026, 8, 8, 9, 0, 0);
        expect(hoursOf(getAvailablePickupSlots(now, now))).toEqual([12, 13, 14, 15, 16]);
    });

    it('วันถัดไปเลือกได้ทุก slot ไม่ว่าตอนนี้กี่โมง', () => {
        const tomorrow = new Date(2026, 8, 9, 0, 0, 0);
        expect(hoursOf(getAvailablePickupSlots(tomorrow, NOW))).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    });

    it('สายเกินจนไม่เหลือ slot ของวันนี้', () => {
        const late = new Date(2026, 8, 8, 15, 30, 0);
        expect(getAvailablePickupSlots(late, late)).toEqual([]);
    });

    it('ไม่ได้เลือกวันก็ไม่มี slot', () => {
        expect(getAvailablePickupSlots(null, NOW)).toEqual([]);
    });

    it('label อ่านง่ายเป็นช่วงชั่วโมง', () => {
        const slots = getAvailablePickupSlots(new Date(2026, 8, 9), NOW);
        expect(slots[0].label).toBe('09:00-10:00');
        expect(slots[slots.length - 1].label).toBe('16:00-17:00');
    });
});

describe('getPickupDateRange', () => {
    it('เลือกได้ตั้งแต่วันนี้ถึงล่วงหน้า 3 วัน', () => {
        const { min, max } = getPickupDateRange(NOW);
        expect(min.getDate()).toBe(8);
        expect(max.getDate()).toBe(11);
    });

    it('ตัดเวลาออกให้เหลือแต่วันที่', () => {
        const { min } = getPickupDateRange(NOW);
        expect([min.getHours(), min.getMinutes(), min.getSeconds()]).toEqual([0, 0, 0]);
    });
});

describe('buildPickupRemark', () => {
    it('ประกอบข้อความครบทุกส่วน', () => {
        expect(
            buildPickupRemark({ dateText: '10/09/2569', timeSlot: '09:00-10:00', receiver: 'สมชาย', vehicle: 'กข 1234' })
        ).toBe('รับเอง 10/09/2569 09:00-10:00 ผู้รับ: สมชาย ทะเบียน: กข 1234');
    });

    it('ข้ามส่วนที่ยังไม่กรอก', () => {
        expect(buildPickupRemark({ dateText: '10/09/2569' })).toBe('รับเอง 10/09/2569');
    });

    it('ไม่มีข้อมูลเลยคืนค่าว่าง ไม่ใช่คำว่า "รับเอง" ลอยๆ', () => {
        expect(buildPickupRemark({})).toBe('');
        expect(buildPickupRemark()).toBe('');
    });
});
