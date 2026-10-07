const crypto = require('crypto');
const { getProductPriceLocalx } = require('./priceHelper');
const { serverDocDate } = require('./serverTime');

const n = (value, fallback = 0) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};
const money = value => Math.round(n(value) * 100) / 100;
const fixed = row => String(row?.item_type) === '3' || Number(row?.is_permium) === 1;

function distributeMoney(amount, weights) {
  const total = weights.reduce((sum, weight) => sum + n(weight), 0);
  let assigned = 0;
  let cumulative = 0;
  return weights.map((weight, index) => {
    cumulative += n(weight);
    const target = total > 0 ? Math.round(n(amount) * 100 * cumulative / total) : index === 0 ? Math.round(n(amount) * 100) : assigned;
    const result = (target - assigned) / 100;
    assigned = target;
    return result;
  });
}

function calcAfterDiscount(discountWord, totalValue, qty) {
  let remaining = money(totalValue);
  for (let part of String(discountWord || '').replace(/\s/g, '').split(/[,+]/)) {
    if (!part) continue;
    if (part.startsWith('@')) remaining -= money(n(part.slice(1)) * n(qty));
    else if (part.includes('%')) remaining -= money((n(part.replace(/%/g, '')) / 100) * remaining);
    else if (part.toUpperCase().endsWith('B')) remaining -= n(part.slice(0, -1));
    else remaining -= n(part);
    if (remaining < 0) remaining = 0;
  }
  return money(remaining);
}

function lineVat(row, header) {
  const taxType = Number(row.tax_type || 0);
  const vatType = Number(header.vat_type || 0);
  const vatRate = n(header.vat_rate);
  const sumAmount = money(row.sum_amount);
  const price = money(row.price);
  if (taxType === 1) {
    return { ...row, tax_type: taxType, sum_amount: sumAmount, sum_amount_exclude_vat: sumAmount, total_vat_value: 0, price_exclude_vat: price };
  }
  if (vatType === 1) {
    const sumExVat = money(sumAmount * 100 / (100 + vatRate));
    return { ...row, tax_type: taxType, sum_amount: sumAmount, sum_amount_exclude_vat: sumExVat, total_vat_value: money(sumAmount - sumExVat), price_exclude_vat: money(price * 100 / (100 + vatRate)) };
  }
  return { ...row, tax_type: taxType, sum_amount: sumAmount, sum_amount_exclude_vat: sumAmount, total_vat_value: money(sumAmount * vatRate / 100), price_exclude_vat: price };
}

function summarize(rows, header) {
  const vatType = Number(header.vat_type || 0);
  const vatRate = n(header.vat_rate);
  const taxable = rows.filter(row => Number(row.tax_type || 0) !== 1);
  const exempt = rows.filter(row => Number(row.tax_type || 0) === 1);
  const gross = money(rows.reduce((sum, row) => sum + n(row.__gross), 0));
  const discount = money(rows.reduce((sum, row) => sum + n(row.discount_amount), 0));
  const taxableNet = money(taxable.reduce((sum, row) => sum + n(row.sum_amount), 0));
  const exemptNet = money(exempt.reduce((sum, row) => sum + n(row.sum_amount), 0));
  if (vatType === 1) {
    const beforeVat = money(taxableNet * 100 / (100 + vatRate));
    return { total_value: gross, total_discount: discount, total_before_vat: beforeVat, total_vat_value: money(taxableNet - beforeVat),
      total_after_vat: taxableNet, total_except_vat: exemptNet, total_amount: money(taxableNet + exemptNet) };
  }
  if (vatType === 0) {
    const vat = money(taxableNet * vatRate / 100);
    return { total_value: gross, total_discount: discount, total_before_vat: taxableNet, total_vat_value: vat,
      total_after_vat: money(taxableNet + vat), total_except_vat: exemptNet, total_amount: money(taxableNet + vat + exemptNet) };
  }
  return { total_value: gross, total_discount: discount, total_before_vat: 0, total_vat_value: 0,
    total_after_vat: 0, total_except_vat: exemptNet, total_amount: money(taxableNet + exemptNet) };
}

