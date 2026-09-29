// ── สรุปจำนวนในตะกร้าแยกตามหน่วย ─────────────────────────────────────────
//
// รีวิว 260908 สไลด์ 3: เดิมแถบ "มีในตะกร้าแล้ว" นับเฉพาะหน่วยที่กำลังเลือกอยู่
// สลับหน่วยแล้วตัวเลขหายไปทั้งที่ของยังอยู่ในตะกร้า ลูกค้าต้องเห็นทุกหน่วยพร้อมกัน
// เช่น "มีในตะกร้าแล้ว 6 ลัง 3 แพ็ค"
//
// ⚠️ ใช้กับ "ข้อความที่แสดง" เท่านั้น ตรรกะจำกัดสต็อก/โควตายังต้องนับเฉพาะ
//    หน่วยที่เลือกอยู่เหมือนเดิม เพราะเพดานผูกกับหน่วยนั้นๆ ไม่ใช่ทั้งสินค้า

function normalizeCode(value) {
    return String(value ?? '').trim();
}

function toQty(value) {
    const qty = Math.trunc(Number(String(value ?? '').replace(/,/g, '').trim()));
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

/**
 * รวมบรรทัดตะกร้าของสินค้าตัวหนึ่ง แยกตามหน่วย
 *
 * @param {Array} cartItems รายการในตะกร้าทั้งหมด
 * @param {string} itemCode รหัสสินค้าที่สนใจ
 * @param {Array<string>} unitOrder ลำดับหน่วยที่ต้องการให้แสดง (ปกติคือลำดับจาก
 *        API ซึ่งเอาหน่วยขายหลักของ SML มาก่อน) หน่วยที่ไม่อยู่ในลิสต์ต่อท้ายให้
 * @returns {Array<{unit_code: string, qty: number}>}
 */
export function summarizeCartUnits(cartItems, itemCode, unitOrder = []) {
    const code = normalizeCode(itemCode);
    if (!code || !Array.isArray(cartItems)) return [];

    // หลายบรรทัดอาจเป็นหน่วยเดียวกันได้ (barcode ต่างกัน) จึงต้องรวมยอด
    const byUnit = new Map();
    for (const item of cartItems) {
        if (normalizeCode(item?.item_code ?? item?.code ?? item?.id) !== code) continue;
        const unit = normalizeCode(item?.unit_code ?? item?.unit);
        const qty = toQty(item?.qty ?? item?.quantity);
        if (!unit || qty <= 0) continue;
        byUnit.set(unit, (byUnit.get(unit) || 0) + qty);
    }

    if (byUnit.size === 0) return [];

    const order = (Array.isArray(unitOrder) ? unitOrder : []).map(normalizeCode).filter(Boolean);
    const rank = (unit) => {
        const index = order.indexOf(unit);
        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };

    return [...byUnit.entries()]
        .map(([unit_code, qty]) => ({ unit_code, qty }))
        .sort((a, b) => rank(a.unit_code) - rank(b.unit_code));
}

/**
 * แปลงผลจาก summarizeCartUnits เป็นข้อความเดียว — "6 ลัง 3 แพ็ค"
 */
export function formatCartUnitSummary(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    return entries.map((entry) => `${entry.qty} ${entry.unit_code}`).join(' ');
}
