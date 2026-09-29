const {
  findPriceViolations,
  findLineIntegrityIssue,
  shouldCheckItem,
  isFiniteNumeric,
  PRICE_TOLERANCE,
} = require('../../src/utils/orderPriceGuard');

// ราคาจริงสมมติ: 01-0004 = 92 บาท/ชิ้น · 01-0005 = 50.5 · ชุด 27-1393 = 3010
const priceBook = { '01-0004': 92, '01-0005': 50.5, '27-1393': 3010 };
const lookup = async (item) => priceBook[String(item.item_code)] ?? NaN;

// บรรทัดที่สอดคล้องกันเองโดยค่าเริ่มต้น: 2 x 92 = 184
const line = (over = {}) => ({ item_code: '01-0004', unit_code: 'ชิ้น', qty: 2, price: 92, sum_amount: 184, ...over });

describe('isFiniteNumeric — ตัวกรองที่ปิดช่องโหว่ price ไม่ใช่ตัวเลข', () => {
  it.each([
    [92, true],
    ['92', true],
    ['92.50', true],
    [0, true],
    ['abc', false],
    ['', false],
    ['   ', false],
    [null, false],
    [undefined, false],
    [{}, false],
    [[], false],
    [NaN, false],
    [Infinity, false],
  ])('%p -> %p', (value, expected) => {
    expect(isFiniteNumeric(value)).toBe(expected);
  });
});

describe('shouldCheckItem — บรรทัดไหนต้องตรวจ', () => {
  it('สินค้าปกติ = ตรวจ', () => {
    expect(shouldCheckItem(line())).toBe(true);
  });

  it('สินค้าชุด = ตรวจด้วย (เดิมข้ามจนตั้งราคาชุดเท่าไหร่ก็ได้)', () => {
    expect(shouldCheckItem(line({ item_type: '3' }))).toBe(true);
  });

  it('ของแถม = ข้าม เพราะ server บังคับราคา 0 อยู่แล้ว', () => {
    expect(shouldCheckItem(line({ is_permium: 1, price: 0, sum_amount: 0 }))).toBe(false);
  });

  it('ไม่มีรหัสสินค้าหรือหน่วย = ข้าม (ด่านอื่นปฏิเสธก่อน)', () => {
    expect(shouldCheckItem(line({ item_code: '' }))).toBe(false);
    expect(shouldCheckItem(line({ unit_code: '   ' }))).toBe(false);
  });

  it('ค่าที่ไม่ใช่ object = ข้าม', () => {
    expect(shouldCheckItem(null)).toBe(false);
    expect(shouldCheckItem('01-0004')).toBe(false);
  });
});

