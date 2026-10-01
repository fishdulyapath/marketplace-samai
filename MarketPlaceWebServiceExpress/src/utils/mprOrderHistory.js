const { rootLines } = require('./pendingOrder');
const { resolveGroupStatus } = require('./orderHistoryAggregate');

const number = value => Number(value) || 0;
const json = (value, fallback) => {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch { return fallback; }
};
function qtNumbers(pending) {
  const numbers = json(pending.qt_doc_nos, []);
  return [...new Set((Array.isArray(numbers) && numbers.length ? numbers : [pending.qt_doc_no]).filter(Boolean))];
}

function projectHeader(pending, header, operational = {}) {
  const status = { pending: 'awaiting_confirmation', cancelled: 'cancelled', rejected: 'rejected' }[pending.status]
    || operational.status || 'pending';
  const result = {
    ...operational,
    order_kind: 'mpr', doc_no: pending.doc_no, mpr_doc_no: pending.doc_no,
    qt_main_doc_no: pending.qt_doc_no || '', qt_doc_nos: qtNumbers(pending),
    request_status: pending.status, reason: pending.reason || '',
    acted_by: pending.acted_by, acted_at: pending.acted_at,
    doc_date: header.doc_date, doc_time: header.doc_time, cust_code: pending.cust_code,
    cust_name: header.cust_name || '', address: header.address || '',
    address_name: header.address_name || '', telephone: header.telephone || '',
    ship_address: header.address || '', contact_telephone: header.telephone || '',
    send_type: header.send_type, remark_qt: header.remark || '', status,
    can_cancel: pending.status === 'pending' || (pending.status === 'confirmed' && status === 'pending'
      && operational.sub_docs?.length > 0 && operational.sub_docs.every(row => row.status === 'pending')),
  };
  // The immutable request is not the collectible invoice: keep both totals.
  for (const key of ['total_amount', 'total_before_vat', 'total_except_vat', 'total_after_vat', 'total_vat_value', 'total_discount']) {
    result[key] = number(header[key]);
  }
  return result;
}

// Only document snapshot fields are exposed; never spread lifecycle metadata or master data.
function projectLine(row) {
  const fields = ['doc_no', 'line_number', 'item_code', 'item_name', 'unit_code', 'qty', 'price', 'sum_amount',
    'wh_code', 'shelf_code', 'stand_value', 'divide_value', 'ratio', 'item_type', 'set_ref_line', 'ref_guid',
    'discount', 'discount_amount', 'tax_type', 'sum_amount_exclude_vat', 'total_vat_value', 'is_permium'];
  return Object.fromEntries(fields.map(field => [field, row[field]]));
}
const lineKey = row => `${row.doc_no}\u0000${Number(row.line_number)}`;
const stockKey = row => `${row.qt_doc_no || row.doc_no}\u0000${row.item_code}\u0000${row.unit_code}`;

function projectItems(sourceRows, qtRows, pending, { staff = false, shipped = [], hasShipment = false, progressRows = [] } = {}) {
  const roots = rootLines(sourceRows);
  // rootLines must run per document: legacy set GUIDs need not be unique across QTs.
  const qtRoots = [...new Set(qtRows.map(row => row.doc_no))].flatMap(doc => rootLines(qtRows.filter(row => row.doc_no === doc)));
  const byLine = new Map(qtRoots.map(row => [lineKey(row), row]));
  const audit = json(pending.metadata, {}).confirmed_allocations || [];
  const links = new Map();
  const used = new Set();
  for (const link of audit) {
    const key = `${link.qt_doc_no}\u0000${Number(link.qt_line_number)}`;
    const target = byLine.get(key);
    const source = roots.find(row => Number(row.line_number) === Number(link.source_line_number));
    // ERP may replace/delete a saved line. Do not silently attach a different product.
    if (!source || !target || used.has(key) || target.item_code !== link.item_code || source.item_code !== link.source_item_code) continue;
    used.add(key);
    const list = links.get(Number(source.line_number)) || [];
    list.push(target); links.set(Number(source.line_number), list);
  }
  const shippedQty = new Map();
  for (const row of shipped) shippedQty.set(stockKey(row), number(shippedQty.get(stockKey(row))) + number(row.qty));
  const demand = new Map();
  const occurrences = new Map();
  for (const row of qtRoots) {
    const key = stockKey(row);
    demand.set(key, number(demand.get(key)) + number(row.qty));
    occurrences.set(key, (occurrences.get(key) || 0) + 1);
  }
  const items = roots.map(row => {
    const allocations = links.get(Number(row.line_number)) || [];
    const item = { ...projectLine(row), sub_item: row.sub_item.map(projectLine) };
    const related = progressRows.filter(progress => allocations.some(allocation => allocation.doc_no === progress.doc_no));
    item.progress_status = resolveGroupStatus(related.map(progress => progress.status));
    if (hasShipment) {
      let qty = 0;
      let unknown = allocations.length === 0;
      for (const allocation of allocations) {
        const key = stockKey(allocation);
        const actual = number(shippedQty.get(key));
        // Shared physical codes can be ambiguous after ERP edits; do not invent a per-line allocation.
        if (occurrences.get(key) > 1 && actual > 0 && actual < demand.get(key)) unknown = true;
        qty += actual >= demand.get(key) ? number(allocation.qty) : Math.min(actual, number(allocation.qty));
      }
      if (Math.abs(allocations.reduce((sum, allocation) => sum + number(allocation.qty), 0) - number(row.qty)) > 0.000001) unknown = true;
      item.shipped_qty = unknown ? null : qty;
      item.ship_state = unknown ? 'unknown' : qty <= 0 ? 'none' : qty < number(row.qty) ? 'partial' : 'full';
    }
    if (staff) item.qt_allocations = allocations.map(target => ({ ...projectLine(target), sub_item: target.sub_item.map(projectLine) }));
    return item;
  });
  return { items, ...(staff ? { unmapped_items: qtRoots.filter(row => !used.has(lineKey(row))).map(row => ({ ...projectLine(row), sub_item: row.sub_item.map(projectLine) })) } : {}) };
}

module.exports = { qtNumbers, projectHeader, projectItems };
