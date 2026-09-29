function hasValue(value) {
    return String(value ?? '').trim().length > 0;
}

export function getCheckoutFormIssue({
    userType = '',
    customerCode = '',
    deliveryMethod = '',
    deliveryAddress = '',
    deliveryTelephone = '',
    // ข้อมูลรับเองที่สาขา (รีวิว 260908 สไลด์ 6) — บังคับครบทุกช่องก่อนสั่งซื้อ
    pickupBranch = '',
    pickupDate = null,
    pickupTimeSlot = '',
    pickupReceiver = '',
    pickupVehicle = ''
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
        if (!hasValue(pickupBranch)) return 'requirePickupBranch';
        if (!pickupDate) return 'requirePickupDate';
        if (!hasValue(pickupTimeSlot)) return 'requirePickupTimeSlot';
        if (!hasValue(pickupReceiver)) return 'requirePickupReceiver';
        if (!hasValue(pickupVehicle)) return 'requirePickupVehicle';
    }

    return '';
}
