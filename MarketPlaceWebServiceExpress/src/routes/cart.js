const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../db');
const { safePage, safePageSize } = require('../utils/response');
const { getPreorderDefaultEnabled, getSalePremiumEnabled, getStockDisplayPercent, resolvePreorderAllowed } = require('../utils/marketplaceSalesSettings');
const { loadSalePremiumDetail } = require('../utils/salePremiumHelper');
const { getMaxAllowanceForUnit } = require('../utils/maxAllowance');
const { safeText } = require('../utils/salePremiumHelper');
const { checkErpCodes, ERP_CODE_SQL_PATTERN, ERP_CODE_SQL_PATTERN_OPTIONAL } = require('../utils/erpCodeGuard');

const DEFAULT_WH_CODE = process.env.MARKETPLACE_DEFAULT_WH_CODE || '';
// ขอบเขตของ payload ตะกร้า — ตัวเลขเผื่อการกดเพิ่มหลายรายการรวดเดียวตามปกติ
const MAX_CART_ITEMS_PER_REQUEST = 200;
const MAX_CART_NUMERIC = 1e9;

function toNumber(value, fallback = 0) {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function isSalePremiumCartItem(item) {
  return String(item?.item_type ?? '') === '4' || safeText(item?.sale_premium_code) !== '';
}

function getMarketplaceInventoryCodes(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .filter((item) => !isSalePremiumCartItem(item))
    .map((item) => safeText(item?.item_code))
    .filter(Boolean))];
}

function mapCartItemListRow(r, preorderDefaultEnabled) {
  return {
    cust_code: r.cust_code,
    guid_code: r.guid_code,
    item_code: r.item_code,
    item_name: r.item_name,
    name_eng_1: r.name_eng_1 || '',
    unit_code: r.unit_code,
    item_type: r.item_type,
    is_promotion: r.is_promotion,
    barcode: r.barcode,
    qty: r.qty,
    price: r.price,
    wh_code: r.wh_code,
    shelf_code: r.shelf_code,
    creator_code: r.creator_code,
    create_datetime: r.create_datetime,
    stand_value: r.stand_value,
    divide_value: r.divide_value,
    ratio: r.ratio,
    unit_standard: r.unit_standard || '',
    remark: r.remark,
    balance_qty: 0,
    tax_type: toInt(r.tax_type, 0),
    preorder_mode: r.preorder_mode || 'default',
    preorder_allowed: resolvePreorderAllowed(r.preorder_mode, preorderDefaultEnabled),
    max_order_qty: getMaxAllowanceForUnit(r.max_allowance_csv, r.unit_code),
    is_sale_premium: String(r.item_type) === '4' ? 1 : 0,
    sale_premium_code: r.sale_premium_code || '',
    sale_premium_name: r.sale_premium_name || '',
    sale_premium_data: r.sale_premium_data || '',
  };
}

async function resolveBasketPricingContext(custCode) {
  if (!custCode || !String(custCode).trim()) {
    return { saleType: null, vatType: null, vatRate: null };
  }
  try {
    const rs = await query(
      `SELECT COALESCE(inquiry_type,0) AS sale_type,
              COALESCE(vat_type,0) AS vat_type,
              COALESCE(vat_rate,0) AS vat_rate
       FROM pos_basket
       WHERE cust_code=$1
       ORDER BY basket_id DESC
       LIMIT 1`,
      [custCode]
    );
    if (rs.rows.length > 0) {
      return {
        saleType: toInt(rs.rows[0].sale_type, 0),
        vatType: toInt(rs.rows[0].vat_type, 0),
        vatRate: toNumber(rs.rows[0].vat_rate, 0),
      };
    }
  } catch (_) {}
  return { saleType: null, vatType: null, vatRate: null };
}

