const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { pool, withTransaction, query } = require('../db');
const { getCancelDocPattern, getOrderDocSource, getSalePremiumEnabled, marketplaceDocWhere } = require('../utils/marketplaceSalesSettings');
const { stripClientPremiumFlagsFromItems, premiumFlagValue, enforcePremiumLineValuesForItems } = require('../utils/salePremiumGuard');
const { serverDocDate, serverDocTime } = require('../utils/serverTime');
const { getMaxAllowanceForUnit } = require('../utils/maxAllowance');
const { MAIN_DOC_NO_SQL, docGroupKey, docNoPrefixCondition, formatSubDocNo, isValidDocNoParam, resolveMainDocNo } = require('../utils/orderDocNo');
const { splitItemsIntoDocuments } = require('../utils/orderDocSplit');
const { aggregateOrderRowsByMainDoc } = require('../utils/orderHistoryAggregate');
const { expandSalePremiumItemForSave, isSalePremiumItem } = require('../utils/salePremiumHelper');
const { getProductPriceLocalx } = require('../utils/priceHelper');
const { findPriceViolations, isFiniteNumeric } = require('../utils/orderPriceGuard');
const { buildSetTemplateMap, applySetTemplateToItem, setIssueMessage } = require('../utils/orderSetGuard');
const { requireAdmin } = require('../auth/requireAdmin');
const { likeContains } = require('../utils/likePattern');
const { resolveDateRange } = require('../utils/adminOrderFilters');
const { pendingIdentity } = require('../auth/pendingOrderAuth');
const { requestMetadata } = require('../utils/pendingOrder');

// แตกรายการโปรโมชันของแถม (item_type='4') เป็นบรรทัดสินค้าจริง ตรงขอบก่อนคำนวณ/บันทึก
// สินค้าปกติผ่านตรงๆ — ของแถมได้ price/sum_amount=0 และ is_permium=1 (บังคับซ้ำด้วย guard)
async function expandOrderItems(client, items, ctx) {
  const out = [];
  const list = Array.isArray(items) ? items : [];

  // ปิด feature flag แล้วต้องไม่มีของแถมหลุดเข้า ERP ได้อีก — ไม่งั้นมันไม่ใช่ kill switch จริง
  // (ลูกค้าที่มีของแถมค้างในตะกร้าจะเจอ premium_unavailable ที่ /validatecartstock ก่อนถึงตรงนี้)
  // ส่ง client ไปด้วย — อยู่ในทรานแซกชันแล้ว ถ้าขอ connection ใหม่จะทำให้ pool ตันตอนคนสั่งพร้อมกันเยอะ
  if (list.some((item) => isSalePremiumItem(item)) && !(await getSalePremiumEnabled(client))) {
    const err = new Error('โปรโมชันของแถมปิดให้บริการชั่วคราว กรุณานำรายการโปรโมชันออกจากตะกร้า');
    err.statusCode = 400;
    err.code = 'SALE_PREMIUM_DISABLED';
    throw err;
  }

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (isSalePremiumItem(item)) {
      const expanded = await expandSalePremiumItemForSave(client.query.bind(client), item, ctx);
      // แปะ marker ต่อการ expand หนึ่งครั้ง เพื่อให้การแบ่งเอกสารรู้ว่าบรรทัดไหนต้องอยู่ใบเดียวกัน
      // ใช้ index ไม่ใช่ sale_premium_code เพราะลูกค้าอาจใส่โปรโมชันรหัสเดียวกัน 2 บรรทัดในตะกร้า
      // ฟิลด์ที่ขึ้นต้นด้วย __ ไม่ถูกเขียนลง DB เพราะ INSERT ระบุคอลัมน์ชัดเจน
      const groupId = `premium:${i}`;
      out.push(...expanded.map((row) => ({ ...row, __group_id: groupId })));
    } else {
      out.push(item);
    }
  }
  return enforcePremiumLineValuesForItems(out);
}

const toNumber = (value, fallback = 0) => {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const toInt = (value, fallback = 0) => {
  return Math.trunc(toNumber(value, fallback));
};
const r2 = (value) => Math.round(toNumber(value, 0) * 100) / 100;

function calcAfterDiscount(discountWord, totalValue) {
  if (!discountWord || String(discountWord).trim() === '') return r2(totalValue);

  let remaining = toNumber(totalValue, 0);
  const parts = String(discountWord).replace(/\s/g, '').split(/[,+]/);
  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    if (part.startsWith('@')) {
      remaining -= toNumber(part.slice(1), 0);
    } else if (part.includes('%')) {
      remaining -= r2((toNumber(part.replace(/%/g, ''), 0) / 100) * remaining);
    } else if (part.toUpperCase().endsWith('B')) {
      remaining -= toNumber(part.slice(0, -1), 0);
    } else {
      remaining -= toNumber(part, 0);
    }
    if (remaining < 0) remaining = 0;
  }

  return r2(remaining);
}

function getOrderItemCodes(items) {
  const codes = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (it?.item_code) codes.add(String(it.item_code));
    for (const sub of Array.isArray(it?.sub_item) ? it.sub_item : []) {
      if (sub?.item_code) codes.add(String(sub.item_code));
    }
  }
  return [...codes];
}

function hasPreorderMarker(value) {
  return String(value || '').toUpperCase().split(/\s+/).includes('PREORDER');
}

function isPreorderDocument(docNo, remark) {
  return /^PREQT/i.test(String(docNo || '').trim()) || hasPreorderMarker(remark);
}

// รับเองที่สาขา (รีวิว 260908 สไลด์ 6) — ลูกค้าระบุว่า "ข้อมูลจะอยู่ที่ หมายเหตุ ขอ QT"
// จึงประกอบเป็นข้อความบรรทัดเดียวไปต่อกับหมายเหตุ ไม่ได้เพิ่มคอลัมน์ใหม่ใน ic_trans
// (คู่กับ MarketPlaceWeb/src/utils/pickupSlots.js ที่ประกอบข้อความเดียวกันไว้โชว์)
function buildPickupRemark(pickup = {}) {
  const parts = [];
  const branch = String(pickup.branch || '').trim();
  const date = String(pickup.date || '').trim();
  const slot = String(pickup.timeSlot || '').trim();
  const receiver = String(pickup.receiver || '').trim();
  const vehicle = String(pickup.vehicle || '').trim();

  if (branch) parts.push(`สาขา${branch}`);
  if (date) parts.push(date);
  if (slot) parts.push(slot);
  if (receiver) parts.push(`ผู้รับ: ${receiver}`);
  if (vehicle) parts.push(`ทะเบียน: ${vehicle}`);

  return parts.length > 0 ? `รับเอง ${parts.join(' ')}` : '';
}

// ใบเสนอราคาใน SML ผู้ใช้ ERP ดูช่อง remark ช่องเดียวเป็นหลัก
// ส่งให้ (send_type=1) จึงรวม "ส่งให้ + ที่อยู่ + หมายเหตุลูกค้า" ไว้ในช่องเดียว
// รับเอง (send_type=0) รวม "รับเอง + สาขา/วัน/เวลา/ผู้รับ/ทะเบียน + หมายเหตุ"
// (ที่อยู่ฉบับเต็มยังเก็บแยกที่ ic_trans_shipment เหมือนเดิม)
function buildDeliveryRemark(sendType, shipAddress, remark, pickup = {}) {
  if (String(sendType) === '1') {
    return ['ส่งให้', shipAddress, remark].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  }
  return [buildPickupRemark(pickup), remark].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
}

function mergePreorderRemark(remark, shouldMark) {
  const text = String(remark || '').trim();
  if (!shouldMark || hasPreorderMarker(text)) return text;
  return ['PREORDER', text].filter(Boolean).join(' ');
}

async function resolveContactRemark5(client, custCode, contactCode) {
  const customerCode = String(custCode || '').trim();
  const contactRef = String(contactCode || '').trim();
  if (!customerCode || !contactRef) return '';

  const rs = await client.query(
    `SELECT COALESCE(name,'') AS contact_name,
            COALESCE(telephone,'') AS telephone
     FROM ar_contactor
     WHERE ar_code = $1 AND roworder::text = $2
     ORDER BY roworder
     LIMIT 1`,
    [customerCode, contactRef]
  );

  if (rs.rows.length === 0) return contactRef;
  const row = rs.rows[0];
  return `${String(row.contact_name || '').trim()} โทร.${String(row.telephone || '').trim()}`.trim();
}


// ตรวจ Maximum Allowance = จำนวนสั่งสูงสุดต่อคำสั่งซื้อ กำหนดต่อหน่วยใน dimension_38 (REQ3)
// ต้องตรวจฝั่ง server เพราะปุ่มเพิ่มลงตะกร้าเร็วที่การ์ดสินค้าและการแก้จำนวนในตะกร้า bypass dialog ได้
// จำนวนที่บันทึกไปแล้วในการ checkout ครั้งเดียวกัน (ready ถูกบันทึกก่อน preorder คนละ request)
// ถ้าไม่นับรวม ลูกค้าจะเลี่ยงลิมิตได้ด้วยการสั่งให้เกินสต็อกจนระบบแยกใบพรีออเดอร์ให้เอง
// ไม่นับบรรทัดของแถม เพราะลิมิตคิดกับสิ่งที่ลูกค้าเลือกสั่ง ไม่ใช่ของที่ระบบแถมให้
async function loadCheckoutQtySoFar(client, requestId, custCode) {
  const base = String(requestId || '').split(':')[0].trim();
  if (!base || base.startsWith('auto')) return new Map();

  const rs = await client.query(
    `SELECT d.item_code, d.unit_code, SUM(COALESCE(d.qty,0)) AS qty
     FROM marketplace_order_document od
     JOIN ic_trans_detail d ON d.doc_no = od.sub_doc_no AND d.trans_flag=30
     WHERE od.request_id LIKE $1 || ':%' AND od.cust_code = $2
       AND COALESCE(d.is_permium,0) = 0
       AND NOT EXISTS (
         SELECT 1 FROM marketplace_pending_order p
         WHERE p.request_id=od.request_id AND p.cust_code=od.cust_code AND p.status='confirmed'
       )
     GROUP BY d.item_code, d.unit_code
     UNION ALL
     SELECT d.item_code, d.unit_code, SUM(COALESCE(d.qty,0)) AS qty
     FROM marketplace_pending_order p
     JOIN ic_trans_detail d ON d.doc_no=p.doc_no AND d.trans_flag=300
     WHERE (p.request_id=$1 OR p.request_id LIKE $1 || ':%') AND p.cust_code=$2 AND p.status IN ('pending','confirmed')
       AND COALESCE(d.is_permium,0)=0 AND COALESCE(d.set_ref_line,'')=''
     GROUP BY d.item_code,d.unit_code`,
    [base, custCode]
  );

  const map = new Map();
  for (const r of rs.rows) {
    const key = `${String(r.item_code || '').trim()}|${String(r.unit_code || '').trim()}`;
    map.set(key, (map.get(key) || 0) + toNumber(r.qty, 0));
  }
  return map;
}

// ── ตรวจว่าลูกค้ามีตัวตนจริง ────────────────────────────────────────────
// เดิมไม่เคยตรวจ ทำให้ยิง cust_code อะไรก็ได้เข้ามาแล้วได้เอกสารใน ic_trans
// ซึ่ง ERP อ้างอิงกลับไม่ได้ (เอกสารกำพร้า) และไปโผล่ในรายงานยอดขาย
async function validateOrderCustomer(client, custCode) {
  const code = String(custCode || '').trim();
  const rs = await client.query('SELECT 1 FROM ar_customer WHERE code = $1 LIMIT 1', [code]);
  if (rs.rowCount === 0) {
    const err = new Error('ไม่พบรหัสลูกค้านี้ในระบบ');
    err.statusCode = 400;
    err.code = 'ORDER_CUSTOMER_NOT_FOUND';
    throw err;
  }
}

// ── ตรวจราคาที่ client ส่งมากับราคาจริงฝั่ง server ──────────────────────
// ตรรกะการตัดสินอยู่ใน utils/orderPriceGuard.js (มีเทสต์) ที่นี่ทำแค่ต่อกับ priceHelper
async function validateOrderPrices(items, context) {
  const { custCode, saleType, vatType, vatRate, docDate } = context;

  // สินค้าชุดกับสินค้าปกติหาราคาคนละทาง
  // ชุด: ราคามาจากผลรวมของส่วนประกอบใน ic_inventory_set_detail (ทางเดียวกับที่ getProductSetDetail ใช้)
  // ปกติ: ผ่านตรรกะราคา 7 ชั้นของ getProductPriceLocalx
  const lookupSetPrice = async (item) => {
    const rs = await query(
      'SELECT COALESCE(SUM(sum_amount),0) AS set_price FROM ic_inventory_set_detail WHERE ic_set_code = $1',
      [String(item.item_code).trim()]
    );
    return toNumber(rs.rows[0]?.set_price, NaN);
  };

  const lookupPrice = async (item) => {
    try {
      if (String(item.item_type || '') === '3') return await lookupSetPrice(item);

      const res = await getProductPriceLocalx(
        String(item.item_code).trim(), String(item.unit_code).trim(),
        String(toNumber(item.qty, 1)), custCode,
        vatType, vatRate, saleType, String(item.barcode || ''), docDate
      );
      // โครงสร้างผลลัพธ์คือ { success, data: [{ price, price1, price2, ... }] }
      // ไม่ใช่ { price } ตรงๆ — อ่านผิดแล้วจะได้ NaN แล้วด่านนี้จะปล่อยผ่านเงียบๆ
      return toNumber((res?.data || [])[0]?.price, NaN);
    } catch (error) {
      console.warn(`validateOrderPrices: หาราคา ${item.item_code}/${item.unit_code} ไม่ได้ —`, error?.message || error);
      return NaN;
    }
  };

  const violations = await findPriceViolations(items, lookupPrice, { vatRate });

  if (violations.length > 0) {
    const err = new Error('ราคาสินค้าไม่ตรงกับราคาปัจจุบัน กรุณารีเฟรชตะกร้าแล้วลองใหม่');
    err.statusCode = 409;
    err.code = 'ORDER_PRICE_MISMATCH';
    err.violations = violations;
    throw err;
  }
}

async function validateOrderMaxAllowance(client, items, priorQtyByKey = new Map()) {
  const rootItems = (Array.isArray(items) ? items : []).filter((item) => item && typeof item === 'object');
  if (rootItems.length === 0) return;

  const codes = [...new Set(rootItems.map((it) => String(it.item_code || '').trim()).filter(Boolean))];
  if (codes.length === 0) return;

  const rs = await client.query(
    `SELECT ic_code, COALESCE(dimension_38,'') AS max_allowance
     FROM ic_inventory_detail WHERE ic_code = ANY($1)`,
    [codes]
  );
  const allowanceByCode = new Map(rs.rows.map((r) => [String(r.ic_code), r.max_allowance]));

  // รวมจำนวนต่อ (สินค้า + หน่วย) เพราะลิมิตคิดต่อคำสั่งซื้อ ไม่ใช่ต่อบรรทัด
  // เริ่มจากยอดที่บันทึกไปแล้วในการ checkout เดียวกัน (ใบ ready ที่ออกไปก่อนหน้า)
  const qtyByKey = new Map(priorQtyByKey);
  for (const it of rootItems) {
    const itemCode = String(it.item_code || '').trim();
    const unitCode = String(it.unit_code || '').trim();
    if (!itemCode || !unitCode) continue;
    const key = `${itemCode}|${unitCode}`;
    qtyByKey.set(key, toNumber(qtyByKey.get(key), 0) + toNumber(it.qty, 0));
  }

  const violations = [];
  for (const [key, totalQty] of qtyByKey.entries()) {
    const [itemCode, unitCode] = key.split('|');
    const maxQty = getMaxAllowanceForUnit(allowanceByCode.get(itemCode), unitCode);
    if (maxQty !== null && totalQty > maxQty) {
      violations.push({ item_code: itemCode, unit_code: unitCode, qty: totalQty, max_qty: maxQty });
    }
  }

  if (violations.length > 0) {
    const err = new Error('มีสินค้าที่สั่งเกินจำนวนสูงสุดต่อคำสั่งซื้อ');
    err.statusCode = 400;
    err.code = 'ORDER_MAX_ALLOWANCE_EXCEEDED';
    err.violations = violations;
    throw err;
  }
}


