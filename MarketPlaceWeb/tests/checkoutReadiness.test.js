import { describe, expect, it } from 'vitest';
import { getCheckoutFormIssue } from '../src/utils/checkoutReadiness';

// ฟอร์มรับเองที่กรอกครบตามรีวิว 260908 สไลด์ 6
const COMPLETE_PICKUP = {
    deliveryMethod: 'pickup',
    pickupDate: new Date(2026, 8, 10),
    pickupTimeSlot: '09:00-10:00',
    pickupReceiver: 'สมชาย',
    pickupVehicle: 'กข 1234'
};

describe('checkout form readiness', () => {
    it('requires an employee to select a customer', () => {
        expect(getCheckoutFormIssue({ userType: 'employee', ...COMPLETE_PICKUP })).toBe('selectCustomerBeforeConfirm');
    });

    it('requires both address and phone for delivery', () => {
        expect(getCheckoutFormIssue({ deliveryMethod: 'delivery', deliveryTelephone: '0812345678' })).toBe('requireDeliveryAddress');
        expect(getCheckoutFormIssue({ deliveryMethod: 'delivery', deliveryAddress: 'Bangkok' })).toBe('requireDeliveryPhone');
    });

    it('allows a complete pickup or delivery form', () => {
        expect(getCheckoutFormIssue({ userType: 'employee', customerCode: 'AR00001', ...COMPLETE_PICKUP })).toBe('');
        expect(getCheckoutFormIssue({ deliveryMethod: 'delivery', deliveryAddress: 'Bangkok', deliveryTelephone: '0812345678' })).toBe('');
    });

    it('บังคับกรอกข้อมูลรับเองให้ครบทีละช่อง', () => {
        expect(getCheckoutFormIssue({ deliveryMethod: 'pickup' })).toBe('requirePickupDate');
        expect(getCheckoutFormIssue({ ...COMPLETE_PICKUP, pickupDate: null })).toBe('requirePickupDate');
        expect(getCheckoutFormIssue({ ...COMPLETE_PICKUP, pickupTimeSlot: '' })).toBe('requirePickupTimeSlot');
        expect(getCheckoutFormIssue({ ...COMPLETE_PICKUP, pickupReceiver: '  ' })).toBe('requirePickupReceiver');
        expect(getCheckoutFormIssue({ ...COMPLETE_PICKUP, pickupVehicle: '' })).toBe('requirePickupVehicle');
    });

    it('ข้อมูลรับเองไม่ถูกบังคับเมื่อเลือกจัดส่ง', () => {
        expect(getCheckoutFormIssue({ deliveryMethod: 'delivery', deliveryAddress: 'Bangkok', deliveryTelephone: '0812345678' })).toBe('');
    });
});
