// Set PENDING_TEST_DATABASE_URL only for the disposable local samai_pending_test DB.
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const url = process.env.PENDING_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/samai_pending_test') {
    throw new Error('Integration tests require a disposable local samai_pending_test database');
  }
}
const mockPool = new Pool({ connectionString: url, max: 12 });
let mockDocSource = 'client';
let mockMaxLines = 0;
let mockStockPercent = 100;
jest.mock('../../src/db', () => ({
  pool: mockPool,
  query: (...args) => mockPool.query(...args),
  withTransaction: async callback => {
    const client = await mockPool.connect();
    try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  },
}));
jest.mock('../../src/utils/priceHelper', () => ({ getProductPriceLocalx: jest.fn().mockResolvedValue({ success: true, data: [{ price: 100 }] }) }));
jest.mock('../../src/utils/adminPermissions', () => ({ getAdminPermissionsForUser: async code => ({ is_superadmin: false, permissions: code === 'EMP' ? ['admin.orders'] : [] }) }));
jest.mock('../../src/utils/marketplaceSalesSettings', () => ({
  getOrderDocSource: async () => mockDocSource,
  getOrderDocPattern: async () => 'BSWYYMMDD####',
  getErpMaxLinesPerDoc: async () => mockMaxLines,
  getSalePremiumEnabled: async () => true,
  getPreorderDefaultEnabled: async () => false,
  getStockDisplayPercent: async () => mockStockPercent,
  resolvePreorderAllowed: () => false,
  marketplaceDocWhere: () => " AND creator_code='market'",
}));
const { signToken } = require('../../src/auth/token');
const { runMigrations } = require('../../src/db/migrate');
const app = express();
app.use(express.json());
app.use(require('../../src/routes/order'));
app.use(require('../../src/routes/cart'));
const auth = (code = 'C1', typ = 'customer') => `Bearer ${signToken({ sub: code, typ })}`;
const item = (code = 'P1', qty = 1) => ({ item_code: code, item_name: code, unit_code: 'EA', item_type: 0, qty, price: 100, sum_amount: 100 * qty, wh_code: 'W1', shelf_code: 'S1' });
const payload = (id = 'req-1', items = [item()]) => ({ request_id: id, doc_no: `MQT-${id.replace(/:/g, '-')}`, cust_code: 'C1', items, vat_type: 1, vat_rate: 7, address: 'ที่อยู่ทดสอบ', telephone: '053 562 595', emp_code: 'FAKE' });
const send = body => request(app).post('/sendorder').set('Authorization', auth()).send(body);
const confirm = (doc, allocations = [{ line_number: 1, wh_code: 'W2', shelf_code: 'S2' }]) => request(app).post(`/admin/pending-orders/${doc}/confirm`).set('Authorization', auth('EMP', 'employee')).send({ allocations, sale_code: 'FAKE', items: [{ price: 0 }] });