async function loadTaxTypeMap(client, items) {
  const codes = getOrderItemCodes(items);
  if (codes.length === 0) return new Map();

  const rs = await client.query(
    'SELECT code, COALESCE(tax_type,0) AS tax_type FROM ic_inventory WHERE code = ANY($1)',
    [codes]
  );
  return new Map(rs.rows.map((r) => [String(r.code), toInt(r.tax_type, 0)]));
}

function calcOrderLineVat(item, taxTypeMap, vatType, vatRate, overrides = {}) {
  const itemCode = String(item?.item_code || '');
  const qty = toNumber(overrides.qty ?? item?.qty, 0);
  const price = toNumber(overrides.price ?? item?.price, 0);
  const sumAmount = r2(
    overrides.sumAmount ?? (item?.sum_amount != null ? toNumber(item.sum_amount, qty * price) : qty * price)
  );
  const taxType = taxTypeMap.has(itemCode) ? taxTypeMap.get(itemCode) : toInt(item?.tax_type, 0);

  if (taxType === 1) {
    return {
      taxType,
      sumAmount,
      sumAmountExcludeVat: sumAmount,
      vatValue: 0,
      priceExcludeVat: r2(price),
      lineTotalAmount: sumAmount,
    };
  }

  if (vatType === 1) {
    const sumAmountExcludeVat = r2((sumAmount * 100) / (100 + vatRate));
    const vatValue = r2(sumAmount - sumAmountExcludeVat);
    return {
      taxType,
      sumAmount,
      sumAmountExcludeVat,
      vatValue,
      priceExcludeVat: r2((price * 100) / (100 + vatRate)),
      lineTotalAmount: sumAmount,
    };
  }

  if (vatType === 0) {
    const vatValue = r2(sumAmount * (vatRate / 100));
    return {
      taxType,
      sumAmount,
      sumAmountExcludeVat: sumAmount,
      vatValue,
      priceExcludeVat: r2(price),
      lineTotalAmount: r2(sumAmount + vatValue),
    };
  }

  return {
    taxType,
    sumAmount,
    sumAmountExcludeVat: sumAmount,
    vatValue: 0,
    priceExcludeVat: r2(price),
    lineTotalAmount: sumAmount,
  };
}

function calcDetailDiscountAmount(item, vatType, vatRate) {
  const discountAmount = r2(toNumber(item?.discount_amount, 0));
  if (discountAmount <= 0) return 0;
  if (vatType === 1) return r2((discountAmount * 100) / (100 + vatRate));
  return discountAmount;
}

function summarizeOrderVat(items, taxTypeMap, vatType, vatRate, discountWord = '', discountType = 0, discountVatType = 0) {
  let totalValueVat = 0;
  let totalValueNoVat = 0;

  for (const it of items) {
    const line = calcOrderLineVat(it, taxTypeMap, vatType, vatRate);
    if (line.taxType === 1) {
      totalValueNoVat = r2(totalValueNoVat + line.sumAmount);
    } else {
      totalValueVat = r2(totalValueVat + line.sumAmount);
    }
  }

  const totalValue = r2(totalValueVat + totalValueNoVat);
  const afterDiscount = calcAfterDiscount(discountWord, totalValue);
  const totalDiscount = r2(totalValue - afterDiscount);

  let totalBeforeVat = 0;
  let totalVatValue = 0;
  let totalAfterVat = 0;
  let totalAmount = 0;
  let totalExceptVat = totalValueNoVat;
  let discountNoVatAmount = 0;

  switch (vatType) {
    case 0: {
      if (discountType === 1) {
        if (discountVatType === 1) {
          const discountVatPart = totalValue > 0 ? r2(totalDiscount * (totalValueVat / totalValue)) : 0;
          discountNoVatAmount = r2(totalDiscount - discountVatPart);
          totalBeforeVat = r2(totalValueVat - discountVatPart);
          totalVatValue = r2(totalBeforeVat * (vatRate / 100));
        } else if (totalValueVat < totalDiscount) {
          totalBeforeVat = 0;
          discountNoVatAmount = r2(totalDiscount - totalValueVat);
          totalVatValue = 0;
        } else {
          totalBeforeVat = r2(totalValueVat - totalDiscount);
          totalVatValue = r2(totalBeforeVat * (vatRate / 100));
        }
        totalAfterVat = r2(totalBeforeVat + totalVatValue);
        totalExceptVat = r2(totalExceptVat - discountNoVatAmount);
        totalAmount = r2(totalExceptVat + totalAfterVat);
      } else {
        totalBeforeVat = totalValueVat;
        totalVatValue = r2(totalBeforeVat * (vatRate / 100));
        totalAfterVat = r2(totalBeforeVat + totalVatValue);
        totalAmount = r2(totalBeforeVat + totalExceptVat + totalVatValue - totalDiscount);
      }
      break;
    }
    case 1: {
      totalAmount = r2(totalValue - totalDiscount);
      if (discountType === 1) {
        if (discountVatType === 1) {
          const discountVatPart = totalValue > 0 ? r2(totalDiscount * (totalValueVat / totalValue)) : 0;
          discountNoVatAmount = r2(totalDiscount - discountVatPart);
          const base = r2(totalValueVat - discountVatPart);
          totalBeforeVat = r2((base * 100) / (100 + vatRate));
          totalVatValue = r2(base - totalBeforeVat);
        } else if (totalValueVat < totalDiscount) {
          totalBeforeVat = 0;
          totalVatValue = 0;
          discountNoVatAmount = r2(totalDiscount - totalValueVat);
        } else {
          const base = r2(totalValueVat - totalDiscount);
          totalBeforeVat = r2((base * 100) / (100 + vatRate));
          totalVatValue = r2(base - totalBeforeVat);
        }
        totalAfterVat = r2(totalBeforeVat + totalVatValue);
        totalExceptVat = r2(totalExceptVat - discountNoVatAmount);
      } else {
        totalBeforeVat = r2((totalValueVat * 100) / (100 + vatRate));
        totalVatValue = r2(totalValueVat - totalBeforeVat);
        totalAfterVat = r2(totalBeforeVat + totalVatValue);
      }
      break;
    }
    default: {
      totalVatValue = 0;
      if (discountVatType === 1 && totalValue > 0) {
        const discountVatPart = r2(totalDiscount * (totalValueVat / totalValue));
        discountNoVatAmount = r2(totalDiscount - discountVatPart);
      }
      totalExceptVat = r2(totalExceptVat - discountNoVatAmount);
      totalAmount = r2(totalValue - totalDiscount);
      break;
    }
  }

  return {
    totalValue,
    totalDiscount,
    totalBeforeVat: r2(totalBeforeVat),
    totalVatValue: r2(totalVatValue),
    totalAfterVat: r2(totalAfterVat),
    totalExceptVat: r2(totalExceptVat),
    totalAmount: r2(totalAmount),
  };
}

