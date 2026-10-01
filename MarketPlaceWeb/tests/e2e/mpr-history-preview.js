// Isolated development fixture; launch on port 5188, never a production entry.
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory, RouterView } from 'vue-router';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import Toast from 'primevue/toast';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import InputIcon from 'primevue/inputicon';
import IconField from 'primevue/iconfield';
import ProgressSpinner from 'primevue/progressspinner';
import Checkbox from 'primevue/checkbox';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import 'primeicons/primeicons.css';
import OrderHistory from '../../src/views/pages/OrderHistory.vue';
import AdminOrders from '../../src/views/pages/admin/AdminOrders.vue';
import OrderHistoryService from '../../src/services/OrderHistoryService';
import AdminOrderService from '../../src/services/AdminOrderService';
import PendingOrderService from '../../src/services/PendingOrderService';
import CartService from '../../src/services/CartService';
import ProductService from '../../src/services/ProductService';
import { useCartStore } from '../../src/stores/cartStore';
import '../../src/assets/styles.scss';
import '../../src/assets/tailwind.css';

if (location.hostname !== '127.0.0.1' || location.port !== '5188') throw new Error('Use isolated local fixture port 5188');
localStorage.setItem('_userCode', 'FIXTURE-CUSTOMER');
localStorage.setItem('_userData', JSON.stringify({ user_code: 'FIXTURE-CUSTOMER', user_name: 'ลูกค้าจำลอง' }));
const lastAction = ref('ยังไม่ได้ทำรายการ');
const mode = ref('customer');
const pageKey = ref(0);
const original = [
    { doc_no: 'MPR260930000001', line_number: 1, item_code: 'PRODUCT001', item_name: 'น้ำยาปรับผ้านุ่ม 500 มล. (เลือกกลิ่นหลังบ้าน)', unit_code: 'ลัง', qty: 3, price: 305, sum_amount: 915 },
    { doc_no: 'MPR260930000001', line_number: 2, item_code: 'PRODUCT001', item_name: 'น้ำยาปรับผ้านุ่ม 500 มล. (เลือกกลิ่นหลังบ้าน)', unit_code: 'แพ็ค', qty: 5, price: 39, sum_amount: 195 }
];
const allocated = original.map((item, index) => ({ ...item, qt_allocations: [
    { ...item, doc_no: 'QT260930000001-1', line_number: 1 + index * 2, item_code: 'PRODUCT001-A', item_name: 'น้ำยาปรับผ้านุ่ม กลิ่นสีขาว', qty: 2, sum_amount: item.price * 2, wh_code: 'ST01', shelf_code: 'LC01' },
    { ...item, doc_no: 'QT260930000001-2', line_number: 1 + index * 2, item_code: 'PRODUCT001-B', item_name: 'น้ำยาปรับผ้านุ่ม กลิ่นสีชมพู', qty: item.qty - 2, sum_amount: item.price * (item.qty - 2), wh_code: 'ST02', shelf_code: 'LC02' }
] }));
const base = { doc_no: 'MPR260930000001', mpr_doc_no: 'MPR260930000001', order_kind: 'mpr', qt_main_doc_no: 'QT260930000001',
    qt_doc_nos: ['QT260930000001-1', 'QT260930000001-2'], request_status: 'confirmed', status: 'pending', can_cancel: true,
    cust_code: 'FIXTURE-CUSTOMER', cust_name: 'ร้านตัวอย่าง สมัยการค้า', emp_name: 'พนักงานตัวอย่าง', doc_date: '2026-09-30', doc_time: '11:30',
    total_amount: 1110, total_before_vat: 1037.38, total_after_vat: 1110, total_vat_value: 72.62, total_except_vat: 0, total_discount: 0,
    send_type: 0, balance: 0, remark_qt: 'รับเอง สาขาหน้าร้าน', sub_docs: [], payment_documents: [] };
