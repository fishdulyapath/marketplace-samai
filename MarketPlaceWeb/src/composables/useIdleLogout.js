import { useAuthenStore } from '@/stores/authen';
import { onBeforeUnmount, onMounted } from 'vue';

// เด้งออกจากระบบเมื่อไม่มีการใช้งาน 30 นาที (REQ2)
//
// เงื่อนไข: ล็อกอินอยู่ + ไม่ได้ติ๊ก "จำรหัสผู้ใช้ไว้ในเครื่องนี้" (_rememberMe)
//
// ใช้ client clock ได้เพราะวัด "ช่วงเวลา" (delta) ไม่ใช่เวลาสัมบูรณ์ — นาฬิกาเพี้ยนก็หักล้างกันเอง
// และนี่เป็น UX ไม่ใช่ security boundary (backend ยังไม่มี session จริง)

const IDLE_LIMIT_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
// ไม่เขียน localStorage ทุก event — throttle ลดการเขียนลง
const WRITE_THROTTLE_MS = 10 * 1000;

const ACTIVITY_KEY = '_lastActivityAt';
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

function now() {
    return Date.now();
}

function readLastActivity() {
    const raw = Number(localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function isRemembered() {
    return localStorage.getItem('_rememberMe') === 'true';
}

export function markActivity() {
    localStorage.setItem(ACTIVITY_KEY, String(now()));
}

export function clearActivity() {
    localStorage.removeItem(ACTIVITY_KEY);
}

export function useIdleLogout(options = {}) {
    const idleLimitMs = options.idleLimitMs || IDLE_LIMIT_MS;
    const authenStore = useAuthenStore();

    let timer = null;
    let lastWriteAt = 0;

    function touch() {
        // throttle: เขียนอย่างมากทุก 10 วินาที
        const t = now();
        if (t - lastWriteAt < WRITE_THROTTLE_MS) return;
        lastWriteAt = t;
        localStorage.setItem(ACTIVITY_KEY, String(t));
    }

    function shouldWatch() {
        return !!localStorage.getItem('_token') && !isRemembered();
    }

    function checkIdle() {
        if (!shouldWatch()) return;

        const last = readLastActivity();
        if (!last) {
            // ยังไม่เคยบันทึก — เริ่มนับจากตอนนี้
            markActivity();
            return;
        }

        if (now() - last >= idleLimitMs) {
            clearActivity();
            // logout() เคลียร์ state + localStorage แล้ว router.replace('/auth/login') ให้เอง
            authenStore.logout();
        }
    }

    function onVisibilityChange() {
        if (document.visibilityState === 'visible') {
            // กลับมาจากการ sleep/สลับแท็บ — ตรวจทันที ไม่รอ interval
            checkIdle();
        }
    }

    function onStorage(event) {
        // แท็บอื่นบันทึก activity → sync เวลาข้ามแท็บโดยไม่ต้องมี infra เพิ่ม
        if (event.key === ACTIVITY_KEY) lastWriteAt = now();
    }

    onMounted(() => {
        if (localStorage.getItem('_token')) markActivity();

        ACTIVITY_EVENTS.forEach((name) => {
            window.addEventListener(name, touch, { passive: true });
        });
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('storage', onStorage);

        timer = setInterval(checkIdle, CHECK_INTERVAL_MS);
    });

    onBeforeUnmount(() => {
        ACTIVITY_EVENTS.forEach((name) => {
            window.removeEventListener(name, touch);
        });
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('storage', onStorage);
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    });

    return { markActivity, clearActivity, checkIdle };
}
