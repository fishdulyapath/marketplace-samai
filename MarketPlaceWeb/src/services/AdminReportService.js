import { createApiClient } from '@/api/http';

const apiClient = createApiClient({
    baseURL: import.meta.env.VITE_APP_API,
    headers: { 'Content-Type': 'application/json' }
});

class AdminReportService {
    // รายงานตะกร้าสินค้า: ลูกค้าที่มีของค้างในตะกร้า เรียง active ล่าสุดก่อน — ค้นหาด้วยรหัส/ชื่อ
    getCartCustomers({ search = '', page = 1, pageSize = 30, signal } = {}) {
        const params = { page, page_size: pageSize };
        if (search) params.search = search;
        return apiClient.get('service/v1/admin/cartcustomers', { params, signal });
    }

    // รายการสินค้าในตะกร้าของลูกค้ารายนั้น — ใช้ endpoint เดียวกับหน้าตะกร้าลูกค้า
    // (พนักงานส่ง cust_code ของลูกค้าได้ตามสิทธิ์ auth layer 2)
    getCustomerCartItems(custCode, page = 1, pageSize = 200) {
        return apiClient.get('service/v1/getcartitemlist', {
            params: { cust_code: custCode, page, page_size: pageSize }
        });
    }

    // รายงานสินค้าที่แสดงขายบนเว็บ ([W]) — หน่วยที่เปิดขาย, ลิมิตต่อหน่วย, preorder, แนะนำ, หมวด
    // exportAll = ดึงทั้งชุดตาม filter (ไม่แบ่งหน้า) สำหรับทำไฟล์ Excel
    getProductsOnWeb({ search = '', page = 1, pageSize = 30, exportAll = false, signal } = {}) {
        const params = exportAll ? { export: '1' } : { page, page_size: pageSize };
        if (search) params.search = search;
        return apiClient.get('service/v1/admin/productsonweb', { params, signal });
    }

    // ลูกค้าที่ใส่สินค้าตัวนี้ค้างในตะกร้า (รหัส/ชื่อ/เบอร์/จำนวนต่อหน่วย)
    getProductCartCustomers(itemCode) {
        return apiClient.get('service/v1/admin/productcartcustomers', {
            params: { item_code: itemCode }
        });
    }

    // รายงานยอดสั่ง order marketplace — ไม่ส่งวันที่ = วันนี้วันเดียว
    getMarketplaceOrderReport({ search = '', dateFrom = '', dateTo = '', page = 1, pageSize = 30, exportAll = false, signal } = {}) {
        const params = exportAll ? { export: '1' } : { page, page_size: pageSize };
        if (search) params.search = search;
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
        return apiClient.get('service/v1/admin/marketplaceorderreport', { params, signal });
    }

    // รายงานยอดขายจาก marketplace (ใบขายจริงที่เกิดจากใบสั่งซื้อ marketplace)
    getMarketplaceSaleReport({ search = '', dateFrom = '', dateTo = '', page = 1, pageSize = 30, exportAll = false, signal } = {}) {
        const params = exportAll ? { export: '1' } : { page, page_size: pageSize };
        if (search) params.search = search;
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
        return apiClient.get('service/v1/admin/marketplacesalereport', { params, signal });
    }
}

export default new AdminReportService();
