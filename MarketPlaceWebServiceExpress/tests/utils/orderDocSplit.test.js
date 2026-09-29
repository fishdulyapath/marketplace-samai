const { splitItemsIntoDocuments, countLines } = require('../../src/utils/orderDocSplit');

// REQ4 — แบ่งเอกสารเมื่อเกิน 8 บรรทัด โดยกลุ่มที่ผูกกันห้ามหลุดคนละใบ

const normal = (code) => ({ item_code: code, item_type: '0' });
const set = (code, subCount) => ({
  item_code: code,
  item_type: '3',
  sub_item: Array.from({ length: subCount }, (_, i) => ({ item_code: `${code}-S${i}` })),
});
// จำลองผลลัพธ์จาก expandOrderItems: ของแถม 1 รายการ → หลายบรรทัดที่มี __group_id เดียวกัน
const premium = (groupId, paidCount, freeCount) => [
  ...Array.from({ length: paidCount }, (_, i) => ({ item_code: `${groupId}-P${i}`, item_type: '0', __group_id: groupId, is_permium: 0 })),
  ...Array.from({ length: freeCount }, (_, i) => ({ item_code: `${groupId}-F${i}`, item_type: '0', __group_id: groupId, is_permium: 1 })),
];

const totalLines = (docs) => docs.reduce((sum, d) => sum + d.lineCount, 0);

describe('countLines', () => {
  it('สินค้าปกติ = 1 บรรทัด', () => {
    expect(countLines(normal('A'))).toBe(1);
  });

  it('ชุดสินค้า = หัวชุด + จำนวนสินค้าย่อย', () => {
    expect(countLines(set('SET1', 3))).toBe(4);
  });

  it('ชุดที่ไม่มี sub_item = 1', () => {
    expect(countLines({ item_code: 'S', item_type: '3' })).toBe(1);
  });
});

describe('การแบ่งตามจำนวนบรรทัด', () => {
  it('8 บรรทัดพอดี = 1 ใบ', () => {
    const docs = splitItemsIntoDocuments(Array.from({ length: 8 }, (_, i) => normal(`A${i}`)), 8);
    expect(docs).toHaveLength(1);
    expect(docs[0].lineCount).toBe(8);
  });

  it('>>> 9 บรรทัด = 2 ใบ', () => {
    const docs = splitItemsIntoDocuments(Array.from({ length: 9 }, (_, i) => normal(`A${i}`)), 8);
    expect(docs).toHaveLength(2);
    expect(docs[0].lineCount).toBe(8);
    expect(docs[1].lineCount).toBe(1);
  });

  it('>>> 32 บรรทัด = 4 ใบ (ตามตัวอย่างในโจทย์)', () => {
    const docs = splitItemsIntoDocuments(Array.from({ length: 32 }, (_, i) => normal(`A${i}`)), 8);
    expect(docs).toHaveLength(4);
    expect(docs.every((d) => d.lineCount === 8)).toBe(true);
  });

  it('ผลรวมบรรทัดทุกใบเท่าต้นฉบับเสมอ', () => {
    const items = Array.from({ length: 20 }, (_, i) => normal(`A${i}`));
    expect(totalLines(splitItemsIntoDocuments(items, 8))).toBe(20);
  });

  it('ลำดับสินค้าไม่สลับ', () => {
    const items = Array.from({ length: 10 }, (_, i) => normal(`A${i}`));
    const docs = splitItemsIntoDocuments(items, 8);
    const flat = docs.flatMap((d) => d.items.map((it) => it.item_code));
    expect(flat).toEqual(items.map((it) => it.item_code));
  });
});

