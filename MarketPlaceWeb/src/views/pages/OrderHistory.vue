<script setup>
import CartService from '@/services/CartService';
import { PRODUCT_IMAGE_PLACEHOLDER } from '@/utils/productPlaceholder';
import OrderHistoryService from '@/services/OrderHistoryService';
import ProductService from '@/services/ProductService';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName, withProductDisplay } from '@/utils/languageDisplay';
import { PREORDER_REMARK } from '@/utils/preorderSplit';
import { getOrderTotalBeforeVat } from '@/utils/orderTaxTotals';

import axios from 'axios';
import { useToast } from 'primevue/usetoast';
import QRCode from 'qrcode';
import { isQrPaymentConfigured } from '@/utils/qrPayment';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const toast = useToast();
const orders = ref([]);
const loading = ref(true);
const error = ref(null);
const selectedOrder = ref(null);
const selectedOrderDetails = ref(null);
const displayOrderDetails = ref(false);
const loadingDetails = ref(false);

// Order Details Pagination
const detailsCurrentPage = ref(1);
const detailsPageSize = ref(10);
const detailsTotalItems = ref(0);
// ยอดตามใบสั่งขายจริง — ใช้แสดงคู่กับยอดที่ลูกค้าสั่งไว้เมื่อร้านแก้รายการ
const detailShipmentAmount = ref(0);
const detailsTotalPages = ref(0);
const detailsSearchTerm = ref('');
const loadingMoreDetails = ref(false);

// State สำหรับ expand/collapse {{ t('historyPages.common.productItems') }}ย่อยของสินค้าชุด
const expandedSetItems = ref(new Set());

// Dialog ยืนยันการยกเลิกคำสั่งซื้อ
const confirmCancelDialog = ref(false);
const orderToCancel = ref(null);

// QR Payment
const showQrPaymentDialog = ref(false);
// ไม่ได้ตั้งคีย์ QR API = ยังไม่เปิดใช้ช่องทางนี้ ซ่อนปุ่มทุกจุด
const qrPaymentEnabled = isQrPaymentConfigured();
const qrPaymentLoading = ref(false);
const qrCodeUrl = ref('');
const selectedOrdersForPayment = ref([]);
const paymentAmount = ref(0);
const txnUid = ref('');
const paymentInterval = ref(null);
const paymentSuccess = ref(false);
const paymentProcessing = ref(false);
const paymentSaving = ref(false); // เพิ่มตัวแปรป้องกันการบันทึกซ้ำ
const txnData = ref(null);

// Payment timeout management
const paymentTimeoutDuration = ref(300000); // 5 นาที (300,000 ms)
const paymentStartTime = ref(null);
const paymentTimeRemaining = ref(0);
const paymentTimeoutId = ref(null);
const timeUpdateInterval = ref(null);

// รหัสลูกค้า
const userCode = localStorage.getItem('_userCode');

const cartStore = useCartStore();
const languageStore = useLanguageStore();
const t = languageStore.t;
const reorderLoading = ref(false);
const localeCode = computed(() => (languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'));
const isOrderActionBusy = computed(() => loading.value || loadingDetails.value || reorderLoading.value || qrPaymentLoading.value || paymentProcessing.value || paymentSaving.value);

function stripPreorderRemark(value) {
    return String(value || '')
        .replace(/^\s*PREORDER\b\s*/i, '')
        .trim();
}

function getPreorderRemarkSource(order) {
    return order?.remark_qt || order?.remark || '';
}

function isPreorderOrder(order) {
    return String(getPreorderRemarkSource(order)).trim().toUpperCase().startsWith(PREORDER_REMARK);
}

function getDisplayOrderRemark(order, field) {
    return stripPreorderRemark(order?.[field]);
}

function hasDisplayOrderRemark(order, field) {
    return getDisplayOrderRemark(order, field).length > 0;
}

function normalizeTrackingUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (/^www\./i.test(text)) return `https://${text}`;
    return '';
}

function getTrackingUrl(order) {
    return normalizeTrackingUrl(order?.remark_5);
}

function hasTrackingUrl(order) {
    return getTrackingUrl(order).length > 0;
}

function getPreorderOrderLabel() {
    return t('orderComplete.preorderDocument');
}

function getPreorderOrderDescription() {
    if (languageStore.locale === 'en') return 'This quotation contains preorder items waiting for additional stock.';
    if (languageStore.locale === 'lo') return 'ໃບສະເໜີລາຄານີ້ເປັນລາຍການ Preorder ສຳລັບສິນຄ້າທີ່ຕ້ອງລໍຖ້າເຕີມສະຕັອກ';
    return 'ใบเสนอราคานี้เป็นรายการ Preorder สำหรับสินค้าที่ต้องรอเติมสต๊อก';
}

function getItemDisplayName(item) {
    return pickProductName(item, languageStore.locale) || item?.display_name || item?.item_name || item?.name || '';
}

function normalizeDisplayItem(item = {}) {
    return withProductDisplay({
        ...item,
        sub_item: Array.isArray(item.sub_item) ? item.sub_item.map((subItem) => withProductDisplay(subItem)) : item.sub_item
    });
}

// สถานะของออเดอร์และสีที่ใช้แสดง
const orderStatuses = computed(() => ({
    pending: { label: t('historyPages.status.pending'), color: 'warning', icon: 'pi pi-clock' },
    packing: { label: t('historyPages.status.packing'), color: 'primary', icon: 'pi pi-box' },
    payment: { label: t('historyPages.status.payment'), color: 'primary', icon: 'pi pi-send' },
    success: { label: t('historyPages.status.success'), color: 'success', icon: 'pi pi-check-circle' },
    cancel: { label: t('historyPages.status.cancel'), color: 'danger', icon: 'pi pi-times-circle' }
}));

const getOrderStatus = (status) => orderStatuses.value[status] ?? { label: status || '-', color: 'secondary', icon: 'pi pi-circle' };

function getDeliveryProofImages(order) {
    if (!order || order.status !== 'success') return [];
    const count = parseInt(order.delivery_image_count, 10) || 0;
    const imageDocNo = order.delivery_image_doc_no || order.inv_doc_no || order.doc_no;
    if (!count || !imageDocNo) return [];
    return Array.from({ length: count }, (_, index) => ({
        index,
        url: OrderHistoryService.getDeliveryProofImageUrl(imageDocNo, userCode, index)
    }));
}

// เพิ่มตัวแปรเพื่อเก็บขนาดหน้าจอปัจจุบัน
const windowWidth = ref(window.innerWidth);

// ฟังก์ชันอัพเดทขนาดหน้าจอ
const updateWidth = () => {
    windowWidth.value = window.innerWidth;
};

// เพิ่ม event listener เมื่อโหลดคอมโพเนนต์
onMounted(() => {
    window.addEventListener('resize', updateWidth);
    updateWidth(); // เรียกครั้งแรกเพื่อตั้งค่าเริ่มต้น
});

// ลบ event listener เมื่อคอมโพเนนต์ถูกทำลาย
onUnmounted(() => {
    window.removeEventListener('resize', updateWidth);

    // ล้างทุก timer เมื่อออกจากหน้านี้
    if (paymentInterval.value) {
        clearInterval(paymentInterval.value);
        paymentInterval.value = null;
    }

    if (paymentTimeoutId.value) {
        clearTimeout(paymentTimeoutId.value);
        paymentTimeoutId.value = null;
    }

    if (timeUpdateInterval.value) {
        clearInterval(timeUpdateInterval.value);
        timeUpdateInterval.value = null;
    }
});

// กรองออเดอร์
const filters = reactive({
    status: '',
    dateRange: null,
    searchTerm: ''
});

// 🚨 เดิมหน้านี้เรียก API โดยไม่ส่ง page เลย จึงได้แค่ 40 ใบล่าสุดตายตัว
//    และไม่มีปุ่มให้ดูใบเก่ากว่านั้น = ลูกค้าเข้าถึงประวัติเก่าไม่ได้เลย
//    วัดกับข้อมูลจริง: ลูกค้า 42 ราย รวม 1,648 ใบที่เปิดดูไม่ได้
//    (AR00048 มี 159 ใบ เห็นแค่ 40)
const ORDERS_PAGE_SIZE = 40;
const ordersPage = ref(1);
const totalOrders = ref(0);
const loadingMore = ref(false);

// มีหน้าถัดไปไหม — เทียบจากจำนวน "คำสั่งซื้อทั้งหมด" ที่ server บอกมา
// ไม่ใช้จำนวนแถวที่ได้รอบล่าสุด เพราะตัวกรองสถานะทำงานหลังแบ่งหน้า
// หน้าหนึ่งจึงอาจคืนน้อยกว่า page size ทั้งที่ยังมีหน้าถัดไป
const hasMoreOrders = computed(() => ordersPage.value * ORDERS_PAGE_SIZE < totalOrders.value);

// ดึงข้อมูลประวัติการสั่งซื้อจาก API
async function fetchOrderHistory({ append = false } = {}) {
    try {
        // ตัวเรียกเดิมทุกจุดไม่ส่งอาร์กิวเมนต์ = โหลดใหม่ตั้งแต่หน้าแรกเหมือนเดิม
        if (append) loadingMore.value = true;
        else loading.value = true;
        error.value = null;

        const userData = localStorage.getItem('_userData');
        if (!userData) {
            router.push('/auth/login');
            return;
        }

        const userObj = JSON.parse(userData);
        const custCode = userObj.user_code;

        if (!custCode) {
            error.value = t('historyPages.toast.noCustomer');
            return;
        }

        const nextPage = append ? ordersPage.value + 1 : 1;
        const response = await OrderHistoryService.getOrderHistory(custCode, filters.status || '', nextPage, ORDERS_PAGE_SIZE);

        if (response?.data?.success) {
            // กำหนดค่า default สำหรับยอดรวมแยกตามประเภทภาษีในรายการออเดอร์
            const ordersWithDefaults = (response.data.data || []).map((order) => ({
                ...order,
                total_except_vat: order.total_except_vat || 0,
                total_after_vat: order.total_after_vat || 0,
                total_vat_value: order.total_vat_value || 0
            }));

            orders.value = append ? [...orders.value, ...ordersWithDefaults] : ordersWithDefaults;
            ordersPage.value = nextPage;
            // ไม่มี total_orders (client เก่า/endpoint เก่า) ให้ถือว่าได้มาเท่าไรคือทั้งหมด
            totalOrders.value = Number(response.data.total_orders ?? orders.value.length);

            // Debug: ตรวจสอบข้อมูลยอดรวมแยกตามประเภทภาษีในรายการออเดอร์
            // console.log('Order History Response:', ordersWithDefaults);
            // if (ordersWithDefaults && ordersWithDefaults.length > 0) {
            //     console.log('First order tax breakdown:', {
            //         doc_no: ordersWithDefaults[0].doc_no,
            //         total_except_vat: ordersWithDefaults[0].total_except_vat,
            //         total_after_vat: ordersWithDefaults[0].total_after_vat,
            //         total_vat_value: ordersWithDefaults[0].total_vat_value
            //     });
            // }
        } else if (!append) {
            error.value = t('historyPages.orders.noOrders');
        }
    } catch (err) {
        console.error('Error fetching order history:', err);
        // โหลดหน้าถัดไปพลาด ไม่ควรลบรายการที่ดูอยู่ทิ้งแล้วขึ้น error เต็มหน้า
        if (!append) error.value = t('historyPages.orders.noOrders');
    } finally {
        loading.value = false;
        loadingMore.value = false;
    }
}

function loadMoreOrders() {
    if (loading.value || loadingMore.value || !hasMoreOrders.value) return;
    fetchOrderHistory({ append: true });
}

// ดึงรายละเอียดของคำสั่งซื้อ (Header)
function setStatusFilter(status) {
    const nextStatus = status || '';
    if (loading.value || filters.status === nextStatus) return;

    filters.status = nextStatus;
    fetchOrderHistory();
}

async function fetchOrderHeader(docNo) {
    try {
        const response = await OrderHistoryService.getOrderHeader(userCode, docNo);

        if (response?.data?.success && response.data.data) {
            const headerData = response.data.data;
            // เก็บข้อมูล{{ t('historyPages.common.all') }}ของออเดอร์ลงใน selectedOrder และกำหนดค่า default สำหรับยอดรวมแยกตามประเภทภาษี
            selectedOrder.value = {
                ...selectedOrder.value,
                ...headerData,
                // กำหนดค่า default เป็น 0 ถ้าเป็น undefined
                total_except_vat: headerData.total_except_vat || 0,
                total_after_vat: headerData.total_after_vat || 0,
                total_vat_value: headerData.total_vat_value || 0
            };
            return true;
        }
        return false;
    } catch (err) {
        console.error('Error fetching order header:', err);
        return false;
    }
}

// ดึง{{ t('historyPages.common.productItems') }}ในคำสั่งซื้อ (พร้อม pagination)
async function fetchOrderItems(docNo, page = 1, search = '', append = false) {
    try {
        if (append) {
            loadingMoreDetails.value = true;
        }

        const response = await OrderHistoryService.getOrderDetail(userCode, docNo, page, detailsPageSize.value, search);

        if (response?.data?.success) {
            const paging = response.data.paging || {};
            const items = (response.data.data?.items || []).map(normalizeDisplayItem);

            // อัพเดท pagination info
            detailsCurrentPage.value = paging.page || 1;
            detailsTotalItems.value = paging.total_items || 0;
            detailShipmentAmount.value = Number(response.data.shipment_amount || 0);
            detailsTotalPages.value = paging.total_pages || 0;

            if (append && selectedOrderDetails.value) {
                // เพิ่มรายการต่อท้าย
                selectedOrderDetails.value = [...selectedOrderDetails.value, ...items];
            } else {
                // แทนที่รายการ{{ t('historyPages.common.all') }}
                selectedOrderDetails.value = items;
            }

            return true;
        }
        return false;
    } catch (err) {
        console.error('Error fetching order items:', err);
        return false;
    } finally {
        loadingMoreDetails.value = false;
    }
}

// โหลดหน้าที่ระบุของ{{ t('historyPages.common.productItems') }} (เปลี่ยนหน้า)
async function goToDetailsPage(page) {
    if (loadingMoreDetails.value || page < 1 || page > detailsTotalPages.value || page === detailsCurrentPage.value) return;

    loadingMoreDetails.value = true;
    await fetchOrderItems(selectedOrder.value.doc_no, page, detailsSearchTerm.value, false);
    loadingMoreDetails.value = false;
}

// ค้นหา{{ t('historyPages.common.productItems') }}ในคำสั่งซื้อ
async function searchOrderItems() {
    detailsCurrentPage.value = 1;
    loadingDetails.value = true;
    await fetchOrderItems(selectedOrder.value.doc_no, 1, detailsSearchTerm.value, false);
    loadingDetails.value = false;
}

// ล้างการค้นหา
async function clearDetailsSearch() {
    detailsSearchTerm.value = '';
    detailsCurrentPage.value = 1;
    loadingDetails.value = true;
    await fetchOrderItems(selectedOrder.value.doc_no, 1, '', false);
    loadingDetails.value = false;
}

// Toggle expand/collapse สำหรับสินค้าชุด
function toggleSetItemExpand(itemCode) {
    if (expandedSetItems.value.has(itemCode)) {
        expandedSetItems.value.delete(itemCode);
    } else {
        expandedSetItems.value.add(itemCode);
    }
}

// ตรวจสอบว่าสินค้าชุดถูก expand อยู่หรือไม่
// ลูกค้าไม่ต้องรู้เลขเอกสารย่อยของ ERP แต่ต้องรู้ว่า "ของชิ้นนี้" ถูกยกเลิก
// หรือกำลังจัดอยู่ — คำสั่งซื้อที่แตกหลายใบ แต่ละใบเดินคนละ step ได้
// 🚨 คีย์ต้องเป็นเลขใบสั่งขาย ไม่ใช่เลขเอกสารย่อย — QT ใบเดียวที่ถูกแตกเป็นหลายใบสั่งขาย
//    จะมี sub_docs หลายตัวที่ doc_no เท่ากันหมด ถ้าคีย์ด้วย doc_no จะเหลือสถานะของใบสุดท้ายใบเดียว
//    แล้วทุกบรรทัดจะขึ้นป้ายเดียวกัน ทั้งที่แต่ละใบเดินคนละ step (เจอจริงตอนทดสอบ 1 QT -> 2 SO)
const subDocStatusMap = computed(() => {
    const map = new Map();
    for (const d of selectedOrder.value?.sub_docs || []) {
        map.set(String(d.so_doc_no || d.doc_no || ''), d.status);
    }
    return map;
});

const ITEM_STATUS_LABEL = {
    cancel: 'itemCancelled',
    packing: 'itemPacking',
    payment: 'itemPayment',
    success: 'itemDone'
};

// แสดงป้ายเฉพาะตอนที่ใบย่อยเดินไม่พร้อมกัน — ใบเดียวหรือทุกใบเท่ากัน
// ป้ายซ้ำทุกบรรทัดจะรกเปล่าๆ เพราะสถานะรวมบอกไปแล้ว
function itemStatusOf(item) {
    const order = selectedOrder.value;
    if (!order) return null;
    const showPerLine = order.mixed_progress === true || Number(order.cancelled_doc_count) > 0;
    if (!showPerLine) return null;
    // บรรทัดที่ถูกยกไปอยู่ในใบสั่งขายแล้ว ใช้สถานะของใบนั้น
    // ที่ยังไม่ถูกยกไปใบไหน (ของหมด/ยังไม่จัด) ตกไปใช้เลขเอกสารย่อยเหมือนเดิม
    const status = subDocStatusMap.value.get(String(item?.so_doc_no || '')) ?? subDocStatusMap.value.get(String(item?.doc_no || ''));
    const key = ITEM_STATUS_LABEL[status];
    if (!key) return null;
    return { status, label: t(`historyPages.common.${key}`), cancelled: status === 'cancel' };
}

// รายการที่ไม่ถูกยกไปอยู่ในใบส่งของ/ใบกำกับ
//
// ERP ยกเลิกสินค้าเฉพาะรายการด้วยการ "ลบรายการออก" ตอนทำเอกสารขั้นถัดไป
// ไม่ได้แก้ใบสั่งซื้อของลูกค้า (ตรวจแล้ว: ใบ marketplace ไม่มีใบไหน line_number
// ขาดช่วงเลย และยอดหัวใบตรงกับผลรวมบรรทัดทุกใบ) ใบสั่งซื้อจึงยังมีของครบเสมอ
//
// แยก 2 กรณีให้ชัด เพราะความหมายต่างกันมาก:
//   ใบยังจัดของอยู่  -> อาจยังทยอยจัดไม่ครบ ไม่ใช่ถูกตัด
//   ใบออกบิล/จบแล้ว -> ของที่ไม่อยู่ในบิล = ถูกตัดออกจริง
const SETTLED_STATUSES = ['payment', 'success'];

// ERP เอาสินค้าออกตอนทำบิล -> ยอดรวมทั้งใบเปลี่ยน (ยอดสินค้า ภาษี ทุกอย่าง)
// ยอดบนใบสั่งซื้อจึงไม่ใช่ยอดที่ลูกค้าต้องจ่ายจริงอีกต่อไป
// เจอจริงในฐาน ต่างกันได้ถึงหลักพัน เช่น MQT20251228-NMI10 สั่ง ฿267,348 บิล ฿260,548
// ยอดออกบิลจริงจะครบก็ต่อเมื่อทุกใบสั่งขายออกใบกำกับแล้ว (สถานะรวมถึงขั้น payment)
// ระหว่างที่ยังออกบิลไม่ครบ ("บางส่วนดำเนินการแล้ว") ยอดนี้จะเป็นแค่บางส่วนของออเดอร์
// เอามาโชว์คู่กับยอดที่สั่งแล้วลูกค้าอ่านไม่รู้เรื่องว่าทำไมสองยอดไม่ตรงกัน
const INVOICED_TOTAL_STATUSES = ['payment', 'success'];

function invoicedDiff(order) {
    if (!INVOICED_TOTAL_STATUSES.includes(order?.status)) return null;
    const invoiced = Number(order?.invoiced_amount || 0);
    const ordered = Number(order?.total_amount || 0);
    if (invoiced <= 0) return null;
    if (Math.abs(invoiced - ordered) < 0.01) return null;
    return invoiced;
}

// ยอดที่สั่ง vs ยอดจริง — แสดงคู่กันเมื่อร้านแก้รายการตอนจัดของ
// ออกใบกำกับแล้วใช้ยอดบิล ยังไม่ออกก็ใช้ยอดตามใบสั่งขาย
const actualTotalRow = computed(() => {
    const order = selectedOrder.value;
    if (!order) return null;
    const ordered = Number(order.total_amount || 0);
    const invoiced = Number(order.invoiced_amount || 0);
    if (INVOICED_TOTAL_STATUSES.includes(order.status) && invoiced > 0 && Math.abs(invoiced - ordered) >= 0.01) {
        return { key: 'invoicedTotal', amount: invoiced };
    }
    const shipped = Number(detailShipmentAmount.value || 0);
    if (shipped > 0 && Math.abs(shipped - ordered) >= 0.01) {
        return { key: 'shippedTotal', amount: shipped };
    }
    return null;
});

// เลขใบสั่งขาย/ใบกำกับที่ ERP ออกจากคำสั่งซื้อนี้ — QT ใบเดียวแตกได้หลายใบ
// ลูกค้าต้องอ้างเลขพวกนี้เวลาคุยกับฝ่ายขาย จึงต้องเห็นในหน้ารายละเอียด
const salesDocRows = computed(() =>
    (selectedOrder.value?.sub_docs || [])
        .filter((d) => d.so_doc_no || d.inv_doc_no)
        .map((d) => ({ so: d.so_doc_no || '', inv: d.inv_doc_no || '', status: d.status }))
);

function shipStateOf(item) {
    const state = item?.ship_state;
    // ของที่ร้านเพิ่มให้ตอนจัดของ (ของแถม/ของทดแทน) ไม่มีบรรทัดคู่กันในใบสั่งซื้อ
    // ต้องบอกลูกค้าให้ชัดว่าไม่ใช่ของที่ตัวเองกดสั่ง
    if (state === 'added') return { label: t('historyPages.common.itemAddedByStore'), removed: false, added: true };
    if (state !== 'none' && state !== 'partial') return null;
    const settled = SETTLED_STATUSES.includes(selectedOrder.value?.status);
    if (state === 'partial') {
        return {
            label: t('historyPages.common.itemPartialShip', { shipped: Number(item.shipped_qty), ordered: Number(item.qty) }),
            removed: settled
        };
    }
    return settled
        ? { label: t('historyPages.common.itemNotShipped'), removed: true }
        : { label: t('historyPages.common.itemPendingShip'), removed: false };
}

function isSetItemExpanded(itemCode) {
    return expandedSetItems.value.has(itemCode);
}

// แสดงรายละเอียดออเดอร์
async function showOrderDetails(order) {
    if (loadingDetails.value || !order?.doc_no) return;

    // Reset pagination state
    detailsCurrentPage.value = 1;
    detailsTotalItems.value = 0;
    detailShipmentAmount.value = 0;
    detailsTotalPages.value = 0;
    detailsSearchTerm.value = '';

    selectedOrder.value = order;
    displayOrderDetails.value = true;
    selectedOrderDetails.value = null;
    loadingDetails.value = true;

    try {
        // เรียก Header และ Items พร้อมกัน
        const [headerSuccess, itemsSuccess] = await Promise.all([fetchOrderHeader(order.doc_no), fetchOrderItems(order.doc_no, 1, '', false)]);

        if (!headerSuccess || !itemsSuccess) {
            toast.add({
                severity: 'error',
                summary: t('historyPages.toast.error'),
                detail: t('historyPages.toast.detailLoadOrderFailed'),
                life: 3000
            });
        }
    } catch (err) {
        console.error('Error showing order details:', err);
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: t('historyPages.toast.detailLoadOrderFailed'),
            life: 3000
        });
    } finally {
        loadingDetails.value = false;
    }
}