describe('findLineIntegrityIssue — ความสอดคล้องภายในบรรทัด', () => {
  it('บรรทัดปกติ = ไม่มีปัญหา', () => {
    expect(findLineIntegrityIssue(line())).toBeNull();
  });

  it('ไม่ส่ง sum_amount = ให้ server คำนวณเอง ไม่ถือว่าผิด', () => {
    expect(findLineIntegrityIssue(line({ sum_amount: undefined }))).toBeNull();
  });

  // ── ช่องโหว่ที่เคยเปิดอยู่จริง ──
  it.each([['abc'], [undefined], [{}], [null], ['']])('price = %p ต้องถูกจับ (เคยผ่านเป็นของฟรี)', (bad) => {
    expect(findLineIntegrityIssue(line({ price: bad }))).toBe('PRICE_NOT_NUMERIC');
  });

  it('sum_amount ต่ำกว่ายอดเต็มโดยไม่มีส่วนลด ต้องถูกจับ (เคยได้เอกสาร 1 บาท)', () => {
    expect(findLineIntegrityIssue(line({ sum_amount: 1 }))).toBe('SUM_AMOUNT_BELOW_LINE');
  });

  it('sum_amount = 0 โดยไม่มีส่วนลด ต้องถูกจับ', () => {
    expect(findLineIntegrityIssue(line({ sum_amount: 0 }))).toBe('SUM_AMOUNT_BELOW_LINE');
  });

  it('sum_amount สูงกว่ายอดเต็ม ต้องถูกจับ', () => {
    expect(findLineIntegrityIssue(line({ sum_amount: 500 }))).toBe('SUM_AMOUNT_ABOVE_LINE');
  });

  it('sum_amount ไม่ใช่ตัวเลข ต้องถูกจับ', () => {
    expect(findLineIntegrityIssue(line({ sum_amount: 'abc' }))).toBe('SUM_AMOUNT_NOT_NUMERIC');
  });

  it('ราคาติดลบ ต้องถูกจับ', () => {
    expect(findLineIntegrityIssue(line({ price: -100, sum_amount: -200 }))).toBe('PRICE_NEGATIVE');
  });

  it('sum_amount ติดลบ ต้องถูกจับ', () => {
    expect(findLineIntegrityIssue(line({ sum_amount: -1 }))).toBe('SUM_AMOUNT_NEGATIVE');
  });

  // ── ส่วนลด ──
  it('ส่วนลดติดลบ ต้องถูกจับ', () => {
    expect(findLineIntegrityIssue(line({ discount_amount: -5 }))).toBe('DISCOUNT_NEGATIVE');
  });

  it('ส่วนลดเกินยอดเต็มของบรรทัด ต้องถูกจับ', () => {
    expect(findLineIntegrityIssue(line({ discount_amount: 9999, sum_amount: 0 }))).toBe('DISCOUNT_EXCEEDS_LINE');
  });

  // บั๊กจริงที่เคยหลุดไป: เอา (1 + vat/100) ไปคูณ "ส่วนลด" แทน "เพดาน"
  // เพดานจริงเลยเหลือ gross/1.07 = 93.46% ส่วนลด 95% ที่ถูกต้องถูกปฏิเสธ
  it('ส่วนลดตั้งแต่ 50% ถึง 100% ของบรรทัด ต้องผ่านทั้งช่วง', () => {
    // ยอดเต็ม 10 x 10 = 100
    const at = (discount) => ({ item_code: 'A', unit_code: 'U', qty: 10, price: 10, discount_amount: discount, sum_amount: 100 - discount });
    for (const discount of [50, 90, 93, 93.5, 95, 99, 100]) {
      expect(findLineIntegrityIssue(at(discount), 7)).toBeNull();
    }
  });

  it('ส่วนลดเกินเพดานที่เผื่อ VAT แล้ว ยังต้องถูกจับ', () => {
    const over = { item_code: 'A', unit_code: 'U', qty: 10, price: 10, discount_amount: 150, sum_amount: 0 };
    expect(findLineIntegrityIssue(over, 7)).toBe('DISCOUNT_EXCEEDS_LINE');
  });

  it('มีส่วนลดจริง แล้ว sum_amount หักส่วนลดแล้ว = ผ่าน (แบบที่ ERP เก็บ)', () => {
    // ยอดเต็ม 184 ส่วนลด 84 -> เหลือ 100
    expect(findLineIntegrityIssue(line({ discount_amount: 84, sum_amount: 100 }))).toBeNull();
  });

  it('มีส่วนลดจริง แต่ sum_amount ยังเป็นยอดเต็ม = ผ่าน (แบบที่ marketplace ส่ง)', () => {
    expect(findLineIntegrityIssue(line({ discount_amount: 84, sum_amount: 184 }))).toBeNull();
  });

  it('ส่วนลดที่เก็บแบบไม่รวม VAT ยังหักได้ตามจริง', () => {
    // discount_amount 100 ที่ VAT 7% หมายถึงส่วนลดจริง 107 -> sum ต่ำสุดที่ยอมรับคือ 77
    expect(findLineIntegrityIssue(line({ discount_amount: 100, sum_amount: 77 }), 7)).toBeNull();
    expect(findLineIntegrityIssue(line({ discount_amount: 100, sum_amount: 70 }), 7)).toBe('SUM_AMOUNT_BELOW_LINE');
  });

  it('ต่างในระดับ tolerance = ผ่าน (การปัดเศษ)', () => {
    expect(findLineIntegrityIssue(line({ sum_amount: 184 - PRICE_TOLERANCE }))).toBeNull();
  });

  it('price เป็นสตริงตัวเลข = ผ่าน (client ส่งมาเป็นสตริงเสมอ)', () => {
    expect(findLineIntegrityIssue(line({ price: '92', qty: '2', sum_amount: '184' }))).toBeNull();
  });
});

