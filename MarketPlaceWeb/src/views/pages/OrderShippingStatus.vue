<script setup>
import OrderHistoryService from '@/services/OrderHistoryService';
import { useLanguageStore } from '@/stores/languageStore';
import { pickProductName, withProductDisplay } from '@/utils/languageDisplay';
import { PREORDER_REMARK } from '@/utils/preorderSplit';
import axios from 'axios';
import { useToast } from 'primevue/usetoast';
import QRCode from 'qrcode';
import { isQrPaymentConfigured } from '@/utils/qrPayment';

import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const toast = useToast();
const languageStore = useLanguageStore();
const t = languageStore.t;
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
const detailsTotalPages = ref(0);
const detailsSearchTerm = ref('');
const loadingMoreDetails = ref(false);

// State สำหรับ expand/collapse {{ t('historyPages.common.productItems') }}ย่อยของ{{ t('historyPages.common.product') }}ชุด
const expandedSetItems = ref(new Set());

// รหัสลูกค้า
const userCode = localStorage.getItem('_userCode');

function getItemDisplayName(item) {
    return pickProductName(item, languageStore.locale) || item?.display_name || item?.item_name || item?.name || '';
}

function normalizeDisplayItem(item = {}) {
    return withProductDisplay({
        ...item,
        sub_item: Array.isArray(item.sub_item) ? item.sub_item.map((subItem) => withProductDisplay(subItem)) : item.sub_item
    });
}

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
const txnData = ref(null);

// Payment timeout management
const paymentTimeoutDuration = ref(300000); // 5 นาที (300,000 ms)
const paymentStartTime = ref(null);
const paymentTimeRemaining = ref(0);
const paymentTimeoutId = ref(null);
const timeUpdateInterval = ref(null);

// Multi-select variables
const multiSelectMode = ref(false);
const selectedOrders = ref([]);
const localeCode = computed(() => (languageStore.locale === 'en' ? 'en-US' : languageStore.locale === 'lo' ? 'lo-LA' : 'th-TH'));
const isShippingActionBusy = computed(() => loading.value || loadingDetails.value || loadingMoreDetails.value || showQrPaymentDialog.value || qrPaymentLoading.value || paymentProcessing.value);

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

// สถานะของออเดอร์และสีที่ใช้แสดง
const orderStatuses = computed(() => ({
    success: { label: t('historyPages.status.success'), color: 'success', icon: 'pi pi-check-circle' },
    payment: { label: t('historyPages.status.payment'), color: 'primary', icon: 'pi pi-send' },
    packing: { label: t('historyPages.status.packing'), color: 'primary', icon: 'pi pi-sync' },
    cancel: { label: t('historyPages.status.cancel'), color: 'danger', icon: 'pi pi-times-circle' },
    pending: { label: t('historyPages.status.pending'), color: 'warning', icon: 'pi pi-clock' }
}));

// เพิ่มตัวแปรเพื่อเก็บขนาดหน้าจอปัจจุบัน
const getOrderStatus = (status) => orderStatuses.value[status] ?? { label: status || '-', color: 'secondary', icon: 'pi pi-circle' };

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
    // ตั้งค่าเริ่มต้นเป็น payment
    status: 'payment',
    dateRange: null,
    searchTerm: ''
});

// 🚨 หน้านี้ดึงคำสั่งซื้อมาแล้วกรองเอาเฉพาะที่เกี่ยวกับการจัดส่งเองฝั่ง client
//    แต่เดิมเรียก API โดยไม่ส่ง page จึงได้แค่ 40 ใบล่าสุด
//    ใบที่กำลังจัดส่งซึ่งเก่ากว่านั้นจะไม่โผล่เลย และไม่มีอะไรบอกลูกค้าว่าหายไป
//    วัดกับข้อมูลจริง: AR00207 มีใบเกี่ยวกับการจัดส่ง 7 ใบ แต่หน้านี้แสดงแค่ 1
//    (AR00139 และ AR00005 ซ่อนอย่างละ 1 ใบ)
const ORDERS_PAGE_SIZE = 40;
const ordersPage = ref(1);
const totalOrders = ref(0);
const loadingMore = ref(false);

// เทียบจากยอดรวมที่ server บอก ไม่ใช่จำนวนแถวรอบล่าสุด
// เพราะรอบหนึ่งอาจคืนน้อยกว่า page size ทั้งที่ยังมีหน้าถัดไป
const hasMoreOrders = computed(() => ordersPage.value * ORDERS_PAGE_SIZE < totalOrders.value);

