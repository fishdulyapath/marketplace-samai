import CartService from '@/services/CartService';
import ErpOptionService from '@/services/ErpOptionService';
import ProductService from '@/services/ProductService';
import { normalizeMaxOrderQty } from '@/utils/cartLimits';
import { withProductDisplay } from '@/utils/languageDisplay';
import { clearPendingCheckout, pendingCheckoutIdentity } from '@/utils/pendingCheckout';
import { toOrderQty } from '@/utils/preorderSplit';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const useCartStore = defineStore('cart', () => {
    const cartItems = ref([]);
    const isLoading = ref(false);
    const isCheckingOut = ref(false);
    const error = ref(null);
    const addToCartLocks = new Set();
    const setItemsCache = ref({}); // Cache สำหรับเก็บรายการสินค้าย่อยในชุด
    const totalCartCount = ref(0); // จำนวนรายการสินค้าทั้งหมดในตะกร้า (จาก API pagination)

    // ยอดรวมจาก API (สำหรับ pagination)
    const cartTotalPrice = ref(0); // ยอดรวมราคาทั้งหมดจาก API
    const cartTotalQty = ref(0); // จำนวนชิ้นรวมทั้งหมดจาก API

    // ตั้งค่า user data
    const custCode = ref('');
    const empCode = ref('');
    const defaultWhCode = import.meta.env.VITE_WH_CODE || '';
    const defaultShelfCode = import.meta.env.VITE_SHELF_CODE || '';

    function isSetItem(item) {
        return String(item?.item_type || '') === '3';
    }

    function toCartNumber(value, fallback = 0) {
        const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
        return Number.isFinite(numberValue) ? numberValue : fallback;
    }

    function normalizeCartItem(item = {}) {
        return withProductDisplay({
            ...item,
            id: item.id || item.guid_code,
            name: item.name || item.item_name,
            qty: toOrderQty(item.qty || item.quantity),
            price: toCartNumber(item.price, 0),
            max_order_qty: normalizeMaxOrderQty(item.max_order_qty)
        });
    }

    function getCartLineKey(item = {}) {
        const itemCode = String(item.item_code || item.id || item.code || '').trim();
        const unitCode = String(item.unit_code || item.unit || '').trim();
        if (!itemCode) return '';
        return `${itemCode}::${unitCode}`;
    }

    async function loadLatestCartOrderMetadata() {
        if (!custCode.value) return new Map();
        const latestItems = [];
        let page = 1;
        let hasNext = true;
        const pageSize = 200;

        while (hasNext) {
            const response = await CartService.getCartOrder(custCode.value, page, pageSize);
            const data = response?.data;
            if (!data?.success || !Array.isArray(data.data)) break;
            latestItems.push(...data.data);
            hasNext = page * pageSize < toCartNumber(data.total_count, 0);
            page += 1;
        }

        const latestByKey = new Map();
        latestItems.forEach((item) => {
            const key = getCartLineKey(item);
            if (key) latestByKey.set(key, item);
        });
        return latestByKey;
    }

    async function enrichCheckoutItemsWithLatestCartMetadata(items) {
        const sourceItems = Array.isArray(items) ? items : [];
        try {
            const latestByKey = await loadLatestCartOrderMetadata();
            if (!latestByKey.size) return sourceItems;
            return sourceItems.map((item) => {
                const latest = latestByKey.get(getCartLineKey(item));
                if (!latest) return item;
                return {
                    ...item,
                    balance_qty: latest.balance_qty ?? item.balance_qty,
                    preorder_allowed: latest.preorder_allowed ?? item.preorder_allowed,
                    preorder_mode: latest.preorder_mode || item.preorder_mode,
                    wh_code: item.wh_code || latest.wh_code,
                    shelf_code: item.shelf_code || latest.shelf_code,
                    barcode: item.barcode || latest.barcode,
                    stand_value: item.stand_value || latest.stand_value,
                    divide_value: item.divide_value || latest.divide_value,
                    ratio: item.ratio || latest.ratio,
                    tax_type: item.tax_type ?? latest.tax_type,
                    item_type: item.item_type || latest.item_type || '0',
                    max_order_qty: latest.max_order_qty ?? item.max_order_qty,
                };
            });
        } catch (err) {
            console.warn('Unable to refresh cart metadata before checkout:', err);
            return sourceItems;
        }
    }

    function mergeCartItemMetadata(target, source = {}) {
        const metadataFields = ['balance_qty', 'preorder_allowed', 'sold_out', 'tax_type', 'wh_code', 'shelf_code', 'barcode', 'stand_value', 'divide_value', 'ratio', 'max_order_qty'];
        metadataFields.forEach((field) => {
            if (source[field] !== undefined && source[field] !== null) {
                target[field] = source[field];
            }
        });
        return target;
    }

    function getApiErrorMessage(error) {
        const data = error?.response?.data;
        if (typeof data === 'string') return data.trim();
        if (data && typeof data === 'object') {
            if (data.msg === 'ORDER_STOCK_PREORDER_INVALID' && Array.isArray(data.stock_issues)) {
                const details = data.stock_issues.slice(0, 3).map((item) => {
                    const name = item.item_name ? ` ${item.item_name}` : '';
                    const qty = item.qty ?? '-';
                    const stock = item.balance_qty ?? 0;
                    const shortage = item.shortage_qty ?? Math.max(0, toCartNumber(qty, 0) - toCartNumber(stock, 0));
                    const unit = item.unit_code || '';
                    const reasonMap = {
                        preorder_not_allowed: 'ยังไม่ได้เปิด Preorder',
                        preorder_split_required: 'สต๊อกเปลี่ยน ต้องกลับไปแยกใบพร้อมส่ง/Preorder ใหม่',
                        exceeding: 'สต๊อกไม่พอ'
                    };
                    const reason = reasonMap[item.issue_type] || 'ต้องตรวจสอบสต๊อกอีกครั้ง';
                    return `${item.item_code || '-'}${name}: ต้องการ ${qty} ${unit} / พร้อมส่ง ${stock} ${unit} / ขาดอีก ${shortage} ${unit} (${reason})`;
                });
                const moreCount = data.stock_issues.length - details.length;
                if (moreCount > 0) details.push(`และอีก ${moreCount} รายการ`);
                return [data.message, ...details].filter(Boolean).join('\n');
            }
            return String(data.message || data.msg || data.ERROR || '').trim();
        }
        return String(error?.message || '').trim();
    }

    function getApiCheckoutErrorMeta(error) {
        const data = error?.response?.data;
        if (!data || typeof data !== 'object') return {};
        const stockIssues = Array.isArray(data.stock_issues) ? data.stock_issues : [];
        const code = String(data.msg || data.ERROR || '').trim();
        return {
            code,
            status: error?.response?.status,
            stockIssues,
            needsCartFix: code === 'ORDER_STOCK_PREORDER_INVALID' || stockIssues.length > 0
        };
    }

    function createCheckoutError(message, meta = {}) {
        const err = new Error(message || 'Unable to save order');
        err.checkoutMeta = {
            code: '',
            status: null,
            stockIssues: [],
            needsCartFix: false,
            ...meta
        };
        return err;
    }

    // Load user data from local storage
    function loadUserData() {
        try {
            const userData = localStorage.getItem('_userData');
            if (userData) {
                const userObj = JSON.parse(userData);
                if (userObj.user_code) {
                    custCode.value = userObj.user_code;
                    return true;
                }
            }
            return false;
        } catch (err) {
            console.error('Error loading user data:', err);
            return false;
        }
    }

    // เก็บรูปแบบข้อมูลสำหรับส่ง API ให้คงเส้นคงวา
    function formatCartItemForApi(item) {
        return {
            creator_code: custCode.value,
            cust_code: custCode.value,
            emp_code: empCode.value,
            // 🚨 ห้าม fallback ไป item.id เด็ดขาด — หน้ารายละเอียดสินค้าส่ง id = รหัสสินค้า
            //    ทำให้ทุกหน่วยของสินค้าตัวเดียวกันได้ guid_code ซ้ำกัน (เช่น "01-0004")
            //    แล้ว deleteItem ที่ลบด้วย guid_code จะลบทุกหน่วยพร้อมกัน
            //    guid_code ต้องเป็นรหัส "บรรทัดในตะกร้า" ไม่ใช่รหัสสินค้า
            guid_code: item.guid_code || generateGUID(),
            item_code: item.item_code || item.id || item.code,
            item_name: item.item_name || item.name,
            unit_code: item.unit_code || item.unit || 'ชิ้น',
            barcode: item.barcode || '',
            qty: (toOrderQty(item.qty) || toOrderQty(item.quantity) || 1).toString(),
            price: (item.price || 0).toString(),
            wh_code: item.wh_code || defaultWhCode,
            shelf_code: item.shelf_code || defaultShelfCode,
            ratio: item.ratio || '1',
            stand_value: item.stand_value || '1',
            divide_value: item.divide_value || '1',
            item_type: item.item_type || '0', // เพิ่ม item_type (0=ปกติ, 3=ชุด, 4=โปรโมชันของแถม)
            is_promotion: item.is_promotion || '0',
            // โปรโมชันของแถม: ส่งต่อรหัส/ชื่อ/ข้อมูลชุด เพื่อให้ตะกร้าและ sendorder ใช้ expand
            sale_premium_code: item.sale_premium_code || '',
            sale_premium_name: item.sale_premium_name || item.item_name || item.name || '',
            sale_premium_data: item.sale_premium_data || '',
            create_datetime: new Date().toISOString().replace('T', ' ').substring(0, 23)
        };
    }

    // คำนวณจำนวนรวมของสินค้าในตะกร้า (ใช้ค่าจาก API ถ้ามี)
    const totalItems = computed(() => {
        // ถ้ามีค่าจาก API ให้ใช้ค่านั้น
        if (cartTotalQty.value > 0) return cartTotalQty.value;
        // fallback: คำนวณจาก items ที่โหลดมา
        if (!cartItems.value || cartItems.value.length === 0) return 0;
        return cartItems.value.reduce((total, item) => total + toOrderQty(item.qty || item.quantity), 0);
    });

    // คำนวณราคารวมในตะกร้า (ใช้ค่าจาก API ถ้ามี)
    const totalPrice = computed(() => {
        // ถ้ามีค่าจาก API ให้ใช้ค่านั้น
        if (cartTotalPrice.value > 0) return cartTotalPrice.value;
        // fallback: คำนวณจาก items ที่โหลดมา
        if (!cartItems.value || cartItems.value.length === 0) return 0;
        return cartItems.value.reduce((total, item) => {
            return total + toCartNumber(item.price, 0) * toOrderQty(item.qty || item.quantity);
        }, 0);
    });

    // รวมเป็นยอดเงินทั้งหมด
    const totalAmount = computed(() => totalPrice.value);

    // รีเซ็ตตะกร้าทั้งหมด (ไม่ดึงข้อมูลจาก API และไม่บันทึกข้อมูลใหม่ลง API)
    function resetCartStore() {
        cartItems.value = [];
        isLoading.value = false;
        error.value = null;
        custCode.value = '';
        empCode.value = '';
    }

    // โหลดข้อมูลตะกร้าจาก API
    async function loadCartItems(forceRefresh = false) {
        try {
            isLoading.value = true;
            error.value = null;

            // ตรวจสอบและโหลดข้อมูลผู้ใช้ถ้าจำเป็น
            if (!custCode.value && !loadUserData()) {
                cartItems.value = [];
                return [];
            }

            // กรณีที่ต้องการบังคับรีเฟรชข้อมูล ให้ล้างข้อมูลในตะกร้าก่อน
            if (forceRefresh) {
                cartItems.value = [];
            }

            const response = await CartService.getCartItems(custCode.value);
            if (response.data && response.data.success && response.data.data) {
                // แปลงข้อมูลให้มีรูปแบบเดียวกัน
                cartItems.value = (response.data.data || []).map(normalizeCartItem);

                // อัปเดต totalCartCount จาก pagination response
                if (response.data.total_count !== undefined) {
                    totalCartCount.value = Math.trunc(toCartNumber(response.data.total_count, 0));
                }

                // โหลด summary เพื่อให้ได้ยอดรวมที่ถูกต้อง (ทำ parallel ไม่ต้องรอ)
                fetchCartSummary().catch((err) => console.error('Error fetching cart summary:', err));

                return cartItems.value;
            } else {
                cartItems.value = [];
                return [];
            }
        } catch (err) {
            console.error('Error loading cart items:', err);
            error.value = 'ไม่สามารถโหลดข้อมูลตะกร้าได้';
            cartItems.value = [];
            return [];
        } finally {
            isLoading.value = false;
        }
    }

    // เพิ่มฟังก์ชันสำหรับโหลดตะกร้าด้วย customer code โดยเฉพาะ
    async function loadCartItemsForCustomer(customerCode) {
        try {
            isLoading.value = true;
            error.value = null;

            if (!customerCode) {
                console.error('Customer code is required to load cart items');
                return [];
            }

            // กำหนดค่า custCode จาก parameter ที่ส่งมา
            custCode.value = customerCode;

            // 🚨 ล้างยอดสรุปของลูกค้าคนก่อนก่อนเสมอ
            //    ป้ายจำนวนบนไอคอนตะกร้าอ่าน totalItems ซึ่งคืน cartTotalQty ก่อนถ้ามากกว่า 0
            //    เดิมฟังก์ชันนี้เซ็ตแค่ cartItems ยอดของลูกค้าคนก่อนจึงค้างอยู่
            //    ยิงจริง: พนักงานสลับจาก AR00486 (1 ชิ้น) ไป OR-00886 (ตะกร้าว่าง)
            //    หน้าตะกร้าขึ้น "ตะกร้าของคุณว่างเปล่า" ถูกแล้ว แต่ป้ายยังขึ้น 1
            //    ถ้าคนเก่ามี 10 คนใหม่มี 3 ป้ายจะค้างที่ 10 ซึ่งหลอกกว่าอีก
            cartTotalQty.value = 0;
            cartTotalPrice.value = 0;
            totalCartCount.value = 0;

            const response = await CartService.getCartItems(customerCode);
            if (response.data && response.data.success && response.data.data) {
                // แปลงข้อมูลให้มีรูปแบบเดียวกัน
                cartItems.value = (response.data.data || []).map(normalizeCartItem);
            } else {
                cartItems.value = [];
            }

            // ดึงยอดสรุปของลูกค้าคนใหม่ — ใช้ค่าจาก API ไม่นับจาก cartItems
            // เพราะรายการที่โหลดมาถูกแบ่งหน้า (page_size 50) ตะกร้าที่ยาวกว่านั้นจะนับขาด
            await fetchCartSummary();

            return cartItems.value;
        } catch (err) {
            console.error('Error loading cart items for customer:', err);
            error.value = 'ไม่สามารถโหลดข้อมูลตะกร้าได้';
            // โหลดไม่สำเร็จก็ต้องไม่เหลือยอดของลูกค้าคนก่อนค้างไว้ให้เข้าใจผิด
            cartItems.value = [];
            cartTotalQty.value = 0;
            cartTotalPrice.value = 0;
            totalCartCount.value = 0;
            return [];
        } finally {
            isLoading.value = false;
        }
    }

    // เพิ่มสินค้าลงตะกร้า
    async function addToCart(product, quantity) {
        const lockKey = getCartLineKey(product);
        if (lockKey && addToCartLocks.has(lockKey)) {
            const message = 'กำลังเพิ่มสินค้านี้ลงตะกร้า กรุณารอสักครู่';
            error.value = message;
            throw new Error(message);
        }
        if (lockKey) addToCartLocks.add(lockKey);

        try {
            isLoading.value = true;
            error.value = null;

            // ตรวจสอบว่ามี custCode หรือไม่
            if (!custCode.value && !loadUserData()) {
                throw new Error('ไม่พบข้อมูลผู้ใช้');
            }

            // เพิ่ม logs เพื่อตรวจสอบค่าที่รับเข้ามา
            // console.log('CART STORE - ADD TO CART:', {
            //     product,
            //     requestedQuantity: quantity,
            //     currentCartItems: JSON.parse(JSON.stringify(cartItems.value))
            // });

            // ตรวจสอบว่าสินค้านี้มีในตะกร้าแล้วหรือไม่ โดยเช็คทั้ง item_code และ unit_code
            const existingItemIndex = cartItems.value.findIndex((item) => item.item_code === (product.item_code || product.id || product.code) && item.unit_code === (product.unit_code || product.unit));
            const requestedQty = toOrderQty(quantity);
            if (requestedQty <= 0) {
                throw new Error('จำนวนสินค้าต้องมากกว่า 0');
            }

            if (existingItemIndex !== -1) {
                // กรณีมีสินค้าอยู่แล้ว ให้ใช้ค่า quantity ที่ส่งมาเป็นค่าใหม่ทั้งหมด (ไม่ต้องบวกเพิ่ม)
                // เนื่องจากเราได้รวมค่าไว้แล้วจาก ProductDetail
                // console.log('CART STORE - พบสินค้าในตะกร้า:', {
                //     existingItem: cartItems.value[existingItemIndex],
                //     newQuantity: quantity
                // });

                // อัปเดตจำนวนสินค้าที่มีอยู่แล้วด้วยค่าใหม่ที่ส่งมา
                cartItems.value[existingItemIndex].qty = requestedQty;
                cartItems.value[existingItemIndex].item_type = product.item_type || cartItems.value[existingItemIndex].item_type || '0';
                cartItems.value[existingItemIndex].is_promotion = product.is_promotion || cartItems.value[existingItemIndex].is_promotion || '0';
                mergeCartItemMetadata(cartItems.value[existingItemIndex], product);

                // สร้าง cartItem สำหรับส่งไป API
                const cartItem = [
                    formatCartItemForApi({
                        ...cartItems.value[existingItemIndex],
                        qty: requestedQty
                    })
                ];

                // ส่ง API request เพื่ออัพเดทข้อมูล
                const response = await CartService.updateCartItemQuantity(cartItem);

                if (response.data && response.data.success) {
                    // console.log('CART STORE - อัปเดตสำเร็จ:', {
                    //     updatedCartItems: JSON.parse(JSON.stringify(cartItems.value))
                    // });

                    // อัปเดตยอดรวมจาก API เพื่อให้ badge แสดงค่าที่ถูกต้อง
                    await fetchCartSummary();

                    return { success: true, message: 'อัปเดตสินค้าในตะกร้าแล้ว' };
                }

                throw new Error(response.data?.message || 'อัปเดตสินค้าไม่สำเร็จ');
            } else {
                // กรณีเพิ่มสินค้าใหม่ ไม่มีในตะกร้า
                // console.log('CART STORE - เพิ่มสินค้าใหม่:', {
                //     newItem: product,
                //     quantity: quantity
                // });

                // เพิ่มข้อมูลเพิ่มเติมที่จำเป็นให้กับสินค้าใหม่
                const newProduct = {
                    ...product,
                    quantity: requestedQty,
                    id: product.id || product.guid_code || generateGUID(),
                    item_type: product.item_type || '0', // กำหนดค่าเริ่มต้นเป็น '0' (สินค้าปกติ, 3 = สินค้าชุด)
                    is_promotion: product.is_promotion || '0',
                    item_code: product.item_code || product.id || product.code,
                    unit_code: product.unit_code || product.unit
                };

                // สร้างข้อมูลสินค้าสำหรับส่งไปยัง API
                const cartItem = [formatCartItemForApi(newProduct)];

                // เรียก API เพื่อเพิ่มสินค้าลงตะกร้า
                const response = await CartService.addItemToCart(cartItem);

                if (response.data && response.data.success) {
                    // เพิ่มสินค้าลงใน local state เพื่อหลีกเลี่ยงการเรียก API ซ้ำ
                    const formattedItem = {
                        ...newProduct,
                        guid_code: cartItem[0].guid_code,
                        qty: requestedQty
                    };
                    cartItems.value.push(normalizeCartItem(formattedItem));

                    // console.log('CART STORE - เพิ่มสินค้าใหม่สำเร็จ:', {
                    //     updatedCartItems: JSON.parse(JSON.stringify(cartItems.value))
                    // });

                    // อัปเดตยอดรวมจาก API เพื่อให้ badge แสดงค่าที่ถูกต้อง
                    await fetchCartSummary();

                    return { success: true, message: 'เพิ่มสินค้าลงตะกร้าแล้ว' };
                }

                throw new Error(response.data?.message || 'เพิ่มสินค้าไม่สำเร็จ');
            }
        } catch (err) {
            console.error('Error adding item to cart:', err);
            error.value = err.message || 'ไม่สามารถเพิ่มสินค้าลงตะกร้าได้';
            throw err;
        } finally {
            if (lockKey) addToCartLocks.delete(lockKey);
            isLoading.value = false;
        }
    }

    // อัพเดทจำนวนสินค้าในตะกร้า
    async function updateCartItem(itemToUpdate) {
        try {
            isLoading.value = true;
            error.value = null;

            // ตรวจสอบว่ามี custCode หรือไม่
            if (!custCode.value && !loadUserData()) {
                throw new Error('ไม่พบข้อมูลผู้ใช้');
            }

            // ค้นหาสินค้าในตะกร้า
            const existingItemIndex = cartItems.value.findIndex((item) => item.id === itemToUpdate.id || item.guid_code === itemToUpdate.id || item.item_code === itemToUpdate.item_code);

            // กำหนดข้อมูลที่จะส่งไป API
            const qty = itemToUpdate.quantity || itemToUpdate.qty;
            const nextQty = toOrderQty(qty);
            if (nextQty <= 0) {
                throw new Error('จำนวนสินค้าต้องมากกว่า 0');
            }
            const cartItemData = [formatCartItemForApi(existingItemIndex !== -1 ? { ...cartItems.value[existingItemIndex], qty: nextQty } : { ...itemToUpdate, qty: nextQty })];

            // ส่ง API request เพื่ออัพเดทข้อมูล
            const response = await CartService.updateCartItemQuantity(cartItemData);

            if (response.data && response.data.success) {
                if (existingItemIndex !== -1) {
                    // อัปเดตข้อมูลในตะกร้า local
                    cartItems.value[existingItemIndex] = normalizeCartItem({
                        ...cartItems.value[existingItemIndex],
                        qty: nextQty
                    });
                } else {
                    // ถ้าไม่พบรายการในตะกร้า local ให้เพิ่มเข้าไป
                    const newItem = {
                        ...itemToUpdate,
                        id: cartItemData[0].guid_code,
                        guid_code: cartItemData[0].guid_code,
                        qty: nextQty
                    };
                    cartItems.value.push(normalizeCartItem(newItem));
                }

                return { success: true, message: 'อัปเดตสินค้าในตะกร้าแล้ว' };
            }

            throw new Error(response.data?.message || 'อัปเดตสินค้าไม่สำเร็จ');
        } catch (err) {
            console.error('Error updating cart item:', err);
            error.value = err.message || 'ไม่สามารถอัปเดตสินค้าในตะกร้าได้';
            throw err;
        } finally {
            isLoading.value = false;
        }
    }

    // ลบสินค้าออกจากตะกร้า
    async function removeFromCart(itemId) {
        try {
            isLoading.value = true;
            error.value = null;

            if (!custCode.value && !loadUserData()) {
                throw new Error('ไม่พบข้อมูลผู้ใช้');
            }

            const itemToRemove = cartItems.value.find((item) => item.id === itemId || item.guid_code === itemId);

            if (!itemToRemove) {
                throw new Error('ไม่พบสินค้าในตะกร้า');
            }

            // ใช้ endpoint ใหม่สำหรับการลบสินค้า
            // ส่ง item_code/unit_code ไปด้วยเพื่อจำกัดขอบเขตการลบ — ข้อมูลเก่าในฐานข้อมูล
            // ยังมีแถวที่ guid_code ซ้ำกันข้ามหน่วยอยู่ (ดูคอมเมนต์ที่ formatCartItemForApi)
            const response = await CartService.deleteItem(itemToRemove.guid_code || itemId, custCode.value, {
                item_code: itemToRemove.item_code,
                unit_code: itemToRemove.unit_code
            });

            if (response.data && response.data.success) {
                // ดึงข้อมูลตะกร้าใหม่จาก API หลังจากลบสินค้า
                await loadCartItems();
                return { success: true, message: 'ลบสินค้าออกจากตะกร้าแล้ว' };
            }

            throw new Error(response.data?.message || 'ลบสินค้าไม่สำเร็จ');
        } catch (err) {
            console.error('Error removing item from cart:', err);
            error.value = err.message || 'ไม่สามารถลบสินค้าออกจากตะกร้าได้';
            // Reload cart to ensure consistency with database
            await loadCartItems();
            throw err;
        } finally {
            isLoading.value = false;
        }
    }

    // ล้างตะกร้าทั้งหมด
    async function clearCart() {
        try {
            isLoading.value = true;
            error.value = null;

            if (!custCode.value && !loadUserData()) {
                throw new Error('ไม่พบข้อมูลผู้ใช้');
            }

            if (cartItems.value.length === 0) {
                // รีเซ็ตค่า totals ให้เป็น 0 แม้ตะกร้าจะว่างอยู่แล้ว
                resetCartTotals();
                return { success: true, message: 'ตะกร้าว่างเปล่าอยู่แล้ว' };
            }

            // ใช้ endpoint สำหรับการล้างตะกร้า
            const response = await CartService.deleteAllItems(custCode.value);

            if (response.data && response.data.success) {
                // รีเซ็ตค่า totals ให้เป็น 0 ทันที (สำคัญสำหรับ badge)
                resetCartTotals();
                cartItems.value = [];

                // ดึงข้อมูลตะกร้าใหม่จาก API หลังจากล้างตะกร้า
                await loadCartItems();
                return { success: true, message: 'ล้างตะกร้าเรียบร้อยแล้ว' };
            }

            throw new Error(response.data?.message || 'ล้างตะกร้าไม่สำเร็จ');
        } catch (err) {
            console.error('Error clearing cart:', err);
            error.value = err.message || 'ไม่สามารถล้างตะกร้าได้';
            // เรียกข้อมูลตะกร้าใหม่เพื่อให้แน่ใจว่าข้อมูลตรงกับฐานข้อมูล
            await loadCartItems();
            throw err;
        } finally {
            isLoading.value = false;
        }
    }

    async function checkoutCart(checkoutData) {
        if (isCheckingOut.value) {
            const message = 'กำลังบันทึกคำสั่งซื้อ กรุณารอสักครู่';
            error.value = message;
            throw new Error(message);
        }
        isCheckingOut.value = true;

        try {
            isLoading.value = true;
            error.value = null;

            if (!custCode.value && !loadUserData()) {
                throw new Error('ไม่พบข้อมูลผู้ใช้');
            }

            // จัดเตรียมข้อมูลสำหรับ API sendOrder
            const now = new Date();
            const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; // YYYY-MM-DD (local)
            const formattedTime = now.toTimeString().slice(0, 5); // HH:MM

            // เลขที่เอกสารจริงออกจาก server (REQ4) — ค่านี้ใช้เฉพาะตอน order_doc_source='client'
            // ซึ่งเป็น kill switch ที่ยังเปิดอยู่ ถ้าโหมดเป็น server ค่านี้จะถูกเมิน
            const docNo = generateOrderNumber();

            // Persist the final identity below so uncertain retries/reloads reuse it.
            const checkoutRequestId = generateGUID();

            // Debug: ตรวจสอบข้อมูล items ที่ส่งมาจาก checkoutData
            // console.log('=== DEBUG: checkoutData.items ===');
            // checkoutData.items.forEach((item, index) => {
            //     console.log(`Item ${index + 1}: ${item.item_code}, tax_type: "${item.tax_type}"`);
            // });
            // console.log('===============================');

            // จัดเตรียมข้อมูลสินค้า
            const checkoutItems = await enrichCheckoutItemsWithLatestCartMetadata(checkoutData.items);
            const items = checkoutItems.map((item) => {
                // คำนวณยอดรวมสำหรับแต่ละรายการ
                const qty = toOrderQty(item.qty);
                if (qty <= 0) {
                    throw new Error(`จำนวนสินค้าไม่ถูกต้อง: ${item.item_name || item.item_code || '-'}`);
                }
                const price = toCartNumber(item.price, 0);
                const grossAmount = price * qty;
                const sumAmount = (item.sum_amount !== undefined && item.sum_amount !== null ? toCartNumber(item.sum_amount, grossAmount) : grossAmount).toString();
                const taxType = String(item.tax_type ?? '0');

                const mappedItem = {
                    item_code: item.item_code,
                    item_name: item.item_name,
                    barcode: item.barcode || '',
                    qty: qty.toString(),
                    price: price.toString(),
                    sum_amount: sumAmount,
                    discount: item.discount || item.defaultDiscount || item.default_discount || '',
                    discount_amount: toCartNumber(item.discount_amount, 0).toString(),
                    remark: item.remark || '',
                    unit_code: item.unit_code || 'ชิ้น',
                    wh_code: item.wh_code || defaultWhCode,
                    shelf_code: item.shelf_code || defaultShelfCode,
                    ratio: item.ratio || '1',
                    stand_value: item.stand_value || '1',
                    divide_value: item.divide_value || '1',
                    tax_type: taxType, // เพิ่ม tax_type field
                    item_type: item.item_type || '0', // เพิ่ม item_type (default = 0 สินค้าปกติ, 3 = สินค้าชุด)
                    is_promotion: item.is_promotion || '0',
                    balance_qty: item.balance_qty,
                    preorder_allowed: item.preorder_allowed ?? 0,
                    sub_item: item.sub_item || [] // เพิ่ม sub_item สำหรับสินค้าชุด
                };

                // Debug: แสดงข้อมูล tax_type ของแต่ละสินค้า
                // console.log(`[CART STORE] สินค้า ${item.item_code}: tax_type จาก item = "${item.tax_type}", tax_type ใน mappedItem = "${mappedItem.tax_type}", sum_amount = ${sumAmount}`);

                return mappedItem;
            });

            // คำนวณยอดรวม
            const totalValue = items.reduce((sum, item) => sum + toCartNumber(item.sum_amount, 0), 0).toString();

            // คำนวณยอดรวมแยกตามประเภทภาษี
            const totalExceptVat = items
                .filter((item) => String(item.tax_type) === '1') // สินค้าไม่มีภาษี
                .reduce((sum, item) => sum + toCartNumber(item.sum_amount, 0), 0)
                .toString();

            const totalAfterVat = items
                .filter((item) => String(item.tax_type) === '0') // สินค้ามีภาษี
                .reduce((sum, item) => sum + toCartNumber(item.sum_amount, 0), 0)
                .toString();

            // Debug: แสดงการคำนวณยอดรวมแยกตาม tax_type
            // console.log('=== การคำนวณยอดรวมตาม tax_type ===');
            // console.log(
            //     'สินค้าไม่มีภาษี (tax_type = "1"):',
            //     items.filter((item) => item.tax_type === '1')
            // );
            // console.log(
            //     'สินค้ามีภาษี (tax_type = "0"):',
            //     items.filter((item) => item.tax_type === '0')
            // );
            // console.log('total_except_vat (ไม่มีภาษี):', totalExceptVat);
            // console.log('total_after_vat (มีภาษี):', totalAfterVat);
            // console.log('total_value (รวมทั้งหมด):', totalValue);
            // console.log('=======================================');

            // สร้างค่า remark ที่เหมาะสม
            // ใช้ค่า remark ที่ผู้ใช้กรอกเข้ามา ถ้าไม่มีให้ใช้ค่าเริ่มต้น
            const remarkValue = checkoutData.remark;
            const priceOptions = await ErpOptionService.getPriceOptions();

            // สร้างข้อมูลสำหรับส่งไป API
            const orderData = {
                cust_code: localStorage.getItem('_userCode') || '',
                contact_code: localStorage.getItem('_contactCode') || '',
                emp_code: checkoutData.employeeCode || '',
                inquiry_type: priceOptions.sale_type,
                sale_type: priceOptions.sale_type,
                vat_type: priceOptions.vat_type,
                vat_rate: priceOptions.vat_rate,
                discout_type: priceOptions.discout_type,
                discount_type: priceOptions.discount_type,
                doc_date: formattedDate,
                doc_time: formattedTime,
                doc_no: docNo,
                items: items,
                total_amount: totalValue,
                total_value: totalValue,
                total_except_vat: totalExceptVat, // ยอดรวมสินค้าไม่มีภาษี
                total_after_vat: totalAfterVat, // ยอดรวมสินค้ามีภาษี
                telephone: checkoutData.telephone || '',
                remark: remarkValue, // ใช้ค่าหมายเหตุที่ผู้ใช้กรอก
                send_type: checkoutData.send_type || '0',
                address: checkoutData.address || '',
                address_name: checkoutData.address_name || '',
                // เพิ่มฟิลด์ใหม่สำหรับวันที่จัดส่งและเครดิต
                send_date: checkoutData.send_date || null,
                send_day: checkoutData.send_day !== null && checkoutData.send_day !== undefined ? String(checkoutData.send_day) : null,
                // ข้อมูลรับเอง — server เอาไปต่อท้ายหมายเหตุของ QT
                pickup_date: checkoutData.pickup_date || '',
                pickup_time_slot: checkoutData.pickup_time_slot || '',
                pickup_receiver: checkoutData.pickup_receiver || '',
                pickup_vehicle: checkoutData.pickup_vehicle || '',
                credit_day: checkoutData.credit_day || null,
                credit_date: checkoutData.credit_date || null
            };

            // Staff allocates the warehouse after checkout.
            const identity = pendingCheckoutIdentity(orderData.cust_code, orderData, { requestId: checkoutRequestId, docNo });
            const orderPayloads = [{ type: 'pending', payload: { ...orderData, doc_no: identity.docNo, request_id: identity.requestId } }];
            const split = { hasPreorderItems: false };

            // Add more detailed logging
            // console.log('Checkout process started');
            // console.log('Checkout data received:', JSON.stringify(checkoutData, null, 2));
            // console.log('Order data to be sent:', JSON.stringify(orderData, null, 2));
            // console.log('API endpoint:', import.meta.env.VITE_APP_API + 'service/v1/sendorder');

            const savedDocNos = [];
            const savedDocuments = [];
            let orderDocDate = '';
            let orderDocTime = '';
            try {
                // ส่งข้อมูลไปยัง API
                for (const orderPayload of orderPayloads) {
                    const { payload, type } = orderPayload;
                    const response = await CartService.sendOrder(payload);
                    if (!response.data || !response.data.success) {
                        console.error('API returned error:', response.data);
                        throw new Error(response.data?.message || response.data?.msg || 'ไม่สามารถบันทึกเอกสารสั่งซื้อได้');
                    }
                    // เลขที่ลูกค้าเห็นคือ "เลขหลัก" จาก server — ถ้าเอกสารถูกแบ่งหลายใบ
                    // จะไม่โชว์เลขย่อย (-1/-2) เพื่อให้ตรงกับเลขที่ใช้ค้นหา/ยกเลิก (REQ4)
                    const savedDocNo = response.data.main_doc_no || response.data.doc_no || payload.doc_no;
                    if (!orderDocDate) orderDocDate = response.data.doc_date || '';
                    if (!orderDocTime) orderDocTime = response.data.doc_time || '';
                    savedDocNos.push(savedDocNo);
                    savedDocuments.push({ docNo: savedDocNo, type, docCount: response.data.doc_count || 1 });
                }

                await clearCart();
                clearPendingCheckout(orderData.cust_code);

                return {
                    success: true,
                    message: 'ส่งคำขอแล้ว รอพนักงานจัดคลัง',
                    orderNumber: savedDocNos[0] || docNo,
                    orderNumbers: savedDocNos,
                    orderDocuments: savedDocuments,
                    orderDocDate,
                    orderDocTime,
                    preorder: split.hasPreorderItems,
                };
            } catch (apiError) {
                console.error('API call failed:', apiError);

                if (savedDocNos.length > 0) {
                    return {
                        success: true,
                        partial: true,
                        message: `บันทึกเอกสารสำเร็จบางส่วน: ${savedDocNos.join(', ')} ตะกร้ายังถูกเก็บไว้เพื่อให้ตรวจสอบรายการที่เหลือ กรุณาติดต่อเจ้าหน้าที่ก่อนกดยืนยันซ้ำ`,
                        orderNumber: savedDocNos[0],
                        orderNumbers: savedDocNos,
                        orderDocuments: savedDocuments,
                        preorder: split.hasPreorderItems,
                    };
                }

                // ตรวจสอบกรณี 400 Bad Request และ Customer Code Not Found
                if (apiError.response && apiError.response.status === 400 && apiError.response.data && (apiError.response.data.ERROR === 'Customer Code Not Found' || JSON.stringify(apiError.response.data).includes('Customer Code Not Found'))) {
                    // ล้างข้อมูล user และ localStorage
                    localStorage.removeItem('_userData');
                    custCode.value = '';

                    // ส่งกลับข้อความเฉพาะพร้อมสถานะสำหรับให้ component นำไป redirect
                    throw new Error('LOGIN_REQUIRED:รหัสลูกค้าเป็นค่าว่างไม่สามารถบันทึกได้ กรุณาเข้าสู่ระบบใหม่');
                }

                // จัดการข้อผิดพลาดอื่นๆ
                const userMessage = getApiErrorMessage(apiError);
                if (userMessage) {
                    throw createCheckoutError(userMessage, getApiCheckoutErrorMeta(apiError));
                }

                const errorDetails = apiError.response ? `Status: ${apiError.response.status}, Message: ${JSON.stringify(apiError.response.data)}` : `Network Error: ${apiError.message}`;

                console.error('Error details:', errorDetails);
                throw new Error(`API Error: ${errorDetails}`);
            }
        } catch (err) {
            console.error('Error during checkout:', err);
            error.value = err.message || 'ไม่สามารถทำรายการชำระเงินได้';
            throw err;
        } finally {
            isCheckingOut.value = false;
            isLoading.value = false;
        }
    }

    // สร้าง GUID แบบง่าย
    function generateGUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    // สร้างเลขที่คำสั่งซื้อ
    function generateOrderNumber(prefix = 'MQT') {
        // Get current date in yyyymmdd format
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}${month}${day}`;

        // Generate a simple GUID-like string (3 letters followed by 2 digits)
        // You can modify this part based on your specific GUID requirements
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let guid = '';

        // Generate 3 random uppercase letters
        for (let i = 0; i < 3; i++) {
            guid += letters.charAt(Math.floor(Math.random() * letters.length));
        }

        // Add 2 random digits
        guid += Math.floor(Math.random() * 100)
            .toString()
            .padStart(2, '0');

        const cleanPrefix = String(prefix || 'MQT').replace(/[^A-Z0-9_-]/gi, '').toUpperCase() || 'MQT';
        return `${cleanPrefix}${dateStr}-${guid}`;
    }

    // ตรวจสอบว่าสินค้าอยู่ในตะกร้าหรือไม่
    // ถ้าส่ง unitCode มาด้วย จะเช็คทั้ง item_code และ unit_code
    function isInCart(itemCode, unitCode = null) {
        if (!itemCode) return false;

        return cartItems.value.some((item) => {
            if (unitCode) {
                return item.item_code === itemCode && item.unit_code === unitCode;
            }
            return item.item_code === itemCode;
        });
    }

    function syncWithApiData(apiItems) {
        // แปลงข้อมูลให้อยู่ในฟอร์แมตที่ถูกต้อง
        const formattedItems = apiItems.map((item) => normalizeCartItem({
            id: item.id || item.guid_code,
            guid_code: item.guid_code || item.id,
            item_code: item.item_code || item.id || item.code,
            item_name: item.item_name || item.name,
            name: item.name || item.item_name,
            name_eng_1: item.name_eng_1,
            qty: toOrderQty(item.qty || item.quantity),
            price: toCartNumber(item.price, 0),
            unit_code: item.unit_code || item.unit || 'ชิ้น',
            // คัดลอกคุณสมบัติอื่นๆ ที่จำเป็นสำหรับการแสดงผล
            barcode: item.barcode || '',
            wh_code: item.wh_code || '',
            shelf_code: item.shelf_code || '',
            ratio: item.ratio || '1',
            stand_value: item.stand_value || '1',
            divide_value: item.divide_value || '1',
            item_type: item.item_type || '0',
            tax_type: item.tax_type || '0',
            balance_qty: item.balance_qty,
            preorder_allowed: item.preorder_allowed ?? 0,
            preorder_mode: item.preorder_mode || 'default',
            sold_out: item.sold_out ?? '0',
            max_order_qty: item.max_order_qty,
            sub_item: item.sub_item || [],
            is_promotion: item.is_promotion || '0',
            image: item.image || item.product_image
        }));

        // แทนที่ข้อมูลตะกร้าทั้งหมดด้วยข้อมูลจาก API
        cartItems.value = formattedItems;

        return { success: true, message: 'ซิงค์ข้อมูลตะกร้าเรียบร้อย' };
    }

    // ดึงรายการสินค้าย่อยที่รวมอยู่ในชุด
    async function fetchSetItems(itemCode) {
        // ตรวจสอบ cache ก่อน
        if (setItemsCache.value[itemCode]) {
            return setItemsCache.value[itemCode];
        }

        try {
            const result = await ProductService.getProductSetItem(itemCode);
            setItemsCache.value[itemCode] = result.data || [];
            return result.data || [];
        } catch (err) {
            console.error('Error fetching set items:', err);
            return [];
        }
    }

    // Computed สำหรับดึงรายการสินค้าย่อยของสินค้าในตะกร้า
    const cartItemsWithSetItems = computed(() => {
        return cartItems.value.map((item) => ({
            ...item,
            setItems: isSetItem(item) ? setItemsCache.value[item.item_code] || [] : []
        }));
    });

    // ฟังก์ชันสำหรับอัปเดต totalCartCount จาก API pagination
    function setTotalCartCount(count) {
        totalCartCount.value = count;
    }

    // ฟังก์ชันสำหรับดึงยอดรวมราคาและจำนวนจาก API
    async function fetchCartSummary() {
        try {
            if (!custCode.value && !loadUserData()) {
                cartTotalPrice.value = 0;
                cartTotalQty.value = 0;
                return;
            }

            const response = await CartService.getCartSummary(custCode.value);
            if (response?.data?.success) {
                cartTotalPrice.value = toCartNumber(response.data.total_price, 0);
                cartTotalQty.value = Math.trunc(toCartNumber(response.data.total_qty, 0));
                // อัปเดต totalCartCount ด้วยถ้ามี total_items
                if (response.data.total_items !== undefined) {
                    totalCartCount.value = Math.trunc(toCartNumber(response.data.total_items, 0));
                }
            }
        } catch (err) {
            console.error('Error fetching cart summary:', err);
        }
    }

    // ฟังก์ชันสำหรับ reset ยอดรวมจาก API
    function resetCartTotals() {
        cartTotalPrice.value = 0;
        cartTotalQty.value = 0;
        totalCartCount.value = 0;
    }

    // โหลดข้อมูลตะกร้าตั้งแต่เริ่มต้น
    loadUserData();
    loadCartItems();

    return {
        cartItems,
        isLoading,
        isCheckingOut,
        error,
        custCode,
        totalItems,
        totalPrice,
        totalAmount,
        totalCartCount,
        cartTotalPrice,
        cartTotalQty,
        setTotalCartCount,
        fetchCartSummary,
        resetCartTotals,
        loadCartItems,
        loadCartItemsForCustomer,
        addToCart,
        updateCartItem,
        removeFromCart,
        clearCart,
        checkoutCart,
        isInCart,
        syncWithApiData,
        resetCartStore,
        fetchSetItems,
        setItemsCache,
        cartItemsWithSetItems
    };
});
