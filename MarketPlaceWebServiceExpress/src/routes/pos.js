const express = require('express');
const { requireEmployee } = require('../auth/requireAdmin');
const router = express.Router();
const { query, withTransaction } = require('../db');
const { calcDiscount, calcVat } = require('../utils/vatHelper');
const { serverDocDate, serverDocTime } = require('../utils/serverTime');
const { ERP_CODE_SQL_PATTERN } = require('../utils/erpCodeGuard');

// ── helper: buildDocPattern ────────────────────────────────────────────────
// แปลง doc_format จาก pos_id table เป็น pattern จริง
// เช่น "@-yyyy-####" + posId="MPOS01" → "MPOS01-2026-####"
function buildDocPattern(docFormat, posId) {
  if (!docFormat || docFormat.trim() === '') return posId + '-####';
  // ใช้วันที่ตามเวลาไทยของ server เสมอ (REQ6) ไม่พึ่ง timezone ของ process
  const [year4, month, day] = serverDocDate().split('-');
  const year2 = year4.substring(2);
  return docFormat
    .replace(/@/g, posId)
    .replace(/ปปปป/g, year4)
    .replace(/ปป/g, year2)
    .replace(/ดด/g, month)
    .replace(/วว/g, day)
    .replace(/yyyy/g, year4)
    .replace(/YYYY/g, year4)
    .replace(/yy/g, year2)
    .replace(/YY/g, year2)
    .replace(/MM/g, month)
    .replace(/dd/g, day)
    .replace(/DD/g, day);
}

