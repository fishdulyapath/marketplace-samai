import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';

import Aura from '@primevue/themes/aura';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import StyleClass from 'primevue/styleclass';
import ToastService from 'primevue/toastservice';

// Import PrimeVue components
import AutoComplete from 'primevue/autocomplete';
import Avatar from 'primevue/avatar';
import Badge from 'primevue/badge';
import Button from 'primevue/button';
import Calendar from 'primevue/calendar';
import Card from 'primevue/card';
import Carousel from 'primevue/carousel';
import Checkbox from 'primevue/checkbox';
import Chip from 'primevue/chip';
import Column from 'primevue/column';
import ConfirmDialog from 'primevue/confirmdialog';
import DataTable from 'primevue/datatable';
import DataView from 'primevue/dataview';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import Divider from 'primevue/divider';
import Dropdown from 'primevue/dropdown';
import Galleria from 'primevue/galleria';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import InputGroup from 'primevue/inputgroup';
import InputGroupAddon from 'primevue/inputgroupaddon';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import OverlayBadge from 'primevue/overlaybadge';
import Password from 'primevue/password';
import ProgressSpinner from 'primevue/progressspinner';
import RadioButton from 'primevue/radiobutton';
import Rating from 'primevue/rating';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Skeleton from 'primevue/skeleton';
import SpeedDial from 'primevue/speeddial';
import Steps from 'primevue/steps';
import TabPanel from 'primevue/tabpanel';
import TabView from 'primevue/tabview';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import Toast from 'primevue/toast';
import ToggleSwitch from 'primevue/toggleswitch';
import Tooltip from 'primevue/tooltip';

import './assets/styles.scss';
import './assets/tailwind.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(PrimeVue, {
    theme: {
        preset: Aura,
        options: {
            darkModeSelector: '.app-dark'
        }
    }
});
app.use(ToastService);
app.use(ConfirmationService);

// Register PrimeVue components
app.component('Button', Button);
app.component('Toast', Toast);
app.component('DataTable', DataTable);
app.component('Column', Column);
app.component('Message', Message);
app.component('InputText', InputText);
// AdminSalePremium.vue ใช้ <InputGroup> แต่ไม่เคยลงทะเบียน console จึง warn ทุกครั้งที่เปิด dialog
app.component('InputGroup', InputGroup);
app.component('InputGroupAddon', InputGroupAddon);
app.component('Password', Password);
app.component('Checkbox', Checkbox);
app.component('SelectButton', SelectButton);
app.component('DatePicker', DatePicker);
app.component('AutoComplete', AutoComplete);
app.component('Chip', Chip);
app.component('InputIcon', InputIcon);
app.component('IconField', IconField);
app.component('ConfirmDialog', ConfirmDialog);
app.component('Tag', Tag);
app.component('Dialog', Dialog);
app.component('Card', Card);
app.component('RadioButton', RadioButton);
app.component('Dropdown', Dropdown);
app.component('Rating', Rating);
app.component('ProgressSpinner', ProgressSpinner);
app.component('InputNumber', InputNumber);
app.component('Galleria', Galleria);
app.component('TabPanel', TabPanel);
app.component('TabView', TabView);
app.component('Divider', Divider);
app.component('DataView', DataView);
app.component('Carousel', Carousel);
app.component('MultiSelect', MultiSelect);
app.component('Avatar', Avatar);
app.component('Badge', Badge);
app.component('OverlayBadge', OverlayBadge);
app.component('Calendar', Calendar);
app.component('Skeleton', Skeleton);
app.component('Textarea', Textarea);
app.component('Select', Select);
app.component('Steps', Steps);
app.component('SpeedDial', SpeedDial);
app.component('ToggleSwitch', ToggleSwitch);

// Register directives
app.directive('styleclass', StyleClass);
app.directive('Tooltip', Tooltip);

app.mount('#app');
