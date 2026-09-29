// ── ข้อความตัวคูณหน่วย ────────────────────────────────────────────────────
//
// ลูกค้าเห็นแค่ "฿305.00 / ลัง" แล้วไม่รู้ว่า 1 ลังมีกี่แพ็ค (รีวิว 260908 สไลด์ 1)
// ไฟล์นี้แปลง ratio ที่ backend ส่งมาอยู่แล้วให้เป็นข้อความ "1 ลัง = 8 แพ็ค = 24 ถุง"
//
// ความหมายของ ratio (จาก ic_unit_use):
//   ratio = จำนวนหน่วยฐานต่อ 1 หน่วยนี้ — ถุง=1, แพ็ค=3, ลัง=24
//   backend เรียง ORDER BY ratio (เล็ก → ใหญ่) และหาร balance ด้วย ratio
//   (MarketPlaceWebServiceExpress/src/routes/product.js:1064, :1103)
// ดังนั้น 1 ลัง = ratio(ลัง)/ratio(แพ็ค) แพ็ค = 24/3 = 8

// ratio ที่ใช้ได้จริงของหน่วยหนึ่ง — เผื่อ ERP บางรหัสไม่ได้ตั้ง ratio ไว้
// จึงถอยไปใช้ stand_value/divide_value ซึ่งเป็นที่มาของ ratio อยู่แล้ว
function resolveRatio(unit) {
    const ratio = Number(unit?.ratio);
    if (Number.isFinite(ratio) && ratio > 0) return ratio;

    const stand = Number(unit?.stand_value);
    const divide = Number(unit?.divide_value);
    if (Number.isFinite(stand) && stand > 0 && Number.isFinite(divide) && divide > 0) {
        return stand / divide;
    }
    return null;
}

function unitCodeOf(unit) {
    return String(unit?.unit_code ?? unit?.code ?? '').trim();
}

// ตัดทศนิยมท้ายที่ไม่จำเป็นทิ้ง — 8.00 → "8" แต่ 1.5 ยังเป็น "1.5"
// (หน่วยบรรจุส่วนใหญ่เป็นจำนวนเต็ม แต่มีสินค้าชั่งน้ำหนักที่ไม่ลงตัว)
function formatFactor(value) {
    const rounded = Math.round(value * 100) / 100;
    return String(rounded);
}

/**
 * สร้างข้อความตัวคูณหน่วยของหน่วยที่กำลังเลือก เทียบกับหน่วยที่เล็กกว่าทุกตัว
 *
 * @param {Array} units รายการหน่วยทั้งหมดของสินค้า (แต่ละตัวมี unit_code + ratio)
 * @param {string} currentUnitCode รหัสหน่วยที่เลือกอยู่
 * @returns {string} เช่น "1 ลัง = 8 แพ็ค = 24 ถุง" หรือ '' เมื่อไม่มีอะไรให้เทียบ
 */
export function buildUnitRatioText(units, currentUnitCode) {
    if (!Array.isArray(units) || units.length < 2) return '';

    const currentCode = String(currentUnitCode ?? '').trim();
    if (!currentCode) return '';

    const current = units.find((u) => unitCodeOf(u) === currentCode);
    const currentRatio = resolveRatio(current);
    if (currentRatio === null) return '';

    // เฉพาะหน่วยที่เล็กกว่าจริงๆ เรียงจากใหญ่ไปเล็ก เพื่อให้ได้ลำดับ ลัง → แพ็ค → ถุง
    const smaller = units
        .filter((u) => {
            if (unitCodeOf(u) === currentCode || !unitCodeOf(u)) return false;
            const ratio = resolveRatio(u);
            return ratio !== null && ratio < currentRatio;
        })
        .sort((a, b) => resolveRatio(b) - resolveRatio(a));

    if (smaller.length === 0) return '';

    const parts = [`1 ${currentCode}`];
    for (const unit of smaller) {
        parts.push(`${formatFactor(currentRatio / resolveRatio(unit))} ${unitCodeOf(unit)}`);
    }
    return parts.join(' = ');
}

/**
 * ข้อความตัวคูณแบบย่อสำหรับตะกร้า — เทียบกับหน่วยฐานของสินค้าอย่างเดียว
 *
 * ตะกร้าเก็บแค่หน่วยของบรรทัดนั้น ไม่มีรายการหน่วยทั้งหมดของสินค้า
 * (staff_cart_order มี ratio ของบรรทัดเดียว) จึงเทียบได้แค่กับ unit_standard
 * ที่ backend ส่งมาเพิ่ม → "1 ลัง = 24 ชิ้น"
 *
 * @returns {string} '' เมื่อเป็นหน่วยฐานเอง หรือข้อมูลไม่พอ
 */
export function buildBaseUnitRatioText(item) {
    const unitCode = unitCodeOf(item);
    const baseUnit = String(item?.unit_standard ?? '').trim();
    if (!unitCode || !baseUnit || baseUnit === unitCode) return '';

    const ratio = resolveRatio(item);
    if (ratio === null || ratio <= 1) return '';

    return `1 ${unitCode} = ${formatFactor(ratio)} ${baseUnit}`;
}

/**
 * รวมหน่วยหลักกับหน่วยรองให้เป็นลิสต์เดียว ตามรูปทรงข้อมูลที่ ProductService คืนมา
 * (row แรกคือหน่วยขายหลักของ SML ที่เหลืออยู่ใน otherUnits)
 */
export function collectProductUnits(product) {
    if (!product) return [];
    const others = Array.isArray(product.otherUnits) ? product.otherUnits : [];
    return [product, ...others].filter((u) => unitCodeOf(u));
}
