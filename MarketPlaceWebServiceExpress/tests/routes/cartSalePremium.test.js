const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockLoadSalePremiumDetail = jest.fn();

jest.mock('../../src/db', () => ({
  query: (...args) => mockQuery(...args),
  withTransaction: async (callback) => callback({ query: (...args) => mockClientQuery(...args) }),
}));

jest.mock('../../src/utils/marketplaceSalesSettings', () => ({
  getPreorderDefaultEnabled: jest.fn().mockResolvedValue(false),
  getSalePremiumEnabled: jest.fn().mockResolvedValue(true),
  getStockDisplayPercent: jest.fn().mockResolvedValue(100),
  resolvePreorderAllowed: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/utils/salePremiumHelper', () => ({
  safeText: (value) => String(value ?? '').trim(),
  loadSalePremiumDetail: (...args) => mockLoadSalePremiumDetail(...args),
}));

const cartRouter = require('../../src/routes/cart');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cartRouter);
  return app;
}

const requestItem = {
  creator_code: 'B00063',
  cust_code: 'B00063',
  item_code: 'PRO001',
  item_name: 'ค่าจาก client ที่ห้ามเชื่อ',
  unit_code: 'ชิ้น',
  qty: '1',
  price: '1',
  item_type: '4',
  sale_premium_code: 'PRO001',
  sale_premium_name: 'ค่าจาก client',
  sale_premium_data: '{"free_items":[]}',
};

describe('POST /additemtocart — sale premium', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockLoadSalePremiumDetail.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    mockLoadSalePremiumDetail.mockResolvedValue({
      premium_code: 'PRO001',
      premium_name: 'โปรหมี่กรอบ',
      image_guid: 'image-guid-1',
      unit_code: 'ถุง',
      price: 50,
      wh_code: 'ST01',
      shelf_code: 'LC01',
      balance_qty: 10,
      stock_qty: 10,
      free_items: [{ item_code: 'G01-0002', unit_code: 'ถังเล็ก', qty: 1, price: 0 }],
    });
  });

  it('ไม่ตรวจ premium_code กับ ic_inventory.item_pattern และบันทึกค่าจาก master ฝั่ง server', async () => {
    const response = await request(createApp())
      .post('/additemtocart')
      .send([requestItem]);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, msg: 'success' });
    expect(mockLoadSalePremiumDetail).toHaveBeenCalledWith(
      expect.any(Function),
      'PRO001',
      expect.objectContaining({ custCode: 'B00063' }),
    );
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("item_pattern = '[W]'"))).toBe(false);

    const insertCall = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO staff_cart_order'));
    expect(insertCall).toBeTruthy();
    const params = insertCall[1];
    expect(params[0]).toBe('4');
    expect(params[3]).toBe('PRO001');
    expect(params[4]).toBe('โปรหมี่กรอบ');
    expect(params[5]).toBe('ถุง');
    expect(params[8]).toBe('50');
    expect(params[16]).toBe('PRO001');
    expect(JSON.parse(params[18])).toMatchObject({
      image_guid: 'image-guid-1',
      free_items: [{ item_code: 'G01-0002', qty: 1 }],
    });
  });

  it('ปฏิเสธโปรโมชันที่หมดอายุหรือปิดใช้งาน', async () => {
    mockLoadSalePremiumDetail.mockRejectedValue(new Error('premium not found or inactive: PRO001'));

    const response = await request(createApp())
      .post('/additemtocart')
      .send([requestItem]);

    expect(response.status).toBe(400);
    expect(response.body.ERROR).toBe('โปรโมชันของแถมไม่พร้อมใช้งาน: PRO001');
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('เพิ่มโปรโมชันที่สต็อกไม่ครบได้เพื่อให้พนักงานจัดคลังภายหลัง', async () => {
    mockLoadSalePremiumDetail.mockResolvedValue({
      premium_code: 'PRO001',
      premium_name: 'โปรหมี่กรอบ',
      unit_code: 'ถุง',
      price: 50,
      balance_qty: 0,
      stock_qty: 0,
      free_items: [{ item_code: 'G01-0002', unit_code: 'ถังเล็ก', qty: 1, price: 0 }],
    });

    const response = await request(createApp())
      .post('/additemtocart')
      .send([{ ...requestItem, qty: '2' }]);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockClientQuery).toHaveBeenCalled();
  });

  it('อนุญาตให้เพิ่มทั้งชุดเป็น Preorder เมื่อทุกชิ้นส่วนเปิดให้สั่งจอง', async () => {
    mockLoadSalePremiumDetail.mockResolvedValue({
      premium_code: 'PRO001',
      premium_name: 'โปรหมี่กรอบ',
      unit_code: 'ถุง',
      price: 50,
      balance_qty: 0,
      stock_qty: 0,
      preorder_allowed: 1,
      free_items: [{ item_code: 'G01-0002', unit_code: 'ถังเล็ก', qty: 1, price: 0 }],
    });

    const response = await request(createApp())
      .post('/additemtocart')
      .send([{ ...requestItem, qty: '2' }]);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, msg: 'success' });
    expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO staff_cart_order'))).toBe(true);
  });
});

