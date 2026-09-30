// Authorized demo only. Default is a dry run; --apply retains product fixtures.
// No credentials, app .env, stock documents or existing prices are changed.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { groupedStockCtes, readPhysicalStock } = require('../src/utils/groupedStock');
const { loadOptions, normalizeAllocations, allocateLines } = require('../src/utils/pendingAllocations');
const parent = 'SAMAI-TEST-001';
const members = ['G04-0001', 'G04-0002', 'G04-0003'];
const title = 'ทดสอบสมัย: น้ำยาปรับผ้านุ่ม 500มล. (เลือกสีหลังบ้าน)';
async function main() {
  assert.equal(process.env.SAMAI_DEMO_HOST, 'nextstep.iszai.com');
  assert.equal(process.env.SAMAI_DEMO_DATABASE, 'demo');
  assert.equal(process.env.SAMAI_DEMO_PORT, '6843');
  const db = new Client({ host: process.env.SAMAI_DEMO_HOST, port: 6843, database: 'demo',
    user: process.env.SAMAI_DEMO_USER, password: process.env.SAMAI_DEMO_PASSWORD,
    connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('samai-variant-demo-fixture'))");
    const originals = (await db.query('SELECT code,name_1,name_eng_2,unit_standard,tax_type FROM ic_inventory WHERE code=ANY($1) ORDER BY code FOR UPDATE', [members])).rows;
    assert.equal(originals.length, 3);
    for (const row of originals) {
      assert.ok(!row.name_eng_2 || row.name_eng_2 === parent, `Refusing to replace existing group for ${row.code}`);
      assert.equal(row.unit_standard, originals[0].unit_standard);
      assert.equal(row.tax_type, originals[0].tax_type);
    }
    console.log('Member mapping before:', JSON.stringify(originals));
    const existing = (await db.query('SELECT name_1 FROM ic_inventory WHERE code=$1', [parent])).rows;
    if (existing.length) assert.equal(existing[0].name_1, title, 'Fixture code belongs to another product');
    else {
      // Clone only a fixed allowlist of product tables, omitting serial/audit IDs.
      const clone = async (table, key, changes = {}) => {
        assert.ok(['ic_inventory','ic_inventory_detail','ic_unit_use','ic_inventory_price','ic_inventory_barcode'].includes(table));
        const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name NOT IN ('roworder','create_date_time_now') AND is_generated='NEVER' ORDER BY ordinal_position", [table])).rows.map(r => r.column_name);
        const values = [members[0], parent];
        const fields = columns.map(column => {
          if (column === key) return '$2';
          if (Object.hasOwn(changes, column)) { values.push(changes[column]); return `$${values.length}`; }
          return `"${column}"`;
        });
        await db.query(`INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(',')}) SELECT ${fields.join(',')} FROM ${table} WHERE "${key}"=$1`, values);
      };
      await clone('ic_inventory', 'code', { name_1: title, name_2: '', name_eng_1: '', name_eng_2: '', item_pattern: '[W]', balance_qty: 0 });
      await clone('ic_inventory_detail', 'ic_code', { dimension_38: '', dimension_39: '', dimension_41: '0' });
      await clone('ic_unit_use', 'ic_code');
      await clone('ic_inventory_price', 'ic_code');
      // Use distinct barcode per sale unit; never duplicate a real barcode.
      const barcodes = (await db.query('SELECT DISTINCT unit_code,price,price_member_3 FROM ic_inventory_barcode WHERE ic_code=$1 ORDER BY unit_code', [members[0]])).rows;
      for (const [index, row] of barcodes.entries()) await db.query('INSERT INTO ic_inventory_barcode(ic_code,barcode,unit_code,price,price_member_3) VALUES($1,$2,$3,$4,$5)', [parent, `${parent}-${index + 1}`, row.unit_code, row.price, row.price_member_3]);
    }
    await db.query('UPDATE ic_inventory SET name_eng_2=$1 WHERE code=ANY($2)', [parent, members]);
    const physical = await readPhysicalStock(db, [parent, ...members]);
    console.log('Physical stock:', JSON.stringify(physical));
    const expected = physical.filter(r => members.includes(r.ic_code)).reduce((n, r) => n + Number(r.balance_qty), 0);
    const grouped = (await db.query(`WITH ${groupedStockCtes('SELECT $1::text AS item_code,$2::text AS wh_code')} SELECT balance_qty FROM normal_stock`, [parent, ''])).rows;
    assert.equal(Number(grouped[0].balance_qty), expected);
    const source = { line_number: 1, item_code: parent, unit_code: originals[0].unit_standard,
      tax_type: originals[0].tax_type, item_type: 0, stand_value: 1, divide_value: 1,
      qty: 10, price: 100, sum_amount: 999, discount: '1', discount_amount: 1,
      sum_amount_exclude_vat: 933.64, total_vat_value: 65.36, sub_item: [] };
    const options = await loadOptions(db, source, { stock: true });
    assert.equal(options.stock_error, '');
    assert.equal(options.options.find(r => r.item_code === parent).balance_qty, 0);
    for (const code of members) assert.equal(options.options.find(r => r.item_code === code).selectable, true);
    const allocation = members.slice(0, 2).map((code, i) => {
      const location = options.options.find(r => r.item_code === code).locations.find(r => r.balance_qty > 0);
      assert.ok(location, `No positive stock location for ${code}`);
      return { line_number: 1, item_code: code, qty: i ? 4 : 6, wh_code: location.wh_code, shelf_code: location.shelf_code };
    });
    const allocated = await allocateLines(db, [source], normalizeAllocations([source], allocation));
    assert.equal(allocated.reduce((sum, r) => sum + r.sum_amount, 0), 999);
    console.log('Grouped stock:', expected, source.unit_code);
    console.log('Validated allocations:', JSON.stringify(allocated.map(r => ({ code: r.item_code, qty: r.qty, wh: r.wh_code, shelf: r.shelf_code, amount: r.sum_amount }))));

    // Exercise actual HTTP read routes against ERP; rollback any lazy table setup.
    await db.query('SAVEPOINT route_reads');
    const modulePath = require.resolve('../src/db');
    const connection = { query: (...args) => db.query(...args), release() {} };
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: {
      query: connection.query, pool: { query: connection.query, connect: async () => connection },
      withTransaction: async callback => {
        await db.query('SAVEPOINT api_action');
        try { const result = await callback(connection); await db.query('RELEASE SAVEPOINT api_action'); return result; }
        catch (error) { await db.query('ROLLBACK TO SAVEPOINT api_action'); throw error; }
      },
    } };
    const express = require('express');
    const request = require('supertest');
    const app = express(); app.use(express.json());
    app.use(require('../src/routes/product'));
    app.use(require('../src/routes/cart'));
    for (const isstock of ['', '1']) {
      const response = await request(app).get('/getProductList').query({ search: parent, isstock });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const display = response.body.data.find(r => r.item_code === parent);
      assert.ok(display, 'Display product absent from list');
      console.log('Product list stock/filter:', isstock || 'all', display.balance_qty);
    }
    const location = allocation[0];
    const detail = await request(app).get('/getProductDetail').query({ item_code: parent, wh_code: location.wh_code });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.ok(detail.body.data.length);
    console.log('Detail units:', JSON.stringify(detail.body.data.map(r => ({ unit: r.unit_code, balance: r.balance_qty, price: r.price }))));
    const cart = await request(app).post('/getcartitemstock').send({ wh_code: location.wh_code, items: [{ item_code: parent, unit_code: source.unit_code }] });
    assert.equal(cart.status, 200, JSON.stringify(cart.body));
    assert.equal(Number(cart.body.data[0].balance_qty), Number(detail.body.data.find(r => r.unit_code === source.unit_code).balance_qty));
    console.log('Cart stock:', JSON.stringify(cart.body.data));

    // Actual checkout/approval SQL, real ERP master and local test tokens only.
    // Migrations and all MPR/QT writes stay inside the rollback savepoint.
    const fs = require('node:fs');
    const path = require('node:path');
    for (const file of ['create_order_document.sql', 'create_pending_order.sql']) {
      await db.query(fs.readFileSync(path.join(__dirname, '../src/db/migrations', file), 'utf8'));
    }
    app.use(require('../src/routes/order'));
    process.env.AUTH_TOKEN_SECRET = require('node:crypto').randomBytes(32).toString('hex');
    const { signToken } = require('../src/auth/token');
    const customer = (await db.query("SELECT code FROM ar_customer WHERE code<>'' ORDER BY code LIMIT 1")).rows[0].code;
    const employee = (await db.query("SELECT u.code FROM erp_user u LEFT JOIN marketplace_admin_permission p ON UPPER(p.user_code)=UPPER(u.code) WHERE u.code<>'' AND (UPPER(u.code)='SUPERADMIN' OR p.user_code IS NULL OR p.permissions ? 'admin.orders') ORDER BY u.code LIMIT 1")).rows[0]?.code;
    assert.ok(employee, 'No existing employee with admin.orders permission; no permissions will be modified');
    const customerAuth = `Bearer ${signToken({ sub: customer, typ: 'customer' })}`;
    const employeeAuth = `Bearer ${signToken({ sub: employee, typ: 'employee' })}`;
    const barcode = detail.body.data.find(r => r.unit_code === source.unit_code).barcode;
    const priceResult = await require('../src/utils/priceHelper').getProductPriceLocalx(parent, source.unit_code, '10', customer, 1, 7, 0, barcode, undefined);
    const price = Number(priceResult.data[0].price);
    assert.ok(price > 0, 'Test product must have an actual sale price');
    const id = `samai-demo-${Date.now()}`;
    const body = { request_id: id, doc_no: `SMTEST${Date.now()}`, cust_code: customer, vat_type: 1, vat_rate: 7,
      remark: 'SAMAI rollback verification only', items: [{ item_code: parent, item_name: title, unit_code: source.unit_code,
        qty: 10, price, barcode, sum_amount: price * 10, item_type: 0, stand_value: 1, divide_value: 1 }] };
    const submitted = await request(app).post('/sendorder').set('Authorization', customerAuth).send(body);
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.trans_flag, 300);
    const doc = submitted.body.doc_no;
    const duplicate = await request(app).post('/sendorder').set('Authorization', customerAuth).send(body);
    assert.equal(duplicate.body.doc_no, doc);
    const optionsResponse = await request(app).get(`/admin/pending-orders/${doc}/items/1/options`).set('Authorization', employeeAuth);
    assert.equal(optionsResponse.status, 200, JSON.stringify(optionsResponse.body));
    const confirmPath = `/admin/pending-orders/${doc}/confirm`;
    const invalid = await request(app).post(confirmPath).set('Authorization', employeeAuth).send({ allocations: [{ ...allocation[0], qty: 9 }] });
    assert.equal(invalid.status, 400);
    const validLocations = (await db.query("SELECT w.code AS wh_code,s.code AS shelf_code FROM ic_warehouse w JOIN ic_shelf s ON s.whcode=w.code WHERE w.code<>'' AND s.code<>'' ORDER BY w.code,s.code")).rows;
    const firstStock = options.options.find(r => r.item_code === members[0]).locations;
    const zeroLocation = validLocations.find(location => !firstStock.some(stock => stock.wh_code === location.wh_code && stock.shelf_code === location.shelf_code && stock.balance_qty > 0));
    if (zeroLocation) {
      const shortage = await request(app).post(confirmPath).set('Authorization', employeeAuth).send({ allocations: [{ ...allocation[0], wh_code: zeroLocation.wh_code, shelf_code: zeroLocation.shelf_code }, allocation[1]] });
      assert.equal(shortage.status, 422, JSON.stringify(shortage.body));
      assert.equal(shortage.body.code, 'INSUFFICIENT_STOCK');
    }
    const confirmAllocation = allocation;
    const confirmed = await request(app).post(confirmPath).set('Authorization', employeeAuth).send({ allocations: confirmAllocation, sale_code: 'IGNORE-BODY' });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const qt = confirmed.body.sub_doc_nos;
    const saved = (await db.query('SELECT item_code,qty,wh_code,shelf_code,sale_code,sum_amount FROM ic_trans_detail WHERE doc_no=ANY($1) AND trans_flag=30 ORDER BY doc_no,line_number', [qt])).rows;
    assert.deepEqual(saved.map(r => r.item_code), members.slice(0, 2));
    assert.deepEqual(saved.map(r => Number(r.qty)), [6, 4]);
    assert.deepEqual(saved.map(r => r.wh_code), confirmAllocation.map(r => r.wh_code));
    assert.ok(saved.every(r => r.sale_code === employee));
    assert.equal(saved.reduce((n, r) => n + Number(r.sum_amount), 0), price * 10);
    const original = (await db.query('SELECT item_code,qty FROM ic_trans_detail WHERE doc_no=$1 AND trans_flag=300', [doc])).rows;
    assert.equal(original[0].item_code, parent); assert.equal(Number(original[0].qty), 10);
    const headers = (await db.query('SELECT doc_ref,total_amount FROM ic_trans WHERE doc_no=ANY($1) AND trans_flag=30', [qt])).rows;
    assert.ok(headers.every(r => r.doc_ref === doc));
    const repeated = await request(app).post(confirmPath).set('Authorization', employeeAuth).send({ allocations: confirmAllocation });
    assert.equal(repeated.status, 200); assert.equal(repeated.body.duplicate, true);
    const cancelled = await request(app).post(`/pending-orders/${doc}/cancel`).set('Authorization', customerAuth).send({});
    assert.equal(cancelled.status, 409);
    const audit = (await db.query('SELECT metadata FROM marketplace_pending_order WHERE doc_no=$1', [doc])).rows[0].metadata.confirmed_allocations;
    assert.equal(audit.length, 2);
    console.log('300 → QT verified (will roll back):', JSON.stringify({ source: doc, qt, details: saved }));
    // Some demos have only one valid master location. The display parent has
    // physical stock zero there: grouped stock must not permit parent approval.
    const zeroRequest = await request(app).post('/sendorder').set('Authorization', customerAuth).send({ ...body, request_id: `${id}:zero`, doc_no: `${body.doc_no}Z` });
    assert.equal(zeroRequest.status, 200, JSON.stringify(zeroRequest.body));
    const zeroConfirm = await request(app).post(`/admin/pending-orders/${zeroRequest.body.doc_no}/confirm`).set('Authorization', employeeAuth).send({ allocations: [{ line_number: 1, item_code: parent, qty: 10, wh_code: allocation[0].wh_code, shelf_code: allocation[0].shelf_code }] });
    assert.equal(zeroConfirm.status, 422, JSON.stringify(zeroConfirm.body));
    assert.equal(zeroConfirm.body.code, 'INSUFFICIENT_STOCK');
    console.log('Zero physical stock blocked: PASSED (will roll back)');
    await db.query('ROLLBACK TO SAVEPOINT route_reads');
    const apply = process.argv.includes('--apply');
    await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(apply ? 'COMMITTED: product fixture retained; no stock/order documents written.' : 'DRY RUN PASSED: product changes rolled back.');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
