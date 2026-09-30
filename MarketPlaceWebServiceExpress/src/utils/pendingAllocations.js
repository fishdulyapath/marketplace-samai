const { checkErpCodes, isSafeErpCode } = require('./erpCodeGuard');
const { readPhysicalStock } = require('./groupedStock');

const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
function quantityAtoms(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) throw invalid('จำนวนจัดสรรต้องมากกว่า 0 และไม่เกิน 1,000,000,000');
  const text = typeof value === 'number' ? value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') : String(value).trim();
  if (Number(text) <= 0 || Math.abs(n - Number(text)) > Number.EPSILON * Math.max(1, n)) throw invalid('จำนวนจัดสรรรองรับทศนิยมไม่เกิน 8 ตำแหน่ง');
  if (!/^\d+(\.\d{1,8})?$/.test(text)) throw invalid('จำนวนจัดสรรต้องเป็นตัวเลข ทศนิยมไม่เกิน 8 ตำแหน่ง');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
}

function normalizeAllocations(roots, allocations) {
  if (!Array.isArray(allocations) || !allocations.length || allocations.length > 2000) throw invalid('กรุณาจัดสรรสินค้าให้ครบทุกบรรทัด');
  const source = new Map(roots.map(row => [Number(row.line_number), row]));
  const result = new Map(roots.map(row => [Number(row.line_number), []]));
  for (const allocation of allocations) {
    const line = Number(allocation?.line_number);
    const root = source.get(line);
    if (!root) throw invalid('ไม่พบบรรทัดต้นทางของการจัดสรร');
    const legacy = allocation.item_code === undefined && allocation.qty === undefined;
    if (!legacy && (allocation.item_code === undefined || allocation.qty === undefined)) throw invalid('กรุณาระบุรหัสสินค้าและจำนวนจัดสรร');
    const item_code = String(legacy ? root.item_code : allocation.item_code).trim();
    const qty = legacy ? root.qty : allocation.qty;
    const wh_code = String(allocation.wh_code || '').trim();
    const shelf_code = String(allocation.shelf_code || '').trim();
    const error = checkErpCodes({ item_code, wh_code, shelf_code });
    if (!item_code || !wh_code || !shelf_code || error) throw invalid(error || 'กรุณาเลือกสินค้า คลัง และที่เก็บให้ครบ');
    const atoms = quantityAtoms(qty);
    result.get(line).push({ item_code, qty: Number(qty), wh_code, shelf_code, atoms, legacy });
  }
  for (const root of roots) {
    const selected = result.get(Number(root.line_number));
    if (!selected.length || selected.reduce((sum, row) => sum + row.atoms, 0n) !== quantityAtoms(root.qty)) throw invalid(`จำนวนจัดสรร ${root.item_code} ต้องรวมเท่ากับ ${root.qty} ${root.unit_code}`);
    if (selected.length > 1 && selected.some(row => row.legacy)) throw invalid('ข้อมูลจัดสรรแบบเดิมใช้ได้เพียงหนึ่งรายการต่อบรรทัด');
    if (String(root.item_type) === '3' && (selected.length !== 1 || selected[0].item_code !== root.item_code)) throw invalid('สินค้าชุดยังไม่รองรับการเปลี่ยนหรือแบ่งรหัส');
    const keys = selected.map(row => `${row.item_code}\0${row.wh_code}\0${row.shelf_code}`);
    if (new Set(keys).size !== keys.length) throw invalid('สินค้า คลัง และที่เก็บซ้ำกัน กรุณารวมจำนวนในรายการเดียว');
  }
  return result;
}

function conversion(unit) {
  const stand = Number(unit?.stand_value);
  const divide = Number(unit?.divide_value);
  return stand > 0 && divide > 0 ? stand / divide : null;
}

