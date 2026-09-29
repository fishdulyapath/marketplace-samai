// รายงานหลังบ้าน (เมนู "รายงาน" — สิทธิ์ admin.reports)
//   1) ตะกร้าสินค้า: ลูกค้าที่มีของค้างในตะกร้า + เวลา active ล่าสุด
//   2) สินค้าที่แสดงขายบนเว็บ: หน่วยที่เปิดขาย/ซ่อน, จำนวนสั่งสูงสุดต่อหน่วย,
//      หน่วยเริ่มต้นขาย, สินค้าแนะนำ, หมวดหมู่, สถานะ Preorder และจำนวนลูกค้าที่ใส่ตะกร้าค้างไว้
// รายละเอียดสินค้าในตะกร้าของลูกค้ารายคนใช้ /getcartitemlist เดิม (พนักงานส่ง cust_code ได้ตาม auth layer 2)

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { safePage, safePageSize } = require('../utils/response');
const { requireAdmin } = require('../auth/requireAdmin');
const { getPreorderDefaultEnabled, marketplaceDocWhere, resolvePreorderAllowed } = require('../utils/marketplaceSalesSettings');
const { getMaxAllowanceForUnit } = require('../utils/maxAllowance');
const { MAIN_DOC_NO_SQL } = require('../utils/orderDocNo');
const { resolveDateRange } = require('../utils/adminOrderFilters');
const { serverDocDate } = require('../utils/serverTime');
const { likeContains } = require('../utils/likePattern');

function safeText(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

// dimension_37 = CSV ของหน่วยที่ซ่อนจากหน้าเว็บ (pattern เดียวกับ normalizeHiddenOnlineUnits ฝั่งแอดมิน)
function parseHiddenUnits(value) {
  return new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean));
}

// export=1 → ดึงทั้งชุดตาม filter สำหรับทำไฟล์ Excel ฝั่งหน้าจอ (เพดานกันเผลอดึงทั้งฐาน)
const EXPORT_MAX_ROWS = 50000;