(url ? describe : describe.skip)('pending order transactions (real PostgreSQL)', () => {
  beforeAll(async () => {
    process.env.AUTH_TOKEN_SECRET = 'pending-integration-only';
    // Dedicated disposable DB, guarded by URL above; no production connection is read.
    await mockPool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await mockPool.query(fs.readFileSync(path.join(__dirname, '../fixtures/pending-order.sql'), 'utf8'));
    await runMigrations({ pool: mockPool, migrations: ['create_order_document.sql', 'create_pending_order.sql'] });
  });
  beforeEach(async () => {
    mockDocSource = 'client'; mockMaxLines = 0; mockStockPercent = 100;
    await mockPool.query('TRUNCATE ic_trans,ic_trans_detail,ic_trans_shipment,marketplace_pending_order,marketplace_order_request,marketplace_order_document,ap_ar_trans_detail');
    await mockPool.query("UPDATE ic_inventory_detail SET dimension_38=''");
    await mockPool.query("UPDATE ic_inventory SET name_eng_2='' WHERE code LIKE 'P1-%'");
    await mockPool.query(`TRUNCATE test_physical;
      INSERT INTO test_physical SELECT code,w,s,'EA',1000
      FROM unnest(ARRAY['P1','P2','FREE1','P1-A','P1-B','P1-C']) code
      CROSS JOIN (VALUES ('W1','S1'),('W2','S2')) locations(w,s)`);
  });
  afterAll(() => mockPool.end());

  async function variants() {
    await mockPool.query(`INSERT INTO ic_inventory(code,name_1,name_eng_2,item_pattern,tax_type) VALUES
      ('P1-A','สินค้าจริง A','P1','',0),('P1-B','สินค้าจริง B','P1','',0),('P1-C','สินค้าจริง C','P1','',0),
      ('P1-UNIT','หน่วยต่างกัน','P1','',0),('P1-TAX','ภาษีต่างกัน','P1','',1)
      ON CONFLICT(code) DO UPDATE SET name_eng_2=EXCLUDED.name_eng_2,tax_type=EXCLUDED.tax_type`);
    await mockPool.query("DELETE FROM ic_unit_use WHERE ic_code LIKE 'P1-%'");
    await mockPool.query(`INSERT INTO ic_unit_use(ic_code,code,stand_value,divide_value,ratio) VALUES
      ('P1-A','EA',1,1,1),('P1-B','EA',1,1,1),('P1-C','EA',1,1,1),('P1-UNIT','EA',12,1,12),('P1-TAX','EA',1,1,1)`);
  }

  it('splits a display line into physical codes and locations, preserves money and records source audit', async () => {
    await variants();
    const doc = (await send(payload('variants', [item('P1', 10)]))).body.doc_no;
    const result = await confirm(doc, [
      { line_number: 1, item_code: 'P1-A', qty: 6, wh_code: 'W1', shelf_code: 'S1' },
      { line_number: 1, item_code: 'P1-B', qty: 4, wh_code: 'W2', shelf_code: 'S2' },
    ]);
    expect(result.status).toBe(200);
    const details = (await mockPool.query('SELECT * FROM ic_trans_detail WHERE trans_flag=30 ORDER BY line_number')).rows;
    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({ item_code: 'P1-A', item_name: 'สินค้าจริง A', qty: '6', price: '100', sum_amount: '600', wh_code: 'W1', shelf_code: 'S1', sale_code: 'EMP' });
    expect(details[1]).toMatchObject({ item_code: 'P1-B', qty: '4', sum_amount: '400', wh_code: 'W2', shelf_code: 'S2' });
    const originals = (await mockPool.query('SELECT item_code,qty FROM ic_trans_detail WHERE trans_flag=300')).rows;
    expect(originals).toEqual([{ item_code: 'P1', qty: '10' }]);
    const audit = (await mockPool.query('SELECT metadata FROM marketplace_pending_order')).rows[0].metadata.confirmed_allocations;
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ source_line_number: 1, source_item_code: 'P1', item_code: 'P1-B', qty: 4, qt_line_number: 2 });
    for (const field of ['sum_amount','sum_amount_exclude_vat','total_vat_value','discount_amount']) {
      const sums = (await mockPool.query(`SELECT trans_flag,SUM(${field}) AS amount FROM ic_trans_detail GROUP BY trans_flag ORDER BY trans_flag`)).rows;
      expect(Number(sums[0].amount)).toBe(Number(sums[1].amount));
    }
  });

  it('rejects outside-group, unit/tax mismatch, missing quantities and changed master without partial QT', async () => {
    await variants();
    const doc = (await send(payload('guard', [item('P1', 10)]))).body.doc_no;
    for (const [code, qty] of [['P2', 10], ['P1-UNIT', 10], ['P1-TAX', 10], ['P1-A', 9], ['P1-A', 11]]) {
      expect((await confirm(doc, [{ line_number: 1, item_code: code, qty, wh_code: 'W1', shelf_code: 'S1' }])).status).toBe(400);
    }
    await mockPool.query("UPDATE ic_inventory SET name_eng_2='OTHER' WHERE code='P1-A'");
    expect((await confirm(doc, [{ line_number: 1, item_code: 'P1-A', qty: 10, wh_code: 'W1', shelf_code: 'S1' }])).status).toBe(400);
    expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=30')).rows).toHaveLength(0);
  });

  it('counts the original display quantity for maximum allowance after physical-code confirmation', async () => {
    await variants();
    await mockPool.query("UPDATE ic_inventory_detail SET dimension_38='EA:3' WHERE ic_code='P1'");
    const first = await send(payload('allowance:first', [item('P1', 2)]));
    expect(first.status).toBe(200);
    expect((await confirm(first.body.doc_no, [{ line_number: 1, item_code: 'P1-A', qty: 2, wh_code: 'W1', shelf_code: 'S1' }])).status).toBe(200);
    expect((await send(payload('allowance:second', [item('P1', 2)]))).status).toBe(400);
    // The confirmed source is counted once, not both source and resulting QT.
    expect((await send(payload('allowance:third', [item('P1', 1)]))).status).toBe(200);
  });

  it('splits physical allocations before applying the ERP line limit and preserves zero-price premium groups', async () => {
    await variants(); mockDocSource = 'server'; mockMaxLines = 1;
    const doc = (await send(payload('physical-split', [item('P1', 3)]))).body.doc_no;
    const result = await confirm(doc, ['A','B','C'].map(letter => ({ line_number: 1, item_code: `P1-${letter}`, qty: 1, wh_code: 'W1', shelf_code: 'S1' })));
    expect(result.status).toBe(200);
    expect(result.body.sub_doc_nos).toHaveLength(3);
    expect(Number((await mockPool.query('SELECT SUM(total_amount) AS total FROM ic_trans WHERE trans_flag=30')).rows[0].total)).toBe(300);
    mockMaxLines = 2;
    const promo = (await send(payload('physical-promo', [{ ...item('PROMO', 2), item_type: 4, sale_premium_code: 'PROMO' }]))).body.doc_no;
    const response = await confirm(promo, [
      { line_number: 1, item_code: 'P1-A', qty: 1, wh_code: 'W1', shelf_code: 'S1' },
      { line_number: 1, item_code: 'P1-B', qty: 1, wh_code: 'W1', shelf_code: 'S1' },
      { line_number: 2, wh_code: 'W1', shelf_code: 'S1' },
    ]);
    expect(response.status).toBe(400); // Three inseparable promotion lines exceed two.
    mockMaxLines = 3;
    expect((await confirm(promo, [
      { line_number: 1, item_code: 'P1-A', qty: 1, wh_code: 'W1', shelf_code: 'S1' },
      { line_number: 1, item_code: 'P1-B', qty: 1, wh_code: 'W1', shelf_code: 'S1' },
      { line_number: 2, wh_code: 'W1', shelf_code: 'S1' },
    ])).status).toBe(200);
    expect((await mockPool.query('SELECT price,sum_amount FROM ic_trans_detail WHERE trans_flag=30 AND is_permium=1')).rows[0]).toEqual({ price: '0', sum_amount: '0' });
  });

  it('groups signed physical stock with fallback, warehouse and unit conversion, but options show physical totals', async () => {
    await variants();
    await mockPool.query(`TRUNCATE test_physical;
      INSERT INTO test_physical VALUES ('P1','W1','S1','EA',99),('P1-A','W1','S1','EA',10),('P1-B','W1','S1','EA',-3),('P1-C','W2','S2','EA',5),('P2','W1','S1','EA',4)`);
    try {
      const { groupedStockCtes } = require('../../src/utils/groupedStock');
      const read = async wh => (await mockPool.query(`WITH ${groupedStockCtes("SELECT code AS item_code,$1::text AS wh_code FROM ic_inventory WHERE code IN ('P1','P2')")} SELECT * FROM normal_stock ORDER BY ic_code`, [wh])).rows;
      expect((await read('W1')).map(row => Number(row.balance_qty))).toEqual([7, 4]);
      expect((await read('')).map(row => Number(row.balance_qty))).toEqual([12, 4]);
      await mockPool.query("INSERT INTO ic_unit_use(ic_code,code,stand_value,divide_value,ratio) VALUES ('P1','BOX',2,1,2)");
      const stock = await request(app).post('/getcartitemstock').send({ wh_code: 'W1', items: [{ item_code: 'P1', unit_code: 'EA' }, { item_code: 'P1', unit_code: 'BOX' }, { item_code: 'P2', unit_code: 'EA' }] });
      expect(stock.status).toBe(200);
      expect(Object.fromEntries(stock.body.data.map(row => [`${row.item_code}/${row.unit_code}`, Number(row.balance_qty)]))).toEqual({ 'P1/EA': 7, 'P1/BOX': 3, 'P2/EA': 4 });
      mockStockPercent = 50;
      const reduced = await request(app).post('/getcartitemstock').send({ wh_code: 'W1', items: [{ item_code: 'P1', unit_code: 'BOX' }] });
      expect(Number(reduced.body.data[0].balance_qty)).toBe(1);
      const doc = (await send(payload('stock-options'))).body.doc_no;
      const endpoint = `/admin/pending-orders/${doc}/items/1/options`;
      expect((await request(app).get(endpoint).set('Authorization', auth())).status).toBe(403);
      const result = await request(app).get(endpoint).set('Authorization', auth('EMP', 'employee'));
      expect(result.status).toBe(200);
      expect(result.body.data.options.find(row => row.item_code === 'P1').balance_qty).toBe(99);
      expect(result.body.data.options.find(row => row.item_code === 'P1-B').balance_qty).toBe(-3);
      expect(result.body.data.options.find(row => row.item_code === 'P1-C').locations[0]).toMatchObject({ wh_code: 'W2', shelf_code: 'S2', balance_qty: 5 });
      expect(result.body.data.options.find(row => row.item_code === 'P1-TAX').selectable).toBe(false);
      await mockPool.query("DELETE FROM test_physical WHERE ic_code LIKE 'P1-%'");
      expect(Number((await read('W1'))[0].balance_qty)).toBe(0); // No fallback to parent's 99.
    } finally { await mockPool.query("DELETE FROM ic_unit_use WHERE ic_code='P1' AND code='BOX'"); }
  });

  it('blocks insufficient physical stock without closing 300, then allows retry and idempotent replay', async () => {
    await variants();
    await mockPool.query('TRUNCATE test_physical');
    const submitted = await send(payload('stock-gate', [item('P1', 10)]));
    expect(submitted.status).toBe(200); // Customer requests remain allowed without stock.
    const doc = submitted.body.doc_no;
    await mockPool.query("INSERT INTO test_physical VALUES ('P1','W1','S1','EA',999),('P1-A','W1','S1','EA',5),('P1-B','W2','S2','EA',4)");
    const allocations = [
      { line_number: 1, item_code: 'P1-A', qty: 6, wh_code: 'W1', shelf_code: 'S1' },
      { line_number: 1, item_code: 'P1-B', qty: 4, wh_code: 'W2', shelf_code: 'S2' },
    ];
    const rejected = await confirm(doc, allocations);
    expect(rejected.status).toBe(422);
    expect(rejected.body).toMatchObject({ success: false, code: 'INSUFFICIENT_STOCK', stock_issues: [{ item_code: 'P1-A', required_qty: 6, available_qty: 5 }] });
    expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=30')).rows).toHaveLength(0);
    expect((await mockPool.query('SELECT * FROM marketplace_order_document')).rows).toHaveLength(0);
    expect((await mockPool.query('SELECT status FROM marketplace_pending_order')).rows[0].status).toBe('pending');
    expect((await mockPool.query('SELECT last_status FROM ic_trans WHERE trans_flag=300')).rows[0].last_status).toBe(0);
    await mockPool.query("UPDATE test_physical SET balance_qty=6 WHERE ic_code='P1-A'");
    expect((await confirm(doc, allocations)).status).toBe(200);
    await mockPool.query('TRUNCATE test_physical');
    const replay = await confirm(doc, allocations);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  it('checks total demand across a normal line, free goods and expanded set components', async () => {
    const doc = (await send(payload('stock-set', [item('P1', 2), { ...item('SET1', 2), item_type: 3 }, { ...item('PROMO'), item_type: 4, sale_premium_code: 'PROMO' }]))).body.doc_no;
    const detail = await request(app).get(`/pending-orders/${doc}`).set('Authorization', auth('EMP', 'employee'));
    const allocations = detail.body.data.items.map(row => ({ line_number: row.line_number, wh_code: 'W2', shelf_code: 'S2' }));
    await mockPool.query("UPDATE test_physical SET balance_qty=CASE WHEN ic_code='P1' THEN 4 WHEN ic_code='FREE1' THEN 0 ELSE balance_qty END WHERE ic_warehouse='W2'");
    const result = await confirm(doc, allocations);
    expect(result.status).toBe(422);
    expect(result.body.stock_issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ item_code: 'P1', required_qty: 5, available_qty: 4 }),
      expect.objectContaining({ item_code: 'FREE1', required_qty: 1, available_qty: 0 }),
    ]));
    await mockPool.query("UPDATE test_physical SET balance_qty=CASE WHEN ic_code='P1' THEN 5 WHEN ic_code='FREE1' THEN 1 WHEN ic_code='P2' THEN 4 ELSE balance_qty END WHERE ic_warehouse='W2'");
    expect((await confirm(doc, allocations)).status).toBe(200);
  });

  it('fails closed when the stock function is unavailable and permits retry without losing the request', async () => {
    const doc = (await send(payload('stock-failure'))).body.doc_no;
    await mockPool.query('ALTER FUNCTION sml_ic_function_stock_balance_warehouse_location(date,text,text,text) RENAME TO test_stock_offline');
    try {
      const result = await confirm(doc);
      expect(result.status).toBe(503);
      expect(result.body.code).toBe('STOCK_UNAVAILABLE');
      expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=30')).rows).toHaveLength(0);
      expect((await mockPool.query('SELECT status FROM marketplace_pending_order')).rows[0].status).toBe('pending');
    } finally {
      await mockPool.query('ALTER FUNCTION test_stock_offline(date,text,text,text) RENAME TO sml_ic_function_stock_balance_warehouse_location');
    }
    expect((await confirm(doc)).status).toBe(200);
  });

  it('creates only 300, clears allocation, preserves amounts/shipment and deduplicates concurrent checkout', async () => {
    const responses = await Promise.all([send(payload()), send(payload())]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(responses[0].body.doc_no).toMatch(/^MPR\d+$/);
    expect(responses[1].body.doc_no).toBe(responses[0].body.doc_no);
    const { rows } = await mockPool.query('SELECT * FROM ic_trans');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trans_flag: 300, sale_code: '', total_amount: '100' });
    expect((await mockPool.query('SELECT wh_code,shelf_code FROM ic_trans_detail')).rows[0]).toEqual({ wh_code: '', shelf_code: '' });
    expect((await mockPool.query('SELECT transport_telephone FROM ic_trans_shipment')).rows[0].transport_telephone).toBe('053 562 595');
  });

  it('reserves client QT numbers and fails a second request without writing another document', async () => {
    await send(payload());
    const response = await send({ ...payload('req-2'), doc_no: 'MQT-req-1' });
    expect(response.status).toBe(409);
    expect((await mockPool.query('SELECT * FROM ic_trans')).rows).toHaveLength(1);
  });

  it('does not treat an unrelated existing QT as a successful new checkout', async () => {
    await mockPool.query("INSERT INTO ic_trans(doc_no,trans_flag,doc_format_code,cust_code) VALUES ('MQT-req-1',30,'QT','C1')");
    expect((await send(payload())).status).toBe(409);
    expect((await mockPool.query('SELECT * FROM marketplace_pending_order')).rows).toHaveLength(0);
  });

  it('confirms exactly once, trusts persisted prices, uses authenticated employee, retains audit and flows to SO', async () => {
    const doc = (await send(payload())).body.doc_no;
    const results = await Promise.all([confirm(doc), confirm(doc)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    const quotes = (await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=30')).rows;
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ doc_no: 'MQT-req-1', doc_ref: doc, sale_code: 'EMP', doc_format_code: 'QT', total_amount: '100' });
    const saved = (await mockPool.query('SELECT * FROM ic_trans_detail WHERE trans_flag=30')).rows[0];
    expect(saved).toMatchObject({ sale_code: 'EMP', wh_code: 'W2', shelf_code: 'S2', price: '100' });
    expect((await mockPool.query('SELECT last_status FROM ic_trans WHERE trans_flag=300')).rows[0].last_status).toBe(1);
    await mockPool.query("INSERT INTO ap_ar_trans_detail VALUES ('SO-TEST',$1,36)", [quotes[0].doc_no]);
    expect((await mockPool.query('SELECT t.doc_ref FROM ic_trans t JOIN ap_ar_trans_detail a ON a.billing_no=t.doc_no WHERE t.trans_flag=30 AND a.trans_flag=36')).rows[0].doc_ref).toBe(doc);
  });

  it('validates every allocation and master relationship before checking stock', async () => {
    const doc = (await send(payload())).body.doc_no;
    for (const allocation of [[], [{ line_number: 1, wh_code: 'W1', shelf_code: 'S2' }], [{ line_number: 99, wh_code: 'W1', shelf_code: 'S1' }]]) {
      expect((await confirm(doc, allocation)).status).toBe(400);
    }
    expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=30')).rows).toHaveLength(0);
    expect((await confirm(doc)).status).toBe(200);
  });

  it('serializes customer cancellation racing confirmation and does not create SOC', async () => {
    const doc = (await send(payload())).body.doc_no;
    const responses = await Promise.all([confirm(doc), request(app).post(`/pending-orders/${doc}/cancel`).set('Authorization', auth()).send({})]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const state = (await mockPool.query('SELECT status FROM marketplace_pending_order')).rows[0].status;
    expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=30')).rows.length).toBe(state === 'confirmed' ? 1 : 0);
    expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=31')).rows).toHaveLength(0);
  });

  it('rejects with a required reason, hides confirmed requests and restricts customer/employee access even when AUTH_MODE=off', async () => {
    process.env.AUTH_MODE = 'off';
    const doc = (await send(payload())).body.doc_no;
    expect((await request(app).get('/admin/pending-orders')).status).toBe(401);
    expect((await request(app).get('/admin/pending-orders').set('Authorization', auth())).status).toBe(403);
    expect((await request(app).get('/admin/pending-orders').set('Authorization', auth('OTHER', 'employee'))).status).toBe(403);
    expect((await request(app).get(`/pending-orders/${doc}`).set('Authorization', auth('C2'))).status).toBe(403);
    const reject = reason => request(app).post(`/admin/pending-orders/${doc}/reject`).set('Authorization', auth('EMP', 'employee')).send({ reason });
    expect((await reject('')).status).toBe(400);
    expect((await reject('จัดหาไม่ได้')).status).toBe(200);
    expect((await confirm(doc)).status).toBe(409);
    const history = await request(app).get('/pending-orders').set('Authorization', auth());
    expect(history.body.data[0]).toMatchObject({ status: 'rejected', reason: 'จัดหาไม่ได้' });
    const next = (await send(payload('req-2'))).body.doc_no;
    await confirm(next);
    const after = await request(app).get('/pending-orders').set('Authorization', auth());
    expect(after.body.data.map(row => row.doc_no)).toEqual([doc]);
  });

  it('preserves product set parent/component links, stored child amounts and shared warehouse', async () => {
    const doc = (await send(payload('set', [{ ...item('SET1', 2), item_type: 3 }]))).body.doc_no;
    expect(doc).toBeTruthy();
    expect((await confirm(doc)).status).toBe(200);
    const rows = (await mockPool.query('SELECT * FROM ic_trans_detail WHERE trans_flag=30 ORDER BY line_number')).rows;
    expect(rows).toHaveLength(3);
    expect(rows[1].set_ref_line).toBe(rows[0].ref_guid);
    expect(rows[2]).toMatchObject({ qty: '4', price: '0', sum_amount: '0', stand_value: '1', divide_value: '1', ratio: '0' });
    expect(rows.every(row => row.wh_code === 'W2' && row.shelf_code === 'S2' && row.sale_code === 'EMP')).toBe(true);
  });

  it('server numbering splits documents and keeps product sets and promotion groups intact', async () => {
    mockDocSource = 'server'; mockMaxLines = 3;
    const response = await send(payload('split', [item(), { ...item('SET1'), item_type: 3 }, { ...item('PROMO'), item_type: 4, sale_premium_code: 'PROMO' }]));
    if (!response.body.success) throw new Error(JSON.stringify(response.body));
    expect(response.status).toBe(200);
    const doc = response.body.doc_no;
    const detail = await request(app).get(`/pending-orders/${doc}`).set('Authorization', auth('EMP', 'employee'));
    const allocations = detail.body.data.items.map(row => ({ line_number: row.line_number, wh_code: 'W1', shelf_code: 'S1' }));
    const result = await confirm(doc, allocations);
    expect(result.status).toBe(200);
    expect(result.body.sub_doc_nos).toHaveLength(3);
    const amounts = (await mockPool.query('SELECT SUM(total_amount) AS total FROM ic_trans WHERE trans_flag=30')).rows[0];
    expect(Number(amounts.total)).toBe(300);
    const free = (await mockPool.query('SELECT * FROM ic_trans_detail WHERE trans_flag=30 AND is_permium=1')).rows[0];
    expect(free).toMatchObject({ price: '0', sum_amount: '0' });
    expect((await mockPool.query('SELECT item_code FROM ic_trans_detail WHERE doc_no=$1 AND trans_flag=30', [free.doc_no])).rows.map(row => row.item_code)).toEqual(['P1', 'FREE1']);
  });

  it('rolls back a failed write without closing 300 or leaving partial QT data', async () => {
    const doc = (await send(payload())).body.doc_no;
    await mockPool.query("ALTER TABLE ic_trans_detail ADD CONSTRAINT test_qt_failure CHECK (trans_flag<>30)");
    try {
      expect((await confirm(doc)).status).toBe(500);
      expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=30')).rows).toHaveLength(0);
      expect((await mockPool.query('SELECT status FROM marketplace_pending_order')).rows[0].status).toBe('pending');
    } finally { await mockPool.query('ALTER TABLE ic_trans_detail DROP CONSTRAINT test_qt_failure'); }
  });

  it('server numbering skips a QT reserved by an unconfirmed client request', async () => {
    const { serverDocDate } = require('../../src/utils/serverTime');
    const { buildDocPattern } = require('../../src/utils/orderDocNo');
    const prefix = buildDocPattern('BSWYYMMDD', serverDocDate());
    expect((await send({ ...payload('reserved'), doc_no: `${prefix}0001` })).status).toBe(200);
    mockDocSource = 'server';
    const doc = (await send(payload('server-next'))).body.doc_no;
    const result = await confirm(doc);
    expect(result.status).toBe(200);
    expect(result.body.doc_no).toBe(`${prefix}0002`);
  });

  it('serializes rejection racing confirmation with only one terminal outcome', async () => {
    const doc = (await send(payload())).body.doc_no;
    const results = await Promise.all([
      confirm(doc),
      request(app).post(`/admin/pending-orders/${doc}/reject`).set('Authorization', auth('EMP', 'employee')).send({ reason: 'ไม่สามารถจัดสินค้าได้' }),
    ]);
    expect(results.map(row => row.status).sort()).toEqual([200, 409]);
    const state = (await mockPool.query('SELECT status FROM marketplace_pending_order')).rows[0].status;
    expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=30')).rows.length).toBe(state === 'confirmed' ? 1 : 0);
    expect((await mockPool.query('SELECT * FROM ic_trans WHERE trans_flag=31')).rows).toHaveLength(0);
  });

  it('preserves the submitted discount and VAT snapshot without reading current product prices or taxes', async () => {
    const response = await send({ ...payload('snapshot'), discount_word: '10%', discount_type: 1 });
    expect(response.status).toBe(200);
    const fields = 'total_value,total_discount,total_before_vat,total_vat_value,total_after_vat,total_except_vat,total_amount';
    const original = (await mockPool.query(`SELECT ${fields} FROM ic_trans WHERE trans_flag=300`)).rows[0];
    await mockPool.query("UPDATE ic_inventory SET tax_type=1 WHERE code='P1'");
    try {
      expect((await confirm(response.body.doc_no)).status).toBe(200);
      const saved = (await mockPool.query(`SELECT ${fields} FROM ic_trans WHERE trans_flag=30`)).rows[0];
      expect(saved).toEqual(original);
    } finally { await mockPool.query("UPDATE ic_inventory SET tax_type=0 WHERE code='P1'"); }
  });

  it('counts pending quantities across the same checkout and serializes split client requests', async () => {
    await mockPool.query(`UPDATE ic_inventory_detail SET dimension_38='EA:3' WHERE ic_code='P1'`);
    const results = await Promise.all([send(payload('checkout:ready', [item('P1', 2)])), send(payload('checkout:preorder', [item('P1', 2)]))]);
    expect(results.map(row => row.status).sort()).toEqual([200, 400]);
    expect((await mockPool.query('SELECT * FROM marketplace_pending_order')).rows).toHaveLength(1);
  });

  it('migration can be replayed and its runner is idempotent', async () => {
    await mockPool.query(fs.readFileSync(path.join(__dirname, '../../src/db/migrations/create_pending_order.sql'), 'utf8'));
    const result = await runMigrations({ pool: mockPool, migrations: ['create_order_document.sql', 'create_pending_order.sql'] });
    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(2);
  });

  it.each([[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1], [2, 0, 0], [2, 1, 1]])('preserves full snapshot totals when splitting discounted mixed VAT lines (%s/%s/%s)', async (vat_type, discount_type, discount_vat_type) => {
    await variants();
    mockDocSource = 'server'; mockMaxLines = 1;
    await mockPool.query("UPDATE ic_inventory SET tax_type=1 WHERE code='P2'");
    try {
      const response = await send({ ...payload('split-discount', [item('P1'), item('P2')]), vat_type, discount_type, discount_vat_type, discount_word: '10%' });
      expect(response.status).toBe(200);
      const fields = ['total_value', 'total_discount', 'total_before_vat', 'total_vat_value', 'total_after_vat', 'total_except_vat', 'total_amount'];
      const original = (await mockPool.query(`SELECT ${fields.join(',')} FROM ic_trans WHERE trans_flag=300`)).rows[0];
      const result = await confirm(response.body.doc_no, [
        { line_number: 1, item_code: 'P1-A', qty: 0.333, wh_code: 'W1', shelf_code: 'S1' },
        { line_number: 1, item_code: 'P1-B', qty: 0.667, wh_code: 'W2', shelf_code: 'S2' },
        { line_number: 2, wh_code: 'W1', shelf_code: 'S1' },
      ]);
      expect(result.status).toBe(200);
      expect(result.body.sub_doc_nos).toHaveLength(3);
      const saved = (await mockPool.query(`SELECT ${fields.map(field => `SUM(${field}) AS ${field}`).join(',')} FROM ic_trans WHERE trans_flag=30`)).rows[0];
      for (const field of fields) expect(Number(saved[field])).toBe(Number(original[field]));
    } finally { await mockPool.query("UPDATE ic_inventory SET tax_type=0 WHERE code='P2'"); }
  });
});
