const { query } = require('../db');

const SETTING_STOCK_PERCENT = 'stock_display_percent';
const SETTING_PREORDER_DEFAULT_ENABLED = 'preorder_default_enabled';
const SETTING_PRODUCT_NAME_DISPLAY_MODE = 'product_name_display_mode';
const SETTING_SALES_DISPLAY_MODE = 'sales_display_mode';
const SETTING_SALES_STAR_THRESHOLDS = 'sales_star_thresholds';
const SETTING_SALE_PREMIUM_ENABLED = 'sale_premium_enabled';
const SETTING_ORDER_DOC_PATTERN = 'order_doc_pattern';
const SETTING_ORDER_DOC_SOURCE = 'order_doc_source';
const SETTING_ERP_MAX_LINES = 'erp_max_lines_per_doc';
const SETTING_CANCEL_DOC_PATTERN = 'cancel_doc_pattern';
const DEFAULT_ORDER_DOC_PATTERN = 'BSWYYMMDD####';
const DEFAULT_CANCEL_DOC_PATTERN = 'BSCYYMMDD####';
const DOC_HISTORY_MARKETPLACE_ONLY = 'marketplace_only';
const DOC_HISTORY_ALL = 'all';
const PRODUCT_NAME_MODE_FIELDS = new Set(['name_1', 'name_2', 'name_eng_1', 'name_eng_2']);
const DEFAULT_PRODUCT_NAME_DISPLAY_MODE = 'name_1';
const DEFAULT_SALES_DISPLAY_MODE = '0';
const DEFAULT_SALES_STAR_THRESHOLDS = '100,500,1000,5000';

let tablesReady = false;

function toNumber(value, fallback = 0) {
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampPercent(value) {
  const num = toNumber(value, 100);
  return Math.max(0, Math.min(100, Math.round(num * 100) / 100));
}

function cleanFeatureType(value) {
  const text = String(value || '').trim().toLowerCase();
  return ['new', 'recommend'].includes(text) ? text : 'recommend';
}

function normalizeDocHistoryMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['marketplace_only', 'marketplace', 'market', 'web', '1', 'true'].includes(text)) return DOC_HISTORY_MARKETPLACE_ONLY;
  return DOC_HISTORY_ALL;
}

function normalizeBooleanFlag(value, fallback = 0) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'enabled', 'on', 'allow'].includes(text)) return 1;
  if (['0', 'false', 'no', 'n', 'disabled', 'off', 'deny'].includes(text)) return 0;
  return fallback ? 1 : 0;
}

function normalizePreorderMode(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'enabled', 'allow'].includes(text)) return '1';
  if (['0', 'false', 'no', 'n', 'disabled', 'deny'].includes(text)) return '0';
  return 'default';
}

function normalizeProductNameMode(value, fallback = DEFAULT_PRODUCT_NAME_DISPLAY_MODE) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  const aliases = {
    name1: 'name_1',
    item_name_1: 'name_1',
    '1': 'name_1',
    name2: 'name_2',
    item_name_2: 'name_2',
    '2': 'name_2',
    eng1: 'name_eng_1',
    english1: 'name_eng_1',
    name_en_1: 'name_eng_1',
    '3': 'name_eng_1',
    eng2: 'name_eng_2',
    english2: 'name_eng_2',
    name_en_2: 'name_eng_2',
    '4': 'name_eng_2',
  };
  const normalized = aliases[text] || text;
  return PRODUCT_NAME_MODE_FIELDS.has(normalized) ? normalized : fallback;
}

function normalizeOptionalProductNameMode(value) {
  return normalizeProductNameMode(value, '');
}

function normalizeSalesDisplayMode(value, fallback = DEFAULT_SALES_DISPLAY_MODE) {
  const text = String(value ?? '').trim();
  return ['0', '1', '2'].includes(text) ? text : fallback;
}

function normalizeStarThresholds(value, fallback = DEFAULT_SALES_STAR_THRESHOLDS) {
  const nums = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => toNumber(item, NaN))
    .filter((item) => Number.isFinite(item) && item > 0)
    .slice(0, 4);
  const isIncreasing = nums.every((item, index) => index === 0 || item > nums[index - 1]);
  return nums.length === 4 && isIncreasing ? nums.join(',') : fallback;
}

