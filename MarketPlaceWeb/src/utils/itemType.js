// ประเภทรายการสินค้า — รวมไว้ที่เดียว (เดิม isSetItem ถูกนิยามซ้ำ 4+ ที่)
//
// item_type: 0=สินค้าปกติ, 3=ชุดสินค้า, 4=โปรโมชันของแถม (marketplace เท่านั้น ไม่เขียนลง DB)

export function isSetItem(item) {
    return String(item?.item_type ?? '') === '3';
}

// โปรโมชันของแถม: ดูจาก item_type=4 หรือมี sale_premium_code
export function isSalePremiumItem(item) {
    return String(item?.item_type ?? '') === '4' || String(item?.sale_premium_code ?? '').trim() !== '';
}

// บรรทัดที่เป็น "ของแถม" จริง (ราคา 0) — ใช้แสดงป้ายในตะกร้า/ประวัติ
export function isFreebieLine(item) {
    return Number(item?.is_permium ?? item?.isPremium ?? 0) === 1;
}