describe('🚨 ชุดสินค้าห้ามข้ามใบ', () => {
  it('ชุด 3 ชิ้น (4 บรรทัด) ที่ใส่ไม่ลงใบแรก ย้ายไปทั้งชุด', () => {
    // 6 สินค้าปกติ + ชุด 4 บรรทัด = 10 บรรทัด
    const items = [...Array.from({ length: 6 }, (_, i) => normal(`A${i}`)), set('SET1', 3)];
    const docs = splitItemsIntoDocuments(items, 8);

    expect(docs).toHaveLength(2);
    expect(docs[0].lineCount).toBe(6);
    // ชุดทั้งก้อนต้องอยู่ใบเดียวกัน ไม่ใช่ตัดหัวชุดไว้ใบแรก
    expect(docs[1].items.map((i) => i.item_code)).toEqual(['SET1']);
    expect(docs[1].lineCount).toBe(4);
  });

  it('ชุดที่ใหญ่เกินโควตา → throw ไม่ตัดครึ่ง', () => {
    expect(() => splitItemsIntoDocuments([set('BIG', 8)], 8)).toThrow(/เกินที่เอกสารเดียวรองรับ/);
  });

  it('error มีข้อมูลให้ debug', () => {
    try {
      splitItemsIntoDocuments([set('BIG', 10)], 8);
      throw new Error('ควร throw');
    } catch (e) {
      expect(e.code).toBe('ORDER_ITEM_GROUP_TOO_LARGE');
      expect(e.statusCode).toBe(400);
      expect(e.item_code).toBe('BIG');
      expect(e.line_count).toBe(11);
    }
  });
});

describe('🚨 ของแถมห้ามหลุดคนละใบ', () => {
  it('ของที่ต้องซื้อกับของแถมอยู่ใบเดียวกัน', () => {
    // 6 สินค้าปกติ + โปรโมชัน 3 บรรทัด (ซื้อ 2 แถม 1)
    const items = [...Array.from({ length: 6 }, (_, i) => normal(`A${i}`)), ...premium('G1', 2, 1)];
    const docs = splitItemsIntoDocuments(items, 8);

    expect(docs).toHaveLength(2);
    const g1Docs = docs.filter((d) => d.items.some((i) => i.__group_id === 'G1'));
    expect(g1Docs).toHaveLength(1); // อยู่ใบเดียวเท่านั้น
    expect(g1Docs[0].items.filter((i) => i.__group_id === 'G1')).toHaveLength(3);
  });

  it('>>> โปรโมชันรหัสเดียวกัน 2 บรรทัดในตะกร้า = 2 กลุ่มแยกกัน', () => {
    // ถ้า group ด้วย sale_premium_code เฉยๆ จะรวมผิดเป็นก้อนเดียว
    const items = [...premium('G1', 2, 1), ...premium('G2', 2, 1)];
    const docs = splitItemsIntoDocuments(items, 4);

    expect(docs).toHaveLength(2);
    expect(docs[0].items.every((i) => i.__group_id === 'G1')).toBe(true);
    expect(docs[1].items.every((i) => i.__group_id === 'G2')).toBe(true);
  });

  it('โปรโมชันที่ใหญ่เกินโควตา → throw', () => {
    expect(() => splitItemsIntoDocuments(premium('G1', 5, 5), 8)).toThrow(/เกินที่เอกสารเดียวรองรับ/);
  });
});

describe('kill switch', () => {
  it('maxLines = 0 → ไม่แบ่ง กลับไปพฤติกรรมเดิม', () => {
    const items = Array.from({ length: 20 }, (_, i) => normal(`A${i}`));
    const docs = splitItemsIntoDocuments(items, 0);
    expect(docs).toHaveLength(1);
    expect(docs[0].items).toHaveLength(20);
  });

  it('maxLines ติดลบ/ไม่ใช่ตัวเลข → ไม่แบ่ง', () => {
    const items = Array.from({ length: 20 }, (_, i) => normal(`A${i}`));
    expect(splitItemsIntoDocuments(items, -1)).toHaveLength(1);
    expect(splitItemsIntoDocuments(items, 'abc')).toHaveLength(1);
  });
});

describe('เคสขอบ', () => {
  it('ไม่มีรายการ', () => {
    expect(splitItemsIntoDocuments([], 8)).toEqual([]);
    expect(splitItemsIntoDocuments(null, 8)).toEqual([]);
  });

  it('รายการเดียว', () => {
    const docs = splitItemsIntoDocuments([normal('A')], 8);
    expect(docs).toHaveLength(1);
    expect(docs[0].lineCount).toBe(1);
  });

  it('ผสมสินค้าปกติ ชุด และของแถม แล้วบรรทัดครบ', () => {
    const items = [normal('A'), set('SET1', 2), ...premium('G1', 1, 1), normal('B')];
    const docs = splitItemsIntoDocuments(items, 8);
    // 1 + 3 + 2 + 1 = 7 บรรทัด
    expect(totalLines(docs)).toBe(7);
    expect(docs).toHaveLength(1);
  });
});
