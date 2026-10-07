jest.mock('../../src/utils/priceHelper', () => ({ getProductPriceLocalx: jest.fn() }));
jest.mock('../../src/utils/serverTime', () => ({ serverDocDate: () => '2026-10-07' }));

const { getProductPriceLocalx } = require('../../src/utils/priceHelper');
const { quotePendingQt } = require('../../src/utils/pendingQuote');

const header = { cust_code: 'C1', inquiry_type: 0, vat_type: 0, vat_rate: 7 };
const row = (item_code, qty, tax_type = 0, extra = {}) => ({
  __source_line: 1, __source_item: 'DISPLAY', item_code, item_name: item_code, unit_code: 'EA', qty,
  wh_code: 'W1', shelf_code: 'S1', tax_type, barcode: '', item_type: 0, is_permium: 0, ...extra,
});

describe('pending QT quote', () => {
  beforeEach(() => getProductPriceLocalx.mockReset());

  it('uses selected product prices and tax types rather than the immutable MPR values', async () => {
    getProductPriceLocalx.mockImplementation(async code => ({
      data: [{ price: code === 'A' ? 100 : 200, defaultDiscount: code === 'A' ? '10%' : '5B' }],
    }));
    const quote = await quotePendingQt({ doc_no: 'MPR1' }, header, [row('A', 2, 0), row('B', 1, 1)]);
    expect(quote.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ item_code: 'A', price: 100, discount: '10%', discount_amount: 20, sum_amount: 180, tax_type: 0, total_vat_value: 12.6 }),
      expect.objectContaining({ item_code: 'B', price: 200, discount: '5B', discount_amount: 5, sum_amount: 195, tax_type: 1, total_vat_value: 0 }),
    ]));
    expect(quote.totals).toMatchObject({ total_value: 400, total_discount: 25, total_before_vat: 180, total_vat_value: 12.6, total_except_vat: 195, total_amount: 387.6 });
  });

  it('prices the same physical item by its total allocation quantity and distributes a fixed discount once', async () => {
    getProductPriceLocalx.mockResolvedValue({ data: [{ price: 100, defaultDiscount: '10B' }] });
    const quote = await quotePendingQt({ doc_no: 'MPR1' }, header, [row('A', 1), row('A', 1, 0, { __source_line: 2, wh_code: 'W2', shelf_code: 'S2' })]);
    expect(getProductPriceLocalx).toHaveBeenCalledTimes(1);
    expect(getProductPriceLocalx.mock.calls[0][2]).toBe('2');
    expect(quote.items.map(item => item.sum_amount)).toEqual([95, 95]);
    expect(quote.items.reduce((sum, item) => sum + item.discount_amount, 0)).toBe(10);
  });

  it('keeps a premium line at the original zero price and never reprices it', async () => {
    const premium = row('FREE', 1, 0, { is_permium: 1, price: 0, sum_amount: 0, discount_amount: 0 });
    const quote = await quotePendingQt({ doc_no: 'MPR1' }, header, [premium]);
    expect(getProductPriceLocalx).not.toHaveBeenCalled();
    expect(quote.items[0]).toMatchObject({ item_code: 'FREE', price: 0, sum_amount: 0 });
  });

  it('rejects confirmation preview when an actual product has no current ERP price', async () => {
    getProductPriceLocalx.mockResolvedValue({ data: [] });
    await expect(quotePendingQt({ doc_no: 'MPR1' }, header, [row('NO-PRICE', 1)])).rejects.toMatchObject({
      code: 'PENDING_QT_PRICE_NOT_FOUND', statusCode: 400, price_issues: [expect.objectContaining({ item_code: 'NO-PRICE' })],
    });
  });
});
