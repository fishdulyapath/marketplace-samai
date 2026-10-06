const { normalizeAllocations, quantityAtoms, distributeAmount } = require('../../src/utils/pendingAllocations');
const root = { line_number: 1, item_code: 'WEB', qty: 10, unit_code: 'EA', item_type: 0 };
const part = (qty, code = 'A') => ({ line_number: 1, item_code: code, qty, wh_code: 'W', shelf_code: 'S' });
describe('allocation validation and money', () => {
  it('normalizes legacy and split forms without trusting extra fields', () => {
    expect(normalizeAllocations([root], [{ line_number: 1, wh_code: 'W', shelf_code: 'S', price: 0 }]).get(1)[0]).toMatchObject({ item_code: 'WEB', qty: 10 });
    expect(normalizeAllocations([root], [part(6), part(4, 'B')]).get(1)).toHaveLength(2);
  });
  it('accepts a Thai shelf code selected from the ERP master', () => {
    const normalized = normalizeAllocations([root], [{ line_number: 1, wh_code: 'W', shelf_code: 'หน้าร้าน' }]);
    expect(normalized.get(1)[0]).toMatchObject({ item_code: 'WEB', qty: 10, wh_code: 'W', shelf_code: 'หน้าร้าน' });
  });
  it.each([[], [part(9)], [part(11)], [part(-1), part(11, 'B')], [part(6), part(4)], [{ ...part(10), line_number: 99 }], [{ ...part(10), item_code: "A'" }], [{ ...part(10), qty: undefined }]].map(allocations => [allocations]))('rejects invalid allocation %j', allocations => {
    expect(() => normalizeAllocations([root], allocations)).toThrow();
  });
  it('does not split product sets', () => {
    expect(() => normalizeAllocations([{ ...root, item_type: 3 }], [part(6), part(4, 'B')])).toThrow('สินค้าชุด');
  });
  it('compares quantities using decimal precision rather than floating point sums', () => {
    expect(quantityAtoms('0.1') + quantityAtoms('0.2')).toBe(quantityAtoms('0.3'));
    expect(() => quantityAtoms(0.000000001)).toThrow();
    expect(() => quantityAtoms(1.000000001)).toThrow();
  });
  it('distributes amounts with deterministic cent remainders', () => {
    expect(distributeAmount('100', [1, 1, 1])).toEqual([33.33, 33.34, 33.33]);
    expect(distributeAmount('0', [6, 4])).toEqual([0, 0]);
  });
});