// ดึงข้อมูลประวัติการสั่งซื้อจาก API
async function fetchOrderHistory({ append = false } = {}) {
    try {
        // ตัวเรียกเดิมไม่ส่งอาร์กิวเมนต์ = โหลดใหม่ตั้งแต่หน้าแรกเหมือนเดิม
        if (append) loadingMore.value = true;
        loading.value = true;
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

        // ส่งค่า status เป็น 'payment' เสมอ
        const nextPage = append ? ordersPage.value + 1 : 1;
        // ต้องขอทั้ง payment และ partial — หน้านี้มีปุ่มชำระที่รองรับทั้งสองสถานะอยู่แล้ว
        // ถ้าขอแค่ payment ใบที่ชำระไปบางส่วนจะหายทั้งหน้า ลูกค้าจ่ายส่วนที่เหลือไม่ได้
        const response = await OrderHistoryService.getOrderHistory(custCode, 'payment,partial', nextPage, ORDERS_PAGE_SIZE);

        if (response?.data?.success) {
            const batch = response.data.data || [];
            orders.value = append ? [...orders.value, ...batch] : batch;
            ordersPage.value = nextPage;
            // ไม่มี total_orders (endpoint เก่า) ให้ถือว่าได้มาเท่าไรคือทั้งหมด
            totalOrders.value = Number(response.data.total_orders ?? orders.value.length);
        } else if (!append) {
            error.value = t('historyPages.shipping.noShipping');
        }
    } catch (err) {
        console.error('Error fetching shipping status:', err);
        // โหลดหน้าถัดไปพลาด ไม่ควรลบรายการที่ดูอยู่ทิ้งแล้วขึ้น error เต็มหน้า
        if (!append) error.value = t('historyPages.shipping.noShipping');
    } finally {
        loading.value = false;
        loadingMore.value = false;
    }
}

function loadMoreOrders() {
    if (loading.value || loadingMore.value || !hasMoreOrders.value) return;
    fetchOrderHistory({ append: true });
}

