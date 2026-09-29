import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// REQ1 — รีเฟรชเบื้องหลังทุก 5 นาที โดยไม่บล็อก UI
// ทดสอบ logic ของ timer/visibility ด้วย fake timer (ไม่ mount component)

const INTERVAL = 5 * 60 * 1000;

// จำลอง useSilentRefresh โดยไม่พึ่ง lifecycle ของ Vue
function createRefresher(refreshFn, { intervalMs = INTERVAL, getVisibility = () => 'visible' } = {}) {
    let timer = null;
    let lastRunAt = 0;
    let running = false;

    async function runOnce() {
        if (running) return;
        running = true;
        try {
            await refreshFn();
            lastRunAt = Date.now();
        } catch {
            // เงียบโดยตั้งใจ
        } finally {
            running = false;
        }
    }

    function start() {
        stop();
        lastRunAt = Date.now();
        timer = setInterval(() => {
            if (getVisibility() === 'hidden') return;
            runOnce();
        }, intervalMs);
    }

    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    function onVisible() {
        if (lastRunAt && Date.now() - lastRunAt >= intervalMs) runOnce();
    }

    return { start, stop, runOnce, onVisible };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('รอบการรีเฟรช', () => {
    it('ไม่ยิงทันทีตอน start — เริ่มนับหลังเปิดจอ', () => {
        const fn = vi.fn();
        createRefresher(fn).start();
        expect(fn).not.toHaveBeenCalled();
    });

    it('ยิงครั้งแรกเมื่อครบ 5 นาที', async () => {
        const fn = vi.fn();
        createRefresher(fn).start();
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('ยิงซ้ำทุก 5 นาที', async () => {
        const fn = vi.fn();
        createRefresher(fn).start();
        await vi.advanceTimersByTimeAsync(INTERVAL * 3);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('ยังไม่ครบ 5 นาที ไม่ยิง', async () => {
        const fn = vi.fn();
        createRefresher(fn).start();
        await vi.advanceTimersByTimeAsync(INTERVAL - 1000);
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('การหยุด timer', () => {
    it('>>> stop แล้วต้องไม่ยิงอีก (กันยิง API ทิ้งไว้หลังปิด dialog)', async () => {
        const fn = vi.fn();
        const r = createRefresher(fn);
        r.start();
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fn).toHaveBeenCalledTimes(1);

        r.stop();
        await vi.advanceTimersByTimeAsync(INTERVAL * 5);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('start ซ้ำไม่ทำให้เกิด timer ซ้อน', async () => {
        const fn = vi.fn();
        const r = createRefresher(fn);
        r.start();
        r.start();
        r.start();
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('พฤติกรรมตามการมองเห็นแท็บ', () => {
    it('แท็บถูกซ่อน → ข้ามรอบนั้น ประหยัด API', async () => {
        const fn = vi.fn();
        createRefresher(fn, { getVisibility: () => 'hidden' }).start();
        await vi.advanceTimersByTimeAsync(INTERVAL * 3);
        expect(fn).not.toHaveBeenCalled();
    });

    it('กลับมาดูแท็บหลังเลยกำหนด → รีเฟรชทันที ไม่ต้องรอครบรอบใหม่', async () => {
        const fn = vi.fn();
        const r = createRefresher(fn, { getVisibility: () => 'hidden' });
        r.start();
        await vi.advanceTimersByTimeAsync(INTERVAL * 2);
        expect(fn).not.toHaveBeenCalled();

        await r.onVisible();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('กลับมาดูแท็บก่อนครบกำหนด → ยังไม่รีเฟรช', async () => {
        const fn = vi.fn();
        const r = createRefresher(fn, { getVisibility: () => 'hidden' });
        r.start();
        await vi.advanceTimersByTimeAsync(INTERVAL / 2);
        await r.onVisible();
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('กันการยิงซ้อน', () => {
    it('รอบก่อนยังไม่เสร็จ รอบถัดไปถูกข้าม', async () => {
        let resolveFirst;
        const fn = vi.fn(() => new Promise((res) => { resolveFirst = res; }));
        const r = createRefresher(fn);
        r.start();

        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fn).toHaveBeenCalledTimes(1);

        // รอบที่ 2 มาถึงขณะรอบแรกยังค้าง → ต้องไม่เรียกซ้ำ
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fn).toHaveBeenCalledTimes(1);

        resolveFirst();
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('refreshFn โยน error แล้วรอบถัดไปยังทำงานต่อได้', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValue(undefined);
        const r = createRefresher(fn);
        r.start();

        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('การ merge เฉพาะฟิลด์ที่เปลี่ยน (ไม่ replace ทั้งก้อน)', () => {
    const REFRESHABLE = ['balance_qty', 'sold_out', 'price', 'is_promotion'];

    function mergeRefreshableFields(target, source) {
        if (!target || !source) return;
        for (const key of REFRESHABLE) {
            if (source[key] !== undefined) target[key] = source[key];
        }
    }

    it('อัปเดตสต็อก/ราคา แต่ไม่แตะฟิลด์อื่น', () => {
        const product = { code: 'A', name: 'สินค้า', images: ['img1'], balance_qty: 10, price: 100 };
        mergeRefreshableFields(product, { balance_qty: 3, price: 120, name: 'ชื่อใหม่', images: [] });

        expect(product.balance_qty).toBe(3);
        expect(product.price).toBe(120);
        // ฟิลด์ที่ไม่อยู่ในรายการต้องไม่ถูกแตะ ไม่งั้นรูปจะกระพริบ
        expect(product.name).toBe('สินค้า');
        expect(product.images).toEqual(['img1']);
    });

    it('รักษา object reference เดิม (reactivity ไม่ขาด)', () => {
        const product = { balance_qty: 10 };
        const ref = product;
        mergeRefreshableFields(product, { balance_qty: 5 });
        expect(product).toBe(ref);
        expect(product.balance_qty).toBe(5);
    });

    it('source ไม่มีค่าฟิลด์นั้น → คงค่าเดิม', () => {
        const product = { balance_qty: 10, price: 100 };
        mergeRefreshableFields(product, { balance_qty: 4 });
        expect(product.price).toBe(100);
    });

    it('จับคู่หน่วยด้วย unit_code ไม่ใช่ลำดับ', () => {
        const units = [
            { unit_code: 'ชิ้น', balance_qty: 10 },
            { unit_code: 'ลัง', balance_qty: 2 }
        ];
        // ฝั่ง server ส่งมาสลับลำดับ
        const fresh = [
            { unit_code: 'ลัง', balance_qty: 1 },
            { unit_code: 'ชิ้น', balance_qty: 7 }
        ];
        const byUnit = new Map(fresh.map((u) => [u.unit_code, u]));
        for (const u of units) mergeRefreshableFields(u, byUnit.get(u.unit_code));

        expect(units[0]).toMatchObject({ unit_code: 'ชิ้น', balance_qty: 7 });
        expect(units[1]).toMatchObject({ unit_code: 'ลัง', balance_qty: 1 });
    });
});
