const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
jest.mock('../../src/db', () => ({ query: (...args) => mockQuery(...args), withTransaction: jest.fn() }));
jest.mock('../../src/utils/marketplaceSalesSettings', () => ({
  getPreorderDefaultEnabled: jest.fn().mockResolvedValue(false),
  getSalePremiumEnabled: jest.fn().mockResolvedValue(true),
  getStockDisplayPercent: jest.fn().mockResolvedValue(100),
  resolvePreorderAllowed: jest.fn((mode) => mode === 'yes'),
}));

const router = require('../../src/routes/cart');
const app = express().use(router);
const row = (unit, ratio, qty, balance, base, preorder = '') => ({
  item_code: '0002008915', item_name: 'ยาสีฟัน', unit_code: unit, wh_code: 'ST01',
  qty_in_cart: qty, balance_qty: balance, stock_base_qty: base, unit_ratio: ratio,
  item_type: 0, store_item_type: '0', on_marketplace: 1, preorder_mode: preorder,
  max_allowance_csv: '',
});

async function validate(rows) {
  mockQuery.mockResolvedValue({ rows });
  return request(app).get('/validatecartstock').query({ cust_code: 'B00063', wh_code: 'ST01' });
}

describe('GET /validatecartstock — shared stock across units', () => {
  beforeEach(() => mockQuery.mockReset());

  it('blocks a carton quantity above available stock', async () => {
    const response = await validate([row('ลัง24', 24, 8, 1, 31)]);
    expect(response.body.is_valid).toBe(false);
    expect(response.body.stock_issues[0]).toMatchObject({ issue_type: 'exceeding', balance_qty: 1 });
  });

  it('adds pieces and cartons before allowing checkout', async () => {
    const response = await validate([row('ชิ้น', 1, 10, 31, 31), row('ลัง24', 24, 1, 1, 31)]);
    expect(response.body.is_valid).toBe(false);
    expect(response.body.stock_issues).toHaveLength(2);
  });

  it('allows both units when their combined base quantity fits', async () => {
    const response = await validate([row('ชิ้น', 1, 7, 31, 31), row('ลัง24', 24, 1, 1, 31)]);
    expect(response.body.is_valid).toBe(true);
  });

  it('retains preorder permission when explicitly enabled', async () => {
    const response = await validate([row('ลัง24', 24, 8, 1, 31, 'yes')]);
    expect(response.body.is_valid).toBe(true);
  });
});
