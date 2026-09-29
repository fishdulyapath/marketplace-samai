// stores/orderStore.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useCartStore } from './cartStore';

export const useOrderStore = defineStore('order', () => {
    // state
    const orders = ref([]);
    const loading = ref(false);

    // สถานะของออเดอร์และสีที่ใช้แสดง
    const orderStatuses = {
        PENDING: { label: 'รอการชำระเงิน', color: 'warning', icon: 'pi pi-clock' },
        PAID: { label: 'ชำระเงินแล้ว', color: 'info', icon: 'pi pi-credit-card' },
        PROCESSING: { label: 'กำลังจัดเตรียมสินค้า', color: 'primary', icon: 'pi pi-sync' },
        SHIPPED: { label: 'จัดส่งแล้ว', color: 'primary', icon: 'pi pi-send' },
        DELIVERED: { label: 'ได้รับสินค้าแล้ว', color: 'success', icon: 'pi pi-check-circle' },
        CANCELLED: { label: 'ยกเลิก', color: 'danger', icon: 'pi pi-times-circle' }
    };

    // ฟังก์ชันสำหรับดึงประวัติการสั่งซื้อจาก API
    async function fetchOrders() {
        loading.value = true;
        try {
            // ในสถานการณ์จริงจะมีการเรียก API
            // const response = await fetch('/api/orders');
            // const data = await response.json();
            // orders.value = data;

            // จำลองการรอ API
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // ใช้ข้อมูลจำลองแทน
            orders.value = generateMockOrders(10);
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            loading.value = false;
        }
    }

    // สร้างข้อมูลจำลอง
    function generateMockOrders(count) {
        const mockOrders = [];
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 6); // สร้างคำสั่งซื้อย้อนหลัง 6 เดือน

        const statuses = Object.keys(orderStatuses);
        const paymentMethods = ['บัตรเครดิต', 'โอนเงิน', 'เก็บเงินปลายทาง', 'e-Wallet'];

        for (let i = 0; i < count; i++) {
            // สร้างวันที่ - เรียงจากใหม่ไปเก่า
            const orderDate = new Date(startDate);
            orderDate.setDate(orderDate.getDate() + Math.floor(Math.random() * 180));

            // สร้างรายการสินค้า
            const items = generateMockOrderItems(Math.floor(Math.random() * 5) + 1);

            // คำนวณราคารวม
            const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const shipping = Math.random() > 0.3 ? 50 : 0; // บางคำสั่งซื้อฟรีค่าส่ง
            const total = subtotal + shipping;

            // กำหนดสถานะ - คำสั่งซื้อเก่ามีโอกาสเป็น DELIVERED มากกว่า
            let status;
            const daysPassed = Math.floor((new Date() - orderDate) / (1000 * 60 * 60 * 24));

            if (daysPassed > 14) {
                status = Math.random() > 0.2 ? 'DELIVERED' : Math.random() > 0.5 ? 'CANCELLED' : 'SHIPPED';
            } else if (daysPassed > 7) {
                status = Math.random() > 0.3 ? 'SHIPPED' : Math.random() > 0.5 ? 'PROCESSING' : 'PAID';
            } else if (daysPassed > 3) {
                status = Math.random() > 0.4 ? 'PROCESSING' : Math.random() > 0.5 ? 'PAID' : 'PENDING';
            } else {
                status = Math.random() > 0.5 ? 'PENDING' : 'PAID';
            }

            mockOrders.push({
                id: 'OD' + (1000000 + i).toString(),
                date: orderDate,
                status: status,
                paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
                items: items,
                subtotal: subtotal,
                shipping: shipping,
                total: total,
                address: {
                    recipient: 'คุณลูกค้า ทดสอบ',
                    phone: '08X-XXX-' + (1000 + Math.floor(Math.random() * 9000)),
                    address: '123/45 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110'
                },
                trackingNumber: status === 'SHIPPED' || status === 'DELIVERED' ? 'TH' + (10000000 + Math.floor(Math.random() * 90000000)) : null
            });
        }

        // เรียงตามวันที่จากใหม่ไปเก่า
        return mockOrders.sort((a, b) => b.date - a.date);
    }

    // สร้างรายการสินค้าจำลอง
    function generateMockOrderItems(count) {
        const products = [
            { id: 1, name: 'iPhone 15 Pro', price: 38900, image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=200' },
            { id: 2, name: 'Samsung Galaxy S24', price: 35900, image: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?q=80&w=200' },
            { id: 3, name: 'MacBook Air M3', price: 42900, image: 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?q=80&w=200' },
            { id: 4, name: 'เสื้อยืดคอกลม', price: 290, image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=200' },
            { id: 5, name: 'กางเกงยีนส์', price: 1290, image: 'https://images.unsplash.com/photo-1542272604-787c3835535d?q=80&w=200' },
            { id: 6, name: 'หม้อทอดไร้น้ำมัน', price: 2990, image: 'https://images.unsplash.com/photo-1644677861748-8f49581a5c69?q=80&w=200' },
            { id: 7, name: 'หมอนเมโมรี่โฟม', price: 890, image: 'https://images.unsplash.com/photo-1592789705501-f9ae4749a61d?q=80&w=200' },
            { id: 8, name: 'AirPods Pro 2', price: 8900, image: 'https://images.unsplash.com/photo-1606741965509-02f9e787efc2?q=80&w=200' },
            { id: 9, name: 'Apple Watch Series 9', price: 15900, image: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?q=80&w=200' }
        ];

        const items = [];

        for (let i = 0; i < count; i++) {
            const product = products[Math.floor(Math.random() * products.length)];

            // ตรวจสอบว่าสินค้านี้มีอยู่ในรายการแล้วหรือไม่
            const existingItemIndex = items.findIndex((item) => item.id === product.id);

            if (existingItemIndex >= 0) {
                // ถ้ามีอยู่แล้ว ให้เพิ่มจำนวน
                items[existingItemIndex].quantity += Math.floor(Math.random() * 2) + 1;
            } else {
                // ถ้ายังไม่มี ให้เพิ่มสินค้าใหม่
                items.push({
                    ...product,
                    quantity: Math.floor(Math.random() * 2) + 1 // จำนวน 1-3 ชิ้น
                });
            }
        }

        return items;
    }

    // ดูประวัติการสั่งซื้อตามรหัสคำสั่งซื้อ
    function getOrderById(orderId) {
        return orders.value.find((order) => order.id === orderId) || null;
    }

    // ฟิลเตอร์ออเดอร์ตามสถานะ
    function getOrdersByStatus(status) {
        if (!status) return orders.value;
        return orders.value.filter((order) => order.status === status);
    }

    // สั่งซื้อซ้ำ - เพิ่มสินค้าจากออเดอร์เก่าลงตะกร้า
    function reorder(orderId) {
        const cartStore = useCartStore();
        const order = getOrderById(orderId);

        if (!order) {
            console.error('Order not found');
            return false;
        }

        // เพิ่มสินค้าทั้งหมดในออเดอร์ลงตะกร้า
        order.items.forEach((item) => {
            const product = {
                id: item.id,
                name: item.name,
                price: item.price,
                image: item.image,
                inventoryStatus: 'INSTOCK', // สมมติว่าสินค้ามีสต็อก
                category: 'reorder'
            };

            cartStore.addToCart(product, item.quantity);
        });

        return true;
    }

    // สำหรับการสร้างเลขคำสั่งซื้อใหม่
    function generateOrderId() {
        return 'OD' + Date.now().toString().slice(-8);
    }

    // สร้างคำสั่งซื้อใหม่จากตะกร้าสินค้า
    async function createOrder(address, paymentMethod) {
        const cartStore = useCartStore();

        if (cartStore.cartItems.length === 0) {
            return { success: false, message: 'ตะกร้าสินค้าว่างเปล่า' };
        }

        const orderId = generateOrderId();
        const newOrder = {
            id: orderId,
            date: new Date(),
            status: 'PENDING',
            paymentMethod: paymentMethod,
            items: cartStore.cartItems.map((item) => ({
                id: item.id,
                name: item.name,
                price: item.price,
                image: item.image,
                quantity: item.quantity
            })),
            subtotal: cartStore.totalAmount,
            shipping: 50, // ค่าจัดส่งคงที่ 50 บาท
            total: cartStore.totalAmount + 50,
            address: address,
            trackingNumber: null
        };

        try {
            // จำลองการเรียก API
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // เพิ่มออเดอร์ใหม่เข้าไปในรายการ
            orders.value.unshift(newOrder);

            // ล้างตะกร้า
            cartStore.clearCart();

            return {
                success: true,
                message: 'สั่งซื้อสำเร็จ',
                orderId: orderId
            };
        } catch (error) {
            console.error('Error creating order:', error);
            return { success: false, message: 'เกิดข้อผิดพลาดในการสั่งซื้อ' };
        }
    }

    // ยกเลิกคำสั่งซื้อ
    async function cancelOrder(orderId) {
        const orderIndex = orders.value.findIndex((order) => order.id === orderId);

        if (orderIndex === -1) {
            return { success: false, message: 'ไม่พบคำสั่งซื้อ' };
        }

        if (orders.value[orderIndex].status === 'SHIPPED' || orders.value[orderIndex].status === 'DELIVERED') {
            return { success: false, message: 'ไม่สามารถยกเลิกคำสั่งซื้อที่จัดส่งแล้วได้' };
        }

        try {
            // จำลองการเรียก API
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // อัพเดทสถานะออเดอร์
            orders.value[orderIndex].status = 'CANCELLED';

            return { success: true, message: 'ยกเลิกคำสั่งซื้อสำเร็จ' };
        } catch (error) {
            console.error('Error cancelling order:', error);
            return { success: false, message: 'เกิดข้อผิดพลาดในการยกเลิกคำสั่งซื้อ' };
        }
    }

    // ฟอร์แมตวันที่เป็นภาษาไทย
    function formatDate(date) {
        if (!date) return '';
        return new Date(date).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // ฟอร์แมตตัวเลขเป็นรูปแบบเงินบาท
    function formatCurrency(value) {
        return new Intl.NumberFormat('th-TH').format(value);
    }

    return {
        orders,
        loading,
        orderStatuses,
        fetchOrders,
        getOrderById,
        getOrdersByStatus,
        reorder,
        createOrder,
        cancelOrder,
        formatDate,
        formatCurrency
    };
});