// ดึง Header ของคำสั่งซื้อ
async function fetchOrderHeader(docNo) {
    try {
        const response = await OrderHistoryService.getOrderHeader(userCode, docNo);

        if (response?.data?.success) {
            const headerData = response.data.data;
            // เก็บข้อมูลทั้งหมดของออเดอร์ลงใน selectedOrder
            selectedOrder.value = {
                ...selectedOrder.value,
                ...headerData
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
            detailsTotalPages.value = paging.total_pages || 0;

            if (append && selectedOrderDetails.value) {
                // เพิ่มรายการต่อท้าย
                selectedOrderDetails.value = [...selectedOrderDetails.value, ...items];
            } else {
                // แทนที่รายการทั้งหมด
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
    if (loadingDetails.value || !selectedOrder.value?.doc_no) return;

    detailsCurrentPage.value = 1;
    loadingDetails.value = true;
    await fetchOrderItems(selectedOrder.value.doc_no, 1, detailsSearchTerm.value, false);
    loadingDetails.value = false;
}

// ล้างการค้นหา
async function clearDetailsSearch() {
    if (loadingDetails.value || !selectedOrder.value?.doc_no) return;

    detailsSearchTerm.value = '';
    detailsCurrentPage.value = 1;
    loadingDetails.value = true;
    await fetchOrderItems(selectedOrder.value.doc_no, 1, '', false);
    loadingDetails.value = false;
}

// Toggle expand/collapse สำหรับ{{ t('historyPages.common.product') }}ชุด
function toggleSetItemExpand(itemCode) {
    if (expandedSetItems.value.has(itemCode)) {
        expandedSetItems.value.delete(itemCode);
    } else {
        expandedSetItems.value.add(itemCode);
    }
}

// ตรวจสอบว่า{{ t('historyPages.common.product') }}ชุดถูก expand อยู่หรือไม่
function isSetItemExpanded(itemCode) {
    return expandedSetItems.value.has(itemCode);
}

// แสดงรายละเอียดออเดอร์
async function showOrderDetails(order) {
    if (loadingDetails.value || !order?.doc_no) return;

    // Reset pagination state
    detailsCurrentPage.value = 1;
    detailsTotalItems.value = 0;
    detailsTotalPages.value = 0;
    detailsSearchTerm.value = '';
    expandedSetItems.value = new Set();

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

// ฟังก์ชันเมื่อมีการเปลี่ยนแปลงสถานะกรอง - ในหน้านี้จะไม่ใช้เนื่องจากเราแสดงเฉพาะ status = payment เท่านั้น

// ออเดอร์ที่ผ่านการกรอง
const filteredOrders = computed(() => {
    if (!orders.value) return [];

    return orders.value.filter((order) => {
        // กรองตามคำค้นหา
        if (filters.searchTerm) {
            const searchLower = String(filters.searchTerm || '').toLowerCase();
            const docNoMatch = String(order?.doc_no || '').toLowerCase().includes(searchLower);
            return docNoMatch;
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

// รีเซ็ตการกรอง (ในหน้านี้เราจะรีเซ็ตเฉพาะ searchTerm และ dateRange)
function resetFilters() {
    filters.dateRange = null;
    filters.searchTerm = '';
    fetchOrderHistory();
}

// ฟังก์ชันสร้างรูปภาพ QR Code
async function generateQRImage(qrCodeData) {
    try {
        //console.log('Generating QR code for data:', qrCodeData);

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

        //console.log('QR code generated successfully');
        return url;
    } catch (error) {
        console.error('Error generating QR code:', error);
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
    qrPaymentLoading.value = true;
    paymentSuccess.value = false;

    try {
        // คำนวณยอดเงิน{{ t('historyPages.common.itemTotal') }}ของเอกสารที่เลือก
        paymentAmount.value = selectedOrdersForPayment.value.reduce((sum, order) => {
            return sum + toMoneyNumber(order.total_amount);
        }, 0);

        // สร้าง random references
        const ref1 = Math.random().toString(36).substring(2, 10);
        const ref2 = Math.random().toString(36).substring(2, 10);
        const ref3 = Math.random().toString(36).substring(2, 10);
        const ref4 = Math.random().toString(36).substring(2, 10);

        const response = await axios.post(
            import.meta.env.VITE_QR_API_URL,
            {
                amount: paymentAmount.value,
                ref1: ref1,
                ref2: ref2,
                ref3: ref3,
                ref4: ref4
            },
            {
                headers: {
                    'x-api-key': import.meta.env.VITE_QR_API_KEY
                }
            }
        );

        if (response.data && response.data.qrCode) {
            txnUid.value = response.data.txnUid;

            // Log the QR code data for debugging
            //console.log('QR Code data received:', response.data.qrCode);

            // Generate QR code
            const qrImage = await generateQRImage(response.data.qrCode);
            if (!qrImage) {
                throw new Error('Failed to generate QR code image');
            }

            qrCodeUrl.value = qrImage;

            // เริ่มตรวจสอบสถานะการชำระเงิน
            startCheckPaymentStatus();
        } else {
            throw new Error(t('historyPages.toast.noQrFromServer'));
        }
    } catch (error) {
        console.error('Error generating QR code:', error);
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: t('historyPages.toast.createQrFailed'),
            life: 3000
        });
    } finally {
        qrPaymentLoading.value = false;
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

            //console.log('Current payment status:', status);

            if (status === 'PAID') {
                //console.log('Payment completed, stopping status check');

                // ล้างทุก timer
                clearInterval(paymentInterval.value);
                clearTimeout(paymentTimeoutId.value);
                clearInterval(timeUpdateInterval.value);

                paymentInterval.value = null;
                paymentTimeoutId.value = null;
                timeUpdateInterval.value = null;

                // การชำระเงินสำเร็จ
                paymentSuccess.value = true;
                paymentProcessing.value = false;

                // บันทึกการชำระเงิน
                await savePaymentTransaction();

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
            //console.log('Payment check response:', response.data);
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
        // สร้าง doc_no
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const random = Math.floor(Math.random() * 90000) + 10000;

        const docNo = `WRC${year}${month}${day}${hours}${minutes}-${random}`;
        const docDate = `${year}-${month}-${day}`;

        // สร้าง payment data
        const paymentData = {
            doc_no: docNo,
            cust_code: selectedOrdersForPayment.value[0].cust_code,
            doc_date: docDate,
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

        // ส่งข้อมูลไปยัง API
        const response = await OrderHistoryService.payOrder(paymentData);

        if (!response.data || !response.data.success) {
            throw new Error(t('historyPages.toast.savePaymentFailed'));
        }
    } catch (error) {
        console.error('Error saving payment transaction:', error);
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.error'),
            detail: t('historyPages.toast.savePaymentFailed'),
            life: 3000
        });
    }
}

// ฟังก์ชันแสดง dialog ชำระเงิน QR Code
function showQRPayment(orders) {
    if (isShippingActionBusy.value || showQrPaymentDialog.value) return;

    if (!Array.isArray(orders)) {
        orders = [orders];
    }

    // ต้องการเฉพาะเอกสารที่สถานะ payment หรือ partial
    const validOrders = orders.filter((order) => order.status === 'payment');

    if (validOrders.length === 0) {
        toast.add({
            severity: 'error',
            summary: t('historyPages.toast.cannotPay'),
            detail: t('historyPages.toast.noPayableDocs'),
            life: 3000
        });
        return;
    }

    selectedOrdersForPayment.value = validOrders;
    showQrPaymentDialog.value = true;
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
    paymentStartTime.value = null;
    paymentTimeRemaining.value = 0;
    showQrPaymentDialog.value = false;
    selectedOrdersForPayment.value = [];
}

// ฟังก์ชันเปิด/ปิดโหมดเลือกหลายรายการ
function toggleMultiSelectMode() {
    if (isShippingActionBusy.value) return;

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
    if (isShippingActionBusy.value || !order?.doc_no) return;

    if (isOrderSelected(order)) {
        selectedOrders.value = selectedOrders.value.filter((o) => o.doc_no !== order.doc_no);
    } else {
        selectedOrders.value.push(order);
    }
}

// เลือกทั้งหมดที่ชำระได้
function selectAllPayableOrders() {
    if (isShippingActionBusy.value || !filteredOrders.value) return;

    // เลือกเฉพาะใบสถานะ 'payment' — server ยุบใบที่ชำระบางส่วนมาเป็นสถานะนี้แล้ว
    const payableOrders = filteredOrders.value.filter((order) => order.status === 'payment');

    // ถ้าได้เลือกทั้งหมดแล้ว ให้ยกเลิกการเลือกทั้งหมด
    if (selectedOrders.value.length === payableOrders.length) {
        selectedOrders.value = [];
    } else {
        selectedOrders.value = [...payableOrders];
    }
}

// ฟังก์ชันชำระเงินสำหรับออเดอร์ที่เลือก
function paySelectedOrders() {
    if (isShippingActionBusy.value) return;

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

// คำนวณ{{ t('historyPages.common.quantity') }}ออเดอร์ที่สามารถเลือกได้ (สถานะ payment และ partial)
const payableOrdersCount = computed(() => {
    if (!filteredOrders.value) return 0;
    return filteredOrders.value.filter((order) => order.status === 'payment').length;
});

// คำนวณยอด{{ t('historyPages.common.itemTotal') }}ของออเดอร์ที่เลือก
const selectedOrdersTotal = computed(() => {
    return selectedOrders.value.reduce((sum, order) => {
        return sum + toMoneyNumber(order.total_amount);
    }, 0);
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
    <div class="order-history-page">
        <div class="order-history-container">
            <!-- Header -->
            <div class="page-header mb-4">
                <div class="flex justify-between items-center">
                    <div>
                        <h1 class="text-2xl font-bold">{{ t('historyPages.shipping.title') }}</h1>
                        <p class="text-gray-500 dark:text-gray-400 mt-1">{{ t('historyPages.shipping.subtitle') }}</p>
                    </div>

                    <!-- ย้ายปุ่มเลือกหลายรายการมาไว้ด้านขวาของส่วนหัว -->
                    <div v-if="qrPaymentEnabled && payableOrdersCount > 1 && !loading && filteredOrders.length > 0">
                        <Button
                            :label="multiSelectMode ? t('historyPages.common.stopSelecting') : t('historyPages.common.selectMultiple')"
                            :icon="multiSelectMode ? 'pi pi-times' : 'pi pi-check-square'"
                            :severity="multiSelectMode ? 'secondary' : 'info'"
                            class="p-button-sm"
                            :disabled="isShippingActionBusy"
                            @click="toggleMultiSelectMode"
                        />
                    </div>
                </div>
            </div>

            <!-- แถบแสดงสถานะการเลือกหลายรายการ -->
            <div v-if="multiSelectMode" class="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 shadow-sm">
                <div class="flex flex-col md:flex-row justify-between items-center gap-3">
                    <div class="flex flex-col md:flex-row items-center gap-3">
                        <div class="flex items-center">
                            <i class="pi pi-check-square text-blue-500 mr-2"></i>
                            <span class="font-medium">{{ t('historyPages.common.selectedFrom', { selected: selectedOrders.length, total: payableOrdersCount }) }}</span>
                        </div>

                        <div v-if="selectedOrders.length > 0" class="flex items-center">
                            <i class="pi pi-wallet text-green-500 mr-2"></i>
                            <span class="font-medium">{{ t('historyPages.common.totalPrefix') }} ฿{{ formatCurrency(selectedOrdersTotal) }}</span>
                        </div>
                    </div>

                    <div class="flex gap-2">
                        <Button
                            :label="selectedOrders.length === payableOrdersCount ? t('historyPages.common.deselectAllLong') : t('historyPages.common.selectAll')"
                            :icon="selectedOrders.length === payableOrdersCount ? 'pi pi-times-circle' : 'pi pi-check-circle'"
                            outlined
                            class="p-button-sm"
                            :disabled="isShippingActionBusy"
                            @click="selectAllPayableOrders"
                        />
                        <Button :label="t('historyPages.common.paySelected')" icon="pi pi-wallet" severity="warning" class="p-button-sm" @click="paySelectedOrders" :disabled="selectedOrders.length === 0 || isShippingActionBusy" />
                    </div>
                </div>
            </div>

            <!-- Filters -->
            <div class="filters-container mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-sm font-medium mb-1">{{ t('historyPages.common.search') }}</label>
                        <IconField iconPosition="left" class="w-full">
                            <InputText v-model="filters.searchTerm" :placeholder="t('historyPages.shipping.searchPlaceholder')" :aria-label="t('historyPages.shipping.searchPlaceholder')" class="w-full" />
                            <InputIcon class="pi pi-search" />
                        </IconField>
                    </div>

                    <div>
                        <label class="block text-sm font-medium mb-1">{{ t('historyPages.common.dateRange') }}</label>
                        <DatePicker v-model="filters.dateRange" selectionMode="range" dateFormat="dd/mm/yy" :placeholder="t('historyPages.common.dateRange')" showIcon class="w-full" />
                    </div>
                </div>

                <div class="flex justify-end mt-3">
                    <Button :label="t('historyPages.common.clearFilters')" icon="pi pi-filter-slash" class="p-button-outlined p-button-sm" :disabled="loading" @click="resetFilters" />
                </div>
            </div>

            <!-- Loading state -->
            <div v-if="loading" class="flex justify-center items-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <ProgressSpinner strokeWidth="4" style="width: 50px; height: 50px" />
            </div>

            <!-- Error state -->
            <div v-else-if="error" class="flex flex-col items-center justify-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <i class="pi pi-exclamation-triangle text-5xl text-yellow-500 mb-4"></i>
                <h3 class="text-xl font-medium mb-2">{{ t('historyPages.common.errorTitle') }}</h3>
                <p class="text-gray-500 dark:text-gray-400 mb-4 text-center">{{ error }}</p>
                <Button :label="t('historyPages.common.retry')" icon="pi pi-refresh" :disabled="loading" @click="fetchOrderHistory" />
            </div>

            <!-- Empty state -->
            <div v-else-if="filteredOrders.length === 0" class="flex flex-col items-center justify-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <i class="pi pi-truck text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
                <h3 class="text-xl font-medium mb-2">{{ t('historyPages.shipping.noShipping') }}</h3>
                <p v-if="filters.dateRange || filters.searchTerm" class="text-gray-500 dark:text-gray-400 mb-4 text-center">{{ t('historyPages.shipping.noShippingMatching') }}<br />{{ t('historyPages.common.adjustFilters') }}</p>
                <p v-else class="text-gray-500 dark:text-gray-400 mb-4 text-center">{{ t('historyPages.shipping.noShippingOrders') }}<br />{{ t('historyPages.common.shopNow') }}</p>
                <Button :label="t('historyPages.common.shopNow')" icon="pi pi-shopping-cart" @click="router.push('/')" />
            </div>

            <!-- Order list -->
            <div v-else class="orders-list">
                <div
                    v-for="order in filteredOrders"
                    :key="order.doc_no"
                    class="order-card bg-white dark:bg-gray-800 rounded-lg shadow-sm mb-4 overflow-hidden"
                    :class="{ 'border-2 border-blue-400 dark:border-blue-600': multiSelectMode && isOrderSelected(order) }"
                >
                    <!-- Order header -->
                    <div class="flex justify-between items-center p-4 border-b border-gray-100 dark:border-gray-700">
                        <div class="flex items-center">
                            <!-- Checkbox for multi-select mode -->
                            <div v-if="multiSelectMode && (order.status === 'payment')" class="mr-2">
                                <Checkbox :modelValue="isOrderSelected(order)" :aria-label="`${t('historyPages.common.select')} ${order.doc_no}`" :disabled="isShippingActionBusy" @update:modelValue="toggleOrderSelection(order)" :binary="true" />
                            </div>

                            <div>
                                <div class="flex items-center">
                                    <span class="text-lg font-semibold">{{ order.doc_no }}</span>
                                    <Tag :value="getOrderStatus(order.status).label" :severity="getOrderStatus(order.status).color" class="ml-3" />
                                    <Tag v-if="isPreorderOrder(order)" :value="getPreorderOrderLabel()" severity="warning" class="ml-2" icon="pi pi-clock" />
                                </div>
                                <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    {{ formatDate(order.doc_date, order.doc_time) }}
                                </div>
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="text-lg font-bold">฿{{ formatCurrency(order.total_amount) }}</div>
                            <div class="text-sm text-gray-500 dark:text-gray-400">
                                <span>{{ String(order.send_type) === '1' ? t('historyPages.common.shipping') : t('historyPages.common.pickup') }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- {{ t('historyPages.shipping.shippingStatus') }} -->
                    <div v-if="hasTrackingUrl(order)" class="mr-4 ml-4 mt-4">
                        <!-- ส่วนหัวข้อ -->
                        <div class="flex items-center mb-2">
                            <h3 class="font-medium flex items-center">
                                <i class="pi pi-truck mr-2 text-primary-500"></i>
                                {{ t('historyPages.shipping.shippingStatus') }}
                            </h3>
                        </div>

                        <!-- ส่วนลิงก์ติดตามพัสดุ -->
                        <div class="mt-2 mb-2">
                            <div class="text-sm">
                                <a :href="getTrackingUrl(order)" target="_blank" class="flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                                    <span class="truncate mr-1">{{ getTrackingUrl(order) }}</span>
                                    <i class="pi pi-external-link"></i>
                                </a>
                            </div>
                        </div>
                    </div>

                    <!-- Order actions -->
                    <div class="p-4">
                        <div class="flex justify-end gap-2">
                            <!-- ปุ่มชำระเงิน QR Code - แสดงเฉพาะเมื่อไม่ได้อยู่ในโหมดเลือกหลายรายการ -->
                            <Button v-if="qrPaymentEnabled && (order.status === 'payment') && !multiSelectMode" :label="t('historyPages.common.pay')" icon="pi pi-qrcode" class="p-button-warning p-button-sm" @click="showQRPayment(order)" :disabled="isShippingActionBusy" />

                            <!-- ปุ่มเลือกหรือยกเลิกการเลือกสำหรับโหมดเลือกหลายรายการ -->
                            <Button
                                v-if="multiSelectMode && (order.status === 'payment')"
                                :label="isOrderSelected(order) ? t('historyPages.common.cancel') : t('historyPages.common.select')"
                                :icon="isOrderSelected(order) ? 'pi pi-times' : 'pi pi-check'"
                                :severity="isOrderSelected(order) ? 'secondary' : 'info'"
                                class="p-button-sm p-button-outlined"
                                :aria-pressed="isOrderSelected(order)"
                                :disabled="isShippingActionBusy"
                                @click="toggleOrderSelection(order)"
                            />

                            <Button :label="t('historyPages.common.details')" icon="pi pi-eye" class="p-button-outlined p-button-info p-button-sm" :disabled="loadingDetails" @click="showOrderDetails(order)" />
                        </div>
                    </div>
                </div>

                <!-- ใบที่กำลังจัดส่งอาจอยู่นอก 40 ใบล่าสุด ต้องมีทางโหลดต่อ
                     ไม่โชว์ตัวเลข "X จาก Y" เพราะ Y เป็นยอดรวมทุกสถานะ ส่วนที่แสดงถูกกรองแล้ว -->
                <div v-if="hasMoreOrders" class="flex justify-center py-4">
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
            <Dialog v-model:visible="displayOrderDetails" :header="t('historyPages.shipping.detailHeader', { docNo: selectedOrder?.doc_no || '' })" :style="{ width: '95%', maxWidth: '1200px' }" :modal="true" :closeOnEscape="true" :dismissableMask="true">
                <!-- Loading state for details -->
                <div v-if="loadingDetails" class="flex justify-center items-center p-8">
                    <ProgressSpinner strokeWidth="4" style="width: 50px; height: 50px" />
                </div>

                <div v-else-if="selectedOrder" class="order-details">
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
                            <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ t('historyPages.common.orderDate') }} {{ formatDate(selectedOrder.doc_date, selectedOrder.doc_time) }}</div>
                        </div>

                        <div class="payment-summary p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 flex-1">
                            <div class="font-semibold mb-1">{{ t('historyPages.common.paymentSummary') }}</div>
                            <div class="flex justify-between text-sm">
                                <span>{{ t('historyPages.common.cnTotal') }}</span>
                                <span class="font-medium">฿{{ formatCurrency(selectedOrder.cn_total_amount || 0) }}</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span>{{ t('historyPages.common.totalPrefix') }}</span>
                                <span class="font-medium">฿{{ formatCurrency(selectedOrder.total_amount) }}</span>
                            </div>
                            <div v-if="parseFloat(selectedOrder.balance) > 0" class="flex justify-between text-sm text-red-600">
                                <span>{{ t('historyPages.common.outstandingBalance') }}</span>
                                <span class="font-medium">฿{{ formatCurrency(selectedOrder.balance) }}</span>
                            </div>
                        </div>
                    </div>

                    <div v-if="isPreorderOrder(selectedOrder)" class="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                        <i class="pi pi-clock mt-1"></i>
                        <div class="flex flex-col gap-0.5">
                            <strong class="text-sm font-bold">{{ getPreorderOrderLabel() }}</strong>
                            <span class="text-sm text-amber-700">{{ getPreorderOrderDescription() }}</span>
                        </div>
                    </div>

                    <!-- Customer and Employee Info -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                            <h3 class="text-lg font-semibold mb-2 flex items-center">
                                <i class="pi pi-user mr-2 text-primary-500"></i>
                                {{ t('historyPages.common.customerInfo') }}
                            </h3>
                            <div class="grid grid-cols-2 gap-2">
                                <div class="text-sm text-gray-500">{{ t('historyPages.common.customerCode') }}</div>
                                <div class="text-sm font-medium">{{ selectedOrder.cust_code }}</div>

                                <div class="text-sm text-gray-500">{{ t('historyPages.common.phone') }}</div>
                                <div class="text-sm font-medium">{{ selectedOrder.telephone || '-' }}</div>
                            </div>
                        </div>

                        <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                            <h3 class="text-lg font-semibold mb-2 flex items-center">
                                <i class="pi pi-briefcase mr-2 text-primary-500"></i>
                                {{ t('historyPages.common.employeeInfo') }}
                            </h3>
                            <div class="grid grid-cols-2 gap-2">
                                <!-- <div class="text-sm text-gray-500">{{ t('historyPages.common.employeeCode') }}</div>
                                <div class="text-sm font-medium">{{ selectedOrder.emp_code || '-' }}</div> -->

                                <div class="text-sm text-gray-500">{{ t('historyPages.common.employeeName') }}</div>
                                <div class="text-sm font-medium">{{ selectedOrder.emp_name || t('historyPages.common.noEmployee') }}</div>
                            </div>
                        </div>
                    </div>

                    <!-- {{ t('historyPages.common.deliveryInfo') }} -->
                    <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <i class="pi pi-map-marker mr-2 text-primary-500"></i>
                            {{ t('historyPages.common.deliveryInfo') }}
                        </h3>

                        <!-- วิธีรับ{{ t('historyPages.common.product') }} -->
                        <div class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.receiveMethod') }}</div>
                            <div class="text-sm font-medium mt-1">
                                <Tag :severity="selectedOrder.address_name === '1' ? 'info' : 'success'" :value="String(selectedOrder.send_type) === '1' ? t('historyPages.common.shipping') : t('historyPages.common.pickup')" />
                            </div>
                        </div>

                        <!-- ข้อมูลที่อยู่สำหรับจัดส่ง -->
                        <div v-if="String(selectedOrder.send_type) === '1'" class="mt-2">
                            <div class="text-sm text-gray-500 mt-2">{{ t('historyPages.common.shippingAddress') }} <Tag :severity="selectedOrder.address_name === t('historyPages.common.currentAddress') ? 'info' : 'success'" :value="selectedOrder.address_name" /></div>
                            <div class="text-sm font-medium">{{ selectedOrder.address || '-' }}</div>
                        </div>

                        <!-- {{ t('historyPages.shipping.shippingStatus') }} -->
                        <div v-if="hasTrackingUrl(selectedOrder)" class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.trackingLink') }}</div>
                            <div class="text-sm font-medium mt-1">
                                <a :href="getTrackingUrl(selectedOrder)" target="_blank" class="flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                                    <i class="pi pi-external-link mr-1"></i>
                                    <span class="truncate">{{ getTrackingUrl(selectedOrder) }}</span>
                                </a>
                            </div>
                        </div>
                    </div>

                    <!-- {{ t('historyPages.common.notes') }}ต่างๆ -->
                    <div v-if="hasDisplayOrderRemark(selectedOrder, 'remark') || hasDisplayOrderRemark(selectedOrder, 'remark_qt') || selectedOrder.remark_inv" class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg mb-4">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <i class="pi pi-comment mr-2 text-primary-500"></i>
                            {{ t('historyPages.common.notes') }}
                        </h3>

                        <div v-if="hasDisplayOrderRemark(selectedOrder, 'remark')" class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.generalRemark') }}</div>
                            <div class="text-sm mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded">{{ getDisplayOrderRemark(selectedOrder, 'remark') }}</div>
                        </div>

                        <div v-if="hasDisplayOrderRemark(selectedOrder, 'remark_qt')" class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.orderRemark') }}</div>
                            <div class="text-sm mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded">{{ getDisplayOrderRemark(selectedOrder, 'remark_qt') }}</div>
                        </div>

                        <div v-if="selectedOrder.remark_inv" class="mb-2">
                            <div class="text-sm text-gray-500">{{ t('historyPages.common.saleRemark') }}</div>
                            <div class="text-sm mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded">{{ selectedOrder.remark_inv }}</div>
                        </div>
                    </div>

                    <!-- Order Items with responsive layout -->
                    <div v-if="selectedOrderDetails && selectedOrderDetails.length > 0" class="mb-4">
                        <h3 class="text-lg font-semibold mb-2 flex items-center">
                            <i class="pi pi-shopping-cart mr-2 text-primary-500"></i>
                            {{ t('historyPages.common.productItems') }}
                            <span v-if="detailsTotalItems > 0" class="ml-2 text-sm font-normal text-gray-500"> ({{ t('historyPages.common.showingOf', { shown: selectedOrderDetails.length, total: detailsTotalItems }) }}) </span>
                        </h3>

                        <!-- Search box for order items -->
                        <div class="mb-3 flex gap-2">
                            <span class="p-input-icon-left flex-1">
                                <InputText v-model="detailsSearchTerm" :placeholder="t('historyPages.common.searchProductItems')" :aria-label="t('historyPages.common.searchProductItems')" class="w-full" @keyup.enter="searchOrderItems" />
                            </span>
                            <Button v-if="detailsSearchTerm" icon="pi pi-times" severity="secondary" outlined :aria-label="t('common.clearSearch')" :disabled="loadingDetails" @click="clearDetailsSearch" />
                            <Button icon="pi pi-search" :aria-label="t('historyPages.common.searchProductItems')" :disabled="loadingDetails" @click="searchOrderItems" :loading="loadingDetails" />
                        </div>

                        <!-- Desktop Table (visible based on screen width using JS) -->
                        <div v-if="windowWidth >= 430" class="order-items-table">
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
                                        <!-- {{ t('historyPages.common.product') }}ปกติ หรือ {{ t('historyPages.common.product') }}ชุด (หัวข้อหลัก) -->
                                        <div class="grid grid-cols-12 p-3 hover:bg-gray-50 dark:hover:bg-gray-800" :class="{ 'bg-purple-50 dark:bg-purple-900/20': item.item_type === 3 || item.item_type === '3' }">
                                            <div class="col-span-5">
                                                <div class="font-medium text-primary-600 dark:text-primary-400 flex items-center">
                                                    {{ getItemDisplayName(item) }}

                                                    <!-- ปุ่มกดเปิด/ปิดรายการย่อยสำหรับ{{ t('historyPages.common.product') }}ชุด -->
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
                                            </div>
                                            <div class="col-span-2 text-center self-center">
                                                {{ item.unit_code }}
                                            </div>
                                            <div class="col-span-2 text-right self-center">฿ {{ formatCurrency(item.price || (item.sum_amount ? item.sum_amount / item.qty : 0)) }}</div>
                                            <div class="col-span-1 text-right self-center">{{ item.qty }}</div>
                                            <div class="col-span-2 text-right self-center font-semibold">฿ {{ formatCurrency(item.sum_amount || parseFloat(item.qty) * parseFloat(item.price || 0)) }}</div>
                                        </div>

                                        <!-- Sub items สำหรับ{{ t('historyPages.common.product') }}ชุด (แสดงเมื่อ expand) -->
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
                                <!-- {{ t('historyPages.common.product') }}ปกติ หรือ {{ t('historyPages.common.product') }}ชุด (หัวข้อหลัก) -->
                                <div class="mb-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg" :class="{ 'border-purple-300 dark:border-purple-600 bg-purple-50 dark:bg-purple-900/20': item.item_type === 3 || item.item_type === '3' }">
                                    <div class="flex justify-between items-start mb-2">
                                        <div class="font-medium text-primary-600 dark:text-primary-400 flex items-center flex-wrap gap-1">
                                            <Tag v-if="item.item_type === 3 || item.item_type === '3'" :value="t('historyPages.common.productSet')" severity="secondary" class="text-xs" />
                                            {{ getItemDisplayName(item) }}
                                            <!-- ปุ่มกดเปิด/ปิดรายการย่อยสำหรับ{{ t('historyPages.common.product') }}ชุด (Mobile) -->
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
                                    <!-- แสดง{{ t('historyPages.common.quantity') }}รายการย่อยเมื่อยุบ (Mobile) -->
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

                                    <!-- Sub items สำหรับ{{ t('historyPages.common.product') }}ชุด (Mobile Card View) - แสดงเมื่อ expand -->
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
                            <div class="flex flex-col sm:flex-row justify-between gap-2">
                                <div class="order-2 sm:order-1">
                                    <div v-if="parseFloat(selectedOrder.balance) > 0" class="flex justify-between sm:flex-col text-sm text-red-600">
                                        <span>{{ t('historyPages.common.paidAmount') }}</span>
                                        <span class="font-medium">฿{{ formatCurrency(toMoneyNumber(selectedOrder.total_amount) - toMoneyNumber(selectedOrder.balance)) }}</span>
                                    </div>
                                    <div v-if="parseFloat(selectedOrder.balance) > 0" class="flex justify-between sm:flex-col text-sm text-red-600">
                                        <span>{{ t('historyPages.common.outstandingBalance') }}</span>
                                        <span class="font-medium">฿{{ formatCurrency(selectedOrder.balance) }}</span>
                                    </div>
                                </div>
                                <div class="flex justify-between items-center order-1 sm:order-2">
                                    <div class="font-medium sm:text-right">{{ t('historyPages.common.grandTotal') }}</div>
                                    <div class="font-bold text-primary-600 dark:text-primary-400 text-lg ml-2">฿{{ formatCurrency(selectedOrder.total_amount) }}</div>
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
                    <div class="flex justify-between gap-2">
                        <Button v-if="qrPaymentEnabled && selectedOrder && selectedOrder.status === 'payment'" :label="t('historyPages.common.payQrCode')" icon="pi pi-qrcode" severity="warning" :disabled="isShippingActionBusy" @click="showQRPayment(selectedOrder)" />
                        <div class="flex gap-2 ml-auto">
                            <Button :label="t('historyPages.common.close')" icon="pi pi-times" outlined :disabled="loadingDetails" @click="displayOrderDetails = false" />
                        </div>
                    </div>
                </template>
            </Dialog>

            <!-- Dialog การชำระเงินด้วย QR Code -->
            <Dialog v-model:visible="showQrPaymentDialog" :modal="true" :closable="false" :header="t('historyPages.common.qrPayment')" :style="{ width: '90%', maxWidth: '500px' }" :closeOnEscape="false">
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
                            <div class="h-2 rounded-full transition-all duration-1000" :class="paymentTimeRemaining < 60000 ? 'bg-red-500' : 'bg-primary-500'" :style="{ width: `${(paymentTimeRemaining / paymentTimeoutDuration) * 100}%` }"></div>
                        </div>
                    </div>

                    <!-- QR Code หมดอายุ -->
                    <div v-if="paymentTimeRemaining <= 0 && !paymentSuccess" class="flex flex-col items-center justify-center mb-4">
                        <i class="pi pi-times-circle text-red-500 mb-3" style="font-size: 3rem"></i>
                        <div class="text-lg font-medium text-red-500 mb-2">{{ t('historyPages.common.qrExpired') }}</div>
                        <Button :label="t('historyPages.common.regenerateQr')" icon="pi pi-refresh" :disabled="qrPaymentLoading" @click="generateQRCode" />
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

                        <Button v-if="!paymentSuccess && qrCodeUrl" :label="t('historyPages.common.downloadQr')" icon="pi pi-download" class="p-button-outlined p-button-info mb-4" :disabled="qrPaymentLoading" @click="downloadQRCode" />

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
                    <div class="w-full mt-4 mb-2" v-if="!paymentSuccess">
                        <h3 class="text-md font-medium mb-2">{{ t('historyPages.common.paidItems') }}</h3>
                        <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                            <div
                                v-for="(order, index) in selectedOrdersForPayment"
                                :key="order.doc_no"
                                class="p-3 flex justify-between items-center"
                                :class="{ 'border-b border-gray-200 dark:border-gray-700': index < selectedOrdersForPayment.length - 1 }"
                            >
                                <div>
                                    <div class="font-medium">{{ order.doc_no }}</div>
                                    <div class="text-sm text-gray-500">{{ formatDate(order.doc_date, order.doc_time) }}</div>
                                </div>
                                <div class="text-right font-bold">฿{{ formatCurrency(order.total_amount) }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <div class="flex justify-end gap-2">
                        <!-- เพิ่มปุ่มดาวน์โหลด QR Code ในส่วนล่างของ Dialog -->
                        <Button v-if="!paymentSuccess" :label="t('historyPages.common.cancel')" icon="pi pi-times" outlined :disabled="qrPaymentLoading" @click="cancelQRPayment" />
                        <Button v-else :label="t('historyPages.common.close')" icon="pi pi-times" outlined :disabled="qrPaymentLoading" @click="cancelQRPayment" />
                    </div>
                </template>
            </Dialog>
        </div>
    </div>
</template>

<style lang="scss" scoped>
/* Style remains the same as OrderHistory.vue */
</style>
