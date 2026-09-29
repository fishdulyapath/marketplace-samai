const mockGetProductPriceLocalx = jest.fn();

jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/priceHelper', () => ({
  getProductPriceLocalx: (...args) => mockGetProductPriceLocalx(...args),
}));
jest.mock('../../src/utils/marketplaceSalesSettings', () => ({
  getPreorderDefaultEnabled: jest.fn().mockResolvedValue(true),
  getStockDisplayPercent: jest.fn().mockResolvedValue(100),
  resolvePreorderAllowed: (mode, defaultEnabled) => {
    if (String(mode) === '1') return true;
    if (String(mode) === '0') return false;
    return Boolean(defaultEnabled);
  },
}));
jest.mock('../../src/utils/serverTime', () => ({
  serverDocDate: () => '2026-08-27',
}));

const { loadSalePremiumDetail } = require('../../src/utils/salePremiumHelper');

function createQueryFn({ paidBalance = 50, freeBalance = 0, freeQty = 1, freePreorderMode = 'default' } = {}) {
  return jest.fn(async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM sml_sale_premium\n')) {
      return { rows: [{ premium_code: 'PRO001', name_1: 'โปรหมี่กรอบ', image_guid: '', remark: '' }] };
    }
    if (text.includes('FROM sml_sale_premium_condition')) {
      return { rows: [{ premium_code: 'PRO001', ic_code: 'G01-0001', unit_code: 'ถุง', qty: 5, line_number: 1 }] };
    }
    if (text.includes('FROM sml_sale_premium_free_list')) {
      return { rows: [{ premium_code: 'PRO001', ic_code: 'G01-0002', unit_code: 'ถังเล็ก', qty: freeQty, line_number: 1 }] };
    }
    if (text.includes('WITH balance_stock AS')) {
      const itemCode = params[1];
      const balance = itemCode === 'G01-0001' ? paidBalance : freeBalance;
      return {
        rows: [{
          item_code: itemCode,
          item_name: itemCode === 'G01-0001' ? 'หมี่กรอบ' : 'ปังกรอบ',
          item_type: 0,
          tax_type: 0,
          wh_code: 'ST01',
          shelf_code: 'LC01',
          preorder_mode: itemCode === 'G01-0002' ? freePreorderMode : 'default',
          unit_code: params[2],
          stand_value: 1,
          divide_value: 1,
          ratio: 1,
          barcode: '',
          sum_balance_qty: balance,
        }],
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });
}

describe('loadSalePremiumDetail stock', () => {
  beforeEach(() => {
    mockGetProductPriceLocalx.mockReset();
    mockGetProductPriceLocalx.mockResolvedValue({ data: [{ price: 10 }] });
  });

  it('ถือว่าทั้งชุดหมดเมื่อของแถมชิ้นใดชิ้นหนึ่งหมด', async () => {
    const detail = await loadSalePremiumDetail(createQueryFn({ paidBalance: 50, freeBalance: 0 }), 'PRO001', {
      custCode: 'B00063',
      stockPercent: 100,
    });

    expect(detail.price).toBe(50);
    expect(detail.balance_qty).toBe(0);
    expect(detail.stock_qty).toBe(0);
    expect(detail.sold_out).toBe('1');
  });

  it('ใช้จำนวนชุดต่ำสุดจากทั้งสินค้าที่ซื้อและของแถม', async () => {
    const detail = await loadSalePremiumDetail(createQueryFn({ paidBalance: 50, freeBalance: 7, freeQty: 2 }), 'PRO001', {
      custCode: 'B00063',
      stockPercent: 100,
    });

    // สินค้าที่ซื้อทำได้ 10 ชุด แต่ของแถมทำได้เพียง floor(7 / 2) = 3 ชุด
    expect(detail.balance_qty).toBe(3);
    expect(detail.stock_qty).toBe(3);
    expect(detail.sold_out).toBe('0');
  });

  it('เปิด Preorder ให้ทั้งชุดต่อเมื่อทุกชิ้นส่วนอนุญาต', async () => {
    const allowed = await loadSalePremiumDetail(createQueryFn({ freeBalance: 0, freePreorderMode: '1' }), 'PRO001', {
      custCode: 'B00063',
      stockPercent: 100,
    });
    const blocked = await loadSalePremiumDetail(createQueryFn({ freeBalance: 0, freePreorderMode: '0' }), 'PRO001', {
      custCode: 'B00063',
      stockPercent: 100,
    });

    expect(allowed.preorder_allowed).toBe(1);
    expect(blocked.preorder_allowed).toBe(0);
  });
});
