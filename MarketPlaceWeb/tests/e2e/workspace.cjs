// Local visual fixture regression; no live ERP writes or credentials.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PENDING_BROWSER_EXECUTABLE || undefined });
    const base = process.env.PENDING_UI_URL || 'http://127.0.0.1:5179';
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
    const output = process.env.PENDING_SCREENSHOT_DIR || os.tmpdir();
    try {
        for (const width of [1360, 820, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 900 } });
            const page = await context.newPage();
            page.setDefaultTimeout(10000);
            const errors = [];
            page.on('pageerror', (err) => errors.push(err.message));
            await page.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort()));
            await page.goto(`${base}/tests/e2e/workspace-preview.html`);
            await page.getByRole('button', { name: /MPR260930000001/ }).click();
            assert.equal(await page.getByRole('checkbox', { name: 'เปิดคำขอถัดไปหลังทำรายการ' }).count(), 0);
            const first = page.getByRole('article', { name: 'จัดสรร PRODUCT001', exact: true });
            await first.getByRole('combobox', { name: 'รหัสสินค้าจริง 1', exact: true }).click();
            await page.getByRole('option', { name: /PRODUCT001-A —/ }).click();
            await first.getByRole('spinbutton').fill('6');
            await first.getByRole('spinbutton').press('Tab');
            await first.locator('.stock-strip summary').click();
            await first.getByRole('button', { name: 'ใช้ตำแหน่งนี้' }).click();
            await first.getByRole('button', { name: 'เพิ่มรายการจัดสรร' }).click();
            await first.getByRole('combobox', { name: 'รหัสสินค้าจริง 2', exact: true }).click();
            await page.getByRole('option', { name: /PRODUCT001-B —/ }).click();
            await first.locator('.stock-strip summary').last().click();
            await first.getByRole('button', { name: 'ใช้ตำแหน่งนี้' }).last().click();
            assert.equal(await page.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).isDisabled(), true);
            await first.getByRole('button', { name: 'เสร็จและถัดไป', exact: true }).click();
            await page
                .getByText('จัดสรรครบ 1 / 3 รายการ', { exact: true })
                .waitFor()
                .catch(async (err) => {
                    console.error(await first.innerText());
                    throw err;
                });
            if (width < 761) await page.getByRole('button', { name: 'กลับไปคิวคำขอ' }).click();
            await page.getByRole('button', { name: /MPR260930000002/ }).click();
            await page.getByText('จัดสรรครบ 0 / 3 รายการ', { exact: true }).waitFor();
            if (width < 761) await page.getByRole('button', { name: 'กลับไปคิวคำขอ' }).click();
            await page.getByRole('button', { name: /MPR260930000001/ }).click();
            await page.getByText('จัดสรรครบ 0 / 3 รายการ', { exact: true }).waitFor();
            assert.equal(await first.getByRole('spinbutton').first().inputValue(), '6');
            assert.equal(await first.getByRole('spinbutton').last().inputValue(), '4');
            await first.getByRole('button', { name: 'เสร็จและถัดไป', exact: true }).click();
            for (const code of ['PRODUCT002', 'SET001']) {
                const line = page.getByRole('article', { name: `จัดสรร ${code}`, exact: true });
                if (code === 'SET001') {
                    assert.equal(await line.getByRole('spinbutton').isDisabled(), true);
                    assert.equal(await line.getByRole('button', { name: 'เพิ่มรายการจัดสรร' }).count(), 0);
                    assert.equal(await line.getByRole('combobox', { name: 'รหัสสินค้าจริง 1', exact: true }).count(), 0);
                }
                await line.getByRole('combobox', { name: 'คลังจัดสรร 1', exact: true }).click();
                await page.getByRole('option', { name: 'ST01 — คลังหน้าร้าน', exact: true }).click();
                await line.getByRole('combobox', { name: 'ที่เก็บจัดสรร 1', exact: true }).click();
                await page.getByRole('option', { name: 'LC01 — โซนขายปลีก', exact: true }).click();
                await page.waitForFunction(() => !document.querySelector('[role="listbox"]'));
                await line.getByRole('button', { name: 'เสร็จและถัดไป', exact: true }).click();
            }
            await page.getByText('จัดสรรครบ 3 / 3 รายการ', { exact: true }).waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}px`);
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: path.join(output, `samai-workspace-${width}.png`), fullPage: true, animations: 'disabled' });
            await page.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).click();
            const dialog = page.getByRole('dialog');
            await dialog.getByText(/→ PRODUCT001-A × 6/).waitFor();
            await dialog.getByText(/→ PRODUCT001-B × 4/).waitFor();
            await dialog.getByRole('button', { name: 'กลับไปแก้ไข' }).click();
            await page.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).click();
            await dialog.getByRole('button', { name: 'ยืนยันสั่งซื้อ', exact: true }).click();
            await page.getByText('ยืนยันแล้ว เลขที่คำสั่งซื้อ QT-DEMO-001', { exact: true }).waitFor();
            await page.getByRole('button', { name: /MPR260930000002/ }).waitFor();
            assert.equal(await page.locator('.document-heading').count(), 0, 'Confirmation returns to the queue without opening another request');
            await page.getByRole('button', { name: /MPR260930000002/ }).click();
            await page.getByRole('heading', { name: 'ร้านบ้านสวนการค้า', exact: true }).waitFor();
            await page.getByRole('button', { name: 'ปฏิเสธคำขอ', exact: true }).click();
            await page.getByRole('dialog').getByRole('textbox').fill('ไม่สามารถจัดหาได้');
            await page.getByRole('dialog').getByRole('button', { name: 'ปฏิเสธคำขอ', exact: true }).click();
            await page.getByText('ปฏิเสธคำขอแล้ว', { exact: true }).waitFor();
            await page.getByRole('button', { name: /MPR260930000003/ }).waitFor();
            assert.equal(await page.locator('.document-heading').count(), 0, 'Rejection also waits for manual request selection');
            await page.getByRole('button', { name: /MPR260930000003/ }).click();
            await page.getByRole('heading', { name: 'ร้านรุ่งเรืองพาณิชย์', exact: true }).waitFor();
            assert.deepEqual(errors, []);
            console.log(`Workspace ${width}px: draft retention, sets, progress, review, manual selection after confirm/reject, no overflow passed`);
            await context.close();
        }
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
