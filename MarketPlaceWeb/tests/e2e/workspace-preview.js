// Development-only visual fixture. No authentication or live ERP requests.
// Vite's production entry is index.html; this fixture is not part of the build.
import { createApp, h } from 'vue';
import { createRouter, createMemoryHistory, RouterView } from 'vue-router';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import Message from 'primevue/message';
import Dialog from 'primevue/dialog';
import Textarea from 'primevue/textarea';
import Workspace from '../../src/components/orders/PendingOrderWorkspace.vue';
import PendingOrderService from '../../src/services/PendingOrderService';
import InventoryService from '../../src/services/InventoryService';
import '../../src/assets/styles.scss';
import '../../src/assets/tailwind.css';
const fixture = new URLSearchParams(location.search);

const products = [
    { line_number: 1, item_code: 'PRODUCT001', item_name: 'น้ำยาปรับผ้านุ่ม 500 มล. คละกลิ่น', qty: 10, unit_code: 'แพ็ค', price: 39, sum_amount: 390 },
    { line_number: 2, item_code: 'PRODUCT002', item_name: 'น้ำยาล้างจาน สูตรมะนาว 750 มล.', qty: 4, unit_code: 'ขวด', price: 45, sum_amount: 180 },
    {
        line_number: 3,
        item_code: 'SET001',
        item_name: 'ชุดทำความสะอาดบ้าน',
        qty: 1,
        unit_code: 'ชุด',
        price: 299,
        sum_amount: 299,
        item_type: 3,
        sub_item: [{ line_number: 4, item_code: 'BRUSH01', item_name: 'แปรงทำความสะอาด', qty: 1, unit_code: 'ชิ้น' }]
    }
];
const fixtureLines = Math.min(50, Math.max(3, Number(fixture.get('lines')) || 3));
while (products.length < fixtureLines)
    products.push({ line_number: products.length + 1, item_code: `PRODUCT${String(products.length + 1).padStart(3, '0')}`, item_name: 'สินค้าทดสอบคิวจำนวนมาก', qty: 10, unit_code: 'แพ็ค', price: 39, sum_amount: 390 });
let queue = ['ร้านพรชัยมินิมาร์ท', 'ร้านบ้านสวนการค้า', 'ร้านรุ่งเรืองพาณิชย์', 'ร้านปันสุข', 'ร้านเจริญผล'].map((cust_name, index) => ({
    doc_no: `MPR26093000000${index + 1}`,
    cust_code: `C000${index + 1}`,
    cust_name,
    total_amount: products.reduce((sum, item) => sum + item.sum_amount, 0),
    doc_date: '2026-09-30',
    doc_time: '09:30',
    created_at: new Date(Date.now() - (5 - index) * 3600000).toISOString(),
    status: 'pending',
    address: '123 ถนนเชียงใหม่–ลำพูน ตำบลในเมือง',
    telephone: '053 562 595'
}));
PendingOrderService.list = async (_, params) => {
    const data = queue.filter((row) => !params.search || `${row.doc_no} ${row.cust_name}`.includes(params.search)).sort((a, b) => (params.sort === 'newest' ? b.doc_no.localeCompare(a.doc_no) : a.doc_no.localeCompare(b.doc_no)));
    return { data, total: data.length };
};
PendingOrderService.detail = async (doc) => ({ ...queue.find((row) => row.doc_no === doc), status: fixture.has('closed') ? 'confirmed' : 'pending', qt_doc_no: 'QT-ALREADY', items: structuredClone(products) });
PendingOrderService.options = async (_, line) => ({
    options: ['', '-A', '-B', '-C'].map((suffix, index) => ({
        item_code: `${products[line - 1].item_code}${suffix}`,
        item_name: `${products[line - 1].item_name}${suffix ? ` · สูตร ${suffix.slice(1)}` : ''}`,
        unit_code: products[line - 1].unit_code,
        is_original: index === 0,
        balance_qty: [0, 6, 24, 12][index],
        tax_type: index === 3 ? 1 : 0,
        price: [39, 42, 45, 47][index],
        default_discount: index === 2 ? '5%' : '',
        price_available: true,
        selectable: !(fixture.has('changedMaster') && index === 1),
        disabled_reason: fixture.has('changedMaster') && index === 1 ? 'หน่วย master เปลี่ยน ไม่ตรงกับต้นทาง' : '',
        locations: [{ wh_code: 'ST01', wh_name: 'คลังหน้าร้าน', shelf_code: 'LC01', shelf_name: 'โซนขายปลีก', balance_qty: [0, 6, 24, 12][index] }]
    }))
});
PendingOrderService.quote = async (_, allocations) => {
    const items = allocations.map((row) => ({
        source_line: row.line_number,
        source_item: products[row.line_number - 1].item_code,
        item_code: row.item_code || products[row.line_number - 1].item_code,
        item_name: products[row.line_number - 1].item_name,
        unit_code: products[row.line_number - 1].unit_code,
        qty: row.qty || products[row.line_number - 1].qty,
        wh_code: row.wh_code,
        shelf_code: row.shelf_code,
        price: 45,
        discount: '',
        tax_type: 0,
        sum_amount: 45 * Number(row.qty || products[row.line_number - 1].qty)
    }));
    return { fingerprint: 'preview-price-token', items, totals: { total_amount: items.reduce((sum, item) => sum + item.sum_amount, 0) } };
};
PendingOrderService.confirm = async (doc) => {
    queue = queue.filter((row) => row.doc_no !== doc);
    return { doc_no: 'QT-DEMO-001' };
};
PendingOrderService.reject = async (doc) => {
    queue = queue.filter((row) => row.doc_no !== doc);
};
InventoryService.getWarehouseList = async () => [
    { code: 'ST01', name_1: 'คลังหน้าร้าน' },
    { code: 'ST02', name_1: 'คลังสำรอง' }
];
InventoryService.getShelfList = async (wh) => [{ code: wh === 'ST01' ? 'LC01' : 'LC02', name_1: wh === 'ST01' ? 'โซนขายปลีก' : 'โซนสำรอง' }];
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Workspace, props: { employeeCode: fixture.get('employee') || 'PREVIEW-EMPLOYEE', draftScope: 'isolated-visual-fixture' } }] });
const app = createApp({
    render: () => h('main', { style: 'max-width:1380px;margin:auto;padding:24px 12px' }, [h('p', { style: 'color:#846239;font-size:12px;margin-bottom:20px' }, 'สมัยการค้า / หลังบ้าน · ตัวอย่างข้อมูลจำลอง ไม่เชื่อม ERP'), h(RouterView)])
});
for (const [name, component] of Object.entries({ Button, InputText, InputNumber, Select, Message, Dialog, Textarea })) app.component(name, component);
app.use(router)
    .use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } })
    .mount('#app');
