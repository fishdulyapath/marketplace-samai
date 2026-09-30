// End-to-end UX checks against the isolated local fixture, never ERP.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PENDING_BROWSER_EXECUTABLE || undefined });
    const base = process.env.PENDING_UI_URL || 'http://127.0.0.1:5179';
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
    const url = `${base}/tests/e2e/workspace-preview.html`;
    const output = process.env.PENDING_SCREENSHOT_DIR || os.tmpdir();
    const settle = (page) => page.waitForFunction(() => !document.querySelector('[role="listbox"]'));
    const open = (page) => page.getByRole('button', { name: /MPR260930000001/ }).click();
    const line = (page, code) => page.getByRole('article', { name: `จัดสรร ${code}`, exact: true });
    async function pick(page, part, index, code) {
        await part.getByRole('button', { name: 'เลือกสินค้า + ตำแหน่ง', exact: true }).nth(index).click();
        const picker = page.getByRole('dialog', { name: 'เลือกสินค้าและตำแหน่ง', exact: true });
        await picker.getByRole('textbox', { name: 'ค้นหาสินค้าและตำแหน่ง' }).fill(code);
        await picker.getByRole('textbox', { name: 'ค้นหาสินค้าและตำแหน่ง' }).press('Enter');
        assert.equal(await picker.isVisible(), true, 'Enter in search must not confirm a document');
        await picker.getByRole('button', { name: /ST01.*เลือก/ }).press('Enter');
        await picker.waitFor({ state: 'hidden' });
    }
    async function bulk(page, warehouse, shelf) {
        await page.getByRole('button', { name: 'จัดคลังหลายรายการ', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'จัดคลังหลายรายการ', exact: true });
        await dialog.getByRole('combobox', { name: 'คลังหลายรายการ' }).click();
        await page.getByRole('option', { name: new RegExp(`^${warehouse} —`) }).click();
        await settle(page);
        await dialog.getByRole('combobox', { name: 'ที่เก็บหลายรายการ' }).click();
        await page.getByRole('option', { name: new RegExp(`^${shelf} —`) }).click();
        await settle(page);
        await dialog.getByRole('button', { name: /^ใช้กับ/ }).click();
        await dialog.waitFor({ state: 'hidden' });
    }
    try {
        for (const width of [1360, 820, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 1000 } });
            const page = await context.newPage();
            page.setDefaultTimeout(12000);
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort()));
            await page.goto(url);
            await open(page);
            const first = line(page, 'PRODUCT001');
            await pick(page, first, 0, 'PRODUCT001-A');
            assert.equal(await page.getByRole('dialog').count(), 0, 'Choosing location closes only picker, does not confirm');
            await first.getByRole('spinbutton').fill('6');
            await first.getByRole('spinbutton').press('Tab');
            await first.getByRole('button', { name: 'เพิ่มรายการจัดสรร' }).click();
            await pick(page, first, 1, 'PRODUCT001-B');
            assert.equal(await first.getByRole('spinbutton').last().inputValue(), '4');
            await page.getByText('จัดสรรครบ 1 / 3 รายการ', { exact: true }).waitFor();
            await first.getByRole('button', { name: 'เสร็จและถัดไป' }).click();
            assert.equal(await first.getByRole('spinbutton').first().isVisible(), false);
            await line(page, 'PRODUCT002').getByRole('checkbox', { name: 'เลือกบรรทัด 2' }).check();
            await bulk(page, 'ST02', 'LC02');
            await page.getByText('จัดสรรครบ 2 / 3 รายการ', { exact: true }).waitFor();
            assert.match(await first.innerText(), /ST01 \/ LC01/);
            await line(page, 'PRODUCT002').getByRole('checkbox', { name: 'เลือกบรรทัด 2' }).uncheck();
            await bulk(page, 'ST01', 'LC01');
            await page.getByText('จัดสรรครบ 3 / 3 รายการ', { exact: true }).waitFor();
            assert.match(await line(page, 'PRODUCT002').innerText(), /ST02/);
            await page.getByRole('button', { name: 'ยุบรายการที่ครบ', exact: true }).click();
            await page.getByRole('button', { name: 'สต๊อกไม่พอ', exact: true }).click();
            assert.equal(await first.isVisible(), false);
            assert.equal(await line(page, 'PRODUCT002').isVisible(), true);
            await page.getByRole('button', { name: 'ยังไม่ครบ', exact: true }).click();
            await page.getByText('ไม่มีรายการในตัวกรองนี้', { exact: false }).waitFor();
            await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({ path: path.join(output, `samai-fast-workspace-${width}.png`), fullPage: true, animations: 'disabled' });
            await page.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).click();
            const review = page.getByRole('dialog');
            await review.getByText('ตรวจเป็นพิเศษ 2 รายการ', { exact: true }).waitFor();
            await review.getByText(/→ PRODUCT001-A × 6/).waitFor();
            await review.getByText(/รายการปกติ 1 รายการ/).click();
            await review.getByText(/→ SET001 × 1/).waitFor();
            await review.getByRole('button', { name: 'กลับไปแก้ไข' }).click();
            await page.reload();
            await open(page);
            await page.getByText('จัดสรรครบ 3 / 3 รายการ', { exact: true }).waitFor();
            await page.getByText(/คืนร่างแล้ว/).waitFor();
            await page.goto(`${url}?employee=OTHER`);
            await open(page);
            await page.getByText('จัดสรรครบ 0 / 3 รายการ', { exact: true }).waitFor();
            await page.goto(`${url}?changedMaster=1`);
            await open(page);
            await page.getByText('จัดสรรครบ 2 / 3 รายการ', { exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).isDisabled(), true);
            await page.goto(`${url}?closed=1`);
            await open(page);
            await page.getByText(/คำขอนี้ได้รับการยืนยันแล้ว QT-ALREADY/).waitFor();
            await page.goto(url);
            await open(page);
            await page.getByText('จัดสรรครบ 0 / 3 รายการ', { exact: true }).waitFor();
            assert.deepEqual(errors, []);
            console.log(`Speed UX ${width}px passed: quick pick, remaining qty, bulk no overwrite, collapse/filter, risk review, persisted draft, owner isolation, master/status recheck`);
            await context.close();
        }
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
