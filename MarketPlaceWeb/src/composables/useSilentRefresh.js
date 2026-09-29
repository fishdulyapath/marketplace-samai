import { onBeforeUnmount, ref } from 'vue';

// รีเฟรชข้อมูลเบื้องหลังทุก 5 นาที โดยไม่ให้ผู้ใช้รู้สึกว่าจอกำลังโหลดใหม่ (REQ1)
//
// เริ่มนับหลังเปิด dialog/หน้าจอ · หยุดเมื่อปิดหรือ unmount
// หยุดชั่วคราวเมื่อแท็บถูกซ่อน แล้วรีเฟรชทันทีเมื่อกลับมาถ้าเลยกำหนดแล้ว
//
// ผู้เรียกต้องส่ง callback ที่ "merge เฉพาะฟิลด์ที่เปลี่ยน" ไม่ใช่ replace ข้อมูลทั้งก้อน
// และห้ามใช้ flag loading เดิมที่บล็อก UI ไม่งั้นจอจะกระพริบ

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export function useSilentRefresh(refreshFn, options = {}) {
    const intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;

    const isRefreshing = ref(false);
    let timer = null;
    let lastRunAt = 0;
    let listening = false;

    async function runOnce() {
        // กันซ้อน: ถ้ารอบก่อนยังไม่เสร็จ ข้ามรอบนี้ไป
        if (isRefreshing.value) return;
        isRefreshing.value = true;
        try {
            await refreshFn();
            lastRunAt = Date.now();
        } catch (error) {
            // เงียบโดยตั้งใจ — ผู้ใช้ไม่ได้ร้องขอ ไม่ควรเด้ง error ใส่หน้าจอ
            console.warn('silent refresh failed:', error?.message || error);
        } finally {
            isRefreshing.value = false;
        }
    }

    function onVisibilityChange() {
        if (document.visibilityState !== 'visible') return;
        // กลับมาจากการซ่อนแท็บ — ถ้าเลยกำหนดแล้วให้รีเฟรชทันที ไม่ต้องรอครบรอบใหม่
        if (lastRunAt && Date.now() - lastRunAt >= intervalMs) runOnce();
    }

    function start() {
        stop();
        lastRunAt = Date.now();
        timer = setInterval(() => {
            if (document.visibilityState === 'hidden') return; // ประหยัด API ตอนไม่ได้ดูอยู่
            runOnce();
        }, intervalMs);

        if (!listening) {
            document.addEventListener('visibilitychange', onVisibilityChange);
            listening = true;
        }
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (listening) {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            listening = false;
        }
    }

    onBeforeUnmount(stop);

    return { start, stop, runOnce, isRefreshing };
}
