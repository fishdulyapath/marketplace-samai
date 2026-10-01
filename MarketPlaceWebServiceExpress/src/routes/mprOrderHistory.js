const express = require('express');
const { query } = require('../db');
const { pendingIdentity, pendingAdmin } = require('../auth/pendingOrderAuth');
const { MAIN_DOC_NO_SQL, isValidDocNoParam } = require('../utils/orderDocNo');
const { marketplaceDocWhere } = require('../utils/marketplaceSalesSettings');
const { resolveDateRange, isIsoDate } = require('../utils/adminOrderFilters');
const { serverDocDate } = require('../utils/serverTime');
const { aggregateOrderRowsByMainDoc } = require('../utils/orderHistoryAggregate');
const { readRequest, fail } = require('../utils/pendingOrder');
const { qtNumbers, projectHeader, projectItems } = require('../utils/mprOrderHistory');
const { likeContains } = require('../utils/likePattern');

module.exports = function mprOrderHistory({ orderHistoryCte, mapOrderRow, orderRowKey, legacyOrderDetail }) {
  const router = express.Router();
  const view = (req, res, next) => req.query.view === 'mpr' ? next() : next('route');
  const employeePermission = (req, res, next) => {
    if (req.auth.isEmployee) return pendingAdmin(req, res, next);
    if (req.query.cust_code && String(req.query.cust_code).toUpperCase() !== req.auth.userCode.toUpperCase()) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลลูกค้ารายนี้' });
    }
    req.query.cust_code = req.auth.userCode;
    next();
  };
  const handle = handler => async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      if (!error.statusCode) console.error('MPR history:', error.message);
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'โหลดคำสั่งซื้อไม่สำเร็จ' });
    }
  };
  const customer = (req, admin) => admin ? null : req.auth.isEmployee ? String(req.query.cust_code || '') : req.auth.userCode;
  async function operationalRows(numbers) {
    if (!numbers.length) return [];
    const result = await query(orderHistoryCte('ic_qt.doc_no = ANY($1::text[])'), [numbers]);
    const rows = [...new Map(result.rows.map(row => [orderRowKey(row), row])).values()];
    const invoiceNos = [...new Set(rows.map(row => row.inv_doc_no).filter(Boolean))];
    if (invoiceNos.length) {
      const invoices = await query(`SELECT t.doc_no,t.doc_date::text AS doc_date,
        GREATEST(0,COALESCE(t.total_amount,0)-COALESCE((SELECT SUM(COALESCE(p.sum_pay_money,0))
          FROM ap_ar_trans_detail p WHERE p.billing_no=t.doc_no AND p.billing_date=t.doc_date
          AND p.trans_flag=239 AND COALESCE(p.last_status,0)=0),0)
          -COALESCE((SELECT MAX(cb.total_amount_pay) FROM cb_trans cb WHERE cb.doc_no=t.doc_no),0)) AS balance
        FROM ic_trans t WHERE t.trans_flag=44 AND COALESCE(t.last_status,0)=0 AND t.doc_no=ANY($1::text[])`, [invoiceNos]);
      const byInvoice = new Map(invoices.rows.map(row => [row.doc_no, row]));
      const counted = new Set();
      for (const row of rows) {
        const invoice = byInvoice.get(row.inv_doc_no);
        if (!invoice) continue;
        row.inv_doc_date = invoice.doc_date;
        row.payment_balance = Number(invoice.balance);
        if (row.status === 'success' && row.payment_balance > 0) row.status = 'payment';
        row.balance = counted.has(invoice.doc_no) ? 0 : Number(invoice.balance);
        if (counted.has(invoice.doc_no)) row.invoiced_amount = 0;
        counted.add(invoice.doc_no);
      }
    }
    return rows;
  }
  const aggregate = rows => aggregateOrderRowsByMainDoc(rows).map(group => {
    const related = rows.filter(row => (row.main_doc_no || row.doc_no) === group.doc_no);
    const invoices = new Map();
    for (const row of related) if (row.inv_doc_no && row.payment_balance > 0 && row.status !== 'cancel') {
      invoices.set(row.inv_doc_no, { doc_no: row.inv_doc_no, doc_date: row.inv_doc_date, total_amount: row.payment_balance });
    }
    return { ...mapOrderRow(group), payment_documents: [...invoices.values()] };
  });
  const requestSelect = `SELECT p.*, t.doc_date::text AS doc_date, t.doc_time, t.send_type,
    t.total_amount,t.total_before_vat,t.total_except_vat,t.total_after_vat,t.total_vat_value,t.total_discount,t.remark,
    c.name_1 AS cust_name, s.transport_name AS address,s.transport_address AS address_name,s.transport_telephone AS telephone
    FROM marketplace_pending_order p JOIN ic_trans t ON t.doc_no=p.doc_no AND t.trans_flag=300
    LEFT JOIN ar_customer c ON c.code=p.cust_code
    LEFT JOIN LATERAL (SELECT * FROM ic_trans_shipment WHERE doc_no=p.doc_no AND trans_flag=300 LIMIT 1) s ON TRUE`;

  const list = admin => handle(async (req, res) => {
    const owner = customer(req, admin);
    if (!admin && !owner) throw fail('กรุณาระบุลูกค้า', 400);
    const range = admin ? resolveDateRange(req.query.date_from, req.query.date_to, serverDocDate())
      : { dateFrom: req.query.date_from || null, dateTo: req.query.date_to || null };
    if (range.error || (range.dateFrom && !isIsoDate(range.dateFrom)) || (range.dateTo && !isIsoDate(range.dateTo))
      || (range.dateFrom && range.dateTo && range.dateFrom > range.dateTo)) throw fail(range.error || 'ช่วงวันที่ไม่ถูกต้อง', 400);
    const params = [owner, range.dateFrom, range.dateTo];
    const requests = await query(`${requestSelect} WHERE ($1::text IS NULL OR p.cust_code=$1)
      AND ($2::date IS NULL OR t.doc_date >= $2) AND ($3::date IS NULL OR t.doc_date <= $3)`, params);
    // Exclude linked quotes against ALL lifecycles, not only requests in the selected date range.
    const legacy = await query(`SELECT t.doc_no, ${MAIN_DOC_NO_SQL('t')} AS main_doc_no,t.doc_date::text AS doc_date,t.doc_time,
      t.cust_code,c.name_1 AS cust_name,COALESCE(NULLIF(s.transport_telephone,''),c.telephone,'') AS contact_telephone,
      COALESCE(s.transport_name,'') AS ship_address FROM ic_trans t LEFT JOIN ar_customer c ON c.code=t.cust_code
      LEFT JOIN LATERAL (SELECT * FROM ic_trans_shipment WHERE doc_no=t.doc_no AND trans_flag=30 LIMIT 1) s ON TRUE
      WHERE t.trans_flag=30 ${marketplaceDocWhere('t')} AND COALESCE(t.approve_code::text,'0') <> '0'
      AND ($1::text IS NULL OR t.cust_code=$1)
      AND NOT EXISTS (SELECT 1 FROM marketplace_pending_order p WHERE p.cust_code=t.cust_code AND
        (p.doc_no=t.doc_ref OR p.qt_doc_no=t.doc_no OR COALESCE(p.qt_doc_nos,'[]'::jsonb) ? t.doc_no))
      AND EXISTS (SELECT 1 FROM ic_trans sibling WHERE sibling.trans_flag=30 AND sibling.cust_code=t.cust_code
        AND ${MAIN_DOC_NO_SQL('sibling')} = ${MAIN_DOC_NO_SQL('t')}
        AND ($2::date IS NULL OR sibling.doc_date >= $2) AND ($3::date IS NULL OR sibling.doc_date <= $3))`, params);
    const numbers = [...new Set([...requests.rows.flatMap(qtNumbers), ...legacy.rows.map(row => row.doc_no)])];
    const operational = await operationalRows(numbers);
    const byQt = new Map();
    for (const row of operational) { const group = byQt.get(row.doc_no) || []; group.push(row); byQt.set(row.doc_no, group); }
    let data = requests.rows.map(p => {
      const rows = qtNumbers(p).flatMap(no => byQt.get(no) || []).map(row => ({ ...row, main_doc_no: p.doc_no }));
      return projectHeader(p, p, aggregate(rows)[0]);
    });
    const legacyNos = new Set(legacy.rows.map(row => row.doc_no));
    const legacyCustomers = new Map(legacy.rows.map(row => [row.main_doc_no, row]));
    data.push(...aggregate(operational.filter(row => legacyNos.has(row.doc_no))).map(row => ({
      ...row, order_kind: 'legacy_qt', qt_main_doc_no: row.doc_no,
      qt_doc_nos: [...new Set(row.sub_docs.map(doc => doc.doc_no))], cust_name: legacyCustomers.get(row.doc_no)?.cust_name || '',
      contact_telephone: legacyCustomers.get(row.doc_no)?.contact_telephone || '', ship_address: legacyCustomers.get(row.doc_no)?.ship_address || '',
      can_cancel: row.status === 'pending' && row.sub_docs.every(doc => doc.status === 'pending'),
    })));
    const search = String(req.query.search || '').trim().toLowerCase();
    if (search) {
      // Customer product search uses original MPR products, never physical allocation codes.
      const matches = await query(`SELECT DISTINCT doc_no FROM ic_trans_detail WHERE doc_no=ANY($1::text[])
        AND trans_flag IN (30,300) AND (item_code ILIKE $2 OR item_name ILIKE $2)`,
      [[...requests.rows.map(row => row.doc_no), ...legacyNos], likeContains(search)]);
      const matchingDocs = new Set(matches.rows.map(row => row.doc_no));
      data = data.filter(row => [row.doc_no, row.cust_code, row.cust_name, ...(row.qt_doc_nos || [])].some(value => String(value || '').toLowerCase().includes(search))
        || matchingDocs.has(row.doc_no) || (row.order_kind === 'legacy_qt' && row.qt_doc_nos.some(no => matchingDocs.has(no))));
    }
    data.sort((a, b) => `${b.doc_date} ${b.doc_time} ${b.doc_no}`.localeCompare(`${a.doc_date} ${a.doc_time} ${a.doc_no}`));
    const statusCounts = {};
    for (const row of data) statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    const status = String(req.query.status || '');
    if (status) data = data.filter(row => row.status === status);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.min(200, Math.max(1, parseInt(req.query.page_size, 10) || 40));
    const total = data.length;
    data = data.slice((page - 1) * size, page * size);
    res.json({ success: true, data, page, page_size: size, total_orders: total, status_counts: statusCounts,
      page_amount: data.reduce((sum, row) => sum + Number(row.total_amount || 0), 0), date_from: range.dateFrom, date_to: range.dateTo });
  });
  router.get('/getOrderHistory', view, pendingIdentity, employeePermission, list(false));
  router.get('/admin/orders', view, pendingIdentity, pendingAdmin, list(true));

  async function findRequest(req, admin) {
    const doc = String(req.params.orderNo || req.query.doc_no || '');
    if (!isValidDocNoParam(doc)) throw fail('เลขเอกสารไม่ถูกต้อง', 400);
    const owner = customer(req, admin);
    if (!admin && !owner) throw fail('กรุณาระบุลูกค้า', 400);
    const result = await query(`SELECT * FROM marketplace_pending_order WHERE
      (doc_no=$1 OR qt_doc_no=$1 OR COALESCE(qt_doc_nos,'[]'::jsonb) ? $1)
      AND ($2::text IS NULL OR cust_code=$2)`, [doc, owner]);
    return result.rows[0];
  }
  router.get('/getOrderHeader', view, pendingIdentity, employeePermission, handle(async (req, res, next) => {
    const pending = await findRequest(req, false);
    if (!pending) return next(); // Authenticated legacy QT compatibility.
    const { header } = await readRequest({ query }, pending.doc_no);
    const rows = (await operationalRows(qtNumbers(pending))).map(row => ({ ...row, main_doc_no: pending.doc_no }));
    res.json({ success: true, data: projectHeader(pending, header, aggregate(rows)[0]) });
  }));
  const detail = admin => handle(async (req, res, next) => {
    const pending = await findRequest(req, admin);
    if (!pending) {
      if (admin) {
        // Delegate only after verifying the staff permission; retain legacy details and shipment behavior.
        req.query.doc_no = req.params.orderNo;
        if (!req.query.cust_code) throw fail('กรุณาระบุลูกค้า', 400);
        return legacyOrderDetail(req, res);
      }
      return next();
    }
    const { rows } = await readRequest({ query }, pending.doc_no);
    const numbers = qtNumbers(pending);
    const qt = numbers.length ? await query(`SELECT d.* FROM ic_trans_detail d JOIN ic_trans t ON t.doc_no=d.doc_no AND t.trans_flag=30
      WHERE d.doc_no=ANY($1::text[]) AND d.trans_flag=30 AND t.cust_code=$2 ORDER BY d.doc_no,d.line_number`, [numbers, pending.cust_code]) : { rows: [] };
    const shipped = numbers.length ? await query(`SELECT ap.billing_no AS qt_doc_no,sd.* FROM
      (SELECT DISTINCT billing_no,doc_no FROM ap_ar_trans_detail WHERE trans_flag=36 AND billing_no=ANY($1::text[])) ap
      JOIN ic_trans t ON t.doc_no=ap.doc_no AND t.trans_flag=36 AND t.cust_code=$2
      JOIN ic_trans_detail sd ON sd.doc_no=t.doc_no AND sd.trans_flag=36
      WHERE COALESCE(sd.set_ref_line,'')='' ORDER BY ap.billing_no,sd.doc_no,sd.line_number`, [numbers, pending.cust_code]) : { rows: [] };
    const progressRows = await operationalRows(numbers);
    const hasShipment = progressRows.some(row => row.so_doc_no) || shipped.rows.length > 0;
    const projected = projectItems(rows, qt.rows, pending, { staff: admin, shipped: shipped.rows, hasShipment, progressRows });
    const needle = String(req.query.q || '').trim().toLowerCase();
    const matches = item => [item.item_code, item.item_name].some(value => String(value || '').toLowerCase().includes(needle));
    const items = projected.items.filter(item => !needle || matches(item) || item.sub_item.some(matches) || (admin && item.qt_allocations.some(matches)));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 20));
    res.json({ success: true, has_shipment: hasShipment, data: { doc_no: pending.doc_no, ...projected, items: items.slice((page - 1) * size, page * size) },
      paging: { page, page_size: size, total_items: items.length, total_pages: Math.max(1, Math.ceil(items.length / size)) } });
  });
  router.get('/getOrderDetail', view, pendingIdentity, employeePermission, detail(false));
  router.get('/admin/orders/:orderNo/items', pendingIdentity, pendingAdmin, detail(true));
  return router;
};
