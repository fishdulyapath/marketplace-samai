const { projectHeader, projectItems, qtNumbers } = require('../../src/utils/mprOrderHistory');
const { aggregateOrderRowsByMainDoc } = require('../../src/utils/orderHistoryAggregate');

const line = (doc, n, code, qty, unit = 'EA', extra = {}) => ({ doc_no: doc, line_number: n, item_code: code,
  item_name: code, unit_code: unit, qty, price: 10, sum_amount: qty * 10, wh_code: 'W1', shelf_code: 'S1', ...extra });
const source = [line('MPR1', 1, 'DISPLAY', 10), line('MPR1', 2, 'DISPLAY', 3, 'BOX')];
const actual = [line('QT1', 1, 'A', 6), line('QT2', 1, 'B', 4), line('QT2', 2, 'A', 3, 'BOX')];
const links = [[1, 'QT1', 1, 'A'], [1, 'QT2', 1, 'B'], [2, 'QT2', 2, 'A']].map(([src, qt, target, item]) => ({
  source_line_number: src, source_item_code: 'DISPLAY', qt_doc_no: qt, qt_line_number: target, item_code: item,
}));
const pending = { doc_no: 'MPR1', cust_code: 'C1', status: 'confirmed', qt_doc_no: 'QT', qt_doc_nos: ['QT1', 'QT2'], metadata: { confirmed_allocations: links } };

test('one source line splits across QTs; identical display code in another unit stays separate', () => {
  const result = projectItems(source, actual, pending, { staff: true });
  expect(result.items.map(row => row.qt_allocations.map(it => it.item_code))).toEqual([['A', 'B'], ['A']]);
  expect(result.items[1].qt_allocations[0].unit_code).toBe('BOX');
  expect(result.items.reduce((sum, row) => sum + row.sum_amount, 0)).toBe(130);
});
test('customer projection never contains physical products or lifecycle metadata', () => {
  const result = projectItems(source, actual, pending);
  expect(result.items.map(row => row.item_code)).toEqual(['DISPLAY', 'DISPLAY']);
  expect(JSON.stringify(result)).not.toMatch(/QT1|QT2|qt_allocations|confirmed_allocations|source_item_code/);
  expect(result).not.toHaveProperty('unmapped_items');
});
test('missing audit does not guess by current master or item code', () => {
  const result = projectItems(source, actual, { ...pending, metadata: {} }, { staff: true });
  expect(result.items.every(it => it.qt_allocations.length === 0)).toBe(true);
  expect(result.unmapped_items).toHaveLength(3);
});
test('ERP replacement of a QT line is presented as unmapped', () => {
  const result = projectItems(source, [{ ...actual[0], item_code: 'CHANGED' }], pending, { staff: true });
  expect(result.items[0].qt_allocations).toEqual([]);
  expect(result.unmapped_items[0].item_code).toBe('CHANGED');
});
test('duplicate audit entries cannot duplicate physical lines', () => {
  const result = projectItems(source, actual, { ...pending, metadata: { confirmed_allocations: [...links, ...links] } }, { staff: true });
  expect(result.items[0].qt_allocations).toHaveLength(2);
});
test('sets retain original components and separate QT components', () => {
  const roots = [line('MPR1', 1, 'SET', 1, 'SET', { item_type: 3, ref_guid: 'set' }), line('MPR1', 2, 'COMPONENT', 2, 'EA', { set_ref_line: 'set' })];
  const qt = roots.map(row => ({ ...row, doc_no: 'QT1' }));
  const p = { ...pending, metadata: { confirmed_allocations: [{ ...links[0], source_item_code: 'SET', item_code: 'SET' }] } };
  const result = projectItems(roots, qt, p, { staff: true });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].sub_item[0].item_code).toBe('COMPONENT');
  expect(result.items[0].qt_allocations[0].sub_item).toHaveLength(1);
});
test('shipment progress aggregates actual allocations under original products', () => {
  const shipped = actual.map(row => ({ ...row, qt_doc_no: row.doc_no, doc_no: 'SO' }));
  const result = projectItems(source, actual, pending, { shipped, hasShipment: true });
  expect(result.items.map(it => [it.ship_state, it.shipped_qty])).toEqual([['full', 10], ['full', 3]]);
});
test('partial shipment and unshipped products use physical mappings, not display codes', () => {
  const result = projectItems(source, actual, pending, { shipped: [{ ...actual[0], qt_doc_no: 'QT1', qty: 2 }], hasShipment: true });
  expect(result.items.map(it => [it.ship_state, it.shipped_qty])).toEqual([['partial', 2], ['none', 0]]);
});
test('ambiguous partial quantities for repeated physical lines are not double counted', () => {
  const src = [source[0], { ...source[0], line_number: 2 }];
  const qt = [actual[0], { ...actual[0], line_number: 2 }];
  const p = { ...pending, metadata: { confirmed_allocations: [links[0], { ...links[0], source_line_number: 2, qt_line_number: 2 }] } };
  const result = projectItems(src, qt, p, { hasShipment: true, shipped: [{ ...actual[0], qt_doc_no: 'QT1', qty: 2 }] });
  expect(result.items.every(it => it.ship_state === 'unknown' && it.shipped_qty === null)).toBe(true);
});
test.each([['pending', 'awaiting_confirmation'], ['cancelled', 'cancelled'], ['rejected', 'rejected']])('request %s has its own display status', (status, expected) => {
  const result = projectHeader({ ...pending, status, reason: 'reason' }, { total_amount: 130 });
  expect(result.status).toBe(expected);
  expect(result.reason).toBe('reason');
  expect(result.can_cancel).toBe(status === 'pending');
});
test('confirmed follows mixed ERP state, preserves invoice identity and request money/date', () => {
  const [operational] = aggregateOrderRowsByMainDoc([
    { main_doc_no: 'MPR1', doc_no: 'QT1', status: 'packing', total_amount: 60 },
    { main_doc_no: 'MPR1', doc_no: 'QT2', status: 'payment', total_amount: 70, invoiced_amount: 65, balance: 65, inv_doc_no: 'INV2', delivery_image_doc_no: 'INV2', delivery_image_count: 1 },
  ]);
  const result = projectHeader(pending, { doc_date: '2026-09-01', total_amount: 130 }, operational);
  expect(result).toMatchObject({ doc_no: 'MPR1', qt_main_doc_no: 'QT', status: 'packing', mixed_progress: true,
    inv_doc_no: 'INV2', delivery_image_doc_no: 'INV2', invoiced_amount: 65, balance: 65, total_amount: 130, doc_date: '2026-09-01', can_cancel: false });
});
test('missing operational documents cannot be cancelled as QT', () => {
  expect(projectHeader(pending, {}).can_cancel).toBe(false);
});
test('QT references de-duplicate and support old lifecycle without qt_doc_nos', () => {
  expect(qtNumbers({ qt_doc_nos: '["A","A","B"]' })).toEqual(['A', 'B']);
  expect(qtNumbers({ qt_doc_no: 'QT1' })).toEqual(['QT1']);
});
