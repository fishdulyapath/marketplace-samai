// ป้องกันการปลอมของแถมเพื่อให้ราคาเป็น 0
//
// ระบบเชื่อราคาที่ client ส่งมาทั้งหมด (ดู docs/sale-premium-plan.md เฟส 1)
// ถ้าปล่อยให้ client กำหนด is_permium ได้เอง จะตั้งสินค้าทุกชิ้นเป็นของแถมราคา 0 ได้ทันที
//
// กติกา: is_permium ต้องมาจากการ expand โปรโมชันฝั่ง server เท่านั้น
// คอลัมน์ใน ic_trans_detail สะกดว่า is_permium (สะกดผิดมาแต่ต้นใน schema ของ ERP) — ห้ามแก้เป็น is_premium

const PREMIUM_FLAG = 'is_permium';

// ชื่อที่ client อาจส่งมาเพื่อพยายามตั้งธงของแถมเอง
const CLIENT_PREMIUM_KEYS = ['is_permium', 'is_premium', 'isPermium', 'isPremium'];

function isPremiumLine(item) {
  return Number(item?.[PREMIUM_FLAG] ?? 0) === 1;
}

// ลบธงของแถมที่ client ส่งมาทิ้งทั้งหมด ใช้กับ items ที่รับเข้ามาจาก request
// คืน object ใหม่เสมอ ไม่แก้ของเดิม
function stripClientPremiumFlags(item) {
  if (!item || typeof item !== 'object') return item;
  const clean = { ...item };
  for (const key of CLIENT_PREMIUM_KEYS) delete clean[key];
  if (Array.isArray(item.sub_item)) {
    clean.sub_item = item.sub_item.map(stripClientPremiumFlags);
  }
  return clean;
}

function stripClientPremiumFlagsFromItems(items) {
  return (Array.isArray(items) ? items : []).map(stripClientPremiumFlags);
}

// บังคับให้บรรทัดของแถมมีมูลค่าเป็น 0 เสมอ ไม่ว่าจะถูกส่งค่าอะไรมา
// ใช้กับผลลัพธ์ที่ expand จากโปรโมชันแล้วเท่านั้น
function enforcePremiumLineValues(item) {
  if (!isPremiumLine(item)) return item;
  return {
    ...item,
    price: 0,
    sum_amount: 0,
    discount: '',
    discount_amount: 0,
  };
}

function enforcePremiumLineValuesForItems(items) {
  return (Array.isArray(items) ? items : []).map(enforcePremiumLineValues);
}

// ค่าที่จะเขียนลงคอลัมน์ ic_trans_detail.is_permium
function premiumFlagValue(item) {
  return isPremiumLine(item) ? 1 : 0;
}

module.exports = {
  PREMIUM_FLAG,
  CLIENT_PREMIUM_KEYS,
  isPremiumLine,
  stripClientPremiumFlags,
  stripClientPremiumFlagsFromItems,
  enforcePremiumLineValues,
  enforcePremiumLineValuesForItems,
  premiumFlagValue,
};