async function loadOptions(client, source, { lock = false, stock = false } = {}) {
  const inventory = await client.query(
    `SELECT code,name_1,name_eng_2,COALESCE(item_type,0) AS item_type,COALESCE(tax_type,0) AS tax_type
     FROM ic_inventory WHERE code=$1 OR name_eng_2=$1 ORDER BY code ${lock ? 'FOR SHARE' : ''}`, [source.item_code]);
  const codes = inventory.rows.map(row => row.code);
  const units = await client.query(`SELECT ic_code,code,stand_value,divide_value,ratio FROM ic_unit_use WHERE ic_code=ANY($1) AND code=$2 ${lock ? 'FOR SHARE' : ''}`, [codes, source.unit_code]);
  const byCode = new Map(units.rows.map(row => [row.ic_code, row]));
  const sourceFactor = conversion(source) || conversion(byCode.get(source.item_code));
  const sourceRatio = Number(byCode.get(source.item_code)?.ratio) || sourceFactor;
  const options = inventory.rows.map(row => {
    const original = row.code === source.item_code;
    const unit = byCode.get(row.code);
    let reason = '';
    if (!isSafeErpCode(row.code)) reason = 'รหัสสินค้ามีอักขระที่ไม่รองรับ';
    else if (!original && (String(source.item_type) === '3' || Number(row.item_type) === 3)) reason = 'ไม่รองรับการเปลี่ยนเป็นสินค้าชุด';
    else if (!original && Number(row.tax_type) !== Number(source.tax_type || 0)) reason = 'ประเภทภาษีไม่ตรงกับคำขอ';
    else if (!original && (!sourceFactor || !conversion(unit) || Math.abs(conversion(unit) - sourceFactor) > 1e-9 || Math.abs((Number(unit.ratio) || conversion(unit)) - sourceRatio) > 1e-9)) reason = 'หน่วยหรืออัตราแปลงไม่ตรงกับคำขอ';
    return {
      item_code: row.code, item_name: row.name_1 || row.code, is_original: original,
      unit_code: source.unit_code, stand_value: unit?.stand_value, divide_value: unit?.divide_value,
      unit_ratio: Number(unit?.ratio) > 0 ? Number(unit.ratio) : conversion(unit),
      selectable: !reason, disabled_reason: reason, balance_qty: null, locations: [],
    };
  }).sort((a, b) => Number(b.is_original) - Number(a.is_original) || a.item_code.localeCompare(b.item_code));
  if (!stock) return { options };
  let stockError = '';
  try {
    const rows = await readPhysicalStock(client, codes);
    const [warehouses, shelves] = await Promise.all([
      client.query('SELECT code,name_1 FROM ic_warehouse'), client.query('SELECT whcode,code,name_1 FROM ic_shelf'),
    ]);
    for (const option of options) {
      const locations = new Map();
      for (const row of rows.filter(row => row.ic_code === option.item_code)) {
        const key = `${row.wh_code}\0${row.shelf_code}`;
        const location = locations.get(key) || { wh_code: row.wh_code, shelf_code: row.shelf_code, balance_qty: 0,
          wh_name: warehouses.rows.find(w => w.code === row.wh_code)?.name_1 || row.wh_code,
          shelf_name: shelves.rows.find(s => s.whcode === row.wh_code && s.code === row.shelf_code)?.name_1 || row.shelf_code };
        location.balance_qty += Number(row.balance_qty || 0) / (option.unit_ratio || 1);
        locations.set(key, location);
      }
      option.locations = [...locations.values()];
      option.balance_qty = option.locations.reduce((sum, row) => sum + row.balance_qty, 0);
    }
  } catch (error) {
    console.warn('Pending allocation stock unavailable:', error.message);
    stockError = 'โหลดสต๊อกไม่สำเร็จ ยอดที่ไม่ทราบไม่ใช่ศูนย์ สามารถลองโหลดใหม่ได้';
  }
  return { options, stock_error: stockError };
}

function distributeAmount(amount, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let previous = 0, cumulative = 0;
  return weights.map(weight => {
    cumulative += weight;
    const target = Math.round(Number(amount || 0) * 100 * cumulative / total);
    const result = (target - previous) / 100;
    previous = target;
    return result;
  });
}

async function allocateLines(client, roots, selected) {
  const result = [];
  const locations = new Set();
  for (const root of roots) {
    const allocations = selected.get(Number(root.line_number));
    const isSet = String(root.item_type) === '3';
    const { options } = isSet ? { options: [] } : await loadOptions(client, root, { lock: true });
    const weights = allocations.map(row => row.qty);
    const amounts = Object.fromEntries(['sum_amount', 'sum_amount_exclude_vat', 'total_vat_value', 'discount_amount'].map(key => [key, distributeAmount(root[key], weights)]));
    const grossDiscount = distributeAmount(Number(root.price) * Number(root.qty) - Number(root.sum_amount), weights);
    for (let i = 0; i < allocations.length; i++) {
      const allocation = allocations[i];
      const option = options.find(row => row.item_code === allocation.item_code);
      if (!isSet && (!option || !option.selectable)) throw invalid(option?.disabled_reason || `สินค้า ${allocation.item_code} ไม่อยู่ในกลุ่ม ${root.item_code}`);
      const key = `${allocation.wh_code}\0${allocation.shelf_code}`;
      if (!locations.has(key)) {
        const valid = await client.query('SELECT 1 FROM ic_warehouse w JOIN ic_shelf s ON s.whcode=w.code WHERE w.code=$1 AND s.code=$2 LIMIT 1', [allocation.wh_code, allocation.shelf_code]);
        if (!valid.rows.length) throw invalid(`ไม่พบคลัง/ที่เก็บ ${allocation.wh_code} / ${allocation.shelf_code} ใน master`);
        locations.add(key);
      }
      const changed = allocation.item_code !== root.item_code;
      const barcode = changed ? await client.query('SELECT barcode FROM ic_inventory_barcode WHERE ic_code=$1 AND unit_code=$2 ORDER BY barcode LIMIT 1', [allocation.item_code, root.unit_code]) : null;
      const row = { ...root, item_code: allocation.item_code, qty: allocation.qty, wh_code: allocation.wh_code, shelf_code: allocation.shelf_code,
        __source_line: Number(root.line_number), __source_item: root.item_code,
        item_name: changed ? option.item_name : root.item_name,
        barcode: changed ? barcode.rows[0]?.barcode || '' : root.barcode,
        stand_value: changed ? option.stand_value : root.stand_value,
        divide_value: changed ? option.divide_value : root.divide_value,
      };
      if (!isSet) {
        for (const key of Object.keys(amounts)) row[key] = amounts[key][i];
        if (allocations.length > 1 && root.discount) row.discount = String(grossDiscount[i]);
      }
      result.push(row);
    }
  }
  return result;
}

module.exports = { quantityAtoms, normalizeAllocations, loadOptions, allocateLines, distributeAmount };
