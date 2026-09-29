// ── การรับสินค้าเองที่สาขา ────────────────────────────────────────────────
//
// รีวิว 260908 สไลด์ 6:
//   - เลือกสาขาได้ 2 แห่ง (คำเที่ยง / ดอยสะเก็ด)
//   - เลือกวันได้ตั้งแต่วันนี้ ล่วงหน้าสูงสุด 3 วัน
//   - เวลาเข้ารับเป็น slot รายชั่วโมง 09:00-10:00 … 16:00-17:00
//   - ระบบอนุญาตให้เลือกเวลาได้ไวสุด 3 ชั่วโมงจากเวลาปัจจุบัน
//
// แยกออกมาเป็น util เพื่อเขียนเทสต์กฎเวลาได้โดยไม่ต้อง mount คอมโพเนนต์

// สาขาที่เปิดให้เข้ารับ — ค่าคงที่ตามที่ลูกค้าระบุ
// (ยังไม่ผูกกับตาราง branch ของ ERP เพราะ marketplace ยิงเอกสารเข้า branch_code '00000' อย่างเดียว)
export const PICKUP_BRANCHES = [
    { code: 'KHAMTHIANG', name: 'คำเที่ยง' },
    { code: 'DOISAKET', name: 'ดอยสะเก็ด' }
];

// ชั่วโมงเริ่มต้นของแต่ละ slot — 09:00-10:00 ถึง 16:00-17:00
export const PICKUP_SLOT_START_HOURS = [9, 10, 11, 12, 13, 14, 15, 16];

// เลือกเวลาได้ไวสุดกี่ชั่วโมงจากตอนนี้
export const PICKUP_MIN_LEAD_HOURS = 3;

// เลือกวันล่วงหน้าได้สูงสุดกี่วัน (0 = วันนี้)
export const PICKUP_MAX_DAYS_AHEAD = 3;

function pad2(value) {
    return String(value).padStart(2, '0');
}

function atMidnight(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function formatSlotLabel(startHour) {
    return `${pad2(startHour)}:00-${pad2(startHour + 1)}:00`;
}

export function isSameDay(a, b) {
    return atMidnight(a).getTime() === atMidnight(b).getTime();
}

/**
 * ช่วงวันที่เลือกได้ — วันนี้ถึงวันนี้ + PICKUP_MAX_DAYS_AHEAD
 */
export function getPickupDateRange(now = new Date()) {
    const min = atMidnight(now);
    const max = atMidnight(now);
    max.setDate(max.getDate() + PICKUP_MAX_DAYS_AHEAD);
    return { min, max };
}

/**
 * slot เวลาที่เลือกได้ของวันที่กำหนด
 *
 * เฉพาะ "วันนี้" เท่านั้นที่ต้องตัด slot ที่เริ่มเร็วกว่า now + 3 ชั่วโมงออก
 * วันถัดไปเลือกได้ทุก slot
 *
 * @returns {Array<{value: string, label: string, startHour: number}>}
 */
export function getAvailablePickupSlots(selectedDate, now = new Date()) {
    if (!selectedDate) return [];

    const sameDay = isSameDay(selectedDate, now);
    // ปัดขึ้นเป็นชั่วโมงเต็ม — 10:15 + 3 ชม. = 13:15 ต้องเริ่มได้ที่ slot 14:00 ไม่ใช่ 13:00
    const earliestHour = sameDay ? Math.ceil(now.getHours() + now.getMinutes() / 60) + PICKUP_MIN_LEAD_HOURS : 0;

    return PICKUP_SLOT_START_HOURS.filter((hour) => hour >= earliestHour).map((hour) => ({
        value: formatSlotLabel(hour),
        label: formatSlotLabel(hour),
        startHour: hour
    }));
}

/**
 * ประกอบข้อความรับเองสำหรับใส่ในหมายเหตุ QT
 * ลูกค้าระบุว่า "ข้อมูลจะอยู่ที่ หมายเหตุ ขอ QT"
 */
export function buildPickupRemark({ branchName = '', dateText = '', timeSlot = '', receiver = '', vehicle = '' } = {}) {
    const parts = [];
    if (branchName) parts.push(`สาขา${branchName}`);
    if (dateText) parts.push(dateText);
    if (timeSlot) parts.push(timeSlot);
    if (receiver) parts.push(`ผู้รับ: ${receiver}`);
    if (vehicle) parts.push(`ทะเบียน: ${vehicle}`);
    if (parts.length === 0) return '';
    return `รับเอง ${parts.join(' ')}`;
}