function isValidStarThresholds(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const parts = text.split(',').map((item) => item.trim()).filter(Boolean);
  const nums = parts.map((item) => toNumber(item, NaN));
  if (nums.length !== 4) return false;
  if (nums.some((item) => !Number.isFinite(item) || item <= 0)) return false;
  return nums.every((item, index) => index === 0 || item > nums[index - 1]);
}

function resolvePreorderAllowed(productMode, defaultEnabled = 0) {
  const mode = normalizePreorderMode(productMode);
  if (mode === '1') return 1;
  if (mode === '0') return 0;
  return normalizeBooleanFlag(defaultEnabled, 0);
}

function marketplaceDocWhere(alias = 'ic') {
  return ` AND (COALESCE(${alias}.creator_code,'') = 'market' OR ${alias}.doc_no ILIKE '%MQT%')`;
}

function applyStockPercent(value, percent) {
  const qty = toNumber(value, 0);
  return Math.trunc(qty * clampPercent(percent) / 100);
}

async function ensureSalesSettingsTables(client = null) {
  if (tablesReady) return;
  const runner = getQueryRunner(client);
  await runner.query(
    `CREATE TABLE IF NOT EXISTS marketplace_sales_setting (
      setting_key VARCHAR(80) PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    )`
  );
  await runner.query(
    `CREATE TABLE IF NOT EXISTS marketplace_featured_product (
      id SERIAL PRIMARY KEY,
      feature_type VARCHAR(20) NOT NULL,
      item_code VARCHAR(50) NOT NULL,
      from_date DATE,
      to_date DATE,
      status SMALLINT NOT NULL DEFAULT 1,
      line_number INTEGER NOT NULL DEFAULT 0,
      note VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(feature_type, item_code)
    )`
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS idx_marketplace_featured_product_active
     ON marketplace_featured_product (feature_type, status, from_date, to_date, line_number, item_code)`
  );
  // แผนที่เลขย่อย→เลขหลัก + idempotency (REQ4)
  // ⚠️ ต้องสร้างที่นี่ด้วย ไม่ใช่แค่ใน migrations/create_order_document.sql
  //    เพราะ sendorder เขียน 2 ตารางนี้ทุกครั้ง (แม้โหมด client) ถ้าลืมรัน migration checkout จะพังทั้งระบบ
  await runner.query(
    `CREATE TABLE IF NOT EXISTS marketplace_order_document (
      sub_doc_no   VARCHAR(30)  PRIMARY KEY,
      main_doc_no  VARCHAR(30)  NOT NULL,
      seq          SMALLINT     NOT NULL DEFAULT 1,
      doc_kind     VARCHAR(10)  NOT NULL DEFAULT 'ready',
      request_id   VARCHAR(64)  DEFAULT '',
      cust_code    VARCHAR(25)  DEFAULT '',
      created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
    )`
  );
  await runner.query(
    `CREATE INDEX IF NOT EXISTS marketplace_order_document_main_idx
     ON marketplace_order_document (main_doc_no)`
  );
  await runner.query(
    `CREATE TABLE IF NOT EXISTS marketplace_order_request (
      request_id    VARCHAR(64) PRIMARY KEY,
      cust_code     VARCHAR(25) NOT NULL DEFAULT '',
      response_json TEXT        NOT NULL DEFAULT '',
      created_at    TIMESTAMP   NOT NULL DEFAULT NOW()
    )`
  );
  tablesReady = true;
}

// 🚨 ต้องรับ client ได้ — ผู้เรียกหลายจุดอยู่ "ข้างในทรานแซกชัน" อยู่แล้ว
//    ถ้าอ่านผ่าน pool ตรงๆ จะกลายเป็นขอ connection ตัวที่ 2 ขณะที่ยังถือตัวแรกอยู่
//    พอมี request ค้างครบ DB_POOL_MAX พร้อมกัน ไม่มีใครได้ตัวที่ 2 = ตายยกแผงด้วย
//    "timeout exceeded when trying to connect" (วัดจริง: 20 คนพร้อมกันผ่าน 25 คนเหลือ 4)
//    เป็นอาการเดียวกับที่เคยแก้ด้วยการย้าย validateOrderPrices ออกนอกทรานแซกชัน
//    แต่ยังเหลือทางนี้ไว้ ดู getQueryRunner ที่ setSettingValue ใช้อยู่แล้ว
async function getSettingValue(key, fallback = '', client = null) {
  await ensureSalesSettingsTables(client);
  const result = await getQueryRunner(client).query(
    'SELECT setting_value FROM marketplace_sales_setting WHERE setting_key=$1 LIMIT 1', [key]);
  return result.rows[0]?.setting_value ?? fallback;
}

function getQueryRunner(client = null) {
  return client && typeof client.query === 'function' ? client : { query };
}

async function setSettingValue(key, value, client = null) {
  await ensureSalesSettingsTables();
  await getQueryRunner(client).query(
    `INSERT INTO marketplace_sales_setting (setting_key, setting_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`,
    [key, String(value ?? '')]
  );
}

async function getStockDisplayPercent(client = null) {
  return clampPercent(await getSettingValue(SETTING_STOCK_PERCENT, '100', client));
}

// รูปแบบเลขเอกสารคำสั่งซื้อ — แก้ได้โดยไม่ต้อง deploy (REQ4)
async function getOrderDocPattern() {
  const value = String(await getSettingValue(SETTING_ORDER_DOC_PATTERN, DEFAULT_ORDER_DOC_PATTERN)).trim();
  return value || DEFAULT_ORDER_DOC_PATTERN;
}

// รูปแบบเลขใบยกเลิก (SOC) — คนละ running กับ BSW เพราะ trans_flag ต่างกัน (REQ4)
async function getCancelDocPattern(client = null) {
  const value = String(await getSettingValue(SETTING_CANCEL_DOC_PATTERN, DEFAULT_CANCEL_DOC_PATTERN, client)).trim();
  return value || DEFAULT_CANCEL_DOC_PATTERN;
}

// 'server' = server ออกเลขเอง · 'client' = ใช้เลขที่ client ส่งมา (ค่าเริ่มต้น = kill switch)
async function getOrderDocSource() {
  const value = String(await getSettingValue(SETTING_ORDER_DOC_SOURCE, 'client')).trim().toLowerCase();
  return value === 'server' ? 'server' : 'client';
}

// จำนวนบรรทัดสูงสุดต่อเอกสารที่ ERP รับได้ — 0 หรือว่าง = ไม่แบ่ง (kill switch)
async function getErpMaxLinesPerDoc(client = null) {
  const raw = await getSettingValue(SETTING_ERP_MAX_LINES, '0', client);
  const num = Math.trunc(Number(raw));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

// ── ตัวตั้งค่าเลขที่เอกสารคำสั่งซื้อ (REQ4) ────────────────────────────────
// pattern ต้องมี # อย่างน้อย 1 ตัวเป็นช่อง running ไม่งั้นจะออกเลขซ้ำทุกใบ
// และห้ามมีอักขระที่ทำให้ LIKE/regex ของ read path เพี้ยน (เอาเฉพาะ A-Z 0-9 # และตัวอักษรวันที่)
function isValidDocPattern(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 30) return false;
  if (!/^[A-Za-z0-9#]+$/.test(text)) return false;
  const hashCount = (text.match(/#/g) || []).length;
  if (hashCount < 1 || hashCount > 8) return false;
  // # ต้องอยู่ติดกันเป็นก้อนเดียวและอยู่ท้ายสุด (splitPattern อ่านแบบนี้)
  return new RegExp(`^[A-Za-z0-9]*#{${hashCount}}$`).test(text);
}

function isValidDocSource(value) {
  return value === 'server' || value === 'client';
}

// 0 = ปิดการแบ่งเอกสาร · เพดาน 99 กันตั้งค่าเพี้ยนจนเอกสารใหญ่เกินที่ ERP รับ
// null/'' ต้องไม่ผ่าน เพราะ Number(null)=0 จะกลายเป็นการปิดการแบ่งเอกสารเงียบๆ จาก payload ที่ผิดรูป
function isValidMaxLinesPerDoc(value) {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 && num <= 99;
}

async function setOrderDocPattern(value, client = null) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!isValidDocPattern(text)) throw new Error('รูปแบบเลขที่เอกสารไม่ถูกต้อง');
  await setSettingValue(SETTING_ORDER_DOC_PATTERN, text, client);
  return text;
}

