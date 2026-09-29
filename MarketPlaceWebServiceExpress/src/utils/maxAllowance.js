// Maximum Allowance = จำนวนสั่งสูงสุดต่อคำสั่งซื้อ กำหนดแยกต่อหน่วย (REQ3)
//
// เก็บใน ic_inventory_detail.dimension_38 รูปแบบ CSV "UNIT:QTY" เช่น "ชิ้น:100,ลัง:5"
// ว่าง = ไม่จำกัด · ใช้ pattern เดียวกับ dimension_37 ที่เก็บ CSV ของหน่วยที่ซ่อนออนไลน์
//
// อยู่ใน utils เพราะทั้ง routes/product.js (อ่าน/เขียน master) และ routes/order.js (บังคับตอนสั่งซื้อ) ใช้ร่วมกัน

const MAX_FIELD_LENGTH = 255;
const MAX_UNIT_LENGTH = 40;

// "ชิ้น:100,ลัง:5" → { "ชิ้น": 100, "ลัง": 5 }
function parseMaxAllowance(value) {
  const result = {};
  const tokens = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const token of tokens) {
    // ใช้ lastIndexOf เผื่อชื่อหน่วยมี ':' ปนมา
    const idx = token.lastIndexOf(':');
    if (idx <= 0) continue;
    const unit = token.slice(0, idx).trim();
    const qty = Math.trunc(Number(token.slice(idx + 1).trim()));
    if (!unit || !Number.isFinite(qty) || qty <= 0) continue;
    // หน่วยซ้ำเก็บตัวแรก ให้สอดคล้องกับ normalizeHiddenOnlineUnits ที่ใช้ pattern เดียวกัน
    if (Object.prototype.hasOwnProperty.call(result, unit)) continue;
    result[unit] = qty;
  }
  return result;
}

// รับได้ทั้ง object { unit: qty } จากหน้าแอดมิน และ CSV string จาก import → คืน CSV ที่สะอาด
function normalizeMaxAllowance(value) {
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value : parseMaxAllowance(value);
  const parts = [];
  const seen = new Set();

  for (const [rawUnit, rawQty] of Object.entries(map)) {
    // ตัด , และ : ออกจากชื่อหน่วย ไม่งั้นจะทำให้ CSV เสียรูป
    const unit = String(rawUnit || '').trim().replace(/[,:]/g, '').slice(0, MAX_UNIT_LENGTH).trim();
    const qty = Math.trunc(Number(rawQty));
    if (!unit || seen.has(unit) || !Number.isFinite(qty) || qty <= 0) continue;
    seen.add(unit);
    parts.push(`${unit}:${qty}`);
  }
  return parts.join(',').slice(0, MAX_FIELD_LENGTH);
}

// จำนวนสูงสุดของหน่วยที่ระบุ — คืน null ถ้าไม่จำกัด
function getMaxAllowanceForUnit(value, unitCode) {
  const unit = String(unitCode || '').trim();
  if (!unit) return null;
  const qty = parseMaxAllowance(value)[unit];
  return Number.isFinite(qty) && qty > 0 ? qty : null;
}

module.exports = {
  parseMaxAllowance,
  normalizeMaxAllowance,
  getMaxAllowanceForUnit,
};
