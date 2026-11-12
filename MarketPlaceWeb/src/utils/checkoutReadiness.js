function hasValue(value) {
    return String(value ?? '').trim().length > 0;
}

export function getCheckoutFormIssue({
    userType = '',
    customerCode = '',
    deliveryMethod = '',
    deliveryAddress = '',
    deliveryTelephone = '',
    // ข้อมูลรับเอง — บังคับครบทุกช่องก่อนสั่งซื้อ
    pickupDate = null,
    pickupTimeSlot = '',
    pickupReceiver = '',
    pickupPhone = ''
} = {}) {
    if (userType === 'employee' && !hasValue(customerCode)) {
        return 'selectCustomerBeforeConfirm';
    }

    if (deliveryMethod === 'delivery' && !hasValue(deliveryAddress)) {
        return 'requireDeliveryAddress';
    }

    if (deliveryMethod === 'delivery' && !hasValue(deliveryTelephone)) {
        return 'requireDeliveryPhone';
    }

    if (deliveryMethod === 'pickup') {
        if (!pickupDate) return 'requirePickupDate';
        if (!hasValue(pickupTimeSlot)) return 'requirePickupTimeSlot';
        if (!hasValue(pickupReceiver)) return 'requirePickupReceiver';
        const phone = String(pickupPhone || '').trim();
        if (!/^\+?[\d ()-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, '')) || phone.length > 30) return 'requirePickupPhone';
    }

    return '';
}
