const { isSafeErpCode } = require('./erpCodeGuard');
const { readPhysicalStock } = require('./groupedStock');

const unavailable = () => Object.assign(new Error('ตรวจสอบสต๊อกไม่สำเร็จ ยังไม่สร้าง QT กรุณาลองใหม่หรือตรวจสอบหน่วยสินค้า'), {
  statusCode: 503, code: 'STOCK_UNAVAILABLE',
});
const keyOf = row => JSON.stringify([row.item_code || row.ic_code, row.wh_code, row.shelf_code]);

// Check the whole request before splitting QTs. Set children already contain
// expanded quantities in 300; synthetic parents must not consume stock twice.
async function validatePendingStock(client, allocated) {
  let demand, balances;
  try {
    const lines = allocated.flatMap(root => {
      if (String(root.item_type) !== '3') return [root];
      if (!root.sub_item?.length) throw unavailable();
      return root.sub_item.map(child => ({ ...child, wh_code: root.wh_code, shelf_code: root.shelf_code }));
    });
    if (!lines.length || lines.some(row => !isSafeErpCode(row.item_code))) throw unavailable();
    const codes = [...new Set(lines.map(row => row.item_code))];
    const units = await client.query('SELECT ic_code,code,ratio,stand_value,divide_value FROM ic_unit_use WHERE ic_code=ANY($1) FOR SHARE', [codes]);
    const byUnit = new Map(units.rows.map(row => [JSON.stringify([row.ic_code, row.code]), row]));
    demand = new Map();
    for (const row of lines) {
      const unit = byUnit.get(JSON.stringify([row.item_code, row.unit_code]));
      // ERP detail.ratio is intentionally zero; use the master conversion just
      // like the physical-stock options API, not the persisted detail ratio.
      const factor = Number(unit?.ratio) > 0 ? Number(unit.ratio)
        : Number(unit?.stand_value) > 0 && Number(unit?.divide_value) > 0 ? Number(unit.stand_value) / Number(unit.divide_value) : NaN;
      const qty = Number(row.qty) * factor;
      if (!Number.isFinite(qty) || qty <= 0) throw unavailable();
      const key = keyOf(row);
      const entry = demand.get(key) || { item_code: row.item_code, wh_code: row.wh_code, shelf_code: row.shelf_code, required_qty: 0 };
      entry.required_qty += qty;
      demand.set(key, entry);
    }
    balances = new Map();
    for (const row of await readPhysicalStock(client, codes)) {
      if (row.balance_qty == null || !Number.isFinite(Number(row.balance_qty))) throw unavailable();
      const key = keyOf(row);
      balances.set(key, (balances.get(key) || 0) + Number(row.balance_qty));
    }
  } catch (error) {
    console.warn('Pending confirmation stock check failed:', error.message);
    throw unavailable();
  }
  const shortages = [...demand.entries()].flatMap(([key, row]) => {
    const available = balances.get(key) ?? 0;
    // Only tolerate floating-point summation noise, not a business quantity gap.
    const epsilon = Number.EPSILON * Math.max(1, Math.abs(available), row.required_qty) * 16;
    return row.required_qty - available > epsilon ? [{ ...row, available_qty: available }] : [];
  });
  if (shortages.length) {
    throw Object.assign(new Error('สต๊อกไม่พอ ณ คลัง/ที่เก็บที่เลือก ยังไม่สร้าง QT กรุณาแก้ไขการจัดสรร'), {
      statusCode: 422, code: 'INSUFFICIENT_STOCK', stock_issues: shortages,
    });
  }
}

module.exports = { validatePendingStock };