async function setCancelDocPattern(value, client = null) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!isValidDocPattern(text)) throw new Error('รูปแบบเลขที่ใบยกเลิกไม่ถูกต้อง');
  await setSettingValue(SETTING_CANCEL_DOC_PATTERN, text, client);
  return text;
}

async function setOrderDocSource(value, client = null) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!isValidDocSource(text)) throw new Error('ที่มาของเลขที่เอกสารต้องเป็น server หรือ client');
  await setSettingValue(SETTING_ORDER_DOC_SOURCE, text, client);
  return text;
}

async function setErpMaxLinesPerDoc(value, client = null) {
  // ตรวจค่าดิบก่อน trunc — ไม่งั้น null/'' /8.5 จะถูกปัดเป็นเลขที่ผ่านโดยที่แอดมินไม่ได้ตั้งใจ
  if (!isValidMaxLinesPerDoc(value)) throw new Error('จำนวนบรรทัดต่อเอกสารต้องเป็นจำนวนเต็ม 0-99');
  const num = Math.trunc(Number(value));
  await setSettingValue(SETTING_ERP_MAX_LINES, String(num), client);
  return num;
}

async function getSalePremiumEnabled(client = null) {
  return normalizeBooleanFlag(await getSettingValue(SETTING_SALE_PREMIUM_ENABLED, '0', client), 0);
}