// ฟังก์ชันแปลงวันที่
function toDateOnly(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const text = String(value).trim();
    if (!text) return null;
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateTimestamp(value, endOfDay = false) {
    const date = toDateOnly(value);
    if (!date) return null;
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return date.getTime();
}

function formatDate(dateStr, timeStr) {
    const date = toDateOnly(dateStr);
    if (!date) return dateStr ? String(dateStr) : '';

    const thaiDate = date.toLocaleDateString(localeCode.value, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return timeStr ? `${thaiDate} ${timeStr}` : thaiDate;
}

// ฟอร์แมตวันที่เป็นรูปแบบ dd/MM/yyyy
function formatDateOnly(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = toDateOnly(dateStr);
        if (!date) return String(dateStr);

        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    } catch (error) {
        return String(dateStr);
    }
}

// ฟอร์แมตตัวเลขเป็นรูปแบบเงินบาท
function toMoneyNumber(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatCurrency(value) {
    return new Intl.NumberFormat(localeCode.value, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(toMoneyNumber(value));
}

// ฟังก์ชันเมื่อมีการเปลี่ยนแปลงสถานะกรอง
async function handleStatusChange() {
    fetchOrderHistory();
}

// ออเดอร์ที่ผ่านการกรอง
const filteredOrders = computed(() => {
    if (!orders.value) return [];

    return orders.value.filter((order) => {
        // กรองตามคำค้นหา
        if (filters.searchTerm) {
            const searchLower = String(filters.searchTerm || '').toLowerCase();
            const docNoMatch = String(order?.doc_no || '').toLowerCase().includes(searchLower);
            const statusLabel = String(getOrderStatus(order.status).label || '').toLowerCase();
            const statusMatch = statusLabel.includes(searchLower);

            return docNoMatch || statusMatch;
        }

        // กรองตามช่วงวันที่
        if (filters.dateRange && filters.dateRange.length === 2) {
            const orderDate = toDateTimestamp(order?.doc_date);
            const startDate = toDateTimestamp(filters.dateRange[0]);
            const endDate = toDateTimestamp(filters.dateRange[1], true);

            if (orderDate === null || startDate === null || endDate === null || orderDate < startDate || orderDate > endDate) {
                return false;
            }
        }

        return true;
    });
});

// รีเซ็ตการกรอง
function resetFilters() {
    filters.status = '';
    filters.dateRange = null;
    filters.searchTerm = '';
    fetchOrderHistory();
}

// แสดง dialog ยืนยันการยกเลิกคำสั่งซื้อ
function showCancelConfirmation(order) {
    if (isOrderActionBusy.value || !order?.doc_no) return;

    orderToCancel.value = order;
    confirmCancelDialog.value = true;
}

function getProductImage(itemOrCode) {
    const itemCode = typeof itemOrCode === 'object' ? itemOrCode?.item_code || itemOrCode?.code : itemOrCode;
    return itemCode ? ProductService.getProductImageUrl(itemCode, typeof itemOrCode === 'object' ? itemOrCode : {}) : PRODUCT_IMAGE_PLACEHOLDER;
}
// ดำเนินการยกเลิกคำสั่งซื้อ
async function processCancelOrder() {
    if (!orderToCancel.value || loading.value) return;

    try {
        loading.value = true;

        // ต้องดึง{{ t('historyPages.common.productItems') }}{{ t('historyPages.common.all') }}ก่อนยกเลิก
        const items = await OrderHistoryService.getAllOrderDetails(userCode, orderToCancel.value.doc_no);

        if (!items || items.length === 0) {
            throw new Error(t('historyPages.toast.detailLoadOrderFailed'));
        }

        // เลขที่ใบยกเลิกและวันเวลาออกจาก server (REQ4/REQ6)
        // คำสั่งซื้อที่ถูกแบ่งเป็นหลายเอกสาร server จะสร้างใบยกเลิกให้ครบทุกใบเอง
        const cancelOrderData = {
            doc_ref: orderToCancel.value.doc_no, // เลขที่เอกสารเดิม (เลขหลัก) ที่ต้องการยกเลิก
            cust_code: orderToCancel.value.cust_code,
            emp_code: orderToCancel.value.emp_code || '',
            total_value: orderToCancel.value.total_amount,
            total_amount: orderToCancel.value.total_amount,
            telephone: orderToCancel.value.telephone || '',
            remark: `${t('historyPages.orders.cancelOrder')}: ${orderToCancel.value.doc_no}`
            // items: items.map((item) => ({
            //     item_code: item.item_code,
            //     item_name: item.item_name,
            //     unit_code: item.unit_code,
            //     barcode: item.barcode || '',
            //     qty: item.qty,
            //     price: item.price,
            //     sum_amount: (parseFloat(item.qty) * parseFloat(item.price)).toString(),
            //     wh_code: item.wh_code || 'MMA01',
            //     shelf_code: item.shelf_code || '',
            //     stand_value: item.stand_value || '1',
            //     divide_value: item.divide_value || '1',
            //     ratio: item.ratio || '1'
            // }))
        };

        // console.log('Cancelling order with data:', cancelOrderData);

        // ส่งข้อมูลไปยกเลิกที่ API
        const response = await CartService.cancelOrder(cancelOrderData);

        if (response.data && response.data.success) {
            toast.add({
                severity: 'success',
                summary: t('historyPages.toast.cancelSuccess'),
                detail: t('historyPages.toast.cancelSuccessDetail', { docNo: orderToCancel.value.doc_no }),
                life: 3000
            });

            // หากกำลังแสดงรายละเอียดออเดอร์นี้อยู่ ให้ปิด dialog
            if (displayOrderDetails.value && selectedOrder.value?.doc_no === orderToCancel.value.doc_no) {
                displayOrderDetails.value = false;
            }

            // โหลดข้อมูลประวัติการสั่งซื้อใหม่
            await fetchOrderHistory();
        } else {
            throw new Error(response.data?.message || t('historyPages.orders.cancelOrder'));
        }
    } catch (err) {
        console.error('Error cancelling order:', err);
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: t('historyPages.orders.cancelOrder'),
            life: 3000
        });
    } finally {
        loading.value = false;
        confirmCancelDialog.value = false;
        orderToCancel.value = null;
    }
}

async function reorderItems(order) {
    if (!order || !order.doc_no) {
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: t('historyPages.toast.noOrderData'),
            life: 3000
        });
        return;
    }

    try {
        reorderLoading.value = true;

        // ดึงรายละเอียดออเดอร์{{ t('historyPages.common.all') }}เพื่อให้ได้{{ t('historyPages.common.productItems') }} (รวม pagination)
        const orderItems = await OrderHistoryService.getAllOrderDetails(userCode, order.doc_no);

        if (!orderItems || orderItems.length === 0) {
            throw new Error(t('historyPages.common.noItemsInOrder'));
        }

        // ดึงข้อมูล userData เพื่อใช้ตอนเรียก API
        const userData = localStorage.getItem('_userData');
        if (!userData) {
            throw new Error(t('historyPages.toast.loginAgain'));
        }

        const userObj = JSON.parse(userData);
        const custCode = userObj.user_code;

        // สร้าง toast สำหรับแสดงความก้าวหน้า
        toast.add({
            severity: 'info',
            summary: t('historyPages.toast.processing'),
            detail: t('historyPages.toast.checkingPriceQty'),
            life: 3000
        });

        // วนลูปเพื่อตรวจสอบราคาและสต็อกของแต่ละสินค้า
        const itemsToAdd = [];
        const unavailableItems = [];

        for (const item of orderItems) {
            try {
                // ตรวจสอบว่าเป็นสินค้าชุด (item_type = 3) หรือไม่
                if (item.item_type === 3 || item.item_type === '3') {
                    // ถ้าเป็นสินค้าชุด เรียก API getProductSetByItemCode เพื่อดึงข้อมูลราคาและสต็อกล่าสุด
                    try {
                        const setResponse = await ProductService.getProductSetByItemCode(item.item_code);

                        if (setResponse?.data) {
                            const setProduct = setResponse.data;

                            // ตรวจสอบว่าสินค้าชุดหมดหรือไม่
                            if (setProduct.sold_out === '1' || parseFloat(setProduct.balance_qty) <= 0) {
                                unavailableItems.push({
                                    ...item,
                                    reason: 'สินค้าชุดหมด'
                                });
                                continue;
                            }

                            const requestedQty = parseInt(item.qty);
                            const availableQty = parseFloat(setProduct.balance_qty);

                            // ตรวจสอบจำนวนในสต็อก
                            if (requestedQty > availableQty) {
                                // ถ้าสินค้ามีไม่พอ ให้ใช้จำนวนที่มีในสต็อก
                                itemsToAdd.push({
                                    item_code: setProduct.item_code,
                                    item_name: setProduct.item_name,
                                    unit_code: setProduct.unit_code,
                                    price: parseFloat(setProduct.price) || 0,
                                    item_type: 3,
                                    id: setProduct.item_code,
                                    code: setProduct.item_code,
                                    name: setProduct.item_name,
                                    image: setProduct.image || getProductImage(setProduct),
                                    qty: availableQty
                                });

                                toast.add({
                                    severity: 'warn',
                                    summary: 'สินค้ามีจำนวนจำกัด',
                            detail: `${getItemDisplayName(setProduct)} มีในสต็อกเพียง ${availableQty} ${setProduct.unit_code}`,
                                    life: 5000
                                });
                            } else {
                                // ถ้าสินค้ามีพอ ให้ใช้จำนวนเดิม
                                itemsToAdd.push({
                                    item_code: setProduct.item_code,
                                    item_name: setProduct.item_name,
                                    unit_code: setProduct.unit_code,
                                    price: parseFloat(setProduct.price) || 0,
                                    item_type: 3,
                                    id: setProduct.item_code,
                                    code: setProduct.item_code,
                                    name: setProduct.item_name,
                                    image: setProduct.image || getProductImage(setProduct),
                                    qty: requestedQty
                                });
                            }
                        } else {
                            // ถ้าไม่พบสินค้าชุดจาก API
                            unavailableItems.push({
                                ...item,
                                reason: 'ไม่พบข้อมูลสินค้าชุด'
                            });
                        }
                    } catch (setError) {
                        console.error('Error fetching set product:', item.item_code, setError);
                        unavailableItems.push({
                            ...item,
                            reason: 'ไม่สามารถดึงข้อมูลสินค้าชุดได้'
                        });
                    }
                    continue;
                }

                // ถ้าเป็นสินค้าปกติ ใช้ getProductBalancePrice
                const response = await ProductService.getProductBalancePrice(custCode, item.item_code, item.unit_code);

                if (response?.data?.success && response.data.data && response.data.data.length > 0) {
                    const product = response.data.data[0];

                    // ตรวจสอบว่ามีสินค้าในสต็อกหรือไม่
                    if (parseFloat(product.balance_qty) <= 0) {
                        unavailableItems.push({
                            ...item,
                            reason: 'สินค้าหมด'
                        });
                        continue;
                    }

                    // ตรวจสอบว่าจำนวนที่ต้องการสั่งเกินสต็อกหรือไม่
                    const requestedQty = parseInt(item.qty);
                    const availableQty = parseFloat(product.balance_qty);

                    if (requestedQty > availableQty) {
                        // ถ้าสินค้ามีไม่พอ ให้ใช้จำนวนที่มีในสต็อก
                        itemsToAdd.push({
                            ...product,
                            id: product.item_code,
                            code: product.item_code,
                            name: product.item_name,
                            image: getProductImage(product),
                            qty: availableQty
                        });

                        toast.add({
                            severity: 'warn',
                            summary: 'สินค้ามีจำนวนจำกัด',
                            detail: `${getItemDisplayName(product)} มีในสต็อกเพียง ${availableQty} ${product.unit_code}`,
                            life: 5000
                        });
                    } else {
                        // ถ้าสินค้ามีพอ ให้ใช้จำนวนเดิม
                        itemsToAdd.push({
                            ...product,
                            id: product.item_code,
                            code: product.item_code,
                            name: product.item_name,
                            image: getProductImage(product),
                            qty: requestedQty
                        });
                    }
                } else {
                    unavailableItems.push({
                        ...item,
                        reason: 'ไม่พบข้อมูลสินค้า'
                    });
                }
            } catch (err) {
                console.error('Error checking product availability:', err);
                unavailableItems.push({
                    ...item,
                    reason: 'เกิดข้อผิดพลาดในการตรวจสอบ'
                });
            }
        }

        // ถ้าไม่มีสินค้าที่สามารถสั่งได้เลย
        if (itemsToAdd.length === 0) {
            toast.add({
                severity: 'error',
                summary: t('historyPages.toast.reorderFailed'),
                detail: t('historyPages.toast.noAvailableReorder'),
                life: 5000
            });
            return;
        }

        // เพิ่มสินค้าลงตะกร้า
        for (const item of itemsToAdd) {
            await cartStore.addToCart(item, item.qty);
        }

        // แสดงผล
        if (unavailableItems.length > 0) {
            toast.add({
                severity: 'warn',
                summary: t('historyPages.toast.reorderPartial'),
                detail: t('historyPages.toast.addedItemsMissing', { added: itemsToAdd.length, missing: unavailableItems.length }),
                life: 5000
            });
        } else {
            toast.add({
                severity: 'success',
                summary: t('historyPages.toast.reorderSuccess'),
                detail: t('historyPages.toast.addedItemsToCart', { count: itemsToAdd.length }),
                life: 3000
            });
        }
    } catch (err) {
        console.error('Error reordering items:', err);
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: err.message || t('historyPages.toast.reorderFailed'),
            life: 3000
        });
    } finally {
        reorderLoading.value = false;
    }
}

