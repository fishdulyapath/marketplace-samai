const { normalizeAllocations, allocateLines } = require('./pendingAllocations');
const { splitItemsIntoDocuments } = require('./orderDocSplit');
const { resolveMainDocNo, formatSubDocNo } = require('./orderDocNo');
const { getOrderDocPattern, getErpMaxLinesPerDoc } = require('./marketplaceSalesSettings');
const { serverDocDate, serverDocTime } = require('./serverTime');

function fail(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

function requestMetadata(items, discountWord, discountType, discountVatType) {
  let line = 1;
  const groups = {};
  for (const item of items) {
    if (item.__group_id) groups[line] = item.__group_id;
    line += 1 + (String(item.item_type) === '3' ? (item.sub_item || []).length : 0);
  }
  return { groups, discount_word: discountWord, discount_type: discountType, discount_vat_type: discountVatType };
}

function rootLines(rows, metadata = {}) {
  return rows.filter(row => !String(row.set_ref_line || '').trim()).map(row => ({
    ...row,
    __group_id: metadata.groups?.[row.line_number],
    sub_item: String(row.item_type) === '3'
      ? rows.filter(child => child.set_ref_line && child.set_ref_line === row.ref_guid) : [],
  }));
}

const validateAllocations = normalizeAllocations;

async function lockRequest(client, docNo) {
  const result = await client.query('SELECT * FROM marketplace_pending_order WHERE doc_no=$1 FOR UPDATE', [docNo]);
  if (!result.rows.length) throw fail('ไม่พบคำขอสั่งซื้อ', 404);
  return result.rows[0];
}

async function readRequest(client, docNo) {
  const header = await client.query(
    `SELECT t.*, t.doc_date::text AS doc_date,
       COALESCE(c.name_1,'') AS cust_name, s.transport_name AS address,
       s.transport_address AS address_name, s.transport_telephone AS telephone
     FROM ic_trans t LEFT JOIN ar_customer c ON c.code=t.cust_code
     LEFT JOIN ic_trans_shipment s ON s.doc_no=t.doc_no AND s.trans_flag=300
     WHERE t.doc_no=$1 AND t.trans_flag=300`, [docNo]);
  if (!header.rows.length) throw fail('ไม่พบเอกสารคำขอ', 404);
  const detail = await client.query('SELECT * FROM ic_trans_detail WHERE doc_no=$1 AND trans_flag=300 ORDER BY line_number', [docNo]);
  if (!detail.rows.length) throw fail('ไม่พบรายการสินค้าในคำขอ');
  return { header: header.rows[0], rows: detail.rows };
}

// Explicit ERP columns only: never copy generated IDs, defaults or user-supplied keys.
const HEADER_COLUMNS = `inquiry_type vat_type trans_type trans_flag doc_date doc_no cust_code send_date send_day vat_rate total_value total_vat_value total_after_vat total_amount total_before_vat doc_time doc_format_code creator_code sale_code total_discount remark remark_5 send_type total_except_vat credit_day credit_date branch_code doc_ref doc_ref_date`.split(' ');
const DETAIL_COLUMNS = `set_ref_line set_ref_price set_ref_qty item_type item_code_main ref_guid price_set_ratio inquiry_type vat_type trans_type trans_flag doc_date doc_no cust_code branch_code sale_code item_code item_name unit_code qty price sum_amount line_number remark wh_code shelf_code stand_value divide_value ratio doc_time doc_date_calc discount discount_amount barcode calc_flag tax_type sum_amount_exclude_vat total_vat_value price_exclude_vat is_permium`.split(' ');
async function insertColumns(client, table, columns, values) {
  await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, columns.map(key => values[key] ?? null));
}

// A request can become multiple QTs. Allocate the saved header discount, not its
// percentage expression against only the first chunk (which would change the price).
function distributeMoney(amount, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  let assigned = 0;
  return weights.map((weight, index) => {
    cumulative += weight;
    const target = total ? Math.round(Number(amount) * 100 * cumulative / total) : index === 0 ? Math.round(Number(amount) * 100) : assigned;
    const value = (target - assigned) / 100;
    assigned = target;
    return value;
  });
}

