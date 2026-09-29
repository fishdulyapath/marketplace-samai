const express = require('express');
const { query, withTransaction } = require('../db');
const { pendingIdentity, pendingAdmin } = require('../auth/pendingOrderAuth');
const { likeContains } = require('../utils/likePattern');
const { isIsoDate } = require('../utils/adminOrderFilters');
const { isValidDocNoParam } = require('../utils/orderDocNo');
const { rootLines, lockRequest, readRequest, confirmRequest, closeRequest, fail } = require('../utils/pendingOrder');

module.exports = function pendingOrders(summarizeOrderVat) {
  const router = express.Router();
  const action = handler => async (req, res) => {
    try { return res.json({ success: true, ...await handler(req) }); }
    catch (error) {
      if (!error.statusCode) console.error('pending order action:', error.message);
      return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่' });
    }
  };
  const owner = (req, pending) => {
    if (!req.auth.isEmployee && pending.cust_code.toUpperCase() !== req.auth.userCode.toUpperCase()) throw fail('ไม่มีสิทธิ์เข้าถึงคำขอนี้', 403);
  };
  const docNo = req => {
    if (!isValidDocNoParam(req.params.docNo)) throw fail('เลขคำขอไม่ถูกต้อง', 400);
    return req.params.docNo;
  };
  const list = admin => action(async req => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = 20;
    const from = req.query.date_from || null;
    const to = req.query.date_to || null;
    if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to)) throw fail('ช่วงวันที่ไม่ถูกต้อง', 400);
    const customer = admin ? null : (req.auth.isEmployee ? String(req.query.cust_code || '') : req.auth.userCode);
    const params = [customer, likeContains(String(req.query.search || '').trim()), from, to];
    const where = `FROM marketplace_pending_order p JOIN ic_trans t ON t.doc_no=p.doc_no AND t.trans_flag=300
      LEFT JOIN ar_customer c ON c.code=p.cust_code
      WHERE ${admin ? "p.status='pending'" : "p.status IN ('pending','cancelled','rejected')"}
      AND ($1::text IS NULL OR p.cust_code=$1)
      AND (p.doc_no ILIKE $2 OR p.cust_code ILIKE $2 OR c.name_1 ILIKE $2)
      AND ($3::date IS NULL OR t.doc_date >= $3::date) AND ($4::date IS NULL OR t.doc_date <= $4::date)`;
    const total = await query(`SELECT COUNT(*)::int AS total ${where}`, params);
    const result = await query(`SELECT p.doc_no,p.cust_code,p.status,p.reason,p.created_at,p.acted_at,p.acted_by,
      t.doc_date::text AS doc_date,t.doc_time,t.total_amount,c.name_1 AS cust_name ${where}
      ORDER BY p.created_at DESC,p.doc_no DESC LIMIT $5 OFFSET $6`, [...params, size, (page - 1) * size]);
    return { data: result.rows, total: total.rows[0].total, page, page_size: size };
  });
  router.get('/admin/pending-orders', pendingIdentity, pendingAdmin, list(true));
  router.get('/pending-orders', pendingIdentity, (req, res, next) => req.auth.isEmployee ? pendingAdmin(req, res, next) : next(), list(false));
  router.get('/pending-orders/:docNo', pendingIdentity, action(async req => {
    const found = await query('SELECT * FROM marketplace_pending_order WHERE doc_no=$1', [docNo(req)]);
    if (!found.rows.length) throw fail('ไม่พบคำขอ', 404);
    owner(req, found.rows[0]);
    // Staff reads require the same permission as mutations.
    if (req.auth.isEmployee) {
      const { getAdminPermissionsForUser } = require('../utils/adminPermissions');
      const info = await getAdminPermissionsForUser(req.auth.userCode);
      if (!info.is_superadmin && !info.permissions.includes('admin.orders')) throw fail('ไม่มีสิทธิ์จัดการคำสั่งซื้อ', 403);
    }
    const { header, rows } = await readRequest({ query }, req.params.docNo);
    const p = found.rows[0];
    return { data: { ...header, status: p.status, reason: p.reason, qt_doc_no: p.qt_doc_no, items: rootLines(rows) } };
  }));
  router.post('/admin/pending-orders/:docNo/confirm', pendingIdentity, pendingAdmin, action(req =>
    withTransaction(async client => confirmRequest(client, await lockRequest(client, docNo(req)), req.body.allocations, req.auth.userCode, summarizeOrderVat))));
  router.post('/admin/pending-orders/:docNo/reject', pendingIdentity, pendingAdmin, action(async req => {
    const reason = String(req.body.reason || '').trim();
    if (!reason || reason.length > 1000) throw fail('กรุณาระบุเหตุผลปฏิเสธ (ไม่เกิน 1,000 ตัวอักษร)', 400);
    return withTransaction(async client => closeRequest(client, await lockRequest(client, docNo(req)), 'rejected', req.auth.userCode, reason));
  }));
  router.post('/pending-orders/:docNo/cancel', pendingIdentity, action(req => withTransaction(async client => {
    const pending = await lockRequest(client, docNo(req));
    owner(req, pending);
    if (req.auth.isEmployee) throw fail('การยกเลิกคำขอนี้สำหรับบัญชีลูกค้า', 403);
    return closeRequest(client, pending, 'cancelled', req.auth.userCode);
  })));
  return router;
};
