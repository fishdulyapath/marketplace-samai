import { describe, expect, it } from 'vitest';
import { PREORDER_REMARK, getPreorderSplit, getReadyQty, isPreorderAllowed, splitItemsForPreorder, toOrderQty, toStockQty } from '@/utils/preorderSplit';

// Characterization test — บันทึกพฤติกรรม "ปัจจุบัน" ของการแยกเอกสารพรีออเดอร์
// จุดนี้เสี่ยงที่สุดเรื่องการปัดเศษ: ยอดของ 2 เอกสารต้องรวมกันได้เท่าต้นฉบับเสมอ

describe('toOrderQty / toStockQty', () => {
    it('จำนวนสั่งซื้อถูกตัดเศษทิ้งและไม่ติดลบ', () => {
        expect(toOrderQty(3.9)).toBe(3);
        expect(toOrderQty('2,000')).toBe(2000);
        expect(toOrderQty(-5)).toBe(0);
        expect(toOrderQty('abc')).toBe(0);
    });

    it('สต็อกที่อ่านไม่ได้คืน null (ไม่ใช่ 0)', () => {
        expect(toStockQty('abc')).toBe(null);
        expect(toStockQty(undefined)).toBe(null);
        expect(toStockQty(4.7)).toBe(4);
        expect(toStockQty(-3)).toBe(0);
    });
});

describe('getReadyQty', () => {
    it('จำกัดด้วยสต็อกที่มี', () => {
        expect(getReadyQty({ qty: 10, balance_qty: 4 })).toBe(4);
        expect(getReadyQty({ qty: 3, balance_qty: 10 })).toBe(3);
    });

    it('ถ้าอ่าน balance_qty ไม่ได้ ถือว่ามีของครบ (default แบบผ่อนปรน)', () => {
        expect(getReadyQty({ qty: 10 })).toBe(10);
        expect(getReadyQty({ qty: 10, balance_qty: 'N/A' })).toBe(10);
    });
});

describe('isPreorderAllowed — รับได้หลายรูปแบบ', () => {
    it.each([true, 1, '1', 'true', 'YES', 'y', 'enabled', 'allow'])('อนุญาตเมื่อค่าเป็น %s', (value) => {
        expect(isPreorderAllowed({ preorder_allowed: value })).toBe(true);
    });

    it.each([false, 0, '0', 'no', '', undefined])('ไม่อนุญาตเมื่อค่าเป็น %s', (value) => {
        expect(isPreorderAllowed({ preorder_allowed: value })).toBe(false);
    });

    it('อ่านได้จากทั้ง 3 ชื่อฟิลด์', () => {
        expect(isPreorderAllowed({ preorderAllowed: '1' })).toBe(true);
        expect(isPreorderAllowed({ allow_preorder: '1' })).toBe(true);
    });
});

describe('getPreorderSplit', () => {
    it('ของครบ ไม่ต้องแยก', () => {
        expect(getPreorderSplit({ qty: 5, balance_qty: 10, preorder_allowed: '1' })).toMatchObject({
            totalQty: 5,
            readyQty: 5,
            shortageQty: 0,
            preorderQty: 0,
            hasPreorder: false,
            isBlockedByPreorderSetting: false
        });
    });

    it('ของขาดและอนุญาตพรีออเดอร์ → แยกได้', () => {
        expect(getPreorderSplit({ qty: 10, balance_qty: 4, preorder_allowed: '1' })).toMatchObject({
            readyQty: 4,
            shortageQty: 6,
            preorderQty: 6,
            hasPreorder: true,
            isBlockedByPreorderSetting: false
        });
    });

    it('ของขาดแต่ไม่อนุญาตพรีออเดอร์ → ถูกบล็อกไม่ให้ checkout', () => {
        expect(getPreorderSplit({ qty: 10, balance_qty: 4, preorder_allowed: '0' })).toMatchObject({
            readyQty: 4,
            shortageQty: 6,
            preorderQty: 0,
            hasPreorder: false,
            isBlockedByPreorderSetting: true
        });
    });
});

describe('โปรโมชันของแถม (item_type=4) ต้องย้ายทั้งชุด ห้ามแยกบางส่วน', () => {
    it('สต๊อกไม่พอและไม่เปิด Preorder ต้องบล็อกทั้งชุด', () => {
        const split = getPreorderSplit({ item_type: '4', qty: 3, balance_qty: 0, preorder_allowed: '0' });
        expect(split.readyQty).toBe(0);
        expect(split.preorderQty).toBe(0);
        expect(split.hasPreorder).toBe(false);
        expect(split.isBlockedByPreorderSetting).toBe(true);
    });

    it('ดูจาก sale_premium_code ได้และย้ายจำนวนทั้งหมดไป Preorder', () => {
        const split = getPreorderSplit({ sale_premium_code: 'PROMO1', qty: 2, balance_qty: 1, preorder_allowed: '1' });
        expect(split.isBlockedByPreorderSetting).toBe(false);
        expect(split.readyQty).toBe(0);
        expect(split.preorderQty).toBe(2);
        expect(split.hasPreorder).toBe(true);
    });

    it('splitItemsForPreorder จับโปรโมชั่นทั้งบรรทัดลงเอกสาร Preorder', () => {
        const { readyItems, preorderItems } = splitItemsForPreorder([
            { item_type: '4', sale_premium_code: 'PROMO1', qty: 2, price: 50, balance_qty: 0, preorder_allowed: '1' }
        ]);
        expect(readyItems).toHaveLength(0);
        expect(preorderItems).toHaveLength(1);
        expect(preorderItems[0]).toMatchObject({ qty: 2, sum_amount: 100, remark: PREORDER_REMARK });
    });

    it('ถ้ามีครบต้องอยู่ใบพร้อมส่งทั้งชุด', () => {
        const split = getPreorderSplit({ item_type: '4', qty: 2, balance_qty: 2, preorder_allowed: '1' });
        expect(split).toMatchObject({ readyQty: 2, preorderQty: 0, shortageQty: 0, hasPreorder: false });
    });
});

