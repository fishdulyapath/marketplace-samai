import { describe, expect, it } from 'vitest';

// สำเนาตรรกะจาก AppLayout.vue — ตัว component เป็น SFC ที่ import ไม่ได้ในเทสต์ชุดนี้
// (ไม่มี jsdom/PrimeVue setup) จึงทดสอบกฎการตัดสินใจแทน ถ้าแก้ที่ไฟล์นั้นต้องแก้ที่นี่ด้วย
const WCAG_AA_NORMAL_TEXT = 4.5;
const isColor = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || ''));
const hexToRgb = (hex) => {
    const h = String(hex).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const relativeLuminance = ([r, g, b]) => {
    const ch = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const contrastRatio = (a, b) => {
    const l1 = relativeLuminance(a);
    const l2 = relativeLuminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const TEXT_CANDIDATES = ['#111827', '#FFFFFF', '#000000'];
function readableTextOn(background, preferred) {
    if (!isColor(background)) return preferred;
    const bg = hexToRgb(background);
    const candidates = [preferred, ...TEXT_CANDIDATES].filter(isColor);
    const scored = candidates.map((color) => ({ color, ratio: contrastRatio(hexToRgb(color), bg) }));
    const firstPassing = scored.find((c) => c.ratio >= WCAG_AA_NORMAL_TEXT);
    if (firstPassing) return firstPassing.color;
    return scored.reduce((best, c) => (c.ratio > best.ratio ? c : best)).color;
}

const ratioOf = (fg, bg) => contrastRatio(hexToRgb(fg), hexToRgb(bg));

describe('readableTextOn — ข้อความบนแถบหัวต้องอ่านออกเสมอ', () => {
    it('คู่สีที่ผ่านเกณฑ์อยู่แล้ว = ใช้ค่าที่แอดมินตั้งไว้', () => {
        expect(readableTextOn('#0A7D56', '#FFFFFF')).toBe('#FFFFFF');
        expect(readableTextOn('#FAF5FF', '#3B0764')).toBe('#3B0764');
    });

    it('ขาวบนขาว = สลับเป็นตัวอักษรเข้ม', () => {
        expect(readableTextOn('#FFFFFF', '#FFFFFF')).toBe('#111827');
    });

    it('ดำบนดำ = สลับเป็นตัวอักษรขาว', () => {
        expect(readableTextOn('#111111', '#000000')).toBe('#FFFFFF');
    });

    it('พื้นโทนกลาง (ส้ม) เลือกตัวอักษรเข้ม ไม่ใช่ขาว', () => {
        // ความสว่างของ #F97316 = 0.40 ซึ่ง "ดูเข้ม" แต่ขาวบนส้มได้แค่ 2.80
        expect(ratioOf('#FFFFFF', '#F97316')).toBeLessThan(4.5);
        expect(readableTextOn('#F97316', '#FFFFFF')).toBe('#111827');
    });

    it('สีแบรนด์เขียวบนหัวเขียว (เคสจริงที่ทำให้ชื่อร้านอ่านไม่ออก) = ถูกสลับ', () => {
        // #0F9F6E บน #0A7D56 วัดได้ 1.52 ซึ่งต่ำกว่าเกณฑ์มาก
        expect(ratioOf('#0F9F6E', '#0A7D56')).toBeLessThan(2);
        expect(readableTextOn('#0A7D56', '#0F9F6E')).toBe('#FFFFFF');
    });

    it('ผลลัพธ์ที่คืนออกมาผ่านเกณฑ์ AA เสมอ ไม่ว่าจะป้อนอะไรเข้าไป', () => {
        const backgrounds = ['#FFFFFF', '#000000', '#0A7D56', '#FAF5FF', '#7C3AED', '#F97316', '#808080', '#F4F6F8'];
        const preferred = ['#FFFFFF', '#000000', '#0F9F6E', '#CCCCCC', '#808080'];
        for (const bg of backgrounds) {
            for (const fg of preferred) {
                const chosen = readableTextOn(bg, fg);
                expect(ratioOf(chosen, bg), `${fg} บน ${bg} → ${chosen}`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('ค่าพื้นหลังที่ไม่ใช่สี = คืนค่าที่ส่งมาเฉยๆ ไม่ตัดสินใจแทน', () => {
        expect(readableTextOn('', '#ABCDEF')).toBe('#ABCDEF');
        expect(readableTextOn(undefined, '#ABCDEF')).toBe('#ABCDEF');
    });
});
