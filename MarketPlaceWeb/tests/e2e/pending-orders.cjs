// Run against local Vite with Playwright installed or supplied through NODE_PATH.
// API calls are intercepted: this test never writes to an ERP service.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PENDING_BROWSER_EXECUTABLE || undefined });
    const base = process.env.PENDING_UI_URL || 'http://127.0.0.1:5179';
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
    const results = [];
    try {
        for (const scenario of ['confirm', 'reject', 'cancel', 'zero-stock-product', 'checkout', 'split', 'split-mobile', 'recovery', 'unknown-stock', 'conflict']) {
            const admin = ['confirm', 'reject', 'split', 'split-mobile', 'recovery', 'unknown-stock', 'conflict'].includes(scenario);
            const context = await browser.newContext({ viewport: { width: admin && scenario !== 'split-mobile' ? 1360 : 390, height: 900 } });
            await context.addInitScript(({ admin }) => {
                localStorage.setItem('_token', 'ui-test-token');
                localStorage.setItem('_userType', admin ? 'employee' : 'customer');
                localStorage.setItem('_userCode', 'C1');
                localStorage.setItem('_empCode', 'EMP');
                localStorage.setItem('_adminPermissions', JSON.stringify(['admin.orders']));
                localStorage.setItem('_userData', JSON.stringify({ user_code: 'C1', user_name: 'ลูกค้าทดสอบ' }));
                localStorage.setItem('_empData', JSON.stringify({ user_code: 'EMP', user_name: 'พนักงานทดสอบ' }));
            }, { admin });
            const page = await context.newPage();
            page.setDefaultTimeout(12000);
            console.log(`Starting ${scenario}`);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            let state = 'pending';
            let submitted;
            let rejection = '';
            let stockValidations = 0;
            let cleared = false;
            let optionCalls = 0, shelfCalls = 0, confirmCalls = 0;
            const item = { line_number: 1, item_code: 'P1', item_name: 'สินค้าทดสอบ', qty: 2, unit_code: 'ชิ้น', price: 100, sum_amount: 200, wh_code: '', shelf_code: '', sub_item: [] };
            const row = () => ({ doc_no: 'MPR260929000001', cust_code: 'C1', cust_name: 'ลูกค้าทดสอบ', total_amount: 200, doc_date: '2026-09-29', doc_time: '10:30', status: state, reason: rejection });
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                const marker = url.pathname.indexOf('/service/v1/');
                if (marker < 0) {
                    if (url.origin !== new URL(base).origin) return route.abort();
                    return route.continue();
                }
                const endpoint = url.pathname.slice(marker + '/service/v1'.length);
                let body = { success: true, data: [], total: 0, total_orders: 0, total_count: 0 };
                if (endpoint === '/validatecartstock') stockValidations++;
                if (endpoint === '/sendorder') {
                    submitted = route.request().postDataJSON();
                    body = { success: true, doc_no: 'MPR260929000001', main_doc_no: 'MPR260929000001', trans_flag: 300, status: 'pending', doc_count: 1 };
                } else if (endpoint === '/deleteAllItems') {
                    cleared = true;
                } else if (endpoint === '/getProductDetail') {
                    body.data = [{ item_code: 'P1', item_name: 'สินค้าทดสอบ', unit_code: 'EA', price: 100, balance_qty: 0, sold_out: '1', preorder_allowed: 0, item_type: 0 }];
                } else if (endpoint === '/getProductPrice') {
                    body.data = [{ price: 100 }];
                } else if (endpoint === '/additemtocart') {
                    submitted = route.request().postDataJSON();
                } else if (endpoint.endsWith('/options')) {
                    if (scenario === 'recovery' && optionCalls++ === 0) return route.fulfill({ status: 503, json: { message: 'โหลดสินค้าไม่สำเร็จ' } });
                    body.data = { options: ['P1', 'P1-A', 'P1-B', 'P1-BAD'].map((item_code, index) => ({
                        item_code, item_name: item_code, unit_code: 'ชิ้น', is_original: index === 0,
                        balance_qty: index === 0 ? 99 : index === 1 ? 0 : 5, selectable: index !== 3,
                        disabled_reason: index === 3 ? 'หน่วยหรืออัตราแปลงไม่ตรงกับคำขอ' : '',
                        locations: [{ wh_code: 'W2', wh_name: 'คลังสอง', shelf_code: 'S2', shelf_name: 'ที่เก็บสินค้า', balance_qty: index === 1 ? 0 : 5 }],
                    })) };
                    if (scenario === 'unknown-stock') { body.data.stock_error = 'อ่านสต๊อกไม่สำเร็จ'; body.data.options.forEach(option => { option.balance_qty = null; option.locations = []; }); }
                } else if (endpoint.endsWith('/confirm')) {
                    if (scenario === 'conflict') { state = 'cancelled'; return route.fulfill({ status: 409, json: { message: 'ลูกค้ายกเลิกคำขอนี้แล้ว' } }); }
                    if (confirmCalls++ === 0 && scenario.startsWith('split')) return route.fulfill({ status: 422, json: {
                        success: false, code: 'INSUFFICIENT_STOCK', message: 'สต๊อกไม่พอ ณ คลัง/ที่เก็บที่เลือก ยังไม่สร้าง QT กรุณาแก้ไขการจัดสรร',
                        stock_issues: [{ item_code: 'P1-A', wh_code: 'W2', shelf_code: 'S2', required_qty: 1, available_qty: 0 }],
                    } });
                    if (confirmCalls === 1 && scenario === 'unknown-stock') return route.fulfill({ status: 503, json: {
                        success: false, code: 'STOCK_UNAVAILABLE', message: 'ตรวจสอบสต๊อกไม่สำเร็จ ยังไม่สร้าง QT กรุณาลองใหม่', stock_issues: [],
                    } });
                    // A later attempt simulates physical stock replenishment / ERP recovery.
                    submitted = route.request().postDataJSON(); state = 'confirmed';
                    body = { success: true, doc_no: 'MQT-TEST', sub_doc_nos: ['MQT-TEST'] };
                } else if (endpoint.endsWith('/reject')) {
                    submitted = route.request().postDataJSON(); rejection = submitted.reason; state = 'rejected';
                } else if (endpoint.endsWith('/cancel')) {
                    state = 'cancelled';
                } else if (endpoint === '/admin/pending-orders' || endpoint === '/pending-orders') {
                    const rows = state === 'confirmed' || (admin && state !== 'pending') ? [] : [row()];
                    body = { success: true, data: rows, total: rows.length, page: 1, page_size: 20 };
                } else if (endpoint.startsWith('/pending-orders/')) {
                    body = { success: true, data: { ...row(), address: 'ที่อยู่ทดสอบ', telephone: '053 562 595', items: [item] } };
                } else if (endpoint === '/getWarehouseList') {
                    body.data = [{ code: 'W1', name_1: 'คลังหนึ่ง' }, { code: 'W2', name_1: 'คลังสอง' }];
                } else if (endpoint === '/getShelfList') {
                    if (scenario === 'recovery' && shelfCalls++ === 0) return route.fulfill({ status: 503, json: { message: 'โหลดที่เก็บไม่สำเร็จ' } });
                    const wh = url.searchParams.get('wh_code');
                    body.data = [{ whcode: wh, code: wh === 'W1' ? 'S1' : 'S2', name_1: 'ที่เก็บสินค้า' }];
                } else if (endpoint === '/license/status') body.data = { status: 'active' };
                else if (endpoint === '/content/home') body.data = {};
                else if (endpoint === '/sales-settings') body.data = {};
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
            });
            await page.goto(`${base}/${scenario === 'zero-stock-product' ? 'product-detail/P1' : admin ? 'admin/pending-orders' : 'orders-history'}`);
            if (scenario === 'checkout') {
                await page.getByRole('button', { name: 'ดูรายละเอียด', exact: true }).first().waitFor();
                const result = await page.evaluate(async () => {
                    const { useCartStore } = await import('/src/stores/cartStore.js');
                    const cart = useCartStore();
                    const item = { item_code: 'P1', item_name: 'สินค้าทดสอบ', unit_code: 'EA', qty: 2, price: 100, sum_amount: 200, item_type: 0, balance_qty: 0, preorder_allowed: 0 };
                    cart.cartItems = [item];
                    const response = await cart.checkoutCart({ items: [item], telephone: '053 562 595', address: 'ที่อยู่ทดสอบ' });
                    return { response, count: cart.cartItems.length };
                });
                assert.equal(result.response.orderNumber, 'MPR260929000001');
                assert.equal(result.response.message, 'ส่งคำขอแล้ว รอพนักงานจัดคลัง');
                assert.equal(result.count, 0);
                assert.equal(cleared, true);
                assert.equal(stockValidations, 0);
                assert.ok(submitted.request_id);
                assert.equal(Number(submitted.items[0].qty), 2);
                assert.deepEqual(errors, [], 'No uncaught browser errors');
                results.push(`${scenario}: passed`);
                await context.close();
                continue;
            }
            if (scenario === 'zero-stock-product') {
                const increase = page.locator('.detail-quantity-panel button').last();
                await increase.waitFor();
                const added = page.waitForResponse(response => response.url().includes('/additemtocart'));
                await increase.click();
                await added;
                assert.equal(Number(submitted[0].qty), 1, 'Zero stock and preorder disabled still permit a request');
                assert.deepEqual(errors, [], 'No uncaught browser errors');
                results.push(`${scenario}: passed`);
                await context.close();
                continue;
            }
            if (admin) await page.getByRole('button', { name: /MPR260929000001/ }).click();
            else await page.getByRole('button', { name: 'ดูรายละเอียด', exact: true }).first().click();
            const detail = admin ? page.getByRole('region', { name: 'พื้นที่จัดสินค้า', exact: true }) : page.getByRole('dialog').first();
            await detail.getByText('สินค้าทดสอบ', { exact: true }).first().waitFor();
            if (scenario.startsWith('split')) {
                const editor = detail;
                await editor.getByRole('combobox', { name: 'รหัสสินค้าจริง 1', exact: true }).click();
                await page.getByRole('option', { name: /P1-A —/ }).click();
                await page.waitForFunction(() => !document.querySelector('.p-select-overlay:not(.p-connected-overlay-leave-active)'));
                const qty = editor.getByRole('spinbutton', { name: 'จำนวนจัดสรร 1', exact: true });
                await qty.fill('1'); await qty.press('Tab');
                await editor.locator('.stock-strip summary').first().click();
                await editor.getByRole('button', { name: 'ใช้ตำแหน่งนี้', exact: true }).first().click();
                await editor.getByRole('button', { name: 'เพิ่มรายการจัดสรร', exact: true }).click();
                await editor.getByRole('combobox', { name: 'รหัสสินค้าจริง 2', exact: true }).click();
                assert.equal(await page.getByRole('option', { name: /P1-BAD —/ }).getAttribute('aria-disabled'), 'true');
                await page.getByRole('option', { name: /P1-B —/ }).click();
                await editor.locator('.stock-strip summary').last().click();
                await editor.getByRole('button', { name: 'ใช้ตำแหน่งนี้', exact: true }).last().click();
                await editor.getByRole('button', { name: 'เพิ่มรายการจัดสรร', exact: true }).click();
                assert.equal(await editor.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).isDisabled(), true);
                await editor.getByRole('button', { name: 'ลบรายการ 3', exact: true }).click();
                assert.equal(await editor.getByText(/ไม่พอ กรุณาเปลี่ยนการจัดสรร/).count(), 1);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow');
                await page.screenshot({ path: path.join(process.env.PENDING_SCREENSHOT_DIR || os.tmpdir(), `samai-${scenario}.png`), fullPage: true, animations: 'disabled' });
                await detail.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).click();
                await page.getByRole('dialog').last().getByText(/→ P1-A/).waitFor();
                await page.getByRole('dialog').last().getByRole('button', { name: 'ยืนยันสั่งซื้อ', exact: true }).click();
                await page.getByRole('list', { name: 'สินค้าสต๊อกไม่พอ' }).getByText(/P1-A.*W2.*S2.*ต้องการ 1.*คงเหลือ 0/).waitFor();
                assert.equal(state, 'pending');
                assert.equal(await detail.getByRole('spinbutton').count(), 2, 'Shortage keeps allocations for correction');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                await detail.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).click();
                await page.getByRole('dialog').last().getByRole('button', { name: 'ยืนยันสั่งซื้อ', exact: true }).click();
                await page.getByText('ยืนยันแล้ว เลขที่คำสั่งซื้อ MQT-TEST', { exact: true }).waitFor();
                assert.deepEqual(submitted, { allocations: ['P1-A', 'P1-B'].map(item_code => ({ line_number: 1, item_code, qty: 1, wh_code: 'W2', shelf_code: 'S2' })) });
            } else if (['confirm', 'recovery', 'unknown-stock', 'conflict'].includes(scenario)) {
                assert.equal(await detail.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).isDisabled(), true);
                if (scenario === 'recovery') { await detail.getByText('โหลดสินค้าไม่สำเร็จ', { exact: true }).waitFor(); await detail.getByRole('button', { name: 'โหลดสินค้าและสต๊อกใหม่', exact: true }).click(); }
                await detail.getByRole('combobox', { name: 'คลังจัดสรร 1', exact: true }).click();
                await page.getByRole('option', { name: 'W1 — คลังหนึ่ง', exact: true }).click();
                if (scenario === 'recovery') { await detail.getByText('โหลดที่เก็บไม่สำเร็จ กรุณาลองอีกครั้ง', { exact: true }).waitFor(); await detail.getByRole('button', { name: 'โหลดที่เก็บอีกครั้ง', exact: true }).click(); }
                await detail.getByRole('combobox', { name: 'ที่เก็บจัดสรร 1', exact: true }).click();
                await page.getByRole('option', { name: 'S1 — ที่เก็บสินค้า', exact: true }).click();
                await detail.getByRole('combobox', { name: 'คลังจัดสรร 1', exact: true }).click();
                await page.getByRole('option', { name: 'W2 — คลังสอง', exact: true }).click();
                assert.equal(await detail.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).isDisabled(), true, 'Changing warehouse clears the old shelf');
                await detail.getByRole('combobox', { name: 'ที่เก็บจัดสรร 1', exact: true }).click();
                await page.getByRole('option', { name: 'S2 — ที่เก็บสินค้า', exact: true }).click();
                await page.waitForFunction(() => !document.querySelector('.p-select-overlay:not(.p-connected-overlay-leave-active)'));
                if (scenario === 'unknown-stock') await detail.getByText('ยังไม่ทราบยอด · ต้องตรวจสต๊อกสำเร็จก่อนสร้าง QT', { exact: true }).waitFor();
                await page.screenshot({ path: path.join(process.env.PENDING_SCREENSHOT_DIR || os.tmpdir(), 'samai-pending-admin.png'), fullPage: true, animations: 'disabled' });
                await detail.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).click();
                await page.getByRole('dialog').last().getByRole('button', { name: 'ยืนยันสั่งซื้อ', exact: true }).click();
                if (scenario === 'conflict') {
                    await page.getByText('ลูกค้ายกเลิกคำขอนี้แล้ว', { exact: true }).waitFor();
                    assert.equal(await page.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).count(), 0);
                    assert.deepEqual(errors, []); results.push(`${scenario}: passed`); await context.close(); continue;
                }
                if (scenario === 'unknown-stock') {
                    await page.getByText('ตรวจสอบสต๊อกไม่สำเร็จ ยังไม่สร้าง QT กรุณาลองใหม่', { exact: true }).waitFor();
                    assert.equal(state, 'pending');
                    assert.equal(await detail.getByRole('spinbutton').inputValue(), '2');
                    await detail.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).click();
                    await page.getByRole('dialog').last().getByRole('button', { name: 'ยืนยันสั่งซื้อ', exact: true }).click();
                }
                await page.getByText('ยืนยันแล้ว เลขที่คำสั่งซื้อ MQT-TEST', { exact: true }).waitFor();
                assert.deepEqual(submitted, { allocations: [{ line_number: 1, item_code: 'P1', qty: 2, wh_code: 'W2', shelf_code: 'S2' }] });
            } else if (scenario === 'reject') {
                await detail.getByRole('button', { name: 'ปฏิเสธคำขอ', exact: true }).click();
                const dialog = page.getByRole('dialog').last();
                assert.equal(await dialog.getByRole('button', { name: 'ปฏิเสธคำขอ', exact: true }).isDisabled(), true);
                await dialog.getByRole('textbox').fill('จัดหาไม่ได้');
                await dialog.getByRole('button', { name: 'ปฏิเสธคำขอ', exact: true }).click();
                await page.getByText('ปฏิเสธคำขอแล้ว', { exact: true }).waitFor();
                assert.equal(submitted.reason, 'จัดหาไม่ได้');
            } else {
                assert.equal(await detail.getByRole('combobox').count(), 0);
                await page.waitForTimeout(250); // Allow the PrimeVue entrance transition to finish.
                await page.screenshot({ path: path.join(process.env.PENDING_SCREENSHOT_DIR || os.tmpdir(), 'samai-pending-customer-mobile.png'), fullPage: true, animations: 'disabled' });
                await detail.getByRole('button', { name: 'ยกเลิกคำขอ', exact: true }).click();
                await page.getByRole('dialog').last().getByRole('button', { name: 'ยกเลิกคำขอ', exact: true }).click();
                await page.getByText('ยกเลิกคำขอแล้ว', { exact: true }).waitFor();
                assert.equal(state, 'cancelled');
            }
            assert.deepEqual(errors, [], 'No uncaught browser errors');
            results.push(`${scenario}: passed`);
            await context.close();
        }
        console.log(results.join('\n'));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