// ฟังก์ชันสร้างรูปภาพ QR Code
async function generateQRImage(qrCodeData) {
    try {
        // console.log('🖼️ Starting QR image generation...');
        // console.log('📱 QR Code data for image generation:', qrCodeData);

        // สร้าง QR code แบบ inline
        const url = await QRCode.toDataURL(qrCodeData, {
            errorCorrectionLevel: 'H',
            margin: 2,
            width: 300,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });

        // console.log('✅ QR code image generated successfully!');
        // console.log('🔗 Generated image URL length:', url.length);
        return url;
    } catch (error) {
        console.error('❌ Error generating QR code image:', error);
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: `${t('historyPages.toast.createQrFailed')}: ${error.message}`,
            life: 5000
        });
        return '';
    }
}

// ฟังก์ชันสำหรับสร้าง QR Code
async function generateQRCode() {
    // console.log('🚀 Starting generateQRCode function...');
    // console.log('📊 Selected orders for payment:', selectedOrdersForPayment.value);

    qrPaymentLoading.value = true;
    paymentSuccess.value = false;

    try {
        // คำนวณยอดเงินรวมของเอกสารที่เลือก
        paymentAmount.value = selectedOrdersForPayment.value.reduce((sum, order) => {
            return sum + toMoneyNumber(order.total_amount);
        }, 0);

        // console.log('💰 Payment amount calculated:', paymentAmount.value);

        // สร้าง random references
        const ref1 = Math.random().toString(36).substring(2, 10);
        const ref2 = Math.random().toString(36).substring(2, 10);
        const ref3 = Math.random().toString(36).substring(2, 10);
        const ref4 = Math.random().toString(36).substring(2, 10);

        // console.log('🔗 Generated references:', { ref1, ref2, ref3, ref4 });

        const requestData = {
            amount: paymentAmount.value,
            ref1: ref1,
            ref2: ref2,
            ref3: ref3,
            ref4: ref4
        };

        // console.log('📤 Sending request to QR API...');
        // console.log('🌐 API URL:', import.meta.env.VITE_QR_API_URL);
        // console.log('📝 Request data:', requestData);

        const response = await axios.post(import.meta.env.VITE_QR_API_URL, requestData, {
            headers: {
                'x-api-key': import.meta.env.VITE_QR_API_KEY
            }
        });

        // console.log('📥 QR API Response:', response.data);

        if (response.data && response.data.qrCode) {
            txnUid.value = response.data.txnUid;

            // console.log('✅ QR Code data received successfully!');
            // console.log('🆔 Transaction UID:', txnUid.value);
            // console.log('📱 QR Code data:', response.data.qrCode);

            // Generate QR code image
            const qrImage = await generateQRImage(response.data.qrCode);
            if (!qrImage) {
                throw new Error('Failed to generate QR code image');
            }

            qrCodeUrl.value = qrImage;
            // console.log('🖼️ QR Code image generated and set to qrCodeUrl');

            // เริ่มตรวจสอบสถานะการชำระเงิน
            startCheckPaymentStatus();
        } else {
            console.error('❌ Invalid response from QR API:', response.data);
            throw new Error(t('historyPages.toast.noQrFromServer'));
        }
    } catch (error) {
        console.error('❌ Error in generateQRCode:', error);
        console.error('📋 Error details:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });

        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: `${t('historyPages.toast.createQrFailed')}: ${error.message}`,
            life: 5000
        });
    } finally {
        qrPaymentLoading.value = false;
        // console.log('🏁 generateQRCode function completed');
    }
}

// ฟังก์ชันตรวจสอบสถานะการชำระเงิน
function startCheckPaymentStatus() {
    paymentProcessing.value = true;
    paymentStartTime.value = Date.now();
    paymentTimeRemaining.value = paymentTimeoutDuration.value;

    if (paymentInterval.value) {
        clearInterval(paymentInterval.value);
    }

    // Clear existing timeout and time update interval
    if (paymentTimeoutId.value) {
        clearTimeout(paymentTimeoutId.value);
    }
    if (timeUpdateInterval.value) {
        clearInterval(timeUpdateInterval.value);
    }

    // ตั้งเวลาหมดอายุ
    paymentTimeoutId.value = setTimeout(() => {
        handlePaymentTimeout();
    }, paymentTimeoutDuration.value);

    // อัพเดทเวลาที่เหลือ
    timeUpdateInterval.value = setInterval(() => {
        if (paymentStartTime.value) {
            const elapsed = Date.now() - paymentStartTime.value;
            paymentTimeRemaining.value = Math.max(0, paymentTimeoutDuration.value - elapsed);

            if (paymentTimeRemaining.value <= 0) {
                clearInterval(timeUpdateInterval.value);
                timeUpdateInterval.value = null;
            }
        }
    }, 1000);

    paymentInterval.value = setInterval(async () => {
        try {
            const status = await checkPaymentStatus();

            // console.log('Current payment status:', status);

            if (status === 'PAID' && !paymentSaving.value) {
                // console.log('Payment completed, stopping status check');

                // ล้างทุก timer
                clearInterval(paymentInterval.value);
                clearTimeout(paymentTimeoutId.value);
                clearInterval(timeUpdateInterval.value);

                paymentInterval.value = null;
                paymentTimeoutId.value = null;
                timeUpdateInterval.value = null;

                paymentProcessing.value = false;
                paymentSaving.value = true; // ป้องกันการทำงานซ้ำ

                try {
                    // บันทึกการชำระเงิน
                    await savePaymentTransaction();

                    // ตั้งค่าสถานะหลังบันทึก /pay สำเร็จแล้วเท่านั้น
                    paymentSuccess.value = true;

                    // แสดงข้อความแจ้งเตือน
                    toast.add({
                        severity: 'success',
                        summary: t('historyPages.toast.paymentSuccess'),
                        detail: t('historyPages.toast.paymentReceived'),
                        life: 5000
                    });

                    // clear selected orders for payment
                    selectedOrdersForPayment.value = [];
                    multiSelectMode.value = false;
                    selectedOrders.value = [];

                    // โหลดข้อมูลประวัติการสั่งซื้อใหม่
                    await fetchOrderHistory();
                } catch (error) {
                    console.error('Error in payment completion process:', error);
                } finally {
                    paymentSaving.value = false; // รีเซ็ตสถานะ
                }
            }
        } catch (error) {
            console.error('Error checking payment status:', error);
        }
    }, 5000); // ตรวจสอบทุก 5 วินาที
}

// ฟังก์ชันตรวจสอบสถานะการชำระเงิน
async function checkPaymentStatus() {
    try {
        const response = await axios.post(
            'https://kapiqr.smlsoft.com/qrapi/payment-status',
            {
                txnUid: txnUid.value
            },
            {
                headers: {
                    'x-api-key': import.meta.env.VITE_QR_API_KEY
                }
            }
        );

        if (response.data) {
            // console.log('Payment check response:', response.data);
            txnData.value = response.data;
            return response.data.txnStatus || 'REQUESTED';
        }

        return 'REQUESTED';
    } catch (error) {
        console.error('Error checking payment status:', error);
        return 'ERROR';
    }
}

// ฟังก์ชันบันทึกข้อมูลการชำระเงิน
async function savePaymentTransaction() {
    try {
        // console.log('Starting payment transaction save...');

        // สร้าง doc_no และ doc_time
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const random = Math.floor(Math.random() * 90000) + 10000;

        const docNo = `WRC${year}${month}${day}${hours}${minutes}-${random}`;
        const docDate = `${year}-${month}-${day}`;
        const docTime = `${hours}:${minutes}`; // เพิ่ม doc_time

        // สร้าง payment data
        const paymentData = {
            doc_no: docNo,
            cust_code: selectedOrdersForPayment.value[0].cust_code,
            doc_date: docDate,
            doc_time: docTime, // เพิ่ม doc_time
            wallet_amount: paymentAmount.value,
            total_amount: paymentAmount.value,
            trans_number: txnData.value?.txnuid || txnData.value?.txnUid || txnUid.value || '',
            no_approved: txnData.value?.txnNo || '',
            emp_code: selectedOrdersForPayment.value[0].emp_code || '',
            remark: '',
            doc_detail: selectedOrdersForPayment.value.map((order) => ({
                trans_flag: '44',
                doc_no: order.inv_doc_no,
                doc_date: order.inv_doc_date,
                total_amount: toMoneyNumber(order.total_amount)
            }))
        };

        // console.log('Sending payment data:', paymentData);

        // ส่งข้อมูลไปยัง API
        const response = await OrderHistoryService.payOrder(paymentData);

        if (!response.data || !response.data.success) {
            throw new Error(t('historyPages.toast.savePaymentFailed'));
        }

        // console.log('Payment transaction saved successfully');
    } catch (error) {
        console.error('Error saving payment transaction:', error);
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: t('historyPages.toast.savePaymentFailed'),
            life: 3000
        });
        throw error; // ส่งต่อ error เพื่อให้ caller จัดการ
    }
}

