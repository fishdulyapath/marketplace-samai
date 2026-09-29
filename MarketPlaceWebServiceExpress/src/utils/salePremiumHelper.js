// ระบบของแถมขาย (Sale Premium) — เฟส 3 ของ docs/sale-premium-plan.md
//
// ยกแนวคิดจาก โปรเจคตัวอย่าง/smlstaff-ubon แต่ปรับให้เข้ากับ marketplace:
//   - ไม่สร้าง schema ตอน runtime (migration create_sale_premium.sql จัดการแล้ว)
//   - เคารพ stock_display_percent เหมือน code path อื่นของ marketplace
//   - กรอง show_on_web สำหรับหน้าร้าน แต่ "ไม่" กรอง item_pattern ของสินค้าของแถม
//     (ของแถมอาจเป็นสินค้าที่ไม่ได้ขายออนไลน์ แต่ยังต้องแถมได้)
//   - รองรับชื่อหลายภาษา (name_1 / name_2 / name_eng_1)
//
// ของแถมถูกบันทึกลง ic_trans_detail.is_permium ซึ่ง ERP มีและใช้อยู่แล้ว
// คอลัมน์สะกดว่า is_permium (สะกดผิดแต่ต้นใน schema ของ ERP) — ห้ามแก้

const { query } = require('../db');
const { getProductPriceLocalx } = require('./priceHelper');
const { getPreorderDefaultEnabled, getStockDisplayPercent, resolvePreorderAllowed } = require('./marketplaceSalesSettings');
const { serverDocDate } = require('./serverTime');
const { likeContains } = require('./likePattern');
const { isSafeErpCode } = require('./erpCodeGuard');