let rows;
function reset() {
    rows = [structuredClone(base), { ...structuredClone(base), doc_no: 'MPR260930000002', mpr_doc_no: 'MPR260930000002',
        qt_main_doc_no: '', qt_doc_nos: [], request_status: 'pending', status: 'awaiting_confirmation', doc_time: '12:00' }];
    pageKey.value++; lastAction.value = 'ข้อมูลเริ่มต้น';
}
reset();
const response = data => ({ data: { success: true, ...data } });
function list({ search = '', status = '', page = 1, pageSize = 40 } = {}) {
    const data = rows.filter(row => (!status || status === row.status) && (!search || JSON.stringify(row).includes(search) || search === 'PRODUCT001'));
    const counts = {}; rows.forEach(row => { counts[row.status] = (counts[row.status] || 0) + 1; });
    return response({ data: data.slice((page - 1) * pageSize, page * pageSize), total_orders: data.length, page_amount: data.reduce((sum, row) => sum + row.total_amount, 0), status_counts: counts, date_from: '2026-09-24', date_to: '2026-09-30' });
}
OrderHistoryService.getOrderHistory = async (_, status, page, pageSize, filters) => list({ ...filters, status, page, pageSize });
AdminOrderService.getOrders = async params => list(params);
OrderHistoryService.getOrderHeader = async (_, doc) => response({ data: rows.find(row => row.doc_no === doc) });
function details(doc, staff, page, size, search = '') {
    const row = rows.find(row => row.doc_no === doc);
    const items = structuredClone(staff && row.request_status === 'confirmed' ? allocated : original)
        .filter(item => !search || item.item_code.includes(search) || item.item_name.includes(search));
    return response({ data: { items: items.slice((page - 1) * size, page * size), unmapped_items: [] }, paging: { page, page_size: size, total_items: items.length, total_pages: Math.max(1, Math.ceil(items.length / size)) } });
}
OrderHistoryService.getOrderDetail = async (_, doc, page = 1, size = 20, search) => details(doc, false, page, size, search);
AdminOrderService.getOrderDetail = async (_, doc, page = 1, size = 100) => details(doc, true, page, size);
PendingOrderService.cancel = async doc => { lastAction.value = `ยกเลิกคำขอ ${doc}`; Object.assign(rows.find(row => row.doc_no === doc), { request_status: 'cancelled', status: 'cancelled', can_cancel: false }); return { success: true }; };
CartService.cancelOrder = async body => { lastAction.value = `ยกเลิก QT ${body.doc_ref}`; Object.assign(rows[0], { status: 'cancel', can_cancel: false }); return response({}); };
ProductService.getProductImageUrl = () => 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
ProductService.getProductBalancePrice = async (_, code, unit) => response({ data: [{ item_code: code, item_name: 'สินค้าต้นฉบับ', unit_code: unit, balance_qty: 1000, price: 39 }] });
const pinia = createPinia();
useCartStore(pinia).addToCart = async (item, qty) => { lastAction.value = `ซื้อซ้ำ ${item.item_code} × ${qty} ${item.unit_code}`; };
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => h('span') } }] });
const app = createApp({ render: () => h('main', [
    h('div', { style: 'padding:12px;background:#fff4d9;display:flex;flex-wrap:wrap;gap:16px;align-items:center' }, [
        h('strong', 'ข้อมูลจำลอง · ไม่เชื่อม ERP'),
        h('button', { onClick: () => { mode.value = 'customer'; pageKey.value++; } }, 'มุมมองลูกค้า'),
        h('button', { onClick: () => { mode.value = 'staff'; pageKey.value++; } }, 'มุมมองพนักงาน'),
        h('button', { onClick: reset }, 'เริ่มทดสอบใหม่'), h('output', lastAction.value)
    ]), h(mode.value === 'customer' ? OrderHistory : AdminOrders, { key: pageKey.value }), h(Toast), h(RouterView)
]) });
for (const [name, component] of Object.entries({ Button, InputText, InputIcon, IconField, ProgressSpinner, Checkbox, Tag, Dialog, Message })) app.component(name, component);
app.use(pinia).use(router).use(ToastService).use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } }).directive('tooltip', Tooltip).mount('#app');