describe('GET /getcartitemlist — sale premium', () => {
  const premiumCartRow = {
    cust_code: 'B00063',
    guid_code: 'cart-guid-1',
    item_code: 'PRO001',
    item_name: 'โปรหมี่กรอบ',
    unit_code: 'ถุง',
    item_type: '4',
    qty: '2',
    price: '50',
    sale_premium_code: 'PRO001',
    sale_premium_name: 'โปรหมี่กรอบ',
    sale_premium_data: '{"free_items":[]}',
    preorder_mode: 'default',
  };

  beforeEach(() => {
    mockQuery.mockReset();
    mockLoadSalePremiumDetail.mockReset();
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('COUNT(*)')) return { rows: [{ total_count: '1' }] };
      if (String(sql).includes('FROM staff_cart_order sco')) return { rows: [premiumCartRow] };
      return { rows: [] };
    });
  });

  it('เติม balance_qty ของโปรโมชันจากจำนวนชุดที่ชิ้นส่วนพร้อมส่งจริง ไม่ใช่ 0 ตายตัว', async () => {
    mockLoadSalePremiumDetail.mockResolvedValue({
      premium_code: 'PRO001',
      balance_qty: 17,
      stock_qty: 17,
      preorder_allowed: 1,
    });

    const response = await request(createApp())
      .get('/getcartitemlist')
      .query({ cust_code: 'B00063' });

    expect(response.status).toBe(200);
    expect(mockLoadSalePremiumDetail).toHaveBeenCalledWith(
      expect.any(Function),
      'PRO001',
      expect.objectContaining({ custCode: 'B00063' }),
    );
    expect(response.body.data).toEqual([
      expect.objectContaining({
        item_code: 'PRO001',
        is_sale_premium: 1,
        balance_qty: 17,
        preorder_allowed: true,
      }),
    ]);
  });

  it('โปรหมดอายุ/ถูกปิด — คืน balance_qty 0 และไม่ล้มทั้งตะกร้า', async () => {
    mockLoadSalePremiumDetail.mockRejectedValue(new Error('premium not found or inactive: PRO001'));

    const response = await request(createApp())
      .get('/getcartitemlist')
      .query({ cust_code: 'B00063' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        item_code: 'PRO001',
        balance_qty: 0,
        preorder_allowed: false,
      }),
    ]);
  });
});

describe('GET /validatecartstock — sale premium', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockLoadSalePremiumDetail.mockReset();
    mockLoadSalePremiumDetail.mockResolvedValue({
      premium_code: 'PRO001',
      premium_name: 'โปรหมี่กรอบ',
      balance_qty: 0,
      stock_qty: 0,
      wh_code: 'ST01',
      preorder_allowed: 0,
    });
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('WITH cart AS')) {
        return {
          rows: [{
            item_code: 'PRO001',
            item_name: 'โปรหมี่กรอบ',
            unit_code: 'ถุง',
            wh_code: 'ST01',
            qty_in_cart: '2',
            store_item_type: '4',
            sale_premium_code: 'PRO001',
            sale_premium_name: 'โปรหมี่กรอบ',
            guid_code: 'cart-guid-1',
          }],
        };
      }
      return { rows: [] };
    });
  });

  it('แจ้งสินค้าภายในโปรโมชั่นไม่ครบก่อนเข้าสู่ sendorder', async () => {
    const response = await request(createApp())
      .get('/validatecartstock')
      .query({ cust_code: 'B00063', wh_code: 'ST01' });

    expect(response.status).toBe(200);
    expect(response.body.is_valid).toBe(false);
    expect(response.body.stock_issues).toEqual([
      expect.objectContaining({
        item_code: 'PRO001',
        sale_premium_code: 'PRO001',
        qty_in_cart: 2,
        balance_qty: 0,
        shortage_qty: 2,
        issue_type: 'premium_out_of_stock',
        preorder_allowed: false,
        guid_code: 'cart-guid-1',
      }),
    ]);
  });

  it('ปล่อยไปหน้าสรุปเมื่อสต๊อกไม่ครบแต่ทั้งชุดเปิด Preorder', async () => {
    mockLoadSalePremiumDetail.mockResolvedValue({
      premium_code: 'PRO001',
      premium_name: 'โปรหมี่กรอบ',
      balance_qty: 0,
      stock_qty: 0,
      wh_code: 'ST01',
      preorder_allowed: 1,
    });

    const response = await request(createApp())
      .get('/validatecartstock')
      .query({ cust_code: 'B00063', wh_code: 'ST01' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, is_valid: true, stock_issues: [] });
  });
});
