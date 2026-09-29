const { queryParser, flattenValue } = require('../../src/middleware/normalizeQuery');

describe('queryParser — กันไม่ให้ค่าใน query กลายเป็น array', () => {
  it('พารามิเตอร์ซ้ำ → เอาค่าแรก (เคสที่เคยทำให้เซิร์ฟเวอร์ดับ)', () => {
    expect(queryParser('cust_code=a&cust_code=b')).toEqual({ cust_code: 'a' });
  });

  it('ซ้ำสามค่าขึ้นไปก็ยังได้ค่าแรก', () => {
    expect(queryParser('x=1&x=2&x=3')).toEqual({ x: '1' });
  });

  it('bracket notation a[]=1&a[]=2 → ค่าแรก', () => {
    expect(queryParser('a[]=1&a[]=2')).toEqual({ a: '1' });
  });

  it('object notation a[k]=1 → สตริงว่าง (ไม่มี route ไหนรองรับ object)', () => {
    expect(queryParser('a[k]=1')).toEqual({ a: '' });
  });

  it('ค่าเดี่ยวปกติไม่เปลี่ยน', () => {
    expect(queryParser('cust_code=AR00003&limit=50')).toEqual({ cust_code: 'AR00003', limit: '50' });
  });

  it('ค่าว่างยังเป็นค่าว่าง ไม่กลายเป็น undefined', () => {
    expect(queryParser('wh_code=&cust_code=AR00003')).toEqual({ wh_code: '', cust_code: 'AR00003' });
  });

  it('query ว่าง / undefined → object ว่าง ไม่ throw', () => {
    expect(queryParser('')).toEqual({});
    expect(queryParser(undefined)).toEqual({});
    expect(queryParser(null)).toEqual({});
  });

  it('อักขระไทยและ url-encoded ยังถอดรหัสถูก', () => {
    expect(queryParser('unit=' + encodeURIComponent('ชิ้น'))).toEqual({ unit: 'ชิ้น' });
  });

  it('ผลลัพธ์ทุกค่าเรียก .trim() ได้เสมอ — คือเงื่อนไขที่ทำให้ไม่ล่ม', () => {
    const parsed = queryParser('a=1&a=2&b[]=x&c[k]=1&d=');
    // jest รับ argument เดียว (ต่างจาก vitest) จึงใส่ชื่อคีย์ไว้ในค่าที่เทียบแทน
    for (const [key, value] of Object.entries(parsed)) {
      expect(`${key}:${typeof value}`).toBe(`${key}:string`);
      expect(() => value.trim()).not.toThrow();
    }
  });
});

describe('flattenValue', () => {
  it('array ว่าง → สตริงว่าง', () => {
    expect(flattenValue([])).toBe('');
  });

  it('array ที่มี null นำหน้า → ข้ามไปเอาค่าที่ใช้ได้', () => {
    expect(flattenValue([null, 'ok'])).toBe('ok');
  });

  it('array ซ้อน array → คลี่จนได้ค่าเดียว', () => {
    expect(flattenValue([['a', 'b']])).toBe('a');
  });

  it('undefined คงไว้ ให้ปลายทางแยกแยะ "ไม่ส่งมา" ได้', () => {
    expect(flattenValue(undefined)).toBeUndefined();
  });
});
