const express = require('express');
const request = require('supertest');

jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/auth/requireAdmin', () => ({ requireAdmin: () => (req, res, next) => next() }));
jest.mock('../../src/utils/marketplaceSalesSettings', () => ({
  ensureSalesSettingsTables: jest.fn().mockResolvedValue(),
  getStockDisplayPercent: jest.fn().mockResolvedValue(100),
  getPreorderDefaultEnabled: jest.fn().mockResolvedValue(false),
  getMarketplaceDisplayDefaults: jest.fn().mockResolvedValue({}),
  cleanFeatureType: value => value || 'recommend',
}));

const { query } = require('../../src/db');
const app = express();
app.use(require('../../src/routes/product'));

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }));

test('product search pages before calculating stock when isstock=0', async () => {
  const response = await request(app).get('/getProductList?cust_code=A-01&search=0002022225-B&offset=50&limit=20&isstock=0&include_all_pattern=1');
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual([]);
  const sql = query.mock.calls[0][0];
  expect(sql).toContain('WITH paged_products AS (');
  expect(sql).toContain("LIKE '%0002022225-B%'");
  expect(sql).toContain('ORDER BY b.code OFFSET 50 LIMIT 20');
  expect(sql).toContain("SELECT code AS item_code, ''::text AS wh_code FROM paged_products WHERE COALESCE(item_type,0)<>3");
  expect(sql).toContain('FROM paged_products page JOIN ic_inventory b ON b.code=page.code');
  expect(sql).not.toContain("FROM ic_inventory WHERE COALESCE(item_type,0)<>3");
});

test('isstock=1 still filters stock before pagination', async () => {
  const response = await request(app).get('/getProductList?search=0002022225-B&offset=50&limit=20&isstock=1');
  expect(response.status).toBe(200);
  const sql = query.mock.calls[0][0];
  expect(sql).not.toContain('paged_products AS');
  expect(sql).toContain('FROM ic_inventory WHERE COALESCE(item_type,0)<>3');
  expect(sql).toContain('ORDER BY b.code OFFSET 50 LIMIT 20');
});
