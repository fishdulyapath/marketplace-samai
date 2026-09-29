const {
  isPremiumLine,
  stripClientPremiumFlags,
  stripClientPremiumFlagsFromItems,
  enforcePremiumLineValues,
  enforcePremiumLineValuesForItems,
  premiumFlagValue,
} = require('../../src/utils/salePremiumGuard');

// เฟส 1 ของ docs/sale-premium-plan.md — กันการปลอมของแถมเพื่อให้ราคาเป็น 0

describe('stripClientPremiumFlags — ตัดธงที่ client ส่งมา', () => {
  it('ตัด is_permium ที่ client ส่งมาทิ้ง', () => {
    const result = stripClientPremiumFlags({ item_code: 'A', price: 100, is_permium: 1 });
    expect(result.is_permium).toBeUndefined();
    expect(result.price).toBe(100);
  });

  it('ตัดทุกรูปแบบการสะกดที่อาจใช้เลี่ยง', () => {
    const result = stripClientPremiumFlags({
      item_code: 'A',
      is_permium: 1,
      is_premium: 1,
      isPermium: 1,
      isPremium: 1,
    });
    expect(result.is_permium).toBeUndefined();
    expect(result.is_premium).toBeUndefined();
    expect(result.isPermium).toBeUndefined();
    expect(result.isPremium).toBeUndefined();
  });

  it('ตัดใน sub_item ของชุดสินค้าด้วย', () => {
    const result = stripClientPremiumFlags({
      item_code: 'SET',
      item_type: '3',
      sub_item: [{ item_code: 'B', is_permium: 1 }],
    });
    expect(result.sub_item[0].is_permium).toBeUndefined();
  });

  it('ไม่แก้ object เดิม', () => {
    const original = { item_code: 'A', is_permium: 1 };
    stripClientPremiumFlags(original);
    expect(original.is_permium).toBe(1);
  });

  it('ไม่กระทบฟิลด์อื่นเลย', () => {
    const item = {
      item_code: 'A', item_name: 'ทดสอบ', unit_code: 'ชิ้น',
      qty: 2, price: 50, sum_amount: 100, tax_type: '0', remark: 'x',
    };
    expect(stripClientPremiumFlags(item)).toEqual(item);
  });

  it('รับ array ได้', () => {
    const result = stripClientPremiumFlagsFromItems([
      { item_code: 'A', is_permium: 1 },
      { item_code: 'B' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].is_permium).toBeUndefined();
  });

  it('ค่าที่ไม่ใช่ array คืน array ว่าง', () => {
    expect(stripClientPremiumFlagsFromItems(null)).toEqual([]);
    expect(stripClientPremiumFlagsFromItems(undefined)).toEqual([]);
  });
});

describe('enforcePremiumLineValues — บังคับของแถมมูลค่า 0', () => {
  it('บังคับ price/sum_amount/discount เป็น 0 เมื่อเป็นของแถม', () => {
    const result = enforcePremiumLineValues({
      item_code: 'FREE', qty: 2,
      is_permium: 1,
      price: 999, sum_amount: 1998, discount: '10%', discount_amount: 50,
    });
    expect(result.price).toBe(0);
    expect(result.sum_amount).toBe(0);
    expect(result.discount).toBe('');
    expect(result.discount_amount).toBe(0);
    expect(result.qty).toBe(2);
  });

  it('ไม่แตะสินค้าปกติ', () => {
    const item = { item_code: 'A', qty: 1, price: 100, sum_amount: 100, is_permium: 0 };
    expect(enforcePremiumLineValues(item)).toEqual(item);
  });

  it('ไม่มีธงเลย ถือว่าเป็นสินค้าปกติ', () => {
    const item = { item_code: 'A', price: 100 };
    expect(enforcePremiumLineValues(item)).toEqual(item);
  });

  it('รับ array ได้', () => {
    const result = enforcePremiumLineValuesForItems([
      { item_code: 'A', price: 100 },
      { item_code: 'FREE', price: 999, is_permium: 1 },
    ]);
    expect(result[0].price).toBe(100);
    expect(result[1].price).toBe(0);
  });
});

describe('premiumFlagValue — ค่าที่เขียนลง ic_trans_detail.is_permium', () => {
  it('คืน 1 เฉพาะเมื่อเป็นของแถมจริง', () => {
    expect(premiumFlagValue({ is_permium: 1 })).toBe(1);
    expect(premiumFlagValue({ is_permium: '1' })).toBe(1);
  });

  it('คืน 0 ในทุกกรณีอื่น', () => {
    expect(premiumFlagValue({})).toBe(0);
    expect(premiumFlagValue({ is_permium: 0 })).toBe(0);
    expect(premiumFlagValue({ is_permium: 'yes' })).toBe(0);
    expect(premiumFlagValue(null)).toBe(0);
  });

  it('ไม่สนใจการสะกดแบบ is_premium — ใช้เฉพาะ is_permium ตาม schema ของ ERP', () => {
    expect(premiumFlagValue({ is_premium: 1 })).toBe(0);
  });
});

describe('เคสความปลอดภัย: จำลอง client พยายามปลอมของแถม', () => {
  it('ส่ง is_permium=1 มากับสินค้าราคาเต็ม → ธงถูกตัด เขียนลง DB เป็น 0', () => {
    const fromClient = [{ item_code: 'A', qty: 1, price: 92, sum_amount: 92, is_permium: 1 }];

    // สิ่งที่ sendorder ทำเป็นอย่างแรก
    const sanitized = stripClientPremiumFlagsFromItems(fromClient);

    expect(isPremiumLine(sanitized[0])).toBe(false);
    expect(premiumFlagValue(sanitized[0])).toBe(0);
    // ราคายังเป็นของเดิม ไม่ถูกล้างเป็น 0 เพราะไม่ใช่ของแถมจริง
    expect(sanitized[0].price).toBe(92);
  });

  it('ของแถมที่ server สร้างเอง ยังถูกบังคับเป็น 0 แม้จะมีราคาติดมา', () => {
    // จำลองผลลัพธ์จาก expandSalePremiumItemForSave (เฟส 3)
    const fromServer = { item_code: 'FREE', qty: 1, price: 500, is_permium: 1 };
    const enforced = enforcePremiumLineValues(fromServer);

    expect(premiumFlagValue(enforced)).toBe(1);
    expect(enforced.price).toBe(0);
    expect(enforced.sum_amount).toBe(0);
  });
});