describe('findPriceViolations — รวมกับราคาจริงฝั่ง server', () => {
  it('ราคาตรงกับราคาจริง = ผ่าน', async () => {
    expect(await findPriceViolations([line()], lookup)).toEqual([]);
  });

  it('ราคาต่ำกว่าจริง = จับได้', async () => {
    const v = await findPriceViolations([line({ price: 1, sum_amount: 2 })], lookup);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ item_code: '01-0004', reason: 'PRICE_BELOW_SERVER', server_price: 92 });
  });

  it('ราคาสูงกว่าจริง = ปล่อยผ่าน (พนักงานตั้งราคาพิเศษได้)', async () => {
    expect(await findPriceViolations([line({ price: 150, sum_amount: 300 })], lookup)).toEqual([]);
  });

  it('price ไม่ใช่ตัวเลข = จับที่ชั้นความสอดคล้อง ไม่ต้องถามราคา server', async () => {
    const v = await findPriceViolations([line({ price: 'abc' })], lookup);
    expect(v).toHaveLength(1);
    expect(v[0].reason).toBe('PRICE_NOT_NUMERIC');
  });

  it('หาราคาจริงไม่ได้ = ปล่อยผ่าน ไม่บล็อกออเดอร์ที่อาจถูกต้อง', async () => {
    const v = await findPriceViolations([line({ item_code: 'ไม่มีในระบบ', price: 1, sum_amount: 2 })], lookup);
    expect(v).toEqual([]);
  });

  it('ของแถมราคา 0 = ไม่ถูกจับ', async () => {
    expect(await findPriceViolations([line({ is_permium: 1, price: 0, sum_amount: 0 })], lookup)).toEqual([]);
  });

  it('หลายบรรทัด รายงานเฉพาะบรรทัดที่ผิด', async () => {
    const v = await findPriceViolations(
      [line(), line({ item_code: '01-0005', price: 1, sum_amount: 2 }), line()],
      lookup
    );
    expect(v).toHaveLength(1);
    expect(v[0].item_code).toBe('01-0005');
  });

  it('items ว่างหรือไม่ใช่อาร์เรย์ = ไม่พัง', async () => {
    expect(await findPriceViolations([], lookup)).toEqual([]);
    expect(await findPriceViolations(null, lookup)).toEqual([]);
  });

  // ── สินค้าชุด ──
  it('ชุดราคาถูกต้อง = ผ่าน', async () => {
    const set = { item_code: '27-1393', unit_code: 'ชุด', item_type: '3', qty: 1, price: 3010, sum_amount: 3010 };
    expect(await findPriceViolations([set], lookup)).toEqual([]);
  });

  it('ชุดตั้งราคาต่ำกว่าจริง = จับได้ (เดิมข้ามทั้งหมด)', async () => {
    const set = { item_code: '27-1393', unit_code: 'ชุด', item_type: '3', qty: 1, price: 100, sum_amount: 100 };
    const v = await findPriceViolations([set], lookup);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ reason: 'PRICE_BELOW_SERVER', server_price: 3010 });
  });

  it('sub_item ของชุดที่ราคา 0 ต้องไม่ถูกจับ — ERP จัดสรรราคาภายในชุดเอง', async () => {
    // จากเอกสารจริง: ชุดราคา 3010 · sub ตัวแรกรับ 3010 · sub อีกตัวราคา 0 อย่างถูกต้อง
    const subFree = { item_code: '05-2293', unit_code: 'ชิ้น', item_type: '0', qty: 11, price: 0, sum_amount: 0 };
    const lookupWithFreeSub = async (item) => (item.item_code === '05-2293' ? NaN : priceBook[item.item_code] ?? NaN);
    expect(await findPriceViolations([subFree], lookupWithFreeSub)).toEqual([]);
  });
});
