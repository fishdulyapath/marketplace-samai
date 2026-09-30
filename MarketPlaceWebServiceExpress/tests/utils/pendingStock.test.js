jest.mock('../../src/utils/groupedStock', () => ({ readPhysicalStock: jest.fn() }));
const { readPhysicalStock } = require('../../src/utils/groupedStock');
const { validatePendingStock } = require('../../src/utils/pendingStock');
const line = (qty = 1, extra = {}) => ({ item_code: 'A', unit_code: 'EA', qty, wh_code: 'W1', shelf_code: 'S1', ...extra });
const stock = (qty, extra = {}) => ({ ic_code: 'A', balance_qty: qty, wh_code: 'W1', shelf_code: 'S1', ...extra });
let client;
beforeEach(() => {
  client = { query: jest.fn().mockResolvedValue({ rows: [
    { ic_code: 'A', code: 'EA', ratio: 1 }, { ic_code: 'A', code: 'BOX', ratio: 12 },
  ] }) };
  readPhysicalStock.mockReset().mockResolvedValue([stock(10)]);
});
it('checks real codes in one batch, signed stock and exact positions without display percentages', async () => {
  readPhysicalStock.mockResolvedValue([stock(15), stock(-5), stock(999, { shelf_code: 'OTHER' })]);
  await expect(validatePendingStock(client, [line(10)])).resolves.toBeUndefined();
  expect(readPhysicalStock).toHaveBeenCalledWith(client, ['A']);
  await expect(validatePendingStock(client, [line(11)])).rejects.toMatchObject({ statusCode: 422, code: 'INSUFFICIENT_STOCK', stock_issues: [{ required_qty: 11, available_qty: 10 }] });
});
it.each([[], [stock(0)], [stock(-1)], [stock(99, { wh_code: 'W2' })]].map(rows => ({ rows })))('blocks missing, zero, negative or other warehouse stock (%j)', async ({ rows }) => {
  readPhysicalStock.mockResolvedValue(rows);
  await expect(validatePendingStock(client, [line()])).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
});
it('aggregates units, free goods and already-expanded set components across source lines', async () => {
  readPhysicalStock.mockResolvedValue([stock(20)]);
  const rows = [line(1, { unit_code: 'BOX' }), line(3, { price: 0, is_permium: 1 }),
    line(2, { item_code: 'SET', item_type: 3, sub_item: [line(6)] })];
  await expect(validatePendingStock(client, rows)).rejects.toMatchObject({ stock_issues: [{ required_qty: 21, available_qty: 20 }] });
  readPhysicalStock.mockResolvedValue([stock(21)]);
  await expect(validatePendingStock(client, rows)).resolves.toBeUndefined();
  expect(readPhysicalStock).toHaveBeenLastCalledWith(client, ['A']);
});
it('does not pool stock across allocated locations', async () => {
  readPhysicalStock.mockResolvedValue([stock(8), stock(2, { shelf_code: 'S2' })]);
  await expect(validatePendingStock(client, [line(6), line(4, { shelf_code: 'S2' })])).rejects.toMatchObject({ stock_issues: [{ shelf_code: 'S2', required_qty: 4, available_qty: 2 }] });
});
it('fails closed on missing master units, empty sets and unsafe component codes', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  for (const row of [line(1, { unit_code: 'UNKNOWN' }), line(1, { item_type: 3, sub_item: [] }), line(1, { item_code: "A'" })]) {
    await expect(validatePendingStock(client, [row])).rejects.toMatchObject({ statusCode: 503, code: 'STOCK_UNAVAILABLE' });
  }
  expect(readPhysicalStock).not.toHaveBeenCalled();
  warn.mockRestore();
});
it('fails closed on stock read failure and invalid balances', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  readPhysicalStock.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(validatePendingStock(client, [line()])).rejects.toMatchObject({ statusCode: 503 });
  for (const qty of [null, 'invalid']) {
    readPhysicalStock.mockResolvedValue([stock(qty)]);
    await expect(validatePendingStock(client, [line()])).rejects.toMatchObject({ code: 'STOCK_UNAVAILABLE' });
  }
  warn.mockRestore();
});
it('uses stand/divide fallback and tolerates only floating-point noise', async () => {
  client.query.mockResolvedValue({ rows: [{ ic_code: 'A', code: 'EA', ratio: 0, stand_value: 3, divide_value: 10 }] });
  readPhysicalStock.mockResolvedValue([stock(0.9)]);
  await expect(validatePendingStock(client, [line(1), line(2)])).resolves.toBeUndefined();
  await expect(validatePendingStock(client, [line(3.00000001)])).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
});