function fingerprint(docNo, pricingDate, items, totals) {
  const data = {
    doc_no: docNo,
    pricing_date: pricingDate,
    items: items.map(row => [row.__source_line, row.item_code, n(row.qty), row.wh_code, row.shelf_code, n(row.price), row.discount || '', n(row.discount_amount), n(row.sum_amount), n(row.tax_type)]),
    totals,
  };
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function publicItem(row) {
  const fields = ['__source_line', '__source_item', 'item_code', 'item_name', 'unit_code', 'qty', 'wh_code', 'shelf_code',
    'price', 'discount', 'discount_amount', 'sum_amount', 'tax_type', 'sum_amount_exclude_vat', 'total_vat_value', 'price_exclude_vat', 'is_permium'];
  return Object.fromEntries(fields.map(key => [key.replace(/^__/, ''), row[key]]));
}

async function priceActualItems(header, allocated) {
  const date = serverDocDate();
  const groups = new Map();
  for (const row of allocated.filter(row => !fixed(row))) {
    const key = `${row.item_code}\0${row.unit_code}`;
    const group = groups.get(key) || { rows: [], qty: 0, row };
    group.rows.push(row);
    group.qty += n(row.qty);
    groups.set(key, group);
  }
  const errors = [];
  const pricing = new Map();
  await Promise.all([...groups.entries()].map(async ([key, group]) => {
    try {
      const result = await getProductPriceLocalx(group.row.item_code, group.row.unit_code, String(group.qty),
        header.cust_code, Number(header.vat_type || 0), n(header.vat_rate), Number(header.inquiry_type || 0),
        group.row.barcode || '', date);
      const found = result?.data?.[0];
      const price = n(found?.price, NaN);
      if (!Number.isFinite(price) || price <= 0) throw new Error('NO_PRICE');
      pricing.set(key, { price, discount: String(found?.defaultDiscount || ''), qty: group.qty });
    } catch (_) {
      errors.push({ item_code: group.row.item_code, unit_code: group.row.unit_code, source_line_numbers: [...new Set(group.rows.map(row => row.__source_line))] });
    }
  }));
  if (errors.length) {
    const error = Object.assign(new Error('ไม่พบราคาปัจจุบันของสินค้าที่เลือก กรุณาเลือกสินค้าอื่น'), { statusCode: 400, code: 'PENDING_QT_PRICE_NOT_FOUND', price_issues: errors });
    throw error;
  }
  return { pricing, date };
}

async function quotePendingQt(pending, header, allocated) {
  const { pricing, date } = await priceActualItems(header, allocated);
  const rows = [];
  for (const row of allocated) {
    if (fixed(row)) {
      const gross = money(n(row.price) * n(row.qty));
      rows.push(lineVat({ ...row, __gross: gross, discount_amount: money(row.discount_amount), sum_amount: money(row.sum_amount) }, header));
      continue;
    }
    const key = `${row.item_code}\0${row.unit_code}`;
    const group = pricing.get(key);
    const siblings = allocated.filter(candidate => !fixed(candidate) && candidate.item_code === row.item_code && candidate.unit_code === row.unit_code);
    const index = siblings.indexOf(row);
    const weights = siblings.map(candidate => n(candidate.qty));
    const gross = money(group.price * group.qty);
    const net = calcAfterDiscount(group.discount, gross, group.qty);
    const grossPart = distributeMoney(gross, weights)[index];
    const netPart = distributeMoney(net, weights)[index];
    rows.push(lineVat({ ...row, price: group.price, discount: group.discount, __gross: grossPart,
      discount_amount: money(grossPart - netPart), sum_amount: netPart }, header));
  }
  const totals = summarize(rows, header);
  return {
    pricing_date: date,
    items: rows.map(publicItem),
    totals,
    fingerprint: fingerprint(pending.doc_no, date, rows, totals),
    _rows: rows,
  };
}

module.exports = { quotePendingQt, calcAfterDiscount, distributeMoney, summarize, lineVat };
