// Full checkout component with isolated fixtures, no ERP writes.
import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Message from 'primevue/message';
import Select from 'primevue/select';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import Checkbox from 'primevue/checkbox';
import StepConfirmation from '../../src/components/cart/StepConfirmation.vue';
import CustomerService from '../../src/services/CustomerService';
import CartService from '../../src/services/CartService';
import DocHistoryService from '../../src/services/DocHistoryService';
import EmployeeService from '../../src/services/EmployeeService';
import ErpOptionService from '../../src/services/ErpOptionService';
import ProductService from '../../src/services/ProductService';
import 'primeicons/primeicons.css';
import '../../src/assets/styles.scss';
import '../../src/assets/tailwind.css';

if (location.hostname !== '127.0.0.1' || location.port !== '5188') throw new Error('Use isolated local fixture port 5188');
localStorage.setItem('_userCode', 'B00063');
localStorage.removeItem('_empCode');
const userType = ref('customer');
const scenario = ref('complete');
const key = ref(0);
const submitted = ref('ยังไม่ได้ส่งคำขอ');
const item = { item_code: 'PRODUCT001', item_name: 'น้ำยาปรับผ้านุ่ม 500 มล.', unit_code: 'แพ็ค', qty: 5, price: 39, item_type: '0', tax_type: '0' };
const response = data => ({ data: { success: true, data, total_count: 1 } });
CustomerService.getCustomerDetail = async code => {
    if (scenario.value === 'failure') throw new Error('Mock offline');
    return { code, address: scenario.value === 'empty' ? '' : '123 ถนนตัวอย่าง ตำบลสุเทพ\nอำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200', telephone: scenario.value === 'empty' ? '' : '0812345678' };
};
CartService.getCartOrder = async () => response([{ ...item }]);
CartService.getCartOrderPrice = async () => response([{ ...item, price_confirm: 39 }]);
CartService.getCustomerCredit = async () => response({});
DocHistoryService.getAdvancePayments = async () => response([]);
EmployeeService.getEmployees = async () => [];
ErpOptionService.getErpOption = async () => ({ vat_type: 1, vat_rate: 7 });
ProductService.getProductImageUrl = () => 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
function reset(mode) { scenario.value = mode; submitted.value = 'ยังไม่ได้ส่งคำขอ'; key.value++; }
const app = createApp({ render: () => h('main', { style: 'max-width:1100px;margin:auto;padding:16px' }, [
    h('div', { class: 'flex flex-wrap gap-3 mb-4 p-3 rounded bg-orange-50' }, [
        h('strong', 'ข้อมูลจำลอง · ไม่เชื่อม ERP'),
        h('button', { onClick: () => { userType.value = userType.value === 'customer' ? 'employee' : 'customer'; key.value++; } }, `มุมมอง: ${userType.value}`),
        ...[['complete', 'มีข้อมูลลูกค้า'], ['empty', 'ไม่มีที่อยู่'], ['failure', 'โหลดไม่สำเร็จ']].map(([mode, label]) => h('button', { onClick: () => reset(mode) }, label))
    ]),
    h('output', { class: 'block mb-4 whitespace-pre-wrap', 'aria-label': 'ผลการส่งคำขอ' }, submitted.value),
    h(StepConfirmation, { key: key.value, cartItems: [item], userType: userType.value,
        userData: { user_code: 'B00063', name: 'ร้านตัวอย่าง สมัยการค้า' },
        orderData: { deliveryMethod: 'pickup', customerCode: 'B00063' }, totals: { total: 195 },
        onProcessCheckout: (payload, callback) => {
            submitted.value = JSON.stringify({ send_type: payload.send_type, address: payload.address, telephone: payload.telephone }, null, 2);
            callback({ success: false, message: 'บันทึกเฉพาะตัวอย่าง ไม่ส่ง ERP' });
        }
    })
]) });
for (const [name, component] of Object.entries({ Button, InputText, Textarea, Message, Select, DatePicker, Dialog, Checkbox })) app.component(name, component);
app.use(createPinia()).use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } }).mount('#app');
