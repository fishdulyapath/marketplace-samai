const express = require('express');
const { requireAdmin } = require('../auth/requireAdmin');
const router = express.Router();
const { query, withTransaction } = require('../db');
const { hasOwn } = require('../utils/partialUpdate');
const { escapeLike } = require('../utils/likePattern');
const {
  cleanFeatureType,
  ensureSalesSettingsTables,
  getSalesSettings,
  isValidStarThresholds,
  normalizePreorderMode,
  normalizeProductNameMode,
  normalizeSalesDisplayMode,
  resolvePreorderAllowed,
  setDocHistoryMode,
  setProductNameDisplayMode,
  setPreorderDefaultEnabled,
  setSalesDisplayMode,
  setSalesStarThresholds,
  setStockDisplayPercent,
  setSalePremiumEnabled,
  setCancelDocPattern,
  setErpMaxLinesPerDoc,
  setOrderDocPattern,
  setOrderDocSource,
} = require('../utils/marketplaceSalesSettings');

function cleanItemCode(value) {
  return String(value || '').trim();
}

function cleanDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return text;
}

function isInvalidProvidedDate(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !cleanDate(text);
}

function toNumber(value, fallback = 0) {
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseLineNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return 0;
  const num = toNumber(value, NaN);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.trunc(num);
}

function parseStockDisplayPercent(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const num = toNumber(value, NaN);
  if (!Number.isFinite(num)) return null;
  if (num < 0 || num > 100) return null;
  return Math.round(num * 100) / 100;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function getSearchTerms(value, maxTerms = 8) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, maxTerms);
}

function isValidDocHistoryModeInput(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return ['marketplace_only', 'marketplace', 'market', 'web', '1', 'true', 'all', '0', 'false'].includes(text);
}

function isValidBooleanFlagInput(value) {
  if (value === true || value === false || value === 1 || value === 0) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'enabled', 'on', 'allow', '0', 'false', 'no', 'n', 'disabled', 'off', 'deny'].includes(text);
}

function isValidPreorderModeInput(value) {
  if (value === true || value === false || value === 1 || value === 0) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return ['default', '1', 'true', 'yes', 'y', 'enabled', 'allow', '0', 'false', 'no', 'n', 'disabled', 'deny'].includes(text);
}

function isValidProductNameDisplayModeInput(value) {
  return Boolean(normalizeProductNameMode(value, ''));
}

function isValidSalesDisplayModeInput(value) {
  return ['0', '1', '2'].includes(normalizeSalesDisplayMode(value, ''));
}

