import { beforeEach, describe, expect, it, vi } from 'vitest';

// REQ2 — เด้งออกเมื่อ idle 30 นาที และไม่ได้ติ๊กจำรหัสผู้ใช้
// ทดสอบ logic การตัดสินใจล้วน ไม่ mount component

const IDLE_LIMIT_MS = 30 * 60 * 1000;

// จำลอง localStorage
function createStorage(initial = {}) {
    const data = { ...initial };
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        _data: data
    };
}

// logic เดียวกับที่ useIdleLogout ใช้ตัดสิน
function shouldWatch(storage) {
    return !!storage.getItem('_token') && storage.getItem('_rememberMe') !== 'true';
}

function isIdleExpired(storage, nowMs, limitMs = IDLE_LIMIT_MS) {
    if (!shouldWatch(storage)) return false;
    const last = Number(storage.getItem('_lastActivityAt'));
    if (!Number.isFinite(last) || last <= 0) return false;
    return nowMs - last >= limitMs;
}

describe('เงื่อนไขการเฝ้าดู idle', () => {
    it('ไม่เฝ้าเมื่อยังไม่ล็อกอิน', () => {
        expect(shouldWatch(createStorage({}))).toBe(false);
    });

    it('เฝ้าเมื่อล็อกอินและไม่ได้ติ๊กจำรหัส', () => {
        expect(shouldWatch(createStorage({ _token: 'T' }))).toBe(true);
    });

    it('>>> ไม่เฝ้าเมื่อติ๊กจำรหัสผู้ใช้ไว้ในเครื่องนี้', () => {
        expect(shouldWatch(createStorage({ _token: 'T', _rememberMe: 'true' }))).toBe(false);
    });

    it('ค่า _rememberMe ที่ไม่ใช่ string "true" ถือว่าไม่ได้ติ๊ก', () => {
        expect(shouldWatch(createStorage({ _token: 'T', _rememberMe: 'false' }))).toBe(true);
        expect(shouldWatch(createStorage({ _token: 'T', _rememberMe: '1' }))).toBe(true);
    });
});

describe('การตัดสินว่าหมดเวลา idle', () => {
    const T0 = 1_700_000_000_000;

    it('ยังไม่ครบ 30 นาที → ไม่เด้ง', () => {
        const s = createStorage({ _token: 'T', _lastActivityAt: String(T0) });
        expect(isIdleExpired(s, T0 + 29 * 60 * 1000)).toBe(false);
    });

    it('ครบ 30 นาทีพอดี → เด้ง', () => {
        const s = createStorage({ _token: 'T', _lastActivityAt: String(T0) });
        expect(isIdleExpired(s, T0 + IDLE_LIMIT_MS)).toBe(true);
    });

    it('เกิน 30 นาที → เด้ง', () => {
        const s = createStorage({ _token: 'T', _lastActivityAt: String(T0) });
        expect(isIdleExpired(s, T0 + 45 * 60 * 1000)).toBe(true);
    });

    it('>>> ติ๊กจำรหัสไว้ ต่อให้ทิ้งไว้ 10 ชั่วโมงก็ไม่เด้ง', () => {
        const s = createStorage({ _token: 'T', _rememberMe: 'true', _lastActivityAt: String(T0) });
        expect(isIdleExpired(s, T0 + 10 * 60 * 60 * 1000)).toBe(false);
    });

    it('ยังไม่มีบันทึก activity → ไม่เด้ง (รอ mark ครั้งแรก)', () => {
        const s = createStorage({ _token: 'T' });
        expect(isIdleExpired(s, T0)).toBe(false);
    });

    it('ค่า activity เสีย → ไม่เด้ง', () => {
        const s = createStorage({ _token: 'T', _lastActivityAt: 'abc' });
        expect(isIdleExpired(s, T0)).toBe(false);
    });

    it('มี activity ใหม่เข้ามา → รีเซ็ตการนับ', () => {
        const s = createStorage({ _token: 'T', _lastActivityAt: String(T0) });
        expect(isIdleExpired(s, T0 + 29 * 60 * 1000)).toBe(false);
        s.setItem('_lastActivityAt', String(T0 + 29 * 60 * 1000));
        // อีก 29 นาทีถัดมา นับจาก activity ล่าสุด ยังไม่ครบ
        expect(isIdleExpired(s, T0 + 58 * 60 * 1000)).toBe(false);
    });
});

describe('throttle การเขียน activity', () => {
    it('เขียนอย่างมากทุก 10 วินาที', () => {
        const WRITE_THROTTLE_MS = 10 * 1000;
        const T0 = 1_700_000_000_000; // epoch จริง — ค่าเริ่มต้น lastWriteAt=0 จึงยอมให้เขียนครั้งแรกเสมอ
        let lastWriteAt = 0;
        const writes = [];
        const touch = (t) => {
            if (t - lastWriteAt < WRITE_THROTTLE_MS) return;
            lastWriteAt = t;
            writes.push(t);
        };
        // event แรกเขียนทันที
        touch(T0);
        expect(writes).toHaveLength(1);
        // ยิงอีก 100 event ภายใน 10 วินาที ต้องไม่เขียนเพิ่ม
        for (let i = 1; i < 100; i++) touch(T0 + i * 100);
        expect(writes).toHaveLength(1);
        // พ้น 10 วินาทีแล้วจึงเขียนได้อีกครั้ง
        touch(T0 + 11_000);
        expect(writes).toHaveLength(2);
    });
});