// POST /service/v1/additemtocart
// Body: JSON Array [...] — เลียนแบบ Java: รับ String data แล้ว new JSONArray(data)
router.post('/additemtocart', async (req, res) => {
  const resp = { success: false };
  try {
    let bodyStr = req.body;
    if (typeof bodyStr === 'object') bodyStr = JSON.stringify(bodyStr);

    const items = JSON.parse(bodyStr);
    if (!Array.isArray(items)) {
      return res.status(400).json({ ERROR: 'Data must be a JSON array' });
    }

    // ⚠️ รหัสในตะกร้าจะถูกส่งต่อเข้าฟังก์ชันสต็อกของ ERP ที่เอาไปต่อ SQL เอง
    //    ถ้าปล่อยให้เก็บรหัสแปลกๆ ลงตารางได้ จะกลายเป็น stored SQL injection
    //    ตรวจก่อนเปิดทรานแซกชัน จะได้ไม่ต้อง rollback ทีหลัง
    // 🚨 เดิมไม่จำกัดจำนวนรายการ ส่ง 500 รายการใช้เวลา 17 วินาทีในทรานแซกชันเดียว
    //    ถือ connection ไว้ตลอด ยิงพร้อมกันไม่กี่ request pool ก็ตันทั้งระบบ
    if (items.length > MAX_CART_ITEMS_PER_REQUEST) {
      return res.status(400).json({ ERROR: `ส่งได้สูงสุด ${MAX_CART_ITEMS_PER_REQUEST} รายการต่อครั้ง` });
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const at = `รายการที่ ${i + 1}`;
      // 🚨 เดิมเช็คแค่ Array.isArray ส่ง ["abc"] หรือ [1,2,3] จึงได้ 200
      //    แล้วสร้างแถวขยะ cust_code/item_code ว่างลงตารางจริง
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return res.status(400).json({ ERROR: `${at} ไม่ถูกต้อง` });
      }
      if (!String(item.cust_code ?? '').trim()) {
        return res.status(400).json({ ERROR: `${at} ไม่มีรหัสลูกค้า` });
      }
      if (!String(item.item_code ?? '').trim()) {
        return res.status(400).json({ ERROR: `${at} ไม่มีรหัสสินค้า` });
      }
      // 🚨 เดิมส่ง item.qty.toString() ดิบเข้า INSERT ให้ Postgres cast เอง
      //    qty:"NaN" จึงเข้าคอลัมน์ numeric ได้จริง แล้ว getCartSummary ตอบ NaN ทั้งตะกร้า
      //    จากบรรทัดเดียว ส่วน qty ติดลบ/1e30 ก็เข้าไปได้หมด
      const numericFields = [['qty', item.qty, 1], ['price', item.price, 0]];
      for (const [name, raw, minValue] of numericFields) {
        if (raw === undefined || raw === null) continue;
        const num = Number(typeof raw === 'string' ? raw.replace(/,/g, '').trim() : raw);
        if (!Number.isFinite(num) || num < minValue || num > MAX_CART_NUMERIC) {
          return res.status(400).json({ ERROR: `${at} ค่า ${name} ไม่ถูกต้อง` });
        }
      }
      const codeError = checkErpCodes({
        item_code: item?.item_code,
        wh_code: item?.wh_code,
        shelf_code: item?.shelf_code,
      });
      if (codeError) return res.status(400).json({ ERROR: codeError });
    }

    // โปรโมชันของแถมมี premium_code เป็นรหัสหัวโปร (เช่น PRO001) ไม่ใช่ ic_inventory.code
    // จึงต้องตรวจจาก sml_sale_premium และประกอบค่าราคา/หน่วยจาก master ฝั่ง server
    // ห้ามเชื่อราคา/free_items ที่ client ส่งมา และห้ามนำรหัสหัวโปรไปตรวจ item_pattern='[W]'
    const premiumItems = items.filter(isSalePremiumCartItem);
    if (premiumItems.length) {
      if (!(await getSalePremiumEnabled())) {
        return res.status(400).json({ ERROR: 'ระบบโปรโมชันของแถมปิดใช้งานอยู่' });
      }

      for (const item of premiumItems) {
        const premiumCode = safeText(item.sale_premium_code || item.item_code);
        if (!premiumCode || premiumCode !== safeText(item.item_code)) {
          return res.status(400).json({ ERROR: 'รหัสโปรโมชันของแถมไม่ถูกต้อง' });
        }

        const basketCtx = await resolveBasketPricingContext(safeText(item.cust_code));
        let detail;
        try {
          detail = await loadSalePremiumDetail(query, premiumCode, {
            custCode: safeText(item.cust_code),
            saleType: basketCtx.saleType,
            vatType: basketCtx.vatType,
            vatRate: basketCtx.vatRate,
          });
        } catch (_) {
          return res.status(400).json({ ERROR: `โปรโมชันของแถมไม่พร้อมใช้งาน: ${premiumCode}` });
        }

        // Pending requests are allocated by staff; stock is not a cart admission rule.

        item.item_code = detail.premium_code;
        item.item_name = detail.premium_name;
        item.unit_code = detail.unit_code;
        item.barcode = '';
        item.price = detail.price;
        item.wh_code = detail.wh_code || '';
        item.shelf_code = detail.shelf_code || '';
        item.ratio = '1';
        item.stand_value = '1';
        item.divide_value = '1';
        item.item_type = '4';
        item.is_promotion = '1';
        item.sale_premium_code = detail.premium_code;
        item.sale_premium_name = detail.premium_name;
        item.sale_premium_data = JSON.stringify({
          image_guid: detail.image_guid || '',
          free_items: detail.free_items || [],
        });
      }
    }

    // 🚨 สินค้าปกติต้องมีจริงและเปิดขายบนเว็บ ไม่งั้นได้แถวผีที่ลูกค้ามองไม่เห็นแต่ลบเองไม่ได้
    //    getCartItems join กับ ic_inventory จึงกรองแถวพวกนี้ทิ้ง หน้าตะกร้าเลยว่าง
    //    แต่แถวยังอยู่ในฐาน และ sendorder ตรวจเจอแล้วตอบ
    //    "สินค้าต่อไปนี้ไม่เปิดขายบนหน้าเว็บแล้ว กรุณานำออกจากตะกร้า"
    //    ลูกค้าจึงติดตาย — สั่งซื้อไม่ได้ และมองไม่เห็นว่าต้องเอาอะไรออก
    //    กันตั้งแต่ตอนใส่ตะกร้า ให้สอดคล้องกับที่ sendorder ตรวจอยู่แล้ว
    const wantedCodes = getMarketplaceInventoryCodes(items);
    if (wantedCodes.length) {
      const foundRs = await query(
        `SELECT code FROM ic_inventory WHERE code = ANY($1) AND item_pattern = '[W]'`,
        [wantedCodes],
      );
      const sellable = new Set(foundRs.rows.map((r) => String(r.code)));
      const missing = wantedCodes.filter((code) => !sellable.has(code));
      if (missing.length) {
        return res.status(400).json({ ERROR: `สินค้าต่อไปนี้ไม่เปิดขายบนหน้าเว็บ: ${missing.join(', ')}` });
      }
    }

    // เลียนแบบ Java: loop ทุก item → DELETE เดิม → INSERT ใหม่
    // ต้องอยู่ใน transaction: DELETE แล้ว INSERT ถ้าพังกลางทางบรรทัดในตะกร้าจะหายไปเฉยๆ
    await withTransaction(async (client) => {
      for (const item of items) {
        const cust_code = item.cust_code || '';
        const emp_code = item.emp_code || '';
        const guid_code = item.guid_code || '';
        const item_code = item.item_code || '';
        const item_name = item.item_name || '';
        const unit_code = item.unit_code || '';
        const barcode = item.barcode || '';
        const qty = item.qty !== undefined ? item.qty.toString() : '1';
        const price = item.price !== undefined ? item.price.toString() : '0';
        const item_type = item.item_type !== undefined ? item.item_type.toString() : '0';
        const wh_code = item.wh_code || '';
        const shelf_code = item.shelf_code || '';
        const stand_value = item.stand_value !== undefined ? item.stand_value.toString() : '1';
        const divide_value = item.divide_value !== undefined ? item.divide_value.toString() : '1';
        const ratio = item.ratio !== undefined ? item.ratio.toString() : '1';
        const remark = item.remark || '';
        // โปรโมชันของแถม: เก็บรหัส/ชื่อ/ข้อมูลชุดไว้ให้ตะกร้าแสดงและ sendorder ใช้ expand
        const sale_premium_code = item.sale_premium_code || '';
        const sale_premium_name = item.sale_premium_name || '';
        const sale_premium_data = item.sale_premium_data
          ? (typeof item.sale_premium_data === 'string' ? item.sale_premium_data : JSON.stringify(item.sale_premium_data))
          : '';

        // DELETE เดิมก่อน (เหมือน Java)
        await client.query(
          `DELETE FROM staff_cart_order
           WHERE item_code = $1 AND unit_code = $2 AND barcode = $3 AND cust_code = $4`,
          [item_code, unit_code, barcode, cust_code]
        );

        // INSERT ใหม่
        await client.query(
          `INSERT INTO staff_cart_order
           (item_type, cust_code, guid_code, item_code, item_name, unit_code, barcode,
            qty, price, wh_code, shelf_code, creator_code, create_datetime,
            stand_value, divide_value, ratio, remark,
            sale_premium_code, sale_premium_name, sale_premium_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13,$14,$15,$16,$17,$18,$19)`,
          [item_type, cust_code, guid_code, item_code, item_name, unit_code, barcode,
           qty, price, wh_code, shelf_code, emp_code,
           stand_value, divide_value, ratio, remark,
           sale_premium_code, sale_premium_name, sale_premium_data]
        );
      }
    });

    resp.success = true;
    resp.msg = 'success';
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getcartitemlist
router.get('/getcartitemlist', async (req, res) => {
  const custCode = safeText(req.query.cust_code);
  const page = safePage(req.query.page);
  const pageSize = safePageSize(req.query.page_size);
  const search = safeText(req.query.search);

  const resp = { success: false };

  if (!custCode || !custCode.trim()) {
    return res.status(400).json({ error: 'cust_code is required' });
  }

  const offset = (page - 1) * pageSize;
  let searchCondition = '';
  const params = [custCode];

  if (search && search.trim()) {
    searchCondition = ' AND (item_code ILIKE $2 OR item_name ILIKE $2)';
    params.push(`%${search.trim()}%`);
  }

  try {
    // COUNT
    const countSql = `SELECT COUNT(*) AS total_count FROM staff_cart_order WHERE cust_code = $1${searchCondition}`;
    const countResult = await query(countSql, params);
    const totalCount = toInt(countResult.rows[0].total_count, 0);

    // DATA — เลียนแบบ Java: fields ครบ + balance_qty=0 + tax_type จาก ic_inventory
    const dataSql = `
      SELECT sco.cust_code, sco.guid_code, sco.item_code, sco.item_name, sco.unit_code,
             sco.item_type, sco.barcode, sco.qty, sco.price, sco.wh_code, sco.shelf_code,
             sco.creator_code, sco.create_datetime, sco.stand_value, sco.divide_value,
             sco.ratio, sco.remark, 0 AS balance_qty,
             COALESCE(sco.sale_premium_code,'') AS sale_premium_code,
             COALESCE(sco.sale_premium_name,'') AS sale_premium_name,
             COALESCE(sco.sale_premium_data,'') AS sale_premium_data,
             COALESCE(d.dimension_35,'') AS preorder_mode,
             COALESCE(d.dimension_38,'') AS max_allowance_csv,
             COALESCE(i.name_eng_1, '') AS name_eng_1,
             -- หน่วยฐานของสินค้า ใช้แสดง "1 ลัง = 24 ชิ้น" ในตะกร้า (รีวิว 260908 สไลด์ 1)
             -- ic_inventory ถูก join อยู่แล้ว จึงไม่มีต้นทุนเพิ่ม
             COALESCE(i.unit_standard, '') AS unit_standard,
             COALESCE(i.tax_type, 0) AS tax_type,
             CASE WHEN (
               COALESCE((SELECT ic_code FROM ic_inventory_price
                 WHERE ic_code = sco.item_code
                   AND unit_code = sco.unit_code
                   AND CURRENT_DATE BETWEEN from_date AND to_date
                   AND ((cust_code = '' OR cust_code = $1)
                   AND (cust_group_1 = '' OR cust_group_1 = (SELECT group_main FROM ar_customer_detail WHERE ar_code = $1)))
                 LIMIT 1),'') != ''
               OR EXISTS (SELECT 1 FROM ic_inventory_discount
                 WHERE ic_code = sco.item_code
                   AND unit_code = sco.unit_code
                   AND CURRENT_DATE BETWEEN from_date AND to_date
                   AND (
                     discount_type = 0
                     OR (discount_type = 2 AND cust_code = $1)
                     OR (discount_type = 1 AND cust_group_1 = (SELECT group_main FROM ar_customer_detail WHERE ar_code = $1))
                   ))
             ) THEN '1' ELSE '0' END AS is_promotion
      FROM staff_cart_order sco
      LEFT JOIN ic_inventory i ON i.code = sco.item_code
      LEFT JOIN ic_inventory_detail d ON d.ic_code = sco.item_code
      WHERE sco.cust_code = $1${searchCondition}
      ORDER BY sco.item_code ASC, sco.unit_code ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const dataParams = [...params, pageSize, offset];
    const [dataResult, preorderDefaultEnabled, stockDisplayPercent] = await Promise.all([
      query(dataSql, dataParams),
      getPreorderDefaultEnabled(),
      getStockDisplayPercent(),
    ]);

    // โปรโมชันของแถมไม่มี stock ของรหัสโปรเอง และหน้าตะกร้าไม่ lazy-load stock ให้รายการโปร
    // ถ้าปล่อย balance_qty=0 ตามแถวใน DB บรรทัดโปรจะถูกตีเป็น Preorder ทั้งที่ของครบ
    // จึงต้องคิดจำนวนชุดที่พร้อมส่งจากชิ้นส่วนจริงที่นี่ เหมือนที่ getcartorder ทำ
    const premiumDetailCache = new Map();
    const loadPremiumDetailCached = (premiumCode) => {
      if (!premiumDetailCache.has(premiumCode)) {
        premiumDetailCache.set(
          premiumCode,
          loadSalePremiumDetail(query, premiumCode, {
            custCode,
            stockPercent: stockDisplayPercent,
            preorderDefaultEnabled,
          }).catch(() => null), // โปรหมดอายุ/ถูกปิด — validatecartstock จะแจ้งเหตุผลละเอียดเอง
        );
      }
      return premiumDetailCache.get(premiumCode);
    };

    const data = await Promise.all(dataResult.rows.map(async (row) => {
      const item = mapCartItemListRow(row, preorderDefaultEnabled);
      if (isSalePremiumCartItem(row)) {
        const premiumCode = safeText(row.sale_premium_code || row.item_code);
        const detail = premiumCode ? await loadPremiumDetailCached(premiumCode) : null;
        item.balance_qty = toInt(detail?.balance_qty ?? detail?.stock_qty, 0);
        item.preorder_allowed = Boolean(detail?.preorder_allowed);
        item.is_sale_premium = 1;
      }
      return item;
    }));

    resp.success = true;
    resp.page = page;
    resp.page_size = pageSize;
    resp.total_count = totalCount;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(500).json({ error: ex.message });
  }
});

// GET /service/v1/getCartSummary
router.get('/getCartSummary', async (req, res) => {
  const custCode = safeText(req.query.cust_code);
  const resp = { success: false };

  if (!custCode || !custCode.trim()) {
    return res.status(400).json({ error: 'cust_code is required' });
  }

  try {
    const sql = `
      SELECT
        COALESCE(SUM(qty * price), 0) AS total_price,
        COALESCE(SUM(qty), 0)         AS total_qty,
        COUNT(*)                      AS total_items
      FROM staff_cart_order
      WHERE cust_code = $1
    `;
    const result = await query(sql, [custCode]);
    const row = result.rows[0];

    resp.success = true;
    // pg map SUM() เป็นสตริง ส่งดิบออกไปทำให้ endpoint นี้คืนชนิดไม่ตรงกับ getcartfinalsummary
    resp.total_price = row ? toNumber(row.total_price, 0) : 0;
    resp.total_qty = row ? toNumber(row.total_qty, 0) : 0;
    resp.total_items = row ? toInt(row.total_items, 0) : 0;
    return res.json(resp);
  } catch (ex) {
    return res.status(500).json({ error: ex.message });
  }
});

// POST /service/v1/getcartitemstock
// Body: { items: [{ item_code, unit_code }], wh_code? }
router.post('/getcartitemstock', async (req, res) => {
  const resp = { success: false };
  try {
    let bodyStr = req.body;
    if (typeof bodyStr !== 'object') bodyStr = JSON.parse(bodyStr);
    const { items, wh_code: rawWhCode = DEFAULT_WH_CODE } = bodyStr;
    const whCode = rawWhCode || DEFAULT_WH_CODE;

    if (!items || items.length === 0) {
      resp.success = true;
      resp.data = [];
      return res.json(resp);
    }

    // ⚠️ รหัสถูกส่งต่อเข้าฟังก์ชันสต็อกของ ERP ที่เอาไปต่อ SQL แล้ว EXECUTE เอง
  //    $1 กันไม่ได้ ต้องกรองก่อน ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ wh_code: whCode });
    if (codeError) return res.status(400).json({ ERROR: codeError });

    const stockDisplayPercent = await getStockDisplayPercent();

    // เลียนแบบ Java: ส่ง items เป็น jsonb string เดียว
    const sql = `
      WITH input_items AS (
        SELECT
          i->>'item_code' AS item_code,
          i->>'unit_code' AS unit_code
        FROM jsonb_array_elements($1::jsonb) AS i
      ), stock AS (
        SELECT ic_code, SUM(balance_qty) sum_qty
        FROM sml_ic_function_stock_balance_warehouse_location(
          'NOW()',
          -- ${ERP_CODE_SQL_PATTERN} เป็นค่าคงที่ในโค้ด ไม่ใช่ข้อมูลจาก client
          (SELECT string_agg(DISTINCT item_code, ',') FROM input_items
            WHERE item_code ~ '${ERP_CODE_SQL_PATTERN}'),
          $2, ''
        )
        WHERE balance_qty > 0
        GROUP BY ic_code
      )
      SELECT
        i.item_code,
        i.unit_code,
        -- ใช้ COALESCE(NULLIF(ratio,0), 1) เหมือน getcartorder/validatecartstock
        -- เดิมหารด้วย NULL แล้วได้ NULL -> 0 สินค้าที่ไม่มีคู่ใน ic_unit_use จึงตอบ 0
        -- ขณะที่อีก 2 ทางตอบเต็ม = หน้าตะกร้าได้เลขขัดกันเอง
        TRUNC((COALESCE(s.sum_qty,0) * $3 / 100) / COALESCE(NULLIF(u.ratio,0), 1)) AS balance_qty
      FROM input_items i
      LEFT JOIN stock s ON s.ic_code = i.item_code
      LEFT JOIN ic_unit_use u ON u.ic_code = i.item_code AND u.code = i.unit_code
    `;

    const result = await query(sql, [JSON.stringify(items), whCode, stockDisplayPercent]);
    const data = result.rows.map(r => ({
      item_code: r.item_code,
      unit_code: r.unit_code,
      balance_qty: r.balance_qty !== null ? toInt(r.balance_qty, 0) : 0,
    }));

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json(ex.message);
  }
});

// GET /service/v1/getcartorder
// เลียนแบบ Java: SELECT staff_cart_order LEFT JOIN ic_inventory ดึง tax_type
// price_confirm: item_type!='3' → '0', item_type='3' → price
router.get('/getcartorder', async (req, res) => {
  const custCode = safeText(req.query.cust_code);
  const page = safePage(req.query.page);
  const pageSize = safePageSize(req.query.page_size);
  const whCode = req.query.wh_code || DEFAULT_WH_CODE;

  const resp = { success: false };

  if (!custCode || !custCode.trim()) {
    return res.status(400).json({ error: 'cust_code is required' });
  }

  // ⚠️ รหัสถูกส่งต่อเข้าฟังก์ชันสต็อกของ ERP ที่เอาไปต่อ SQL แล้ว EXECUTE เอง
  //    $1 กันไม่ได้ ต้องกรองก่อน ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ wh_code: whCode });
  if (codeError) return res.status(400).json({ error: codeError });

  const offset = (page - 1) * pageSize;

  try {
    // COUNT
    const [countResult, stockDisplayPercent, preorderDefaultEnabled] = await Promise.all([
      query('SELECT COUNT(*) AS total_count FROM staff_cart_order WHERE cust_code = $1', [custCode]),
      getStockDisplayPercent(),
      getPreorderDefaultEnabled(),
    ]);
    const totalCount = toInt(countResult.rows[0].total_count, 0);

    // DATA
    const sql = `
      WITH cart_page AS (
        SELECT
          w.*,
          COALESCE(NULLIF(w.wh_code,''), $2) AS cart_wh_code,
          COALESCE(NULLIF(w.item_type::text, ''), COALESCE(i.item_type,0)::text, '0')::integer AS resolved_item_type,
          COALESCE(i.name_eng_1, '') AS name_eng_1,
          COALESCE(i.tax_type, 0) AS tax_type,
          COALESCE(d.dimension_35,'') AS preorder_mode,
          COALESCE(d.dimension_38,'') AS max_allowance_csv,
          CASE WHEN (
            COALESCE((SELECT ic_code FROM ic_inventory_price
              WHERE ic_code = w.item_code
                AND unit_code = w.unit_code
                AND CURRENT_DATE BETWEEN from_date AND to_date
                AND ((cust_code = '' OR cust_code = $1)
                AND (cust_group_1 = '' OR cust_group_1 = (SELECT group_main FROM ar_customer_detail WHERE ar_code = $1)))
              LIMIT 1),'') != ''
            OR EXISTS (SELECT 1 FROM ic_inventory_discount
              WHERE ic_code = w.item_code
                AND unit_code = w.unit_code
                AND CURRENT_DATE BETWEEN from_date AND to_date
                AND (
                  discount_type = 0
                  OR (discount_type = 2 AND cust_code = $1)
                  OR (discount_type = 1 AND cust_group_1 = (SELECT group_main FROM ar_customer_detail WHERE ar_code = $1))
                ))
          ) THEN '1' ELSE '0' END AS is_promotion
        FROM staff_cart_order w
        LEFT JOIN ic_inventory i ON i.code = w.item_code
        LEFT JOIN ic_inventory_detail d ON d.ic_code = w.item_code
        WHERE w.cust_code = $1
        ORDER BY w.item_code
        LIMIT $4 OFFSET $5
      ),
      normal_codes AS (
        -- กรองรหัสก่อน string_agg เพราะค่านี้ถูกส่งเข้าฟังก์ชันที่เอาไปต่อ SQL เอง
        -- แถวที่มีรหัสแปลกจะได้สต็อก 0 แทนที่จะทำให้ทั้งตะกร้าพัง
        SELECT cart_wh_code AS wh_code, string_agg(DISTINCT item_code, ',') AS codes
        FROM cart_page
        WHERE resolved_item_type <> 3
          AND item_code ~ '${ERP_CODE_SQL_PATTERN}'
          AND cart_wh_code ~ '${ERP_CODE_SQL_PATTERN_OPTIONAL}'
        GROUP BY cart_wh_code
      ),
      normal_stock AS (
        SELECT nc.wh_code, s.ic_code, SUM(s.balance_qty) AS balance_qty
        FROM (SELECT wh_code, codes FROM normal_codes WHERE codes IS NOT NULL AND codes <> '') nc
        CROSS JOIN LATERAL sml_ic_function_stock_balance_warehouse_location(current_date, nc.codes, nc.wh_code, '') s
        WHERE s.balance_qty > 0
        GROUP BY nc.wh_code, s.ic_code
      ),
      set_detail AS (
        SELECT cp.cart_wh_code AS wh_code, d.ic_set_code, d.ic_code, d.qty
        FROM cart_page cp
        JOIN ic_inventory_set_detail d ON d.ic_set_code = cp.item_code
        WHERE cp.resolved_item_type = 3
      ),
      set_component_stock AS (
        SELECT
          d.wh_code,
          d.ic_set_code,
          d.ic_code,
          d.qty,
          SUM(COALESCE(f.balance_qty, 0)) AS sum_balance_qty
        FROM set_detail d
        LEFT JOIN LATERAL (
          SELECT balance_qty
          FROM sml_ic_function_stock_balance_warehouse_location(current_date, d.ic_code, d.wh_code, '')
          WHERE balance_qty > 0
        ) f ON TRUE
        GROUP BY d.wh_code, d.ic_set_code, d.ic_code, d.qty
      ),
      set_stock AS (
        SELECT
          wh_code,
          ic_set_code,
          MIN(TRUNC((sum_balance_qty * $3 / 100) / NULLIF(qty, 0))) AS balance_qty
        FROM set_component_stock
        GROUP BY wh_code, ic_set_code
      )
      SELECT
        cp.*,
        CASE
          WHEN cp.resolved_item_type = 3 THEN COALESCE(ss.balance_qty, 0)
          ELSE COALESCE(TRUNC((COALESCE(ns.balance_qty, 0) * $3 / 100) / COALESCE(NULLIF(u.ratio, 0), 1)), 0)
        END AS balance_qty
      FROM cart_page cp
      LEFT JOIN normal_stock ns ON ns.ic_code = cp.item_code AND ns.wh_code = cp.cart_wh_code
      LEFT JOIN set_stock ss ON ss.ic_set_code = cp.item_code AND ss.wh_code = cp.cart_wh_code
      LEFT JOIN ic_unit_use u ON u.ic_code = cp.item_code AND u.code = cp.unit_code
      ORDER BY cp.item_code
    `;
    const result = await query(sql, [custCode, whCode, stockDisplayPercent, pageSize, offset]);

    const data = await Promise.all(result.rows.map(async (r) => {
      // price_confirm: ชุดสินค้า (3) และโปรโมชันของแถม (4) ใช้ราคาที่เก็บในตะกร้า; สินค้าปกติ = '0' (คิดทีหลัง)
      const itemType = r.resolved_item_type ?? r.item_type;
      const isPack = String(itemType) === '3' || String(itemType) === '4';
      const priceConfirm = isPack ? r.price : '0';
      const isSalePremium = String(itemType) === '4';
      let salePremiumDetail = null;
      if (isSalePremium) {
        const premiumCode = safeText(r.sale_premium_code || r.item_code);
        try {
          salePremiumDetail = await loadSalePremiumDetail(query, premiumCode, {
            custCode,
            stockPercent: stockDisplayPercent,
            preorderDefaultEnabled,
          });
        } catch (_) {
          // validatecartstock จะคืนเหตุผลที่ละเอียดกว่า (หมดอายุ/ปิดใช้งาน)
          // หน้าตะกร้าถือว่าไม่พร้อมไว้ก่อนเพื่อไม่ส่งรายการที่ไม่แน่นอนไปเป็น ready
          salePremiumDetail = null;
        }
      }
      return {
        tax_type: r.tax_type,
        cust_code: r.cust_code,
        guid_code: r.guid_code,
        item_code: r.item_code,
        item_name: r.item_name,
        name_eng_1: r.name_eng_1 || '',
        unit_code: r.unit_code,
        item_type: itemType,
        is_promotion: isSalePremium ? '1' : r.is_promotion,
        barcode: r.barcode,
        qty: r.qty,
        price: r.price,
        wh_code: r.cart_wh_code || r.wh_code,
        shelf_code: r.shelf_code,
        creator_code: r.creator_code,
        create_datetime: r.create_datetime,
        stand_value: r.stand_value,
        divide_value: r.divide_value,
        ratio: r.ratio,
        remark: r.remark || '',
        balance_qty: isSalePremium
          ? toInt(salePremiumDetail?.balance_qty ?? salePremiumDetail?.stock_qty, 0)
          : (r.balance_qty !== null ? toInt(r.balance_qty, 0) : 0),
        sold_out: isSalePremium ? (salePremiumDetail?.sold_out || '1') : (toInt(r.balance_qty, 0) > 0 ? '0' : '1'),
        preorder_mode: r.preorder_mode || 'default',
        // จำนวนสั่งสูงสุดต่อคำสั่งซื้อของหน่วยนี้ (REQ3) — null = ไม่จำกัด
        // แปลงให้ตรงหน่วยตั้งแต่ฝั่ง server เพื่อให้ตะกร้าใช้ได้ทันทีโดยไม่ต้อง parse CSV เอง
        max_order_qty: getMaxAllowanceForUnit(r.max_allowance_csv, r.unit_code),
        // โปรโมชันแยกชิ้นส่วนไม่ได้ แต่ย้ายทั้งชุดไปใบ Preorder ได้เมื่อทุกชิ้นส่วนอนุญาต
        preorder_allowed: isSalePremium
          ? Boolean(salePremiumDetail?.preorder_allowed)
          : Boolean(resolvePreorderAllowed(r.preorder_mode, preorderDefaultEnabled)),
        price_confirm: priceConfirm,
        is_sale_premium: isSalePremium ? 1 : 0,
        sale_premium_code: r.sale_premium_code || '',
        sale_premium_name: r.sale_premium_name || '',
        sale_premium_data: r.sale_premium_data || '',
      };
    }));

    resp.success = true;
    resp.page = page;
    resp.page_size = pageSize;
    resp.total_count = totalCount;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(500).json({ error: ex.message });
  }
});

// POST /service/v1/getcartorderprice
// Body: { cust_code, items: [{ item_code, unit_code, qty, item_type, price }] }
router.post('/getcartorderprice', async (req, res) => {
  const resp = { success: false };
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    const { cust_code, items } = body;
    const { getProductPriceLocalx } = require('../utils/priceHelper');
    const basketCtx = await resolveBasketPricingContext(cust_code);

    const bodySaleType = toInt(body.sale_type, NaN);
    const bodyVatType = toInt(body.vat_type, NaN);
    const bodyVatRate = toNumber(body.vat_rate, NaN);
    const docDate = body.doc_date ? String(body.doc_date).trim() : undefined;

    const result = [];
    for (const it of items) {
      const itemCode = it.item_code;
      const unitCode = it.unit_code;
      const qty = it.qty !== undefined ? it.qty.toString() : '1';
      const itemType = it.item_type !== undefined ? it.item_type.toString() : '0';
      const barcode = it.barcode !== undefined ? String(it.barcode) : '';

      const o = { item_code: itemCode, unit_code: unitCode, barcode };
      try {
        let priceConfirm = 0;
        // ชุดสินค้า (3) และโปรโมชันของแถม (4) ใช้ราคาที่ส่งมาจากตะกร้า ไม่ re-price รายชิ้น
        if (itemType !== '3' && itemType !== '4') {
          let vatType = toInt(it.vat_type, NaN);
          if (Number.isNaN(vatType)) vatType = Number.isNaN(bodyVatType) ? basketCtx.vatType : bodyVatType;
          if (Number.isNaN(vatType)) vatType = toInt(it.tax_type, NaN);
          if (Number.isNaN(vatType)) vatType = 0;

          let saleType = toInt(it.sale_type, NaN);
          if (Number.isNaN(saleType)) saleType = Number.isNaN(bodySaleType) ? basketCtx.saleType : bodySaleType;
          if (Number.isNaN(saleType)) saleType = 0;

          let vatRate = toNumber(it.vat_rate, NaN);
          if (Number.isNaN(vatRate)) vatRate = Number.isNaN(bodyVatRate) ? basketCtx.vatRate : bodyVatRate;
          if (Number.isNaN(vatRate)) vatRate = null;

          const priceRes = await getProductPriceLocalx(itemCode, unitCode, qty, cust_code, vatType, vatRate, saleType, barcode, docDate);
          const arr = priceRes.data || [];
          if (arr.length > 0) {
            priceConfirm = safeBigDecimal(arr[0].price);
            o.price = priceConfirm;
            o.price1 = safeBigDecimal(arr[0].price1);
            o.price2 = safeBigDecimal(arr[0].price2);
            o.defaultDiscount = arr[0].defaultDiscount || '';
            o.discount = o.defaultDiscount;
          }
        } else {
          priceConfirm = safeBigDecimal(it.price !== undefined ? it.price.toString() : '0');
        }
        o.price_confirm = priceConfirm;
        o.success = true;
      } catch (ex) {
        o.success = false;
        o.error_type = ex.constructor.name;
        o.message = ex.message;
        o.detail = ex.toString();
        o.qty = qty;
        o.item_type = itemType;
      }
      result.push(o);
    }

    resp.success = true;
    resp.data = result;
    return res.json(resp);
  } catch (e) {
    return res.status(400).json({
      success: false,
      error_type: e.constructor.name,
      message: e.message,
      detail: e.toString(),
    });
  }
});

// GET /service/v1/getcartfinalsummary
// เลียนแบบ Java: loop ทุก item คำนวณ price_confirm แล้ว sum
router.get('/getcartfinalsummary', async (req, res) => {
  const custCode = safeText(req.query.cust_code);
  // endpoint ตะกร้าตัวอื่นบังคับ cust_code หมด เหลือตัวนี้ที่ยิงเปล่าๆ แล้วได้ 200
  if (!custCode) {
    return res.status(400).json({ error: 'cust_code is required' });
  }
  const saleTypeReq = toInt(req.query.sale_type, NaN);
  const vatTypeReq = toInt(req.query.vat_type, NaN);
  const vatRateReq = toNumber(req.query.vat_rate, NaN);
  const resp = { success: false };

  try {
    const sql = `
            SELECT c.cust_code, c.item_code, c.item_name, c.unit_code, c.item_type, c.qty, c.price, c.barcode,
             COALESCE(i.tax_type,0) AS tax_type
      FROM staff_cart_order c
      LEFT JOIN ic_inventory i ON i.code = c.item_code
      WHERE c.cust_code = $1
    `;
    const result = await query(sql, [custCode]);
    const { getProductPriceLocalx } = require('../utils/priceHelper');
    const basketCtx = await resolveBasketPricingContext(custCode);
    const docDate = req.query.doc_date ? String(req.query.doc_date).trim() : undefined;

    let totalItems = 0;
    let totalQty = 0;
    let totalPrice = 0;

    for (const r of result.rows) {
      totalItems++;
      const qty = toNumber(r.qty, 0);
      totalQty += qty;

      let priceConfirm = 0;
      if (String(r.item_type) !== '3') {
        try {
          const saleType = Number.isNaN(saleTypeReq) ? (Number.isNaN(basketCtx.saleType) ? 0 : basketCtx.saleType) : saleTypeReq;
          const vatType = Number.isNaN(vatTypeReq)
            ? (Number.isNaN(basketCtx.vatType) ? toInt(r.tax_type, 0) : basketCtx.vatType)
            : vatTypeReq;
          const vatRate = Number.isNaN(vatRateReq)
            ? (Number.isNaN(basketCtx.vatRate) ? null : basketCtx.vatRate)
            : vatRateReq;

          const priceRes = await getProductPriceLocalx(r.item_code, r.unit_code, r.qty.toString(), custCode, vatType, vatRate, saleType, r.barcode, docDate);
          const arr = priceRes.data || [];
          if (arr.length > 0) {
            priceConfirm = safeBigDecimal(arr[0].price);
            const line = calcDiscountAmount(priceConfirm, qty, arr[0].defaultDiscount || '');
            totalPrice += line.sum_amount;
            continue;
          }
        } catch (_) {}
      } else {
        priceConfirm = toNumber(r.price, 0);
      }

      totalPrice += priceConfirm * qty;
    }

    resp.success = true;
    resp.data = {
      total_items: totalItems,
      total_qty: totalQty,
      total_price: totalPrice,
    };
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ error: ex.message });
  }
});

// GET /service/v1/validatecartstock
// เลียนแบบ Java: CTE query ตรวจ stock ของทุก item ใน cart
router.get('/validatecartstock', async (req, res) => {
  const { cust_code: custCode, wh_code: rawWhCode = DEFAULT_WH_CODE } = req.query;
  const whCode = rawWhCode || DEFAULT_WH_CODE;
  const resp = { success: false };

  if (!custCode || !custCode.trim()) {
    return res.status(400).json({ error: 'cust_code is required' });
  }

  // ⚠️ รหัสถูกส่งต่อเข้าฟังก์ชันสต็อกของ ERP ที่เอาไปต่อ SQL แล้ว EXECUTE เอง
  //    $1 กันไม่ได้ ต้องกรองก่อน ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ wh_code: whCode });
  if (codeError) return res.status(400).json({ error: codeError });

  const sql = `
    WITH cart AS (
      SELECT
        c.item_code,
        MAX(c.item_name) AS item_name,
        c.unit_code,
        COALESCE(NULLIF(c.wh_code,''), $2) AS wh_code,
        COALESCE(i.item_type, 0) AS item_type,
        -- สินค้าถูกถอดออกจากหน้าร้าหลังลูกค้าใส่ตะกร้าไปแล้ว — ต้องบอกที่ตะกร้า ไม่ใช่ตอนกดสั่ง
        MAX(CASE WHEN COALESCE(i.item_pattern,'') = '[W]' THEN 1 ELSE 0 END) AS on_marketplace,
        MAX(c.item_type::text) AS store_item_type,
        MAX(COALESCE(c.sale_premium_code,'')) AS sale_premium_code,
        MAX(COALESCE(c.sale_premium_name,'')) AS sale_premium_name,
        MAX(COALESCE(c.guid_code,'')) AS guid_code,
        COALESCE(d.dimension_35,'') AS preorder_mode,
        COALESCE(d.dimension_38,'') AS max_allowance_csv,
        SUM(c.qty) AS qty_in_cart
      FROM staff_cart_order c
      LEFT JOIN ic_inventory i ON i.code = c.item_code
      LEFT JOIN ic_inventory_detail d ON d.ic_code = c.item_code
      WHERE c.cust_code = $1
      -- 🚨 เดิมมี c.item_name อยู่ใน GROUP BY ด้วย ซึ่งเป็นข้อความอิสระที่ client ส่งมา
      --    แยกบรรทัดแล้วตั้งชื่อคนละอย่าง SUM(qty) จึงไม่รวม = เลี่ยงโควตา Maximum Allowance ได้
      --    ฝั่ง sendorder รวมด้วย item_code|unit_code ถูกอยู่แล้ว ทำให้ตรงกัน
      --    item_name เอามาด้วย MAX() แทน เพื่อให้หน้าจอยังมีชื่อแสดงเหมือนเดิม
      GROUP BY c.item_code, c.unit_code, COALESCE(NULLIF(c.wh_code,''), $2), COALESCE(i.item_type, 0), COALESCE(d.dimension_35,''), COALESCE(d.dimension_38,'')
    ),
    normal_codes AS (
      -- กรองรหัสก่อน string_agg เพราะค่านี้ถูกส่งเข้าฟังก์ชันที่เอาไปต่อ SQL เอง
        -- แถวที่มีรหัสแปลกจะได้สต็อก 0 แทนที่จะทำให้ทั้งตะกร้าพัง
      SELECT wh_code, string_agg(item_code, ',') AS codes
      FROM cart
      WHERE item_type <> 3
        AND item_code ~ '${ERP_CODE_SQL_PATTERN}'
        AND wh_code ~ '${ERP_CODE_SQL_PATTERN_OPTIONAL}'
      GROUP BY wh_code
    ),
    normal_stock AS (
      SELECT nc.wh_code, s.ic_code, SUM(s.balance_qty) AS balance_qty
      FROM (SELECT wh_code, codes FROM normal_codes WHERE codes IS NOT NULL AND codes <> '') nc
      CROSS JOIN LATERAL sml_ic_function_stock_balance_warehouse_location(
        current_date, nc.codes, nc.wh_code, ''
      ) s
      WHERE s.balance_qty > 0
      GROUP BY nc.wh_code, s.ic_code
    ),
    set_detail AS (
      SELECT c.wh_code, d.ic_set_code, d.ic_code, d.qty
      FROM cart c
      JOIN ic_inventory_set_detail d ON d.ic_set_code = c.item_code
      WHERE c.item_type = 3
    ),
    set_component_stock AS (
      SELECT
        d.wh_code,
        d.ic_set_code,
        d.ic_code,
        d.qty,
        SUM(COALESCE(f.balance_qty, 0)) AS sum_balance_qty
      FROM set_detail d
      LEFT JOIN LATERAL (
        SELECT balance_qty
        FROM sml_ic_function_stock_balance_warehouse_location(
          current_date, d.ic_code, d.wh_code, ''
        )
        WHERE balance_qty > 0
      ) f ON TRUE
      GROUP BY d.wh_code, d.ic_set_code, d.ic_code, d.qty
    ),
    set_stock AS (
      SELECT
        wh_code,
        ic_set_code,
        MIN(TRUNC((sum_balance_qty * $3 / 100) / NULLIF(qty, 0))) AS balance_qty
      FROM set_component_stock
      GROUP BY wh_code, ic_set_code
    )
    SELECT
      c.item_code,
      c.item_name,
      c.unit_code,
      c.wh_code,
      c.qty_in_cart,
      c.item_type,
      c.on_marketplace,
      c.store_item_type,
      c.sale_premium_code,
      c.sale_premium_name,
      c.guid_code,
      c.preorder_mode,
      c.max_allowance_csv,
      CASE
        WHEN c.item_type = 3 THEN COALESCE(ss.balance_qty, 0)
        ELSE COALESCE(TRUNC((COALESCE(ns.balance_qty, 0) * $3 / 100) / COALESCE(NULLIF(u.ratio, 0), 1)), 0)
      END AS balance_qty
    FROM cart c
    LEFT JOIN normal_stock ns ON ns.ic_code = c.item_code AND ns.wh_code = c.wh_code
    LEFT JOIN set_stock ss ON ss.ic_set_code = c.item_code AND ss.wh_code = c.wh_code
    LEFT JOIN ic_unit_use u
           ON u.ic_code = c.item_code
          AND u.code = c.unit_code
  `;

  try {
    const [stockDisplayPercent, preorderDefaultEnabled, salePremiumEnabled] = await Promise.all([
      getStockDisplayPercent(),
      getPreorderDefaultEnabled(),
      getSalePremiumEnabled(),
    ]);
    const result = await query(sql, [custCode, whCode, stockDisplayPercent]);
    const stockIssues = [];
    let isValid = true;

    for (const r of result.rows) {
      // โปรโมชันของแถม (item_type=4) — ตรวจว่ายังไม่หมดอายุ ก่อนปล่อยไปหน้ายืนยัน (REQ5)
      // เดิมข้ามทั้งหมด ทำให้ลูกค้าเจอ error ตอนกดสั่งซื้อแล้วลบรายการไม่ได้
      // ของแถมไม่ต้องเป็น [W] — ตรวจเฉพาะสินค้าที่ลูกค้าเลือกเอง
      if (String(r.store_item_type) !== '4' && Number(r.on_marketplace) !== 1) {
        stockIssues.push({
          item_code: r.item_code,
          item_name: r.item_name,
          unit_code: r.unit_code,
          wh_code: r.wh_code,
          qty_in_cart: toInt(r.qty_in_cart, 0),
          balance_qty: 0,
          shortage_qty: 0,
          issue_type: 'not_on_marketplace',
          preorder_allowed: false,
          guid_code: r.guid_code || '',
          reason: 'item is not published on marketplace',
        });
        isValid = false;
        continue;
      }

      if (String(r.store_item_type) === '4') {
        const premiumCode = String(r.sale_premium_code || r.item_code || '').trim();
        if (!premiumCode) continue;

        // ปิด feature flag = ต้องหยุดตั้งแต่ตะกร้า ไม่ใช่ปล่อยให้สั่งซื้อสำเร็จแล้วเขียน is_permium ลง ERP
        if (!salePremiumEnabled) {
          stockIssues.push({
            item_code: r.item_code,
            item_name: r.sale_premium_name || r.item_name,
            unit_code: r.unit_code,
            wh_code: r.wh_code,
            qty_in_cart: toInt(r.qty_in_cart, 0),
            balance_qty: 0,
            shortage_qty: 0,
            issue_type: 'premium_unavailable',
            preorder_allowed: false,
            sale_premium_code: premiumCode,
            guid_code: r.guid_code || '',
            reason: 'sale premium disabled',
          });
          isValid = false;
          continue;
        }

        try {
          // ใช้วันที่ของ server (REQ6) — loadSalePremiumDetail จะ throw ถ้าโปรโมชันหมดอายุ/ถูกปิด
          const detail = await loadSalePremiumDetail(query, premiumCode, { custCode });
          const qtyInCart = toInt(r.qty_in_cart, 0);
          const balanceQty = toInt(detail.balance_qty ?? detail.stock_qty, 0);
          if (qtyInCart > balanceQty && !detail.preorder_allowed) {
            stockIssues.push({
              item_code: r.item_code,
              item_name: r.sale_premium_name || r.item_name,
              unit_code: 'ชุด',
              wh_code: detail.wh_code || r.wh_code,
              qty_in_cart: qtyInCart,
              balance_qty: balanceQty,
              shortage_qty: Math.max(0, qtyInCart - balanceQty),
              issue_type: 'premium_out_of_stock',
              preorder_allowed: false,
              sale_premium_code: premiumCode,
              guid_code: r.guid_code || '',
              reason: 'sale premium components are out of stock',
            });
            isValid = false;
          }
        } catch (premiumError) {
          stockIssues.push({
            item_code: r.item_code,
            item_name: r.sale_premium_name || r.item_name,
            unit_code: r.unit_code,
            wh_code: r.wh_code,
            qty_in_cart: toInt(r.qty_in_cart, 0),
            balance_qty: 0,
            shortage_qty: 0,
            issue_type: 'premium_expired',
            preorder_allowed: false,
            sale_premium_code: premiumCode,
            guid_code: r.guid_code || '',
            reason: premiumError.message,
          });
          isValid = false;
        }
        continue;
      }

      const qtyInCart = toInt(r.qty_in_cart, 0);
      const balanceQty = toInt(r.balance_qty, 0);
      const preorderAllowed = resolvePreorderAllowed(r.preorder_mode, preorderDefaultEnabled);

      // เกินจำนวนสั่งสูงสุดต่อคำสั่งซื้อ (REQ3) — ตรวจที่ตะกร้าด้วย ไม่ใช่รอให้ /sendorder ปฏิเสธ
      // ลูกค้าที่เพิ่มของเกินลิมิตทางอื่น (แก้จำนวนในตะกร้า, ยิง API ตรง) จะเห็นตั้งแต่ตรงนี้
      const maxOrderQty = getMaxAllowanceForUnit(r.max_allowance_csv, r.unit_code);
      if (maxOrderQty !== null && qtyInCart > maxOrderQty) {
        stockIssues.push({
          item_code: r.item_code,
          item_name: r.item_name,
          unit_code: r.unit_code,
          wh_code: r.wh_code,
          qty_in_cart: qtyInCart,
          balance_qty: balanceQty,
          shortage_qty: 0,
          issue_type: 'max_allowance_exceeded',
          preorder_allowed: preorderAllowed,
          max_order_qty: maxOrderQty,
          guid_code: r.guid_code || '',
        });
        isValid = false;
        continue;
      }

      if ((balanceQty <= 0 || qtyInCart > balanceQty) && !preorderAllowed) {
        stockIssues.push({
          item_code: r.item_code,
          item_name: r.item_name,
          unit_code: r.unit_code,
          wh_code: r.wh_code,
          qty_in_cart: qtyInCart,
          balance_qty: balanceQty,
          shortage_qty: Math.max(0, qtyInCart - balanceQty),
          issue_type: balanceQty <= 0 ? 'out_of_stock' : 'exceeding',
          preorder_allowed: preorderAllowed,
        });
        isValid = false;
      }
    }

    resp.success = true;
    resp.is_valid = isValid;
    resp.stock_issues = stockIssues;
    return res.json(resp);
  } catch (ex) {
    return res.status(500).json({ error: ex.message });
  }
});

// GET /service/v1/deleteItem
// เลียนแบบ Java: DELETE WHERE guid_code=? AND cust_code=?
router.get('/deleteItem', async (req, res) => {
  const { guid_code, cust_code, item_code, unit_code } = req.query;
  const resp = { success: false };
  try {
    // 🚨 guid_code เพียงอย่างเดียวไม่พอ: ข้อมูลที่ client รุ่นเก่าเขียนไว้ใช้รหัสสินค้า
    //    เป็น guid_code ทำให้ทุกหน่วยของสินค้าตัวเดียวกันซ้ำกันหมด ลบทีเดียวหายทั้งกลุ่ม
    //    ถ้า client ส่ง item_code/unit_code มาด้วยให้จำกัดขอบเขตเหลือบรรทัดเดียว
    const params = [guid_code || '', cust_code || ''];
    let sql = `DELETE FROM staff_cart_order WHERE guid_code = $1 AND cust_code = $2`;
    if (item_code) {
      params.push(item_code);
      sql += ` AND item_code = $${params.length}`;
    }
    if (unit_code) {
      params.push(unit_code);
      sql += ` AND unit_code = $${params.length}`;
    }
    await query(sql, params);
    resp.success = true;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/deleteAllItems
// เลียนแบบ Java: DELETE WHERE cust_code=?
router.get('/deleteAllItems', async (req, res) => {
  const { cust_code } = req.query;
  const resp = { success: false };
  try {
    await query(
      `DELETE FROM staff_cart_order WHERE cust_code = $1`,
      [cust_code || '']
    );
    resp.success = true;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// helper
function safeBigDecimal(s) {
  if (s === null || s === undefined) return 0;
  const str = String(s).trim();
  if (!str || str.toLowerCase() === 'null') return 0;
  return toNumber(str, 0);
}

function roundMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function calcAfterDiscount(discountWord, amount, qty = 1) {
  if (!discountWord || !String(discountWord).trim()) return roundMoney(amount);

  let result = toNumber(amount, 0);
  const lineQty = toNumber(qty, 1);
  const tokens = String(discountWord).replace(/\s/g, '').split(/[,+]/);
  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith('@')) {
      result -= roundMoney(toNumber(token.slice(1), 0) * lineQty);
    } else if (token.includes('%')) {
      result -= roundMoney((toNumber(token.replace(/%/g, ''), 0) / 100) * result);
    } else if (token.toUpperCase().endsWith('B')) {
      result -= toNumber(token.slice(0, -1), 0);
    } else {
      result -= toNumber(token, 0);
    }
    if (result < 0) result = 0;
  }
  return roundMoney(result);
}

function calcDiscountAmount(unitPrice, qty, discountWord) {
  const gross = roundMoney(toNumber(unitPrice, 0) * toNumber(qty, 0));
  if (!discountWord || !String(discountWord).trim()) {
    return { gross, discount_amount: 0, sum_amount: gross };
  }
  const sum_amount = calcAfterDiscount(discountWord, gross, qty);
  return {
    gross,
    discount_amount: roundMoney(gross - sum_amount),
    sum_amount,
  };
}

module.exports = router;
module.exports.mapCartItemListRow = mapCartItemListRow;
module.exports.isSalePremiumCartItem = isSalePremiumCartItem;
module.exports.getMarketplaceInventoryCodes = getMarketplaceInventoryCodes;