async function setSalePremiumEnabled(value, client = null) {
  const enabled = normalizeBooleanFlag(value, 0);
  await setSettingValue(SETTING_SALE_PREMIUM_ENABLED, String(enabled), client);
  return enabled;
}

async function setStockDisplayPercent(value, client = null) {
  const percent = clampPercent(value);
  await setSettingValue(SETTING_STOCK_PERCENT, String(percent), client);
  return percent;
}

async function getPreorderDefaultEnabled(client = null) {
  return normalizeBooleanFlag(await getSettingValue(SETTING_PREORDER_DEFAULT_ENABLED, '0', client), 0);
}

async function setPreorderDefaultEnabled(value, client = null) {
  const enabled = normalizeBooleanFlag(value, 0);
  await setSettingValue(SETTING_PREORDER_DEFAULT_ENABLED, String(enabled), client);
  return enabled;
}

async function getProductNameDisplayMode() {
  return normalizeProductNameMode(await getSettingValue(SETTING_PRODUCT_NAME_DISPLAY_MODE, DEFAULT_PRODUCT_NAME_DISPLAY_MODE));
}

async function setProductNameDisplayMode(value, client = null) {
  const mode = normalizeProductNameMode(value);
  await setSettingValue(SETTING_PRODUCT_NAME_DISPLAY_MODE, mode, client);
  return mode;
}

async function getSalesDisplayMode() {
  return normalizeSalesDisplayMode(await getSettingValue(SETTING_SALES_DISPLAY_MODE, DEFAULT_SALES_DISPLAY_MODE));
}

async function setSalesDisplayMode(value, client = null) {
  const mode = normalizeSalesDisplayMode(value);
  await setSettingValue(SETTING_SALES_DISPLAY_MODE, mode, client);
  return mode;
}

async function getSalesStarThresholds() {
  return normalizeStarThresholds(await getSettingValue(SETTING_SALES_STAR_THRESHOLDS, DEFAULT_SALES_STAR_THRESHOLDS));
}

async function setSalesStarThresholds(value, client = null) {
  const thresholds = normalizeStarThresholds(value);
  await setSettingValue(SETTING_SALES_STAR_THRESHOLDS, thresholds, client);
  return thresholds;
}

async function getMarketplaceDisplayDefaults() {
  const [product_name_display_mode, sales_display_mode, sales_star_thresholds] = await Promise.all([
    getProductNameDisplayMode(),
    getSalesDisplayMode(),
    getSalesStarThresholds(),
  ]);
  return { product_name_display_mode, sales_display_mode, sales_star_thresholds };
}

