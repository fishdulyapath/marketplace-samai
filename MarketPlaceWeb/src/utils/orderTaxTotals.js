function toFiniteNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
}

// total_before_vat ของ ERP = ฐานภาษีของรายการที่เสีย VAT
// total_except_vat ของ ERP = ยอดรายการที่ได้รับยกเว้น VAT
// ยอดก่อน VAT ที่ลูกค้าเห็นจึงต้องรวมทั้งสองส่วนเข้าด้วยกัน
export function getOrderTotalBeforeVat(order = {}) {
    const taxableBase = toFiniteNumberOrNull(order.total_before_vat);
    const exemptAmount = toFiniteNumberOrNull(order.total_except_vat);

    if (taxableBase !== null) {
        return taxableBase + (exemptAmount ?? 0);
    }

    // รองรับ API/เอกสารรุ่นเก่าที่ยังไม่ได้ส่ง total_before_vat
    const totalAmount = toFiniteNumberOrNull(order.total_amount);
    const vatAmount = toFiniteNumberOrNull(order.total_vat_value);
    if (totalAmount !== null) return totalAmount - (vatAmount ?? 0);

    return exemptAmount ?? 0;
}
