const express = require('express');
const request = require('supertest');
jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/adminPermissions', () => ({ getAdminPermissionsForUser: async code => ({ permissions: code === 'EMP' ? ['admin.orders'] : [] }) }));
jest.mock('../../src/utils/marketplaceSalesSettings', () => ({ marketplaceDocWhere: () => '' }));
const { query } = require('../../src/db');
const { signToken } = require('../../src/auth/token');
const makeRouter = require('../../src/routes/mprOrderHistory');
const pending = { doc_no: 'MPR1', cust_code: 'C1', status: 'confirmed', qt_doc_no: 'QT', qt_doc_nos: ['QT-1', 'QT-2'],
  doc_date: '2026-09-28', doc_time: '12:00', total_amount: 100, metadata: { confirmed_allocations: [
    { source_line_number: 1, source_item_code: 'DISPLAY', qt_doc_no: 'QT-1', qt_line_number: 1, item_code: 'PHYSICAL' },
  ] } };
const source = { doc_no: 'MPR1', line_number: 1, item_code: 'DISPLAY', item_name: 'Original product', qty: 10, price: 10, sum_amount: 100 };
const physical = { ...source, doc_no: 'QT-1', item_code: 'PHYSICAL', item_name: 'Actual product', wh_code: 'W', shelf_code: 'S' };
const legacyDetail = jest.fn((req, res) => res.json({ success: true, legacy: req.query.doc_no }));
const app = express(); app.use(express.json());
app.use(makeRouter({ orderHistoryCte: () => 'TEST_OPERATIONAL', mapOrderRow: row => row,
  orderRowKey: row => [row.doc_no, row.so_doc_no, row.inv_doc_no].join('|'), legacyOrderDetail: legacyDetail }));
app.get(['/getOrderHistory', '/getOrderHeader', '/getOrderDetail'], (req, res) => res.json({ legacy: true }));
const auth = (user = 'C1', typ = 'customer') => `Bearer ${signToken({ sub: user, typ })}`;
beforeEach(() => {
  process.env.AUTH_TOKEN_SECRET = 'mpr-history-test-only';
  query.mockReset(); legacyDetail.mockClear();
  query.mockImplementation(async (sql, params) => {
    if (sql.startsWith('SELECT * FROM marketplace_pending_order')) return { rows: params[1] && params[1] !== 'C1' ? [] : [pending] };
    if (sql.startsWith('SELECT p.*')) return { rows: [pending] };
    if (sql.startsWith('SELECT t.doc_no')) return { rows: [] };
    if (sql.startsWith('SELECT t.*')) return { rows: [pending] };
    if (sql.startsWith('SELECT * FROM ic_trans_detail')) return { rows: [source] };
    if (sql.startsWith('SELECT d.*')) return { rows: [physical] };
    if (sql.startsWith('SELECT ap.billing_no')) return { rows: [] };
    if (sql.startsWith('SELECT DISTINCT doc_no')) return { rows: [] };
    if (sql === 'TEST_OPERATIONAL') return { rows: [
      { doc_no: 'QT-1', main_doc_no: 'QT', cust_code: 'C1', status: 'packing', total_amount: 60, doc_date: '2026-09-30', so_doc_no: 'SO1' },
      { doc_no: 'QT-2', main_doc_no: 'QT', cust_code: 'C1', status: 'pending', total_amount: 40, doc_date: '2026-09-30' },
    ] };
    throw new Error(`Unexpected query: ${sql}`);
  });
});
test('unflagged legacy API remains unchanged', async () => {
  const response = await request(app).get('/getOrderHistory?cust_code=C1');
  expect(response.body).toEqual({ legacy: true }); expect(query).not.toHaveBeenCalled();
});
test.each(['/getOrderHistory', '/getOrderHeader?doc_no=MPR1', '/getOrderDetail?doc_no=MPR1'])('MPR reads require a verified token: %s', async path => {
  expect((await request(app).get(path + (path.includes('?') ? '&' : '?') + 'view=mpr')).status).toBe(401);
});
test('customer cannot read another customer even with a conflicting body', async () => {
  const response = await request(app).get('/getOrderDetail?view=mpr&cust_code=C2&doc_no=MPR1').set('Authorization', auth()).send({ cust_code: 'C1' });
  expect(response.status).toBe(403); expect(query).not.toHaveBeenCalled();
});
test('customer and unprivileged employee cannot read staff allocation endpoint', async () => {
  for (const token of [auth(), auth('OTHER', 'employee')]) {
    expect((await request(app).get('/admin/orders/MPR1/items').set('Authorization', token)).status).toBe(403);
  }
});
test('customer sees original lines even when requesting a QT alias or passing admin=true', async () => {
  const response = await request(app).get('/getOrderDetail?view=mpr&doc_no=QT-1&admin=true').set('Authorization', auth());
  expect(response.status).toBe(200);
  expect(response.body.data.items[0].item_code).toBe('DISPLAY');
  expect(JSON.stringify(response.body)).not.toContain('PHYSICAL');
  expect(response.body.paging.total_items).toBe(1);
});
test('authorized employee gets nested actual QT allocations', async () => {
  const response = await request(app).get('/admin/orders/MPR1/items').set('Authorization', auth('EMP', 'employee'));
  expect(response.status).toBe(200);
  expect(response.body.data.items[0].qt_allocations[0]).toMatchObject({ item_code: 'PHYSICAL', wh_code: 'W', shelf_code: 'S' });
});
test('confirmed request stays one card with original date and money, QT state and refs', async () => {
  const response = await request(app).get('/getOrderHistory?view=mpr&page_size=1').set('Authorization', auth());
  expect(response.status).toBe(200);
  expect(response.body.total_orders).toBe(1);
  expect(response.body.data[0]).toMatchObject({ doc_no: 'MPR1', total_amount: 100, doc_date: '2026-09-28', status: 'pending', mixed_progress: true, qt_doc_nos: ['QT-1', 'QT-2'] });
});
test('QT search and status counts work before pagination', async () => {
  const response = await request(app).get('/admin/orders?view=mpr&search=QT-2&status=packing&page_size=1').set('Authorization', auth('EMP', 'employee'));
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual([]);
  expect(response.body.status_counts).toEqual({ pending: 1 });
});
test('header preserves MPR numbers and source totals', async () => {
  const response = await request(app).get('/getOrderHeader?view=mpr&doc_no=MPR1').set('Authorization', auth());
  expect(response.body.data).toMatchObject({ doc_no: 'MPR1', total_amount: 100, qt_main_doc_no: 'QT', status: 'pending' });
});
test('invalid dates/documents are rejected without SQL', async () => {
  expect((await request(app).get('/getOrderHistory?view=mpr&date_from=no-date').set('Authorization', auth())).status).toBe(400);
  expect((await request(app).get('/getOrderDetail?view=mpr&doc_no=%25').set('Authorization', auth())).status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
test('legacy staff details delegate to existing implementation with the original QT number', async () => {
  query.mockResolvedValueOnce({ rows: [] });
  const response = await request(app).get('/admin/orders/OLDQT/items?cust_code=C1').set('Authorization', auth('EMP', 'employee'));
  expect(response.body).toEqual({ success: true, legacy: 'OLDQT' });
});
