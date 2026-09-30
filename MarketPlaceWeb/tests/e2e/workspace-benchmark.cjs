// Controlled UI benchmark of location assignment only, not human throughput or ERP latency.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PENDING_BROWSER_EXECUTABLE || undefined });
    const base = process.env.PENDING_UI_URL || 'http://127.0.0.1:5179';
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
    try {
        for (const count of [5, 20, 50]) {
            for (const mode of ['manual', 'bulk']) {
                const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
                const page = await context.newPage();
                page.setDefaultTimeout(12000);
                await page.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort()));
                await page.goto(`${base}/tests/e2e/workspace-preview.html?lines=${count}`);
                await page.getByRole('button', { name: /MPR260930000001/ }).click();
                await page.getByText(`จัดสรรครบ 0 / ${count} รายการ`, { exact: true }).waitFor();
                let clicks = 0;
                const click = async (locator) => {
                    clicks++;
                    await locator.click();
                };
                const settle = () => page.waitForFunction(() => !document.querySelector('[role="listbox"]'));
                const started = Date.now();
                if (mode === 'manual') {
                    for (const part of await page.locator('.allocation-line').all()) {
                        await click(part.getByRole('combobox', { name: 'คลังจัดสรร 1', exact: true }));
                        await click(page.getByRole('option', { name: 'ST01 — คลังหน้าร้าน', exact: true }));
                        await settle();
                        await click(part.getByRole('combobox', { name: 'ที่เก็บจัดสรร 1', exact: true }));
                        await click(page.getByRole('option', { name: 'LC01 — โซนขายปลีก', exact: true }));
                        await settle();
                    }
                } else {
                    await click(page.getByRole('button', { name: 'จัดคลังหลายรายการ', exact: true }));
                    const dialog = page.getByRole('dialog');
                    await click(dialog.getByRole('combobox', { name: 'คลังหลายรายการ' }));
                    await click(page.getByRole('option', { name: 'ST01 — คลังหน้าร้าน', exact: true }));
                    await settle();
                    await click(dialog.getByRole('combobox', { name: 'ที่เก็บหลายรายการ' }));
                    await click(page.getByRole('option', { name: 'LC01 — โซนขายปลีก', exact: true }));
                    await settle();
                    await click(dialog.getByRole('button', { name: `ใช้กับ ${count} รายการ`, exact: true }));
                }
                await page.getByText(`จัดสรรครบ ${count} / ${count} รายการ`, { exact: true }).waitFor();
                assert.equal(await page.getByRole('button', { name: 'ตรวจสอบและยืนยัน', exact: true }).isEnabled(), true);
                console.log(JSON.stringify({ lines: count, mode, clicks, milliseconds: Date.now() - started }));
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
