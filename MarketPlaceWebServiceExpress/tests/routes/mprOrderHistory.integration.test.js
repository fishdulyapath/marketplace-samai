const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const url = process.env.PENDING_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/samai_pending_test') throw new Error('Disposable local database required');
}
const mockPool = new Pool({ connectionString: url });
jest.mock('../../src/db', () => ({ pool: mockPool, query: (...args) => mockPool.query(...args) }));
jest.mock('../../src/utils/adminPermissions', () => ({ getAdminPermissionsForUser: async code => ({ permissions: code === 'EMP' ? ['admin.orders'] : [] }) }));
jest.mock('../../src/utils/marketplaceSalesSettings', () => ({ marketplaceDocWhere: alias => ` AND ${alias}.creator_code='market'` }));
const { signToken } = require('../../src/auth/token');
const { runMigrations } = require('../../src/db/migrate');
const app = express(); app.use(express.json()); app.use(require('../../src/routes/order'));
const get = (url, staff = false) => request(app).get(url).set('Authorization', `Bearer ${signToken({ sub: staff ? 'EMP' : 'C1', typ: staff ? 'employee' : 'customer' })}`);

(url ? describe : describe.skip)('MPR history read model against PostgreSQL', () => {
  beforeAll(async () => {
    process.env.AUTH_TOKEN_SECRET = 'local-history-integration';
    await mockPool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    for (const fixture of ['pending-order.sql', 'mpr-history.sql']) await mockPool.query(fs.readFileSync(path.join(__dirname, '../fixtures', fixture), 'utf8'));
    await runMigrations({ pool: mockPool, migrations: ['create_order_document.sql', 'create_pending_order.sql'] });
  });
  afterAll(() => mockPool.end());
  beforeEach(async () => {
    await mockPool.query('TRUNCATE ic_trans,ic_trans_detail,ic_trans_shipment,marketplace_pending_order,marketplace_order_document,ap_ar_trans_detail,cb_trans');
    await mockPool.query(`INSERT INTO ic_trans(doc_no,trans_flag,doc_date,doc_time,cust_code,creator_code,total_amount,total_before_vat,total_after_vat,total_vat_value,total_except_vat,inquiry_type) VALUES
      ('MPR1',300,'2026-09-28','10:00','C1','market',100,100,100,0,0,0),
      ('BSW2609300001-1',30,'2026-09-30','11:00','C1','market',60,60,60,0,0,0),
      ('BSW2609300001-2',30,'2026-09-30','11:00','C1','market',40,40,40,0,0,0),
      ('MQT-OLD',30,'2026-09-28','09:00','C1','market',50,50,50,0,0,0),
      ('MPR2',300,'2026-09-29','10:00','C1','market',20,20,20,0,0,0);
      UPDATE ic_trans SET doc_ref='MPR1' WHERE trans_flag=30 AND doc_no <> 'MQT-OLD';
      INSERT INTO marketplace_pending_order(doc_no,request_id,cust_code,doc_source,status,qt_doc_no,qt_doc_nos,metadata) VALUES
      ('MPR1','request1','C1','server','confirmed','BSW2609300001','["BSW2609300001-1","BSW2609300001-2"]',
      '{"confirmed_allocations":[{"source_line_number":1,"source_item_code":"DISPLAY","qt_doc_no":"BSW2609300001-1","qt_line_number":1,"item_code":"A"},{"source_line_number":1,"source_item_code":"DISPLAY","qt_doc_no":"BSW2609300001-2","qt_line_number":1,"item_code":"B"}]}'),
      ('MPR2','request2','C1','server','pending',NULL,'[]','{}');
      INSERT INTO ic_trans_detail(doc_no,trans_flag,line_number,item_code,item_name,unit_code,qty,price,sum_amount,wh_code,shelf_code) VALUES
      ('MPR1',300,1,'DISPLAY','Original product','EA',10,10,100,'',''),
      ('MPR2',300,1,'DISPLAY','Original product','EA',2,10,20,'',''),
      ('BSW2609300001-1',30,1,'A','Actual A','EA',6,10,60,'W1','S1'),
      ('BSW2609300001-2',30,1,'B','Actual B','EA',4,10,40,'W2','S2'),
      ('MQT-OLD',30,1,'OLD','Legacy product','EA',5,10,50,'W1','S1');`);
  });
  test('list merges pending, confirmed and legacy; excludes linked QTs', async () => {
    const response = await get('/getOrderHistory?view=mpr');
    expect(response.status).toBe(200);
    expect(response.body.data.map(row => row.doc_no)).toEqual(['MPR2', 'MPR1', 'MQT-OLD']);
    expect(response.body.total_orders).toBe(3);
    expect(response.body.page_amount).toBe(170);
    expect(response.body.data.find(row => row.doc_no === 'MQT-OLD').contact_telephone).toBe('053 562 595');
  });
  test('dates filter original MPR, never reintroduce QT on its confirmation date', async () => {
    const response = await get('/admin/orders?view=mpr&date_from=2026-09-30&date_to=2026-09-30', true);
    expect(response.status).toBe(200);
    expect(response.body.total_orders).toBe(0);
    const original = await get('/admin/orders?view=mpr&date_from=2026-09-28&date_to=2026-09-28&search=BSW2609300001-2', true);
    expect(original.body.data.map(row => row.doc_no)).toEqual(['MPR1']);
  });
  test('server search/status/pagination count logical orders', async () => {
    const page = await get('/getOrderHistory?view=mpr&search=Original&page_size=1&page=2');
    expect(page.body.total_orders).toBe(2);
    expect(page.body.data.map(row => row.doc_no)).toEqual(['MPR1']);
    const filtered = await get('/getOrderHistory?view=mpr&status=awaiting_confirmation');
    expect(filtered.body.data.map(row => row.doc_no)).toEqual(['MPR2']);
  });
  test('details expose original to customer and actual allocations only to staff', async () => {
    const customer = await get('/getOrderDetail?view=mpr&doc_no=MPR1');
    expect(customer.status).toBe(200);
    expect(customer.body.data.items[0].item_code).toBe('DISPLAY');
    expect(JSON.stringify(customer.body)).not.toMatch(/Actual A|Actual B|qt_allocations/);
    const staff = await get('/admin/orders/MPR1/items', true);
    expect(staff.status).toBe(200);
    expect(staff.body.data.items[0].qt_allocations.map(row => row.item_code)).toEqual(['A', 'B']);
    expect(staff.body.paging.total_items).toBe(1);
  });
  test('legacy details work through authenticated staff and customer paths', async () => {
    for (const [url, staff] of [['/admin/orders/MQT-OLD/items?cust_code=C1', true], ['/getOrderDetail?view=mpr&doc_no=MQT-OLD', false]]) {
      const response = await get(url, staff);
      expect(response.status).toBe(200);
      expect(response.body.data.items[0].item_code).toBe('OLD');
    }
  });
  test('SO and invoices progress normally, payments retain real invoice references', async () => {
    await mockPool.query(`INSERT INTO ic_trans(doc_no,trans_flag,doc_date,cust_code,total_amount,total_before_vat,inquiry_type) VALUES
      ('SO1',36,'2026-09-30','C1',60,60,0),('SO2',36,'2026-09-30','C1',40,40,0),
      ('INV1',44,'2026-09-30','C1',60,60,0),('INV2',44,'2026-09-30','C1',40,40,0);
      INSERT INTO ap_ar_trans_detail(doc_no,billing_no,trans_flag,doc_date) VALUES
      ('SO1','BSW2609300001-1',36,'2026-09-30'),('SO2','BSW2609300001-2',36,'2026-09-30'),
      ('INV1','SO1',44,'2026-09-30'),('INV2','SO2',44,'2026-09-30');
      INSERT INTO ic_trans_detail(doc_no,trans_flag,line_number,item_code,unit_code,qty) VALUES ('SO1',36,1,'A','EA',6),('SO2',36,1,'B','EA',4);`);
    const response = await get('/getOrderHeader?view=mpr&doc_no=MPR1');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'payment', balance: 100, total_amount: 100 });
    expect(response.body.data.payment_documents.map(row => row.doc_no).sort()).toEqual(['INV1', 'INV2']);
    const detail = await get('/getOrderDetail?view=mpr&doc_no=MPR1');
    expect(detail.body.data.items[0]).toMatchObject({ ship_state: 'full', shipped_qty: 10 });
    await mockPool.query(`INSERT INTO ap_ar_trans_detail(doc_no,billing_no,billing_date,trans_flag,sum_pay_money) VALUES
      ('RC1','INV1','2026-09-30',239,60),('RC1','INV2','2026-09-30',239,40)`);
    const paid = await get('/getOrderHeader?view=mpr&doc_no=MPR1');
    expect(paid.body.data).toMatchObject({ status: 'success', balance: 0, payment_documents: [] });
  });
  test('cancelled request and rejected reason survive unified history', async () => {
    for (const status of ['cancelled', 'rejected']) {
      await mockPool.query("UPDATE marketplace_pending_order SET status=$1,reason='เหตุผลทดสอบ' WHERE doc_no='MPR2'", [status]);
      const response = await get('/getOrderHistory?view=mpr&status=' + status);
      expect(response.body.data[0]).toMatchObject({ doc_no: 'MPR2', status, reason: 'เหตุผลทดสอบ', can_cancel: false });
    }
  });
  test('partial QT cancellation keeps one MPR and cancelling all uses ERP cancel status', async () => {
    await mockPool.query("UPDATE ic_trans SET last_status=1 WHERE doc_no='MPR1'; INSERT INTO ic_trans(doc_no,trans_flag,doc_ref) VALUES ('SOC1',31,'BSW2609300001-1')");
    const partial = await get('/getOrderHeader?view=mpr&doc_no=MPR1');
    expect(partial.body.data).toMatchObject({ status: 'pending', request_status: 'confirmed', total_amount: 100, cancelled_amount: 60, active_amount: 40, can_cancel: false });
    await mockPool.query("INSERT INTO ic_trans(doc_no,trans_flag,doc_ref) VALUES ('SOC2',31,'BSW2609300001-2')");
    const all = await get('/getOrderHeader?view=mpr&doc_no=MPR1');
    expect(all.body.data).toMatchObject({ status: 'cancel', request_status: 'confirmed', total_amount: 100, cancelled_amount: 100 });
  });
  test('cash invoice stays paid without an AR receipt, partial cash still has outstanding money', async () => {
    await mockPool.query(`INSERT INTO ic_trans(doc_no,trans_flag,doc_date,cust_code,total_amount,inquiry_type) VALUES
      ('SO1',36,'2026-09-30','C1',60,0),('INV1',44,'2026-09-30','C1',60,0);
      INSERT INTO ap_ar_trans_detail(doc_no,billing_no,trans_flag,doc_date) VALUES ('SO1','BSW2609300001-1',36,'2026-09-30'),('INV1','SO1',44,'2026-09-30');
      INSERT INTO cb_trans(doc_no,trans_flag,total_amount_pay) VALUES ('INV1',44,60)`);
    const paid = await get('/getOrderHeader?view=mpr&doc_no=MPR1');
    expect(paid.body.data.balance).toBe(0);
    expect(paid.body.data.payment_documents).toEqual([]);
    await mockPool.query("UPDATE cb_trans SET total_amount_pay=20 WHERE doc_no='INV1'");
    const partial = await get('/getOrderHeader?view=mpr&doc_no=MPR1');
    expect(partial.body.data.balance).toBe(40);
    expect(partial.body.data.payment_documents).toEqual([{ doc_no: 'INV1', doc_date: '2026-09-30', total_amount: 40 }]);
  });
  test('missing audit exposes no actual products to customer; staff sees unmatched QT rows', async () => {
    await mockPool.query("UPDATE marketplace_pending_order SET metadata='{}' WHERE doc_no='MPR1'");
    const customer = await get('/getOrderDetail?view=mpr&doc_no=MPR1');
    expect(customer.body.data.items[0].item_code).toBe('DISPLAY');
    expect(customer.body.data).not.toHaveProperty('unmapped_items');
    const staff = await get('/admin/orders/MPR1/items', true);
    expect(staff.body.data.items[0].qt_allocations).toEqual([]);
    expect(staff.body.data.unmapped_items.map(row => row.item_code)).toEqual(['A', 'B']);
  });
  test('other customers cannot read a request through either its MPR or QT alias', async () => {
    for (const doc of ['MPR1', 'BSW2609300001-1']) {
      const response = await request(app).get('/getOrderHeader?view=mpr&doc_no=' + doc)
        .set('Authorization', `Bearer ${signToken({ sub: 'C2', typ: 'customer' })}`);
      expect(response.status).toBe(200);
      expect(response.body.data).toBeNull();
    }
  });
});