// POST /service/v1/sendorder
router.use(require('./pendingOrders')(summarizeOrderVat));
router.post('/sendorder', pendingIdentity, async (req, res) => {
  try {
    let obj = req.body;
    if (typeof obj === 'string') obj = JSON.parse(obj);

    // วันที่/เวลาเอกสารใช้เวลาไทยของ server เสมอ ไม่รับจาก client (REQ6)
    // กันนาฬิกาเครื่องลูกค้าเพี้ยน และกันการส่งวันย้อนหลังเพื่อปลุกโปรโมชันที่หมดอายุแล้ว
    const doc_date = serverDocDate();
    const doc_time = serverDocTime();
    const send_date = obj.send_date || doc_date;
    const send_day = obj.send_day || '0';
    const doc_no = obj.doc_no || '';
    const cust_code = obj.cust_code || '';
    const send_type = obj.send_type || '0';
    const inquiry_type = obj.inquiry_type !== undefined ? toInt(obj.inquiry_type, 0) : toInt(obj.sale_type, 0);
    const vat_type = obj.vat_type !== undefined ? toInt(obj.vat_type, 1) : 1;
    const vat_rate = obj.vat_rate !== undefined ? toNumber(obj.vat_rate, 7) : 7;
    const remark = obj.remark || '';
    // ที่อยู่จัดส่ง — หน้าจอส่ง address/address_name/telephone มาตลอด แต่เดิมไม่มีใครอ่าน
    // ลูกค้าที่เลือก "ระบุที่อยู่ใหม่" แล้วพิมพ์ที่อยู่ปลายทาง ที่อยู่นั้นจึงหายเงียบ
    // ตัดความยาวตามคอลัมน์จริงของ ic_trans_shipment (255/1000/100) กัน INSERT ล้ม
    const shipAddress = String(obj.address || '').trim().slice(0, 255);
    const shipAddressName = String(obj.address_name || '').trim().slice(0, 1000);
    const shipTelephone = String(obj.telephone || '').trim().slice(0, 100);
    // ข้อมูลรับเองที่สาขา — ตัดความยาวกันหมายเหตุบวมเกินคอลัมน์ ic_trans.remark
    const pickupInfo = {
      branch: String(obj.pickup_branch || '').trim().slice(0, 60),
      date: String(obj.pickup_date || '').trim().slice(0, 20),
      timeSlot: String(obj.pickup_time_slot || '').trim().slice(0, 20),
      receiver: String(obj.pickup_receiver || '').trim().slice(0, 80),
      vehicle: String(obj.pickup_vehicle || '').trim().slice(0, 40)
    };
    const contact_code = obj.contact_code || '';
    const emp_code = '';
    const credit_day = obj.credit_day || '0';
    const credit_date = obj.credit_date || doc_date;
    const branch_code = '00000';
    // ตัดธง is_permium ที่ client ส่งมาทิ้งเสมอ — ธงนี้ต้องมาจากการ expand โปรโมชันฝั่ง server เท่านั้น
    // ถ้าไม่ตัด client จะตั้งสินค้าทุกชิ้นเป็นของแถมราคา 0 ได้
    const items = stripClientPremiumFlagsFromItems(Array.isArray(obj.items) ? obj.items : []);
    const discount_word = obj.discount_word || '';
    const discount_type = obj.discount_type !== undefined ? toInt(obj.discount_type, 0) : toInt(obj.discout_type, 0);
    const discount_vat_type = obj.discount_vat_type !== undefined ? toInt(obj.discount_vat_type, 0) : 0;
    const safeInquiryType = Number.isNaN(inquiry_type) ? 0 : inquiry_type;
    const safeVatType = Number.isNaN(vat_type) ? 1 : vat_type;
    const safeVatRate = Number.isNaN(vat_rate) ? 7 : vat_rate;
    const safeDiscountType = Number.isNaN(discount_type) ? 0 : discount_type;
    const safeDiscountVatType = Number.isNaN(discount_vat_type) ? 0 : discount_vat_type;
    const orderIsPreorder = false;
    const requestId = String(obj.request_id || '').trim() || `auto:${uuidv4()}`;
    if (requestId.length > 64) return res.status(400).json({ success: false, message: 'request_id ยาวเกินกำหนด' });
    // Return the saved result before price/promotion validation on network retries.
    const previous = await query('SELECT cust_code,response_json FROM marketplace_order_request WHERE request_id=$1', [requestId]);
    if (previous.rows.length) {
      if (previous.rows[0].cust_code !== cust_code) return res.status(409).json({ success: false, message: 'คำขอนี้ถูกใช้แล้ว' });
      return res.json({ success: true, ...JSON.parse(previous.rows[0].response_json), duplicate: true });
    }

    if (items.length === 0) {
      return res.status(400).json({ success: false, msg: 'items is empty', message: 'ไม่พบรายการสินค้า' });
    }

    const docSource = await getOrderDocSource();
    const serverIssuesDocNo = docSource === 'server';

    // โหมด server ออกเลขเอง จึงไม่ต้องบังคับให้ client ส่ง doc_no มา (REQ4)
    if (!serverIssuesDocNo && !String(doc_no).trim()) {
      return res.status(400).json({ success: false, msg: 'doc_no is empty', message: 'ไม่พบเลขที่เอกสาร' });
    }
    if (!serverIssuesDocNo && !isValidDocNoParam(doc_no)) return res.status(400).json({ success: false, message: 'เลข QT ไม่ถูกต้อง' });

    if (!String(cust_code).trim()) {
      return res.status(400).json({ success: false, msg: 'cust_code is empty', message: 'ไม่พบรหัสลูกค้า กรุณาเข้าสู่ระบบใหม่' });
    }

    // ไม่ต้องเช็ค doc_date ว่าง — server เป็นคนกำหนดเองแล้ว ไม่มีทางว่าง

    const invalidItemIndex = items.findIndex((it) => {
      if (!it || typeof it !== 'object') return true;
      const itemCode = String(it.item_code || '').trim();
      const unitCode = String(it.unit_code || '').trim();
      const qty = toNumber(it.qty, NaN);
      if (!itemCode || !unitCode || !Number.isFinite(qty) || qty <= 0) return true;
      // ราคาต้องเป็นตัวเลขจริง — เดิมใช้ toNumber(it.price, 0) ทำให้ "abc" หรือ {} หรือ
      // การไม่ส่ง price มาเลย กลายเป็น 0 แล้วเงื่อนไข price < 0 ก็เป็นเท็จ ผ่านฉลุยเป็นของฟรี
      if (!isFiniteNumeric(it.price)) return true;
      // ราคา/ยอดรวมติดลบไม่มีเคสที่ถูกต้อง
      const price = toNumber(it.price, 0);
      const sumAmount = toNumber(it.sum_amount, 0);
      return price < 0 || sumAmount < 0;
    });

    if (invalidItemIndex !== -1) {
      return res.status(400).json({
        success: false,
        msg: 'invalid item',
        message: `รายการสินค้าลำดับที่ ${invalidItemIndex + 1} ไม่สมบูรณ์`
      });
    }

    // ตรวจราคาที่ client ส่งมากับราคาจริง (กันการแก้ payload ให้ราคาถูกลง)
    //
    // ⚠️ ต้องอยู่ "นอก" withTransaction — getProductPriceLocalx ขอ connection ของตัวเอง
    //    จาก pool เดียวกัน ถ้าเรียกข้างใน transaction จะทำให้ 1 checkout ถือ 2 connection
    //    พร้อมกัน ความจุลดลงครึ่งหนึ่งและเสี่ยง deadlock เมื่อคนสั่งพร้อมกันใกล้ขนาด pool
    //    (วัดจริงแล้วตอนอยู่ในทรานแซกชัน: 25 คนพร้อมกัน = ล้มทั้งหมด)
    //
    // เป็นการตรวจแบบอ่านอย่างเดียว ไม่ต้องอยู่ในทรานแซกชันเดียวกับการเขียน
    // ไม่มีด่านสต็อกสำหรับคำขอ 300; พนักงานเลือกคลังตอนยืนยัน
    //
    // ใช้ items ต้นฉบับ ไม่ใช่ expandedItems เพราะบรรทัดของแถมถูกบังคับราคา 0 ฝั่ง server อยู่แล้ว
    try {
      await validateOrderPrices(items, {
        custCode: cust_code,
        saleType: safeInquiryType,
        vatType: safeVatType,
        vatRate: safeVatRate,
        docDate: doc_date,
      });
    } catch (priceError) {
      if (priceError.code !== 'ORDER_PRICE_MISMATCH') throw priceError;
      return res.status(priceError.statusCode || 409).json({
        success: false,
        msg: priceError.code,
        message: priceError.message,
        // ไม่ส่งราคาจริงกลับไป เพื่อไม่ให้ใช้ endpoint นี้ไล่หาราคาต่ำสุดที่ระบบยอมรับ
        price_mismatch_items: (priceError.violations || []).map((v) => ({ item_code: v.item_code, unit_code: v.unit_code })),
      });
    }

    // ส่วนประกอบของสินค้าชุดประกอบใหม่จากแม่แบบของ ERP ค่าที่ client ส่งมาไม่มีผล
    // ดู src/utils/orderSetGuard.js — เดิมด่านนี้ตรวจแค่ item_code/unit_code/qty
    // ไม่เคยตรวจ price เลย จึงเขียนราคาชิ้นส่วนอะไรก็ได้ (รวมถึงติดลบ) ลง ic_trans_detail ได้
    const setItemIndexes = items
      .map((it, itemIndex) => (String(it?.item_type || '') === '3' ? itemIndex : -1))
      .filter((i) => i >= 0);

    if (setItemIndexes.length > 0) {
      const setCodes = [...new Set(setItemIndexes.map((i) => String(items[i].item_code || '').trim()).filter(Boolean))];
      const templateRs = await query(
        `SELECT d.ic_set_code, d.ic_code, d.unit_code, d.qty, d.price,
                COALESCE(d.barcode,'') AS barcode, d.price_ratio,
                COALESCE(i.name_1, d.ic_code) AS item_name
           FROM ic_inventory_set_detail d
           LEFT JOIN ic_inventory i ON i.code = d.ic_code
          WHERE d.ic_set_code = ANY($1)
          ORDER BY d.ic_set_code, COALESCE(d.line_number,0), COALESCE(d.roworder,0)`,
        [setCodes]
      );
      const templates = buildSetTemplateMap(templateRs.rows);

      for (const itemIndex of setItemIndexes) {
        const it = items[itemIndex];
        const issue = applySetTemplateToItem(it, templates.get(String(it.item_code || '').trim()));
        if (issue) {
          return res.status(400).json({
            success: false,
            msg: 'invalid set item',
            message: setIssueMessage(issue, itemIndex),
          });
        }
      }
    }

    // 🚨 สินค้าที่แอดมินไม่ได้ให้เข้าร่วม marketplace ต้องสั่งซื้อไม่ได้
    //    เดิม item_pattern='[W]' กรองแค่ตอนแสดงรายการ (getProductList)
    //    แต่ getProductDetail / additemtocart / sendorder ไม่เช็ค ใครรู้รหัสก็สั่งได้
    //    ยิงจริงแล้ว: 03-0405 (item_pattern='') ไม่โผล่ในรายการ แต่สั่งได้ 200
    //    ในฐานมีสินค้าแบบนี้ 1,056 รายการ ตรงกับหน้า "กำหนดสินค้าเข้าร่วม"
    //
    // ⚠️ ตรวจเฉพาะบรรทัดระดับบนที่ลูกค้าเลือกเองเท่านั้น
    //    - ชิ้นส่วนของชุด (sub_item) ต้องไม่ตรวจ — ในฐานมี 8 ตัวที่ไม่ใช่ [W]
    //    - ของแถม (item_type=4) ต้องไม่ตรวจ — salePremiumHelper เขียนกำกับไว้เองว่า
    //      "ของแถมอาจเป็นสินค้าที่ไม่ได้ขายออนไลน์ แต่ยังต้องแถมได้"
    const pickedCodes = [...new Set(
      items
        .filter((it) => it && typeof it === 'object' && String(it.item_type || '') !== '4' && !isSalePremiumItem(it))
        .map((it) => String(it.item_code || '').trim())
        .filter(Boolean),
    )];
    if (pickedCodes.length > 0) {
      const joinRs = await query(
        `SELECT code FROM ic_inventory WHERE code = ANY($1) AND COALESCE(item_pattern,'') = '[W]'`,
        [pickedCodes],
      );
      const joined = new Set(joinRs.rows.map((r) => String(r.code)));
      const notJoined = pickedCodes.filter((code) => !joined.has(code));
      if (notJoined.length > 0) {
        return res.status(400).json({
          success: false,
          msg: 'ORDER_ITEM_NOT_ON_MARKETPLACE',
          message: `สินค้าต่อไปนี้ไม่เปิดขายบนหน้าเว็บแล้ว กรุณานำออกจากตะกร้า: ${notJoined.join(', ')}`,
          items_not_on_marketplace: notJoined,
        });
      }
    }

    // idempotency key จาก client — กันกดซ้ำ/axios retry/refresh/เปิด 2 แท็บ (REQ4)
    // ถ้าไม่ส่งมา (client เก่า) จะสุ่มให้ = ไม่ idempotent แต่ของเดิมไม่พัง

    const saveResult = await withTransaction(async (client) => {
      // lock ที่ 1: ต่อ request — ไม่มี contention ข้ามลูกค้า
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`sendorder:req:${requestId}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`sendorder:checkout:${cust_code}:${requestId.split(':')[0]}`]);

      const prevRs = await client.query(
        'SELECT cust_code, response_json FROM marketplace_order_request WHERE request_id = $1 LIMIT 1',
        [requestId]
      );
      if (prevRs.rows.length > 0) {
        const prev = prevRs.rows[0];
        if (String(prev.cust_code || '') !== String(cust_code || '')) {
          throw new Error('duplicate_doc_no_customer_mismatch');
        }
        try {
          return { ...JSON.parse(prev.response_json), duplicate: true };
        } catch {
          return { duplicate: true, doc_no: '' };
        }
      }

      // โหมด client (ค่าเริ่มต้น): ยังใช้ doc_no ที่ client ส่งมา + duplicate check แบบเดิม
      if (!serverIssuesDocNo) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`sendorder:${doc_no}`]);
        const reserved = await client.query('SELECT doc_no FROM marketplace_pending_order WHERE reserved_qt_no=$1', [doc_no]);
        if (reserved.rows.length) throw Object.assign(new Error('เลข QT นี้ถูกจองแล้ว กรุณาเริ่มคำขอใหม่'), { statusCode: 409 });
        const duplicateRs = await client.query(
          `SELECT doc_no, cust_code
           FROM ic_trans
           WHERE trans_flag = 30 AND doc_format_code = 'QT' AND doc_no = $1
           LIMIT 1`,
          [doc_no]
        );
        if (duplicateRs.rows.length > 0) {
          // Only request_id replays prove this checkout was saved. An old QT with
          // the same number must not make a new cart appear successfully submitted.
          throw Object.assign(new Error('เลข QT นี้ถูกใช้แล้ว กรุณาเริ่มคำขอใหม่'), { statusCode: 409 });
        }
      }

      // แตกของแถมเป็นบรรทัดจริง แล้วใช้ expandedItems แทน items ทุกจุดต่อจากนี้
      const expandedItems = await expandOrderItems(client, items, {
        custCode: cust_code,
        saleType: safeInquiryType,
        vatType: safeVatType,
        vatRate: safeVatRate,
        docDate: doc_date,
        skipStock: true,
        stockPercent: 100,
        preorderDefaultEnabled: false,
      });

      // ตรวจว่าลูกค้ามีจริงก่อนทุกอย่าง — ไม่งั้นได้เอกสารกำพร้าที่ ERP อ้างอิงกลับไม่ได้
      await validateOrderCustomer(client, cust_code);

      // ตรวจ Maximum Allowance ก่อนตรวจสต็อก — ใช้ items ต้นฉบับ (ก่อน expand)
      // เพราะลิมิตกำหนดกับสิ่งที่ลูกค้าเลือกสั่ง ไม่ใช่บรรทัดของแถมที่ระบบแถมให้เอง
      await validateOrderMaxAllowance(client, items, await loadCheckoutQtySoFar(client, requestId, cust_code));
      // Allocation belongs to staff; no default-warehouse stock/preorder gate.
      for (const item of expandedItems) {
        item.wh_code = '';
        item.shelf_code = '';
      }
      const documentRemark = mergePreorderRemark(buildDeliveryRemark(send_type, shipAddress, remark, pickupInfo), orderIsPreorder);
      const contactRemark5 = await resolveContactRemark5(client, cust_code, contact_code);

      // ภาษีคำนวณจากรหัสสินค้า ไม่ได้ขึ้นกับว่าบรรทัดอยู่ใบไหน → โหลดครั้งเดียวนอกลูปเอกสาร
      const taxTypeMap = await loadTaxTypeMap(client, expandedItems);

      // คำขอ 300 เก็บใบเดียวเสมอ; แบ่ง QT ตามกติกา ERP ตอนพนักงานยืนยัน
      const maxLinesPerDoc = 0;
      const docChunks = splitItemsIntoDocuments(expandedItems, maxLinesPerDoc);

      // เขียนเอกสาร 1 ใบ — เนื้อในคัดลอกจากโค้ดเดิมทั้งบล็อก
      // 🚨 INSERT ทั้ง 3 จุดเรียงคอลัมน์มือ 40 ตำแหน่ง สลับ 1 ตำแหน่งจะเขียนค่าผิดเงียบๆ
      async function insertOrderDocument(docNo, chunkItems, totals) {
        // INSERT HEADER
        await client.query(
          `INSERT INTO ic_trans (
            inquiry_type,vat_type,trans_type,trans_flag,doc_date,doc_no,
            cust_code,send_date,send_day,vat_rate,total_value,
            total_vat_value,total_after_vat,total_amount,total_before_vat,
            doc_time,doc_format_code,creator_code,sale_code,total_discount,
            remark,remark_5,send_type,total_except_vat,credit_day,credit_date,branch_code
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
          [
            safeInquiryType, safeVatType, 2, 300,
            doc_date, docNo, cust_code, send_date,
            toInt(send_day, 0), safeVatRate,
            totals.totalValue, totals.totalVatValue,
            totals.totalAfterVat, totals.totalAmount,
            totals.totalBeforeVat, doc_time, 'MPR', 'market', emp_code,
            totals.totalDiscount, documentRemark, contactRemark5, toInt(send_type, 0),
            totals.totalExceptVat, toInt(credit_day, 0), credit_date, branch_code,
          ]
        );

        // INSERT SHIPMENT — ที่อยู่จัดส่งของใบนี้
        // ระบบเดิม (Java) เขียน ic_trans_shipment ให้ใบ flag 30 ของ marketplace ทุกใบ
        // (ตรวจกับฐานจริง: 5,575/5,575 ใบ MQT มีครบ รวมถึงใบรับเอง 1,180 ใบ)
        // ตัว Node เดิมไม่เขียนเลย getOrderHeader ที่อ่านจากตารางนี้จึงได้ที่อยู่ว่างทุกใบ
        //
        // mapping ตามที่ระบบเดิมใช้และ getOrderHeader อ่านอยู่:
        //   transport_name      = ข้อความที่อยู่   (อ่านออกเป็น address)
        //   transport_address   = ป้ายวิธีเลือก    (อ่านออกเป็น address_name เช่น "ใช้ที่อยู่ปัจจุบัน")
        //   transport_telephone = เบอร์ติดต่อ
        await client.query(
          `INSERT INTO ic_trans_shipment (
            doc_no, doc_date, trans_flag, cust_code,
            transport_name, transport_address, transport_telephone, create_date_time_now
          ) VALUES ($1,$2,300,$3,$4,$5,$6,NOW())`,
          [docNo, doc_date, cust_code, shipAddress, shipAddressName, shipTelephone]
        );

        // INSERT DETAIL — line_number เริ่มที่ 1 ใหม่ทุกใบ (ERP นับต่อเอกสาร)
        let line = 0;
        for (const it of chunkItems) {
          if (it.item_type !== '3' && it.item_type !== 3) {
            line++;
            const lineVat = calcOrderLineVat(it, taxTypeMap, safeVatType, safeVatRate);
            const detailDiscountAmount = calcDetailDiscountAmount(it, safeVatType, safeVatRate);
            await client.query(
              `INSERT INTO ic_trans_detail (
                set_ref_line,set_ref_price,set_ref_qty,item_type,item_code_main,ref_guid,
                price_set_ratio,inquiry_type,vat_type,trans_type,trans_flag,doc_date,doc_no,
                cust_code,branch_code,sale_code,item_code,item_name,unit_code,qty,price,sum_amount,line_number,
                remark,wh_code,shelf_code,stand_value,divide_value,ratio,doc_time,doc_date_calc,
                discount,discount_amount,barcode,calc_flag,
                tax_type,sum_amount_exclude_vat,total_vat_value,price_exclude_vat,is_permium
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)`,
              [
                '', toNumber(it.price, 0), 0,  // set_ref_price = price (Java bindDetail setRefPrice=price)
                0, '', '',
                0, safeInquiryType, safeVatType, 2, 300,
                doc_date, docNo, cust_code, branch_code, emp_code,
                it.item_code, it.item_name, it.unit_code,
                toNumber(it.qty, 0), toNumber(it.price, 0),
                lineVat.sumAmount, line,
                mergePreorderRemark(it.remark, orderIsPreorder), it.wh_code || '', it.shelf_code || '',
                toNumber(it.stand_value, 0), toNumber(it.divide_value, 0),
                0,
                doc_time, doc_date, it.discount || '', detailDiscountAmount,
                it.barcode || '', 1,
                lineVat.taxType, lineVat.sumAmountExcludeVat, lineVat.vatValue, lineVat.priceExcludeVat,
                premiumFlagValue(it),
              ]
            );
          } else {
            // Product set
            const guid = uuidv4();
            line++;
            const lineVat = calcOrderLineVat(it, taxTypeMap, safeVatType, safeVatRate);
            const detailDiscountAmount = calcDetailDiscountAmount(it, safeVatType, safeVatRate);
            await client.query(
              `INSERT INTO ic_trans_detail (
                set_ref_line,set_ref_price,set_ref_qty,item_type,item_code_main,ref_guid,
                price_set_ratio,inquiry_type,vat_type,trans_type,trans_flag,doc_date,doc_no,
                cust_code,branch_code,sale_code,item_code,item_name,unit_code,qty,price,sum_amount,line_number,
                remark,wh_code,shelf_code,stand_value,divide_value,ratio,doc_time,doc_date_calc,
                discount,discount_amount,barcode,calc_flag,
                tax_type,sum_amount_exclude_vat,total_vat_value,price_exclude_vat,is_permium
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)`,
              [
                '', 0, 0,
                3, '', guid,
                0, safeInquiryType, safeVatType, 2, 300,
                doc_date, docNo, cust_code, branch_code, emp_code,
                it.item_code, it.item_name, it.unit_code,
                toNumber(it.qty, 0), toNumber(it.price, 0),
                lineVat.sumAmount, line,
                mergePreorderRemark(it.remark, orderIsPreorder), it.wh_code || '', it.shelf_code || '',
                toNumber(it.stand_value, 0), toNumber(it.divide_value, 0),
                0,
                doc_time, doc_date, it.discount || '', detailDiscountAmount,
                it.barcode || '', 1,
                lineVat.taxType, lineVat.sumAmountExcludeVat, lineVat.vatValue, lineVat.priceExcludeVat,
                premiumFlagValue(it),
              ]
            );

            const subs = it.sub_item || [];
            for (const sub of subs) {
              line++;
              const qty = toNumber(it.qty, 0) * toNumber(sub.qty, 0);
              const sum_amt = toNumber(sub.price, 0) * qty;
              const lineVat = calcOrderLineVat(sub, taxTypeMap, safeVatType, safeVatRate, {
                qty,
                sumAmount: sum_amt,
              });
              const detailDiscountAmount = calcDetailDiscountAmount(sub, safeVatType, safeVatRate);
              await client.query(
                `INSERT INTO ic_trans_detail (
                  set_ref_line,set_ref_price,set_ref_qty,item_type,item_code_main,ref_guid,
                  price_set_ratio,inquiry_type,vat_type,trans_type,trans_flag,doc_date,doc_no,
                  cust_code,branch_code,sale_code,item_code,item_name,unit_code,qty,price,sum_amount,line_number,
                  remark,wh_code,shelf_code,stand_value,divide_value,ratio,doc_time,doc_date_calc,
                  discount,discount_amount,barcode,calc_flag,
                  tax_type,sum_amount_exclude_vat,total_vat_value,price_exclude_vat,is_permium
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)`,
                [
                  guid, toNumber(sub.price, 0), toNumber(sub.qty, 0),
                  0, it.item_code, '',
                  toNumber(sub.price_ratio, 0), safeInquiryType, safeVatType, 2, 300,
                  doc_date, docNo, cust_code, branch_code, emp_code,
                  sub.item_code, sub.item_name, sub.unit_code,
                  qty, toNumber(sub.price, 0),
                  lineVat.sumAmount, line,
                  mergePreorderRemark(sub.remark || it.remark, orderIsPreorder), it.wh_code || '', it.shelf_code || '',
                  1, 1,
                  0,
                  doc_time, doc_date, sub.discount || '', detailDiscountAmount,
                  sub.barcode || '', 1,
                  lineVat.taxType, lineVat.sumAmountExcludeVat, lineVat.vatValue, lineVat.priceExcludeVat,
                  premiumFlagValue(sub),
                ]
              );
            }
          }
        }
      } // insertOrderDocument

      // lock ที่ 2: ออกเลขเอกสาร — จับตรงนี้เท่านั้น หลัง expand/validate/split เสร็จแล้ว
      // เพราะ lock นี้ global ต่อวัน ถ้าจับก่อนหน้าจะทำให้ checkout ทั้งระบบต่อคิวกัน (REQ4)
      const mainDocNo = await resolveMainDocNo(client, { pattern: 'MPRYYMMDD######', docDate: doc_date, transFlag: 300 });
      const subDocNos = docChunks.map((_, i) => formatSubDocNo(mainDocNo, i + 1, docChunks.length));

      for (let i = 0; i < docChunks.length; i++) {
        // ยอดรวมคำนวณใหม่ต่อใบ เพื่อให้ header ของแต่ละใบ = ผลรวม detail ของใบนั้นจริง
        // discount_word ลงใบแรกใบเดียว — ถ้าส่งทุกใบจะกลายเป็นลดซ้ำเท่าจำนวนใบ
        const chunkTotals = summarizeOrderVat(
          docChunks[i].items,
          taxTypeMap,
          safeVatType,
          safeVatRate,
          i === 0 ? discount_word : '',
          safeDiscountType,
          safeDiscountVatType
        );
        await insertOrderDocument(subDocNos[i], docChunks[i].items, chunkTotals);
      }

      const response = {
        duplicate: false,
        doc_no: mainDocNo,
        main_doc_no: mainDocNo,
        sub_doc_nos: subDocNos,
        doc_count: subDocNos.length,
        doc_date,
        doc_time,
        is_preorder: orderIsPreorder,
        request_id: requestId,
        trans_flag: 300,
        status: 'pending',
      };

      // เก็บ lifecycle/เลข QT ที่จอง และ response สำหรับ idempotent retries
      await client.query(
        `INSERT INTO marketplace_pending_order (doc_no,request_id,cust_code,doc_source,reserved_qt_no,metadata)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [mainDocNo, requestId, cust_code, docSource, serverIssuesDocNo ? null : doc_no,
          JSON.stringify(requestMetadata(expandedItems, discount_word, safeDiscountType, safeDiscountVatType))]);
      await client.query(
        `INSERT INTO marketplace_order_request (request_id, cust_code, response_json)
         VALUES ($1,$2,$3) ON CONFLICT (request_id) DO NOTHING`,
        [requestId, cust_code, JSON.stringify(response)]
      );

      return response;
    });

    return res.json({ success: true, ...saveResult, duplicate: !!saveResult?.duplicate });
  } catch (ex) {
    if (ex.statusCode && !ex.code) return res.status(ex.statusCode).json({ success: false, message: ex.message });
    if (ex.message === 'duplicate_doc_no_customer_mismatch') {
      return res.status(409).json({
        success: false,
        msg: 'duplicate_doc_no_customer_mismatch',
        message: 'เลขที่เอกสารนี้ถูกใช้กับลูกค้ารายอื่นแล้ว กรุณาลองบันทึกคำสั่งซื้ออีกครั้ง'
      });
    }
    if (ex.code === 'ORDER_STOCK_PREORDER_INVALID') {
      return res.status(ex.statusCode || 409).json({
        success: false,
        msg: ex.code,
        message: ex.message,
        stock_issues: ex.stockIssues || [],
      });
    }
    if (ex.code === 'SALE_PREMIUM_DISABLED') {
      return res.status(ex.statusCode || 400).json({
        success: false,
        msg: ex.code,
        message: ex.message,
      });
    }
    if (ex.code === 'ORDER_ITEM_GROUP_TOO_LARGE') {
      return res.status(ex.statusCode || 400).json({
        success: false,
        msg: ex.code,
        message: ex.message,
        item_code: ex.item_code || '',
        line_count: ex.line_count || 0,
        max_lines: ex.max_lines || 0,
      });
    }
    if (ex.code === 'ORDER_MAX_ALLOWANCE_EXCEEDED') {
      return res.status(ex.statusCode || 400).json({
        success: false,
        msg: ex.code,
        message: ex.message,
        max_allowance_violations: ex.violations || [],
      });
    }
    if (ex.code === 'ORDER_CUSTOMER_NOT_FOUND') {
      return res.status(ex.statusCode || 400).json({
        success: false,
        msg: ex.code,
        message: ex.message,
      });
    }
    if (ex.code === 'ORDER_PRICE_MISMATCH') {
      // ไม่ส่ง server_price กลับไปให้ client — บอกแค่ว่ารายการไหนไม่ตรง
      // เพื่อไม่ให้ผู้โจมตีใช้ endpoint นี้ไล่หาราคาต่ำสุดที่ระบบยอมรับ
      return res.status(ex.statusCode || 409).json({
        success: false,
        msg: ex.code,
        message: ex.message,
        price_mismatch_items: (ex.violations || []).map((v) => ({ item_code: v.item_code, unit_code: v.unit_code })),
      });
    }
    return res.status(400).json({ success: false, msg: ex.message, message: ex.message });
  }
});

// POST /service/v1/pay
router.post('/pay', async (req, res) => {
  const resp = { success: false };
  try {
    let obj = req.body;
    if (typeof obj === 'string') obj = JSON.parse(obj);

    const doc_no_rc = obj.doc_no || '';
    // วันที่/เวลาของใบรับชำระใช้เวลาไทยของ server (REQ6)
    // หมายเหตุ: item.doc_date ในลูปด้านล่างเป็นวันที่ของใบ INV ที่อ้างถึง ต้องคงค่าจาก client ไว้
    // เพราะถูกเขียนเป็น billing_date ซึ่งต้องตรงกับ ic_trans.doc_date ไม่งั้น subquery ยอดค้างชำระ join ไม่ติด
    const doc_time = serverDocTime();
    const cust_code = obj.cust_code || '';
    const doc_date = serverDocDate();
    const wallet_amount = (obj.wallet_amount || '0').toString();
    const total_amount = (obj.total_amount || '0').toString();
    const trans_number = (obj.trans_number || '0').toString();
    const no_approved = (obj.no_approved || '0').toString();
    const emp_code = obj.emp_code || '';
    const creator_code = emp_code;
    const remark = obj.remark || '';
    const branch_code = '00000';
    const docList = obj.doc_detail || [];

    if (docList.length === 0) {
      resp.success = false;
      return res.json(resp);
    }

    // ต้องอยู่ใน transaction เดียวกัน: ถ้าพังหลัง DELETE แต่ก่อน INSERT ใบเสร็จจะหายถาวร
    await withTransaction(async (client) => {
      // DELETE existing records for this doc_no
      await client.query(`DELETE FROM ap_ar_trans_detail WHERE doc_no = $1`, [doc_no_rc]);
      await client.query(`DELETE FROM ap_ar_trans WHERE doc_no = $1`, [doc_no_rc]);
      await client.query(`DELETE FROM cb_trans WHERE doc_no = $1`, [doc_no_rc]);
      await client.query(`DELETE FROM cb_trans_detail WHERE doc_no = $1`, [doc_no_rc]);

      // Loop doc_detail: update ic_trans + insert ap_ar_trans_detail
      for (let i = 0; i < docList.length; i++) {
        const item = docList[i];
        const item_doc_no = item.doc_no || '';
        const item_doc_date = item.doc_date || '';
        const dept_amount = (item.total_amount || '0').toString();

        await client.query(
          `UPDATE ic_trans SET used_status_2='1' WHERE doc_no=$1 AND trans_flag=44`,
          [item_doc_no]
        );

        await client.query(
          `INSERT INTO ap_ar_trans_detail (
            trans_type,trans_flag,doc_date,doc_no,billing_no,billing_date,due_date,
            sum_debt_amount,sum_pay_money,balance_ref,calc_flag,line_number,bill_type
          ) VALUES (2,239,$1,$2,$3,$4,$5,$6,$7,$8,0,$9,'44')`,
          [doc_date, doc_no_rc, item_doc_no, item_doc_date, doc_date,
            dept_amount, dept_amount, dept_amount, i]
        );
      }

      // INSERT ap_ar_trans
      await client.query(
        `INSERT INTO ap_ar_trans (
          trans_type,trans_flag,doc_date,doc_time,doc_no,doc_format_code,
          cust_code,branch_code,total_net_value,creator_code
        ) VALUES (2,239,$1,$2,$3,'EE',$4,$5,$6,$7)`,
        [doc_date, doc_time, doc_no_rc, cust_code, branch_code, total_amount, creator_code]
      );

      // INSERT cb_trans
      await client.query(
        `INSERT INTO cb_trans (
          trans_type,trans_flag,doc_no,doc_date,doc_time,ap_ar_code,pay_type,
          doc_format_code,total_amount,total_net_amount,total_amount_pay,wallet_amount,branch_code
        ) VALUES (2,239,$1,$2,$3,$4,1,'EE',$5,$6,$7,$8,$9)`,
        [doc_no_rc, doc_date, doc_time, cust_code, total_amount, wallet_amount, wallet_amount, wallet_amount, branch_code]
      );

      // INSERT cb_trans_detail
      await client.query(
        `INSERT INTO cb_trans_detail (
          trans_type,trans_flag,doc_no,doc_date,doc_time,trans_number,credit_card_type,
          amount,sum_amount,doc_type,ap_ar_code,trans_number_type,ap_ar_type,ref1,no_approved
        ) VALUES (2,239,$1,$2,$3,$4,'NONE',$5,$6,'21',$7,1,1,$8,$9)`,
        [doc_no_rc, doc_date, doc_time, trans_number, wallet_amount, wallet_amount, cust_code, doc_no_rc, no_approved]
      );

    });

    resp.success = true;
    resp.msg = 'success';

    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// POST /service/v1/cancelOrder
router.post('/cancelOrder', async (req, res) => {
  const resp = { success: false };
  try {
    let obj = req.body;
    if (typeof obj === 'string') obj = JSON.parse(obj);
    if (!obj) obj = {};

    // วันที่/เวลาใบยกเลิกใช้เวลาไทยของ server (REQ6)
    const docDateStr = serverDocDate();
    const docTime = serverDocTime();
    // obj.doc_no ที่ client เก่าส่งมา (MSOC + เลขสุ่ม) ถูกเมิน — เลขใบยกเลิกออกจาก server เสมอ
    // ไม่ผูกกับ order_doc_source เพราะนั่นคุมเลข "คำสั่งซื้อ" คนละชุด running กัน
    // doc_ref = "เลขหลัก" ที่ลูกค้าเห็น — อาจครอบเอกสารย่อยหลายใบ (REQ4)
    const docRefMain = String(obj.doc_ref || '').trim();
    const custCode = obj.cust_code || '';
    const empCode = obj.emp_code || '';
    const remark = obj.remark || '';
    const sendTypeStr = obj.send_type || '0';

    if (!docRefMain || !custCode) {
      return res.status(400).send('{ERROR: doc_ref, cust_code are required}');
    }
    if (!isValidDocNoParam(docRefMain)) {
      return res.status(400).send('{ERROR: invalid doc_ref}');
    }

    const result = await withTransaction(async (client) => {
      // 0) ⚠️ ล็อกก่อนอ่าน state — ไม่งั้นสอง request ที่มาพร้อมกันจะเห็น "ยังไม่ยกเลิก" ทั้งคู่
      //    แล้วสร้างใบยกเลิกคนละใบ ยิงพร้อมกัน 2 ครั้งได้ 2 ใบ (3 ครั้งได้ 3 ใบ)
      //    ยอดยกเลิกเข้า ERP เป็นทวีคูณของคำสั่งซื้อจริง — 20 บาทกลายเป็น 40
      //    advisory lock ที่มีอยู่เดิมอยู่ใน resolveMainDocNo (ขั้นที่ 4) ซึ่งจับหลังอ่าน state
      //    ไปแล้ว จึงกันได้แค่ "เลขซ้ำ" ไม่ได้กัน "ใบซ้ำ"
      //    ล็อกตามคู่ ลูกค้า+กลุ่มเอกสาร เหมือนที่ sendorder ล็อกตาม request_id เป็นอย่างแรก
      //    ⚠️ ต้องใช้ docGroupKey ไม่ใช่ค่าดิบ ไม่งั้นยิงเลขหลักพร้อมเลขย่อยจะได้คนละล็อก
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`cancelOrder:${custCode}:${docGroupKey(docRefMain)}`]);

      // 1) หาเอกสารย่อยทั้งหมดของกลุ่ม — เลขหลักใบเดียวก็เข้าเงื่อนไขนี้ (สาขาแรกของ prefix condition)
      const qtRes = await client.query(
        `SELECT doc_no, doc_date, inquiry_type, vat_type,
          COALESCE(branch_code,'') AS branch_code,
          COALESCE(sale_code,'') AS sale_code,
          COALESCE(send_type,0) AS send_type,
          COALESCE(send_day,0) AS send_day,
          COALESCE(send_date, doc_date) AS send_date,
          COALESCE(credit_day,0) AS credit_day,
          COALESCE(credit_date, doc_date) AS credit_date,
          COALESCE(vat_rate,0) AS vat_rate,
          COALESCE(total_value,0) AS total_value,
          COALESCE(total_discount,0) AS total_discount,
          COALESCE(total_vat_value,0) AS total_vat_value,
          COALESCE(total_after_vat,0) AS total_after_vat,
          COALESCE(total_except_vat,0) AS total_except_vat,
          COALESCE(total_amount,0) AS total_amount,
          COALESCE(total_before_vat,0) AS total_before_vat,
          COALESCE(last_status,0) AS last_status
        FROM ic_trans t
        WHERE ${docNoPrefixCondition('t', 1)} AND trans_flag=30 AND doc_format_code='QT' AND cust_code=$2
        ORDER BY doc_no`,
        [docRefMain, custCode]
      );

      if (qtRes.rows.length === 0) return { msg: 'ref_doc_not_found' };

      // 2) ใบที่ยกเลิกไปแล้วให้ข้าม แล้วยกเลิกเฉพาะใบที่เหลือ
      //    (กันเคสรอบก่อนพังกลางทาง หรือ ERP ยกเลิกไปบางใบแล้ว)
      // ไม่บังคับ doc_format_code='SOC' — ใบยกเลิกที่เข้ามาทางอื่น (import/REST) อาจไม่ได้ตั้งค่านี้
      // แล้ว guard จะมองไม่เห็นว่ายกเลิกไปแล้ว กลายเป็นยกเลิกซ้ำ ยอดเข้า ERP เป็นสองเท่า
      // (ข้อมูลจริง 218/218 ใบเป็น SOC อยู่แล้ว การผ่อนเงื่อนไขจึงไม่กระทบของเดิม)
      const cancelledRs = await client.query(
        `SELECT DISTINCT doc_ref FROM ic_trans
         WHERE trans_flag=31 AND doc_ref = ANY($1)`,
        [qtRes.rows.map((r) => r.doc_no)]
      );
      const cancelledRefs = new Set(cancelledRs.rows.map((r) => String(r.doc_ref)));
      const targets = qtRes.rows.filter(
        (r) => toInt(r.last_status, 0) !== 1 && !cancelledRefs.has(String(r.doc_no))
      );
      if (targets.length === 0) return { msg: 'already_cancelled' };

      // 2.5) 🚨 ใบที่ ERP ดึงไปทำเอกสารขั้นถัดไปแล้ว ห้ามยกเลิกจากหน้าร้าน
      //      เดิมตรวจแค่ "ยกเลิกไปแล้วหรือยัง" ลูกค้าจึงยิงยกเลิกใบที่จัดของแล้ว
      //      ออกบิลแล้ว หรือรับเงินไปแล้วได้ ERP จะได้ใบยกเลิกของบิลที่ปิดไปแล้ว
      //      (หน้าจอซ่อนปุ่มไว้ แต่ API เปิดโล่ง ยิงตรงเข้ามาได้)
      //      ทั้งกลุ่มถือเป็นคำสั่งซื้อเดียว ใบไหนเดินไปแล้วก็ต้องให้พนักงานจัดการทั้งใบ
      const inProgressRs = await client.query(
        `SELECT ap.billing_no, ap.doc_no, ap.trans_flag
           FROM ap_ar_trans_detail ap
          WHERE ap.trans_flag = 36 AND ap.billing_no = ANY($1)
          LIMIT 1`,
        [qtRes.rows.map((r) => r.doc_no)]
      );
      if (inProgressRs.rows.length > 0) {
        return { msg: 'order_already_in_progress', ref_doc_no: inProgressRs.rows[0].doc_no };
      }

      // 3) ใบที่ไม่มีรายการสินค้าถือว่าข้อมูลไม่สมบูรณ์ ไม่ยกเลิกให้
      const detailRs = await client.query(
        'SELECT DISTINCT doc_no FROM ic_trans_detail WHERE doc_no = ANY($1)',
        [targets.map((r) => r.doc_no)]
      );
      const hasDetail = new Set(detailRs.rows.map((r) => String(r.doc_no)));
      if (targets.every((r) => !hasDetail.has(String(r.doc_no)))) {
        return { msg: 'ref_doc_has_no_detail' };
      }

      // 4) ออกเลขใบยกเลิก (BSC) — advisory lock อยู่ใน resolveMainDocNo กันเลขซ้ำ
      const socMain = await resolveMainDocNo(client, {
        pattern: await getCancelDocPattern(client),
        docDate: docDateStr,
        transFlag: 31,
      });

      const socDocNos = [];
      for (let i = 0; i < targets.length; i++) {
        const qt = targets[i];
        const socDocNo = formatSubDocNo(socMain, i + 1, targets.length);
        socDocNos.push(socDocNo);

        // 5) Insert SOC header — 1 ใบต่อ QT ย่อย 1 ใบ (ยอดของใบนั้นตรงกับ detail ของใบนั้น)
        const saleCode = (!empCode) ? qt.sale_code : empCode;
        const sendType = toInt(sendTypeStr, 0) || toInt(qt.send_type, 0);

        await client.query(
          `INSERT INTO ic_trans (
            trans_type,trans_flag,doc_date,doc_no,doc_ref,doc_ref_date,
            tax_doc_no,tax_doc_date,inquiry_type,vat_type,cust_code,branch_code,
            sale_code,send_type,send_day,send_date,credit_day,credit_date,
            vat_rate,total_value,total_discount,total_vat_value,total_after_vat,
            total_except_vat,total_amount,total_before_vat,
            remark,doc_time,doc_format_code,creator_code
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
          [
            2, 31, docDateStr, socDocNo, qt.doc_no, qt.doc_date,
            socDocNo, docDateStr,
            qt.inquiry_type, qt.vat_type, custCode, qt.branch_code,
            saleCode, sendType, qt.send_day, qt.send_date, qt.credit_day, qt.credit_date,
            qt.vat_rate, qt.total_value, qt.total_discount, qt.total_vat_value, qt.total_after_vat,
            qt.total_except_vat, qt.total_amount, qt.total_before_vat,
            remark, docTime, 'SOC', custCode,
          ]
        );

        // 6) Copy detail QT -> SOC (filter ด้วยเลขย่อยตรงตัว)
        await client.query(
          `INSERT INTO ic_trans_detail (
            trans_type,trans_flag,doc_date,doc_no,doc_ref,cust_code,inquiry_type,
            item_code,item_name,unit_code,qty,price,discount,sum_amount,remark,line_number,
            branch_code,wh_code,shelf_code,stand_value,divide_value,ratio,vat_type,
            set_ref_line,set_ref_price,set_ref_qty,item_type,item_code_main,ref_guid,
            doc_time,doc_date_calc,discount_amount,price_set_ratio,sale_code,
            calc_flag,tax_type,sum_amount_exclude_vat,total_vat_value,price_exclude_vat,is_permium
          )
          SELECT
            trans_type,$1 AS trans_flag,$2 AS doc_date,$3 AS doc_no,'' AS doc_ref,cust_code,inquiry_type,
            item_code,item_name,unit_code,qty,price,discount,sum_amount,remark,line_number,
            branch_code,wh_code,shelf_code,stand_value,divide_value,ratio,vat_type,
            set_ref_line,set_ref_price,set_ref_qty,item_type,item_code_main,ref_guid,
            $4 AS doc_time,$5 AS doc_date_calc,discount_amount,price_set_ratio,sale_code,
            -- ค่าภาษีและธงของแถมต้องตามไปด้วย ไม่งั้นใบยกเลิกจะกลายเป็นยอดไม่มี VAT
            -- และ ERP อธิบายไม่ได้ว่าแถวราคา 0 คือของแถม (ของเดิมตกทั้ง 6 คอลัมน์)
            calc_flag,tax_type,sum_amount_exclude_vat,total_vat_value,price_exclude_vat,COALESCE(is_permium,0)
          FROM ic_trans_detail
          WHERE doc_no=$6
          ORDER BY line_number`,
          [31, docDateStr, socDocNo, docTime, docDateStr, qt.doc_no]
        );

        // 7) Update QT last_status = 1
        await client.query(
          'UPDATE ic_trans SET last_status=1 WHERE doc_no=$1 AND trans_flag=30',
          [qt.doc_no]
        );
      }

      return {
        success: true,
        msg: 'success',
        cancel_doc_no: socMain,
        cancel_doc_nos: socDocNos,
        ref_doc_no: docRefMain,
        ref_doc_nos: targets.map((r) => r.doc_no),
      };
    });

    if (result.msg === 'order_already_in_progress') {
      return res.status(409).json({
        ...resp,
        ...result,
        message: 'คำสั่งซื้อนี้ถูกจัดสินค้าแล้ว ยกเลิกเองไม่ได้ กรุณาติดต่อพนักงาน',
      });
    }

    return res.json({ ...resp, ...result });
  } catch (ex) {
    console.error('cancelOrder error:', ex.message);
    return res.status(400).send('{ERROR: ' + ex.message + '}');
  }
});

