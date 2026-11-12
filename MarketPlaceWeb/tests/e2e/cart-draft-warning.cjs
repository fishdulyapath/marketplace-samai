// Exercise the real cart drawer with a local stock fixture. No ERP writes.
const { createServer } = require('vite');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
    const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, plugins: [{
        name: 'cart-warning-fixture',
        resolveId(id) { if (id === '/cart-warning-fixture.js') return id; },
        load(id) {
            if (id !== '/cart-warning-fixture.js') return;
            return `
                import { createApp, h } from 'vue';
                import { createPinia } from 'pinia';
                import CartOverlay from '/src/components/cart/CartOverlay.vue';
                import { useCartStore } from '/src/stores/cartStore.js';
                import CartService from '/src/services/CartService.js';
                const app = createApp({render: () => h(CartOverlay, {visible:true, page:true})});
                app.use(createPinia());
                const cart = useCartStore();
                cart.cartItems = [{item_code:'TEST', unit_code:'box', qty:1, ratio:1, price:10}];
                cart.loadCartItems = async () => cart.cartItems;
                cart.fetchCartSummary = async () => {};
                cart.updateCartItem = async item => { cart.cartItems[0].qty = item.qty; };
                CartService.getCartItemStock = async () => ({data:{success:true,data:[{item_code:'TEST',unit_code:'box',balance_qty:2}]}});
                app.mount('#app');
            `;
        }
    }] });
    let browser;
    try {
        await server.listen();
        browser = await chromium.launch({ executablePath: process.env.PENDING_BROWSER_EXECUTABLE || undefined });
        for (const width of [360, 390, 1440]) {
            const page = await browser.newPage({ viewport:{ width, height:850 } });
            await page.route('**/cart-fixture.html', route => route.fulfill({contentType:'text/html', body:'<div id="app"></div><script type="module" src="/cart-warning-fixture.js"></script>'}));
            await page.goto(server.resolvedUrls.local[0] + 'cart-fixture.html');
            const warning = page.locator('.cart-stock-guide--limit');
            const input = page.locator('.controls input');
            const edit = page.locator('.cart-unit-editor .edit');
            await edit.click();
            await input.fill('5');
            await warning.waitFor();
            if (width <= 390) {
                const box = await warning.boundingBox();
                const message = await warning.locator('span').boundingBox();
                const action = await warning.locator('button').boundingBox();
                assert.ok(message.width > box.width * .65, 'warning text should use the row');
                assert.ok(action.y >= message.y + message.height - 1, 'action should sit below the warning');
                assert.ok(action.x + action.width <= Math.min(width, box.x + box.width), 'action must fit inside the card');
            }
            await warning.locator('button').click();
            await warning.waitFor({state:'hidden'});
            await page.locator('.controls .confirm').click();
            await edit.waitFor();
            assert.equal((await edit.innerText()).trim(), '2');
            assert.equal(await warning.count(), 0);
            await edit.click();
            await input.fill('5');
            await warning.waitFor();
            await page.locator('.controls button').last().click();
            await edit.waitFor();
            assert.equal((await edit.innerText()).trim(), '2');
            assert.equal(await warning.count(), 0);
            await page.close();
        }
        const page = await browser.newPage({ viewport: { width:393, height:852 } });
        await page.addInitScript(() => {
            localStorage.setItem('_token', 'fixture');
            localStorage.setItem('_userData', JSON.stringify({ user_code: 'fixture' }));
        });
        const lines = [
            { unit_code:'ชิ้น', qty:3, ratio:1, price:92 },
            { unit_code:'ลัง24', qty:1, ratio:24, price:2186 }
        ].map(line => ({ ...line, item_code:'01-0004', item_name:'ซีรีแล็ค', guid_code:line.unit_code, unit_standard:'ชิ้น' }));
        await page.route('**/service/v1/**', route => {
            const endpoint = new URL(route.request().url()).pathname.toLowerCase();
            let data = [];
            if (endpoint.endsWith('/getcartitemlist')) data = lines;
            if (endpoint.endsWith('/getcartitemstock')) data = lines.map(line => ({ ...line, balance_qty:Math.floor(31 / line.ratio) }));
            return route.fulfill({ json:{ success:true, data, total_count:2 } });
        });
        await page.goto(server.resolvedUrls.local[0] + 'basket');
        const rows = page.locator('.basket-page .cart-unit-row');
        const small = rows.filter({ has:page.locator('.edit[aria-label*="ชิ้น"]') });
        const large = rows.filter({ has:page.locator('.edit[aria-label*="ลัง24"]') });
        const input = rows.locator('input');
        await small.locator('.edit').click();
        await large.locator('.edit').click();
        assert.equal(await input.inputValue(), '1');
        await input.fill('12');
        await small.locator('.edit').click();
        assert.equal(await input.inputValue(), '3');
        await input.fill('5');
        await large.locator('.edit').click();
        assert.equal(await input.inputValue(), '1');
        await rows.locator('.confirm').click();
        assert.equal((await small.locator('.edit').innerText()).trim(), '3');
        assert.equal((await large.locator('.edit').innerText()).trim(), '1');
        await page.goto(server.resolvedUrls.local[0] + 'cart');
        const cartLines = page.locator('.cart-line');
        const pieces = cartLines.filter({ has:page.locator('.cart-unit', { hasText:'ชิ้น' }) });
        const cases = cartLines.filter({ has:page.locator('.cart-unit', { hasText:'ลัง24' }) });
        await pieces.locator('.cart-stock-badge--ok').waitFor();
        await pieces.locator('.qty-step-btn').first().click();
        assert.equal(await pieces.locator('.qty-input').inputValue(), '2');
        assert.match(await pieces.locator('.cart-stock').innerText(), /31/);
        assert.match(await cases.locator('.cart-stock').innerText(), /1/);
        assert.equal(await cases.locator('.qty-input').inputValue(), '1');
        await page.close();
        console.log('Cart warning, quantity adjustment and switching between units on /basket passed');
    } finally {
        await browser?.close();
        await server.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