function resolvePageWindow(req) {
  if (String(req.query.export || '').trim() === '1') {
    return { page: 1, pageSize: EXPORT_MAX_ROWS, offset: 0 };
  }
  const page = safePage(req.query.page);
  const pageSize = safePageSize(req.query.page_size);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// GET /service/v1/admin/cartcustomers — รายงานตะกร้าสินค้า: สรุปต่อลูกค้า
router.get('/admin/cartcustomers', requireAdmin('admin.reports'), async (req, res) => {
  const search = safeText(req.query.search);
  const page = safePage(req.query.page);
  const pageSize = safePageSize(req.query.page_size);
  const offset = (page - 1) * pageSize;
  const resp = { success: false };

  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = ` WHERE (c.cust_code ILIKE $1 OR COALESCE(a.name_1,'') ILIKE $1)`;
    }
    const baseFrom = ` FROM staff_cart_order c LEFT JOIN ar_customer a ON a.code = c.cust_code${where}`;

    const countResult = await query(`SELECT COUNT(DISTINCT c.cust_code) AS total_count${baseFrom}`, params);
    const totalCount = toInt(countResult.rows[0]?.total_count, 0);

    const dataResult = await query(
      `SELECT c.cust_code,
              COALESCE(MAX(a.name_1),'') AS cust_name,
              COALESCE(MAX(a.telephone),'') AS telephone,
              COUNT(*) AS line_count,
              COALESCE(SUM(c.qty),0) AS total_qty,
              MAX(c.create_datetime) AS last_active
       ${baseFrom}
       GROUP BY c.cust_code
       ORDER BY MAX(c.create_datetime) DESC NULLS LAST, c.cust_code
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    resp.success = true;
    resp.page = page;
    resp.page_size = pageSize;
    resp.total_count = totalCount;
    resp.data = dataResult.rows.map((r) => ({
      cust_code: r.cust_code,
      cust_name: r.cust_name,
      telephone: r.telephone,
      line_count: toInt(r.line_count, 0),
      total_qty: toNumber(r.total_qty, 0),
      last_active: r.last_active,
    }));
    return res.json(resp);
  } catch (ex) {
    console.error('admin/cartcustomers error:', ex.message);
    return res.status(500).json({ error: ex.message });
  }
});

// GET /service/v1/admin/productsonweb — รายงานสินค้าที่แสดงขายบนเว็บ ([W])
router.get('/admin/productsonweb', requireAdmin('admin.reports'), async (req, res) => {
  const search = safeText(req.query.search);
  const { page, pageSize, offset } = resolvePageWindow(req);
  const resp = { success: false };

  try {
    const params = [];
    let where = ` WHERE b.item_pattern = '[W]'`;
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (b.code ILIKE $1 OR COALESCE(b.name_1,'') ILIKE $1)`;
    }

    const countResult = await query(`SELECT COUNT(*) AS total_count FROM ic_inventory b${where}`, params);
    const totalCount = toInt(countResult.rows[0]?.total_count, 0);

    // เงื่อนไขสินค้าแนะนำใช้ชุดเดียวกับ getProductList (feature_type='recommend' + status + ช่วงวันที่)
    const dataResult = await query(
      `SELECT b.code AS item_code,
              COALESCE(b.name_1,'') AS item_name,
              COALESCE(b.item_category,'') AS category_code,
              COALESCE(cat.name_1,'') AS category_name,
              COALESCE(c.dimension_35,'') AS preorder_mode,
              COALESCE(c.dimension_37,'') AS hidden_units_csv,
              COALESCE(c.dimension_38,'') AS max_allowance_csv,
              COALESCE(c.start_sale_unit,'') AS start_sale_unit,
              COALESCE(b.unit_standard,'') AS unit_standard,
              EXISTS (
                SELECT 1 FROM marketplace_featured_product mfp
                WHERE mfp.item_code = b.code
                  AND mfp.feature_type = 'recommend'
                  AND COALESCE(mfp.status,1) = 1
                  AND (mfp.from_date IS NULL OR mfp.from_date <= CURRENT_DATE)
                  AND (mfp.to_date IS NULL OR mfp.to_date >= CURRENT_DATE)
              ) AS is_recommended,
              COALESCE((
                SELECT json_agg(json_build_object('code', u.code, 'ratio', u.ratio)
                                ORDER BY COALESCE(NULLIF(u.ratio,0),1), u.code)
                FROM ic_unit_use u WHERE u.ic_code = b.code
              ), '[]'::json) AS units,
              (SELECT COUNT(DISTINCT s.cust_code) FROM staff_cart_order s WHERE s.item_code = b.code) AS cart_customer_count
       FROM ic_inventory b
       LEFT JOIN ic_inventory_detail c ON c.ic_code = b.code
       LEFT JOIN ic_category cat ON cat.code = b.item_category
       ${where}
       ORDER BY b.code
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    const preorderDefaultEnabled = await getPreorderDefaultEnabled();

    resp.success = true;
    resp.page = page;
    resp.page_size = pageSize;
    resp.total_count = totalCount;
    resp.data = dataResult.rows.map((r) => {
      const hiddenUnits = parseHiddenUnits(r.hidden_units_csv);
      const units = (Array.isArray(r.units) ? r.units : []).map((u) => ({
        code: u.code,
        ratio: toNumber(u.ratio, 1),
        hidden: hiddenUnits.has(String(u.code || '').trim()),
        max_order_qty: getMaxAllowanceForUnit(r.max_allowance_csv, u.code),
      }));
      return {
        item_code: r.item_code,
        item_name: r.item_name,
        category_code: r.category_code,
        category_name: r.category_name,
        start_sale_unit: r.start_sale_unit,
        unit_standard: r.unit_standard,
        is_recommended: Boolean(r.is_recommended),
        preorder_mode: r.preorder_mode || 'default',
        preorder_allowed: Boolean(resolvePreorderAllowed(r.preorder_mode, preorderDefaultEnabled)),
        units,
        cart_customer_count: toInt(r.cart_customer_count, 0),
      };
    });
    return res.json(resp);
  } catch (ex) {
    console.error('admin/productsonweb error:', ex.message);
    return res.status(500).json({ error: ex.message });
  }
});

// GET /service/v1/admin/productcartcustomers?item_code= — ลูกค้าที่ใส่สินค้าตัวนี้ค้างในตะกร้า
router.get('/admin/productcartcustomers', requireAdmin('admin.reports'), async (req, res) => {
  const itemCode = safeText(req.query.item_code);
  const resp = { success: false };
  if (!itemCode) return res.status(400).json({ error: 'item_code is required' });

  try {
    const dataResult = await query(
      `SELECT s.cust_code,
              COALESCE(MAX(a.name_1),'') AS cust_name,
              COALESCE(MAX(a.telephone),'') AS telephone,
              COALESCE(SUM(s.qty),0) AS total_qty,
              MAX(s.create_datetime) AS last_active,
              json_agg(json_build_object('unit_code', s.unit_code, 'qty', s.qty) ORDER BY s.create_datetime) AS lines
       FROM staff_cart_order s
       LEFT JOIN ar_customer a ON a.code = s.cust_code
       WHERE s.item_code = $1
       GROUP BY s.cust_code
       ORDER BY MAX(s.create_datetime) DESC NULLS LAST, s.cust_code`,
      [itemCode],
    );

    resp.success = true;
    resp.data = dataResult.rows.map((r) => ({
      cust_code: r.cust_code,
      cust_name: r.cust_name,
      telephone: r.telephone,
      total_qty: toNumber(r.total_qty, 0),
      last_active: r.last_active,
      lines: Array.isArray(r.lines) ? r.lines.map((line) => ({
        unit_code: line.unit_code,
        qty: toNumber(line.qty, 0),
      })) : [],
    }));
    return res.json(resp);
  } catch (ex) {
    console.error('admin/productcartcustomers error:', ex.message);
    return res.status(500).json({ error: ex.message });
  }
});

// ช่วงวันที่ของรายงานยอด: ไม่ส่งมา = วันนี้วันเดียว (ต่างจากหน้าคำสั่งซื้อที่ default 7 วัน)
// ใช้ resolveDateRange ตัวเดิมเพื่อได้ validation + เพดาน 366 วันชุดเดียวกัน
function resolveReportDateRange(rawFrom, rawTo) {
  const today = serverDocDate();
  return resolveDateRange(String(rawFrom || '').trim() || today, String(rawTo || '').trim() || today, today);
}

// GET /service/v1/admin/marketplaceorderreport — รายงานยอดสั่ง order จาก marketplace
// นับจากใบสั่งซื้อ trans_flag=30 ของ marketplace (เงื่อนไขเดียวกับหน้า "คำสั่งซื้อ")
// เอกสารย่อย BSW...-1/-2 ยุบรวมเป็นใบหลักใบเดียว ยอดรวมคือผลรวมของใบย่อย
router.get('/admin/marketplaceorderreport', requireAdmin('admin.reports'), async (req, res) => {
  const search = safeText(req.query.search);
  const { page, pageSize, offset } = resolvePageWindow(req);
  const resp = { success: false };

  const range = resolveReportDateRange(req.query.date_from, req.query.date_to);
  if (range.error) return res.status(400).json({ error: range.error });

  try {
    const like = search ? likeContains(search) : null;
    // ใบที่ถูกยกเลิก (มี SOC trans_flag=31 อ้างถึง) ยังแสดงในรายการพร้อมป้าย
    // แต่ไม่นับรวมในยอดสรุป เพื่อให้ "ยอดสั่ง" สะท้อนออเดอร์ที่ยังมีผลจริง
    const baseSql = `
      FROM (
        SELECT ${MAIN_DOC_NO_SQL('ic_qt')} AS main_doc_no,
               MIN(ic_qt.doc_date::text) AS doc_date,
               MIN(COALESCE(ic_qt.doc_time,'')) AS doc_time,
               ic_qt.cust_code,
               COALESCE(MAX(cust.name_1),'') AS cust_name,
               SUM(COALESCE(ic_qt.total_amount,0)) AS total_amount,
               BOOL_OR(ic_soc.doc_no IS NOT NULL) AS is_cancelled
        FROM ic_trans ic_qt
        LEFT JOIN ar_customer cust ON cust.code = ic_qt.cust_code
        LEFT JOIN ic_trans ic_soc ON ic_soc.doc_ref = ic_qt.doc_no AND ic_soc.trans_flag = 31
        WHERE ic_qt.trans_flag = 30
          ${marketplaceDocWhere('ic_qt')}
          AND COALESCE(ic_qt.approve_code::text,'0') <> '0'
          AND ic_qt.doc_date BETWEEN $1::date AND $2::date
          AND ($3::text IS NULL
               OR ic_qt.cust_code ILIKE $3
               OR COALESCE(cust.name_1,'') ILIKE $3
               OR ic_qt.doc_no ILIKE $3)
        GROUP BY ${MAIN_DOC_NO_SQL('ic_qt')}, ic_qt.cust_code
      ) o`;
    const params = [range.dateFrom, range.dateTo, like];

    const [summaryRs, dataRs] = await Promise.all([
      query(
        `SELECT COUNT(*) FILTER (WHERE NOT o.is_cancelled) AS order_count,
                COALESCE(SUM(o.total_amount) FILTER (WHERE NOT o.is_cancelled),0) AS total_amount,
                COUNT(*) FILTER (WHERE o.is_cancelled) AS cancelled_count
         ${baseSql}`,
        params,
      ),
      query(
        `SELECT o.* ${baseSql}
         ORDER BY o.doc_date DESC, o.doc_time DESC, o.main_doc_no DESC
         LIMIT $4 OFFSET $5`,
        [...params, pageSize, offset],
      ),
    ]);

    const summary = summaryRs.rows[0] || {};
    resp.success = true;
    resp.page = page;
    resp.page_size = pageSize;
    resp.date_from = range.dateFrom;
    resp.date_to = range.dateTo;
    resp.total_count = toInt(summary.order_count, 0) + toInt(summary.cancelled_count, 0);
    resp.summary = {
      order_count: toInt(summary.order_count, 0),
      total_amount: toNumber(summary.total_amount, 0),
      cancelled_count: toInt(summary.cancelled_count, 0),
    };
    resp.data = dataRs.rows.map((r) => ({
      doc_no: r.main_doc_no,
      doc_date: r.doc_date,
      doc_time: r.doc_time,
      cust_code: r.cust_code,
      cust_name: r.cust_name,
      total_amount: toNumber(r.total_amount, 0),
      is_cancelled: Boolean(r.is_cancelled),
    }));
    return res.json(resp);
  } catch (ex) {
    console.error('admin/marketplaceorderreport error:', ex.message);
    return res.status(500).json({ error: ex.message });
  }
});

// GET /service/v1/admin/marketplacesalereport — รายงานยอดขายจาก marketplace
// ยอดขาย = ใบกำกับ/ใบส่งของ (trans_flag=44) ที่เกิดจากใบสั่งซื้อ marketplace
// ตามสายเอกสารเดียวกับ orderHistoryCte: QT(30) → SO (ap 36) → INV (ap 44 → ic_trans 44)
// กรองด้วยวันที่ของ "ใบขาย" เพราะรายงานนี้ตอบว่าขายจริงไปเท่าไหร่ในช่วงนั้น
router.get('/admin/marketplacesalereport', requireAdmin('admin.reports'), async (req, res) => {
  const search = safeText(req.query.search);
  const { page, pageSize, offset } = resolvePageWindow(req);
  const resp = { success: false };

  const range = resolveReportDateRange(req.query.date_from, req.query.date_to);
  if (range.error) return res.status(400).json({ error: range.error });

  try {
    const like = search ? likeContains(search) : null;
    // ใบขายหนึ่งใบอาจรวมหลายใบสั่งซื้อ → GROUP BY ใบขาย และรวมเลขใบสั่งซื้อไว้ให้ดูอ้างอิง
    const baseSql = `
      FROM (
        SELECT inv.doc_no,
               MIN(inv.doc_date::text) AS doc_date,
               inv.cust_code,
               COALESCE(MAX(cust.name_1),'') AS cust_name,
               MAX(COALESCE(inv.total_amount,0)) AS total_amount,
               string_agg(DISTINCT ${MAIN_DOC_NO_SQL('ic_qt')}, ', ') AS order_doc_nos
        FROM ic_trans ic_qt
        JOIN ap_ar_trans_detail ap_so ON ap_so.billing_no = ic_qt.doc_no AND ap_so.trans_flag = 36
        JOIN ap_ar_trans_detail ap_inv ON ap_inv.billing_no = ap_so.doc_no AND ap_inv.trans_flag = 44
        JOIN ic_trans inv ON inv.doc_no = ap_inv.doc_no AND inv.trans_flag = 44
        LEFT JOIN ar_customer cust ON cust.code = inv.cust_code
        WHERE ic_qt.trans_flag = 30
          ${marketplaceDocWhere('ic_qt')}
          AND COALESCE(ic_qt.approve_code::text,'0') <> '0'
          AND COALESCE(inv.last_status,0) = 0
          AND inv.doc_date BETWEEN $1::date AND $2::date
          AND ($3::text IS NULL
               OR inv.cust_code ILIKE $3
               OR COALESCE(cust.name_1,'') ILIKE $3
               OR inv.doc_no ILIKE $3)
        GROUP BY inv.doc_no, inv.cust_code
      ) s`;
    const params = [range.dateFrom, range.dateTo, like];

    const [summaryRs, dataRs] = await Promise.all([
      query(`SELECT COUNT(*) AS invoice_count, COALESCE(SUM(s.total_amount),0) AS total_amount ${baseSql}`, params),
      query(
        `SELECT s.* ${baseSql}
         ORDER BY s.doc_date DESC, s.doc_no DESC
         LIMIT $4 OFFSET $5`,
        [...params, pageSize, offset],
      ),
    ]);

    const summary = summaryRs.rows[0] || {};
    resp.success = true;
    resp.page = page;
    resp.page_size = pageSize;
    resp.date_from = range.dateFrom;
    resp.date_to = range.dateTo;
    resp.total_count = toInt(summary.invoice_count, 0);
    resp.summary = {
      invoice_count: toInt(summary.invoice_count, 0),
      total_amount: toNumber(summary.total_amount, 0),
    };
    resp.data = dataRs.rows.map((r) => ({
      doc_no: r.doc_no,
      doc_date: r.doc_date,
      cust_code: r.cust_code,
      cust_name: r.cust_name,
      total_amount: toNumber(r.total_amount, 0),
      order_doc_nos: r.order_doc_nos || '',
    }));
    return res.json(resp);
  } catch (ex) {
    console.error('admin/marketplacesalereport error:', ex.message);
    return res.status(500).json({ error: ex.message });
  }
});

module.exports = router;