// Shared SQL for order history (same CTE used in getOrderHistory and getOrderHeader)
//
// custPredicate ถูกต่อเข้า SQL ตรงๆ จึงรับได้เฉพาะข้อความคงที่ที่เขียนไว้ในไฟล์นี้เท่านั้น
// ห้ามส่งค่าจาก req เข้ามาเด็ดขาด — ค่าจากผู้ใช้ต้องไปทาง $n เสมอ
function orderHistoryCte(custPredicate = 'ic_qt.cust_code = $1') {
  return `
SELECT DISTINCT *
FROM (
  SELECT
    -- เลขหลักที่ลูกค้าเห็น: เอกสารย่อย BSW...-1/-2 ยุบเป็นเลขเดียว ส่วนเลขเก่าคืนค่าเดิม (REQ4)
    ${MAIN_DOC_NO_SQL('ic_qt')} AS main_doc_no,
    CASE
      WHEN COALESCE(ap_inv.doc_no,'') <> ''
        AND EXISTS (SELECT 1 FROM sml_doc_images di WHERE di.image_id = ap_inv.doc_no AND di.image_file IS NOT NULL)
      THEN ap_inv.doc_no
      ELSE ic_qt.doc_no
    END AS delivery_image_doc_no,
    COALESCE((
      SELECT COUNT(*)::int
      FROM sml_doc_images di
      WHERE di.image_id = CASE
        WHEN COALESCE(ap_inv.doc_no,'') <> ''
          AND EXISTS (SELECT 1 FROM sml_doc_images dx WHERE dx.image_id = ap_inv.doc_no AND dx.image_file IS NOT NULL)
        THEN ap_inv.doc_no
        ELSE ic_qt.doc_no
      END
      AND di.image_file IS NOT NULL
    ),0) AS delivery_image_count,
    COALESCE(ic_inv.remark_5,'') AS remark_5,
    -- ยอดที่ออกบิลจริง — ERP ตัดรายการทิ้งได้ตอนออกใบส่งของ ยอดบิลจึงน้อยกว่ายอดที่สั่งได้
    COALESCE(ic_inv.total_amount,0) AS invoiced_amount,
    COALESCE(ap_so.doc_no,'') AS so_doc_no,
    COALESCE(ap_inv.doc_no,'') AS inv_doc_no,
    COALESCE(ap_inv.doc_date::text,'') AS inv_doc_date,
    COALESCE(ap_ar_cb.wallet_amount,0) AS wallet_amount,
    COALESCE(ic_qt.remark,'') AS remark_qt,
    COALESCE(ic_soc.remark,'') AS remark_cancel,
    COALESCE(ap_inv.remark,'') AS remark_inv,
    -- ⚠️ ต้อง ::text — คอลัมน์ date ถูก pg แปลงเป็น JS Date ที่เที่ยงคืนเวลาไทย
    --    พอ JSON.stringify ออกไปเป็น UTC จะกลายเป็น 17:00 ของ "วันก่อนหน้า"
    --    หน้าจอที่ตัด 10 ตัวแรกจึงแสดงวันย้อนหลัง 1 วันทุกใบ (เห็นบนหน้าประวัติจริง)
    --    และ orderHistoryAggregate ที่เทียบด้วย String(doc_date) ก็เทียบผิดไปด้วย
    --    (inv_doc_date ในไฟล์นี้ใช้ ::text ถูกอยู่แล้ว ทำให้เหมือนกันทั้งไฟล์)
    ic_qt.doc_no, ic_qt.doc_date::text AS doc_date, ic_qt.doc_time, ic_qt.cust_code,
    ic_qt.send_type, ic_qt.sale_code AS emp_code,
    -- วันส่งที่ลูกค้าเห็น: เอาจากเอกสารล่าสุดในสายงานเสมอ (INV > SO > QT)
    -- ตอนสั่งซื้อลูกค้าไม่ได้เลือกวันแล้ว เซลส์เป็นคนระบุตอน process SO
    COALESCE(ic_inv.send_date, ic_so.send_date, ic_qt.send_date)::text AS send_date,
    -- แยกไว้ให้ฝั่งหน้าเว็บรู้ว่าวันนี้มาจากเอกสารจริงหรือยังเป็นค่าที่ลูกค้ากรอกไว้
    CASE WHEN COALESCE(ic_inv.send_date, ic_so.send_date) IS NOT NULL THEN 1 ELSE 0 END AS send_date_confirmed,
    COALESCE((SELECT name_1 FROM erp_user WHERE UPPER(code)=UPPER(ic_qt.sale_code) LIMIT 1),'') AS emp_name,
    ic_qt.total_amount - COALESCE(cn.cn_total_amount,0) AS total_amount,
    COALESCE(cn.cn_total_amount,0) AS cn_total_amount,
    ic_qt.total_before_vat - COALESCE(cn.cn_total_before_vat,0) AS total_before_vat,
    ic_qt.total_except_vat - COALESCE(cn.cn_total_except_vat,0) AS total_except_vat,
    ic_qt.total_after_vat - COALESCE(cn.cn_total_after_vat,0) AS total_after_vat,
    ic_qt.total_vat_value - COALESCE(cn.cn_total_vat_value,0) AS total_vat_value,
    COALESCE((
      SELECT balance_amount FROM (
        SELECT cust_code, doc_date, credit_date AS due_date, doc_no, trans_flag AS doc_type, used_status, doc_ref AS ref_doc_no, doc_ref_date AS ref_doc_date,
          COALESCE(total_amount,0) AS amount,
          COALESCE(total_amount,0) - (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0) FROM ap_ar_trans_detail WHERE COALESCE(last_status,0)=0 AND trans_flag IN (239) AND ic_trans.doc_no=ap_ar_trans_detail.billing_no AND ic_trans.doc_date=ap_ar_trans_detail.billing_date) AS balance_amount,
          branch_code
        FROM ic_trans WHERE COALESCE(last_status,0)=0 AND trans_flag=44 AND inquiry_type IN (0,2) AND cust_code=ic_qt.cust_code
        UNION ALL
        SELECT cust_code, doc_date, credit_date AS due_date, doc_no, trans_flag AS doc_type, used_status, '' AS ref_doc_no, NULL AS ref_doc_date,
          COALESCE(total_amount,0) AS amount,
          COALESCE(total_amount,0) - (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0) FROM ap_ar_trans_detail WHERE COALESCE(last_status,0)=0 AND trans_flag IN (239) AND ic_trans.doc_no=ap_ar_trans_detail.billing_no AND ic_trans.doc_date=ap_ar_trans_detail.billing_date) AS balance_amount,
          branch_code
        FROM ic_trans WHERE COALESCE(last_status,0)=0 AND trans_flag IN (46,93,95,99,101) AND cust_code=ic_qt.cust_code
        UNION ALL
        SELECT cust_code, doc_date, credit_date AS due_date, doc_no, trans_flag AS doc_type, used_status, '' AS ref_doc_no, NULL AS ref_doc_date,
          -1*COALESCE(total_amount,0) AS amount,
          -1*(COALESCE(total_amount,0) + (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0) FROM ap_ar_trans_detail WHERE COALESCE(last_status,0)=0 AND trans_flag IN (239) AND ic_trans.doc_no=ap_ar_trans_detail.billing_no AND ic_trans.doc_date=ap_ar_trans_detail.billing_date)) AS balance_amount,
          branch_code
        FROM ic_trans WHERE COALESCE(last_status,0)=0 AND ((trans_flag=48 AND inquiry_type IN (0,2,4)) OR trans_flag IN (97,103)) AND cust_code=ic_qt.cust_code
      ) AS xx WHERE balance_amount <> 0 AND doc_no = ap_ar.billing_no ORDER BY cust_code, doc_date, doc_no LIMIT 1
    ),0) AS balance,
    CASE
      WHEN ic_soc.doc_no IS NOT NULL OR ic_ssc.doc_no IS NOT NULL THEN 'cancel'
      WHEN ap_ar.doc_no IS NOT NULL OR cb_inv.total_amount_pay > 0 THEN 'success'
      WHEN ap_ar.doc_no IS NULL AND ap_inv.doc_no IS NOT NULL THEN 'payment'
      WHEN ap_ar.doc_no IS NULL AND ap_inv.doc_no IS NULL AND ap_so.doc_no IS NOT NULL THEN 'packing'
      ELSE 'pending'
    END AS status
  FROM ic_trans ic_qt
  LEFT JOIN ic_trans ic_soc ON ic_soc.doc_ref = ic_qt.doc_no AND ic_soc.trans_flag = 31 
  LEFT JOIN ap_ar_trans_detail ap_so ON ap_so.billing_no = ic_qt.doc_no AND ap_so.trans_flag = 36
  -- ใบสั่งขายตัวจริงใน ic_trans — ap_ar_trans_detail มีแค่เลขอ้างอิง ไม่มีวันส่ง
  -- ต้องใช้อ่าน send_date ที่เซลส์กรอกตอน process SO (รีวิว 260908 สไลด์ 7)
  LEFT JOIN ic_trans ic_so ON ic_so.doc_no = ap_so.doc_no AND ic_so.trans_flag = 36
  LEFT JOIN ic_trans ic_ssc ON ic_ssc.doc_ref = ap_so.doc_no AND ic_ssc.trans_flag = 37
  LEFT JOIN ap_ar_trans_detail ap_inv ON ap_inv.billing_no = ap_so.doc_no AND ap_inv.trans_flag = 44
  LEFT JOIN ic_trans ic_inv ON ic_inv.doc_no = ap_inv.doc_no AND ic_inv.trans_flag = 44
  -- ยอดลดหนี้ (credit note) ของใบกำกับใบนี้
  --
  -- 🚨 เดิมเป็น CTE ชื่อ SUM_CN ที่ join ic_trans x ic_trans_detail ทั้งตาราง
  --    (2.1 ล้านแถว) แล้ว GROUP BY ทุกครั้งที่เรียก แม้จะดึงคำสั่งซื้อแค่ใบเดียว
  --    วัดได้ 3,343ms ต่อครั้ง คิดเป็นเกือบ 100% ของเวลาทั้งหมดของหน้าประวัติคำสั่งซื้อ
  --
  --    เปลี่ยนมาดึงเฉพาะใบกำกับของแถวนั้น ใช้ index ic_trans_detail_ref_doc_no_idx ที่มีอยู่แล้ว
  --    วัดกับใบกำกับ 20 ใบ (เท่า 1 หน้า): 1,062ms -> 16ms และค่าตรงกันทุกใบ
  LEFT JOIN LATERAL (
    SELECT SUM(a.total_amount) AS cn_total_amount,
           SUM(a.total_before_vat) AS cn_total_before_vat,
           SUM(a.total_except_vat) AS cn_total_except_vat,
           SUM(a.total_after_vat) AS cn_total_after_vat,
           SUM(a.total_vat_value) AS cn_total_vat_value
      FROM ic_trans_detail b
      JOIN ic_trans a ON a.doc_no = b.doc_no
     WHERE b.ref_doc_no = ic_inv.doc_no
  ) cn ON TRUE
  LEFT JOIN cb_trans cb_inv ON cb_inv.doc_no = ap_inv.doc_no AND ic_inv.trans_flag = 44
  LEFT JOIN ap_ar_trans_detail ap_ar ON ap_ar.billing_no = ap_inv.doc_no AND ap_ar.trans_flag = 239
  LEFT JOIN cb_trans ap_ar_cb ON ap_ar_cb.doc_no = ap_ar.doc_no AND ap_ar_cb.trans_flag = 239
  WHERE ic_qt.trans_flag = 30 AND ${custPredicate}
    ${marketplaceDocWhere('ic_qt')}
    AND COALESCE(ic_qt.approve_code::text,'0') <> '0'
  ORDER BY doc_date DESC
) AS temp WHERE 1=1
`;
}

