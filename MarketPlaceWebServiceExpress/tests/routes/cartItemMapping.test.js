const {
  getMarketplaceInventoryCodes,
  isSalePremiumCartItem,
  mapCartItemListRow,
} = require('../../src/routes/cart');

describe('getcartitemlist response mapping', () => {
  const baseRow = {
    cust_code: 'AR00001',
    item_code: 'NN-0001',
    item_name: 'สินค้าทดสอบ',
    unit_code: 'แพ็ค',
    item_type: 0,
    qty: 2,
    price: 70,
    preorder_mode: 'default',
  };

  it('ส่งจำนวนสั่งสูงสุดของหน่วยปัจจุบันให้หน้าตะกร้า', () => {
    const result = mapCartItemListRow(
      { ...baseRow, max_allowance_csv: 'ชิ้น:10,แพ็ค:2' },
      false,
    );

    expect(result.max_order_qty).toBe(2);
  });

  it('ส่ง null เมื่อหน่วยปัจจุบันไม่ได้กำหนดจำนวนสูงสุด', () => {
    const result = mapCartItemListRow(
      { ...baseRow, max_allowance_csv: 'ชิ้น:10' },
      false,
    );

    expect(result.max_order_qty).toBeNull();
  });
});

describe('additemtocart marketplace participation validation', () => {
  it('แยกหัวโปรโมชันของแถมออกจากรหัสสินค้า ERP ที่ต้องมี item_pattern=[W]', () => {
    const items = [
      { item_code: 'NORMAL001', item_type: '0' },
      { item_code: 'PRO001', item_type: '4', sale_premium_code: 'PRO001' },
      { item_code: 'PRO002', item_type: '0', sale_premium_code: 'PRO002' },
    ];

    expect(isSalePremiumCartItem(items[1])).toBe(true);
    expect(isSalePremiumCartItem(items[2])).toBe(true);
    expect(getMarketplaceInventoryCodes(items)).toEqual(['NORMAL001']);
  });
});
