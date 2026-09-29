// ระบบของแถมขาย (Sale Premium) — route (เฟส 3.2 ของ docs/sale-premium-plan.md)
//
// endpoint ใหม่ที่ไม่มีคู่ใน Java เดิม → ใช้ kebab-case ตาม .claude/rules/api-conventions.md
//
// หมายเหตุเรื่องสิทธิ์: marketplace ยังไม่บังคับ auth/permission ฝั่ง server (ดูแผนหลักเฟส 2)
// route นี้จึงไม่ใส่ permission gate เพื่อให้สอดคล้องกับ admin route อื่นทั้งหมดของ marketplace
// เมื่อเฟส 2 ของแผนหลักมาถึง จะครอบ requirePermission('admin.salePremium') ที่นี่พร้อมกันทุก route

const express = require('express');
const { randomUUID } = require('crypto');
const { requireAdmin } = require('../auth/requireAdmin');
const router = express.Router();
const { likeContains } = require('../utils/likePattern');
const { query, queryImages, withTransaction } = require('../db');
const {
  safeText,
  toNumber,
  normalizeDate,
  loadSalePremiumDetail,
  listSalePremiumProductsForSale,
  resolveBasketPricingContext,
} = require('../utils/salePremiumHelper');
const { getSalePremiumEnabled } = require('../utils/marketplaceSalesSettings');