// ฟังก์ชันแสดง dialog ชำระเงิน QR Code
function showQRPayment(orders) {
    // console.log('🎯 Starting showQRPayment function...');
    // console.log('📋 Input orders:', orders);

    if (!Array.isArray(orders)) {
        orders = [orders];
        // console.log('🔄 Converted single order to array:', orders);
    }

    // ต้องการเฉพาะเอกสารที่สถานะ payment หรือ partial
    const validOrders = orders.filter((order) => order.status === 'payment');
    // console.log('✅ Valid orders for payment:', validOrders);

    if (validOrders.length === 0) {
        // console.log('❌ No valid orders found for payment');
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.cannotPay'),
            detail: t('historyPages.toast.noPayableDocs'),
            life: 3000
        });
        return;
    }

    selectedOrdersForPayment.value = validOrders;
    // console.log('📝 Set selectedOrdersForPayment:', selectedOrdersForPayment.value);

    showQrPaymentDialog.value = true;
    // console.log('🚪 Opened QR payment dialog');

    // console.log('🚀 Calling generateQRCode...');
    generateQRCode();
}

// ฟังก์ชันยกเลิกการชำระเงิน
function cancelQRPayment() {
    // ล้างทุก timer
    if (paymentInterval.value) {
        clearInterval(paymentInterval.value);
        paymentInterval.value = null;
    }

    if (paymentTimeoutId.value) {
        clearTimeout(paymentTimeoutId.value);
        paymentTimeoutId.value = null;
    }

    if (timeUpdateInterval.value) {
        clearInterval(timeUpdateInterval.value);
        timeUpdateInterval.value = null;
    }

    // รีเซ็ตค่า
    paymentSuccess.value = false;
    paymentProcessing.value = false;
    paymentSaving.value = false;
    paymentStartTime.value = null;
    paymentTimeRemaining.value = 0;
    showQrPaymentDialog.value = false;
    selectedOrdersForPayment.value = [];
}

// Multi-select variables
const multiSelectMode = ref(false);
const selectedOrders = ref([]);

// ฟังก์ชันเปิด/ปิดโหมดเลือกหลายรายการ
function toggleMultiSelectMode() {
    multiSelectMode.value = !multiSelectMode.value;
    // ล้างรายการที่เลือกเมื่อออกจากโหมดเลือกหลายรายการ
    if (!multiSelectMode.value) {
        selectedOrders.value = [];
    }
}

// ฟังก์ชันตรวจสอบว่าออเดอร์ถูกเลือกหรือไม่
function isOrderSelected(order) {
    return selectedOrders.value.some((o) => o.doc_no === order.doc_no);
}

// ฟังก์ชันเลือก/ยกเลิกการเลือกออเดอร์
function toggleOrderSelection(order) {
    if (isOrderSelected(order)) {
        selectedOrders.value = selectedOrders.value.filter((o) => o.doc_no !== order.doc_no);
    } else {
        selectedOrders.value.push(order);
    }
}

// เลือก{{ t('historyPages.common.all') }}ที่ชำระได้
function selectAllPayableOrders() {
    if (!filteredOrders.value) return;

    // เลือกเฉพาะใบสถานะ 'payment' — server ยุบใบที่ชำระบางส่วนมาเป็นสถานะนี้แล้ว
    const payableOrders = filteredOrders.value.filter((order) => order.status === 'payment');


    // ถ้าได้เลือก{{ t('historyPages.common.all') }}แล้ว ให้ยกเลิกการเลือก{{ t('historyPages.common.all') }}
    if (selectedOrders.value.length === payableOrders.length) {
        selectedOrders.value = [];
    } else {
        selectedOrders.value = [...payableOrders];
    }
}

// ฟังก์ชันชำระเงินสำหรับออเดอร์ที่เลือก
function paySelectedOrders() {
    if (selectedOrders.value.length === 0) {
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.cannotPay'),
            detail: t('historyPages.toast.selectPaymentItems'),
            life: 3000
        });
        return;
    }

    // ตรวจสอบว่ารายการที่เลือกมีสถานะที่ชำระได้ (payment หรือ partial)
    const validOrders = selectedOrders.value.filter((order) => order.status === 'payment');

    if (validOrders.length === 0) {
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.cannotPay'),
            detail: t('historyPages.toast.noPayableSelected'),
            life: 3000
        });
        return;
    }

    // ใช้ฟังก์ชัน showQRPayment ที่มีอยู่แล้วโดยส่งอาร์เรย์ของออเดอร์ที่เลือก
    showQRPayment(validOrders);
}

// คำนวณจำนวนออเดอร์ที่สามารถเลือกได้ (สถานะ payment และ partial)
const payableOrdersCount = computed(() => {
    if (!filteredOrders.value) return 0;
    return filteredOrders.value.filter((order) => order.status === 'payment').length;
});

// คำนวณยอดรวมของออเดอร์ที่เลือก
const selectedOrdersTotal = computed(() => {
    return selectedOrders.value.reduce((sum, order) => {
        return sum + toMoneyNumber(order.total_amount);
    }, 0);
});

const selectedPaymentDocsTotal = computed(() => {
    return selectedOrdersForPayment.value.reduce((sum, order) => {
        return sum + toMoneyNumber(order.total_amount);
    }, 0);
});

const orderMetrics = computed(() => {
    const list = filteredOrders.value || [];

    // เหลือแค่ 2 การ์ด (จำนวนคำสั่งซื้อ / สำเร็จ) — การ์ดยอดรวมถูกตัดตามรีวิว 260908
    return list.reduce(
        (acc, order) => {
            acc.totalOrders += 1;
            if (order.status === 'success') acc.successOrders += 1;
            return acc;
        },
        {
            totalOrders: 0,
            successOrders: 0
        }
    );
});