const ORDER_HISTORY_CTE = orderHistoryCte();

// กุญแจของ "แถวหนึ่งสายเอกสาร" — QT + ใบสั่งขาย + ใบกำกับ
//
// 🚨 ห้ามใช้ doc_no (เลข QT) เพียงอย่างเดียว: พนักงานแตก QT ใบเดียวเป็นใบสั่งขาย
//    หลายใบได้ (ยืนยันกับข้อมูลจริงแล้วว่ามีอยู่) ถ้ายุบเหลือแถวแรกแถวเดียวต่อ QT
//    ใบ SO/INV ที่ 2 ขึ้นไปจะหายเงียบๆ ยอดออกบิลกับสถานะจะเห็นแค่ใบเดียว
//    ส่วน fan-out จริง (ic_trans_shipment 1:N) ยังถูกยุบอยู่ เพราะแถวพวกนั้น
//    มีทั้ง so_doc_no และ inv_doc_no เท่ากัน
function orderRowKey(row) {
  return [row?.doc_no, row?.so_doc_no, row?.inv_doc_no].map((v) => String(v || '')).join('|');
}

function mapOrderRow(r) {
  const status = r.status;
  const balance = toNumber(r.balance, 0);
  return {
    doc_no: r.doc_no,
    doc_date: r.doc_date,
    doc_time: r.doc_time,
    cust_code: r.cust_code,
    send_type: r.send_type,
    send_date: r.send_date,
    send_date_confirmed: toInt(r.send_date_confirmed, 0),
    total_amount: r.total_amount,
    emp_code: r.emp_code,
    emp_name: r.emp_name,
    balance: r.balance,
    remark_qt: r.remark_qt,
    remark_cancel: r.remark_cancel,
    remark_inv: r.remark_inv,
    remark_5: r.remark_5,
    inv_doc_no: r.inv_doc_no,
    inv_doc_date: r.inv_doc_date,
    wallet_amount: r.wallet_amount,
    total_before_vat: r.total_before_vat,
    total_except_vat: r.total_except_vat,
    total_after_vat: r.total_after_vat,
    total_vat_value: r.total_vat_value,
    cn_total_amount: r.cn_total_amount,
    invoiced_amount: toNumber(r.invoiced_amount, 0),
    delivery_image_doc_no: r.delivery_image_doc_no,
    delivery_image_count: toInt(r.delivery_image_count, 0),
    // สถานะเหลือ 4 ระดับ (รีวิว 260908 สไลด์ 8) — ไม่มี 'partial' อีกแล้ว
    // 🚨 ใบที่มีใบเสร็จแต่ยังค้างชำระ = ยังส่งของไม่จบ จึงนับเป็น 'เตรียมนำส่ง-กำลังนำส่ง'
    //    ไม่ใช่ 'จัดส่งสำเร็จ' (ลูกค้ายืนยันตอนรีวิว Phase 5)
    status: (status === 'success' && balance > 0) ? 'payment' : status,
    // ใบย่อยที่ ERP ยกเลิกไปแล้ว — หน้าจอใช้ทำป้ายเตือนและแสดงยอดสุทธิ
    sub_docs: Array.isArray(r.sub_docs) ? r.sub_docs : [],
    sub_doc_count: toInt(r.sub_doc_count, 1),
    mixed_progress: r.mixed_progress === true,
    cancelled_doc_count: toInt(r.cancelled_doc_count, 0),
    cancelled_amount: toNumber(r.cancelled_amount, 0),
    active_amount: toNumber(r.active_amount, toNumber(r.total_amount, 0)),
  };
}

