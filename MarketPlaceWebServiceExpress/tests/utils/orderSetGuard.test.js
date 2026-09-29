const { buildSetTemplateMap, applySetTemplateToItem, setIssueMessage } = require('../../src/utils/orderSetGuard');

// แม่แบบสมมติที่เลียนแบบของจริง: ชิ้นส่วนตัวหนึ่งรับราคาทั้งก้อน อีกตัวราคา 0
// (วัดกับฐานจริงแล้ว ทั้ง 60 ชุดมีชิ้นส่วนราคา 0 — เป็นการปันราคาภายในของ ERP)
const ROWS = [
  { ic_set_code: 'S1', ic_code: 'A', unit_code: 'ลัง12', qty: 1, price: 3010, barcode: 'BC-A', price_ratio: 1, item_name: 'สินค้า A' },
  { ic_set_code: 'S1', ic_code: 'B', unit_code: 'ชิ้น', qty: 12, price: 0, barcode: '', price_ratio: 1, item_name: 'สินค้า B' },
  { ic_set_code: 'S2', ic_code: 'C', unit_code: 'ชิ้น', qty: 2, price: 50, barcode: '', price_ratio: 1, item_name: 'สินค้า C' },
];

describe('buildSetTemplateMap', () => {
  it('จัดกลุ่มตามรหัสชุด และคงลำดับตามที่ query ส่งมา', () => {
    const map = buildSetTemplateMap(ROWS);
    expect([...map.keys()]).toEqual(['S1', 'S2']);
    expect(map.get('S1').map((r) => r.item_code)).toEqual(['A', 'B']);
  });

  it('ชิ้นส่วนราคา 0 ต้องอยู่ในแม่แบบ ไม่ใช่ของผิดปกติ', () => {
    expect(buildSetTemplateMap(ROWS).get('S1')[1]).toMatchObject({ item_code: 'B', price: 0, qty: 12 });
  });

  it('แถวที่ qty <= 0 ถูกข้าม — ตรงกับพฤติกรรมเดิมที่ปฏิเสธ sub qty <= 0', () => {
    const map = buildSetTemplateMap([...ROWS, { ic_set_code: 'S3', ic_code: 'D', unit_code: 'ชิ้น', qty: 0, price: 0 }]);
    expect(map.has('S3')).toBe(false);
  });

  it('price_ratio ว่างหรือ 0 ให้เป็น 1 เหมือนที่หน้าร้านใช้', () => {
    const map = buildSetTemplateMap([{ ic_set_code: 'S4', ic_code: 'E', unit_code: 'ชิ้น', qty: 1, price: 5, price_ratio: 0 }]);
    expect(map.get('S4')[0].price_ratio).toBe(1);
  });

  it('แถวที่ไม่มีรหัส หรือ input ไม่ใช่อาร์เรย์ ไม่ทำให้พัง', () => {
    expect(buildSetTemplateMap([{ ic_set_code: '', ic_code: 'X' }]).size).toBe(0);
    expect(buildSetTemplateMap(null).size).toBe(0);
  });
});

