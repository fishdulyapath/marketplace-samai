import AppLayout from '@/layout/AppLayout.vue';
import { canAccessAdminPermission } from '@/utils/adminPermissions';
import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
    history: createWebHistory(import.meta.env.VITE_APP_BASE_URL),
    routes: [
        {
            path: '/',
            component: AppLayout,
            children: [
                {
                    path: '/',
                    name: 'home',
                    meta: { title: 'หน้าแรก', requiresAuth: false },
                    component: () => import('@/views/pages/Landing.vue')
                },
                {
                    path: '/marketplace',
                    name: 'catalog',
                    meta: { title: 'สินค้า', requiresAuth: false },

                    component: () => import('@/views/pages/Catalog.vue')
                },

                // รายการโปรดของฉัน (รีวิว 260908 สไลด์ 9)
                // เป็นหน้าของตัวเอง ไม่ใช่การติ๊ก filter บนหน้าสินค้าทั้งหมด
                {
                    path: '/favorites',
                    name: 'favorites',
                    meta: { title: 'รายการโปรดของฉัน', requiresAuth: true },
                    component: () => import('@/views/pages/Favorites.vue')
                },

                // หน้ารายละเอียดสินค้า
                {
                    path: '/product/:id',
                    name: 'product-detail-public',
                    component: () => import('@/views/pages/ProductDetail.vue'),
                    props: true
                },
                {
                    path: '/product-detail/:id',
                    name: 'product-detail',
                    component: () => import('@/views/pages/ProductDetail.vue'),
                    props: true
                },
                // หน้าตะกร้าสินค้า
                {
                    path: '/cart',
                    name: 'cart',
                    component: () => import('@/views/pages/CartView.vue')
                },

                // หน้า 404 ของหน้าร้าน — ต้องอยู่ใต้ AppLayout ลูกค้าจะได้มีเมนูกดต่อได้
                {
                    path: '/pages/notfound',
                    name: 'notfound',
                    meta: { title: 'ไม่พบหน้านี้', requiresAuth: false },
                    component: () => import('@/views/pages/NotFound.vue')
                },

                // หน้าประวัติการสั่งซื้อ
                {
                    path: 'orders-history',
                    name: 'order-history',
                    component: () => import('@/views/pages/OrderHistory.vue'),
                    meta: {
                        requiresAuth: true,
                        title: 'คำสั่งซื้อของฉัน'
                    }
                },
                // ประวัติเอกสาร
                {
                    path: 'doc-history',
                    name: 'doc-history',
                    component: () => import('@/views/pages/DocHistory.vue'),
                    meta: {
                        requiresAuth: true,
                        title: 'ประวัติเอกสาร'
                    }
                },
                // สถานะการจัดส่ง
                {
                    path: 'order-shipping-status',
                    name: 'order-shipping-status',
                    component: () => import('@/views/pages/OrderShippingStatus.vue'),
                    meta: {
                        requiresAuth: true,
                        title: 'สถานะการจัดส่ง'
                    }
                },
                // ประวัติการรับเงินล่วงหน้า
                {
                    path: 'advance-payment-history',
                    name: 'advance-payment-history',
                    component: () => import('@/views/pages/AdvancePayment.vue'),
                    meta: {
                        requiresAuth: true,
                        title: 'ประวัติการรับเงินล่วงหน้า'
                    }
                },
                {
                    path: 'profile',
                    name: 'customer-profile',
                    component: () => import('@/views/pages/CustomerProfile.vue'),
                    meta: {
                        requiresAuth: true,
                        title: 'โปรไฟล์'
                    }
                },
                {
                    path: 'admin',
                    name: 'admin-menu',
                    component: () => import('@/views/pages/admin/AdminMenu.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        title: 'จัดการหลังบ้าน'
                    }
                },
                {
                    path: 'admin/orders',
                    name: 'admin-orders',
                    component: () => import('@/views/pages/admin/AdminOrders.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.orders',
                        title: 'คำสั่งซื้อ'
                    }
                },
                {
                    path: 'admin/content',
                    name: 'admin-content',
                    component: () => import('@/views/pages/admin/AdminContent.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.content',
                        title: 'จัดการหน้าเว็บ'
                    }
                },
                {
                    path: 'admin/categories',
                    name: 'admin-categories',
                    component: () => import('@/views/pages/admin/AdminCategories.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.categories',
                        title: 'จัดการหมวดหมู่'
                    }
                },
                {
                    path: 'admin/customers',
                    name: 'admin-customers',
                    component: () => import('@/views/pages/admin/AdminCustomers.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.customers',
                        title: 'จัดการลูกค้า'
                    }
                },
                {
                    path: 'admin/reports',
                    name: 'admin-reports',
                    component: () => import('@/views/pages/admin/AdminReports.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.reports',
                        title: 'รายงาน'
                    }
                },
                {
                    path: 'admin/employees',
                    name: 'admin-employees',
                    component: () => import('@/views/pages/admin/AdminEmployees.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.employees',
                        title: 'จัดการพนักงาน'
                    }
                },
                {
                    path: 'admin/inventory',
                    name: 'admin-inventory',
                    component: () => import('@/views/pages/admin/AdminInventory.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.inventory',
                        title: 'คลังสินค้า'
                    }
                },
                {
                    path: 'admin/products',
                    name: 'admin-products',
                    component: () => import('@/views/pages/admin/AdminProducts.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.products',
                        title: 'จัดการสินค้า'
                    }
                },
                {
                    path: 'admin/product-import-export',
                    name: 'admin-product-import-export',
                    component: () => import('@/views/pages/admin/AdminProductImportExport.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.productImportExport',
                        title: 'Export / Import สินค้า'
                    }
                },
                {
                    path: 'admin/product-participation',
                    name: 'admin-product-participation',
                    component: () => import('@/views/pages/admin/AdminProductParticipation.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.productParticipation',
                        title: 'กำหนดสินค้าเข้าร่วม'
                    }
                },
                {
                    path: 'admin/sales-settings',
                    name: 'admin-sales-settings',
                    component: () => import('@/views/pages/admin/AdminSalesSettings.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.salesSettings',
                        title: 'จัดการตั้งค่าการขาย'
                    }
                },
                {
                    path: 'admin/sale-premium',
                    name: 'admin-sale-premium',
                    component: () => import('@/views/pages/admin/AdminSalePremium.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.salePremium',
                        title: 'จัดการโปรโมชันของแถม'
                    }
                },
                {
                    path: 'admin/products/:code',
                    name: 'admin-product-edit',
                    component: () => import('@/views/pages/admin/AdminProductEdit.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.products',
                        title: 'แก้ไขสินค้า'
                    }
                },
                {
                    path: 'admin/permissions',
                    name: 'admin-permissions',
                    component: () => import('@/views/pages/admin/AdminPermissions.vue'),
                    meta: {
                        requiresAuth: true,
                        requiresEmployee: true,
                        adminPermission: 'admin.permissions',
                        title: 'กำหนดสิทธิ์หลังบ้าน'
                    }
                }
            ]
        },
        {
            path: '/landing',
            redirect: '/'
        },
        {
            path: '/auth/login',
            name: 'login',
            component: () => import('@/views/pages/auth/Login.vue')
        },
        {
            path: '/auth/access',
            name: 'accessDenied',
            component: () => import('@/views/pages/auth/Access.vue')
        },
        {
            path: '/auth/error',
            name: 'error',
            component: () => import('@/views/pages/auth/Error.vue')
        },
        {
            path: '/:pathMatch(.*)*',
            redirect: (to) => ({ name: 'notfound', query: { from: to.fullPath } })
        }
    ]
});

// guard
router.beforeEach((to, from, next) => {
    const isAuthenticated = localStorage.getItem('_token');
    const userType = localStorage.getItem('_userType');

    if (to.meta.requiresAuth && !isAuthenticated) {
        const query = { redirect: to.fullPath };
        if (to.meta.requiresEmployee) {
            query.mode = 'employee';
        }
        next({ name: 'login', query });
    } else if (to.meta.requiresEmployee && userType !== 'employee') {
        next({ name: 'login', query: { mode: 'employee', redirect: to.fullPath } });
    } else if (to.meta.adminPermission && !canAccessAdminPermission(to.meta.adminPermission)) {
        next({ name: 'accessDenied' });
    } else {
        document.title = to.meta.title ? to.meta.title + ' - ' + import.meta.env.VITE_APP_NAME : import.meta.env.VITE_APP_NAME;
        next();
    }
});

export default router;