// ── helper: resolveDocNo ────────────────────────────────────────────────────
// Query ic_trans → หา max running number → คืน doc_no ถัดไป
// ต้องเรียกภายใน transaction (client) เพื่อ consistency
async function resolveDocNo(client, posId, transFlag) {
  const posRes = await client.query(
    'SELECT doc_format FROM pos_id WHERE pos_id = $1 LIMIT 1',
    [posId]
  );
  if (posRes.rows.length === 0) throw new Error(`pos_id not found: ${posId}`);

  const docFormat = posRes.rows[0].doc_format || '';
  const pattern = buildDocPattern(docFormat, posId);

  const firstHash = pattern.indexOf('#');
  if (firstHash < 0) return pattern;

  let runLen = 0;
  while (firstHash + runLen < pattern.length && pattern[firstHash + runLen] === '#') runLen++;

  const likePattern = pattern.replace(/#/g, '_');
  const patternLen = pattern.length;

  const rows = await client.query(
    'SELECT doc_no FROM ic_trans WHERE trans_flag=$1 AND char_length(doc_no)=$2 AND doc_no LIKE $3',
    [transFlag, patternLen, likePattern]
  );

  let maxRunning = 0;
  for (const row of rows.rows) {
    const docNo = row.doc_no;
    if (!docNo || docNo.length !== patternLen) continue;
    const runText = docNo.substring(firstHash, firstHash + runLen);
    if (!/^\d+$/.test(runText)) continue;
    const run = parseInt(runText, 10);
    if (run > maxRunning) maxRunning = run;
  }

  const nextRunning = maxRunning + 1;
  if (nextRunning > Math.pow(10, runLen) - 1) throw new Error('running overflow');

  const prefix = pattern.substring(0, firstHash);
  const suffix = pattern.substring(firstHash + runLen);
  return prefix + String(nextRunning).padStart(runLen, '0') + suffix;
}

// ── GET /service/v1/getBranchList ──────────────────────────────────────────
router.get('/getBranchList', requireEmployee(), async (req, res) => {
  try {
    const result = await query('SELECT code, name_1 FROM erp_branch_list ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getWarehouseList ───────────────────────────────────────
router.get('/getWarehouseList', requireEmployee(), async (req, res) => {
  try {
    const result = await query("SELECT code, COALESCE(name_1,'') AS name_1, COALESCE(name_2,'') AS name_2 FROM ic_warehouse ORDER BY code");
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getShelfList ───────────────────────────────────────────
router.get('/getShelfList', requireEmployee(), async (req, res) => {
  const { wh_code = '' } = req.query;
  try {
    let result;
    if (wh_code) {
      result = await query(
        "SELECT whcode, code, COALESCE(name_1,'') AS name_1, COALESCE(name_2,'') AS name_2 FROM ic_shelf WHERE whcode=$1 ORDER BY whcode, code",
        [wh_code]
      );
    } else {
      result = await query(
        "SELECT whcode, code, COALESCE(name_1,'') AS name_1, COALESCE(name_2,'') AS name_2 FROM ic_shelf ORDER BY whcode, code"
      );
    }
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getPOSList ─────────────────────────────────────────────
router.get('/getPOSList', requireEmployee(), async (req, res) => {
  try {
    const result = await query(`
      SELECT
        p.pos_id, p.doc_format_code, p.doc_format,
        p.pos_ic_wht, p.pos_ic_shelf, p.branch_code,
        COALESCE(b.name_1, '') AS branch_name,
        COALESCE(w.name_1, '') AS wh_name,
        COALESCE(s.name_1, '') AS shelf_name
      FROM pos_id p
      LEFT JOIN erp_branch_list b ON b.code = p.branch_code
      LEFT JOIN ic_warehouse    w ON w.code = p.pos_ic_wht
      LEFT JOIN ic_shelf        s ON s.code = p.pos_ic_shelf AND s.whcode = p.pos_ic_wht
      ORDER BY p.pos_id
    `);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getErpOption ───────────────────────────────────────────
router.get('/getErpOption', async (req, res) => {
  try {
    const result = await query('SELECT vat_type, vat_rate, discout_type FROM erp_option LIMIT 1');
    return res.json({ success: true, data: result.rows[0] || {} });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDashboardTopProducts ────────────────────────────────
// สินค้าขายดีประจำวัน 10 รายการ (จาก ic_trans_detail JOIN ic_trans, trans_flag=44)
router.get('/getDashboardTopProducts', requireEmployee(), async (req, res) => {
  const { date = '' } = req.query;
  const targetDate = date || serverDocDate();
  // วันที่ผิดรูปแบบเคยตกที่ $1::date ของ Postgres แล้วคืน 500 พร้อม error ดิบ
  //    invalid input syntax for type date: "not-a-date"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate))) {
    return res.status(400).json({ success: false, msg: 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)' });
  }
  try {
    const result = await query(
      `SELECT d.item_code, d.item_name, d.unit_code,
              SUM(d.qty)::numeric AS total_qty,
              SUM(d.qty * d.price)::numeric AS total_amount
       FROM ic_trans_detail d
       JOIN ic_trans t ON t.doc_no = d.doc_no AND t.trans_flag = 44
       WHERE d.trans_flag = 44
         AND t.doc_date = $1::date
         AND t.last_status = 0
       GROUP BY d.item_code, d.item_name, d.unit_code
       ORDER BY total_qty DESC
       LIMIT 10`,
      [targetDate]
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDashboardSoldOut ───────────────────────────────────
// สินค้าขายหมด: รายการที่ขายในวันที่เลือก ยอดคงเหลือ (net) - ตะกร้า <= 0
router.get('/getDashboardSoldOut', requireEmployee(), async (req, res) => {
  const { date = '' } = req.query;
  const targetDate = date || serverDocDate();
  // วันที่ผิดรูปแบบเคยตกที่ $1::date ของ Postgres แล้วคืน 500 พร้อม error ดิบ
  //    invalid input syntax for type date: "not-a-date"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate))) {
    return res.status(400).json({ success: false, msg: 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)' });
  }
  try {
    const result = await query(
      `WITH sold_today AS (
         SELECT DISTINCT d.item_code
         FROM ic_trans_detail d
         JOIN ic_trans t ON t.doc_no = d.doc_no AND t.trans_flag = 44
         WHERE d.trans_flag = 44
           AND t.doc_date = $1::date
           AND t.last_status = 0
       ),
       item_code_list AS (
         -- รหัสถูกส่งเข้าฟังก์ชันที่เอาไปต่อ SQL เอง จึงต้องกรองก่อน แม้จะมาจากตาราง ERP
         SELECT string_agg(item_code, ',') AS codes
         FROM sold_today
         WHERE item_code ~ '${ERP_CODE_SQL_PATTERN}'
       ),
       stock AS (
         SELECT s.ic_code, SUM(s.balance_qty) AS sum_balance_qty
         FROM item_code_list icl
         CROSS JOIN LATERAL sml_ic_function_stock_balance_warehouse_location(
           current_date, icl.codes, '', ''
         ) s
         GROUP BY s.ic_code
       ),
       cart AS (
         SELECT
           c.item_code,
           SUM(
             c.qty
             * COALESCE(u.stand_value, 1)::numeric
             / NULLIF(COALESCE(u.divide_value, 1), 0)::numeric
           ) AS cart_qty_std
         FROM staff_cart_order c
         LEFT JOIN ic_unit_use u
                ON u.ic_code = c.item_code
               AND u.code    = c.unit_code
         WHERE c.item_code IN (SELECT item_code FROM sold_today)
         GROUP BY c.item_code
       )
       SELECT
         st.item_code,
         COALESCE(inv.name_1, st.item_code)                                    AS item_name,
         COALESCE(stk.sum_balance_qty, 0)::numeric                             AS stock_qty,
         COALESCE(crt.cart_qty_std, 0)::numeric                                AS cart_qty,
         (COALESCE(stk.sum_balance_qty, 0) - COALESCE(crt.cart_qty_std, 0))::numeric AS remaining_qty,
         COALESCE(inv.unit_standard, '')                                        AS unit_code,
         COALESCE(un.name_1, inv.unit_standard, '')                            AS unit_name
       FROM sold_today st
       LEFT JOIN ic_inventory inv ON inv.code = st.item_code
       LEFT JOIN stock stk        ON stk.ic_code = st.item_code
       LEFT JOIN cart crt         ON crt.item_code = st.item_code
       LEFT JOIN ic_unit un       ON un.code = inv.unit_standard
       WHERE (COALESCE(stk.sum_balance_qty, 0) - COALESCE(crt.cart_qty_std, 0)) <= 0
       ORDER BY remaining_qty ASC`,
      [targetDate]
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDashboardTopCustomers ───────────────────────────────
// ลูกค้าดีเด่นประจำเดือน 5 คน (ยอดสั่งซื้อสูงสุด, trans_flag=44)
router.get('/getDashboardTopCustomers', requireEmployee(), async (req, res) => {
  try {
    const result = await query(
      `SELECT t.cust_code,
              COALESCE(ar.name_1, t.cust_code) AS cust_name,
              SUM(COALESCE(cb.total_net_amount, t.total_amount))::numeric AS total_amount,
              COUNT(t.doc_no)::int AS total_docs
       FROM ic_trans t
       LEFT JOIN ar_customer ar ON ar.code = t.cust_code
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.doc_date >= date_trunc('month', current_date)
         AND t.doc_date <= current_date
         AND t.cust_code IS NOT NULL AND t.cust_code <> ''
       GROUP BY t.cust_code, ar.name_1
       ORDER BY total_amount DESC
       LIMIT 5`
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDashboardTopSalesmen ────────────────────────────────
// พนักงานขายดีเด่นประจำเดือน 5 คน (ยอดขายสูงสุด, trans_flag=44)
router.get('/getDashboardTopSalesmen', requireEmployee(), async (req, res) => {
  try {
    const result = await query(
      `SELECT t.sale_code,
              COALESCE(
                (SELECT name_1 FROM erp_user WHERE UPPER(code) = UPPER(t.sale_code) LIMIT 1),
                t.sale_code
              ) AS emp_name,
              SUM(COALESCE(cb.total_net_amount, t.total_amount))::numeric AS total_amount,
              COUNT(t.doc_no)::int AS total_docs
       FROM ic_trans t
       LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
       WHERE t.trans_flag = 44
         AND t.last_status = 0
         AND t.doc_date >= date_trunc('month', current_date)
         AND t.doc_date <= current_date
         AND t.sale_code IS NOT NULL AND t.sale_code <> ''
       GROUP BY t.sale_code
       ORDER BY total_amount DESC
       LIMIT 5`
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getLastDocNo ───────────────────────────────────────────
router.get('/getLastDocNo', requireEmployee(), async (req, res) => {
  const { pos_id, trans_flag } = req.query;
  if (!pos_id) return res.status(400).json({ success: false, msg: 'pos_id is required' });

  const tf = parseInt(trans_flag) || 44;
  try {
    const posRes = await query('SELECT doc_format FROM pos_id WHERE pos_id=$1 LIMIT 1', [pos_id]);
    if (posRes.rows.length === 0) {
      return res.status(400).json({ success: false, msg: `pos_id not found: ${pos_id}` });
    }

    const docFormat = posRes.rows[0].doc_format || '';
    const pattern = buildDocPattern(docFormat, pos_id);

    const firstHash = pattern.indexOf('#');
    let latestRunning = 0;
    let latestDocNo = '';

    if (firstHash >= 0) {
      let runLen = 0;
      while (firstHash + runLen < pattern.length && pattern[firstHash + runLen] === '#') runLen++;

      const likePattern = pattern.replace(/#/g, '_');
      const rows = await query(
        'SELECT doc_no FROM ic_trans WHERE trans_flag=$1 AND char_length(doc_no)=$2 AND doc_no LIKE $3',
        [tf, pattern.length, likePattern]
      );

      for (const row of rows.rows) {
        const docNo = row.doc_no;
        if (!docNo || docNo.length !== pattern.length) continue;
        const runText = docNo.substring(firstHash, firstHash + runLen);
        if (!/^\d+$/.test(runText)) continue;
        const run = parseInt(runText, 10);
        if (run > latestRunning) { latestRunning = run; latestDocNo = docNo; }
      }
    }

    return res.json({
      success: true,
      data: { pos_id, trans_flag: tf, last_doc_no: latestDocNo, last_running: latestRunning, doc_pattern: pattern },
    });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getPassBookList ───────────────────────────────────────
router.get('/getPassBookList', requireEmployee(), async (req, res) => {
  try {
    const result = await query(`
      SELECT code, bank_code,
        (SELECT name_1 FROM erp_bank WHERE code = bank_code) AS bank_name,
        bank_branch,
        (SELECT name_1 FROM erp_bank_branch WHERE code = bank_branch) AS branch_name,
        name_1 AS book_name
      FROM erp_pass_book ORDER BY code
    `);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getCreditTypeList ─────────────────────────────────────
router.get('/getCreditTypeList', requireEmployee(), async (req, res) => {
  try {
    const result = await query('SELECT code, name_1, charge_rate FROM erp_credit_type ORDER BY code');
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── POST /service/v1/saveTrans ─────────────────────────────────────────────
router.post('/saveTrans', requireEmployee(), async (req, res) => {
  try {
    let obj = req.body;
    if (typeof obj === 'string') obj = JSON.parse(obj);

    // วันที่/เวลาเอกสารใช้เวลาไทยของ server เสมอ (REQ6)
    const doc_date = serverDocDate();
    const doc_time = serverDocTime();
    const doc_format_code = obj.doc_format_code || '';
    const cust_code = obj.cust_code || 'AR00001';
    const branch_code = obj.branch_code || '';
    const emp_code = obj.emp_code || '';
    const creator_code = obj.creator_code || '';
    const pos_id = obj.pos_id || '';
    const shelf_code = obj.shelf_code || '';
    const remark = obj.remark || '';
    const basket_id = obj.basket_id || '';

    const inquiry_type = obj.inquiry_type != null ? parseInt(obj.inquiry_type) : 1;
    const vat_type = obj.vat_type != null ? parseInt(obj.vat_type) : 1;
    const vat_rate = obj.vat_rate != null ? parseFloat(obj.vat_rate) : 7.0;
    const discount_type = obj.discount_type != null ? parseInt(obj.discount_type) : 0;
    const discount_word = obj.discount_word || '';

    const total_value_dbl = parseFloat(obj.total_value || 0);
    const total_net_amount_dbl = parseFloat(obj.total_net_amount || 0);
    const total_credit_charge_dbl = parseFloat(obj.total_credit_charge || 0);
    const tranfer_amount_dbl = parseFloat(obj.tranfer_amount || 0);
    const card_amount_dbl = parseFloat(obj.card_amount || 0);
    const wallet_amount_dbl = parseFloat(obj.wallet_amount || 0);
    const cash_amount_raw = parseFloat(obj.cash_amount || 0);
    const rounded_amount_dbl = parseFloat(obj.rounded_amount || 0);
    const total_income_amount_dbl = parseFloat(obj.total_income_amount || 0);
    const total_except_vat_dbl = parseFloat(obj.total_except_vat || 0);

    const items = Array.isArray(obj.items) ? obj.items : [];
    const payments = Array.isArray(obj.payment_detail) ? obj.payment_detail : [];

    if (!pos_id) return res.status(400).json({ success: false, msg: 'pos_id is required' });
    if (items.length === 0) return res.status(400).json({ success: false, msg: 'items is empty' });

    // ── ค่า VAT/discount: ใช้ค่าที่ frontend คำนวณมาแล้ว (มี breakdown vat/no-vat ถูกต้อง)
    //    ถ้าไม่ได้ส่งมา (backwards compat) → fallback คำนวณเองด้วย calcVat
    const hasClientCalc =
      obj.total_before_vat != null && obj.total_vat_value != null && obj.total_amount != null;
    let total_disc, before_vat, vat_value, after_vat, total_amount;
    if (hasClientCalc) {
      total_disc = parseFloat(obj.total_discount || 0);
      before_vat = parseFloat(obj.total_before_vat);
      vat_value = parseFloat(obj.total_vat_value);
      after_vat = parseFloat(obj.total_after_vat || (before_vat + vat_value));
      total_amount = parseFloat(obj.total_amount);
    } else {
      total_disc = calcDiscount(discount_word, total_value_dbl);
      [before_vat, vat_value, after_vat, total_amount] = calcVat(
        vat_type, vat_rate, discount_type, total_value_dbl, total_disc,
      );
    }

    // ── คำนวณ payment amounts ────────────────────────────────────────────────
    // หลักการใหม่: ปัดเศษเป็น "ชนิดการจ่ายเงิน" — จ่ายจริง + ปัดเศษ = ยอดสุทธิ
    //   total_net_amount  = ยอดสุทธิ (ไม่บวกปัดเศษ)
    //   cash_amount_raw   = เงินสดที่ลูกค้าจ่ายจริง
    //   rounded_amount    = ปัดเศษ (frontend ส่งมา; เก็บลง total_income_amount เช่นกัน)
    //   money_change      = (เงินสด + ปัดเศษ) − ยอดสุทธิ
    const cash_amount_in_db = cash_amount_raw;
    const total_amount_pay = total_net_amount_dbl;
    const card_with_charge = card_amount_dbl + total_credit_charge_dbl;
    const total_income_amount = total_income_amount_dbl || rounded_amount_dbl;
    const money_change = cash_amount_raw > 0
      ? Math.max(0, cash_amount_raw + rounded_amount_dbl - total_net_amount_dbl)
      : 0;

    let doc_no;
    await withTransaction(async (client) => {
      // 1. Generate doc_no
      doc_no = await resolveDocNo(client, pos_id, 44);

      // 2. INSERT ic_trans
      await client.query(
        `INSERT INTO ic_trans (
          inquiry_type,vat_type,trans_type,trans_flag,doc_date,doc_no,tax_doc_no,tax_doc_date,
          cust_code,branch_code,send_date,vat_rate,total_value,total_vat_value,total_after_vat,
          total_amount,total_before_vat,total_except_vat,doc_time,doc_format_code,creator_code,sale_code,
          total_discount,discount_word,remark,send_type,remark_4,pos_id
        ) VALUES ($1,$2,2,44,$3::date,$4,$4,$3::date,$5,$6,$3::date,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,0,$21,$22)`,
        [
          inquiry_type, vat_type,
          doc_date, doc_no,
          cust_code, branch_code,
          vat_rate,
          total_value_dbl, vat_value, after_vat, total_amount, before_vat, total_except_vat_dbl,
          doc_time, doc_format_code,
          creator_code, emp_code,
          total_disc, discount_word, remark,
          shelf_code, pos_id,
        ]
      );

      // 3. INSERT cb_trans
      await client.query(
        `INSERT INTO cb_trans (
          trans_type,trans_flag,doc_no,doc_date,doc_time,ap_ar_code,pay_type,doc_format_code,
          total_amount,total_net_amount,cash_amount,tranfer_amount,card_amount,
          total_amount_pay,total_credit_charge,wallet_amount,total_income_amount,
          pay_cash_amount,money_change
        ) VALUES (2,44,$1,$2::date,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          doc_no, doc_date, doc_time, cust_code, doc_format_code,
          total_amount, total_net_amount_dbl,
          cash_amount_in_db, tranfer_amount_dbl, card_with_charge,
          total_amount_pay, total_credit_charge_dbl, wallet_amount_dbl,
          total_income_amount, cash_amount_raw, money_change,
        ]
      );

      // 3.5 INSERT gl_journal_vat_sale (1 row ต่อเอกสาร — สำหรับรายงานภาษีขาย)
      const arNameRow = await client.query(
        'SELECT COALESCE(name_1, $2) AS name_1 FROM ar_customer WHERE code = $1 LIMIT 1',
        [cust_code, '']
      );
      const ar_name = arNameRow.rows[0]?.name_1 || '';
      const docDateObj = new Date(doc_date);
      const vat_effective_period = docDateObj.getMonth() + 1;
      const vat_effective_year = docDateObj.getFullYear() + 543;
      await client.query(
        `INSERT INTO gl_journal_vat_sale (
          ignore_sync,is_lock_record,doc_date,doc_no,book_code,line_number,vat_number,
          tax_group,description,base_caltax_amount,tax_rate,amount,except_tax_amount,
          period_number,is_add,vat_date,trans_type,trans_flag,vat_effective_period,
          ar_code,ar_name,vat_calc,vat_effective_year,branch_type,branch_code,tax_no,
          manual_add,is_doc_copy,create_date_time_now,vat_type,
          ref_vat_no,ref_vat_date,ref_doc_no,ref_doc_date
        ) VALUES (0,0,$1::date,$2,'',0,$2,'','',$3,$4,$5,$6,0,0,$1::date,2,44,$7,
          $8,$9,1,$10,0,$11,'',0,0,NOW(),0,'',NULL,'',NULL)`,
        [
          doc_date, doc_no,
          before_vat, vat_rate, vat_value, total_except_vat_dbl,
          vat_effective_period,
          cust_code, ar_name,
          vat_effective_year, branch_code,
        ]
      );

      // 4. DELETE + INSERT ic_trans_detail
      await client.query('DELETE FROM ic_trans_detail WHERE doc_no=$1', [doc_no]);
      const r2 = (v) => Math.round(v * 100) / 100;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const it_qty = parseFloat(it.qty || 0);
        const it_price = parseFloat(it.price || 0);
        const it_sum = parseFloat(it.sum_amount || 0);
        const it_tax_type = Number(it.tax_type ?? 0);

        // คำนวณ base/vat รายบรรทัด ตาม tax_type ของสินค้าและ vat_type ของเอกสาร
        // tax_type=1 (ยกเว้น): ไม่มี VAT — ใช้ราคา/ยอดเดิม
        // tax_type=0 + vat_type=1 (รวมใน): แยก VAT ออกจากยอด
        // tax_type=0 + vat_type=0 (แยกนอก): VAT คิดเพิ่มจากยอด, base=ยอดเดิม
        // อื่น ๆ (ไม่กระทบ/ศูนย์): ไม่มี VAT
        let sum_amount_exclude_vat, line_vat_value, price_exclude_vat;
        if (it_tax_type === 1) {
          sum_amount_exclude_vat = it_sum;
          line_vat_value = 0;
          price_exclude_vat = it_price;
        } else if (vat_type === 1) {
          sum_amount_exclude_vat = r2((it_sum * 100) / (100 + vat_rate));
          line_vat_value = r2(it_sum - sum_amount_exclude_vat);
          price_exclude_vat = r2((it_price * 100) / (100 + vat_rate));
        } else if (vat_type === 0) {
          sum_amount_exclude_vat = it_sum;
          line_vat_value = r2(it_sum * (vat_rate / 100));
          price_exclude_vat = it_price;
        } else {
          sum_amount_exclude_vat = it_sum;
          line_vat_value = 0;
          price_exclude_vat = it_price;
        }

        await client.query(
          `INSERT INTO ic_trans_detail (
            inquiry_type,vat_type,trans_type,trans_flag,doc_date,doc_no,cust_code,
            item_code,item_name,unit_code,qty,price,sum_amount,line_number,remark,
            wh_code,shelf_code,stand_value,divide_value,ratio,doc_time,doc_date_calc,
            discount,discount_amount,barcode,calc_flag,
            tax_type,sum_amount_exclude_vat,total_vat_value,price_exclude_vat
          ) VALUES ($1,$2,2,44,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,'',$13,$14,$15,$16,$17,$18,$3::date,$19,$20,$21,$22,$23,$24,$25,$26)`,
          [
            1, vat_type,
            doc_date, doc_no, cust_code,
            it.item_code, it.item_name, it.unit_code,
            it_qty, it_price,
            it_sum, i,
            it.wh_code || '', it.shelf_code || '',
            parseFloat(it.stand_value || 0), parseFloat(it.divide_value || 0), parseFloat(it.ratio || 0),
            doc_time,
            it.discount || '', parseFloat(it.discount_amount || 0), it.barcode || '', -1,
            it_tax_type, sum_amount_exclude_vat, line_vat_value, price_exclude_vat,
          ]
        );
      }

      // 5. DELETE + INSERT cb_trans_detail
      await client.query('DELETE FROM cb_trans_detail WHERE doc_no=$1', [doc_no]);
      for (const p of payments) {
        const pay_type = String(p.pay_type || '0');
        const pay_amount = parseFloat(p.pay_amount || 0);
        const trans_number = p.trans_number || '';
        const charge = parseFloat(p.charge || 0);

        if (pay_type === '0') {
          // โอน
          const pb_bank_code = p.bank_code || 'KBANK';
          const pb_bank_branch = p.bank_branch || 'KBANK2';
          await client.query(
            `INSERT INTO cb_trans_detail (
              trans_type,trans_flag,doc_no,doc_date,doc_time,trans_number,
              bank_code,bank_branch,amount,sum_amount,doc_type,ap_ar_code,
              trans_number_type,ap_ar_type
            ) VALUES (2,$1,$2,$3::date,$4,$5,$6,$7,$8,$8,'1',$9,0,0)`,
            [44, doc_no, doc_date, doc_time, trans_number, pb_bank_code, pb_bank_branch, pay_amount, cust_code]
          );
        } else if (pay_type === '21') {
          // บัตรเครดิต
          const cc_type = p.credit_card_type || 'NONE';
          const sum_amt = pay_amount + charge;
          await client.query(
            `INSERT INTO cb_trans_detail (
              trans_type,trans_flag,doc_no,doc_date,doc_time,trans_number,
              credit_card_type,amount,sum_amount,doc_type,ap_ar_code,
              trans_number_type,ap_ar_type,charge,ref1,no_approved
            ) VALUES (2,$1,$2,$3::date,$4,$5,$6,$7,$8,'21',$9,1,1,$10,$2,$11)`,
            [44, doc_no, doc_date, doc_time, trans_number, cc_type, pay_amount, sum_amt, cust_code, charge, p.no_approved || '']
          );
        } else {
          // wallet 
          const sum_amt = pay_amount + charge;
          await client.query(
            `INSERT INTO cb_trans_detail (
              trans_type,trans_flag,doc_no,doc_date,doc_time,trans_number,
              credit_card_type,amount,sum_amount,doc_type,ap_ar_code,
              trans_number_type,ap_ar_type,charge
            ) VALUES (2,$1,$2,$3::date,$4,$5,'WC',$6,$7,'3',$8,1,1,$9)`,
            [44, doc_no, doc_date, doc_time, trans_number, pay_amount, sum_amt, cust_code, charge]
          );
        }
      }

      // 6. Clear cart
      const cart_key = basket_id ? `BASKET-${basket_id}` : cust_code;
      await client.query('DELETE FROM staff_cart_order WHERE cust_code=$1', [cart_key]);

      // Reset basket to empty after sale
      if (basket_id) {
        await client.query(
          `UPDATE pos_basket
           SET cust_code='', cust_name='', sale_code='', sale_name='',
               status='empty', updated_at=NOW()
           WHERE basket_id=$1`,
          [basket_id]
        );
      }

      // 7. Queue IC process for sold items
      await client.query(
        `INSERT INTO process (process_name, wherein)
         SELECT 'IC', item_code FROM ic_trans_detail WHERE doc_no = $1 AND trans_flag = 44`,
        [doc_no]
      );
    });

    return res.json({ success: true, doc_no, msg: 'success' });
  } catch (ex) {
    const msg = ex.message || '';
    if (msg.includes('running overflow')) {
      return res.status(409).json({ success: false, msg: 'ERR_DOC_RUNNING_OVERFLOW: ' + msg });
    }
    return res.status(500).json({ success: false, msg });
  }
});

// ── GET /service/v1/getDocSaleHistory ──────────────────────────────────────
// ลอกจาก Java: ถ้ามี search → ยกเลิก date filter และค้นด้วย doc_no/cust_code/name_1 แทน
router.get('/getDocSaleHistory', requireEmployee(), async (req, res) => {
  const { search = '', from_date = '', to_date = '' } = req.query;
  try {
    const params = [];
    let whereExtra = '';

    if (search.trim()) {
      const like = `%${search.trim()}%`;
      params.push(like, like, like);
      const n = params.length;
      whereExtra = ` AND (ict.doc_no ILIKE $${n - 2} OR ict.cust_code ILIKE $${n - 1} OR ar.name_1 ILIKE $${n})`;
    } else if (from_date.trim() && to_date.trim()) {
      params.push(from_date.trim(), to_date.trim());
      whereExtra = ` AND ict.doc_date BETWEEN $${params.length - 1}::date AND $${params.length}::date`;
    }

    const sql = `
      SELECT ict.doc_no, ict.doc_date, ict.doc_time, ict.total_amount,
        ict.cust_code, COALESCE(ar.name_1,'') AS cust_name,
        cb.cash_amount, cb.tranfer_amount, cb.card_amount, cb.wallet_amount,
        cb.total_credit_charge, cb.total_net_amount, cb.total_amount_pay
      FROM ic_trans ict
      LEFT JOIN ar_customer ar ON ar.code = ict.cust_code
      LEFT JOIN cb_trans cb ON cb.doc_no = ict.doc_no AND cb.trans_flag = 44
      WHERE ict.trans_flag = 44
        AND ict.last_status = 0
        ${whereExtra}
      ORDER BY ict.create_datetime DESC
    `;

    const result = await query(sql, params);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ── GET /service/v1/getDocSaleHistoryDetail ────────────────────────────────
router.get('/getDocSaleHistoryDetail', requireEmployee(), async (req, res) => {
  const { doc_no = '' } = req.query;
  if (!doc_no) return res.status(400).json({ success: false, msg: 'doc_no is required' });
  try {
    const [headerRes, itemsRes] = await Promise.all([
      query(
        `SELECT t.inquiry_type, t.vat_type, t.vat_rate,
            t.total_amount, t.total_before_vat, t.total_vat_value,
            t.total_after_vat, t.total_discount, t.remark,
            COALESCE(cb.total_net_amount, t.total_amount) AS total_net_amount,
            COALESCE(cb.cash_amount, 0) AS cash_amount,
            COALESCE(cb.tranfer_amount, 0) AS tranfer_amount,
            COALESCE(cb.card_amount, 0) AS card_amount,
            COALESCE(cb.total_credit_charge, 0) AS total_credit_charge,
            COALESCE(cb.money_change, 0) AS money_change
         FROM ic_trans t
         LEFT JOIN cb_trans cb ON cb.doc_no = t.doc_no AND cb.trans_flag = 44
         WHERE t.trans_flag = 44 AND t.doc_no = $1 LIMIT 1`,
        [doc_no]
      ),
      query(
        `SELECT item_code, item_name, unit_code, qty, price, sum_amount,
          COALESCE(discount,'') AS discount, COALESCE(discount_amount,0) AS discount_amount
         FROM ic_trans_detail WHERE trans_flag = 44 AND doc_no = $1 ORDER BY line_number`,
        [doc_no]
      ),
    ]);
    const h = headerRes.rows[0] || {};
    return res.json({
      success: true,
      data: {
        header: h,
        items: itemsRes.rows,
      },
    });
  } catch (ex) {
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

module.exports = router;