describe('applySetTemplateToItem — ราคาชิ้นส่วนต้องมาจากแม่แบบเท่านั้น', () => {
  const template = () => buildSetTemplateMap(ROWS).get('S1');

  it('ราคาที่ client ปั่นมาถูกเขียนทับด้วยราคาจากแม่แบบ', () => {
    const item = {
      item_code: 'S1', item_type: '3', qty: 1, price: 3010,
      sub_item: [
        { item_code: 'A', unit_code: 'ลัง12', qty: 1, price: 999999 },
        { item_code: 'B', unit_code: 'ชิ้น', qty: 12, price: 888888 },
      ],
    };
    expect(applySetTemplateToItem(item, template())).toBeNull();
    expect(item.sub_item.map((s) => s.price)).toEqual([3010, 0]);
  });

  it('ราคาติดลบก็ถูกเขียนทับ ไม่หลุดลง ERP', () => {
    const item = { item_code: 'S1', sub_item: [{ item_code: 'A', unit_code: 'ลัง12', qty: 1, price: -5000 }] };
    expect(applySetTemplateToItem(item, template())).toBeNull();
    expect(item.sub_item.every((s) => s.price >= 0)).toBe(true);
  });

  it('ส่งชิ้นส่วนมาไม่ครบ ก็ได้ครบตามแม่แบบ', () => {
    const item = { item_code: 'S1', sub_item: [{ item_code: 'A', unit_code: 'ลัง12', qty: 1, price: 3010 }] };
    expect(applySetTemplateToItem(item, template())).toBeNull();
    expect(item.sub_item.map((s) => s.item_code)).toEqual(['A', 'B']);
  });

  it('ไม่ส่ง sub_item มาเลย หรือส่ง [] ก็ได้ครบตามแม่แบบ ไม่ใช่ปฏิเสธ', () => {
    // หน้าร้านส่ง sub_item: [] จริงเมื่อ setItemsCache โหลดไม่ทัน (StepConfirmation.vue)
    for (const value of [undefined, null, []]) {
      const item = { item_code: 'S1', sub_item: value };
      expect(applySetTemplateToItem(item, template())).toBeNull();
      expect(item.sub_item).toHaveLength(2);
    }
  });

  it('ชิ้นส่วนที่ไม่ได้อยู่ในชุด ถูกตัดทิ้ง ไม่ถูกเขียนลง ERP', () => {
    const item = { item_code: 'S1', sub_item: [{ item_code: 'ผี', unit_code: 'ชิ้น', qty: 99, price: 1 }] };
    expect(applySetTemplateToItem(item, template())).toBeNull();
    expect(item.sub_item.map((s) => s.item_code)).toEqual(['A', 'B']);
  });

  it('จำนวนต่อชุดมาจากแม่แบบ ไม่ใช่ค่าที่ client ส่ง', () => {
    const item = { item_code: 'S1', sub_item: [{ item_code: 'B', unit_code: 'ชิ้น', qty: 99999, price: 0 }] };
    applySetTemplateToItem(item, template());
    expect(item.sub_item.find((s) => s.item_code === 'B').qty).toBe(12);
  });

  // sub_item เป็นสตริงเคยได้บรรทัดขยะ item_code=NULL หนึ่งบรรทัดต่อหนึ่งตัวอักษร
  // เพราะตอนเขียนใช้ `it.sub_item || []` แล้ว for...of ซึ่งวนสตริงได้
  it('sub_item ผิดชนิด ต้องถูกปฏิเสธ ไม่ใช่ปล่อยผ่านเงียบๆ', () => {
    for (const bad of ['abc', 123, { a: 1 }, true]) {
      expect(applySetTemplateToItem({ item_code: 'S1', sub_item: bad }, template())).toEqual({ reason: 'SUB_ITEM_NOT_ARRAY' });
    }
  });

  it('ไม่มีแม่แบบของชุดนั้น = ปฏิเสธ', () => {
    expect(applySetTemplateToItem({ item_code: 'ไม่มี' }, undefined)).toEqual({ reason: 'SET_TEMPLATE_NOT_FOUND' });
    expect(applySetTemplateToItem({ item_code: 'ไม่มี' }, [])).toEqual({ reason: 'SET_TEMPLATE_NOT_FOUND' });
  });

  it('ตรวจชนิดก่อนหาแม่แบบ — payload พังต้องได้เหตุผลที่ตรงกับปัญหาจริง', () => {
    expect(applySetTemplateToItem({ item_code: 'S1', sub_item: 'abc' }, [])).toEqual({ reason: 'SUB_ITEM_NOT_ARRAY' });
  });

  it('item ไม่ใช่ object', () => {
    expect(applySetTemplateToItem(null, template())).toEqual({ reason: 'SUB_ITEM_NOT_OBJECT' });
  });

  it('แม่แบบต้นฉบับไม่ถูกแก้ตาม เมื่อมีสินค้าชุดเดียวกันหลายบรรทัด', () => {
    const shared = template();
    const a = { item_code: 'S1' };
    const b = { item_code: 'S1' };
    applySetTemplateToItem(a, shared);
    a.sub_item[0].price = 1;
    applySetTemplateToItem(b, shared);
    expect(b.sub_item[0].price).toBe(3010);
  });
});

describe('setIssueMessage', () => {
  it('บอกลำดับบรรทัดเป็นเลขที่คนอ่านเข้าใจ (เริ่มที่ 1)', () => {
    expect(setIssueMessage({ reason: 'SUB_ITEM_NOT_ARRAY' }, 0)).toContain('ลำดับที่ 1');
    expect(setIssueMessage({ reason: 'SET_TEMPLATE_NOT_FOUND' }, 2)).toContain('ลำดับที่ 3');
  });

  it('เหตุผลที่ไม่รู้จักยังได้ข้อความไทยที่อ่านรู้เรื่อง', () => {
    expect(setIssueMessage({ reason: 'อะไรก็ไม่รู้' }, 0)).toBe('สินค้าชุดลำดับที่ 1: ข้อมูลสินค้าชุดไม่ถูกต้อง');
  });
});