function safeText(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeDate(value) {
  const text = safeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

// ดึงบริบทราคา (sale_type/vat) จาก pos_basket ล่าสุดของลูกค้า
// เหมือน resolveBasketPricingContext ใน product.js / cart.js — คงไว้ที่นี่เพราะรับ queryFn (client ใน txn)
async function resolveBasketPricingContext(queryFn, custCode) {
  const code = safeText(custCode);
  if (!code) return { saleType: 0, vatType: 0, vatRate: null };
  try {
    const rs = await queryFn(
      `SELECT COALESCE(inquiry_type,0) AS sale_type,
              COALESCE(vat_type,0) AS vat_type,
              COALESCE(vat_rate,0) AS vat_rate
         FROM pos_basket
        WHERE cust_code=$1
        ORDER BY basket_id DESC
        LIMIT 1`,
      [code],
    );
    const row = rs.rows[0];
    if (row) {
      return {
        saleType: parseInt(row.sale_type, 10) || 0,
        vatType: parseInt(row.vat_type, 10) || 0,
        vatRate: parseFloat(row.vat_rate),
      };
    }
  } catch (error) {
    console.error('salePremiumHelper: resolveBasketPricingContext failed —', error.message);
  }
  return { saleType: 0, vatType: 0, vatRate: null };
}

// ข้อมูลสินค้า+หน่วย พร้อมสต็อกที่ปรับด้วย stock_display_percent แล้ว
// ไม่กรอง item_pattern — ของแถมเป็นสินค้าอะไรก็ได้
async function getItemUnitInfo(queryFn, itemCode, unitCode, stockPercent) {
  // ⚠️ itemCode ถูกส่งเข้าฟังก์ชันสต็อกของ ERP ที่เอาไปต่อ SQL เอง $1 กันไม่ได้
  //    ดู src/utils/erpCodeGuard.js — ของแถมที่รหัสไม่สะอาดถือว่าไม่มีของ
  if (!isSafeErpCode(itemCode)) return null;
  const pct = Number.isFinite(stockPercent) ? stockPercent : 100;
  const result = await queryFn(
    `WITH balance_stock AS (
       SELECT ic_code, SUM(balance_qty) AS sum_balance_qty
         FROM sml_ic_function_stock_balance_warehouse_location(current_date, $1, '', '')
        WHERE balance_qty > 0
        GROUP BY ic_code
     )
     SELECT i.code AS item_code,
            COALESCE(i.name_1, i.code) AS item_name,
            COALESCE(i.name_2,'') AS name_2,
            COALESCE(i.name_eng_1,'') AS name_eng_1,
            COALESCE(i.item_type,0) AS item_type,
            COALESCE(i.tax_type,0) AS tax_type,
            COALESCE(d.start_sale_wh,'') AS wh_code,
            COALESCE(d.start_sale_shelf,'') AS shelf_code,
            COALESCE(d.dimension_35,'') AS preorder_mode,
            u.code AS unit_code,
            COALESCE(u.stand_value,1) AS stand_value,
            COALESCE(u.divide_value,1) AS divide_value,
            COALESCE(NULLIF(u.ratio,0),1) AS ratio,
            COALESCE((SELECT barcode FROM ic_inventory_barcode b WHERE b.ic_code=i.code AND b.unit_code=u.code LIMIT 1),'') AS barcode,
            COALESCE((SELECT sum_balance_qty FROM balance_stock WHERE ic_code=i.code LIMIT 1),0) AS sum_balance_qty
       FROM ic_inventory i
       JOIN ic_unit_use u ON u.ic_code=i.code
      LEFT JOIN ic_inventory_detail d ON d.ic_code=i.code
      WHERE i.code=$2 AND u.code=$3
      LIMIT 1`,
    [itemCode, itemCode, unitCode],
  );
  const row = result.rows[0];
  if (!row) return null;
  const ratio = Math.max(1, toNumber(row.ratio, 1));
  const scaledBalance = (toNumber(row.sum_balance_qty) * pct) / 100;
  return {
    item_code: row.item_code,
    item_name: row.item_name,
    name_2: row.name_2 || '',
    name_eng_1: row.name_eng_1 || '',
    item_type: String(row.item_type ?? '0'),
    tax_type: Number(row.tax_type ?? 0),
    unit_code: row.unit_code,
    wh_code: row.wh_code || '',
    shelf_code: row.shelf_code || '',
    preorder_mode: row.preorder_mode || 'default',
    stand_value: toNumber(row.stand_value, 1),
    divide_value: toNumber(row.divide_value, 1),
    ratio,
    barcode: row.barcode || '',
    sum_balance_qty: toNumber(row.sum_balance_qty),
    balance_qty: Math.floor(scaledBalance / ratio),
  };
}

async function pricedItem(row, custCode, qty, priceContext = {}) {
  const priceRes = await getProductPriceLocalx(
    row.item_code,
    row.unit_code,
    String(qty || 1),
    custCode,
    priceContext.vatType ?? 0,
    priceContext.vatRate ?? null,
    priceContext.saleType ?? 0,
    row.barcode || '',
    priceContext.docDate || undefined,
  );
  const priceRow = (priceRes.data || [])[0] || {};
  const price = roundMoney(priceRow.price ?? 0);
  const discount = safeText(priceRow.defaultDiscount ?? priceRow.default_discount ?? '');
  return { ...row, price, discount };
}

// โหลดรายละเอียดโปรโมชัน 1 รายการ พร้อมราคา/สต็อกของทั้งชุด
async function loadSalePremiumDetail(queryFn, premiumCode, options = {}) {
  const code = safeText(premiumCode);
  if (!code) throw new Error('premium_code is required');

  // ใช้เวลาไทยของ server — เดิมใช้ toISOString() ซึ่งเป็น UTC ทำให้ช่วง 00:00-06:59 น.
  // ได้วันก่อนหน้า โปรโมชันวันแรกยังไม่เปิด/วันสุดท้ายยังไม่ปิด (REQ6)
  const docDate = normalizeDate(options.docDate) || serverDocDate();
  const stockPercent = Number.isFinite(options.stockPercent) ? options.stockPercent : await getStockDisplayPercent();
  const preorderDefaultEnabled = options.preorderDefaultEnabled !== undefined
    ? Boolean(options.preorderDefaultEnabled)
    : await getPreorderDefaultEnabled();

  const headerRes = await queryFn(
    `SELECT premium_code, name_1,
            COALESCE(name_2,'') AS name_2,
            COALESCE(name_eng_1,'') AS name_eng_1,
            COALESCE(image_guid,'') AS image_guid,
            date_begin::text AS date_begin, date_end::text AS date_end,
            COALESCE(important,0) AS important, COALESCE(remark,'') AS remark
       FROM sml_sale_premium
      WHERE premium_code=$1
        AND COALESCE(important,0)=0
        -- 🚨 เดิมไม่มีบรรทัดนี้ โปรที่แอดมินกดปิด (show_on_web=0) จึงหายแค่จากรายการหน้าร้าน
        --    แต่ยังใส่ตะกร้าและสั่งซื้อได้ ทั้งที่คอมเมนต์ใน cart.js เขียนว่าด่านนี้กัน "ถูกปิด" ไว้แล้ว
        --    show_on_web=1 คือกลไกเทียบเท่า item_pattern='[W]' ของสินค้าปกติ ต้องกันทุกทาง
        --    ผู้เรียกทั้งหมดเป็นฝั่งหน้าร้าน (cart / detail-for-sale / list-for-sale / sendorder)
        --    ฝั่งแอดมินใช้คิวรีของตัวเองที่ salePremium.js จึงยังแก้โปรที่ปิดอยู่ได้
        AND COALESCE(show_on_web,1)=1
        AND (date_begin IS NULL OR date_begin <= $2::date)
        AND (date_end IS NULL OR date_end >= $2::date)
      LIMIT 1`,
    [code, docDate],
  );
  const header = headerRes.rows[0];
  if (!header) throw new Error(`premium not found or inactive: ${code}`);

  const [condRes, freeRes] = await Promise.all([
    queryFn(
      `SELECT premium_code, ic_code, unit_code, qty, stand_value, divide_value, roworder AS line_number
         FROM sml_sale_premium_condition
        WHERE premium_code=$1
        ORDER BY roworder, ic_code`,
      [code],
    ),
    queryFn(
      `SELECT premium_code, ic_code, unit_code, qty, stand_value, divide_value, roworder AS line_number
         FROM sml_sale_premium_free_list
        WHERE premium_code=$1
        ORDER BY roworder, ic_code`,
      [code],
    ),
  ]);
  if (!condRes.rows.length) throw new Error(`premium condition is empty: ${code}`);
  if (!freeRes.rows.length) throw new Error(`premium free list is empty: ${code}`);

  const pricingContext = {
    saleType: options.saleType,
    vatType: options.vatType,
    vatRate: options.vatRate,
    docDate,
  };
  const custCode = safeText(options.custCode);

  const paidItems = [];
  for (const row of condRes.rows) {
    const unit = await getItemUnitInfo(queryFn, safeText(row.ic_code), safeText(row.unit_code), stockPercent);
    if (!unit) throw new Error(`product unit not found: ${row.ic_code}/${row.unit_code}`);
    const qty = toNumber(row.qty);
    const priced = await pricedItem(unit, custCode, qty, pricingContext);
    paidItems.push({
      ...priced,
      qty,
      sum_amount: roundMoney(priced.price * qty),
      is_permium: 0,
      line_number: row.line_number,
    });
  }

  const freeItems = [];
  for (const row of freeRes.rows) {
    // ของแถมใช้ stockPercent=100 ในการอ่านสต็อกจริง (ไม่ลดตามการแสดงผล) เพราะเป็นของที่ต้องส่งจริง
    const unit = await getItemUnitInfo(queryFn, safeText(row.ic_code), safeText(row.unit_code), 100);
    if (!unit) throw new Error(`free product unit not found: ${row.ic_code}/${row.unit_code}`);
    freeItems.push({
      ...unit,
      qty: toNumber(row.qty),
      price: 0,
      discount: '',
      sum_amount: 0,
      is_permium: 1,
      line_number: row.line_number,
    });
  }

  const packPrice = roundMoney(paidItems.reduce((sum, item) => sum + toNumber(item.sum_amount), 0));
  // โปรโมชัน 1 ชุดส่งได้ก็ต่อเมื่อมีครบทั้งสินค้าที่ซื้อและของแถม
  // เดิมนับเฉพาะ paidItems ทำให้หน้าร้านแจ้ง "พร้อมสั่ง" ทั้งที่ของแถมหมด
  // แล้วไปล้มช้าเกินไปที่ sendorder หลังแตกชุดเป็นบรรทัดจริง
  const availablePackQty = [...paidItems, ...freeItems].reduce((min, item) => {
    const needed = Math.max(1, toNumber(item.qty, 1));
    return Math.min(min, Math.floor(toNumber(item.balance_qty) / needed));
  }, Number.POSITIVE_INFINITY);
  const preorderAllowed = [...paidItems, ...freeItems].every((item) =>
    resolvePreorderAllowed(item.preorder_mode, preorderDefaultEnabled));
  const firstPaid = paidItems[0];

  return {
    premium_code: header.premium_code,
    premium_name: header.name_1,
    name_1: header.name_1,
    name_2: header.name_2 || '',
    name_eng_1: header.name_eng_1 || '',
    image_guid: header.image_guid || '',
    remark: header.remark || '',
    item_code: header.premium_code,
    item_name: header.name_1,
    unit_code: firstPaid.unit_code,
    unit_name: firstPaid.unit_code,
    item_type: '4',
    tax_type: firstPaid.tax_type,
    price: packPrice,
    stock_qty: Number.isFinite(availablePackQty) ? availablePackQty : 0,
    balance_qty: Number.isFinite(availablePackQty) ? availablePackQty : 0,
    sum_balance_qty: firstPaid.sum_balance_qty,
    sold_out: Number.isFinite(availablePackQty) && availablePackQty > 0 ? '0' : '1',
    preorder_allowed: preorderAllowed ? 1 : 0,
    wh_code: firstPaid.wh_code || '',
    shelf_code: firstPaid.shelf_code || '',
    stand_value: 1,
    divide_value: 1,
    ratio: 1,
    barcode: '',
    is_sale_premium: 1,
    sale_premium_code: header.premium_code,
    sale_premium_name: header.name_1,
    paid_items: paidItems,
    free_items: freeItems,
  };
}

// รายการโปรโมชันสำหรับหน้าร้าน (กรอง show_on_web + ช่วงวันที่)
async function listSalePremiumProductsForSale(queryFn = query, options = {}) {
  const docDate = normalizeDate(options.docDate) || serverDocDate();
  const search = safeText(options.search);
  const includeOutOfStock = String(options.isStock || '') !== '1';
  const offset = Math.max(0, parseInt(options.offset, 10) || 0);
  const limit = Math.max(1, Math.min(100, parseInt(options.limit, 10) || 20));
  const [stockPercent, preorderDefaultEnabled] = await Promise.all([
    getStockDisplayPercent(),
    getPreorderDefaultEnabled(),
  ]);

  const params = [docDate];
  // show_on_web=1 คือกลไกเทียบเท่า item_pattern='[W]' ของสินค้าปกติ
  let where = `COALESCE(p.important,0)=0
    AND COALESCE(p.show_on_web,1)=1
    AND (p.date_begin IS NULL OR p.date_begin <= $1::date)
    AND (p.date_end IS NULL OR p.date_end >= $1::date)`;
  if (search) {
    params.push(likeContains(search));
    const s = params.length;
    where += ` AND (`
      + `p.premium_code ILIKE $${s} OR p.name_1 ILIKE $${s} OR p.name_eng_1 ILIKE $${s}`
      + ` OR EXISTS (SELECT 1 FROM sml_sale_premium_condition cc LEFT JOIN ic_inventory ci ON ci.code=cc.ic_code`
      + ` WHERE cc.premium_code=p.premium_code AND (cc.ic_code ILIKE $${s} OR ci.name_1 ILIKE $${s}))`
      + ` OR EXISTS (SELECT 1 FROM sml_sale_premium_free_list ff LEFT JOIN ic_inventory fi ON fi.code=ff.ic_code`
      + ` WHERE ff.premium_code=p.premium_code AND (ff.ic_code ILIKE $${s} OR fi.name_1 ILIKE $${s}))`
      + `)`;
  }

  const rowsRes = await queryFn(
    `SELECT p.premium_code, p.name_1,
            COALESCE(p.name_2,'') AS name_2,
            COALESCE(p.name_eng_1,'') AS name_eng_1,
            COALESCE(p.image_guid,'') AS image_guid,
            c.ic_code, c.unit_code, c.qty,
            COALESCE(i.name_1,'') AS condition_item_name
       FROM sml_sale_premium p
       JOIN LATERAL (
         SELECT * FROM sml_sale_premium_condition c
          WHERE c.premium_code=p.premium_code
          ORDER BY c.roworder LIMIT 1
       ) c ON TRUE
       LEFT JOIN ic_inventory i ON i.code=c.ic_code
      WHERE ${where}
      ORDER BY p.premium_code
      OFFSET ${offset} LIMIT ${limit}`,
    params,
  );

  const result = [];
  for (const row of rowsRes.rows) {
    try {
      const detail = await loadSalePremiumDetail(queryFn, row.premium_code, {
        custCode: options.custCode,
        saleType: options.saleType,
        vatType: options.vatType,
        vatRate: options.vatRate,
        stockPercent,
        preorderDefaultEnabled,
        docDate,
      });
      // สต๊อกไม่ครบแต่ทุกชิ้นเปิด Preorder ยังต้องแสดงให้ลูกค้าสั่งจองทั้งชุดได้
      if (!includeOutOfStock && String(detail.sold_out) === '1' && !detail.preorder_allowed) continue;
      result.push({
        item_code: detail.premium_code,
        item_name: detail.premium_name,
        name_1: detail.name_1,
        name_2: detail.name_2,
        name_eng_1: detail.name_eng_1,
        image_guid: detail.image_guid,
        item_type: '4',
        stock_qty: detail.stock_qty,
        sold_out: detail.sold_out,
        unit_standard: detail.unit_code,
        start_sale_unit: detail.unit_code,
        is_promotion: '1',
        favorite_item: 0,
        is_return: '0',
        preorder_allowed: detail.preorder_allowed,
        price: detail.price,
        tax_type: detail.tax_type,
        is_sale_premium: 1,
        sale_premium_code: detail.premium_code,
        sale_premium_name: detail.premium_name,
        condition_item_code: row.ic_code,
        condition_item_name: row.condition_item_name,
        condition_qty: toNumber(row.qty),
        condition_unit_code: row.unit_code,
        free_items: detail.free_items,
      });
    } catch (ex) {
      console.warn(`skip sale premium ${row.premium_code}: ${ex.message}`);
    }
  }
  return result;
}

// แตกโปรโมชัน 1 บรรทัดในตะกร้า → หลายบรรทัดจริงตอนบันทึก
// paid_items = ของที่ซื้อ (ราคาปกติ, is_permium=0)
// free_items = ของแถม (ราคา 0, is_permium=1)
async function expandSalePremiumItemForSave(queryFn, item, options = {}) {
  const code = safeText(item.sale_premium_code || item.premium_code || item.item_code);
  const packQty = toNumber(item.qty, 1);
  const detail = await loadSalePremiumDetail(queryFn, code, options);
  const rows = [];
  for (const paid of detail.paid_items) {
    rows.push({
      ...paid,
      qty: roundMoney(toNumber(paid.qty) * packQty),
      price: paid.price,
      sum_amount: roundMoney(toNumber(paid.price) * toNumber(paid.qty) * packQty),
      discount: '',
      discount_amount: 0,
      is_permium: 0,
      sale_premium_code: code,
    });
  }
  for (const free of detail.free_items) {
    rows.push({
      ...free,
      qty: roundMoney(toNumber(free.qty) * packQty),
      price: 0,
      sum_amount: 0,
      discount: '',
      discount_amount: 0,
      is_permium: 1,
      sale_premium_code: code,
    });
  }
  return rows;
}

// ตรวจว่ารายการเป็นโปรโมชันของแถมหรือไม่ — ใช้ตรงจุด expand-at-boundary
function isSalePremiumItem(item) {
  return safeText(item?.sale_premium_code) !== '' || String(item?.item_type ?? '') === '4';
}

module.exports = {
  safeText,
  toNumber,
  normalizeDate,
  resolveBasketPricingContext,
  loadSalePremiumDetail,
  listSalePremiumProductsForSale,
  expandSalePremiumItemForSave,
  isSalePremiumItem,
};