// GET /service/v1/getOrderHistory
router.get('/getOrderHistory', async (req, res) => {
  const { cust_code = '', status = '' } = req.query;
  // 🚨 เดิมตัดที่ 40 คำสั่งซื้อล่าสุดตายตัว ไม่มีทางดูใบเก่ากว่านั้นเลย
  //    ลูกค้าที่มี 73 ใบจึงเข้าถึง 33 ใบเก่าไม่ได้เลย
  //    นับเป็น "คำสั่งซื้อ" (เลขหลัก) ไม่ใช่เอกสารย่อย เหมือนเดิม
  //    ไม่ส่ง page/page_size มา = ได้ 40 ใบแรกเหมือนเดิม client เก่าจึงไม่พัง
  const page = Math.max(1, toInt(req.query.page, 1));
  const pageSize = Math.max(1, Math.min(200, toInt(req.query.page_size, 40)));
  try {
    // 2 ขั้นตอน (REQ4): เดิม LIMIT 40 นับ "แถวเอกสารย่อย" ทำให้คำสั่งซื้อที่ถูกแบ่ง 4 ใบ
    // กินโควตา 4 และถ้าตัดกลางกลุ่ม ยอดรวมที่ลูกค้าเห็นจะขาดหายโดยไม่มี error
    // จึงหา "เลขหลัก" 40 รายการล่าสุดก่อน แล้วค่อยดึงเอกสารย่อยทั้งหมดของกลุ่มนั้น
    const recentRs = await query(
      `SELECT ic_qt.doc_no, ${MAIN_DOC_NO_SQL('ic_qt')} AS main_doc_no,
              ic_qt.doc_date::text AS doc_date, ic_qt.doc_time
         FROM ic_trans ic_qt
        WHERE ic_qt.trans_flag = 30 AND ic_qt.cust_code = $1
          ${marketplaceDocWhere('ic_qt')}
          AND COALESCE(ic_qt.approve_code::text,'0') <> '0'
        ORDER BY ic_qt.doc_date DESC, ic_qt.doc_time DESC`,
      [cust_code]
    );

    // จัดกลุ่มตามเลขหลักก่อน แล้วค่อยตัดหน้า เพื่อไม่ให้กลุ่มถูกตัดกลางแล้วยอดขาด
    const allMain = [];
    const docNosByMain = new Map();
    for (const r of recentRs.rows) {
      const main = String(r.main_doc_no || r.doc_no);
      if (!docNosByMain.has(main)) {
        allMain.push(main);
        docNosByMain.set(main, []);
      }
      docNosByMain.get(main).push(r.doc_no);
    }
    // เลือกสถานะไว้ = ต้องคำนวณสถานะของทุกใบก่อน ถึงจะรู้ว่าเหลือกี่ใบและหน้าไหนมีอะไร
    //   ถ้าตัดหน้าก่อนแล้วค่อยกรอง จะได้หน้าที่ว่างเปล่าทั้งที่ยังมีใบเข้าเงื่อนไขอยู่ข้างหลัง
    //   ไม่เลือกสถานะ = เส้นทางเดิม (ตัดหน้าก่อน) เพราะเร็วกว่ามากและไม่ต้องรู้สถานะ
    // รับหลายสถานะคั่นด้วยจุลภาค เช่น 'packing,payment'
    const statusList = status.split(',').map((x) => x.trim()).filter(Boolean);
    const filterByStatus = statusList.length > 0;
    const totalMain = allMain.length;
    const seenMain = filterByStatus ? allMain : allMain.slice((page - 1) * pageSize, page * pageSize);

    const wantedDocNos = seenMain.flatMap((main) => docNosByMain.get(main) || []);
    if (wantedDocNos.length === 0) {
      return res.json({ success: true, data: [], page, page_size: pageSize, total_orders: totalMain });
    }

    // filter สถานะย้ายมาทำใน JS หลัง aggregate เพราะสถานะรวมคำนวณจากทุกใบในกลุ่ม
    // (ผลพลอยได้: ไม่ต้อง interpolate status เข้า SQL อีกต่อไป)
    const sql = ORDER_HISTORY_CTE + ' AND doc_no = ANY($2::text[]) ORDER BY doc_date DESC, doc_time DESC';
    const result = await query(sql, [cust_code, wantedDocNos]);

    // กัน fan-out จาก join 1:N (ic_trans_shipment) โดยไม่ทิ้งใบสั่งขายใบที่ 2 — ดู orderRowKey()
    const firstRowByDocNo = new Map();
    for (const row of result.rows) {
      const key = orderRowKey(row);
      if (!firstRowByDocNo.has(key)) firstRowByDocNo.set(key, row);
    }

    const grouped = aggregateOrderRowsByMainDoc([...firstRowByDocNo.values()]);

    // เทียบสถานะตรงๆ ได้แล้ว — ไม่ต้องแยก partial/success ด้วยยอดค้างอีก
    // (เดิมต้องแยกเพราะ 'partial' ไม่ได้มาจาก SQL แต่คำนวณจาก balance ใน JS)
    const matched = [];
    for (const r of grouped) {
      const mapped = mapOrderRow(r);
      if (!filterByStatus || statusList.includes(mapped.status)) matched.push(mapped);
    }

    // กรองสถานะ = จำนวนจริงคือจำนวนที่ผ่านตัวกรอง และต้องตัดหน้าหลังกรอง
    //   เดิมส่ง total_orders ของทั้งหมดกลับไปเสมอ หน้าจอจึงโชว์ปุ่มหน้าถัดไปที่กดแล้วว่าง
    const totalOrders = filterByStatus ? matched.length : totalMain;
    const data = filterByStatus ? matched.slice((page - 1) * pageSize, page * pageSize) : matched;

    // ส่งข้อมูลหน้าไปด้วยเสมอ client เก่าที่อ่านแค่ data ไม่กระทบ
    return res.json({ success: true, data, page, page_size: pageSize, total_orders: totalOrders });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/admin/orders
//
// หน้าหลังบ้าน "คำสั่งซื้อ" — ดูคำสั่งซื้อทุกใบที่เข้ามา ไม่จำกัดลูกค้า
// (ฝั่งลูกค้าดูของตัวเองที่ /getOrderHistory ซึ่งบังคับ cust_code เสมอ)
//
// ค้นหาได้ด้วยรหัสลูกค้า ชื่อลูกค้า หรือเลขที่คำสั่งซื้อ ในช่องเดียว
// ช่วงวันที่ไม่ส่งมา = ย้อนหลัง 7 วันนับรวมวันนี้ (ดู utils/adminOrderFilters)
router.get('/admin/orders', requireAdmin('admin.orders'), async (req, res) => {
  const search = String(req.query.search || '').trim();
  // แท็บสถานะ — ค่าจาก mapOrderRow: pending/packing/payment/success/cancel
  // ว่าง = ทุกสถานะ ค่าที่ไม่รู้จักถือเป็นว่าง (กัน filter เงียบแล้วได้ 0 ใบแบบงงๆ)
  const KNOWN_STATUSES = ['pending', 'packing', 'payment', 'success', 'cancel'];
  const statusRaw = String(req.query.status || '').trim();
  const statusFilter = KNOWN_STATUSES.includes(statusRaw) ? statusRaw : '';
  const page = Math.max(1, toInt(req.query.page, 1));
  const pageSize = Math.max(1, Math.min(200, toInt(req.query.page_size, 40)));

  const range = resolveDateRange(req.query.date_from, req.query.date_to, serverDocDate());
  if (range.error) {
    return res.status(400).json({ success: false, ERROR: range.error, message: range.error });
  }

  try {
    // ขั้นที่ 1 — คัดเลขเอกสารด้วย query เบาๆ ก่อน
    //   CTE ประวัติคำสั่งซื้อมี subquery ต่อแถวเยอะมาก ถ้ารันครอบทุกลูกค้าทั้งช่วงวันที่จะช้ามาก
    //   จึงหาว่ามีเอกสารอะไรเข้าเงื่อนไขก่อน แล้วค่อยรัน CTE เฉพาะเลขของหน้าที่จะแสดง
    //   (แนวเดียวกับ getOrderHistory ฝั่งลูกค้า)
    //
    // ⚠️ ต้องจัดกลุ่มด้วย "เลขหลัก" ก่อนตัดหน้า ไม่งั้นคำสั่งซื้อที่ถูกแบ่งเป็นใบย่อย
    //    จะถูกตัดกลางกลุ่ม แล้วยอดที่แอดมินเห็นจะขาดหายโดยไม่มีอะไรฟ้อง
    const like = search ? likeContains(search) : null;
    const listRs = await query(
      `SELECT ic_qt.doc_no, ${MAIN_DOC_NO_SQL('ic_qt')} AS main_doc_no,
              ic_qt.cust_code, COALESCE(cust.name_1,'') AS cust_name,
              -- เบอร์ติดต่อ: เอาจากใบสั่งซื้อก่อน (ลูกค้าอาจกรอกเบอร์ผู้รับคนละเบอร์)
              -- ไม่มีค่อยถอยไปใช้เบอร์ในบัตรลูกค้า
              COALESCE(NULLIF(ship.transport_telephone,''), cust.telephone, '') AS contact_telephone,
              -- ที่อยู่จัดส่งของใบนี้ — transport_name คือข้อความที่อยู่ (mapping ของระบบเดิม)
              COALESCE(ship.transport_name,'') AS ship_address,
              ic_qt.doc_date::text AS doc_date, ic_qt.doc_time
         FROM ic_trans ic_qt
         LEFT JOIN ar_customer cust ON cust.code = ic_qt.cust_code
         LEFT JOIN ic_trans_shipment ship ON ship.doc_no = ic_qt.doc_no
        WHERE ic_qt.trans_flag = 30
          ${marketplaceDocWhere('ic_qt')}
          AND COALESCE(ic_qt.approve_code::text,'0') <> '0'
          AND ic_qt.doc_date BETWEEN $1::date AND $2::date
          AND ($3::text IS NULL
               OR ic_qt.cust_code ILIKE $3
               OR COALESCE(cust.name_1,'') ILIKE $3
               OR ic_qt.doc_no ILIKE $3)
        ORDER BY ic_qt.doc_date DESC, ic_qt.doc_time DESC, ic_qt.doc_no DESC`,
      [range.dateFrom, range.dateTo, like],
    );

    const mainOrder = [];
    const docNosByMain = new Map();
    const custByMain = new Map();
    for (const r of listRs.rows) {
      const main = String(r.main_doc_no || r.doc_no);
      if (!docNosByMain.has(main)) {
        mainOrder.push(main);
        docNosByMain.set(main, []);
        custByMain.set(main, {
          cust_code: r.cust_code,
          cust_name: r.cust_name,
          contact_telephone: r.contact_telephone,
          ship_address: r.ship_address,
        });
      }
      docNosByMain.get(main).push(r.doc_no);
    }

    const base = {
      success: true,
      page,
      page_size: pageSize,
      status: statusFilter,
      date_from: range.dateFrom,
      date_to: range.dateTo,
    };
    if (mainOrder.length === 0) {
      return res.json({ ...base, data: [], total_orders: 0, page_amount: 0, status_counts: {} });
    }

    // ขั้นที่ 2 — รัน CTE ทั้งช่วง (TRUE = ไม่จำกัดลูกค้า)
    //   สถานะรวมของคำสั่งซื้อรู้ได้หลัง aggregate เท่านั้น จึงต้องประมวลทุกใบในช่วง
    //   เพื่อให้ (ก) แท็บมีตัวนับ — โดยเฉพาะ "รอตรวจสอบ" ที่ใช้ดูว่ามีออเดอร์ใหม่
    //   และ (ข) การกรองสถานะแบ่งหน้าได้ถูกต้อง
    //   วัดกับเคสหนักสุด (366 วัน / 5,577 ใบ) = ~1.2s ส่วนช่วง default 7 วันหลักสิบ ms
    const wantedDocNos = mainOrder.flatMap((main) => docNosByMain.get(main) || []);
    const sql = orderHistoryCte('TRUE') + ' AND doc_no = ANY($1::text[]) ORDER BY doc_date DESC, doc_time DESC';
    const result = await query(sql, [wantedDocNos]);

    // กัน fan-out เหมือนฝั่งลูกค้า — เก็บแถวแรกของแต่ละสายเอกสาร (ดู orderRowKey)
    const firstRowByDocNo = new Map();
    for (const row of result.rows) {
      const key = orderRowKey(row);
      if (!firstRowByDocNo.has(key)) firstRowByDocNo.set(key, row);
    }

    const grouped = aggregateOrderRowsByMainDoc([...firstRowByDocNo.values()]);
    const byDocNo = new Map(grouped.map((r) => [String(r.doc_no), r]));

    // เรียงตามลำดับที่คัดมาในขั้นที่ 1 · นับต่อสถานะก่อน แล้วค่อยกรอง
    const statusCounts = {};
    const filtered = [];
    for (const main of mainOrder) {
      const row = byDocNo.get(main);
      if (!row) continue;
      const mapped = mapOrderRow(row);
      statusCounts[mapped.status] = (statusCounts[mapped.status] || 0) + 1;
      if (statusFilter && mapped.status !== statusFilter) continue;
      const cust = custByMain.get(main) || {};
      mapped.cust_name = cust.cust_name || '';
      mapped.contact_telephone = cust.contact_telephone || '';
      mapped.ship_address = cust.ship_address || '';
      filtered.push(mapped);
    }

    const totalOrders = filtered.length;
    const data = filtered.slice((page - 1) * pageSize, page * pageSize);
    const pageAmount = data.reduce((sum, r) => sum + toNumber(r.total_amount, 0), 0);

    return res.json({ ...base, data, total_orders: totalOrders, page_amount: pageAmount, status_counts: statusCounts });
  } catch (ex) {
    console.error('admin/orders error:', ex.message);
    return res.status(400).json({ success: false, ERROR: ex.message });
  }
});

// GET /service/v1/getOrderHeader
router.get('/getOrderHeader', async (req, res) => {
  const { cust_code, doc_no } = req.query;
  if (!cust_code || !doc_no) {
    return res.status(400).send('{ERROR: cust_code and doc_no are required}');
  }
  // กัน % และ _ ที่เป็น wildcard ของ LIKE ในเงื่อนไขค้นเลขหลัก (REQ4)
  if (!isValidDocNoParam(doc_no)) {
    return res.status(400).send('{ERROR: invalid doc_no}');
  }

  try {
    const sql = `
      SELECT * FROM (
        SELECT
          CASE
            WHEN COALESCE(ap_inv.doc_no,'') <> ''
              AND EXISTS (SELECT 1 FROM sml_doc_images di WHERE di.image_id = ap_inv.doc_no AND di.image_file IS NOT NULL)
            THEN ap_inv.doc_no
            ELSE ic_qt.doc_no
          END AS delivery_image_doc_no,
          COALESCE((
            SELECT COUNT(*)::int
            FROM sml_doc_images di
            WHERE di.image_id = CASE
              WHEN COALESCE(ap_inv.doc_no,'') <> ''
                AND EXISTS (SELECT 1 FROM sml_doc_images dx WHERE dx.image_id = ap_inv.doc_no AND dx.image_file IS NOT NULL)
              THEN ap_inv.doc_no
              ELSE ic_qt.doc_no
            END
            AND di.image_file IS NOT NULL
          ),0) AS delivery_image_count,
          COALESCE(ic_inv.remark_5,'') AS remark_5,
          COALESCE(its.transport_name,'') AS address,
          COALESCE(its.transport_telephone,'') AS telephone,
          COALESCE(its.transport_address,'') AS address_name,
          ${MAIN_DOC_NO_SQL('ic_qt')} AS main_doc_no,
          COALESCE(ap_so.doc_no,'') AS so_doc_no,
          COALESCE(ap_inv.doc_no,'') AS inv_doc_no,
          ic_qt.doc_no, ic_qt.doc_date::text AS doc_date, ic_qt.doc_time, ic_qt.cust_code,
          -- ⚠️ ต้อง ::text — คอลัมน์ date ถูก pg แปลงเป็น JS Date ที่เที่ยงคืนเวลาไทย
          --    พอ JSON.stringify ออกไปเป็น UTC จะกลายเป็น 17:00 ของ "วันก่อนหน้า"
          --    หน้าจอที่ตัด 10 ตัวแรกจึงแสดงวันย้อนหลัง 1 วัน — ยิงจริงแล้วเห็นกับตา
          --    (doc_date ใน SELECT เดียวกันนี้ใช้ ::text ถูกอยู่แล้ว แต่ send_date ตกหล่น)
          ic_qt.send_type,
          -- วันส่งจากเอกสารล่าสุดในสายงาน (INV > SO > QT) — ดูคอมเมนต์ใน orderHistoryCte()
          COALESCE(ic_inv.send_date, ic_so.send_date, ic_qt.send_date)::text AS send_date,
          CASE WHEN COALESCE(ic_inv.send_date, ic_so.send_date) IS NOT NULL THEN 1 ELSE 0 END AS send_date_confirmed,
          ic_qt.send_day,
          ic_qt.sale_code AS emp_code,
          COALESCE((SELECT name_1 FROM erp_user WHERE UPPER(code)=UPPER(ic_qt.sale_code) LIMIT 1),'') AS emp_name,
          ic_qt.total_amount, ic_qt.total_before_vat, ic_qt.total_except_vat, ic_qt.total_after_vat, ic_qt.total_vat_value,
          COALESCE((
            SELECT balance_amount FROM (
              SELECT cust_code, doc_date, credit_date AS due_date, doc_no, trans_flag AS doc_type, used_status, doc_ref AS ref_doc_no, doc_ref_date AS ref_doc_date,
                COALESCE(total_amount,0) AS amount,
                COALESCE(total_amount,0) - (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0) FROM ap_ar_trans_detail WHERE COALESCE(last_status,0)=0 AND trans_flag IN (239) AND ic_trans.doc_no=ap_ar_trans_detail.billing_no AND ic_trans.doc_date=ap_ar_trans_detail.billing_date) AS balance_amount,
                branch_code
              FROM ic_trans WHERE COALESCE(last_status,0)=0 AND trans_flag=44 AND (inquiry_type=0 OR inquiry_type=2) AND cust_code=ic_qt.cust_code
              UNION ALL
              SELECT cust_code, doc_date, credit_date AS due_date, doc_no, trans_flag AS doc_type, used_status, '' AS ref_doc_no, NULL AS ref_doc_date,
                COALESCE(total_amount,0) AS amount,
                COALESCE(total_amount,0) - (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0) FROM ap_ar_trans_detail WHERE COALESCE(last_status,0)=0 AND trans_flag IN (239) AND ic_trans.doc_no=ap_ar_trans_detail.billing_no AND ic_trans.doc_date=ap_ar_trans_detail.billing_date) AS balance_amount,
                branch_code
              FROM ic_trans WHERE COALESCE(last_status,0)=0 AND (trans_flag=46 OR trans_flag=93 OR trans_flag=99 OR trans_flag=95 OR trans_flag=101) AND cust_code=ic_qt.cust_code
              UNION ALL
              SELECT cust_code, doc_date, credit_date AS due_date, doc_no, trans_flag AS doc_type, used_status, '' AS ref_doc_no, NULL AS ref_doc_date,
                -1*COALESCE(total_amount,0) AS amount,
                -1*(COALESCE(total_amount,0) + (SELECT COALESCE(SUM(COALESCE(sum_pay_money,0)),0) FROM ap_ar_trans_detail WHERE COALESCE(last_status,0)=0 AND trans_flag IN (239) AND ic_trans.doc_no=ap_ar_trans_detail.billing_no AND ic_trans.doc_date=ap_ar_trans_detail.billing_date)) AS balance_amount,
                branch_code
              FROM ic_trans WHERE COALESCE(last_status,0)=0 AND ((trans_flag=48 AND inquiry_type IN (0,2,4)) OR trans_flag=97 OR trans_flag=103) AND cust_code=ic_qt.cust_code
            ) AS xx WHERE balance_amount <> 0 AND doc_no = ap_ar.billing_no ORDER BY cust_code, doc_date, doc_no LIMIT 1
          ),0) AS balance,
          -- ⚠️ ต้องเรียงเงื่อนไขเหมือน orderHistoryCte() เป๊ะ ไม่งั้นหน้ารายละเอียด
          --    กับหน้าประวัติจะบอกสถานะคนละอย่างสำหรับใบเดียวกัน
          CASE
            WHEN ic_soc.doc_no IS NOT NULL OR ic_ssc.doc_no IS NOT NULL THEN 'cancel'
            WHEN ap_ar.doc_no IS NOT NULL OR cb_inv.total_amount_pay > 0 THEN 'success'
            WHEN ap_ar.doc_no IS NULL AND ap_inv.doc_no IS NOT NULL THEN 'payment'
            WHEN ap_ar.doc_no IS NULL AND ap_inv.doc_no IS NULL AND ap_so.doc_no IS NOT NULL THEN 'packing'
            ELSE 'pending'
          END AS status
        FROM ic_trans ic_qt
        LEFT JOIN ic_trans ic_soc ON ic_soc.doc_ref = ic_qt.doc_no AND ic_soc.trans_flag = 31
        LEFT JOIN ap_ar_trans_detail ap_so ON ap_so.billing_no = ic_qt.doc_no AND ap_so.trans_flag = 36
        LEFT JOIN ic_trans ic_so ON ic_so.doc_no = ap_so.doc_no AND ic_so.trans_flag = 36
        -- ใบยกเลิกใบสั่งขาย (SSC) — เดิมไม่ได้ join ทำให้หน้ารายละเอียดไม่รู้ว่าถูกยกเลิก
        LEFT JOIN ic_trans ic_ssc ON ic_ssc.doc_ref = ap_so.doc_no AND ic_ssc.trans_flag = 37
        LEFT JOIN ap_ar_trans_detail ap_inv ON ap_inv.billing_no = ap_so.doc_no AND ap_inv.trans_flag = 44
        LEFT JOIN ic_trans ic_inv ON ic_inv.doc_no = ap_inv.doc_no AND ic_inv.trans_flag = 44
        -- การจ่ายผ่านสมุดเงินสด — ต้องมีเหมือน orderHistoryCte() ไม่งั้นสถานะไม่ตรงกัน
        LEFT JOIN cb_trans cb_inv ON cb_inv.doc_no = ap_inv.doc_no AND ic_inv.trans_flag = 44
        LEFT JOIN ap_ar_trans_detail ap_ar ON ap_ar.billing_no = ap_inv.doc_no AND ap_ar.trans_flag = 239
        LEFT JOIN ic_trans_shipment its ON its.doc_no = ic_qt.doc_no
        WHERE ic_qt.trans_flag = 30 AND ic_qt.cust_code = $1
          AND ${docNoPrefixCondition('ic_qt', 2)}
          AND COALESCE(ic_qt.approve_code::text,'0') <> '0'
        ORDER BY doc_date DESC
      ) AS temp WHERE 1=1
    `;

    const result = await query(sql, [cust_code, doc_no]);
    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    // 🚨 query นี้ join ap_ar_trans_detail 3 ชั้นและ ic_trans_shipment ซึ่งเป็น 1:N ได้
    //    เอกสารใบเดียวจึงออกมาหลายแถวได้ ของเดิมกันด้วย LIMIT 1 ตอนนี้ต้อง SUM ข้ามใบย่อย
    //    จึงต้องเก็บแถวแรกต่อสายเอกสารก่อน ไม่งั้นยอดจะบวมเป็นเท่า (ดู orderRowKey)
    const firstRowByDocNo = new Map();
    for (const row of result.rows) {
      const key = orderRowKey(row);
      if (!firstRowByDocNo.has(key)) firstRowByDocNo.set(key, row);
    }

    // ยุบเอกสารย่อยเป็นรายการเดียว (REQ4) — เดิม LIMIT 1 จะเห็นแค่ใบแรก ยอดขาด
    const [r] = aggregateOrderRowsByMainDoc([...firstRowByDocNo.values()]);
    const status = r.status;
    const balance = toNumber(r.balance, 0);
    const data = {
      remark_5: r.remark_5,
      doc_no: r.doc_no,
      doc_date: r.doc_date,
      doc_time: r.doc_time,
      cust_code: r.cust_code,
      send_type: r.send_type,
      send_date: r.send_date,
      send_date_confirmed: toInt(r.send_date_confirmed, 0),
      send_day: r.send_day,
      total_amount: r.total_amount,
      emp_code: r.emp_code,
      emp_name: r.emp_name,
      balance: r.balance,
      address: r.address,
      telephone: r.telephone,
      address_name: r.address_name,
      total_before_vat: r.total_before_vat,
      total_except_vat: r.total_except_vat,
      total_after_vat: r.total_after_vat,
      total_vat_value: r.total_vat_value,
      delivery_image_doc_no: r.delivery_image_doc_no,
      delivery_image_count: toInt(r.delivery_image_count, 0),
      // ใบที่ค้างชำระนับเป็น 'เตรียมนำส่ง-กำลังนำส่ง' — ดูคอมเมนต์ใน mapOrderRow
      status: (status === 'success' && balance > 0) ? 'payment' : status,
    };

    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getOrderDetail
router.get('/getOrderDetail', async (req, res) => {
  const { cust_code, doc_no, page, page_size, q } = req.query;
  if (!cust_code || !doc_no) {
    return res.status(400).send('{ERROR: cust_code and doc_no are required}');
  }
  if (!isValidDocNoParam(doc_no)) {
    return res.status(400).send('{ERROR: invalid doc_no}');
  }

  const p = Math.max(1, toInt(page, 1));
  const ps = Math.min(100, Math.max(1, toInt(page_size, 20)));
  const offset = (p - 1) * ps;
  const hasQ = q && q.trim() !== '';
  const qLike = hasQ ? `%${q.trim()}%` : null;

  try {
    const client = await pool.connect();
    try {
      // รับได้ทั้งเลขหลัก (ดึงทุกเอกสารย่อย) และเลขย่อยตรงตัว (REQ4)
      // EXISTS ด้านล่างคงไว้ทั้งดุ้น — เป็นด่านกันลูกค้าอ่านออเดอร์คนอื่น และตรวจต่อใบย่อยถูกต้องอยู่แล้ว
      const baseWhere = `
        FROM ic_trans_detail d
        LEFT JOIN ic_inventory inv ON inv.code = d.item_code
        WHERE ${docNoPrefixCondition('d', 1)}
          AND (d.item_type = 3 OR COALESCE(d.set_ref_line,'') = '')
          AND EXISTS (
            SELECT 1 FROM ic_trans t
            WHERE t.doc_no = d.doc_no
              AND t.trans_flag = 30
              AND t.cust_code = $2
              AND COALESCE(t.approve_code::text,'0') <> '0'
          )
      `;
      const searchClause = `
        AND (d.item_code ILIKE $3
          OR d.item_name ILIKE $3
          OR (d.item_type = 3 AND COALESCE(d.ref_guid,'') <> ''
            AND EXISTS (SELECT 1 FROM ic_trans_detail s
              WHERE s.doc_no = d.doc_no AND s.set_ref_line = d.ref_guid
                AND COALESCE(s.set_ref_line,'') <> ''
                AND (s.item_code ILIKE $3 OR s.item_name ILIKE $3))))
      `;

      // ── ของที่จัดจริง เทียบกับของที่สั่ง ────────────────────────────
      // ร้านแก้ใบสั่งขายได้ 2 ทาง: ใส่ของแถมเพิ่ม หรือตัดรายการที่ของหมดออก
      //   ตัดออก  -> บรรทัดเดิมได้ ship_state='none' (หน้าเว็บขึ้น "ไม่ได้จัด")
      //   เพิ่มมา -> ไม่มีบรรทัดคู่กันในใบ QT จึงต้องต่อท้ายเป็นรายการใหม่
      //              ไม่งั้นลูกค้าไม่เห็นของแถมที่ร้านใส่ให้เลยสักที่
      // เจอจริง 15 ใบจาก 400 ใบ marketplace เช่น MQT20251230-JLX94
      // สั่ง ฿792 แต่ออกบิล ฿660 เพราะของ ฿132 ไม่ได้ส่ง
      const shippedByKey = new Map();
      // สินค้าชิ้นนี้ถูกยกไปอยู่ในใบสั่งขายใบไหน — ใช้ให้หน้าจอบอกสถานะรายบรรทัดได้ถูกใบ
      // QT ใบเดียวแตกเป็นหลายใบสั่งขายที่เดินคนละ step ได้ ถ้าไม่รู้ว่าบรรทัดไหนอยู่ใบไหน
      // ทุกบรรทัดจะโดนป้ายสถานะของใบสุดท้ายเหมือนกันหมด
      const soDocByKey = new Map();
      const shippedLines = [];
      let shipmentAmount = 0;
      let hasShipment = false;
      try {
        const shipRs = await client.query(
          `SELECT sd.doc_no, sd.item_code, sd.item_name, sd.unit_code, sd.qty, sd.price, sd.sum_amount,
                  sd.wh_code, sd.shelf_code, sd.stand_value, sd.divide_value, sd.ratio,
                  sd.item_type, sd.line_number, COALESCE(sd.is_permium,0) AS is_permium,
                  COALESCE(inv.name_eng_1,'') AS name_eng_1
             FROM ap_ar_trans_detail ap
             JOIN ic_trans_detail sd ON sd.doc_no = ap.doc_no
             LEFT JOIN ic_inventory inv ON inv.code = sd.item_code
            WHERE ap.trans_flag = 36
              AND (ap.billing_no = $1 OR ap.billing_no LIKE $1 || '-%')
              AND COALESCE(sd.set_ref_line,'') = ''
            ORDER BY sd.doc_no, sd.line_number`,
          [doc_no],
        );
        hasShipment = shipRs.rows.length > 0;
        for (const r of shipRs.rows) {
          const key = `${r.item_code}|${r.unit_code}`;
          shippedByKey.set(key, toNumber(shippedByKey.get(key), 0) + toNumber(r.qty, 0));
          if (!soDocByKey.has(key)) soDocByKey.set(key, String(r.doc_no || ''));
          shippedLines.push(r);
          // ยอดของที่จัดจริง — ต่างจากยอดที่สั่งได้ทั้งสองทาง (ร้านเพิ่มของแถม / ตัดของที่หมดออก)
          shipmentAmount += toNumber(r.sum_amount, 0);
        }
      } catch (ex) {
        // อ่านของที่จัดจริงไม่ได้ = แค่ไม่มีข้อมูลเสริม ไม่ควรทำให้หน้ารายละเอียดพัง
        console.warn('getOrderDetail shipped qty:', ex.message);
      }

      // คีย์ของทุกบรรทัดในใบสั่งซื้อ (ทุกหน้า ไม่ใช่แค่หน้าที่กำลังดู)
      // ใช้ตัดสินว่าบรรทัดในใบสั่งขายเป็นของที่ร้านเพิ่มเข้ามาหรือไม่
      const orderedKeys = new Set();
      if (shippedLines.length) {
        const keyRs = await client.query(
          `SELECT DISTINCT d.item_code, d.unit_code ${baseWhere}`,
          [doc_no, cust_code],
        );
        for (const r of keyRs.rows) orderedKeys.add(`${r.item_code}|${r.unit_code}`);
      }

      const addedByKey = new Map();
      for (const r of shippedLines) {
        const key = `${r.item_code}|${r.unit_code}`;
        if (orderedKeys.has(key)) continue;
        const prev = addedByKey.get(key);
        if (prev) prev.qty = toNumber(prev.qty, 0) + toNumber(r.qty, 0);
        else addedByKey.set(key, { ...r });
      }
      const needle = hasQ ? q.trim().toLowerCase() : '';
      const addedItems = [...addedByKey.values()]
        .filter((r) => !hasQ
          || String(r.item_code || '').toLowerCase().includes(needle)
          || String(r.item_name || '').toLowerCase().includes(needle))
        .map((r) => ({
          doc_no: r.doc_no,
          qty: r.qty,
          item_code: r.item_code,
          item_name: r.item_name,
          name_eng_1: r.name_eng_1 || '',
          unit_code: r.unit_code,
          wh_code: r.wh_code,
          shelf_code: r.shelf_code,
          stand_value: r.stand_value,
          divide_value: r.divide_value,
          ratio: r.ratio,
          price: r.price,
          sum_amount: r.sum_amount,
          item_type: r.item_type,
          set_ref_line: '',
          ref_guid: '',
          is_permium: toInt(r.is_permium, 0),
          // ธงบอกว่าเป็นของที่ร้านเพิ่มให้ตอนจัดของ ไม่ได้อยู่ในใบสั่งซื้อเดิม
          is_added: 1,
          shipped_qty: toNumber(r.qty, 0),
          ship_state: 'added',
          so_doc_no: String(r.doc_no || ''),
        }));

      // COUNT
      const countSql = `SELECT COUNT(*) AS cnt ${baseWhere} ${hasQ ? searchClause : ''}`;
      const countParams = hasQ ? [doc_no, cust_code, qLike] : [doc_no, cust_code];
      const countResult = await client.query(countSql, countParams);
      // รายการที่ร้านเพิ่มต่อท้ายบรรทัดที่สั่งไว้เสมอ เลยนับรวมเข้าไปในจำนวนหน้าด้วย
      const orderedCount = toInt(countResult.rows[0].cnt, 0);
      const totalItems = orderedCount + addedItems.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / ps));

      // SELECT top-level
      const topSql = `
        SELECT d.doc_no, d.item_code, d.item_name, d.qty, d.unit_code, d.price, d.wh_code, d.shelf_code,
          d.stand_value, d.divide_value, d.ratio, d.sum_amount,
          COALESCE(inv.name_eng_1,'') AS name_eng_1,
          COALESCE(d.is_permium,0) AS is_permium,
          d.item_type, d.set_ref_line, d.ref_guid, d.line_number
        ${baseWhere} ${hasQ ? searchClause : ''}
        ORDER BY d.doc_no, d.line_number
        LIMIT $${hasQ ? 4 : 3} OFFSET $${hasQ ? 5 : 4}
      `;
      const topParams = hasQ
        ? [doc_no, cust_code, qLike, ps, offset]
        : [doc_no, cust_code, ps, offset];

      const topResult = await client.query(topSql, topParams);

      const topItemsArr = [];
      const setMap = {};
      const parentGuids = [];

      for (const r of topResult.rows) {
        const it = {
          // เลขเอกสารย่อยที่บรรทัดนี้อยู่จริงใน ERP — ให้หน้าจอจัดกลุ่มตามใบได้
          doc_no: r.doc_no,
          qty: r.qty,
          item_code: r.item_code,
          item_name: r.item_name,
          name_eng_1: r.name_eng_1 || '',
          unit_code: r.unit_code,
          wh_code: r.wh_code,
          shelf_code: r.shelf_code,
          stand_value: r.stand_value,
          divide_value: r.divide_value,
          ratio: r.ratio,
          price: r.price,
          sum_amount: r.sum_amount,
          item_type: r.item_type,
          set_ref_line: r.set_ref_line,
          ref_guid: r.ref_guid,
          // ป้าย "ของแถม" ใน OrderHistory.vue อ่านค่านี้ ถ้าไม่ส่งออกป้ายจะไม่ขึ้นเลย
          is_permium: toInt(r.is_permium, 0),
        };

        if (toInt(r.item_type, 0) === 3) {
          it.sub_item = [];
          setMap[r.ref_guid] = it;
          parentGuids.push(r.ref_guid);
        }

        topItemsArr.push(it);
      }

      // Fetch sub items
      if (parentGuids.length > 0) {
        const subParamsFinal = [doc_no, ...parentGuids];
        if (hasQ) subParamsFinal.push(qLike);

        // ref_guid unique ข้ามใบอยู่แล้ว แต่ต้องรับเลขหลักด้วยเพราะหัวชุดอาจอยู่คนละใบย่อย (REQ4)
        const subSqlFinal = `
          SELECT d.doc_no, d.item_code, d.item_name, d.qty, d.unit_code, d.price, d.wh_code, d.shelf_code,
            d.stand_value, d.divide_value, d.ratio, d.sum_amount, d.item_type, d.set_ref_line, d.ref_guid, d.line_number,
            COALESCE(d.is_permium,0) AS is_permium,
            COALESCE(inv.name_eng_1,'') AS name_eng_1
          FROM ic_trans_detail d
          LEFT JOIN ic_inventory inv ON inv.code = d.item_code
          WHERE ${docNoPrefixCondition('d', 1)} AND d.set_ref_line IN (${parentGuids.map((_, i) => `$${i + 2}`).join(',')})
          ${hasQ ? `AND (d.item_code ILIKE $${parentGuids.length + 2} OR d.item_name ILIKE $${parentGuids.length + 2})` : ''}
          ORDER BY d.doc_no, d.set_ref_line, d.line_number
        `;

        const subResult = await client.query(subSqlFinal, subParamsFinal);
        for (const r of subResult.rows) {
          const parent = setMap[r.set_ref_line];
          if (!parent) continue;
          parent.sub_item.push({
            qty: r.qty,
            item_code: r.item_code,
            item_name: r.item_name,
            name_eng_1: r.name_eng_1 || '',
            unit_code: r.unit_code,
            wh_code: r.wh_code,
            shelf_code: r.shelf_code,
            stand_value: r.stand_value,
            divide_value: r.divide_value,
            ratio: r.ratio,
            price: r.price,
            sum_amount: r.sum_amount,
            item_type: r.item_type,
            set_ref_line: r.set_ref_line,
            ref_guid: r.ref_guid,
            is_permium: toInt(r.is_permium, 0),
          });
        }
      }

      // ── ของที่ส่งจริง เทียบกับของที่สั่ง ────────────────────────────
      // ERP ตัดรายการทิ้งได้ตอนออกใบส่งของ (ของหมด/ลูกค้าไม่เอาแล้ว)
      // ใบสั่งซื้อยังมีบรรทัดครบเหมือนเดิม บิลจริงจึงน้อยกว่ายอดที่ลูกค้าเห็น
      // เจอจริง 15 ใบจาก 400 ใบ marketplace เช่น MQT20251230-JLX94
      // สั่ง ฿792 แต่ออกบิล ฿660 เพราะของ ฿132 ไม่ได้ส่ง

      if (hasShipment) {
        // รวมจำนวนที่สั่งต่อ (สินค้า+หน่วย) ก่อน เพราะของชิ้นเดียวอาจอยู่หลายบรรทัด/หลายใบย่อย
        const orderedByKey = new Map();
        for (const it of topItemsArr) {
          const key = `${it.item_code}|${it.unit_code}`;
          orderedByKey.set(key, toNumber(orderedByKey.get(key), 0) + toNumber(it.qty, 0));
        }
        const remainByKey = new Map(shippedByKey);
        for (const it of topItemsArr) {
          const key = `${it.item_code}|${it.unit_code}`;
          const ordered = toNumber(it.qty, 0);
          const pool = toNumber(remainByKey.get(key), 0);
          const shipped = Math.min(ordered, pool);
          remainByKey.set(key, pool - shipped);
          it.shipped_qty = shipped;
          it.ship_state = shipped <= 0 ? 'none' : (shipped < ordered ? 'partial' : 'full');
          it.so_doc_no = soDocByKey.get(key) || '';
        }
      }

      // ต่อท้ายด้วยของที่ร้านเพิ่มให้ — วางหลังบรรทัดที่สั่งไว้ทั้งหมด
      // (ต้องมาหลังบล็อกด้านบน ไม่งั้นจะโดนคำนวณ ship_state ทับเป็น 'none')
      if (addedItems.length) {
        const extrasStart = Math.max(0, offset - orderedCount);
        const slots = Math.max(0, ps - topItemsArr.length);
        for (const extra of addedItems.slice(extrasStart, extrasStart + slots)) {
          topItemsArr.push({ ...extra });
        }
      }

      return res.json({
        success: true,
        has_shipment: hasShipment,
        // ยอดตามใบสั่งขายจริง ให้หน้าจอแสดงคู่กับยอดที่ลูกค้าสั่งไว้
        shipment_amount: shipmentAmount,
        paging: { page: p, page_size: ps, total_items: totalItems, total_pages: totalPages },
        data: { doc_no, items: topItemsArr },
      });
    } finally {
      client.release();
    }
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

module.exports = router;
// export เฉพาะ pure function ไว้ให้ test เรียกใช้ — ไม่กระทบ route ที่ mount ไว้ใน index.js
module.exports.calcAfterDiscount = calcAfterDiscount;
module.exports.calcOrderLineVat = calcOrderLineVat;
module.exports.calcDetailDiscountAmount = calcDetailDiscountAmount;
module.exports.summarizeOrderVat = summarizeOrderVat;
module.exports.isPreorderDocument = isPreorderDocument;
module.exports.mergePreorderRemark = mergePreorderRemark;
module.exports.buildDeliveryRemark = buildDeliveryRemark;
// เปิดให้เทสต์เรียกได้ — ตรรกะแปลงสถานะเป็นกติกาธุรกิจที่ต้องล็อกไว้ด้วยเทสต์
module.exports.mapOrderRow = mapOrderRow;
module.exports.buildPickupRemark = buildPickupRemark;
