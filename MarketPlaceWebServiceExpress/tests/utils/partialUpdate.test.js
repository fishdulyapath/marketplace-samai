const { pickProvidedFields, buildSetClause, buildConflictSetClause, hasOwn } = require('../../src/utils/partialUpdate');

const WHITELIST = [
  'name_1',
  { key: 'description' },
  { key: 'qty', normalize: (v) => Number(v) || 0 },
  { key: 'shelf', column: 'start_sale_shelf', normalize: (v) => String(v).trim() },
];

describe('pickProvidedFields — เขียนเฉพาะฟิลด์ที่ client ส่งมาจริง', () => {
  it('ไม่ส่ง key มา = ไม่อยู่ในรายการที่จะเขียน (หัวใจของการแก้บั๊กข้อมูลหาย)', () => {
    const r = pickProvidedFields({ name_1: 'ก' }, WHITELIST);
    expect(r.columns).toEqual(['name_1']);
    expect(r.values).toEqual(['ก']);
  });

  it('ส่งค่าว่างมา = ตั้งใจล้าง ต้องอยู่ในรายการ', () => {
    const r = pickProvidedFields({ description: '' }, WHITELIST);
    expect(r.columns).toEqual(['description']);
    expect(r.values).toEqual(['']);
  });

  it('ส่ง undefined = ถือว่าไม่ได้ส่ง (มาจากการประกอบ object ฝั่ง JS)', () => {
    const r = pickProvidedFields({ name_1: undefined, description: 'x' }, WHITELIST);
    expect(r.columns).toEqual(['description']);
  });

  it('ส่ง null = ตั้งใจล้าง ไม่ใช่ไม่ส่ง', () => {
    const r = pickProvidedFields({ description: null }, WHITELIST);
    expect(r.columns).toEqual(['description']);
    expect(r.values).toEqual([null]);
  });

  it('คีย์นอก whitelist ถูกตัดทิ้ง — กันการฉีดชื่อคอลัมน์', () => {
    const r = pickProvidedFields({ name_1: 'ก', 'password=1; DROP TABLE': 'x', item_pattern: 'W' }, WHITELIST);
    expect(r.columns).toEqual(['name_1']);
  });

  it('รองรับการเปลี่ยนชื่อคอลัมน์', () => {
    const r = pickProvidedFields({ shelf: '  A1  ' }, WHITELIST);
    expect(r.columns).toEqual(['start_sale_shelf']);
    expect(r.values).toEqual(['A1']);
  });

  it('normalize ถูกเรียกกับค่าที่ส่งมา', () => {
    const r = pickProvidedFields({ qty: '12' }, WHITELIST);
    expect(r.values).toEqual([12]);
  });

  it('ส่งครบทุกคีย์ = ได้ครบตามลำดับ whitelist', () => {
    const r = pickProvidedFields({ qty: 1, name_1: 'ก', description: 'ข', shelf: 'A' }, WHITELIST);
    expect(r.columns).toEqual(['name_1', 'description', 'qty', 'start_sale_shelf']);
  });

  it('body ว่างหรือไม่ใช่ object = ไม่พัง', () => {
    expect(pickProvidedFields({}, WHITELIST).columns).toEqual([]);
    expect(pickProvidedFields(null, WHITELIST).columns).toEqual([]);
    expect(pickProvidedFields(undefined, WHITELIST).columns).toEqual([]);
  });

  it('whitelist ว่างหรือไม่ใช่อาร์เรย์ = ไม่พัง', () => {
    expect(pickProvidedFields({ name_1: 'ก' }, []).columns).toEqual([]);
    expect(pickProvidedFields({ name_1: 'ก' }, null).columns).toEqual([]);
  });
});

describe('buildSetClause', () => {
  it('ประกอบ SET พร้อมลำดับพารามิเตอร์', () => {
    expect(buildSetClause(['a', 'b'], 1)).toBe('a=$1, b=$2');
  });

  it('เริ่มลำดับที่อื่นได้ เผื่อมีพารามิเตอร์นำหน้า', () => {
    expect(buildSetClause(['a', 'b'], 3)).toBe('a=$3, b=$4');
  });

  it('ไม่มีคอลัมน์ = คืน null ให้ผู้เรียกตอบ 400 แทนการรัน UPDATE เปล่า', () => {
    expect(buildSetClause([], 1)).toBeNull();
    expect(buildSetClause(null, 1)).toBeNull();
  });
});

describe('buildConflictSetClause', () => {
  it('ประกอบ DO UPDATE SET จาก EXCLUDED', () => {
    expect(buildConflictSetClause(['a', 'b'])).toBe('a=EXCLUDED.a, b=EXCLUDED.b');
  });

  it('ไม่มีคอลัมน์ = null', () => {
    expect(buildConflictSetClause([])).toBeNull();
  });
});

describe('hasOwn', () => {
  it('แยก "ไม่มี key" ออกจาก "มี key แต่ค่าเป็น undefined"', () => {
    expect(hasOwn({ a: undefined }, 'a')).toBe(true);
    expect(hasOwn({}, 'a')).toBe(false);
    expect(hasOwn(null, 'a')).toBe(false);
  });
});