function quoteTotals(chunks, header, metadata, taxMap, summarizeOrderVat) {
  const taxable = chunks.map(chunk => chunk.items.reduce((sum, row) => sum + (Number(row.tax_type) === 1 ? 0 : Number(row.sum_amount)), 0));
  const exempt = chunks.map(chunk => chunk.items.reduce((sum, row) => sum + (Number(row.tax_type) === 1 ? Number(row.sum_amount) : 0), 0));
  const discount = Number(header.total_discount || 0);
  let discounts;
  if (Number(metadata.discount_type) === 1 && [0, 1].includes(Number(header.vat_type))) {
    const exemptDiscount = exempt.reduce((a, b) => a + b, 0) - Number(header.total_except_vat);
    const taxParts = distributeMoney(discount - exemptDiscount, taxable);
    const exemptParts = distributeMoney(exemptDiscount, exempt);
    discounts = taxParts.map((amount, i) => amount + exemptParts[i]);
  } else {
    discounts = distributeMoney(discount, taxable.map((value, i) => value + exempt[i]));
  }
  const totals = chunks.map((chunk, i) => summarizeOrderVat(chunk.items, taxMap, Number(header.vat_type), Number(header.vat_rate),
    String(discounts[i]), metadata.discount_type, metadata.discount_vat_type));
  // Reconcile per-document rounding against the immutable request snapshot.
  const fields = { totalValue: 'total_value', totalDiscount: 'total_discount', totalBeforeVat: 'total_before_vat', totalVatValue: 'total_vat_value', totalAfterVat: 'total_after_vat', totalExceptVat: 'total_except_vat' };
  for (const [key, column] of Object.entries(fields)) {
    const weights = key === 'totalExceptVat' ? exempt : ['totalBeforeVat', 'totalVatValue', 'totalAfterVat'].includes(key) ? taxable : taxable.map((value, i) => value + exempt[i]);
    const index = Math.max(0, weights.findLastIndex(weight => weight > 0));
    const delta = Math.round((Number(header[column]) - totals.reduce((sum, row) => sum + row[key], 0)) * 100) / 100;
    totals[index][key] = Math.round((totals[index][key] + delta) * 100) / 100;
  }
  for (const total of totals) {
    total.totalAmount = Math.round((Number(header.vat_type) === 0
      ? total.totalAfterVat + total.totalExceptVat - (Number(metadata.discount_type) === 1 ? 0 : total.totalDiscount)
      : total.totalValue - total.totalDiscount) * 100) / 100;
  }
  return totals;
}