describe('splitItemsForPreorder', () => {
    it('ของครบทั้งหมด → มีแต่เอกสารพร้อมส่ง', () => {
        const result = splitItemsForPreorder([{ item_code: 'A', qty: 5, price: 10, balance_qty: 10, preorder_allowed: '1' }]);
        expect(result.hasReadyItems).toBe(true);
        expect(result.hasPreorderItems).toBe(false);
        expect(result.readyItems[0].qty).toBe(5);
        expect(result.readyItems[0].sum_amount).toBe(50);
    });

    it('ของขาดทั้งหมด (สต็อก 0) → มีแต่เอกสารพรีออเดอร์ พร้อม remark', () => {
        const result = splitItemsForPreorder([{ item_code: 'A', qty: 5, price: 10, balance_qty: 0, preorder_allowed: '1' }]);
        expect(result.hasReadyItems).toBe(false);
        expect(result.preorderItems[0].qty).toBe(5);
        expect(result.preorderItems[0].remark).toBe(PREORDER_REMARK);
    });

    it('แยกครึ่ง → ยอดของ 2 เอกสารรวมกันเท่าต้นฉบับพอดี', () => {
        const items = [{ item_code: 'A', qty: 10, price: 10, sum_amount: 100, discount_amount: 20, balance_qty: 4, preorder_allowed: '1' }];
        const { readyItems, preorderItems } = splitItemsForPreorder(items);

        expect(readyItems[0].qty).toBe(4);
        expect(preorderItems[0].qty).toBe(6);
        expect(readyItems[0].sum_amount).toBe(40);
        expect(preorderItems[0].sum_amount).toBe(60);
        expect(readyItems[0].sum_amount + preorderItems[0].sum_amount).toBe(100);
        expect(readyItems[0].discount_amount + preorderItems[0].discount_amount).toBe(20);
    });

    it('ยอดที่หารไม่ลงตัว — ส่วนพรีออเดอร์รับเศษไป ผลรวมยังเท่าเดิม', () => {
        // 100 / 3 = 33.333… → ready(1) = 33.33, preorder(2) ต้องได้ 66.67 พอดี
        const items = [{ item_code: 'A', qty: 3, price: 33.34, sum_amount: 100, discount_amount: 10, balance_qty: 1, preorder_allowed: '1' }];
        const { readyItems, preorderItems } = splitItemsForPreorder(items);

        expect(readyItems[0].sum_amount).toBe(33.33);
        expect(preorderItems[0].sum_amount).toBe(66.67);
        expect(readyItems[0].sum_amount + preorderItems[0].sum_amount).toBe(100);

        expect(readyItems[0].discount_amount).toBe(3.33);
        expect(preorderItems[0].discount_amount).toBe(6.67);
        expect(readyItems[0].discount_amount + preorderItems[0].discount_amount).toBe(10);
    });

    it('ใช้ price_confirm ก่อน price เมื่อไม่มี sum_amount', () => {
        const items = [{ item_code: 'A', qty: 4, price: 10, price_confirm: 25, balance_qty: 2, preorder_allowed: '1' }];
        const { readyItems, preorderItems } = splitItemsForPreorder(items);
        expect(readyItems[0].sum_amount).toBe(50);
        expect(preorderItems[0].sum_amount).toBe(50);
    });

    it('ไม่เติม PREORDER ซ้ำถ้า remark มีอยู่แล้ว', () => {
        const items = [{ item_code: 'A', qty: 5, price: 10, balance_qty: 0, preorder_allowed: '1', remark: 'PREORDER ด่วน' }];
        const { preorderItems } = splitItemsForPreorder(items);
        expect(preorderItems[0].remark).toBe('PREORDER ด่วน');
    });

    it('สินค้าที่ถูกบล็อก (ของขาด + ไม่อนุญาตพรีออเดอร์) ลงเฉพาะเอกสารพร้อมส่ง ส่วนที่ขาดหายไปเงียบๆ', () => {
        const items = [{ item_code: 'A', qty: 10, price: 10, balance_qty: 4, preorder_allowed: '0' }];
        const { readyItems, preorderItems } = splitItemsForPreorder(items);
        // หมายเหตุ: ฟังก์ชันนี้ไม่ throw — ผู้เรียกต้องเช็ค isBlockedByPreorderSetting เอง
        expect(readyItems[0].qty).toBe(4);
        expect(preorderItems).toHaveLength(0);
    });
});