function normalizePayload(body) {
  let payload = body || {};
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  if (payload && typeof payload.payload === 'object') payload = payload.payload;
  return payload || {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

const SALE_PREMIUM_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const SALE_PREMIUM_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function parseSalePremiumImage(value) {
  const text = String(value || '');
  if (!text) return null;
  const match = text.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !SALE_PREMIUM_IMAGE_TYPES.has(match[1].toLowerCase())) {
    throw new Error('รองรับรูป JPG, PNG, WEBP หรือ GIF เท่านั้น');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('ไฟล์รูปภาพไม่ถูกต้อง');
  if (bytes.length > SALE_PREMIUM_IMAGE_MAX_BYTES) throw new Error('รูปภาพต้องมีขนาดไม่เกิน 8MB');
  return bytes;
}

// 🚨 เดิมเอา '' (ไม่ได้ส่งมา) ไปรวมกลุ่มกับค่าปิดที่ส่งมาชัดเจน แล้วคืน fallback ทั้งกลุ่ม
//    จุดที่เรียกใช้ส่ง fallback = 1 ปุ่ม "ปิดใช้งาน" ของโปรโมชันจึงไม่ทำงานเลย
//    ส่ง show_on_web: 0 ได้ 200 แต่ค่าในฐานยังเป็น 1 แอดมินซ่อนโปรโมชันไม่ได้ ต้องลบทิ้งอย่างเดียว
//    (เฉพาะ false ที่เป็น boolean แท้ๆ เท่านั้นที่เคยปิดได้ ซึ่งหน้าจอไม่ได้ส่งแบบนั้น)
//
// ไม่ได้ส่งมา = ใช้ fallback  ส่งมาชัดเจน = ทำตามที่ส่ง
function boolFlag(value, fallback = 0) {
  if (value === true) return 1;
  if (value === false) return 0;
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim().toLowerCase();
  if (text === '') return fallback;
  if (['1', 'true', 'yes', 'y'].includes(text)) return 1;
  if (['0', 'false', 'no', 'n'].includes(text)) return 0;
  return fallback;
}

// ============================================================
// GET /sale-premium/list — รายการโปรโมชัน (สำหรับหน้าแอดมิน)
// ============================================================
router.get('/sale-premium/list', requireAdmin('admin.salePremium'), async (req, res) => {
  try {
    const search = safeText(req.query.search);
    const includeInactive = String(req.query.include_inactive ?? '0') === '1';
    const params = [];
    let where = '1=1';
    if (search) {
      params.push(likeContains(search));
      where += ` AND (p.premium_code ILIKE $${params.length} OR p.name_1 ILIKE $${params.length} OR p.name_eng_1 ILIKE $${params.length})`;
    }
    if (!includeInactive) {
      where += ' AND COALESCE(p.important,0) = 0';
    }

    const rowsRes = await query(
      `SELECT p.premium_code, p.name_1,
              COALESCE(p.name_2,'') AS name_2,
              COALESCE(p.name_eng_1,'') AS name_eng_1,
              COALESCE(p.image_guid,'') AS image_guid,
              COALESCE(p.show_on_web,1) AS show_on_web,
              p.date_begin::text AS date_begin,
              p.date_end::text AS date_end,
              COALESCE(p.important,0) AS important,
              (SELECT COUNT(*) FROM sml_sale_premium_condition c WHERE c.premium_code=p.premium_code) AS condition_count,
              (SELECT COUNT(*) FROM sml_sale_premium_free_list l WHERE l.premium_code=p.premium_code) AS list_count
         FROM sml_sale_premium p
        WHERE ${where}
        ORDER BY p.premium_code`,
      params,
    );
    // โปรฯ ที่หน่วยไม่ตรงกับที่สินค้ามีจริง จะโยน error ตอนประกอบข้อมูลขาย
    // แล้ว list-for-sale จับ catch เงียบ (console.warn) โปรฯ หายจากหน้าร้านทั้งตัว
    // ถ้าไม่บอกตรงนี้ แอดมินจะเห็นโปรฯ อยู่ในรายการแต่ลูกค้าไม่เห็น หาสาเหตุไม่ได้เลย
    const codes = rowsRes.rows.map((r) => r.premium_code);
    const badByCode = new Map();
    if (codes.length) {
      const badRs = await query(
        `SELECT x.premium_code, x.ic_code, x.unit_code
           FROM (
             SELECT premium_code, ic_code, unit_code FROM sml_sale_premium_condition WHERE premium_code = ANY($1)
             UNION ALL
             SELECT premium_code, ic_code, unit_code FROM sml_sale_premium_free_list WHERE premium_code = ANY($1)
           ) x
           LEFT JOIN ic_unit_use u ON u.ic_code = x.ic_code AND u.code = x.unit_code
          WHERE u.ic_code IS NULL`,
        [codes],
      );
      for (const r of badRs.rows) {
        const list = badByCode.get(r.premium_code) || [];
        list.push(`${r.ic_code} (${r.unit_code || 'ไม่ระบุหน่วย'})`);
        badByCode.set(r.premium_code, list);
      }
    }

    const data = rowsRes.rows.map((r) => {
      const bad = badByCode.get(r.premium_code);
      return {
        ...r,
        sellable: !bad,
        unsellable_reason: bad ? `หน่วยไม่ตรงกับสินค้า: ${bad.join(', ')}` : '',
      };
    });

    return res.json({ success: true, data });
  } catch (ex) {
    console.error('sale-premium/list:', ex.message);
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ============================================================
// GET /sale-premium/detail?premium_code= — หัว + conditions + free list (สำหรับแก้ไข)
// ============================================================
router.get('/sale-premium/detail', requireAdmin('admin.salePremium'), async (req, res) => {
  const code = safeText(req.query.premium_code);
  if (!code) return res.status(400).json({ success: false, msg: 'premium_code is required' });
  try {
    const [headerRes, condRes, freeRes] = await Promise.all([
      query(
        `SELECT premium_code, name_1,
                COALESCE(name_2,'') AS name_2,
                COALESCE(name_eng_1,'') AS name_eng_1,
                COALESCE(image_guid,'') AS image_guid,
                COALESCE(show_on_web,1) AS show_on_web,
                date_begin::text AS date_begin, date_end::text AS date_end,
                COALESCE(important,0) AS important, COALESCE(remark,'') AS remark
           FROM sml_sale_premium WHERE premium_code=$1 LIMIT 1`,
        [code],
      ),
      query(
        `SELECT c.premium_code, c.ic_code, c.unit_code, c.qty::text AS qty,
                c.stand_value::text AS stand_value, c.divide_value::text AS divide_value,
                COALESCE(i.name_1,'') AS ic_name, COALESCE(u.name_1,'') AS unit_name,
                c.roworder AS line_number
           FROM sml_sale_premium_condition c
           LEFT JOIN ic_inventory i ON i.code=c.ic_code
           LEFT JOIN ic_unit u ON u.code=c.unit_code
          WHERE c.premium_code=$1 ORDER BY c.roworder, c.ic_code`,
        [code],
      ),
      query(
        `SELECT l.premium_code, l.ic_code, l.unit_code, l.qty::text AS qty,
                l.stand_value::text AS stand_value, l.divide_value::text AS divide_value,
                COALESCE(i.name_1,'') AS ic_name, COALESCE(u.name_1,'') AS unit_name,
                l.roworder AS line_number
           FROM sml_sale_premium_free_list l
           LEFT JOIN ic_inventory i ON i.code=l.ic_code
           LEFT JOIN ic_unit u ON u.code=l.unit_code
          WHERE l.premium_code=$1 ORDER BY l.roworder, l.ic_code`,
        [code],
      ),
    ]);
    const header = headerRes.rows[0];
    if (!header) return res.status(404).json({ success: false, msg: 'premium not found' });
    return res.json({ success: true, data: { ...header, conditions: condRes.rows, lists: freeRes.rows } });
  } catch (ex) {
    console.error('sale-premium/detail:', ex.message);
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ============================================================
// GET /sale-premium/detail-for-sale — รายละเอียดพร้อมราคา/สต็อก (สำหรับหน้าร้าน)
// เคารพ feature flag: ปิดอยู่ → 404
// ============================================================
router.get('/sale-premium/detail-for-sale', async (req, res) => {
  const code = safeText(req.query.premium_code);
  if (!code) return res.status(400).json({ success: false, msg: 'premium_code is required' });
  try {
    if (!(await getSalePremiumEnabled())) {
      return res.status(404).json({ success: false, msg: 'sale premium disabled' });
    }
    const basketCtx = await resolveBasketPricingContext(query, safeText(req.query.cust_code));
    const saleTypeReq = parseInt(req.query.sale_type, 10);
    const vatTypeReq = parseInt(req.query.vat_type, 10);
    const vatRateReq = parseFloat(req.query.vat_rate);
    const detail = await loadSalePremiumDetail(query, code, {
      custCode: safeText(req.query.cust_code),
      saleType: Number.isNaN(saleTypeReq) ? basketCtx.saleType : saleTypeReq,
      vatType: Number.isNaN(vatTypeReq) ? basketCtx.vatType : vatTypeReq,
      vatRate: Number.isNaN(vatRateReq) ? basketCtx.vatRate : vatRateReq,
      docDate: safeText(req.query.doc_date),
    });
    return res.json({ success: true, data: detail });
  } catch (ex) {
    console.error('sale-premium/detail-for-sale:', ex.message);
    return res.status(400).json({ success: false, msg: ex.message });
  }
});

// ============================================================
// GET /sale-premium/list-for-sale — โปรโมชันที่ active สำหรับหน้าร้าน
// ============================================================
router.get('/sale-premium/list-for-sale', async (req, res) => {
  try {
    if (!(await getSalePremiumEnabled())) {
      return res.json({ success: true, data: [] });
    }
    const basketCtx = await resolveBasketPricingContext(query, safeText(req.query.cust_code));
    const saleTypeReq = parseInt(req.query.sale_type, 10);
    const vatTypeReq = parseInt(req.query.vat_type, 10);
    const vatRateReq = parseFloat(req.query.vat_rate);
    const data = await listSalePremiumProductsForSale(query, {
      custCode: safeText(req.query.cust_code),
      search: safeText(req.query.search),
      isStock: req.query.is_stock,
      offset: req.query.offset,
      limit: req.query.limit,
      saleType: Number.isNaN(saleTypeReq) ? basketCtx.saleType : saleTypeReq,
      vatType: Number.isNaN(vatTypeReq) ? basketCtx.vatType : vatTypeReq,
      vatRate: Number.isNaN(vatRateReq) ? basketCtx.vatRate : vatRateReq,
      docDate: safeText(req.query.doc_date),
    });
    return res.json({ success: true, data });
  } catch (ex) {
    console.error('sale-premium/list-for-sale:', ex.message);
    return res.status(500).json({ success: false, msg: ex.message });
  }
});

// ============================================================
// POST /sale-premium/save — create / update
// ============================================================
router.post('/sale-premium/save', requireAdmin('admin.salePremium'), async (req, res) => {
  const payload = normalizePayload(req.body);
  const userCode = safeText(payload.emp_code || req.query.user_code);

  const premiumCode = safeText(payload.premium_code);
  const name1 = safeText(payload.name_1);
  const dateBegin = normalizeDate(payload.date_begin);
  const dateEnd = normalizeDate(payload.date_end);
  // ใช้ boolFlag ให้เหมือน show_on_web เดิม toNumber ทำให้ "true"/"yes" กลายเป็น 0
  const important = boolFlag(payload.important, 0);
  const showOnWeb = boolFlag(payload.show_on_web, 1);
  // ตอนแก้ของเดิม: ไม่ส่งคีย์มา = ไม่แตะ (เดิมรีเซ็ตเป็น default ปลดสถานะเองโดย client ไม่ได้สั่ง)
  // ตอนสร้างใหม่ยังใช้ค่า default ของ boolFlag ตามเดิม
  const providedImportant = Object.prototype.hasOwnProperty.call(payload, 'important');
  const providedShowOnWeb = Object.prototype.hasOwnProperty.call(payload, 'show_on_web');
  const clearImage = boolFlag(payload.clear_image, 0) === 1;
  const conditions = normalizeArray(payload.conditions);
  const lists = normalizeArray(payload.lists);

  if (!premiumCode) return res.status(400).json({ success: false, msg: 'premium_code is required' });
  if (!name1) return res.status(400).json({ success: false, msg: 'name_1 is required' });
  if (!conditions.length) return res.status(400).json({ success: false, msg: 'conditions cannot be empty' });
  if (!lists.length) return res.status(400).json({ success: false, msg: 'lists cannot be empty' });

  const badRows = (arr) => arr
    .map((row, idx) => ({ idx, code: safeText(row?.ic_code), unit: safeText(row?.unit_code), qty: toNumber(row?.qty) }))
    .filter((row) => !row.code || !row.unit || row.qty <= 0)
    .map((row) => row.idx + 1);

  const badConditions = badRows(conditions);
  if (badConditions.length) return res.status(400).json({ success: false, msg: `invalid condition rows: ${badConditions.join(', ')}` });
  const badLists = badRows(lists);
  if (badLists.length) return res.status(400).json({ success: false, msg: `invalid free rows: ${badLists.join(', ')}` });

  // ตรวจเทียบเท่าที่ /sales-settings/featured-products ตรวจอยู่แล้ว
  // เดิมสร้างโปรที่วันสิ้นสุดมาก่อนวันเริ่ม (ไม่มีวันทำงานเลย) หรืออ้างสินค้าที่ไม่มีจริงได้
  if (dateBegin && dateEnd && String(dateEnd) < String(dateBegin)) {
    return res.status(400).json({ success: false, msg: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม' });
  }

  try {
    const imageBytes = parseSalePremiumImage(payload.image_file);
    const providedImageGuid = Object.prototype.hasOwnProperty.call(payload, 'image_guid');
    const imageChanged = Boolean(imageBytes) || clearImage || providedImageGuid;
    const nextImageGuid = imageBytes ? randomUUID() : (clearImage ? '' : safeText(payload.image_guid));

    const wantedCodes = [...new Set([...conditions, ...lists].map((row) => safeText(row?.ic_code)).filter(Boolean))];
    const foundRs = await query('SELECT code FROM ic_inventory WHERE code = ANY($1)', [wantedCodes]);
    const found = new Set(foundRs.rows.map((r) => String(r.code)));
    const missing = wantedCodes.filter((code) => !found.has(code));
    if (missing.length) {
      return res.status(400).json({ success: false, msg: `ไม่พบสินค้า: ${missing.join(', ')}` });
    }

    // 🚨 หน่วยต้องเป็นหน่วยที่สินค้านั้นมีจริง (ic_unit_use)
    //    loadSalePremiumDetail จะโยน error ถ้าหาไม่เจอ แล้ว list-for-sale จับ catch เงียบ
    //    (salePremiumHelper: console.warn แล้ว continue) โปรฯ จึงหายจากหน้าร้านทั้งตัว
    //    โดยที่ตอนบันทึกตอบ 200 ปกติ — แอดมินไม่มีทางรู้ว่าทำไมลูกค้าไม่เห็นโปรฯ
    const unitPairs = [...conditions, ...lists]
      .map((row) => ({ code: safeText(row?.ic_code), unit: safeText(row?.unit_code) }))
      .filter((p) => p.code && p.unit);
    const uniquePairs = [...new Map(unitPairs.map((p) => [`${p.code}|${p.unit}`, p])).values()];
    if (uniquePairs.length) {
      const unitRs = await query(
        `SELECT ic_code, code AS unit_code FROM ic_unit_use
          WHERE (ic_code, code) IN (${uniquePairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})`,
        uniquePairs.flatMap((p) => [p.code, p.unit]),
      );
      const okPairs = new Set(unitRs.rows.map((r) => `${r.ic_code}|${r.unit_code}`));
      const badUnits = uniquePairs.filter((p) => !okPairs.has(`${p.code}|${p.unit}`));
      if (badUnits.length) {
        // บอกด้วยว่าสินค้านั้นมีหน่วยอะไรให้เลือก แอดมินจะได้แก้ได้ทันทีไม่ต้องเดา
        const hintRs = await query(
          'SELECT ic_code, code AS unit_code FROM ic_unit_use WHERE ic_code = ANY($1) ORDER BY ic_code, code',
          [[...new Set(badUnits.map((p) => p.code))]],
        );
        const hintByCode = new Map();
        for (const r of hintRs.rows) {
          const list = hintByCode.get(r.ic_code) || [];
          list.push(r.unit_code);
          hintByCode.set(r.ic_code, list);
        }
        const detail = badUnits
          .map((p) => {
            const units = hintByCode.get(p.code) || [];
            return `${p.code} ไม่มีหน่วย "${p.unit}"${units.length ? ` (มี: ${units.join(', ')})` : ' (สินค้านี้ยังไม่ได้ตั้งหน่วยขาย)'}`;
          })
          .join(' · ');
        return res.status(400).json({ success: false, msg: `หน่วยไม่ถูกต้อง: ${detail}` });
      }
    }

    // เก็บ BLOB ก่อน metadata เหมือน saveProductImage: ถ้า main DB บันทึกไม่สำเร็จจะลบ BLOB ใหม่ชดเชย
    if (imageBytes) {
      await queryImages(
        `INSERT INTO images (image_id, image_file, guid_code, image_order) VALUES ($1,$2,$3,0)`,
        [premiumCode, imageBytes, nextImageGuid],
      );
    }

    let result;
    try {
      result = await withTransaction(async (client) => {
        const existing = await client.query(
          `SELECT roworder, COALESCE(image_guid,'') AS image_guid
             FROM sml_sale_premium WHERE premium_code=$1 LIMIT 1`,
          [premiumCode],
        );
        if (existing.rows[0]) {
          await client.query(
          // name_2/image_guid: หน้าแอดมินยังไม่มีช่องกรอก ถ้าเขียนทับตรงๆ ค่าที่ตั้งไว้ทาง ERP จะหายทุกครั้งที่กดบันทึก
          // จึงเก็บค่าเดิมไว้เมื่อ payload ไม่ได้ส่งมา (pattern เดียวกับ guid_code ด้านล่าง)
          `UPDATE sml_sale_premium
              SET name_1=$2, name_2=COALESCE(NULLIF($3,''), name_2),
                  -- ทำให้สอดคล้องกับ name_2/image_guid/guid_code ที่กันไว้อยู่แล้ว
                  -- เดิม name_eng_1 กับ remark ถูกล้างเมื่อไม่ได้ส่งคีย์นั้นมา
                  name_eng_1=COALESCE(NULLIF($4,''), name_eng_1),
                  image_guid=CASE WHEN $14 THEN $5 ELSE image_guid END,
                  show_on_web=CASE WHEN $12 THEN $6 ELSE show_on_web END,
                  date_begin=$7::date, date_end=$8::date,
                  important=CASE WHEN $13 THEN $9 ELSE important END,
                  remark=COALESCE(NULLIF($10,''), remark),
                  guid_code=COALESCE(NULLIF($11,''), guid_code), create_date_time_now=NOW()
            WHERE premium_code=$1`,
          [premiumCode, name1, safeText(payload.name_2), safeText(payload.name_eng_1),
            nextImageGuid, showOnWeb, dateBegin, dateEnd, important,
            safeText(payload.remark), safeText(payload.guid_code), providedShowOnWeb, providedImportant, imageChanged],
          );
        } else {
          await client.query(
          `INSERT INTO sml_sale_premium
              (premium_code, name_1, name_2, name_eng_1, image_guid, show_on_web,
               date_begin, date_end, important, remark, guid_code, creator_code, create_date_time_now)
           VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,NOW())`,
          [premiumCode, name1, safeText(payload.name_2), safeText(payload.name_eng_1),
            nextImageGuid, showOnWeb, dateBegin, dateEnd, important,
            safeText(payload.remark), safeText(payload.guid_code), userCode],
          );
        }

        if (imageChanged) {
          await client.query('DELETE FROM images WHERE image_id=$1', [premiumCode]);
          if (nextImageGuid) {
            await client.query(
              'INSERT INTO images (image_id, guid_code, image_order) VALUES ($1,$2,0)',
              [premiumCode, nextImageGuid],
            );
          }
        }

        await client.query('DELETE FROM sml_sale_premium_condition WHERE premium_code=$1', [premiumCode]);
        for (const row of conditions) {
          await client.query(
          `INSERT INTO sml_sale_premium_condition (premium_code, ic_code, unit_code, qty, stand_value, divide_value)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [premiumCode, safeText(row.ic_code), safeText(row.unit_code), toNumber(row.qty),
            toNumber(row.stand_value, 1), toNumber(row.divide_value, 1)],
          );
        }

        await client.query('DELETE FROM sml_sale_premium_free_list WHERE premium_code=$1', [premiumCode]);
        for (const row of lists) {
          await client.query(
          `INSERT INTO sml_sale_premium_free_list (premium_code, ic_code, unit_code, qty, stand_value, divide_value)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [premiumCode, safeText(row.ic_code), safeText(row.unit_code), toNumber(row.qty),
            toNumber(row.stand_value, 1), toNumber(row.divide_value, 1)],
          );
        }
        return { premium_code: premiumCode, condition_count: conditions.length, list_count: lists.length, image_guid: nextImageGuid };
      });
    } catch (error) {
      if (imageBytes) {
        await queryImages('DELETE FROM images WHERE guid_code=$1', [nextImageGuid]).catch(() => {});
      }
      throw error;
    }

    // metadata ชี้รูปใหม่เรียบร้อยแล้ว จึงค่อยล้าง BLOB รูปเดิม ป้องกันช่วงที่รูปหายกลางการบันทึก
    if (imageChanged) {
      const cleanupSql = nextImageGuid
        ? 'DELETE FROM images WHERE image_id=$1 AND guid_code<>$2'
        : 'DELETE FROM images WHERE image_id=$1';
      const cleanupParams = nextImageGuid ? [premiumCode, nextImageGuid] : [premiumCode];
      await queryImages(cleanupSql, cleanupParams).catch((cleanupError) => {
        console.error(`sale-premium/save: cleanup old image ${premiumCode} failed:`, cleanupError.message);
      });
    }
    return res.json({ success: true, msg: 'success', data: result });
  } catch (ex) {
    console.error('sale-premium/save:', ex.message);
    return res.status(400).json({ success: false, msg: ex.message });
  }
});

// ============================================================
// POST /sale-premium/delete
// ============================================================
router.post('/sale-premium/delete', requireAdmin('admin.salePremium'), async (req, res) => {
  const payload = normalizePayload(req.body);
  const premiumCode = safeText(payload.premium_code);
  if (!premiumCode) return res.status(400).json({ success: false, msg: 'premium_code is required' });
  try {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM sml_sale_premium_condition WHERE premium_code=$1', [premiumCode]);
      await client.query('DELETE FROM sml_sale_premium_free_list WHERE premium_code=$1', [premiumCode]);
      await client.query('DELETE FROM images WHERE image_id=$1', [premiumCode]);
      const result = await client.query('DELETE FROM sml_sale_premium WHERE premium_code=$1', [premiumCode]);
      if (result.rowCount === 0) throw new Error(`premium_code not found: ${premiumCode}`);
    });
    await queryImages('DELETE FROM images WHERE image_id=$1', [premiumCode]).catch((cleanupError) => {
      console.error(`sale-premium/delete: cleanup image ${premiumCode} failed:`, cleanupError.message);
    });
    return res.json({ success: true, msg: 'deleted', data: { premium_code: premiumCode } });
  } catch (ex) {
    console.error('sale-premium/delete:', ex.message);
    return res.status(400).json({ success: false, msg: ex.message });
  }
});

module.exports = router;
module.exports.parseSalePremiumImage = parseSalePremiumImage;
