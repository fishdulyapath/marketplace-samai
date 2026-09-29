import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: { 'Content-Type': 'application/json' }
});

class AdminOrderService {
    /**
     * คำสั่งซื้อทุกใบที่เข้ามา (หลังบ้าน)
     *
     * ไม่ส่ง dateFrom/dateTo = ให้เซิร์ฟเวอร์เลือกย้อนหลัง 7 วันให้เอง
     * กติกาช่วงวันที่อยู่ที่เซิร์ฟเวอร์ที่เดียว หน้าจอไม่ต้องคำนวณเอง จะได้ไม่เหลื่อมกัน
     *
     * signal: ใช้ยกเลิกคำขอเก่าเวลาผู้ใช้กดค้นหารัวๆ หรือตอน auto refresh ซ้อนกับการกดเอง
     */
    getOrders({ search = '', dateFrom = '', dateTo = '', status = '', page = 1, pageSize = 20, signal } = {}) {
        const params = { page, page_size: pageSize };
        if (search) params.search = search;
        if (status) params.status = status;
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
        return apiClient.get('service/v1/admin/orders', { params, signal });
    }

    // รายการสินค้าในใบ — ใช้ endpoint เดียวกับหน้าลูกค้า (รับเลขหลักแล้วรวมใบย่อยให้เอง)
    getOrderDetail(custCode, docNo, page = 1, pageSize = 100) {
        return apiClient.get('service/v1/getOrderDetail', {
            params: { cust_code: custCode, doc_no: docNo, page, page_size: pageSize }
        });
    }
}

export default new AdminOrderService();