async function getDocHistoryMode() {
  try {
    const result = await query('SELECT COALESCE(wallet_bcel_mcid, \'\') AS mode FROM erp_option LIMIT 1');
    return normalizeDocHistoryMode(result.rows[0]?.mode || DOC_HISTORY_ALL);
  } catch (_) {
    return DOC_HISTORY_ALL;
  }
}

async function setDocHistoryMode(value, client = null) {
  const mode = normalizeDocHistoryMode(value);
  const result = await getQueryRunner(client).query('UPDATE erp_option SET wallet_bcel_mcid=$1', [mode]);
  if (result.rowCount === 0) {
    throw new Error('ไม่พบข้อมูล erp_option สำหรับบันทึก wallet_bcel_mcid');
  }
  // UPDATE นี้ไม่มี WHERE โดยตั้งใจว่า erp_option เป็นตาราง config แถวเดียว
  // ถ้าเจอมากกว่า 1 แถวแปลว่าสมมติฐานผิด และการเขียนนี้ทับ config ของแถวอื่นไปด้วย
  // (getDocHistoryMode อ่านด้วย LIMIT 1 ไม่มี ORDER BY จึงอ่านแถวไหนก็ได้)
  if (result.rowCount > 1) {
    console.warn(
      `marketplaceSalesSettings: UPDATE erp_option แก้ ${result.rowCount} แถวพร้อมกัน — ` +
      'erp_option ไม่ใช่ตารางแถวเดียวอย่างที่โค้ดสมมติไว้ ต้องใส่ WHERE ให้ชี้แถวที่ถูกต้อง'
    );
  }
  return mode;
}

async function getSalesSettings() {
  const [stock_display_percent, doc_history_mode, preorder_default_enabled, sale_premium_enabled,
    order_doc_source, order_doc_pattern, cancel_doc_pattern, erp_max_lines_per_doc, displayDefaults] = await Promise.all([
    getStockDisplayPercent(),
    getDocHistoryMode(),
    getPreorderDefaultEnabled(),
    getSalePremiumEnabled(),
    getOrderDocSource(),
    getOrderDocPattern(),
    getCancelDocPattern(),
    getErpMaxLinesPerDoc(),
    getMarketplaceDisplayDefaults(),
  ]);
  return {
    stock_display_percent, doc_history_mode, preorder_default_enabled, sale_premium_enabled,
    order_doc_source, order_doc_pattern, cancel_doc_pattern, erp_max_lines_per_doc,
    ...displayDefaults,
  };
}

module.exports = {
  DEFAULT_PRODUCT_NAME_DISPLAY_MODE,
  DEFAULT_SALES_DISPLAY_MODE,
  DEFAULT_SALES_STAR_THRESHOLDS,
  DOC_HISTORY_ALL,
  DOC_HISTORY_MARKETPLACE_ONLY,
  applyStockPercent,
  cleanFeatureType,
  clampPercent,
  ensureSalesSettingsTables,
  getDocHistoryMode,
  getMarketplaceDisplayDefaults,
  getPreorderDefaultEnabled,
  getProductNameDisplayMode,
  getSalesSettings,
  getSalesDisplayMode,
  getSalesStarThresholds,
  getSalePremiumEnabled,
  setSalePremiumEnabled,
  getCancelDocPattern,
  isValidDocPattern,
  isValidDocSource,
  isValidMaxLinesPerDoc,
  setCancelDocPattern,
  setErpMaxLinesPerDoc,
  setOrderDocPattern,
  setOrderDocSource,
  getOrderDocPattern,
  getOrderDocSource,
  getErpMaxLinesPerDoc,
  getStockDisplayPercent,
  isValidStarThresholds,
  marketplaceDocWhere,
  normalizeDocHistoryMode,
  normalizeOptionalProductNameMode,
  normalizePreorderMode,
  normalizeProductNameMode,
  normalizeSalesDisplayMode,
  normalizeStarThresholds,
  resolvePreorderAllowed,
  setDocHistoryMode,
  setProductNameDisplayMode,
  setPreorderDefaultEnabled,
  setSalesDisplayMode,
  setSalesStarThresholds,
  setStockDisplayPercent,
};