router.get('/sales-settings', async (req, res) => {
  try {
    await ensureSalesSettingsTables();
    const includeFeatured = String(req.query?.include_featured ?? '1') !== '0';
    const settings = await getSalesSettings();
    if (!includeFeatured) {
      return res.json({ success: true, data: settings });
    }
    const featured = await queryFeaturedProducts();
    return res.json({ success: true, data: { ...settings, featured_products: featured } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/sales-settings', requireAdmin('admin.salesSettings'), async (req, res) => {
  const stockPercentValue = parseStockDisplayPercent(req.body?.stock_display_percent);
  // 🚨 เดิมใช้ ?? ใส่ค่า default ทำให้ "ไม่ส่งคีย์มา" กลายเป็น "รีเซ็ตเป็นค่าเริ่มต้น"
  //    หน้าจอที่บันทึกโดยไม่แตะ 3 คีย์นี้จะล้างค่าที่แอดมินตั้งไว้ทิ้ง
  //    เขียนเฉพาะเมื่อส่งมาจริง เหมือนที่ order_doc_source / erp_max_lines_per_doc ทำถูกอยู่แล้วด้านล่าง
  const productNameDisplayModeInput = req.body?.product_name_display_mode;
  const salesDisplayModeInput = req.body?.sales_display_mode;
  const salesStarThresholdsInput = req.body?.sales_star_thresholds;
  // 🚨 3 คีย์นี้เคย "บังคับต้องส่งมาทุกครั้ง" ทำให้หน้าจอที่ตั้งใจแก้คีย์เดียวบันทึกไม่ได้เลย
  //    เช่นสวิตช์ "เปิดใช้ระบบของแถม" ที่ /admin/sale-premium ส่งมาแค่ { sale_premium_enabled }
  //    แล้วโดน 400 "เปอร์เซ็นต์สต๊อกต้องเป็นตัวเลข..." ซึ่งเป็นข้อความคนละเรื่องกับที่ผู้ใช้กด
  //    แอดมินจึงปิดระบบของแถมทั้งระบบไม่ได้ ต้องไปแก้ DB ตรงๆ
  //    ทำให้เหมือนอีก 8 คีย์ในไฟล์นี้: ไม่ส่ง = ไม่แตะ, ส่งมา = ตรวจแล้วเขียน
  const stockPercentInput = req.body?.stock_display_percent;
  const docHistoryModeInput = req.body?.doc_history_mode;
  const preorderDefaultInput = req.body?.preorder_default_enabled;
  if (stockPercentInput !== undefined && stockPercentValue === null) {
    return res.status(400).json({ success: false, message: 'เปอร์เซ็นต์สต๊อกต้องเป็นตัวเลขระหว่าง 0 ถึง 100' });
  }
  if (docHistoryModeInput !== undefined && !isValidDocHistoryModeInput(docHistoryModeInput)) {
    return res.status(400).json({ success: false, message: 'รูปแบบประวัติเอกสารไม่ถูกต้อง' });
  }
  if (preorderDefaultInput !== undefined && !isValidBooleanFlagInput(preorderDefaultInput)) {
    return res.status(400).json({ success: false, message: 'ค่าเริ่มต้น Preorder ต้องเป็นเปิดหรือปิดเท่านั้น' });
  }
  if (productNameDisplayModeInput !== undefined && !isValidProductNameDisplayModeInput(productNameDisplayModeInput)) {
    return res.status(400).json({ success: false, message: 'รูปแบบชื่อสินค้าที่แสดงไม่ถูกต้อง' });
  }
  if (salesDisplayModeInput !== undefined && !isValidSalesDisplayModeInput(salesDisplayModeInput)) {
    return res.status(400).json({ success: false, message: 'รูปแบบการแสดงยอดขายไม่ถูกต้อง' });
  }
  if (salesStarThresholdsInput !== undefined && !isValidStarThresholds(salesStarThresholdsInput)) {
    return res.status(400).json({ success: false, message: 'ช่วงระดับดาวต้องเป็นตัวเลข 4 ค่าและเรียงจากน้อยไปมาก' });
  }

  try {
    await ensureSalesSettingsTables();
    const result = await withTransaction(async (client) => {
      let stockPercent;
      let docHistoryMode;
      let preorderDefaultEnabled;
      if (stockPercentInput !== undefined) stockPercent = await setStockDisplayPercent(stockPercentValue, client);
      if (docHistoryModeInput !== undefined) docHistoryMode = await setDocHistoryMode(docHistoryModeInput, client);
      if (preorderDefaultInput !== undefined) preorderDefaultEnabled = await setPreorderDefaultEnabled(preorderDefaultInput, client);
      let productNameDisplayMode;
      let salesDisplayMode;
      let salesStarThresholds;
      if (productNameDisplayModeInput !== undefined) productNameDisplayMode = await setProductNameDisplayMode(productNameDisplayModeInput, client);
      if (salesDisplayModeInput !== undefined) salesDisplayMode = await setSalesDisplayMode(salesDisplayModeInput, client);
      if (salesStarThresholdsInput !== undefined) salesStarThresholds = await setSalesStarThresholds(salesStarThresholdsInput, client);
      // ของแถม: บันทึกเฉพาะเมื่อ client ส่ง key มา (optional — ไม่กระทบการบันทึกเดิม)
      let salePremiumEnabled;
      if (req.body?.sale_premium_enabled !== undefined) {
        salePremiumEnabled = await setSalePremiumEnabled(req.body.sale_premium_enabled, client);
      }
      // เลขที่เอกสารคำสั่งซื้อ (REQ4) — บันทึกเฉพาะ key ที่ส่งมา เพื่อให้หน้าจอเก่าที่ไม่รู้จักฟิลด์นี้ยังบันทึกได้
      let orderDocSource;
      let orderDocPattern;
      let cancelDocPattern;
      let erpMaxLinesPerDoc;
      if (req.body?.order_doc_source !== undefined) {
        orderDocSource = await setOrderDocSource(req.body.order_doc_source, client);
      }
      if (req.body?.order_doc_pattern !== undefined) {
        orderDocPattern = await setOrderDocPattern(req.body.order_doc_pattern, client);
      }
      if (req.body?.cancel_doc_pattern !== undefined) {
        cancelDocPattern = await setCancelDocPattern(req.body.cancel_doc_pattern, client);
      }
      if (req.body?.erp_max_lines_per_doc !== undefined) {
        erpMaxLinesPerDoc = await setErpMaxLinesPerDoc(req.body.erp_max_lines_per_doc, client);
      }
      return {
        stockPercent, docHistoryMode, preorderDefaultEnabled, productNameDisplayMode, salesDisplayMode,
        salesStarThresholds, salePremiumEnabled, orderDocSource, orderDocPattern, cancelDocPattern, erpMaxLinesPerDoc,
      };
    });
    return res.json({
      success: true,
      data: {
        ...(result.stockPercent !== undefined ? { stock_display_percent: result.stockPercent } : {}),
        ...(result.docHistoryMode !== undefined ? { doc_history_mode: result.docHistoryMode } : {}),
        ...(result.preorderDefaultEnabled !== undefined ? { preorder_default_enabled: result.preorderDefaultEnabled } : {}),
        ...(result.productNameDisplayMode !== undefined ? { product_name_display_mode: result.productNameDisplayMode } : {}),
        ...(result.salesDisplayMode !== undefined ? { sales_display_mode: result.salesDisplayMode } : {}),
        ...(result.salesStarThresholds !== undefined ? { sales_star_thresholds: result.salesStarThresholds } : {}),
        ...(result.salePremiumEnabled !== undefined ? { sale_premium_enabled: result.salePremiumEnabled } : {}),
        ...(result.orderDocSource !== undefined ? { order_doc_source: result.orderDocSource } : {}),
        ...(result.orderDocPattern !== undefined ? { order_doc_pattern: result.orderDocPattern } : {}),
        ...(result.cancelDocPattern !== undefined ? { cancel_doc_pattern: result.cancelDocPattern } : {}),
        ...(result.erpMaxLinesPerDoc !== undefined ? { erp_max_lines_per_doc: result.erpMaxLinesPerDoc } : {}),
      },
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/sales-settings/product-search', requireAdmin('admin.salesSettings'), async (req, res) => {
  const search = String(req.query.search || '').trim();
  // escape % และ _ ก่อนส่งเข้า SQL ที่ต่อเป็น LIKE '%' || kw.term || '%'
  // ไม่งั้นผู้ใช้พิมพ์ % จะได้สินค้าทั้งฐาน (ดู src/utils/likePattern.js)
  const terms = getSearchTerms(search).map(escapeLike);
  const limit = Math.max(20, Math.min(100, toInt(req.query.limit, 50)));
  try {
    const result = await query(
      `SELECT i.code, COALESCE(i.name_1,'') AS name_1, COALESCE(i.name_2,'') AS name_2,
              COALESCE(i.name_eng_1,'') AS name_eng_1, COALESCE(i.unit_standard,'') AS unit_standard,
              COALESCE(i.item_type,0) AS item_type
       FROM ic_inventory i
       WHERE (
         COALESCE(array_length($1::text[], 1), 0) = 0
         OR NOT EXISTS (
           SELECT 1
           FROM unnest($1::text[]) AS kw(term)
           WHERE NOT (
             concat_ws(' ', i.code, i.name_1, i.name_2, i.name_eng_1, i.name_eng_2, i.unit_standard) ILIKE '%' || kw.term || '%'
             OR replace(replace(lower(concat_ws(' ', i.code, i.name_1, i.name_2, i.name_eng_1, i.name_eng_2, i.unit_standard)), '-', ''), ' ', '') LIKE '%' || replace(replace(lower(kw.term), '-', ''), ' ', '') || '%'
             OR EXISTS (
               SELECT 1
               FROM ic_inventory_barcode b
               WHERE b.ic_code = i.code
                 AND (
                   b.barcode ILIKE '%' || kw.term || '%'
                   OR replace(replace(lower(b.barcode), '-', ''), ' ', '') LIKE '%' || replace(replace(lower(kw.term), '-', ''), ' ', '') || '%'
                 )
             )
           )
         )
       )
       ORDER BY i.code
       LIMIT $2`,
      [terms, limit]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/sales-settings/product-preorder-settings', requireAdmin('admin.salesSettings'), async (req, res) => {
  const search = String(req.query.search || '').trim();
  // escape % และ _ ก่อนส่งเข้า SQL ที่ต่อเป็น LIKE '%' || kw.term || '%'
  // ไม่งั้นผู้ใช้พิมพ์ % จะได้สินค้าทั้งฐาน (ดู src/utils/likePattern.js)
  const terms = getSearchTerms(search).map(escapeLike);
  const limit = Math.max(20, Math.min(100, toInt(req.query.limit, 50)));
  try {
    const settings = await getSalesSettings();
    const result = await query(
      `SELECT i.code, COALESCE(i.name_1,'') AS name_1, COALESCE(i.name_2,'') AS name_2,
              COALESCE(i.name_eng_1,'') AS name_eng_1, COALESCE(i.unit_standard,'') AS unit_standard,
              COALESCE(i.item_type,0) AS item_type,
              COALESCE(d.dimension_35,'') AS preorder_mode
       FROM ic_inventory i
       LEFT JOIN ic_inventory_detail d ON d.ic_code = i.code
       WHERE (
         COALESCE(array_length($1::text[], 1), 0) = 0
         OR NOT EXISTS (
           SELECT 1
           FROM unnest($1::text[]) AS kw(term)
           WHERE NOT (
             concat_ws(' ', i.code, i.name_1, i.name_2, i.name_eng_1, i.name_eng_2, i.unit_standard) ILIKE '%' || kw.term || '%'
             OR replace(replace(lower(concat_ws(' ', i.code, i.name_1, i.name_2, i.name_eng_1, i.name_eng_2, i.unit_standard)), '-', ''), ' ', '') LIKE '%' || replace(replace(lower(kw.term), '-', ''), ' ', '') || '%'
             OR EXISTS (
               SELECT 1
               FROM ic_inventory_barcode b
               WHERE b.ic_code = i.code
                 AND (
                   b.barcode ILIKE '%' || kw.term || '%'
                   OR replace(replace(lower(b.barcode), '-', ''), ' ', '') LIKE '%' || replace(replace(lower(kw.term), '-', ''), ' ', '') || '%'
                 )
             )
           )
         )
       )
       ORDER BY CASE WHEN COALESCE(d.dimension_35,'') IN ('1','0') THEN 0 ELSE 1 END, i.code
       LIMIT $2`,
      [terms, limit]
    );
    const data = result.rows.map((row) => {
      const preorderMode = normalizePreorderMode(row.preorder_mode);
      return {
        ...row,
        preorder_mode: preorderMode,
        preorder_allowed: resolvePreorderAllowed(preorderMode, settings.preorder_default_enabled),
      };
    });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/sales-settings/product-preorder-settings', requireAdmin('admin.salesSettings'), async (req, res) => {
  const itemCode = cleanItemCode(req.body?.item_code);
  if (!itemCode) return res.status(400).json({ success: false, message: 'กรุณาเลือกสินค้า' });
  if (!isValidPreorderModeInput(req.body?.preorder_mode)) {
    return res.status(400).json({ success: false, message: 'ค่า Preorder รายสินค้าต้องเป็น default, เปิด หรือปิดเท่านั้น' });
  }
  const preorderMode = normalizePreorderMode(req.body?.preorder_mode);

  try {
    await ensureSalesSettingsTables();
    const settings = await getSalesSettings();
    const exists = await query('SELECT 1 FROM ic_inventory WHERE code=$1 LIMIT 1', [itemCode]);
    if (!exists.rows.length) return res.status(400).json({ success: false, message: 'ไม่พบรหัสสินค้า' });

    const updated = await query(
      `UPDATE ic_inventory_detail
       SET dimension_35=$2
       WHERE ic_code=$1`,
      [itemCode, preorderMode]
    );
    if (updated.rowCount === 0) {
      await query(
        `INSERT INTO ic_inventory_detail (ic_code, maximum_qty, minimum_qty, purchase_point, dimension_35)
         VALUES ($1,0,0,0,$2)`,
        [itemCode, preorderMode]
      );
    }

    return res.json({
      success: true,
      data: {
        item_code: itemCode,
        preorder_mode: preorderMode,
        preorder_allowed: resolvePreorderAllowed(preorderMode, settings.preorder_default_enabled),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/sales-settings/featured-products', requireAdmin('admin.salesSettings'), async (req, res) => {
  try {
    const data = await queryFeaturedProducts(req.query.feature_type);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/sales-settings/featured-products', requireAdmin('admin.salesSettings'), async (req, res) => {
  const featureType = cleanFeatureType(req.body?.feature_type);
  const itemCode = cleanItemCode(req.body?.item_code);
  // ส่ง from_date: '' มา = ตั้งใจล้างวันที่ ไม่ใช่ "ไม่ได้ส่ง" — cleanDate คืน null ทั้งสองกรณี
  // ถ้าไม่แยกด้วย hasOwn แล้ว COALESCE ข้างล่างจะคงวันที่เดิมไว้ แอดมินล้างช่วงวันที่ไม่ได้เลย
  const providedFromDate = hasOwn(req.body, 'from_date');
  const providedToDate = hasOwn(req.body, 'to_date');
  const fromDate = cleanDate(req.body?.from_date);
  const toDate = cleanDate(req.body?.to_date);
  // ต้องแยก "ไม่ส่งคีย์มา" ออกจาก "ส่งค่ามาแล้วบังเอิญเท่ากับ default" ให้ชัด
  // เดิมคำนวณค่า default (1 / 0 / '') ไว้ก่อน COALESCE(EXCLUDED.col, ...) จึงไม่มีทางเห็น NULL
  // แล้ว status / line_number / note ก็ถูกทับทุกครั้งแม้ client ไม่ได้ส่งมา
  const providedLineNumber = hasOwn(req.body, 'line_number');
  const lineNumber = providedLineNumber ? parseLineNumber(req.body?.line_number) : null;
  if (!itemCode) return res.status(400).json({ success: false, message: 'กรุณาเลือกสินค้า' });
  if (isInvalidProvidedDate(req.body?.from_date) || isInvalidProvidedDate(req.body?.to_date)) {
    return res.status(400).json({ success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง' });
  }
  if (fromDate && toDate && toDate < fromDate) {
    return res.status(400).json({ success: false, message: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม' });
  }
  if (providedLineNumber && lineNumber === null) {
    return res.status(400).json({ success: false, message: 'ลำดับต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' });
  }

  try {
    await ensureSalesSettingsTables();
    const exists = await query('SELECT 1 FROM ic_inventory WHERE code=$1 LIMIT 1', [itemCode]);
    if (!exists.rows.length) return res.status(400).json({ success: false, message: 'ไม่พบรหัสสินค้า' });

    const result = await query(
      `INSERT INTO marketplace_featured_product
        (feature_type, item_code, from_date, to_date, status, line_number, note, updated_at)
       -- แถวใหม่ใช้ค่า default ของตาราง (status=1, line_number=0, note='')
       VALUES ($1,$2,$3,$4,COALESCE($5,1),COALESCE($6,0),COALESCE($7,''),NOW())
       ON CONFLICT (feature_type, item_code)
       -- อ้าง $n ตรงๆ ไม่ใช้ EXCLUDED เพราะ EXCLUDED คือค่าหลัง COALESCE ข้างบนซึ่งไม่มีวันเป็น NULL
       -- ไม่ส่งคีย์มา = คงค่าเดิม  ส่งมา = เขียนทับตามเจตนา
       DO UPDATE SET
         from_date=CASE WHEN $8 THEN $3 ELSE marketplace_featured_product.from_date END,
         to_date=CASE WHEN $9 THEN $4 ELSE marketplace_featured_product.to_date END,
         status=COALESCE($5, marketplace_featured_product.status),
         line_number=COALESCE($6, marketplace_featured_product.line_number),
         note=COALESCE($7, marketplace_featured_product.note),
         updated_at=NOW()
       RETURNING id`,
      [
        featureType,
        itemCode,
        fromDate,
        toDate,
        hasOwn(req.body, 'status') ? (Number(req.body.status) === 0 ? 0 : 1) : null,
        lineNumber,
        hasOwn(req.body, 'note') ? String(req.body.note ?? '').trim().slice(0, 255) : null,
        providedFromDate,
        providedToDate,
      ]
    );

    const data = await queryFeaturedProducts(featureType);
    return res.json({ success: true, id: result.rows[0]?.id, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/sales-settings/featured-products/delete', requireAdmin('admin.salesSettings'), async (req, res) => {
  const featureType = cleanFeatureType(req.body?.feature_type);
  const itemCode = cleanItemCode(req.body?.item_code);
  if (!itemCode) return res.status(400).json({ success: false, message: 'กรุณาเลือกสินค้า' });

  try {
    await ensureSalesSettingsTables();
    await query('DELETE FROM marketplace_featured_product WHERE feature_type=$1 AND item_code=$2', [featureType, itemCode]);
    const data = await queryFeaturedProducts(featureType);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

async function queryFeaturedProducts(featureType = '') {
  await ensureSalesSettingsTables();
  const cleanType = String(featureType || '').trim();
  const params = [];
  let where = '';
  if (cleanType) {
    params.push(cleanFeatureType(cleanType));
    where = 'WHERE fp.feature_type=$1';
  }

  // ⚠️ ต้อง ::text — คอลัมน์ date ถูก pg แปลงเป็น JS Date ที่เที่ยงคืนเวลาไทย
  //    JSON ออกไปเป็น UTC = 17:00 ของวันก่อนหน้า หน้าจอที่ตัด 10 ตัวแรกไปใส่ช่องวันที่
  //    จึงได้วันย้อนหลัง 1 วัน แล้วพอกดบันทึกก็เขียนวันที่ผิดกลับลงฐาน
  //    ทำซ้ำได้เรื่อยๆ 03-01 -> 02-28 -> 02-27 (อาการเดียวกับที่แก้ใน order.js)
  const result = await query(
    `SELECT fp.id, fp.feature_type, fp.item_code,
            fp.from_date::text AS from_date, fp.to_date::text AS to_date,
            fp.status, fp.line_number, fp.note, fp.updated_at,
            COALESCE(i.name_1,'') AS name_1,
            COALESCE(i.name_2,'') AS name_2,
            COALESCE(i.name_eng_1,'') AS name_eng_1,
            COALESCE(i.unit_standard,'') AS unit_standard
     FROM marketplace_featured_product fp
     LEFT JOIN ic_inventory i ON i.code = fp.item_code
     ${where}
     ORDER BY fp.feature_type, COALESCE(fp.line_number,0), fp.item_code`,
    params
  );
  return result.rows;
}

module.exports = router;
