import axios from 'axios';

// ── client กลางสำหรับเรียก API ทั้งหมด ───────────────────────────────────
//
// เดิมแต่ละ service สร้าง axios.create() ของตัวเอง (21 ที่) ไม่มีที่กลางให้ใส่ header
// จึงไม่มี service ไหนส่ง token เลย — server ก็เลยไม่มีทางรู้ว่าใครเป็นใคร
//
// ไฟล์นี้เคยมีโค้ดแบบเดียวกันอยู่แล้วแต่ไม่มีใคร import ไปใช้ (ค้างจากเทมเพลต)
// ตอนนี้ทำให้เป็นตัวจริงที่ทุก service เรียกผ่าน
//
// ⚠️ อ่าน token จาก localStorage ใน interceptor ทุกครั้ง ไม่ใช่ตอนสร้าง instance
//    เพราะ token เปลี่ยนได้ระหว่าง session (ล็อกอิน/ออก/สลับผู้ใช้) ถ้าผูกตอนสร้าง
//    จะค้างเป็นค่าเก่าไปตลอดอายุของหน้า

const AUTH_KEYS = ['_token', '_userType', '_userCode', '_userData', '_empData', '_empCode', '_contactCode'];

// กันการเด้งซ้ำเมื่อหลาย request พัง 401 พร้อมกัน
let redirecting = false;

function handleUnauthorized() {
    if (redirecting) return;
    redirecting = true;

    AUTH_KEYS.forEach((key) => localStorage.removeItem(key));

    // ไม่ import authen store ตรงๆ เพราะ store import service กลับมา จะกลายเป็น circular import
    const target = '/auth/login';
    if (window.location.pathname !== target) {
        window.location.assign(target);
    } else {
        redirecting = false;
    }
}

/**
 * สร้าง axios instance ที่แนบ token และจัดการ 401 ให้อัตโนมัติ
 * @param {object} overrides ค่า config เฉพาะของแต่ละ service (เช่น timeout)
 */
export function createApiClient(overrides = {}) {
    const client = axios.create({
        baseURL: import.meta.env.VITE_APP_API,
        ...overrides,
        headers: {
            'Content-Type': 'application/json',
            ...(overrides.headers || {})
        }
    });

    client.interceptors.request.use((config) => {
        const token = localStorage.getItem('_token');
        if (token) {
            config.headers = config.headers || {};
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    });

    client.interceptors.response.use(
        (response) => response,
        (error) => {
            // token หมดอายุหรือถูกปฏิเสธ → เคลียร์ session แล้วให้ล็อกอินใหม่
            // 403 ไม่เด้งออก เพราะแปลว่า "ล็อกอินแล้วแต่ไม่มีสิทธิ์" ซึ่งหน้าจอควรแสดงข้อความเอง
            if (error?.response?.status === 401) handleUnauthorized();
            return Promise.reject(error);
        }
    );

    return client;
}

// instance กลางสำหรับที่ที่ไม่ต้องการ config พิเศษ
const apiClient = createApiClient();

export default apiClient;