async function confirmRequest(client, pending, allocations, employeeCode, summarizeOrderVat) {
  if (pending.status === 'confirmed') return { duplicate: true, doc_no: pending.qt_doc_no, sub_doc_nos: pending.qt_doc_nos };
  if (pending.status !== 'pending') throw fail('คำขอนี้ถูกยกเลิกหรือปฏิเสธแล้ว กรุณารีเฟรชรายการ');
  const { header, rows } = await readRequest(client, pending.doc_no);
  if (Number(header.last_status || 0) !== 0) throw fail('คำขอนี้ปิดงานแล้ว');
  const roots = rootLines(rows, pending.metadata);
  const selected = validateAllocations(roots, allocations);
  const allocated = await allocateLines(client, roots, selected);
  const date = serverDocDate();
  const time = serverDocTime();
  const serverNumber = pending.doc_source === 'server';
  const chunks = splitItemsIntoDocuments(allocated, serverNumber ? await getErpMaxLinesPerDoc(client) : 0);
  const main = serverNumber
    ? await resolveMainDocNo(client, { pattern: await getOrderDocPattern(client), docDate: date, transFlag: 30, includePendingReservations: true })
    : pending.reserved_qt_no;
  if (!main) throw fail('ไม่พบเลข QT ที่จองไว้');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`sendorder:${main}`]);
  const reservation = await client.query('SELECT doc_no FROM marketplace_pending_order WHERE reserved_qt_no=$1 AND doc_no<>$2', [main, pending.doc_no]);
  if (reservation.rows.length) throw fail('เลข QT ถูกจองโดยคำขออื่นแล้ว กรุณาลองใหม่');
  const numbers = chunks.map((_, i) => formatSubDocNo(main, i + 1, chunks.length));
  const existing = await client.query('SELECT doc_no FROM ic_trans WHERE doc_no=ANY($1) LIMIT 1', [numbers]);
  if (existing.rows.length) throw fail('เลข QT ถูกใช้แล้ว กรุณาติดต่อผู้ดูแลระบบ');
  const taxMap = new Map(allocated.flatMap(row => [row, ...row.sub_item]).map(row => [row.item_code, Number(row.tax_type || 0)]));
  const audit = [];
  const documentTotals = quoteTotals(chunks, header, pending.metadata, taxMap, summarizeOrderVat);
  for (let i = 0; i < chunks.length; i++) {
    const totals = documentTotals[i];
    await insertColumns(client, 'ic_trans', HEADER_COLUMNS, {
      ...header, trans_flag: 30, doc_no: numbers[i], doc_date: date, doc_time: time,
      doc_format_code: 'QT', creator_code: 'market', sale_code: employeeCode,
      doc_ref: pending.doc_no, doc_ref_date: header.doc_date,
      total_value: totals.totalValue, total_discount: totals.totalDiscount,
      total_before_vat: totals.totalBeforeVat, total_vat_value: totals.totalVatValue,
      total_after_vat: totals.totalAfterVat, total_except_vat: totals.totalExceptVat, total_amount: totals.totalAmount,
    });
    let lineNumber = 0;
    for (const root of chunks[i].items) {
      const location = { wh_code: root.wh_code, shelf_code: root.shelf_code };
      audit.push({ source_line_number: root.__source_line, source_item_code: root.__source_item, qt_doc_no: numbers[i], qt_line_number: lineNumber + 1, item_code: root.item_code, qty: root.qty, ...location });
      for (const row of [root, ...root.sub_item]) {
        await insertColumns(client, 'ic_trans_detail', DETAIL_COLUMNS, {
          ...row, ...location, trans_flag: 30, doc_no: numbers[i], doc_date: date, doc_time: time,
          doc_date_calc: date, sale_code: employeeCode, line_number: ++lineNumber,
        });
      }
    }
    await client.query(
      `INSERT INTO ic_trans_shipment (doc_no, doc_date, trans_flag, cust_code, transport_name, transport_address, transport_telephone, create_date_time_now)
       SELECT $1,$2,30,cust_code,transport_name,transport_address,transport_telephone,NOW()
       FROM ic_trans_shipment WHERE doc_no=$3 AND trans_flag=300`, [numbers[i], date, pending.doc_no]);
    await client.query(
      `INSERT INTO marketplace_order_document (sub_doc_no,main_doc_no,seq,doc_kind,request_id,cust_code) VALUES ($1,$2,$3,'ready',$4,$5)`,
      [numbers[i], main, i + 1, pending.request_id, pending.cust_code]);
  }
  await client.query(
    `UPDATE marketplace_pending_order SET status='confirmed', qt_doc_no=$2, qt_doc_nos=$3::jsonb, acted_by=$4, acted_at=NOW(), metadata=metadata || jsonb_build_object('confirmed_allocations',$5::jsonb) WHERE doc_no=$1`,
    [pending.doc_no, main, JSON.stringify(numbers), employeeCode, JSON.stringify(audit)]);
  await client.query('UPDATE ic_trans SET last_status=1 WHERE doc_no=$1 AND trans_flag=300', [pending.doc_no]);
  return { duplicate: false, doc_no: main, sub_doc_nos: numbers, request_doc_no: pending.doc_no };
}

async function closeRequest(client, pending, status, actor, reason = '') {
  if (pending.status === status) return { duplicate: true };
  if (pending.status !== 'pending') throw fail('คำขอถูกดำเนินการแล้ว กรุณารีเฟรชรายการ');
  await client.query('UPDATE marketplace_pending_order SET status=$2, acted_by=$3, reason=$4, acted_at=NOW() WHERE doc_no=$1', [pending.doc_no, status, actor, reason]);
  await client.query('UPDATE ic_trans SET last_status=1 WHERE doc_no=$1 AND trans_flag=300', [pending.doc_no]);
  return { duplicate: false };
}

module.exports = { requestMetadata, rootLines, validateAllocations, lockRequest, readRequest, confirmRequest, closeRequest, fail };
