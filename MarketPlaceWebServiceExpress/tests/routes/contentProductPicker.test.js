const express = require('express');
const request = require('supertest');

jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/auth/requireAdmin', () => ({ requireAdmin: () => (req, res, next) => next() }));
const { query } = require('../../src/db');
const app = express();
app.use(require('../../src/routes/product'));

beforeEach(() => query.mockReset());

test('content picker reads a bounded page without stock, price or promotion joins', async () => {
  query.mockResolvedValue({ rows: Array.from({ length: 51 }, (_, index) => ({ item_code: `P${index}`, item_name: `Product ${index}` })) });
  const response = await request(app).get('/admin/content/products?search=P&page=0&offset=0&limit=50');
  expect(response.status).toBe(200);
  expect(response.body.data).toHaveLength(50);
  expect(response.body.has_more).toBe(true);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('FROM ic_inventory b');
  expect(sql).not.toMatch(/stock|price|promotion|sml_ic_function/i);
  expect(params).toEqual(['P', '%P%', 0, 51]);
});

test('picker search escapes wildcard characters and clamps pagination', async () => {
  query.mockResolvedValue({ rows: [] });
  const response = await request(app).get('/admin/content/products?search=%25_&offset=-10&limit=500');
  expect(response.status).toBe(200);
  expect(query.mock.calls[0][1]).toEqual(['%_', '%\\%\\_%', 0, 51]);
});