// ฟังก์ชันสำหรับดาวน์โหลดรูปภาพ QR Code
function downloadQRCode() {
    if (!qrCodeUrl.value) return;

    try {
        // สร้าง element a สำหรับดาวน์โหลด
        const link = document.createElement('a');
        link.href = qrCodeUrl.value;
        link.download = `qr-payment-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.add({
            severity: 'success',
            summary: t('historyPages.toast.downloadSuccess'),
            detail: t('historyPages.toast.qrSaved'),
            life: 3000
        });
    } catch (error) {
        console.error('Error downloading QR code:', error);
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: t('historyPages.toast.qrDownloadFailed'),
            life: 3000
        });
    }
}

// ฟังก์ชันจัดการเมื่อเวลาหมดอายุ
function handlePaymentTimeout() {
    // ล้างทุก timer
    if (paymentInterval.value) {
        clearInterval(paymentInterval.value);
        paymentInterval.value = null;
    }

    if (timeUpdateInterval.value) {
        clearInterval(timeUpdateInterval.value);
        timeUpdateInterval.value = null;
    }

    paymentProcessing.value = false;
    paymentTimeRemaining.value = 0;

    toast.add({
        severity: 'warn',
        summary: t('historyPages.toast.paymentTimeout'),
        detail: t('historyPages.toast.qrExpiredDetail'),
        life: 5000
    });
}

// ฟังก์ชันแปลงเวลาเป็นรูปแบบ MM:SS
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// ดึงข้อมูลเมื่อโหลดคอมโพเนนต์
onMounted(fetchOrderHistory);
</script>

<template>
    <div class="oh-page">
        <div class="oh-container">
            <!-- ══ TOP BAR ══════════════════════════════════ -->
            <div class="oh-topbar mb-4">
                <div class="oh-topbar__left">
                    <h1 class="oh-topbar__title">{{ t('historyPages.orders.title') }}</h1>
                    <p class="oh-topbar__sub">{{ t('historyPages.orders.subtitle') }}</p>
                </div>
                <div v-if="qrPaymentEnabled && payableOrdersCount > 1 && !loading && filteredOrders.length > 0" class="oh-topbar__actions">
                    <Button
                        :label="multiSelectMode ? t('historyPages.common.stopSelecting') : t('historyPages.common.selectMultiple')"
                        :icon="multiSelectMode ? 'pi pi-times' : 'pi pi-check-square'"
                        :severity="multiSelectMode ? 'secondary' : 'primary'"
                        size="small"
                        @click="toggleMultiSelectMode"
                    />
                </div>
            </div>

            <!-- ══ METRIC STRIP ══════════════════════════════ -->
            <div v-if="!loading && !error && filteredOrders.length > 0" class="oh-metrics mb-4">
                <div class="oh-metric oh-metric--blue">
                    <i class="pi pi-shopping-bag oh-metric__icon"></i>
                    <div>
                        <div class="oh-metric__val">{{ orderMetrics.totalOrders }}</div>
                        <div class="oh-metric__lbl">{{ t('historyPages.orders.ordersMetric') }}</div>
                    </div>
                </div>
                <div class="oh-metric oh-metric--green">
                    <i class="pi pi-check-circle oh-metric__icon"></i>
                    <div>
                        <div class="oh-metric__val">{{ orderMetrics.successOrders }}</div>
                        <div class="oh-metric__lbl">{{ t('historyPages.orders.successMetric') }}</div>
                    </div>
                </div>
            </div>

            <!-- ══ MULTI-SELECT BAR ══════════════════════════ -->
            <div v-if="multiSelectMode" class="oh-select-bar mb-4">
                <div class="oh-select-bar__info">
                    <i class="pi pi-check-square mr-1.5"></i>
                    <span class="font-semibold">{{ selectedOrders.length }}/{{ payableOrdersCount }}</span> {{ t('historyPages.common.selected') }}
                    <span v-if="selectedOrders.length > 0" class="ml-3 text-emerald-600 font-semibold"> ฿{{ formatCurrency(selectedOrdersTotal) }} </span>
                </div>
                <div class="flex gap-2">
                    <Button
                        :label="selectedOrders.length === payableOrdersCount ? t('historyPages.common.deselectAll') : t('historyPages.common.selectAll')"
                        :icon="selectedOrders.length === payableOrdersCount ? 'pi pi-times-circle' : 'pi pi-check-circle'"
                        outlined
                        size="small"
                        :disabled="isOrderActionBusy"
                        @click="selectAllPayableOrders"
                    />
                    <Button :label="t('historyPages.common.payQr')" icon="pi pi-qrcode" severity="warning" size="small" @click="paySelectedOrders" :disabled="selectedOrders.length === 0 || isOrderActionBusy" />
                </div>
            </div>

            <!-- ══ STATUS TABS (Shopee-style) ══════════════════ -->
            <div class="soh-tabs mb-0">
                <button
                    type="button"
                    :class="['soh-tab', filters.status === '' ? 'soh-tab--active' : '']"
                    :aria-pressed="filters.status === ''"
                    :disabled="loading"
                    @click="setStatusFilter('')"
                >
                    {{ t('historyPages.common.all') }}
                </button>
                <button
                    v-for="(info, key) in orderStatuses"
                    :key="key"
                    type="button"
                    :class="['soh-tab', filters.status === key ? 'soh-tab--active' : '']"
                    :aria-pressed="filters.status === key"
                    :disabled="loading"
                    @click="setStatusFilter(key)"
                >
                    {{ info.label }}
                </button>
            </div>

            <!-- ══ SEARCH BAR ════════════════════════════════ -->
            <div class="soh-search mb-3">
                <IconField iconPosition="left" class="w-full">
                    <InputText v-model="filters.searchTerm" :placeholder="t('historyPages.orders.searchPlaceholder')" :aria-label="t('historyPages.orders.searchPlaceholder')" class="w-full soh-search__input" />
                    <InputIcon class="pi pi-search" />
                </IconField>
            </div>

            <!-- ══ STATES ════════════════════════════════════ -->
            <div v-if="loading" class="oh-state-box">
                <ProgressSpinner strokeWidth="4" style="width: 44px; height: 44px" />
            </div>

            <div v-else-if="error" class="oh-state-box">
                <i class="pi pi-exclamation-triangle text-4xl text-amber-400 mb-3"></i>
                <p class="font-medium mb-1">{{ t('historyPages.common.errorTitle') }}</p>
                <p class="text-sm text-gray-500 mb-3">{{ error }}</p>
                <Button :label="t('historyPages.common.retry')" icon="pi pi-refresh" size="small" @click="fetchOrderHistory" />
            </div>

            <div v-else-if="filteredOrders.length === 0" class="oh-state-box">
                <i class="pi pi-inbox text-5xl text-gray-300 mb-3"></i>
                <p class="font-medium mb-1">{{ t('historyPages.orders.noOrders') }}</p>
                <p class="text-sm text-gray-500 mb-3">
                    {{ filters.status || filters.searchTerm ? t('historyPages.orders.noOrdersMatching') : t('historyPages.orders.noOrderHistory') }}
                </p>
                <Button :label="t('historyPages.common.shopStart')" icon="pi pi-shopping-cart" size="small" @click="router.push('/')" />
            </div>

            <!-- ══ ORDER LIST (Shopee-style) ══════════════════ -->
            <div v-else class="soh-list">
                <div v-for="order in filteredOrders" :key="order.doc_no" class="soh-card" :class="{ 'soh-card--selected': multiSelectMode && isOrderSelected(order) }">
                    <!-- ── Card header: shop name + status ── -->
                    <div class="soh-card__head">
                        <div class="soh-card__head-left">
                            <div v-if="multiSelectMode && (order.status === 'payment')" class="mr-2">
                                <Checkbox :modelValue="isOrderSelected(order)" :aria-label="`${t('historyPages.common.select')} ${order.doc_no}`" @update:modelValue="toggleOrderSelection(order)" :binary="true" />
                            </div>
                            <i class="pi pi-shop soh-card__shop-icon"></i>
                            <span class="soh-card__shop-name">{{ order.doc_no }}</span>
                            <span v-if="isPreorderOrder(order)" class="soh-preorder-chip"><i class="pi pi-clock mr-1"></i>{{ getPreorderOrderLabel() }}</span>
                            <span v-if="order.emp_name" class="soh-card__emp"> <i class="pi pi-comment mr-0.5"></i>{{ order.emp_name }} </span>
                        </div>
                        <div class="soh-card__head-right">
                            <i :class="[getOrderStatus(order.status).icon, 'mr-1', 'soh-status-icon', `soh-status-icon--${order.status}`]"></i>
                            <span class="soh-status-label" :class="`soh-status-label--${order.status}`">
                                {{ getOrderStatus(order.status).label }}
                            </span>
                            <span v-if="getDeliveryProofImages(order).length" class="delivery-proof-chip"><i class="pi pi-image mr-1"></i>มีหลักฐานจัดส่ง</span>
                        </div>
                    </div>

                    <!-- ── Remarks / tracking ── -->
                    <div v-if="hasTrackingUrl(order)" class="soh-card__track">
                        <i class="pi pi-truck mr-1.5 text-blue-500"></i>
                        <a :href="getTrackingUrl(order)" target="_blank" class="soh-track-link">{{ getTrackingUrl(order) }}</a>
                    </div>
                    <div v-if="hasDisplayOrderRemark(order, 'remark_qt')" class="soh-card__remark"><i class="pi pi-info-circle mr-1.5 text-gray-400"></i>{{ getDisplayOrderRemark(order, 'remark_qt') }}</div>
                    <div v-if="order.remark_cancel" class="soh-card__remark soh-card__remark--cancel"><i class="pi pi-times-circle mr-1.5"></i>{{ order.remark_cancel }}</div>

                    <!-- ── Product summary row (Shopee-style) ── -->
                    <div class="soh-card__product">
                        <div class="soh-card__product-info">
                            <div class="soh-card__product-meta">
                                <span class="soh-card__date">{{ formatDate(order.doc_date, order.doc_time) }}</span>
                                <span class="soh-card__delivery">
                                    <i :class="String(order.send_type) === '1' ? 'pi pi-truck' : 'pi pi-home'" class="mr-1"></i>
                                    {{ String(order.send_type) === '1' ? t('historyPages.common.shipping') : t('historyPages.common.pickup') }}
                                </span>
                            </div>
                            <div class="soh-card__tax-row">
                                <span>{{ t('historyPages.common.totalBeforeVat') }} ฿{{ formatCurrency(getOrderTotalBeforeVat(order)) }}</span>
                                <span>VAT: ฿{{ formatCurrency(order.total_vat_value || 0) }}</span>
                            </div>
                        </div>
                        <div class="soh-card__total-block">
                            <!-- เอกสารบางใบถูกดึงไปทำ step ถัดไปแล้ว สถานะรวมยังเป็นใบที่ช้าสุด
                                 ถ้าไม่บอก ลูกค้าจะคิดว่ายังไม่มีอะไรเกิดขึ้นเลย -->
                            <span v-if="order.mixed_progress" class="soh-card__mixed">
                                <i class="pi pi-sort-alt" /> {{ t('historyPages.common.partialProgress') }}
                            </span>
                            <span class="soh-card__total-label">{{ t('historyPages.common.orderTotal') }}</span>
                            <span class="soh-card__total-amount">฿{{ formatCurrency(order.total_amount) }}</span>
                            <!-- คำสั่งซื้อที่ถูกแตกเป็นหลายเอกสาร ถ้า ERP ยกเลิกบางใบ
                                 ยอดข้างบนจะสูงกว่ายอดที่ต้องจ่ายจริง ต้องบอกให้ลูกค้าเห็น -->
                            <span v-if="Number(order.cancelled_amount) > 0 && order.status !== 'cancel'" class="soh-card__net">
                                {{ t('historyPages.common.netTotal') }} ฿{{ formatCurrency(order.active_amount) }}
                            </span>
                            <span v-if="invoicedDiff(order)" class="soh-card__net soh-card__net--invoiced">
                                {{ t('historyPages.common.invoicedTotal') }} ฿{{ formatCurrency(invoicedDiff(order)) }}
                            </span>
                        </div>
                    </div>

                    <!-- ── Footer: notice + buttons ── -->
                    <div class="soh-card__foot">
                        <div class="soh-card__foot-left">
                            <div v-if="order.status === 'success' && parseFloat(order.balance) > 0" class="soh-card__balance-warn"><i class="pi pi-exclamation-circle mr-1"></i>{{ t('historyPages.common.outstandingBalance') }} ฿{{ formatCurrency(order.balance) }}</div>
                            <Tag v-if="order.status === 'success' && parseFloat(order.balance) === 0 && order.wallet_amount && parseFloat(order.wallet_amount) > 0" :value="t('historyPages.common.paymentQrPaid')" severity="success" class="text-xs" />
                        </div>

                        <div class="soh-card__foot-actions">
                            <button v-if="order.status === 'pending'" type="button" class="soh-btn soh-btn--ghost soh-btn--danger" :disabled="isOrderActionBusy" @click="showCancelConfirmation(order)">{{ t('historyPages.orders.cancelOrder') }}</button>
                            <button v-if="qrPaymentEnabled && order.status === 'payment' && !multiSelectMode" type="button" class="soh-btn soh-btn--warning" :disabled="isOrderActionBusy" @click="showQRPayment(order)">{{ t('historyPages.common.payQr') }}</button>
                            <button v-if="multiSelectMode && (order.status === 'payment')" type="button" :class="['soh-btn', isOrderSelected(order) ? 'soh-btn--ghost' : 'soh-btn--outline']" :aria-pressed="isOrderSelected(order)" :disabled="isOrderActionBusy" @click="toggleOrderSelection(order)">
                                {{ isOrderSelected(order) ? t('historyPages.common.cancel') : t('historyPages.common.select') }}
                            </button>
                            <button type="button" class="soh-btn soh-btn--outline" :disabled="loadingDetails" @click="showOrderDetails(order)">{{ t('historyPages.common.details') }}</button>
                            <button type="button" class="soh-btn soh-btn--primary" @click="reorderItems(order)" :disabled="isOrderActionBusy">{{ t('historyPages.orders.buyAgain') }}</button>
                        </div>
                    </div>
                </div>

                <!-- ปุ่มดูคำสั่งซื้อเก่ากว่านี้ — ไม่มีปุ่มนี้ลูกค้าจะติดอยู่แค่ 40 ใบล่าสุด -->
                <div v-if="hasMoreOrders" class="soh-more">
                    <!-- โชว์ตัวเลขเฉพาะตอนดู "ทั้งหมด" — total_orders ที่ server ส่งมาเป็นยอดรวมทุกสถานะ
                         ถ้ากำลังกรองสถานะอยู่แล้วเขียนว่า "36 จาก 121" จะอ่านผิดเป็น 36 จาก 121 ใบที่สำเร็จ -->
                    <span v-if="!filters.status" class="soh-more__count">{{ t('historyPages.common.showingOf', { shown: orders.length, total: totalOrders }) }}</span>
                    <Button
                        :label="loadingMore ? t('catalog.loadingMore') : t('catalog.loadMore')"
                        icon="pi pi-angle-down"
                        outlined
                        :loading="loadingMore"
                        :disabled="loading || loadingMore"
                        @click="loadMoreOrders"
                    />
                </div>
            </div>

            <!-- Order details dialog ที่ปรับปรุงแล้ว -->
            <Dialog
                v-model:visible="displayOrderDetails"
                :header="t('historyPages.orders.detailHeader', { docNo: selectedOrder?.doc_no || '' })"
                :style="{ width: '95%', maxWidth: '1200px' }"
                :modal="true"
                :closeOnEscape="true"
                :dismissableMask="true"
                :draggable="false"
                class="order-details-dialog"
            >
                <!-- Loading state for details -->
                <div v-if="loadingDetails" class="flex justify-center items-center p-8">
                    <ProgressSpinner strokeWidth="4" style="width: 50px; height: 50px" />
                </div>

                <div v-else-if="selectedOrder" class="order-details">
                    <div class="detail-hero mb-4">
                        <div class="detail-hero__left">
                            <div class="detail-hero__caption">{{ t('historyPages.common.docNo') }}</div>
                            <div class="detail-hero__doc">{{ selectedOrder.doc_no }}</div>
                            <div class="detail-hero__date">{{ formatDate(selectedOrder.doc_date, selectedOrder.doc_time) }}</div>
                        </div>
                        <div class="detail-hero__right">
                            <div class="detail-hero__caption">{{ t('historyPages.common.docTotal') }}</div>
                            <div class="detail-hero__amount">฿{{ formatCurrency(selectedOrder.total_amount) }}</div>
                            <Tag :value="String(selectedOrder.send_type) === '1' ? t('historyPages.common.shipping') : t('historyPages.common.pickup')" :severity="String(selectedOrder.send_type) === '1' ? 'info' : 'success'" class="mt-1" />
                        </div>
                    </div>

                    <!-- Order Status and Basic Info -->
                    <div class="flex flex-col md:flex-row gap-4 mb-4">
                        <div
                            class="status-container p-3 border border-gray-200 dark:border-gray-700 rounded-lg flex-1"
                            :class="{
                                'bg-green-50 dark:bg-green-900/20': selectedOrder.status === 'success',
                                'bg-blue-50 dark:bg-blue-900/20': selectedOrder.status === 'payment' || selectedOrder.status === 'packing',
                                'bg-red-50 dark:bg-red-900/20': selectedOrder.status === 'cancel',
                                'bg-yellow-50 dark:bg-yellow-900/20': selectedOrder.status === 'pending',
                                'bg-gray-50 dark:bg-gray-800': getOrderStatus(selectedOrder.status).color === 'secondary'
                            }"
                        >
                            <div class="flex items-center">
                                <i :class="[getOrderStatus(selectedOrder.status).icon, 'text-xl mr-2', `text-${getOrderStatus(selectedOrder.status).color}-500`]"></i>
                                <span class="font-semibold">{{ getOrderStatus(selectedOrder.status).label }}</span>
                            </div>
                            <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                <div>{{ t('historyPages.common.orderDate') }} {{ formatDate(selectedOrder.doc_date, selectedOrder.doc_time) }}</div>

                                <div v-if="String(selectedOrder.send_type) === '1'" class="mt-1">
                                    <template v-if="selectedOrder.send_date && Number(selectedOrder.send_date_confirmed) === 1">
                                        {{ t('historyPages.common.deliveryDate') }} {{ formatDate(selectedOrder.send_date) }}
                                    </template>
                                    <template v-else>{{ t('reviewOrder.deliveryByNormalRound') }}</template>
                                </div>

                                <div v-if="selectedOrder.status == 'pending'">{{ t('historyPages.common.pendingContact') }}</div>
                            </div>
                        </div>

                        <div class="payment-summary p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 flex-1">
                            <div class="font-semibold mb-1">{{ t('historyPages.common.paymentSummary') }}</div>

                            <!-- ยอดรวมแยกตามประเภทภาษี (แสดงทุกครั้ง) -->
                            <div class="mb-2 border-b border-gray-200 dark:border-gray-700 pb-2">
                                <div class="text-xs text-gray-500 mb-1">{{ t('historyPages.common.taxBreakdown') }}</div>

                                <div v-if="Number(selectedOrder.cancelled_amount) > 0" class="flex justify-between text-sm text-red-600 dark:text-red-400">
                                    <span>{{ t('historyPages.common.cancelledTotal') }}</span>
                                    <span class="font-medium">-฿{{ formatCurrency(selectedOrder.cancelled_amount) }}</span>
                                </div>
                                <div class="flex justify-between text-sm">
                                    <span>{{ t('historyPages.common.cnTotal') }}</span>
                                    <span class="font-medium">฿{{ formatCurrency(selectedOrder.cn_total_amount || 0) }}</span>
                                </div>
                                <div class="flex justify-between text-sm">
                                    <span>{{ t('historyPages.common.totalBeforeVat') }}</span>
                                    <span class="font-medium">฿{{ formatCurrency(getOrderTotalBeforeVat(selectedOrder)) }}</span>
                                </div>
                                <div class="flex justify-between text-sm">
                                    <span>{{ t('historyPages.common.totalAfterVat') }}</span>
                                    <span class="font-medium">฿{{ formatCurrency(selectedOrder.total_after_vat || 0) }}</span>
                                </div>
                                <div class="flex justify-between text-sm">
                                    <span>{{ t('historyPages.common.vatAmount') }}</span>
                                    <span class="font-medium">฿{{ formatCurrency(selectedOrder.total_vat_value || 0) }}</span>
                                </div>
                            </div>

                            <div class="flex justify-between text-sm">
                                <span>{{ actualTotalRow ? t('historyPages.common.orderedTotal') : t('historyPages.common.totalPrefix') }}</span>
                                <span class="font-medium">฿{{ formatCurrency(selectedOrder.total_amount) }}</span>
                            </div>
                            <div v-if="actualTotalRow" class="flex justify-between text-sm text-emerald-700 dark:text-emerald-400 font-semibold">
                                <span>{{ t('historyPages.common.' + actualTotalRow.key) }}</span>
                                <span>฿{{ formatCurrency(actualTotalRow.amount) }}</span>
                            </div>
                            <div v-if="parseFloat(selectedOrder.balance) > 0" class="flex justify-between text-sm text-red-600">
                                <span>{{ t('historyPages.common.outstandingBalance') }}</span>
                                <span class="font-medium">฿{{ formatCurrency(selectedOrder.balance) }}</span>
                            </div>
                        </div>
                    </div>

                    <div v-if="isPreorderOrder(selectedOrder)" class="order-preorder-banner">
                        <i class="pi pi-clock"></i>
                        <div>
                            <strong>{{ getPreorderOrderLabel() }}</strong>
                            <span>{{ getPreorderOrderDescription() }}</span>
                        </div>
                    </div>

                    <!-- Customer and Employee Info -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg detail-section">
                            <h3 class="text-lg font-semibold mb-2 flex items-center">
                                <i class="pi pi-user mr-2 text-primary-500"></i>
                                {{ t('historyPages.common.customerInfo') }}
                            </h3>
                            <div class="grid grid-cols-2 gap-2">
                                <div class="text-sm text-gray-500">{{ t('historyPages.common.customerCode') }}</div>
                                <div class="text-sm font-medium">{{ selectedOrder.cust_code }}</div>

                                <div class="text-sm text-gray-500">{{ t('historyPages.common.phone') }}</div>
                                <div class="text-sm font-medium">
                                    {{ selectedOrder.telephone || '-' }}
                                </div>
                            </div>
                        </div>

                        <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg detail-section">
                            <h3 class="text-lg font-semibold mb-2 flex items-center">
                                <i class="pi pi-briefcase mr-2 text-primary-500"></i>
                                {{ t('historyPages.common.employeeInfo') }}
                            </h3>
                            <div class="grid grid-cols-2 gap-2">
                                <!-- <div class="text-sm text-gray-500">{{ t('historyPages.common.employeeCode') }}</div>
                                <div class="text-sm font-medium">{{ selectedOrder.emp_code || '-' }}</div> -->

                                <div class="text-sm text-gray-500">{{ t('historyPages.common.employeeName') }}</div>
                                <div class="text-sm font-medium">
                                    {{ selectedOrder.emp_name || t('historyPages.common.noEmployee') }}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- {{ t('historyPages.common.deliveryInfo') }} -->
                    <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg mb-4 detail-section">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <i class="pi pi-map-marker mr-2 text-primary-500"></i>
                            {{ t('historyPages.common.deliveryInfo') }}
                        </h3>

                        <!-- วิธีรับสินค้า -->
                        <div class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.receiveMethod') }}</div>
                            <div class="text-sm font-medium mt-1">
                                <Tag :severity="selectedOrder.address_name === '1' ? 'info' : 'success'" :value="String(selectedOrder.send_type) === '1' ? t('historyPages.common.shipping') : t('historyPages.common.pickup')" />
                            </div>
                        </div>

                        <!-- ข้อมูลที่อยู่สำหรับจัดส่ง -->
                        <div v-if="String(selectedOrder.send_type) === '1'" class="mt-2">
                            <div class="text-sm text-gray-500 mt-2">
                                {{ t('historyPages.common.shippingAddress') }}
                                <Tag :severity="selectedOrder.address_name === t('historyPages.common.currentAddress') ? 'info' : 'success'" :value="selectedOrder.address_name" />
                            </div>
                            <div class="text-sm font-medium">{{ selectedOrder.address || '-' }}</div>
                        </div>

                        <!-- สถานะการจัดส่ง -->
                        <div v-if="hasTrackingUrl(selectedOrder)" class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.trackingLink') }}</div>
                            <div class="text-sm font-medium mt-1">
                                <a :href="getTrackingUrl(selectedOrder)" target="_blank" class="flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                                    <i class="pi pi-external-link mr-1"></i>
                                    <span class="truncate">{{ getTrackingUrl(selectedOrder) }}</span>
                                </a>
                            </div>
                        </div>

                        <div v-if="getDeliveryProofImages(selectedOrder).length" class="delivery-proof-block">
                            <div class="text-sm font-semibold mb-2 flex items-center">
                                <i class="pi pi-images mr-2 text-green-600"></i>
                                หลักฐานการจัดส่ง
                            </div>
                            <div class="delivery-proof-grid">
                                <a v-for="image in getDeliveryProofImages(selectedOrder)" :key="image.index" :href="image.url" target="_blank" class="delivery-proof-link">
                                    <img :src="image.url" :alt="`หลักฐานการจัดส่ง ${image.index + 1}`" class="delivery-proof-image" loading="lazy" />
                                </a>
                            </div>
                        </div>
                    </div>

                    <!-- เอกสารฝ่ายขายที่ออกจากคำสั่งซื้อนี้ -->
                    <div v-if="salesDocRows.length" class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg mb-4 detail-section">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <i class="pi pi-file mr-2 text-primary-500"></i>
                            {{ t('historyPages.common.salesDocs') }}
                        </h3>
                        <div class="flex flex-col gap-2">
                            <div v-for="(doc, idx) in salesDocRows" :key="`${doc.so}-${doc.inv}-${idx}`" class="sales-doc-row">
                                <div class="sales-doc-row__nums">
                                    <span v-if="doc.so" class="sales-doc-chip">
                                        <span class="sales-doc-chip__label">{{ t('historyPages.common.soDocNo') }}</span>
                                        <span class="sales-doc-chip__value">{{ doc.so }}</span>
                                    </span>
                                    <span v-if="doc.inv" class="sales-doc-chip sales-doc-chip--inv">
                                        <span class="sales-doc-chip__label">{{ t('historyPages.common.invDocNo') }}</span>
                                        <span class="sales-doc-chip__value">{{ doc.inv }}</span>
                                    </span>
                                </div>
                                <Tag :severity="getOrderStatus(doc.status).color" :value="getOrderStatus(doc.status).label" />
                            </div>
                        </div>
                    </div>

                    <!-- {{ t('historyPages.common.notes') }}ต่างๆ -->
                    <div v-if="hasDisplayOrderRemark(selectedOrder, 'remark') || hasDisplayOrderRemark(selectedOrder, 'remark_qt') || selectedOrder.remark_inv || selectedOrder.remark_cancel" class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg mb-4 detail-section">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <i class="pi pi-comment mr-2 text-primary-500"></i>
                            {{ t('historyPages.common.notes') }}
                        </h3>

                        <div v-if="hasDisplayOrderRemark(selectedOrder, 'remark')" class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.generalRemark') }}</div>
                            <div class="text-sm mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                                {{ getDisplayOrderRemark(selectedOrder, 'remark') }}
                            </div>
                        </div>

                        <div v-if="hasDisplayOrderRemark(selectedOrder, 'remark_qt')" class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.orderRemark') }}</div>
                            <div class="text-sm mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                                {{ getDisplayOrderRemark(selectedOrder, 'remark_qt') }}
                            </div>
                        </div>

                        <div v-if="selectedOrder.remark_inv" class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.saleRemark') }}</div>
                            <div class="text-sm mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                                {{ selectedOrder.remark_inv }}
                            </div>
                        </div>

                        <div v-if="selectedOrder.remark_cancel" class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.cancelRemark') }}</div>
                            <div class="text-sm mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-red-600">
                                {{ selectedOrder.remark_cancel }}
                            </div>
                        </div>
                    </div>

                    <!-- Order Items with responsive layout -->
                    <div v-if="selectedOrderDetails && selectedOrderDetails.length > 0" class="mb-4">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <i class="pi pi-shopping-cart mr-2 text-primary-500"></i>
                            {{ t('historyPages.common.productItems') }}
                            <span v-if="detailsTotalItems > 0" class="ml-2 text-sm font-normal text-gray-500"> ({{ selectedOrderDetails.length }} / {{ t('historyPages.common.itemCount', { count: detailsTotalItems }) }}) </span>
                        </h3>

                        <!-- Search box for order items -->
                        <div class="mb-3 flex gap-2">
                            <span class="p-input-icon-left flex-1">
                                <InputText v-model="detailsSearchTerm" :placeholder="t('historyPages.common.searchProductItems')" :aria-label="t('historyPages.common.searchProductItems')" class="w-full" @keyup.enter="searchOrderItems" />
                            </span>
                            <Button v-if="detailsSearchTerm" icon="pi pi-times" severity="secondary" outlined :aria-label="t('common.clearSearch')" @click="clearDetailsSearch" />
                            <Button icon="pi pi-search" :aria-label="t('historyPages.common.searchProductItems')" @click="searchOrderItems" :loading="loadingDetails" />
                        </div>

                        <!-- Desktop Table (visible based on screen width using JS) -->
                        <div v-if="windowWidth >= 500" class="order-items-table">
                            <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                <!-- Table header -->
                                <div class="grid grid-cols-12 bg-gray-50 dark:bg-gray-800 p-3 border-b border-gray-200 dark:border-gray-700">
                                    <div class="col-span-5 font-medium">{{ t('historyPages.common.product') }}</div>
                                    <div class="col-span-2 font-medium text-center">{{ t('historyPages.common.unit') }}</div>
                                    <div class="col-span-2 font-medium text-right">{{ t('historyPages.common.price') }}</div>
                                    <div class="col-span-1 font-medium text-right">{{ t('historyPages.common.quantity') }}</div>
                                    <div class="col-span-2 font-medium text-right">{{ t('historyPages.common.itemTotal') }}</div>
                                </div>

                                <!-- Table rows -->
                                <div class="divide-y divide-gray-200 dark:divide-gray-700">
                                    <template v-for="(item, index) in selectedOrderDetails" :key="index">
                                        <!-- สินค้าปกติ หรือ สินค้าชุด (หัวข้อหลัก) -->
                                        <div class="grid grid-cols-12 p-3 hover:bg-gray-50 dark:hover:bg-gray-800" :class="{ 'bg-purple-50 dark:bg-purple-900/20': item.item_type === 3 || item.item_type === '3' }">
                                            <div class="col-span-5">
                                                <div class="font-medium text-primary-600 dark:text-primary-400 flex items-center">
                                                    {{ getItemDisplayName(item) }}

                                                    <!-- ปุ่มกดเปิด/ปิดรายการย่อยสำหรับสินค้าชุด -->
                                                    <Tag v-if="item.item_type === 3 || item.item_type === '3'" :value="t('historyPages.common.set')" severity="secondary" class="ml-2 text-xs" />
                                                    <Button
                                                        v-if="(item.item_type === 3 || item.item_type === '3') && item.sub_item && item.sub_item.length > 0"
                                                        :icon="isSetItemExpanded(item.item_code) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                                                        text
                                                        rounded
                                                        size="small"
                                                        :aria-expanded="isSetItemExpanded(item.item_code)"
                                                        :aria-label="isSetItemExpanded(item.item_code) ? t('historyPages.common.hideSubItems') : t('historyPages.common.showSubItems')"
                                                        @click="toggleSetItemExpand(item.item_code)"
                                                        class="ml-2 p-1"
                                                        v-tooltip.top="isSetItemExpanded(item.item_code) ? t('historyPages.common.hideSubItems') : t('historyPages.common.showSubItems')"
                                                    />
                                                </div>
                                                <div class="text-xs text-gray-500 dark:text-gray-400">{{ t('historyPages.common.code') }} {{ item.item_code }}</div>
                                                <span v-if="itemStatusOf(item)" :class="['inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-xs font-medium', itemStatusOf(item).cancelled ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300']">
                                                    <i :class="itemStatusOf(item).cancelled ? 'pi pi-times-circle text-xs' : 'pi pi-box text-xs'" /> {{ itemStatusOf(item).label }}
                                                </span>
                                                <span v-if="shipStateOf(item)" :class="['inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-xs font-medium', shipStateOf(item).added ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : shipStateOf(item).removed ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300']">
                                                    <i :class="shipStateOf(item).added ? 'pi pi-plus-circle text-xs' : shipStateOf(item).removed ? 'pi pi-minus-circle text-xs' : 'pi pi-hourglass text-xs'" /> {{ shipStateOf(item).label }}
                                                </span>
                                                <span v-if="Number(item.is_permium) === 1" class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-xs font-medium bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300"><i class="pi pi-gift text-xs" /> ของแถม</span>
                                            </div>
                                            <div class="col-span-2 text-center self-center">
                                                {{ item.unit_code }}
                                            </div>
                                            <div class="col-span-2 text-right self-center">฿ {{ formatCurrency(item.price || (item.sum_amount ? item.sum_amount / item.qty : 0)) }}</div>
                                            <div class="col-span-1 text-right self-center">{{ item.qty }}</div>
                                            <div class="col-span-2 text-right self-center font-semibold">฿ {{ formatCurrency(item.sum_amount || parseFloat(item.qty) * parseFloat(item.price || 0)) }}</div>
                                        </div>

                                        <!-- Sub items สำหรับสินค้าชุด (แสดงเมื่อ expand) -->
                                        <template v-if="(item.item_type === 3 || item.item_type === '3') && item.sub_item && item.sub_item.length > 0 && isSetItemExpanded(item.item_code)">
                                            <div v-for="(subItem, subIndex) in item.sub_item" :key="`${index}-sub-${subIndex}`" class="grid grid-cols-12 p-3 bg-gray-50 dark:bg-gray-800/50 border-purple-300 dark:border-purple-600">
                                                <div class="col-span-5">
                                                    <div class="font-medium text-gray-700 dark:text-gray-300 flex items-center">
                                                        <i class="pi pi-angle-right text-purple-400 mr-1"></i>
                                                        {{ getItemDisplayName(subItem) }}
                                                    </div>
                                                    <div class="text-xs text-gray-500 dark:text-gray-400 ml-4">{{ t('historyPages.common.code') }} {{ subItem.item_code }}</div>
                                                </div>
                                                <div class="col-span-2 text-center self-center text-gray-600 dark:text-gray-400">
                                                    {{ subItem.unit_code }}
                                                </div>
                                                <div class="col-span-2 text-right self-center text-gray-600 dark:text-gray-400">
                                                    {{ subItem.price ? `฿ ${formatCurrency(subItem.price)}` : '฿0' }}
                                                </div>
                                                <div class="col-span-1 text-right self-center text-gray-600 dark:text-gray-400">{{ subItem.qty }}</div>
                                                <div class="col-span-2 text-right self-center text-gray-600 dark:text-gray-400">฿ {{ formatCurrency(subItem.sum_amount || parseFloat(subItem.qty) * parseFloat(subItem.price || 0)) }}</div>
                                            </div>
                                        </template>
                                    </template>
                                </div>
                            </div>
                        </div>

                        <!-- Card View (visible based on screen width using JS) -->
                        <div v-else class="order-items-cards">
                            <template v-for="(item, index) in selectedOrderDetails" :key="index">
                                <!-- สินค้าปกติ หรือ สินค้าชุด (หัวข้อหลัก) -->
                                <div class="mb-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg" :class="{ 'border-purple-300 dark:border-purple-600 bg-purple-50 dark:bg-purple-900/20': item.item_type === 3 || item.item_type === '3' }">
                                    <div class="flex justify-between items-start mb-2">
                                        <div class="font-medium text-primary-600 dark:text-primary-400 flex items-center flex-wrap gap-1">
                                            <Tag v-if="item.item_type === 3 || item.item_type === '3'" :value="t('historyPages.common.productSet')" severity="secondary" class="text-xs" />
                                            {{ getItemDisplayName(item) }}
                                            <!-- ปุ่มกดเปิด/ปิดรายการย่อยสำหรับสินค้าชุด (Mobile) -->
                                            <Button
                                                v-if="(item.item_type === 3 || item.item_type === '3') && item.sub_item && item.sub_item.length > 0"
                                                :icon="isSetItemExpanded(item.item_code) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                                                text
                                                rounded
                                                size="small"
                                                :aria-expanded="isSetItemExpanded(item.item_code)"
                                                :aria-label="isSetItemExpanded(item.item_code) ? t('historyPages.common.hideSubItems') : t('historyPages.common.showSubItems')"
                                                @click="toggleSetItemExpand(item.item_code)"
                                                class="p-1"
                                            />
                                        </div>
                                        <div class="font-semibold">฿{{ formatCurrency(item.sum_amount || parseFloat(item.qty) * parseFloat(item.price || 0)) }}</div>
                                    </div>
                                    <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">{{ t('historyPages.common.code') }} {{ item.item_code }}</div>
                                    <div v-if="itemStatusOf(item)" class="mb-2">
                                        <span :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', itemStatusOf(item).cancelled ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300']">
                                            <i :class="itemStatusOf(item).cancelled ? 'pi pi-times-circle text-xs' : 'pi pi-box text-xs'" /> {{ itemStatusOf(item).label }}
                                        </span>
                                    </div>
                                    <div v-if="shipStateOf(item)" class="mb-2">
                                        <span :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', shipStateOf(item).added ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : shipStateOf(item).removed ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300']">
                                            <i :class="shipStateOf(item).added ? 'pi pi-plus-circle text-xs' : shipStateOf(item).removed ? 'pi pi-minus-circle text-xs' : 'pi pi-hourglass text-xs'" /> {{ shipStateOf(item).label }}
                                        </span>
                                    </div>
                                    <div v-if="Number(item.is_permium) === 1" class="mb-2"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300"><i class="pi pi-gift text-xs" /> ของแถม</span></div>
                                    <!-- แสดงจำนวนรายการย่อยเมื่อยุบ (Mobile) -->
                                    <div v-if="(item.item_type === 3 || item.item_type === '3') && item.sub_item && item.sub_item.length > 0 && !isSetItemExpanded(item.item_code)" class="text-xs text-purple-500 dark:text-purple-400 mb-2">
                                        <i class="pi pi-list mr-1"></i>{{ t('historyPages.common.subItemsCollapsed', { count: item.sub_item.length }) }}
                                    </div>
                                    <div class="grid grid-cols-3 text-sm mt-2">
                                        <div>
                                            <div class="text-gray-500 mb-1">{{ t('historyPages.common.unit') }}</div>
                                            <div>{{ item.unit_code }}</div>
                                        </div>
                                        <div>
                                            <div class="text-gray-500 mb-1">{{ t('historyPages.common.price') }}</div>
                                            <div>฿{{ formatCurrency(item.price || (item.sum_amount ? item.sum_amount / item.qty : 0)) }}</div>
                                        </div>
                                        <div>
                                            <div class="text-gray-500 mb-1">{{ t('historyPages.common.quantity') }}</div>
                                            <div>{{ item.qty }}</div>
                                        </div>
                                    </div>

                                    <!-- Sub items สำหรับสินค้าชุด (Mobile Card View) - แสดงเมื่อ expand -->
                                    <div v-if="(item.item_type === 3 || item.item_type === '3') && item.sub_item && item.sub_item.length > 0 && isSetItemExpanded(item.item_code)" class="mt-3 pt-3 border-t border-purple-200 dark:border-purple-700">
                                        <div class="text-xs text-purple-600 dark:text-purple-400 font-medium mb-2"><i class="pi pi-list mr-1"></i>{{ t('historyPages.common.subItemsTitle') }}</div>
                                        <div v-for="(subItem, subIndex) in item.sub_item" :key="`${index}-sub-${subIndex}`" class="mb-2 p-2 bg-white dark:bg-gray-800 rounded border-l-2 border-purple-400">
                                            <div class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ getItemDisplayName(subItem) }}</div>
                                            <div class="text-xs text-gray-500">{{ t('historyPages.common.code') }} {{ subItem.item_code }}</div>
                                            <div class="flex gap-4 text-xs text-gray-500 mt-1">
                                                <span>{{ subItem.unit_code }}</span>
                                                <span>{{ t('historyPages.common.quantity') }}: {{ subItem.qty }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </div>

                        <!-- Pagination สำหรับ{{ t('historyPages.common.productItems') }} -->
                        <div v-if="detailsTotalPages > 1" class="flex justify-center items-center gap-1 mt-4">
                            <!-- First page -->
                            <Button icon="pi pi-angle-double-left" text rounded size="small" :aria-label="t('cartPage.firstPage')" :disabled="detailsCurrentPage === 1 || loadingMoreDetails" @click="goToDetailsPage(1)" class="w-8 h-8" />
                            <!-- Previous page -->
                            <Button icon="pi pi-angle-left" text rounded size="small" :aria-label="t('cartPage.previousPage')" :disabled="detailsCurrentPage === 1 || loadingMoreDetails" @click="goToDetailsPage(detailsCurrentPage - 1)" class="w-8 h-8" />

                            <!-- Page numbers -->
                            <span class="px-3 text-sm text-gray-600 dark:text-gray-400"> {{ t('historyPages.common.pageOf', { current: detailsCurrentPage, total: detailsTotalPages }) }} </span>

                            <!-- Next page -->
                            <Button icon="pi pi-angle-right" text rounded size="small" :aria-label="t('cartPage.nextPage')" :disabled="detailsCurrentPage === detailsTotalPages || loadingMoreDetails" @click="goToDetailsPage(detailsCurrentPage + 1)" class="w-8 h-8" />
                            <!-- Last page -->
                            <Button icon="pi pi-angle-double-right" text rounded size="small" :aria-label="t('cartPage.lastPage')" :disabled="detailsCurrentPage === detailsTotalPages || loadingMoreDetails" @click="goToDetailsPage(detailsTotalPages)" class="w-8 h-8" />
                        </div>

                        <!-- Pagination Info -->
                        <div v-if="detailsTotalItems > 0" class="text-center text-sm text-gray-500 mt-2">{{ t('historyPages.common.showingOf', { shown: selectedOrderDetails.length, total: detailsTotalItems }) }}</div>

                        <!-- Order Items Summary -->
                        <div class="bg-gray-50 dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg mt-2">
                            <div class="flex flex-col gap-2">
                                <!-- แสดงยอดรวมแยกตามประเภทภาษี (แสดงทุกครั้ง) -->
                                <div class="border-b border-gray-200 dark:border-gray-700 pb-2">
                                    <div class="text-xs text-gray-500 mb-1">{{ t('historyPages.common.taxBreakdown') }}</div>
                                    <div v-if="Number(selectedOrder.cancelled_amount) > 0" class="flex justify-between text-sm text-red-600 dark:text-red-400">
                                        <span>{{ t('historyPages.common.cancelledTotal') }}</span>
                                        <span class="font-medium">-฿{{ formatCurrency(selectedOrder.cancelled_amount) }}</span>
                                    </div>
                                    <div class="flex justify-between text-sm">
                                        <span>{{ t('historyPages.common.cnTotal') }}</span>
                                        <span class="font-medium">฿{{ formatCurrency(selectedOrder.cn_total_amount || 0) }}</span>
                                    </div>
                                    <div class="flex justify-between text-sm">
                                        <span>{{ t('historyPages.common.totalBeforeVat') }}</span>
                                        <span class="font-medium">฿{{ formatCurrency(getOrderTotalBeforeVat(selectedOrder)) }}</span>
                                    </div>
                                    <div class="flex justify-between text-sm">
                                        <span>{{ t('historyPages.common.totalAfterVat') }}</span>
                                        <span class="font-medium">฿{{ formatCurrency(selectedOrder.total_after_vat || 0) }}</span>
                                    </div>
                                    <div class="flex justify-between text-sm">
                                        <span>{{ t('historyPages.common.vatAmount') }}</span>
                                        <span class="font-medium">฿{{ formatCurrency(selectedOrder.total_vat_value || 0) }}</span>
                                    </div>
                                </div>

                                <!-- ข้อมูลการชำระเงิน -->
                                <div v-if="parseFloat(selectedOrder.balance) > 0" class="border-b border-gray-200 dark:border-gray-700 pb-2">
                                    <div class="flex justify-between text-sm mb-1 text-green-600">
                                        <span>{{ t('historyPages.common.paidAmount') }}</span>
                                        <span class="font-medium">฿{{ formatCurrency(toMoneyNumber(selectedOrder.total_amount) - toMoneyNumber(selectedOrder.balance)) }}</span>
                                    </div>
                                    <div class="flex justify-between text-sm text-red-600">
                                        <span>{{ t('historyPages.common.outstandingBalance') }}</span>
                                        <span class="font-medium">฿{{ formatCurrency(selectedOrder.balance) }}</span>
                                    </div>
                                </div>

                                <!-- รวมทั้งสิ้น -->
                                <div class="flex justify-between items-center pt-2">
                                    <div class="font-medium text-lg">{{ actualTotalRow ? t('historyPages.common.orderedTotal') : t('historyPages.common.grandTotal') }}</div>
                                    <div class="font-bold text-primary-600 dark:text-primary-400 text-xl">฿{{ formatCurrency(selectedOrder.total_amount) }}</div>
                                </div>
                                <div v-if="actualTotalRow" class="flex justify-between items-center">
                                    <div class="font-medium text-lg text-emerald-700 dark:text-emerald-400">{{ t('historyPages.common.' + actualTotalRow.key) }}</div>
                                    <div class="font-bold text-emerald-700 dark:text-emerald-400 text-xl">฿{{ formatCurrency(actualTotalRow.amount) }}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div v-else-if="!loadingDetails" class="mb-4 flex items-center justify-center p-6 border border-yellow-200 bg-yellow-50 rounded-lg text-yellow-800">
                        <i class="pi pi-exclamation-triangle mr-2"></i>
                        <span>{{ t('historyPages.common.noItemsInOrder') }}</span>
                    </div>
                </div>

                <template #footer>
                    <div class="flex flex-wrap gap-2 justify-end">
                        <Button v-if="selectedOrder && selectedOrder.status === 'pending'" :label="t('historyPages.orders.cancelOrder')" icon="pi pi-times-circle" severity="danger" size="small" @click="showCancelConfirmation(selectedOrder)" />
                        <Button v-if="qrPaymentEnabled && selectedOrder && selectedOrder.status === 'payment'" :label="t('historyPages.common.payQr')" icon="pi pi-qrcode" severity="warning" size="small" @click="showQRPayment(selectedOrder)" />
                        <Button
                            v-if="selectedOrder"
                            :label="t('historyPages.orders.reorder')"
                            icon="pi pi-refresh"
                            severity="success"
                            size="small"
                            @click="
                                reorderItems(selectedOrder);
                                displayOrderDetails = false;
                            "
                            :loading="reorderLoading"
                        />
                        <Button :label="t('historyPages.common.close')" icon="pi pi-times" outlined size="small" @click="displayOrderDetails = false" />
                    </div>
                </template>
            </Dialog>

            <!-- Dialog ยืนยันการยกเลิกคำสั่งซื้อ -->
            <Dialog v-model:visible="confirmCancelDialog" :modal="true" :draggable="false" :closable="false" :header="t('historyPages.orders.cancelHeader')" :style="{ width: '90%', maxWidth: '800px' }" :closeOnEscape="true" :dismissableMask="true">
                <div class="flex items-center">
                    <i class="pi pi-exclamation-triangle text-yellow-500 mr-4" style="font-size: 2rem" />
                    <span>
                        {{ t('historyPages.orders.cancelMessage') }} <br />
                        <span class="font-medium">{{ orderToCancel?.doc_no }}</span> {{ t('historyPages.orders.cancelQuestion') }}</span
                    >
                </div>
                <template #footer>
                    <div class="flex justify-end gap-2">
                        <Button :label="t('historyPages.common.cancel')" icon="pi pi-times" outlined @click="confirmCancelDialog = false" :disabled="loading" />
                        <Button :label="t('historyPages.common.confirm')" icon="pi pi-check" @click="processCancelOrder" :loading="loading" severity="danger" />
                    </div>
                </template>
            </Dialog>

            <!-- Dialog การชำระเงินด้วย QR Code -->
            <Dialog v-model:visible="showQrPaymentDialog" :modal="true" :draggable="false" :closable="false" :header="t('historyPages.common.qrPayment')" :style="{ width: '90%', maxWidth: '500px' }" :closeOnEscape="false">
                <div class="flex flex-col items-center justify-center p-4">
                    <!-- แสดงเวลาที่เหลือ -->
                    <div v-if="paymentProcessing && paymentTimeRemaining > 0" class="w-full mb-4">
                        <div class="flex justify-between items-center mb-2">
                            <span class="text-sm font-medium">{{ t('historyPages.common.timeRemaining') }}</span>
                            <span class="text-lg font-bold" :class="paymentTimeRemaining < 60000 ? 'text-red-500' : 'text-primary-500'">
                                {{ formatTime(paymentTimeRemaining) }}
                            </span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2">
                            <div
                                class="h-2 rounded-full transition-all duration-1000"
                                :class="paymentTimeRemaining < 60000 ? 'bg-red-500' : 'bg-primary-500'"
                                :style="{
                                    width: `${(paymentTimeRemaining / paymentTimeoutDuration) * 100}%`
                                }"
                            ></div>
                        </div>
                    </div>

                    <!-- QR Code หมดอายุ -->
                    <div v-if="paymentTimeRemaining <= 0 && !paymentSuccess" class="flex flex-col items-center justify-center mb-4">
                        <i class="pi pi-times-circle text-red-500 mb-3" style="font-size: 3rem"></i>
                        <div class="text-lg font-medium text-red-500 mb-2">{{ t('historyPages.common.qrExpired') }}</div>
                        <Button :label="t('historyPages.common.regenerateQr')" icon="pi pi-refresh" @click="generateQRCode" />
                    </div>

                    <div v-else-if="qrPaymentLoading" class="flex flex-col items-center justify-center mb-4">
                        <ProgressSpinner strokeWidth="4" style="width: 50px; height: 50px" />
                        <div class="text-lg font-medium mt-3">{{ t('historyPages.common.generatingQr') }}</div>
                    </div>

                    <div v-else-if="paymentSuccess" class="flex flex-col items-center justify-center mb-4">
                        <div class="relative">
                            <img :src="qrCodeUrl" alt="QR Code" class="max-w-full h-auto" style="max-width: 250px" />
                            <div class="absolute inset-0 flex items-center justify-center bg-green-100 bg-opacity-70 rounded-lg">
                                <i class="pi pi-check-circle text-green-500" style="font-size: 5rem"></i>
                            </div>
                        </div>
                        <div class="text-lg font-medium mt-3 text-green-500">{{ t('historyPages.common.paymentSuccess') }}</div>
                    </div>

                    <div v-else class="flex flex-col items-center justify-center mb-4">
                        <div class="relative">
                            <img :src="qrCodeUrl" alt="QR Code" class="max-w-full h-auto mb-4" style="max-width: 250px" />
                        </div>

                        <Button v-if="!paymentSuccess && qrCodeUrl" :label="t('historyPages.common.downloadQr')" icon="pi pi-download" class="p-button-outlined p-button-info mb-4" @click="downloadQRCode" />

                        <div class="text-lg font-medium">{{ t('historyPages.common.paymentTotal') }} ฿{{ formatCurrency(paymentAmount) }}</div>
                        <div class="text-center text-gray-600 dark:text-gray-400 mt-2">
                            {{ t('historyPages.common.scanQrInstruction') }}<br />
                            {{ t('historyPages.common.autoCheckInstruction') }}
                        </div>

                        <div v-if="paymentProcessing" class="flex items-center justify-center mt-3">
                            <ProgressSpinner strokeWidth="3" style="width: 30px; height: 30px" class="mr-2" />
                            <span>{{ t('historyPages.common.checkingPayment') }}</span>
                        </div>
                    </div>

                    <!-- รายการเอกสารที่ชำระเงิน -->
                    <div class="w-full mt-4 mb-2 qr-documents-card" v-if="!paymentSuccess">
                        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <h3 class="text-md font-semibold">{{ t('historyPages.common.paidDocuments') }}</h3>
                            <div class="text-sm text-gray-500 dark:text-gray-400">{{ t('historyPages.common.itemCount', { count: selectedOrdersForPayment.length }) }} • ฿{{ formatCurrency(selectedPaymentDocsTotal) }}</div>
                        </div>

                        <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                            <div
                                v-for="(order, index) in selectedOrdersForPayment"
                                :key="order.doc_no"
                                class="p-3 flex justify-between items-center gap-3 qr-documents-row"
                                :class="{
                                    'border-b border-gray-200 dark:border-gray-700': index < selectedOrdersForPayment.length - 1
                                }"
                            >
                                <div>
                                    <div class="font-medium">{{ order.doc_no }}</div>
                                    <div class="text-sm text-gray-500">
                                        {{ formatDate(order.doc_date, order.doc_time) }}
                                    </div>
                                </div>
                                <div class="text-right font-bold whitespace-nowrap">฿{{ formatCurrency(order.total_amount) }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <div class="flex justify-end gap-2">
                        <!-- เพิ่มปุ่มดาวน์โหลด QR Code ในส่วนล่างของ Dialog -->
                        <Button v-if="!paymentSuccess" :label="t('historyPages.common.cancel')" icon="pi pi-times" outlined @click="cancelQRPayment" />
                        <Button v-else :label="t('historyPages.common.close')" icon="pi pi-times" outlined @click="cancelQRPayment" />
                    </div>
                </template>
            </Dialog>
        </div>
    </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   PAGE SHELL
═══════════════════════════════════════════════ */
.oh-page {
    min-height: 100%;
    padding: 0.5rem;
    background: #f8fafc;
}

.oh-container {
    max-width: 1100px;
    margin: 0 auto;
}

/* ═══════════════════════════════════════════════
   TOP BAR
═══════════════════════════════════════════════ */
.oh-topbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 1rem 1.25rem;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
}

.oh-topbar__title {
    font-size: 1.5rem;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 0.2rem;
    line-height: 1.2;
}

.oh-topbar__sub {
    font-size: 0.92rem;
    color: #64748b;
    margin: 0;
}

.oh-topbar__actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.delivery-proof-chip {
    display: inline-flex;
    align-items: center;
    color: #047857;
    font-size: 0.78rem;
    font-weight: 800;
    white-space: nowrap;
}

/* เอกสารฝ่ายขายที่ออกจากคำสั่งซื้อ (ใบสั่งขาย / ใบกำกับ) */
.sales-doc-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--p-surface-200);
    border-radius: 10px;
}

.sales-doc-row__nums {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.sales-doc-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    background: var(--p-surface-100);
}

.sales-doc-chip--inv {
    background: #d1fae5;
}

.sales-doc-chip__label {
    font-size: 0.72rem;
    color: var(--p-text-muted-color);
}

.sales-doc-chip__value {
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.01em;
}

.delivery-proof-block {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid #d1fae5;
}

.delivery-proof-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.75rem;
}

.delivery-proof-link {
    display: block;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid #bbf7d0;
    background: #fff;
}

.delivery-proof-image {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    display: block;
}

/* ═══════════════════════════════════════════════
   METRIC STRIP
═══════════════════════════════════════════════ */
.oh-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
}

.oh-metric {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.8rem 1rem;
    border-radius: 10px;
    border: 1px solid transparent;
}

.oh-metric__icon {
    font-size: 1.3rem;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.oh-metric__val {
    font-size: 1.25rem;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.1;
}

.oh-metric__val--sm {
    font-size: 1rem;
}

.oh-metric__lbl {
    font-size: 0.82rem;
    color: #64748b;
    margin-top: 1px;
}

.oh-metric--blue {
    background: #eff6ff;
    border-color: #bfdbfe;
}
.oh-metric--blue .oh-metric__icon {
    background: #dbeafe;
    color: #1d4ed8;
}
.oh-metric--green {
    background: #f0fdf4;
    border-color: #bbf7d0;
}
.oh-metric--green .oh-metric__icon {
    background: #dcfce7;
    color: #16a34a;
}
/* ═══════════════════════════════════════════════
   MULTI-SELECT BAR
═══════════════════════════════════════════════ */
.oh-select-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    font-size: 0.98rem;
    color: #1e40af;
}

.oh-select-bar__info {
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

/* ═══════════════════════════════════════════════
   FILTER BAR
═══════════════════════════════════════════════ */
.oh-filters {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.85rem 1rem;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}

.oh-filters__grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr auto;
    gap: 0.6rem;
    align-items: end;
}

.oh-clear-btn {
    height: 38px;
    white-space: nowrap;
}

/* ═══════════════════════════════════════════════
   STATE BOXES
═══════════════════════════════════════════════ */
.oh-state-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    text-align: center;
}

/* ═══════════════════════════════════════════════
   ORDER CARDS
═══════════════════════════════════════════════ */
.oh-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.oh-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    transition:
        box-shadow 0.18s,
        transform 0.18s;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
}

.oh-card:hover {
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.09);
    transform: translateY(-1px);
}

.oh-card--selected {
    border-color: #60a5fa;
    box-shadow: 0 0 0 2px #bfdbfe;
}

/* Color strip on left edge */
.oh-card__strip {
    width: 4px;
    flex-shrink: 0;
    border-radius: 0;
}
.oh-card__strip--success {
    background: #22c55e;
}
.oh-card__strip--payment {
    background: #3b82f6;
}
.oh-card__strip--packing {
    background: #8b5cf6;
}
.oh-card__strip--pending {
    background: #f59e0b;
}
.oh-card__strip--cancel {
    background: #ef4444;
}
.oh-card__strip--partial {
    background: #06b6d4;
}

.oh-card__body {
    flex: 1;
    padding: 0.85rem 1rem;
    min-width: 0;
}

/* Row 1 */
.oh-card__row1 {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.6rem;
}

.oh-docno {
    font-size: 1rem;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: 0.01em;
}

.oh-card__date {
    font-size: 0.85rem;
    color: #94a3b8;
    margin-top: 2px;
}

.oh-card__amount-block {
    flex-shrink: 0;
    text-align: right;
}

.oh-card__amount {
    font-size: 1.15rem;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.1;
}

.oh-card__balance {
    font-size: 0.82rem;
    color: #ef4444;
    margin-top: 1px;
}

.oh-card__sendtype {
    font-size: 0.82rem;
    color: #94a3b8;
    margin-top: 2px;
}

/* Row 2 */
.oh-card__row2 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #f1f5f9;
}

.oh-card__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    flex: 1;
    min-width: 0;
}

.oh-meta-chip {
    display: inline-flex;
    align-items: center;
    font-size: 0.82rem;
    color: #64748b;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 999px;
    padding: 2px 8px;
    white-space: nowrap;
}

.oh-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    flex-shrink: 0;
}

/* ═══════════════════════════════════════════════
   ORDER DETAIL DIALOG
═══════════════════════════════════════════════ */
.detail-hero {
    display: flex;
    justify-content: space-between;
    gap: 0.85rem;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 0.85rem 1rem;
    background: linear-gradient(140deg, #eff6ff 0%, #fff 100%);
}

.detail-hero__caption {
    font-size: 0.8rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.detail-hero__doc {
    font-size: 1.15rem;
    font-weight: 800;
    color: #0f172a;
}

.detail-hero__date {
    font-size: 0.88rem;
    color: #64748b;
}
.detail-hero__right {
    text-align: right;
}

.detail-hero__amount {
    font-size: 1.35rem;
    font-weight: 800;
    color: #1d4ed8;
}

.detail-section {
    background: #fafafa;
    border-radius: 10px;
}

/* ═══════════════════════════════════════════════
   QR dialog
═══════════════════════════════════════════════ */
.qr-documents-card {
    border-top: 1px solid #e2e8f0;
    padding-top: 0.75rem;
}

.qr-documents-row {
    transition: background 0.15s;
}
.qr-documents-row:hover {
    background: #f8fafc;
}

/* ═══════════════════════════════════════════════
   RESPONSIVE
═══════════════════════════════════════════════ */
@media (max-width: 900px) {
    .oh-filters__grid {
        grid-template-columns: 1fr 1fr;
    }
    .oh-clear-btn {
        grid-column: span 2;
        justify-self: end;
    }
}

@media (max-width: 640px) {
    .oh-page {
        padding: 0.25rem;
    }
    .oh-metrics {
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
    }
    .oh-metric {
        padding: 0.6rem 0.5rem;
        gap: 0.5rem;
    }
    .oh-metric__icon {
        width: 1.8rem;
        height: 1.8rem;
        font-size: 1rem;
    }
    .oh-metric__val {
        font-size: 0.95rem;
    }
    .oh-filters__grid {
        grid-template-columns: 1fr;
    }
    .oh-clear-btn {
        grid-column: span 1;
        justify-self: stretch;
    }
    .oh-card__row2 {
        flex-direction: column;
        align-items: flex-start;
    }
    .oh-card__actions {
        width: 100%;
        justify-content: flex-end;
    }
    .detail-hero {
        flex-direction: column;
    }
    .detail-hero__right {
        text-align: left;
    }
}

/* ═══════════════════════════════════════════════
   DARK MODE (keep existing page-header__badge reference)
═══════════════════════════════════════════════ */
:deep(.dark) .oh-page {
    background: #0f172a;
}

:deep(.dark) .oh-topbar,
:deep(.dark) .oh-filters,
:deep(.dark) .oh-state-box,
:deep(.dark) .oh-card {
    background: #1e293b;
    border-color: rgba(148, 163, 184, 0.2);
}

:deep(.dark) .oh-topbar__title {
    color: #f1f5f9;
}
:deep(.dark) .oh-docno {
    color: #e2e8f0;
}
:deep(.dark) .oh-card__amount {
    color: #f1f5f9;
}
:deep(.dark) .oh-card__row2 {
    border-color: #334155;
}
:deep(.dark) .oh-meta-chip {
    background: #0f172a;
    border-color: #334155;
    color: #94a3b8;
}
:deep(.dark) .oh-metric--blue {
    background: #1e3a5f;
    border-color: #1e40af;
}
:deep(.dark) .oh-metric--green {
    background: #14532d;
    border-color: #166534;
}
:deep(.dark) .oh-metric__val {
    color: #f1f5f9;
}
:deep(.dark) .oh-select-bar {
    background: #1e3a5f;
    border-color: #1e40af;
    color: #93c5fd;
}

:deep(.dark) .detail-hero {
    background: linear-gradient(140deg, #1e293b 0%, #0f172a 100%);
    border-color: rgba(96, 165, 250, 0.3);
}
:deep(.dark) .detail-hero__doc {
    color: #e2e8f0;
}
:deep(.dark) .detail-hero__amount {
    color: #93c5fd;
}
:deep(.dark) .detail-section {
    background: #1e293b;
}

:deep(.dark) .page-header__badge {
    color: #99f6e4;
    background: rgba(13, 148, 136, 0.2);
}

/* ═══════════════════════════════════════════════
   SOH — Shopee-style order list
═══════════════════════════════════════════════ */

/* ── Tab bar ── */
.soh-tabs {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid #e5e7eb;
    background: #fff;
    -webkit-overflow-scrolling: touch;
}
.soh-tabs::-webkit-scrollbar {
    display: none;
}

.soh-tab {
    flex-shrink: 0;
    padding: 10px 18px;
    font-size: 1rem;
    font-weight: 500;
    color: #6b7280;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    transition:
        color 0.15s,
        border-color 0.15s;
}
.soh-tab:hover {
    color: #ee4d2d;
}
.soh-tab:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}
.soh-tab:disabled:hover {
    color: #6b7280;
}
.soh-tab--active {
    color: #ee4d2d;
    border-bottom-color: #ee4d2d;
    font-weight: 600;
}

/* ── Search bar ── */
.soh-search {
    margin-top: 10px;
}
:deep(.soh-search__input) {
    border-radius: 4px;
    font-size: 0.85rem;
}
:deep(.soh-search__input:focus) {
    border-color: #ee4d2d;
    box-shadow: 0 0 0 2px rgba(238, 77, 45, 0.12);
}

/* ── List ── */
.soh-more {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.25rem 0 0.5rem;
}

.soh-more__count {
    font-size: 0.82rem;
    color: #6b7280;
}

.soh-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

/* ── Card shell ── */
.soh-card {
    background: #fff;
    border-radius: 4px;
    border: 1px solid #e5e7eb;
    overflow: hidden;
    transition: box-shadow 0.18s;
}
.soh-card:hover {
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.09);
}
.soh-card--selected {
    border-color: #ee4d2d;
    box-shadow: 0 0 0 1px #ee4d2d;
}

/* ── Card head ── */
.soh-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #f3f4f6;
    background: #fafafa;
    gap: 8px;
}
.soh-card__head-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
}
.soh-card__shop-icon {
    font-size: 1rem;
    color: #6b7280;
}
.soh-card__shop-name {
    font-size: 1.05rem;
    font-weight: 600;
    color: #111827;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.soh-card__emp {
    font-size: 0.9rem;
    color: #9ca3af;
    white-space: nowrap;
}
.soh-preorder-chip {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    border-radius: 999px;
    border: 1px solid #f59e0b;
    background: #fffbeb;
    color: #92400e;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1;
    padding: 4px 8px;
    white-space: nowrap;
}
.soh-card__head-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}

/* ── Status label ── */
.soh-status-label {
    font-size: 0.88rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}
.soh-status-icon {
    font-size: 0.88rem;
}

.soh-status-label--pending,
.soh-status-icon--pending {
    color: #f59e0b;
}
.soh-status-label--payment,
.soh-status-icon--payment {
    color: #3b82f6;
}
.soh-status-label--packing,
.soh-status-icon--packing {
    color: #8b5cf6;
}
.soh-status-label--partial,
.soh-status-icon--partial {
    color: #06b6d4;
}
.soh-status-label--success,
.soh-status-icon--success {
    color: #10b981;
}
.soh-status-label--cancel,
.soh-status-icon--cancel {
    color: #ef4444;
}
.soh-status-label--approve,
.soh-status-icon--approve {
    color: #06b6d4;
}

/* ── Tracking / remark rows ── */
.soh-card__track,
.soh-card__remark {
    display: flex;
    align-items: flex-start;
    padding: 6px 14px;
    font-size: 0.88rem;
    color: #6b7280;
    border-bottom: 1px solid #f3f4f6;
}
.soh-card__remark--cancel {
    color: #ef4444;
}
.soh-track-link {
    color: #3b82f6;
    text-decoration: underline;
    word-break: break-all;
}
.order-preorder-banner {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin: 0 0 16px;
    padding: 12px 14px;
    border: 1px solid #f59e0b;
    border-radius: 8px;
    background: #fffbeb;
    color: #92400e;
}
.order-preorder-banner > i {
    margin-top: 2px;
    font-size: 1rem;
}
.order-preorder-banner div {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.order-preorder-banner strong {
    font-size: 0.95rem;
    font-weight: 800;
}
.order-preorder-banner span {
    font-size: 0.88rem;
    color: #a16207;
}

/* ── Product / summary row ── */
.soh-card__product {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 10px 14px;
    gap: 12px;
    flex-wrap: wrap;
}
.soh-card__product-info {
    flex: 1;
    min-width: 0;
}
.soh-card__product-meta {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 4px;
}
.soh-card__date {
    font-size: 0.88rem;
    color: #9ca3af;
}
.soh-card__delivery {
    font-size: 0.88rem;
    color: #6b7280;
}
.soh-card__tax-row {
    display: flex;
    gap: 12px;
    font-size: 0.85rem;
    color: #9ca3af;
    flex-wrap: wrap;
}
.soh-card__total-block {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    flex-shrink: 0;
}
.soh-card__total-label {
    font-size: 0.82rem;
    color: #9ca3af;
}
.soh-card__mixed {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.74rem;
    font-weight: 600;
    color: #1d4ed8;
}

.soh-card__net--invoiced {
    color: #047857;
}

.soh-card__net {
    font-size: 0.78rem;
    font-weight: 700;
    color: #166534;
}

.soh-card__total-amount {
    font-size: 1.15rem;
    font-weight: 700;
    color: #ee4d2d;
}

/* ── Footer ── */
.soh-card__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-top: 1px solid #f3f4f6;
    gap: 8px;
    flex-wrap: wrap;
}
.soh-card__foot-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
}
.soh-card__balance-warn {
    font-size: 0.85rem;
    color: #ef4444;
    font-weight: 500;
}
.soh-card__foot-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

/* ── Action buttons ── */
.soh-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 14px;
    border-radius: 3px;
    font-size: 0.88rem;
    font-weight: 500;
    cursor: pointer;
    border: 1.5px solid transparent;
    transition:
        background 0.15s,
        opacity 0.15s;
    white-space: nowrap;
}
.soh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.soh-btn--primary {
    background: #ee4d2d;
    border-color: #ee4d2d;
    color: #fff;
}
.soh-btn--primary:hover:not(:disabled) {
    background: #d44327;
    border-color: #d44327;
}

.soh-btn--outline {
    background: #fff;
    border-color: #ee4d2d;
    color: #ee4d2d;
}
.soh-btn--outline:hover:not(:disabled) {
    background: #fff5f3;
}

.soh-btn--warning {
    background: #f59e0b;
    border-color: #f59e0b;
    color: #fff;
}
.soh-btn--warning:hover:not(:disabled) {
    background: #d97706;
    border-color: #d97706;
}

.soh-btn--ghost {
    background: #fff;
    border-color: #e5e7eb;
    color: #374151;
}
.soh-btn--ghost:hover:not(:disabled) {
    background: #f9fafb;
}

.soh-btn--danger {
    border-color: #ef4444;
    color: #ef4444;
}
.soh-btn--ghost.soh-btn--danger:hover:not(:disabled) {
    background: #fef2f2;
}

/* ── Mobile ── */
@media (max-width: 640px) {
    .soh-tab {
        padding: 8px 12px;
        font-size: 0.88rem;
    }
    .soh-card__product {
        flex-direction: column;
        align-items: flex-start;
    }
    .soh-card__total-block {
        align-items: flex-start;
    }
    .soh-card__foot {
        flex-direction: column;
        align-items: flex-start;
    }
    .soh-card__foot-actions {
        width: 100%;
        justify-content: flex-end;
    }
}
</style>
