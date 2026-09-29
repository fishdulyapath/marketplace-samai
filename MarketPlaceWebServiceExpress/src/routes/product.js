const express = require("express");
const { requireAdmin } = require("../auth/requireAdmin");
const fs = require("fs/promises");
const path = require("path");
const router = express.Router();
const { query, pool, poolImages, withTransaction, queryImages } = require("../db");
const { getProductPriceLocalx } = require("../utils/priceHelper");
const { pickProvidedFields, buildSetClause, buildConflictSetClause, hasOwn } = require("../utils/partialUpdate");
const { checkErpCodes } = require("../utils/erpCodeGuard");
const { escapeLike, likeContains } = require("../utils/likePattern");
const { cleanFeatureType, ensureSalesSettingsTables, getMarketplaceDisplayDefaults, getPreorderDefaultEnabled, getStockDisplayPercent, normalizePreorderMode, resolvePreorderAllowed } = require("../utils/marketplaceSalesSettings");
const { normalizeMaxAllowance, parseMaxAllowance } = require("../utils/maxAllowance");
const { randomUUID } = require("crypto");
const { serverDocDate, serverDocTime } = require("../utils/serverTime");

const PRODUCT_CODE_PATTERN = /^[A-Z0-9_-]+$/;

// สวิตช์เปิด/ปิดโปรโมชั่นของสินค้า (ic_inventory_detail.dimension_41)
// เก็บเป็นสตริง "1" = เปิด / "0" = ปิด — ค่าว่าง null "" หรือ 0 ถือว่าปิด
// จึงทำให้สินค้าเก่าที่ยังไม่เคยตั้งค่าเป็น "ปิด" โดยปริยาย
// รายละเอียดโปรโมชั่น (dimension_39) — เก็บทั้งก้อนตามที่พิมพ์ ไม่ตัดไม่ trim
// ยกเว้นกรณีที่ Quill ทิ้งมาร์กอัปเปล่าไว้ ("<p><br></p>") ตอนผู้ใช้ลบข้อความจนหมด
// ให้เก็บเป็นค่าว่างตั้งแต่ตอนบันทึก ฝั่งแสดงผลจะได้ไม่ต้องมาเดาว่าว่างหรือไม่ว่าง
function cleanPromotionDetail(value) {
  const raw = String(value ?? "");
  const text = raw
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, "")
    .trim();
  if (text) return raw;
  return /<img[\s>/]/i.test(raw) ? raw : "";
}

function normalizePromotionSwitch(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" ? "1" : "0";
}
const PROMOTION_SWITCH_ON_SQL = (alias) => `COALESCE(${alias}.dimension_41,'') = '1'`;


const DATA_DIR = process.env.MARKETPLACE_DATA_DIR || path.join(__dirname, "../../data");
const CONTENT_DIR = process.env.MARKETPLACE_CONTENT_DIR || path.join(DATA_DIR, "content");
const CATEGORY_META_FILE = path.join(CONTENT_DIR, "category-meta.json");
const VIRTUAL_CATEGORIES = [
  { code: "all", name: "ทั้งหมด", name_1: "ทั้งหมด", name_2: "All" },
  { code: "promotions", name: "โปรโมชั่น", name_1: "โปรโมชั่น", name_2: "Promotions" },
];
const VIRTUAL_CATEGORY_CODES = new Set(VIRTUAL_CATEGORIES.map((category) => category.code));
const PRODUCT_NAME_MODE_FIELDS = new Set(["name_1", "name_2", "name_eng_1", "name_eng_2"]);
const DEFAULT_SALES_STAR_THRESHOLDS = "100,500,1000,5000";
const PRODUCT_IMPORT_BATCH_SIZE = 500;
const PRODUCT_IMPORT_ERROR_LIMIT = 200;
const PRODUCT_IMPORT_PREVIEW_LIMIT = 20;
const DEFAULT_WH_CODE = process.env.MARKETPLACE_DEFAULT_WH_CODE || "";
const DEFAULT_SHELF_CODE = process.env.MARKETPLACE_DEFAULT_SHELF_CODE || "";
const PRODUCT_IMPORT_FIELDS = [
  { key: "code", label: "รหัสสินค้า", table: "key" },
  { key: "name_1", label: "ชื่อสินค้า 1", table: "inventory" },
  { key: "name_2", label: "ชื่อสินค้า 2", table: "inventory" },
  { key: "name_eng_1", label: "ชื่ออังกฤษ 1", table: "inventory" },
  { key: "name_eng_2", label: "ชื่ออังกฤษ 2", table: "inventory" },
  { key: "unit_standard", label: "หน่วยมาตรฐาน", table: "inventory" },
  { key: "unit_cost", label: "หน่วยต้นทุน", table: "inventory" },
  { key: "item_category", label: "หมวดสินค้า", table: "inventory" },
  { key: "item_brand", label: "ยี่ห้อ", table: "inventory" },
  { key: "group_main", label: "กลุ่มหลัก", table: "inventory" },
  { key: "group_sub", label: "กลุ่มย่อย 1", table: "inventory" },
  { key: "group_sub2", label: "กลุ่มย่อย 2", table: "inventory" },
  { key: "item_design", label: "รูปแบบ", table: "inventory" },
  { key: "item_model", label: "รุ่น", table: "inventory" },
  { key: "item_pattern", label: "ลาย", table: "inventory" },
  { key: "item_grade", label: "เกรด", table: "inventory" },
  { key: "description", label: "รายละเอียด", table: "inventory", maxLength: 4000 },
  { key: "dimension_31", label: "ปิดรายละเอียดสินค้า", table: "detail", normalizer: (value) => normalizeHiddenDetailFields(value).join(",") },
  { key: "dimension_32", label: "ชื่อที่แสดง", table: "detail", normalizer: normalizeProductNameMode },
  { key: "dimension_33", label: "ช่วงระดับดาว", table: "detail", normalizer: (value) => cleanDimensionText(value) },
  { key: "dimension_34", label: "การแสดงยอดขาย", table: "detail", normalizer: (value) => (String(value ?? "").trim() === "" ? "" : normalizeSalesDisplayMode(value)) },
  { key: "dimension_35", label: "Preorder", table: "detail", normalizer: normalizePreorderMode },
  { key: "dimension_36", label: "วิดีโอสินค้า", table: "detail", normalizer: cleanProductMediaUrl },
  { key: "dimension_37", label: "หน่วยนับที่ซ่อนออนไลน์", table: "detail", normalizer: normalizeHiddenOnlineUnits },
  { key: "dimension_38", label: "จำนวนสั่งสูงสุดต่อคำสั่งซื้อ", table: "detail", normalizer: normalizeMaxAllowance },
  // รายละเอียดโปรโมชั่นที่ลูกค้าพิมพ์เอง — เก็บทั้งก้อนเหมือน description ไม่ trim/ตัด
  // (คอลัมน์นี้ถูกขยายเป็น text แล้ว จึงไม่ต้องจำกัดความยาว)
  { key: "dimension_39", label: "รายละเอียดโปรโมชั่น", table: "detail", normalizer: cleanPromotionDetail },
  { key: "dimension_41", label: "เปิดใช้งานโปรโมชั่น", table: "detail", normalizer: normalizePromotionSwitch },
];
const PRODUCT_IMPORT_FIELD_MAP = new Map(PRODUCT_IMPORT_FIELDS.map((field) => [field.key, field]));
const PRODUCT_RELATED_CONFIG = {
  replacement: {
    table: "ic_inventory_replacement",
    ownerColumn: "ic_replace_code",
  },
  suggest: {
    table: "ic_inventory_suggest",
    ownerColumn: "ic_suggest_code",
  },
};

function toNumber(value, fallback = 0) {
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function getSearchTerms(value, maxTerms = 8) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, maxTerms);
}

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeStockLevelQty(value) {
  const num = toNumber(value, 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

async function ensureWarehouseShelfExists(client, whCode, shelfCode) {
  const wh = String(whCode || "").trim();
  const shelf = String(shelfCode || "").trim();
  if (!wh) throw httpError("กรุณาเลือกคลัง", 400);
  if (!shelf) throw httpError("กรุณาเลือกที่เก็บ", 400);
  const result = await client.query(`SELECT 1 FROM ic_shelf WHERE whcode=$1 AND code=$2 LIMIT 1`, [wh, shelf]);
  if (!result.rows.length) throw httpError("คลัง/ที่เก็บไม่ถูกต้อง", 400);
}

function normalizeWarehouseShelfRows(rows, fallbackWhCode = "", fallbackShelfCode = "") {
  const list = Array.isArray(rows) ? rows : [];
  const unique = new Map();

  function add(row) {
    const whCode = String(row?.wh_code || row?.whcode || "").trim();
    const shelfCode = String(row?.shelf_code || row?.code || "").trim();
    if (!whCode || !shelfCode) return;
    unique.set(`${whCode}\u0000${shelfCode}`, {
      wh_code: whCode,
      shelf_code: shelfCode,
      shelf_list: String(row?.shelf_list || "").trim(),
      min_point: normalizeStockLevelQty(row?.min_point),
      max_point: normalizeStockLevelQty(row?.max_point),
      status: Number(row?.status ?? 1) === 0 ? 0 : 1,
    });
  }

  for (const row of list) add(row);
  add({ wh_code: fallbackWhCode, shelf_code: fallbackShelfCode });
  return Array.from(unique.values());
}

// เพิ่มคลัง/ที่เก็บหนึ่งแถวถ้ายังไม่มี — ต่างจาก replaceProductWarehouseShelves ตรงที่ไม่ลบของเดิม
// ใช้ตอน client แก้แค่คลังเริ่มต้นขาย ซึ่งไม่ได้ตั้งใจกำหนดรายการคลังใหม่ทั้งชุด
async function addProductWarehouseShelfIfMissing(client, icCode, whCode, shelfCode) {
  const c = String(icCode || "").trim();
  const wh = String(whCode || "").trim();
  const shelf = String(shelfCode || "").trim();
  if (!c || !wh || !shelf) return;
  const existing = await client.query(
    `SELECT 1 FROM ic_wh_shelf WHERE ic_code=$1 AND wh_code=$2 AND shelf_code=$3 LIMIT 1`,
    [c, wh, shelf],
  );
  if (existing.rows.length) return;
  await client.query(
    `INSERT INTO ic_wh_shelf (ic_code, wh_code, shelf_code, shelf_list, min_point, max_point, status)` +
      ` VALUES ($1,$2,$3,'',0,0,1)`,
    [c, wh, shelf],
  );
}

async function ensureWarehouseShelfRowsExist(client, rows) {
  for (const row of rows) {
    await ensureWarehouseShelfExists(client, row.wh_code, row.shelf_code);
  }
}

async function replaceProductWarehouseShelves(client, icCode, rows) {
  const c = String(icCode || "").trim();
  await client.query(`DELETE FROM ic_wh_shelf WHERE ic_code=$1`, [c]);
  for (const row of rows) {
    await client.query(
      `INSERT INTO ic_wh_shelf (ic_code, wh_code, shelf_code, shelf_list, min_point, max_point, status)` +
        ` VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [c, row.wh_code, row.shelf_code, row.shelf_list, row.min_point, row.max_point, row.status],
    );
  }
}

async function ensureProductUnitUse(client, icCode, unitCode) {
  const c = String(icCode || "").trim();
  const u = String(unitCode || "").trim();
  if (!c || !u) return;
  await client.query(
    `INSERT INTO ic_unit_use (ic_code, code, stand_value, divide_value, ratio, row_order)` +
      ` SELECT $1::text,$2::text,1,1,1,0` +
      ` WHERE NOT EXISTS (SELECT 1 FROM ic_unit_use WHERE ic_code=$1::text AND code=$2::text)`,
    [c, u],
  );
}

async function syncProductUnitType(client, icCode) {
  const c = String(icCode || "").trim();
  if (!c) return;
  const unitCountResult = await client.query(
    `SELECT COUNT(DISTINCT NULLIF(TRIM(code::text), ''))::int AS unit_count FROM ic_unit_use WHERE ic_code=$1::text`,
    [c],
  );
  const unitCount = Number(unitCountResult.rows[0]?.unit_count || 0);
  const updateResult = await client.query(
    `WITH standard_unit AS (` +
      ` SELECT COALESCE(NULLIF(u.stand_value, 0), 1) AS stand_value,` +
      `        COALESCE(NULLIF(u.divide_value, 0), 1) AS divide_value` +
      ` FROM ic_inventory i` +
      ` LEFT JOIN ic_unit_use u ON u.ic_code = i.code AND u.code = i.unit_standard` +
      ` WHERE i.code=$2::text` +
      ` LIMIT 1` +
      `)` +
      ` UPDATE ic_inventory SET unit_type=$1::integer,` +
      ` unit_standard_stand_value = (SELECT stand_value FROM standard_unit),` +
      ` unit_standard_divide_value = (SELECT divide_value FROM standard_unit)` +
      ` WHERE code=$2::text`,
    [unitCount > 1 ? 1 : 0, c],
  );
  if (updateResult.rowCount === 0) throw httpError("ไม่พบสินค้า", 404);
}

function resolveProductRelatedConfig(kind) {
  return PRODUCT_RELATED_CONFIG[String(kind || "").trim()] || null;
}

function cleanCategoryCode(value) {
  return String(value || "")
    .trim()
    .slice(0, 40);
}

function cleanCategoryText(value, maxLength = 255) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function cleanCategoryImageUrl(value) {
  const url = cleanCategoryText(value, 500);
  if (!url) return "";
  if (url.startsWith("/media/") || url.startsWith("http://") || url.startsWith("https://")) return url;
  return "";
}

function cleanDimensionText(value, maxLength = 255) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function extractHtmlAttribute(html, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(html || "").match(pattern);
  return match ? String(match[1] || match[2] || match[3] || "").trim() : "";
}

function toPositiveMediaSize(value) {
  const size = toInt(value, 0);
  return size > 0 && size <= 10000 ? size : 0;
}

function isExternalMediaUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isAllowedProductMediaUrl(value) {
  const url = String(value || "").trim();
  return url.startsWith("/media/") || isExternalMediaUrl(url);
}

function normalizeYoutubeEmbedUrl(value) {
  const text = String(value || "").trim().replace(/&amp;/g, "&");
  if (!text) return "";
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathParts = url.pathname.split("/").filter(Boolean);
    let videoId = "";
    if (host === "youtu.be") {
      videoId = pathParts[0] || "";
    } else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (pathParts[0] === "embed") videoId = pathParts[1] || "";
      else if (pathParts[0] === "shorts" || pathParts[0] === "live") videoId = pathParts[1] || "";
      else videoId = url.searchParams.get("v") || "";
    }
    if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) return "";
    const embedHost = host === "youtube-nocookie.com" ? "www.youtube-nocookie.com" : "www.youtube.com";
    const embed = new URL(`https://${embedHost}/embed/${videoId}`);
    const start = toPositiveMediaSize(url.searchParams.get("start"));
    if (start > 0) embed.searchParams.set("start", String(start));
    return embed.toString();
  } catch (error) {
    return "";
  }
}

function compactProductIframeValue(src, width = 0, height = 0) {
  const payload = { t: "iframe", src };
  if (width > 0 && height > 0) {
    payload.w = width;
    payload.h = height;
  }
  const text = JSON.stringify(payload);
  return text.length <= 255 ? text : src.slice(0, 255);
}

function cleanProductMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let source = raw;
  let width = 0;
  let height = 0;
  let forceIframe = false;

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      source = String(parsed.src || parsed.url || "").trim();
      width = toPositiveMediaSize(parsed.w || parsed.width);
      height = toPositiveMediaSize(parsed.h || parsed.height);
      forceIframe = parsed.t === "iframe" || parsed.type === "iframe";
    } catch (error) {
      source = "";
    }
  } else if (/<iframe\b/i.test(raw)) {
    source = extractHtmlAttribute(raw, "src").replace(/&amp;/g, "&");
    width = toPositiveMediaSize(extractHtmlAttribute(raw, "width"));
    height = toPositiveMediaSize(extractHtmlAttribute(raw, "height"));
    forceIframe = true;
  }

  if (!isAllowedProductMediaUrl(source)) return "";
  const youtubeEmbedUrl = normalizeYoutubeEmbedUrl(source);
  if (youtubeEmbedUrl) return compactProductIframeValue(youtubeEmbedUrl, width, height);
  if (forceIframe && isExternalMediaUrl(source)) return compactProductIframeValue(source.slice(0, 190), width, height);
  return source.slice(0, 255);
}

function normalizeProductVideoForResponse(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("{")) return cleanProductMediaUrl(raw);
  if (/<iframe\b/i.test(raw)) return cleanProductMediaUrl(raw);
  if (isAllowedProductMediaUrl(raw)) {
    const youtubeEmbedUrl = normalizeYoutubeEmbedUrl(raw);
    return youtubeEmbedUrl ? compactProductIframeValue(youtubeEmbedUrl) : raw.slice(0, 255);
  }
  return "";
}

function normalizeProductNameMode(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  const aliases = {
    name1: "name_1",
    item_name_1: "name_1",
    "1": "name_1",
    name2: "name_2",
    item_name_2: "name_2",
    "2": "name_2",
    eng1: "name_eng_1",
    english1: "name_eng_1",
    name_en_1: "name_eng_1",
    "3": "name_eng_1",
    eng2: "name_eng_2",
    english2: "name_eng_2",
    name_en_2: "name_eng_2",
    "4": "name_eng_2",
  };
  const normalized = aliases[text] || text;
  if (!PRODUCT_NAME_MODE_FIELDS.has(normalized)) {
    if (text.includes("อังกฤษ") && text.includes("2")) return "name_eng_2";
    if (text.includes("อังกฤษ")) return "name_eng_1";
    if ((text.includes("ชื่อ") || text.includes("name")) && text.includes("2")) return "name_2";
    if ((text.includes("ชื่อ") || text.includes("name")) && text.includes("1")) return "name_1";
  }
  return PRODUCT_NAME_MODE_FIELDS.has(normalized) ? normalized : "";
}

function resolveProductName(row = {}, displayDefaults = {}) {
  const productMode = normalizeProductNameMode(row.dimension_32);
  const systemMode = normalizeProductNameMode(displayDefaults.product_name_display_mode);
  const groupMode = normalizeProductNameMode(row.group_name_2 || row.group_name_mode);
  const mode = productMode || systemMode || groupMode || "name_1";
  const displayName = cleanDimensionText(row[mode]) || cleanDimensionText(row.name_1) || cleanDimensionText(row.name_2) || cleanDimensionText(row.name_eng_1) || cleanDimensionText(row.name_eng_2) || cleanDimensionText(row.item_name);
  return {
    displayName,
    nameMode: mode,
    nameModeSource: productMode ? "product" : systemMode ? "system" : groupMode ? "group" : "default",
  };
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHiddenDetailFields(value) {
  const allowed = new Set(["brand", "model", "category", "size", "width_length_height", "weight", "stock", "sales", "volume"]);
  return parseCsvList(value).filter((item) => allowed.has(item));
}

function normalizeHiddenOnlineUnits(value) {
  const items = Array.isArray(value) ? value : parseCsvList(value);
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const code = cleanDimensionText(item, 40).replace(/,/g, "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result.join(",").slice(0, 255);
}

function normalizeSalesDisplayMode(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const text = String(value).trim();
    if (["0", "1", "2"].includes(text)) return text;
  }
  return "0";
}

function normalizeStarThresholds(value, fallback = DEFAULT_SALES_STAR_THRESHOLDS) {
  const nums = parseCsvList(value)
    .map((item) => toNumber(item, NaN))
    .filter((item) => Number.isFinite(item) && item > 0)
    .slice(0, 4);
  const isIncreasing = nums.every((item, index) => index === 0 || item > nums[index - 1]);
  return nums.length === 4 && isIncreasing ? nums.join(",") : fallback;
}

function isValidProvidedStarThresholds(value) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  const parts = parseCsvList(text);
  const nums = parts.map((item) => toNumber(item, NaN));
  if (nums.length !== 4) return false;
  if (nums.some((item) => !Number.isFinite(item) || item <= 0)) return false;
  return nums.every((item, index) => index === 0 || item > nums[index - 1]);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowsToCsv(rows, fields = PRODUCT_IMPORT_FIELDS) {
  const header = fields.map((field) => csvEscape(field.key)).join(",");
  const body = rows.map((row) => fields.map((field) => csvEscape(row[field.key] ?? "")).join(","));
  return ["\uFEFF" + header, ...body].join("\r\n");
}

function parseCsvText(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (inQuotes) {
    const error = new Error("รูปแบบ CSV ไม่ถูกต้อง: เครื่องหมาย quote ไม่ครบ");
    error.statusCode = 400;
    throw error;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((items) => items.some((item) => String(item || "").trim() !== ""));
}

function normalizeProductImportHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

function parseProductImportCsv(csvText) {
  const csvRows = parseCsvText(csvText);
  if (!csvRows.length) {
    const error = new Error("ไม่พบข้อมูลในไฟล์ CSV");
    error.statusCode = 400;
    throw error;
  }

  const headers = csvRows[0].map(normalizeProductImportHeader);
  if (!headers.includes("code")) {
    const error = new Error("ไฟล์ CSV ต้องมีคอลัมน์ code");
    error.statusCode = 400;
    throw error;
  }

  const unknownHeaders = headers.filter((header) => header && !PRODUCT_IMPORT_FIELD_MAP.has(header));
  if (unknownHeaders.length) {
    const error = new Error(`พบคอลัมน์ที่ระบบยังไม่รองรับ: ${unknownHeaders.slice(0, 8).join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const rows = [];
  for (let i = 1; i < csvRows.length; i += 1) {
    const raw = csvRows[i];
    const row = { _row_no: i + 1 };
    headers.forEach((header, index) => {
      if (!header) return;
      row[header] = raw[index] ?? "";
    });
    if (Object.keys(row).some((key) => key !== "_row_no" && String(row[key] || "").trim() !== "")) rows.push(row);
  }

  return { headers, rows };
}

function addProductImportError(errors, rowNo, code, field, message) {
  if (errors.length >= PRODUCT_IMPORT_ERROR_LIMIT) return;
  errors.push({ row_no: rowNo, code: code || "", field: field || "", message });
}

function cleanProductImportValue(field, value) {
  const raw = String(value ?? "").trim();
  if (field.normalizer) return field.normalizer(raw);
  return cleanDimensionText(raw, field.maxLength || 255);
}

async function fetchExistingProductCodes(codes, client = { query }) {
  const found = new Map();
  for (let i = 0; i < codes.length; i += PRODUCT_IMPORT_BATCH_SIZE) {
    const chunk = codes.slice(i, i + PRODUCT_IMPORT_BATCH_SIZE);
    const result = await client.query(`SELECT code FROM ic_inventory WHERE code = ANY($1::varchar[])`, [chunk]);
    result.rows.forEach((row) => found.set(row.code, row.code));
  }
  return found;
}

async function fetchProductUnitCodes(codes) {
  const result = new Map();
  for (let i = 0; i < codes.length; i += PRODUCT_IMPORT_BATCH_SIZE) {
    const chunk = codes.slice(i, i + PRODUCT_IMPORT_BATCH_SIZE);
    const rows = await query(`SELECT ic_code, code FROM ic_unit_use WHERE ic_code = ANY($1::varchar[])`, [chunk]);
    rows.rows.forEach((row) => {
      if (!result.has(row.ic_code)) result.set(row.ic_code, new Set());
      result.get(row.ic_code).add(row.code);
    });
  }
  return result;
}

async function fetchUnitMasterCodes(codes) {
  const result = new Set();
  const cleanCodes = [...new Set(codes.map((code) => String(code || "").trim()).filter(Boolean))];
  for (let i = 0; i < cleanCodes.length; i += PRODUCT_IMPORT_BATCH_SIZE) {
    const chunk = cleanCodes.slice(i, i + PRODUCT_IMPORT_BATCH_SIZE);
    const rows = await query(`SELECT code FROM ic_unit WHERE code = ANY($1::varchar[])`, [chunk]);
    rows.rows.forEach((row) => result.add(row.code));
  }
  return result;
}

async function validateProductImportRows(headers, rows) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  const updateFields = headers.filter((header) => header !== "code" && PRODUCT_IMPORT_FIELD_MAP.has(header));
  const preparedRows = [];
  const rawCodes = rows.map((row) => String(row.code || "").trim()).filter(Boolean);
  const uniqueCodes = [...new Set(rawCodes)];
  const existingCodes = await fetchExistingProductCodes(uniqueCodes);
  const unitCodesByProduct = headers.includes("dimension_37") ? await fetchProductUnitCodes(uniqueCodes) : new Map();
  const unitsToValidate = [];
  if (headers.includes("unit_standard")) rows.forEach((row) => unitsToValidate.push(row.unit_standard));
  if (headers.includes("unit_cost")) rows.forEach((row) => unitsToValidate.push(row.unit_cost));
  const unitMasterCodes = unitsToValidate.length ? await fetchUnitMasterCodes(unitsToValidate) : new Set();

  rows.forEach((row) => {
    const code = String(row.code || "").trim();
    if (!code) {
      addProductImportError(errors, row._row_no, "", "code", "ต้องระบุรหัสสินค้า");
      return;
    }
    if (seen.has(code)) {
      addProductImportError(errors, row._row_no, code, "code", `รหัสสินค้าซ้ำกับแถว ${seen.get(code)}`);
      return;
    }
    seen.set(code, row._row_no);
    if (!existingCodes.has(code)) {
      addProductImportError(errors, row._row_no, code, "code", "ไม่พบรหัสสินค้าในระบบ จึงไม่นำเข้าในเฟสแรก");
      return;
    }

    const prepared = { _row_no: row._row_no, code };
    updateFields.forEach((key) => {
      const field = PRODUCT_IMPORT_FIELD_MAP.get(key);
      const raw = row[key] ?? "";
      const text = String(raw ?? "").trim();
      if ((key === "unit_standard" || key === "unit_cost") && text && !unitMasterCodes.has(text)) {
        addProductImportError(errors, row._row_no, code, key, `ไม่พบหน่วยนับ ${text} ใน ic_unit`);
      }
      if (key === "dimension_32" && text && !normalizeProductNameMode(text)) {
        addProductImportError(errors, row._row_no, code, key, "ชื่อที่แสดงต้องเป็น name_1, name_2, name_eng_1 หรือ name_eng_2");
      }
      if (key === "dimension_33" && !isValidProvidedStarThresholds(text)) {
        addProductImportError(errors, row._row_no, code, key, "ช่วงระดับดาวต้องเป็นตัวเลข 4 ค่าเรียงจากน้อยไปมาก เช่น 100,500,1000,5000");
      }
      if (key === "dimension_34" && text && !["0", "1", "2"].includes(text)) {
        addProductImportError(errors, row._row_no, code, key, "การแสดงยอดขายต้องเป็น 0, 1 หรือ 2");
      }
      if (key === "dimension_35") {
        const allowed = new Set(["", "default", "inherit", "1", "0", "true", "false", "yes", "no", "on", "off", "enabled", "disabled", "allow", "deny"]);
        if (!allowed.has(text.toLowerCase())) addProductImportError(errors, row._row_no, code, key, "Preorder ต้องเป็น default, 1 หรือ 0");
      }
      if (key === "dimension_36" && text && !cleanProductMediaUrl(text)) {
        addProductImportError(errors, row._row_no, code, key, "วิดีโอสินค้าต้องเป็น /media/, http(s) URL, YouTube URL หรือ iframe ที่ถูกต้อง");
      }
      if (key === "dimension_37" && text) {
        const availableUnits = unitCodesByProduct.get(code) || new Set();
        const hiddenUnits = parseCsvList(text);
        hiddenUnits.forEach((unitCode) => {
          if (!availableUnits.has(unitCode)) addProductImportError(errors, row._row_no, code, key, `ไม่พบหน่วยนับ ${unitCode} ของสินค้านี้ใน ic_unit_use`);
        });
      }
      prepared[key] = cleanProductImportValue(field, raw);
    });
    preparedRows.push(prepared);
  });

  if (!updateFields.length) {
    addProductImportError(errors, 1, "", "header", "ต้องมีคอลัมน์ข้อมูลสำหรับอัปเดตอย่างน้อย 1 คอลัมน์ นอกจาก code");
  }

  if (errors.length >= PRODUCT_IMPORT_ERROR_LIMIT) {
    warnings.push(`แสดง error แรก ${PRODUCT_IMPORT_ERROR_LIMIT} รายการ กรุณาแก้ไฟล์แล้วตรวจสอบใหม่`);
  }

  return {
    success: errors.length === 0,
    total_rows: rows.length,
    valid_rows: errors.length === 0 ? preparedRows.length : 0,
    update_fields: updateFields,
    preview: preparedRows.slice(0, PRODUCT_IMPORT_PREVIEW_LIMIT),
    errors,
    warnings,
    preparedRows,
  };
}

async function updateProductImportBatch(client, rows, fields) {
  const inventoryFields = fields.filter((key) => PRODUCT_IMPORT_FIELD_MAP.get(key)?.table === "inventory");
  const detailFields = fields.filter((key) => PRODUCT_IMPORT_FIELD_MAP.get(key)?.table === "detail");

  for (let i = 0; i < rows.length; i += PRODUCT_IMPORT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + PRODUCT_IMPORT_BATCH_SIZE);

    if (inventoryFields.length) {
      const aliases = ["code", ...inventoryFields];
      const params = aliases.map((key) => chunk.map((row) => row[key] ?? ""));
      const selectColumns = aliases.map((key, index) => `$${index + 1}::text[]`).join(", ");
      const setSql = inventoryFields.map((key) => `${key}=v.${key}`).join(", ");
      await client.query(
        `UPDATE ic_inventory AS i SET ${setSql}
         FROM (SELECT * FROM UNNEST(${selectColumns}) AS t(${aliases.join(", ")})) AS v
         WHERE i.code = v.code`,
        params,
      );
    }

    if (detailFields.length) {
      const aliases = ["ic_code", ...detailFields];
      const params = aliases.map((key) => chunk.map((row) => (key === "ic_code" ? row.code : row[key] ?? "")));
      const selectColumns = aliases.map((key, index) => `$${index + 1}::text[]`).join(", ");
      const updateSql = detailFields.map((key) => `${key}=EXCLUDED.${key}`).join(", ");
      await client.query(
        `INSERT INTO ic_inventory_detail (${aliases.join(", ")})
         SELECT ${aliases.join(", ")} FROM UNNEST(${selectColumns}) AS t(${aliases.join(", ")})
         ON CONFLICT (ic_code) DO UPDATE SET ${updateSql}`,
        params,
      );
    }
  }
}

function decorateProductRow(row = {}, preorderDefaultEnabled = 0, displayDefaults = {}) {
  const name = resolveProductName(row, displayDefaults);
  const hiddenDetailFields = normalizeHiddenDetailFields(row.dimension_31);
  const salesDisplayMode = normalizeSalesDisplayMode(row.dimension_34, displayDefaults.sales_display_mode, row.barcode_sales_display_mode);
  const salesStarThresholds = normalizeStarThresholds(row.dimension_33, displayDefaults.sales_star_thresholds || DEFAULT_SALES_STAR_THRESHOLDS);
  const productVideoUrl = normalizeProductVideoForResponse(row.dimension_36);
  const preorderMode = normalizePreorderMode(row.dimension_35);
  const preorderAllowed = resolvePreorderAllowed(preorderMode, preorderDefaultEnabled);
  const preorderOnlyAvailable = preorderAllowed && String(row.sold_out) === "1" ? 1 : 0;
  return {
    ...row,
    sold_out: preorderAllowed ? "0" : row.sold_out,
    preorder_only_available: preorderOnlyAvailable,
    item_name: name.displayName,
    display_name: name.displayName,
    item_name_display: name.displayName,
    name_display_mode: name.nameMode,
    name_display_source: name.nameModeSource,
    hidden_detail_fields: hiddenDetailFields,
    hidden_detail_fields_csv: hiddenDetailFields.join(","),
    sales_display_mode: salesDisplayMode,
    sales_star_thresholds: salesStarThresholds,
    product_video_url: productVideoUrl,
    preorder_mode: preorderMode,
    preorder_allowed: preorderAllowed,
    // Maximum Allowance ต่อหน่วย (REQ3) — { "ชิ้น": 100, "ลัง": 5 } · {} = ไม่จำกัด
    max_order_qty_by_unit: parseMaxAllowance(row.dimension_38),
  };
}

function getVirtualCategory(code) {
  const categoryCode = cleanCategoryCode(code);
  return VIRTUAL_CATEGORIES.find((category) => category.code === categoryCode) || null;
}

function withCategoryMeta(category, categoryMeta) {
  const meta = categoryMeta[category.code] || {};
  return {
    ...category,
    image_url: meta.image_url || "",
  };
}

async function readCategoryMeta() {
  try {
    const raw = await fs.readFile(CATEGORY_META_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeCategoryMeta(meta) {
  await fs.mkdir(CONTENT_DIR, { recursive: true });
  await fs.writeFile(CATEGORY_META_FILE, JSON.stringify(meta, null, 2), "utf8");
}

async function saveCategoryMeta(code, patch) {
  const categoryCode = cleanCategoryCode(code);
  const meta = await readCategoryMeta();
  const current = meta[categoryCode] || {};
  meta[categoryCode] = {
    ...current,
    ...patch,
    image_url: cleanCategoryImageUrl(patch.image_url ?? current.image_url),
  };
  await writeCategoryMeta(meta);
  return meta[categoryCode];
}

async function deleteCategoryMeta(code) {
  const categoryCode = cleanCategoryCode(code);
  const meta = await readCategoryMeta();
  delete meta[categoryCode];
  await writeCategoryMeta(meta);
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
      [custCode],
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

// GET /service/v1/getProductList
// เลียนแบบ Java ทุกอย่าง: dynamic WHERE, pagination ด้วย offset/limit
router.get("/getProductList", async (req, res) => {
  const {
    cust_code: strCustCode = "",
    search: strSearch = "",
    category: strCategory = "",
    offset: strOffset = "0",
    premium: strPremium = "",
    ispromotion: strPromotion = "",
    isstock: strStock = "",
    favorite: strFavorite = "",
    isproductset: strProductSet = "",
    include_all_pattern: strIncludeAllPattern = "",
    feature_type: strFeatureType = "recommend",
    limit: strLimit = "20",
  } = req.query;

  const resp = { success: false };

  try {
    await ensureSalesSettingsTables();
    const [stockDisplayPercent, preorderDefaultEnabled, displayDefaults] = await Promise.all([
      getStockDisplayPercent(),
      getPreorderDefaultEnabled(),
      getMarketplaceDisplayDefaults(),
    ]);
    const safeFeatureType = cleanFeatureType(strFeatureType);
    const safeCustCodeSql = strCustCode.replace(/'/g, "''");
    // ใช้ predicate เดียวกันทั้งกรอง ispromotion=1 และคำนวณ is_promotion
    // เพื่อไม่ให้รายการหมดอายุหลุดเข้ามา หรือส่วนลดที่ยัง active ถูกตัดออก
    const activePromotionCondition =
      `(` +
      ` EXISTS (SELECT 1 FROM ic_inventory_price ip` +
      `   WHERE ip.ic_code=b.code` +
      `     AND CURRENT_DATE BETWEEN ip.from_date AND ip.to_date` +
      `     AND (ip.cust_code='' OR ip.cust_code='${safeCustCodeSql}')` +
      `     AND (ip.cust_group_1='' OR ip.cust_group_1=(SELECT group_main FROM ar_customer_detail WHERE ar_code='${safeCustCodeSql}')))` +
      ` OR EXISTS (SELECT 1 FROM ic_inventory_discount id` +
      `   WHERE id.ic_code=b.code` +
      `     AND CURRENT_DATE BETWEEN id.from_date AND id.to_date` +
      `     AND (` +
      `       id.discount_type=0` +
      `       OR (id.discount_type=2 AND id.cust_code='${safeCustCodeSql}')` +
      `       OR (id.discount_type=1 AND id.cust_group_1=(SELECT group_main FROM ar_customer_detail WHERE ar_code='${safeCustCodeSql}'))` +
      `     ))` +
      ` OR ${PROMOTION_SWITCH_ON_SQL("c")}` +
      `)`;
    // เลียนแบบ Java search condition: ค้นหา name_1, code, name_eng_2 + barcode (1 สินค้ามีหลายบาร์โค้ด)
    let searchWhere = "";
    if (strSearch && strSearch.trim()) {
      const keywords = strSearch.trim().split(" ");
      const fields = ["b.name_1", "b.code", "b.name_eng_1", "b.name_eng_2"];
      // escapeLike กัน % และ _ ที่ผู้ใช้พิมพ์ไม่ให้กลายเป็น wildcard (ดู src/utils/likePattern.js)
      // ส่วน replace(/'/g,"''") เดิมกัน quote ของ SQL คนละเรื่องกัน ต้องมีทั้งคู่
      const likeTerm = (k) => escapeLike(k.toUpperCase()).replace(/'/g, "''");
      const parts = fields.map((field) => {
        const kw = keywords.map((k) => `upper(${field}) LIKE '%${likeTerm(k)}%'`).join(" AND ");
        return `(${kw})`;
      });
      const barcodeKw = keywords.map((k) => `upper(ibc.barcode) LIKE '%${likeTerm(k)}%'`).join(" AND ");
      parts.push(`EXISTS (SELECT 1 FROM ic_inventory_barcode ibc WHERE ibc.ic_code = b.code AND (${barcodeKw}))`);
      searchWhere = ` AND (${parts.join(" OR ")}) `;
    }

    let whereFinal = searchWhere;

    if (strCategory && strCategory.trim()) {
      whereFinal += ` AND b.item_category='${strCategory.replace(/'/g, "''")}'`;
    }
    if (strPremium === "1") {
      // ช่องสินค้าแนะนำใช้ธงมาตรฐานของสินค้าใน ERP โดยตรง
      // ส่วนสินค้าใหม่ยังใช้ marketplace_featured_product เพื่อรองรับช่วงวันที่
      whereFinal += safeFeatureType === "recommend" ? ` AND COALESCE(c.is_premium,0)=1` : ` AND mfp.item_code IS NOT NULL`;
    }
    if (strProductSet === "1") whereFinal += ` AND b.item_type='3'`;
    if (strFavorite === "1") whereFinal += ` AND arc.status='1'`;

    if (strPromotion === "1") whereFinal += ` AND ${activePromotionCondition}`;

    // stockQtyExpr เหมือน Java
    const stockQtyExpr =
      `((select balance_qty from ic_inventory where code=b.code) / ` +
      `NULLIF( ((select unit_standard_stand_value from ic_inventory where code=b.code) / ` +
      `NULLIF((select unit_standard_divide_value from ic_inventory where code=b.code),0) ), 0))`;
    const displayStockQtyExpr = `TRUNC(COALESCE((${stockQtyExpr}),0) * ${stockDisplayPercent} / 100, 0)`;
    const orderableStockQtyExpr = `(CASE WHEN COALESCE(b.item_type,0)=3 THEN COALESCE(ss.balance_qty,0) ELSE ${displayStockQtyExpr} END)`;

    if (strStock === "1") {
      whereFinal += ` AND (${orderableStockQtyExpr} > 0 )`;
    }

    const includeAllPattern = ["1", "true", "yes"].includes(String(strIncludeAllPattern).trim().toLowerCase());
    const patternWhere = includeAllPattern ? "" : " and b.item_pattern = '[W]' ";

    const baseFrom =
      ` FROM ic_inventory b` +
      ` LEFT JOIN ic_inventory_detail c ON b.code=c.ic_code` +
      ` LEFT JOIN ic_group g ON g.code=b.group_main` +
      ` LEFT JOIN marketplace_featured_product mfp ON mfp.item_code=b.code` +
      `   AND mfp.feature_type='${safeFeatureType}'` +
      `   AND COALESCE(mfp.status,1)=1` +
      `   AND (mfp.from_date IS NULL OR mfp.from_date <= CURRENT_DATE)` +
      `   AND (mfp.to_date IS NULL OR mfp.to_date >= CURRENT_DATE)` +
      ` LEFT JOIN LATERAL (` +
      `   SELECT COALESCE(MIN(TRUNC((component_stock.sum_balance_qty * ${stockDisplayPercent} / 100) / NULLIF(component_stock.qty,0),0)),0) AS balance_qty` +
      `   FROM (` +
      `     SELECT d.ic_code, d.qty, SUM(COALESCE(f.balance_qty,0)) AS sum_balance_qty` +
      `     FROM ic_inventory_set_detail d` +
      `     LEFT JOIN LATERAL (` +
      `       SELECT balance_qty` +
      `       FROM sml_ic_function_stock_balance_warehouse_location('NOW()', d.ic_code, '', '')` +
      `       WHERE balance_qty > 0` +
      `     ) f ON TRUE` +
      `     WHERE d.ic_set_code=b.code` +
      `     GROUP BY d.ic_code, d.qty` +
      `   ) component_stock` +
      ` ) ss ON COALESCE(b.item_type,0)=3` +
      ` LEFT JOIN LATERAL (` +
      `   SELECT u.code, u.stand_value, u.divide_value, u.ratio, u.row_order` +
      `   FROM ic_unit_use u` +
      `   WHERE u.ic_code=b.code` +
      `     AND NOT (u.code = ANY(string_to_array(COALESCE(c.dimension_37,''), ',')))` +
      `   ORDER BY` +
      // หน่วยเริ่มต้นขาย (ic_inventory_detail.start_sale_unit) ต้องชนะเสมอ — หน้ารายการโชว์ราคาหน่วยนี้ก่อน
      // ถ้าไม่ได้ตั้งไว้ (หรือหน่วยนั้นถูกซ่อนออนไลน์ผ่าน dimension_37) ค่อยตกไปหน่วยเล็กสุดตามเดิม
      `     CASE WHEN u.code = NULLIF(c.start_sale_unit,'') THEN 0 ELSE 1 END,` +
      `     CASE WHEN COALESCE(u.stand_value,0) > 0 THEN 0 ELSE 1 END,` +
      `     COALESCE(NULLIF(u.stand_value,0),999999999),` +
      `     COALESCE(u.row_order,999999), COALESCE(NULLIF(u.ratio,0),1), u.code` +
      `   LIMIT 1` +
      ` ) online_unit ON TRUE` +
      ` LEFT JOIN ar_item_by_customer arc ON arc.ic_code = b.code AND arc.ar_code='${strCustCode.replace(/'/g, "''")}'` +
      ` WHERE 1=1 ${patternWhere} ${whereFinal}`;

    const dataSQL =
      `SELECT b.code AS item_code, COALESCE(b.name_1,'') AS name_1, COALESCE(b.name_2,'') AS name_2,` +
      ` COALESCE(b.name_eng_1,'') AS name_eng_1, COALESCE(b.name_eng_2,'') AS name_eng_2,` +
      ` COALESCE(c.dimension_32,'') AS dimension_32, COALESCE(c.dimension_35,'') AS dimension_35,` +
      ` COALESCE(c.dimension_38,'') AS dimension_38, COALESCE(g.name_2,'') AS group_name_2,` +
      ` c.start_sale_unit,b.unit_cost,b.unit_standard, b.item_type, online_unit.code AS online_sale_unit,` +
      ` online_unit.stand_value, online_unit.divide_value, online_unit.ratio,` +
      ` COALESCE((SELECT ib.barcode FROM ic_inventory_barcode ib` +
      `   WHERE ib.ic_code = b.code` +
      `     AND ib.unit_code = COALESCE(NULLIF(online_unit.code,''), NULLIF(c.start_sale_unit,''), NULLIF(b.unit_standard,''), NULLIF(b.unit_cost,''), '')` +
      `   ORDER BY ib.barcode LIMIT 1),'') AS barcode,` +
      ` (CASE WHEN ${orderableStockQtyExpr} <= 0 THEN '1' ELSE '0' END) AS sold_out,` +
      ` CASE WHEN COALESCE(b.item_grade,'') = 'R' THEN '1' ELSE '0' END AS is_return,` +
      ` CASE WHEN ${activePromotionCondition} THEN '1' ELSE '0' END AS is_promotion,` +
      ` COALESCE(arc.status,0) AS favorite_item` +
      `${baseFrom} ORDER BY ${strPremium === "1" && safeFeatureType !== "recommend" ? "COALESCE(mfp.line_number,0), b.code" : "b.code"} OFFSET ${Math.max(0, toInt(strOffset, 0))} LIMIT ${Math.max(1, toInt(strLimit, 20))}`;

    const dataResult = await query(dataSQL, []);

    const data = dataResult.rows.map((r) => {
      const product = decorateProductRow(r, preorderDefaultEnabled, displayDefaults);
      return {
        item_code: product.item_code,
        item_name: product.item_name,
        name_1: product.name_1 || "",
        name_2: product.name_2 || "",
        name_eng_1: product.name_eng_1 || "",
        name_eng_2: product.name_eng_2 || "",
        display_name: product.display_name,
        item_name_display: product.item_name_display,
        name_display_mode: product.name_display_mode,
        name_display_source: product.name_display_source,
        preorder_allowed: product.preorder_allowed,
        preorder_mode: product.preorder_mode,
        max_order_qty_by_unit: product.max_order_qty_by_unit || {},
        preorder_only_available: product.preorder_only_available,
        item_type: product.item_type,
        sold_out: product.sold_out,
        unit_code: product.online_sale_unit || product.unit_code || "",
        online_sale_unit: product.online_sale_unit || product.unit_code || "",
        unit_standard: product.unit_standard,
        unit_cost: product.unit_cost,
        start_sale_unit: product.start_sale_unit,
        stand_value: product.stand_value,
        divide_value: product.divide_value,
        ratio: product.ratio,
        barcode: product.barcode,
        is_promotion: product.is_promotion,
        favorite_item: product.favorite_item,
        is_return: product.is_return,
      };
    });

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getProductDetail
// เลียนแบบ Java: CTE balance_stock + ic_unit_use + เรียก getProductPriceLocalx ต่อ unit
router.get("/getProductDetail", async (req, res) => {
  const {
    cust_code: strCustCode = "",
    item_code: strItemCode = "",
    show_promotion: strShowPromotion = "1",
    sale_type: strSaleType = "",
    vat_type: strVatType = "",
    vat_rate: strVatRate = "",
    doc_date: strDocDate = "",
    wh_code: strWhCode = "",
  } = req.query;
  const resp = { success: false };
  const effectiveWhCode = String(strWhCode || DEFAULT_WH_CODE).trim();
  const safeWhCode = effectiveWhCode.replace(/'/g, "''");
  const safeShelfCode = DEFAULT_SHELF_CODE.replace(/'/g, "''");

  // ⚠️ ฟังก์ชันสต็อกของ ERP เอาค่าไปต่อ SQL แล้ว EXECUTE เอง $1 จึงกันไม่ได้
  //    ต้องกรองรหัสก่อนเสมอ ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ item_code: strItemCode, wh_code: effectiveWhCode });
  if (codeError) return res.status(400).json({ success: false, ERROR: codeError });

  try {
    const [stockDisplayPercent, preorderDefaultEnabled, displayDefaults] = await Promise.all([
      getStockDisplayPercent(),
      getPreorderDefaultEnabled(),
      getMarketplaceDisplayDefaults(),
    ]);
    const sql = `
      WITH product_setting AS (
        SELECT
          COALESCE((SELECT NULLIF(start_sale_wh,'') FROM ic_inventory_detail WHERE ic_code='${strItemCode.replace(/'/g, "''")}' LIMIT 1), '${safeWhCode}') AS stock_wh,
          COALESCE((SELECT NULLIF(start_sale_shelf,'') FROM ic_inventory_detail WHERE ic_code='${strItemCode.replace(/'/g, "''")}' LIMIT 1), '${safeShelfCode}') AS stock_shelf
      ),
      balance_stock AS (
        SELECT s.ic_code, SUM(s.balance_qty) AS sum_balance_qty
        FROM product_setting ps
        CROSS JOIN LATERAL sml_ic_function_stock_balance_warehouse_location(current_date,'${strItemCode.replace(/'/g, "''")}', ps.stock_wh, '') s
        WHERE balance_qty > 0
        GROUP BY s.ic_code
      )
      SELECT a.ic_code, COALESCE(b.name_1,'') AS name_1, COALESCE(b.name_2,'') AS name_2,
        COALESCE(b.name_eng_1,'') AS name_eng_1, COALESCE(b.name_eng_2,'') AS name_eng_2,
        COALESCE(c.dimension_31,'') AS dimension_31, COALESCE(c.dimension_32,'') AS dimension_32,
        COALESCE(c.dimension_33,'') AS dimension_33, COALESCE(c.dimension_34,'') AS dimension_34,
        COALESCE(c.dimension_35,'') AS dimension_35, COALESCE(c.dimension_36,'') AS dimension_36,
        COALESCE(c.dimension_37,'') AS dimension_37, COALESCE(c.dimension_38,'') AS dimension_38,
        CASE WHEN ${PROMOTION_SWITCH_ON_SQL("c")} THEN COALESCE(c.dimension_39,'') ELSE '' END AS promotion_detail, COALESCE(g.name_2,'') AS group_name_2,
        a.code AS unit_code, b.item_type,
        COALESCE(b.tax_type,0) AS tax_type,
        COALESCE(ib.barcode,'') AS barcode,
        ib.price_member_3 AS barcode_sales_display_mode,
        0 AS barcode_online_visibility,
        CASE WHEN COALESCE(b.item_grade,'') = upper('r') THEN '1' ELSE '0' END AS is_return,
        COALESCE(b.description,'') AS description,
        TRUNC(COALESCE((SELECT sum_balance_qty FROM balance_stock g WHERE g.ic_code=a.ic_code LIMIT 1),0) * ${stockDisplayPercent} / 100, 0) AS sum_balance_qty,
        TRUNC((COALESCE((SELECT sum_balance_qty FROM balance_stock g WHERE g.ic_code=a.ic_code LIMIT 1),0) * ${stockDisplayPercent} / 100)/COALESCE(NULLIF(a.ratio,0),1),0) AS balance_qty,
        (CASE WHEN TRUNC(COALESCE((SELECT sum_balance_qty FROM balance_stock g WHERE g.ic_code=a.ic_code LIMIT 1),0) * ${stockDisplayPercent} / 100, 0) <= ROUND(COALESCE(c.minimum_qty,0)) THEN '1' ELSE '0' END) AS sold_out,
        COALESCE(((SELECT SUM(qty) FROM ic_trans_detail e WHERE a.ic_code=e.item_code AND a.code=e.unit_code AND e.doc_date BETWEEN '2025-01-01' AND 'NOW()' LIMIT 1)
          *(SELECT stand_value FROM ic_trans_detail e WHERE a.ic_code=e.item_code AND a.code=e.unit_code LIMIT 1)),0) AS sum_sale,
        COALESCE((SELECT status FROM ar_item_by_customer WHERE ic_code=b.code AND ar_code='${strCustCode.replace(/'/g, "''")}' LIMIT 1),0) AS favorite_item,
        CASE WHEN (
          COALESCE((SELECT ic_code FROM ic_inventory_price WHERE ic_code = b.code
            AND unit_code = a.code
            AND CURRENT_DATE BETWEEN from_date AND to_date
            AND ((cust_code = '' OR cust_code = '${strCustCode.replace(/'/g, "''")}')
            AND (cust_group_1 = '' OR cust_group_1=(SELECT ar_customer_detail.group_main FROM ar_customer_detail WHERE ar_customer_detail.ar_code='${strCustCode.replace(/'/g, "''")}'))) LIMIT 1),'') != ''
          OR EXISTS (SELECT 1 FROM ic_inventory_discount
            WHERE ic_code = b.code
              AND unit_code = a.code
              AND CURRENT_DATE BETWEEN from_date AND to_date
              AND (
                discount_type = 0
                OR (discount_type = 2 AND cust_code = '${strCustCode.replace(/'/g, "''")}')
                OR (discount_type = 1 AND cust_group_1 = (SELECT group_main FROM ar_customer_detail WHERE ar_code='${strCustCode.replace(/'/g, "''")}'))
              ))
          OR ${PROMOTION_SWITCH_ON_SQL("c")}
        ) THEN '1' ELSE '0' END AS is_promotion,
        0 AS price,
        ps.stock_wh, ps.stock_shelf, c.start_sale_wh, c.start_sale_shelf, a.stand_value, a.divide_value, a.ratio
      FROM ic_unit_use a
      CROSS JOIN product_setting ps
      LEFT JOIN ic_inventory b ON a.ic_code=b.code
      LEFT JOIN ic_inventory_detail c ON a.ic_code=c.ic_code
      LEFT JOIN ic_group g ON g.code=b.group_main
      LEFT JOIN LATERAL (
        SELECT barcode, price_member_3
        FROM ic_inventory_barcode ib
        WHERE ib.ic_code=a.ic_code AND ib.unit_code=a.code
        ORDER BY barcode
        LIMIT 1
      ) ib ON TRUE
      WHERE a.ic_code IN ('${strItemCode.replace(/'/g, "''")}')
        AND NOT (a.code = ANY(string_to_array(COALESCE(c.dimension_37,''), ',')))
      -- แถวแรก = หน่วยที่หน้ารายละเอียดเลือกให้อัตโนมัติ — หน่วยเริ่มต้นขายต้องมาก่อน
      -- ไม่ได้ตั้งไว้ค่อยเรียงตาม ratio (หน่วยเล็กสุดก่อน) เหมือนเดิม
      ORDER BY a.ic_code, CASE WHEN a.code = NULLIF(c.start_sale_unit,'') THEN 0 ELSE 1 END, ratio
    `;

    const result = await query(sql, []);
    const basketCtx = await resolveBasketPricingContext(strCustCode);
    const saleTypeReq = toInt(strSaleType, NaN);
    const vatTypeReq = toInt(strVatType, NaN);
    const vatRateReq = toNumber(strVatRate, NaN);
    const docDate = strDocDate.trim() || undefined;

    const data = [];

    for (const r of result.rows) {
      const product = decorateProductRow(r, preorderDefaultEnabled, displayDefaults);
      const obj = {
        barcode: r.barcode,
        item_type: r.item_type,
        item_code: r.ic_code,
        item_name: product.item_name,
        name_1: r.name_1 || "",
        name_2: r.name_2 || "",
        name_eng_1: r.name_eng_1 || "",
        name_eng_2: r.name_eng_2 || "",
        display_name: product.display_name,
        item_name_display: product.item_name_display,
        name_display_mode: product.name_display_mode,
        name_display_source: product.name_display_source,
        hidden_detail_fields: product.hidden_detail_fields,
        hidden_detail_fields_csv: product.hidden_detail_fields_csv,
        sales_display_mode: product.sales_display_mode,
        sales_star_thresholds: product.sales_star_thresholds,
        product_video_url: product.product_video_url,
        preorder_allowed: product.preorder_allowed,
        preorder_mode: product.preorder_mode,
        max_order_qty_by_unit: product.max_order_qty_by_unit || {},
        online_visibility: r.barcode_online_visibility,
        unit_code: r.unit_code,
        balance_qty: r.balance_qty,
        sum_balance_qty: r.sum_balance_qty,
        sold_out: r.sold_out,
        sum_sale: r.sum_sale,
        wh_code: r.stock_wh || effectiveWhCode,
        shelf_code: r.stock_shelf || DEFAULT_SHELF_CODE,
        stand_value: r.stand_value,
        divide_value: r.divide_value,
        ratio: r.ratio,
        favorite_item: r.favorite_item,
        is_promotion: r.is_promotion,
        price: "0",
        is_return: r.is_return,
        description: r.description,
        // รายละเอียดโปรโมชั่นที่แอดมินพิมพ์เอง (ic_inventory_detail.dimension_39)
        promotion_detail: r.promotion_detail,
        promotion: [],
      };

      try {
        const saleType = Number.isNaN(saleTypeReq) ? (Number.isNaN(basketCtx.saleType) ? 0 : basketCtx.saleType) : saleTypeReq;
        const vatType = Number.isNaN(vatTypeReq) ? (Number.isNaN(basketCtx.vatType) ? toInt(r.tax_type, 0) : basketCtx.vatType) : vatTypeReq;
        const vatRate = Number.isNaN(vatRateReq) ? (Number.isNaN(basketCtx.vatRate) ? null : basketCtx.vatRate) : vatRateReq;

        const priceRes = await getProductPriceLocalx(r.ic_code, r.unit_code, "1", strCustCode, vatType, vatRate, saleType, r.barcode, docDate);
        const arr = priceRes.data || [];
        if (arr.length > 0) {
          const priceObj = arr[0];
          obj.price = String(priceObj.price || "0");
          const type = String(priceObj.type || "0");
          const mode = String(priceObj.mode || "0");
          const roworder = String(priceObj.roworder || "0");
          obj.type = type;
          obj.mode = mode;
          obj.price_type = roworder;

          if (strShowPromotion == "1") {
            // Show only the promotion ladder for the same price source selected by getProductPriceLocalx.
            if (["1", "2", "3"].includes(type)) {
              const proParams = [r.ic_code, r.unit_code, mode];
              let moreWhere = "";
              if (type === "1") {
                moreWhere = " AND price_type=3 AND cust_code=$4";
                proParams.push(strCustCode);
              } else if (type === "2") {
                moreWhere = `
                 AND price_type=2
                 AND cust_group_1=(SELECT group_main FROM ar_customer_detail WHERE ar_code=$4)
                 AND (
                   cust_group_2=(SELECT group_sub_1 FROM ar_customer_detail WHERE ar_code=$4)
                   OR cust_group_2=(SELECT group_sub_3 FROM ar_customer_detail WHERE ar_code=$4)
                   OR cust_group_2=(SELECT group_sub_4 FROM ar_customer_detail WHERE ar_code=$4)
                   OR COALESCE(cust_group_2,'')=''
                 )`;
                proParams.push(strCustCode);
              } else if (type === "3") {
                moreWhere = " AND price_type=1";
              }
              const saleTypeSecondary = (toInt(saleType, 0) === 0 || toInt(saleType, 0) === 2) ? 2 : 1;
              const saleTypeParamIndex = proParams.length + 1;
              proParams.push(saleTypeSecondary);
              const proResult = await query(
                `SELECT line_number, sale_price2 AS price, from_qty, to_qty,
                COALESCE((SELECT name_1 FROM ic_unit WHERE code=unit_code), unit_code) AS unit_name,
                COALESCE((SELECT name_2 FROM ic_unit WHERE code=unit_code), '') AS unit_name_2
               FROM ic_inventory_price
               WHERE ic_code=$1 AND unit_code=$2
                 AND CURRENT_DATE BETWEEN from_date AND to_date
                 AND price_mode=$3
                 ${moreWhere}
                 AND sale_type IN (0, $${saleTypeParamIndex})
               ORDER BY from_qty ASC, line_number ASC`,
                proParams,
              );
              let lineNum = 1;
              obj.promotion = proResult.rows.map((p) => ({
                from_qty: p.from_qty,
                to_qty: p.to_qty,
                unit_name: p.unit_name,
                unit_name_2: p.unit_name_2 || "",
                price: p.price,
                line_number: lineNum++,
              }));
            }

            // query discount_promotion จาก ic_inventory_discount (ไม่ filter qty)
            const dpResult = await query(
              `SELECT from_qty, to_qty, discount, discount_type, line_number
               FROM ic_inventory_discount
               WHERE ic_code=$1 AND unit_code=$2
                 AND CURRENT_DATE BETWEEN from_date AND to_date
                 AND (
                   discount_type = 0
                   OR (discount_type = 2 AND cust_code = $3)
                   OR (discount_type = 1 AND cust_group_1 = (SELECT group_main FROM ar_customer_detail WHERE ar_code = $3))
                 )
               ORDER BY discount_type DESC, line_number`,
              [r.ic_code, r.unit_code, strCustCode],
            );
            obj.discount_promotion = dpResult.rows.map((d) => ({
              from_qty: d.from_qty,
              to_qty: d.to_qty,
              discount: d.discount,
              discount_type: d.discount_type,
            }));
          }
        }
      } catch (ex) {
        console.error(`getProductDetail price/promotion error for ${r.ic_code}/${r.unit_code}:`, ex.message);
      }

      data.push(obj);
    }

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getProductSetDetail
// เลียนแบบ Java: CTE set_detail + balance_stock + set_stock + set_price
router.get("/getProductSetDetail", async (req, res) => {
  const { cust_code: strCustCode = "", item_code: strItemCode = "", wh_code: strWhCode = "" } = req.query;
  const resp = { success: false };
  const effectiveWhCode = String(strWhCode || DEFAULT_WH_CODE).trim();
  const safeWhCode = effectiveWhCode.replace(/'/g, "''");
  const safeShelfCode = DEFAULT_SHELF_CODE.replace(/'/g, "''");

  // ⚠️ ฟังก์ชันสต็อกของ ERP เอาค่าไปต่อ SQL แล้ว EXECUTE เอง $1 จึงกันไม่ได้
  //    ต้องกรองรหัสก่อนเสมอ ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ item_code: strItemCode, wh_code: effectiveWhCode });
  if (codeError) return res.status(400).json({ success: false, ERROR: codeError });

  try {
    const stockDisplayPercent = await getStockDisplayPercent();
    const sql = `
      WITH product_setting AS (
        SELECT
          COALESCE((SELECT NULLIF(start_sale_wh,'') FROM ic_inventory_detail WHERE ic_code='${strItemCode.replace(/'/g, "''")}' LIMIT 1), '${safeWhCode}') AS stock_wh,
          COALESCE((SELECT NULLIF(start_sale_shelf,'') FROM ic_inventory_detail WHERE ic_code='${strItemCode.replace(/'/g, "''")}' LIMIT 1), '${safeShelfCode}') AS stock_shelf
      ),
      set_detail AS (
        SELECT ic_set_code, ic_code, qty
        FROM ic_inventory_set_detail
        WHERE ic_set_code = '${strItemCode.replace(/'/g, "''")}'
      ),
      balance_stock AS (
        SELECT d.ic_set_code, d.ic_code, d.qty,
               -- ต้องมี COALESCE ชิ้นส่วนที่ไม่มีแถวสต็อกเลยจะได้ NULL จาก LEFT JOIN LATERAL
               -- แล้ว MIN() ข้าม NULL ทิ้ง ชุดที่มีชิ้นส่วนหมดจึงแสดงว่ามีของเต็มคลัง
               -- (getProductList บรรทัด 896 กับ order.js/cart.js เขียนถูกอยู่แล้ว)
               SUM(COALESCE(f.balance_qty, 0)) AS sum_balance_qty
        FROM set_detail d
        CROSS JOIN product_setting ps
        LEFT JOIN LATERAL (
          SELECT balance_qty
          FROM sml_ic_function_stock_balance_warehouse_location(current_date, d.ic_code, ps.stock_wh, '')
          WHERE balance_qty > 0
        ) f ON TRUE
        GROUP BY d.ic_set_code, d.ic_code, d.qty
      ),
      set_stock AS (
        SELECT ic_set_code, MIN(TRUNC((sum_balance_qty * ${stockDisplayPercent} / 100) / NULLIF(qty,0), 0)) AS set_balance_qty
        FROM balance_stock
        GROUP BY ic_set_code
      ),
      set_price AS (
        SELECT ic_set_code, SUM(sum_amount) AS set_price
        FROM ic_inventory_set_detail
        WHERE ic_set_code = '${strItemCode.replace(/'/g, "''")}'
        GROUP BY ic_set_code
      )
      SELECT i.code AS ic_code, i.item_type,
             i.name_1 AS item_name,
             COALESCE(i.name_2,'') AS name_2,
             COALESCE(i.name_eng_1,'') AS name_eng_1,
             COALESCE(i.name_eng_2,'') AS name_eng_2,
             u.code AS unit_code,
             CASE WHEN COALESCE(i.item_grade,'') = upper('r') THEN '1' ELSE '0' END AS is_return,
             COALESCE(i.description,'') AS description,
             COALESCE(ss.set_balance_qty,0) AS balance_qty,
             CASE WHEN COALESCE(ss.set_balance_qty,0) <= ROUND(COALESCE(d.minimum_qty,0)) THEN '1' ELSE '0' END AS sold_out,
             0 AS sum_sale,
             COALESCE(f.status,0) AS favorite_item,
             COALESCE(sp.set_price,0) AS price,
             COALESCE(ib.barcode,'') AS barcode,
             d.start_sale_wh, d.start_sale_shelf,
             ps.stock_wh, ps.stock_shelf,
             COALESCE(d.dimension_31,'') AS dimension_31,
             COALESCE(d.dimension_32,'') AS dimension_32,
             COALESCE(d.dimension_33,'') AS dimension_33,
             COALESCE(d.dimension_34,'') AS dimension_34,
             COALESCE(d.dimension_35,'') AS dimension_35,
             COALESCE(d.dimension_36,'') AS dimension_36,
             COALESCE(d.dimension_37,'') AS dimension_37,
             COALESCE(d.dimension_38,'') AS dimension_38,
             CASE WHEN ${PROMOTION_SWITCH_ON_SQL("d")} THEN COALESCE(d.dimension_39,'') ELSE '' END AS promotion_detail,
             COALESCE(g.name_2,'') AS group_name_2,
             ib.price_member_3 AS barcode_sales_display_mode,
             0 AS barcode_online_visibility,
             u.stand_value, u.divide_value, u.ratio
      FROM ic_inventory i
      CROSS JOIN product_setting ps
      LEFT JOIN ic_unit_use u ON i.code = u.ic_code
      LEFT JOIN ic_inventory_detail d ON i.code = d.ic_code
      LEFT JOIN ic_group g ON g.code = i.group_main
      LEFT JOIN set_stock ss ON i.code = ss.ic_set_code
      LEFT JOIN set_price sp ON i.code = sp.ic_set_code
      LEFT JOIN ar_item_by_customer f ON f.ic_code = i.code AND f.ar_code = '${strCustCode.replace(/'/g, "''")}'
      LEFT JOIN LATERAL (
        SELECT barcode, price_member_3
        FROM ic_inventory_barcode ib
        WHERE ib.ic_code = i.code AND ib.unit_code = u.code
        ORDER BY barcode
        LIMIT 1
      ) ib ON TRUE
      WHERE i.code = '${strItemCode.replace(/'/g, "''")}'
        AND NOT (u.code = ANY(string_to_array(COALESCE(d.dimension_37,''), ',')))
      ORDER BY u.ratio
    `;

    const [result, preorderDefaultEnabled, displayDefaults] = await Promise.all([query(sql, []), getPreorderDefaultEnabled(), getMarketplaceDisplayDefaults()]);
    const data = result.rows.map((r) =>
      decorateProductRow(
        {
          barcode: r.barcode,
          item_type: r.item_type,
          item_code: r.ic_code,
          code: r.ic_code,
          item_name: r.item_name,
          name_1: r.item_name,
          name_2: r.name_2 || "",
          name_eng_1: r.name_eng_1 || "",
          name_eng_2: r.name_eng_2 || "",
          group_name_2: r.group_name_2 || "",
          unit_code: r.unit_code,
          balance_qty: toInt(r.balance_qty, 0),
          sold_out: r.sold_out,
          sum_sale: toInt(r.sum_sale, 0),
          wh_code: r.stock_wh || effectiveWhCode,
          shelf_code: r.stock_shelf || DEFAULT_SHELF_CODE,
          stand_value: r.stand_value,
          divide_value: r.divide_value,
          ratio: r.ratio,
          favorite_item: r.favorite_item,
          price: r.price,
          is_return: r.is_return,
          description: r.description,
          dimension_31: r.dimension_31,
          dimension_32: r.dimension_32,
          dimension_33: r.dimension_33,
          dimension_34: r.dimension_34,
          dimension_35: r.dimension_35,
          dimension_36: r.dimension_36,
          dimension_38: r.dimension_38,
          promotion_detail: r.promotion_detail,
          barcode_sales_display_mode: r.barcode_sales_display_mode,
          online_visibility: r.barcode_online_visibility,
          promotion: [],
        },
        preorderDefaultEnabled,
        displayDefaults,
      ),
    );

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ error: ex.message });
  }
});

// GET /service/v1/getProductSetItem
router.get("/getProductSetItem", async (req, res) => {
  const { item_code: strSetCode = "", wh_code: strWhCode = "" } = req.query;
  const resp = { success: false };
  const safeWhCode = strWhCode.replace(/'/g, "''");

  // ⚠️ ฟังก์ชันสต็อกของ ERP เอาค่าไปต่อ SQL แล้ว EXECUTE เอง $1 จึงกันไม่ได้
  //    ต้องกรองรหัสก่อนเสมอ ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ item_code: strSetCode, wh_code: strWhCode });
  if (codeError) return res.status(400).json({ success: false, error: codeError });

  try {
    const sql = `
      WITH set_detail AS (
        SELECT d.ic_set_code, d.ic_code, d.unit_code, d.qty,
               d.price, d.sum_amount, d.barcode, d.price_ratio,
               COALESCE(d.line_number,0) AS line_number,
               COALESCE(d.roworder,0) AS roworder
        FROM ic_inventory_set_detail d
        WHERE d.ic_set_code = '${strSetCode.replace(/'/g, "''")}'
      ),
      balance_stock AS (
        SELECT s.ic_code, SUM(f.balance_qty) AS sum_balance_qty
        FROM set_detail s
        LEFT JOIN LATERAL (
          SELECT balance_qty
          FROM sml_ic_function_stock_balance_warehouse_location('NOW()', s.ic_code, '${safeWhCode}', '')
          WHERE balance_qty > 0
        ) f ON TRUE
        GROUP BY s.ic_code
      )
      SELECT s.ic_set_code, s.ic_code,
             i.name_1 AS item_name,
             COALESCE(i.name_eng_1,'') AS name_eng_1,
             s.unit_code, s.qty,
             COALESCE(b.sum_balance_qty,0) AS balance_qty,
             s.price, s.sum_amount, s.barcode, s.price_ratio,
             s.line_number, s.roworder,
             icu.stand_value, icu.divide_value
      FROM set_detail s
      LEFT JOIN ic_inventory i ON s.ic_code = i.code
      LEFT JOIN balance_stock b ON s.ic_code = b.ic_code
      LEFT JOIN ic_unit_use icu ON icu.ic_code = s.ic_code AND icu.code = s.unit_code
      ORDER BY s.line_number, s.roworder, s.ic_code
    `;

    const result = await query(sql, []);
    const data = result.rows.map((r) => ({
      item_code: r.ic_code,
      item_name: r.item_name,
      name_eng_1: r.name_eng_1 || "",
      unit_code: r.unit_code,
      qty: r.qty,
      balance_qty: toInt(r.balance_qty, 0),
      price: r.price,
      sum_amount: r.sum_amount,
      barcode: r.barcode,
      price_ratio: r.price_ratio,
      line_number: toInt(r.line_number, 0),
      roworder: toInt(r.roworder, 0),
      stand_value: r.stand_value,
      divide_value: r.divide_value,
    }));

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ error: ex.message });
  }
});

// GET /service/v1/getProductDisplayDetail
// Extra display data for the full product detail page. This is intentionally
// separate from price/detail loading so the purchase area can render first.
router.get("/getProductDisplayDetail", async (req, res) => {
  const itemCode = String(req.query.item_code || "").trim();
  if (!itemCode) {
    return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  }

  try {
    const detailResult = await query(
      `SELECT i.code,
              COALESCE(i.name_1,'') AS name_1,
              COALESCE(i.name_2,'') AS name_2,
              COALESCE(i.name_eng_1,'') AS name_eng_1,
              COALESCE(i.name_eng_2,'') AS name_eng_2,
              COALESCE(d.dimension_31,'') AS dimension_31,
              COALESCE(d.dimension_32,'') AS dimension_32,
              COALESCE(d.dimension_33,'') AS dimension_33,
              COALESCE(d.dimension_34,'') AS dimension_34,
              COALESCE(d.dimension_35,'') AS dimension_35,
              COALESCE(d.dimension_36,'') AS dimension_36,
              COALESCE(g.name_2,'') AS group_name_2,
              COALESCE(i.item_category,'') AS item_category,
              COALESCE(cat.name_1,'') AS category_name,
              COALESCE(cat.name_2,'') AS category_name_2,
              COALESCE(i.item_brand,'') AS item_brand,
              COALESCE(br.name_1,'') AS brand_name,
              COALESCE(br.name_2,'') AS brand_name_2,
              COALESCE(i.item_model,'') AS item_model,
              COALESCE(md.name_1,'') AS model_name,
              COALESCE(md.name_2,'') AS model_name_2,
              COALESCE(u.width_length_height,'') AS width_length_height,
              COALESCE(u.weight,'') AS weight
       FROM ic_inventory i
       LEFT JOIN ic_inventory_detail d ON d.ic_code = i.code
       LEFT JOIN ic_group g ON g.code = i.group_main
       LEFT JOIN ic_unit_use u ON u.ic_code = i.code AND u.code = i.unit_standard
       LEFT JOIN ic_category cat ON cat.code = i.item_category
       LEFT JOIN ic_brand br ON br.code = i.item_brand
       LEFT JOIN ic_model md ON md.code = i.item_model
       WHERE i.code = $1
       LIMIT 1`,
      [itemCode],
    );

    if (!detailResult.rows.length) {
      return res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    }

    const relatedSelect = (tableName, ownerColumn) =>
      `SELECT rel.ic_code AS item_code,
              COALESCE(i.name_1,'') AS name_1,
              COALESCE(i.name_2,'') AS name_2,
              COALESCE(i.name_eng_1,'') AS name_eng_1,
              COALESCE(i.name_eng_2,'') AS name_eng_2,
              COALESCE(d.dimension_32,'') AS dimension_32,
              COALESCE(d.dimension_35,'') AS dimension_35,
              COALESCE(g.name_2,'') AS group_name_2,
              COALESCE(i.item_type,0) AS item_type,
              COALESCE(i.unit_standard,'') AS unit_code,
              COALESCE(rel.line_number,0) AS line_number
       FROM ${tableName} rel
       LEFT JOIN ic_inventory i ON i.code = rel.ic_code
       LEFT JOIN ic_inventory_detail d ON d.ic_code = i.code
       LEFT JOIN ic_group g ON g.code = i.group_main
       WHERE rel.${ownerColumn} = $1 AND COALESCE(rel.status,0) = 1
       ORDER BY COALESCE(rel.line_number,0), rel.ic_code`;

    const [replacementResult, suggestResult, preorderDefaultEnabled, displayDefaults] = await Promise.all([
      query(relatedSelect("ic_inventory_replacement", "ic_replace_code"), [itemCode]),
      query(relatedSelect("ic_inventory_suggest", "ic_suggest_code"), [itemCode]),
      getPreorderDefaultEnabled(),
      getMarketplaceDisplayDefaults(),
    ]);

    return res.json({
      success: true,
      data: {
        detail: decorateProductRow(detailResult.rows[0], preorderDefaultEnabled, displayDefaults),
        replacements: replacementResult.rows.map((row) => decorateProductRow(row, preorderDefaultEnabled, displayDefaults)),
        suggestions: suggestResult.rows.map((row) => decorateProductRow(row, preorderDefaultEnabled, displayDefaults)),
      },
    });
  } catch (ex) {
    console.error("getProductDisplayDetail error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// แปลงสต็อกดิบ (หน่วยฐาน) เป็นจำนวนที่ยอมให้หน้าร้านเห็น ตามหน่วยที่ขอ
// สูตรเดียวกับ cart.js และ getProductDetail เพื่อให้ทุกหน้าตอบเลขเดียวกัน
function toStockDisplayQty(rawBalance, ratio, percent) {
  const base = toNumber(rawBalance, 0);
  const r = toNumber(ratio, 1) || 1;
  const pct = toNumber(percent, 100);
  return Math.trunc((base * pct) / 100 / r);
}

// GET /service/v1/getProductBalancePrice
// เลียนแบบ Java: query ic_inventory_barcode + เรียก getProductPriceLocalx
router.get("/getProductBalancePrice", async (req, res) => {
  const {
    item_code: strItemCode = "",
    unit_code: strUnit = "",
    cust_code: strCust = "",
    sale_type: strSaleType = "",
    vat_type: strVatType = "",
    vat_rate: strVatRate = "",
    doc_date: strDocDate = "",
    wh_code: strWhCode = "",
  } = req.query;
  const resp = { success: false };
  const safeWhCode = strWhCode.replace(/'/g, "''");

  // ⚠️ ฟังก์ชันสต็อกของ ERP เอาค่าไปต่อ SQL แล้ว EXECUTE เอง $1 จึงกันไม่ได้
  //    ต้องกรองรหัสก่อนเสมอ ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ item_code: strItemCode, wh_code: strWhCode });
  if (codeError) return res.status(400).json({ success: false, ERROR: codeError });

  try {
    const sql = `
      SELECT a.ic_code, a.barcode, b.name_1 AS item_name, COALESCE(b.name_eng_1,'') AS name_eng_1, a.unit_code,
        COALESCE(b.tax_type,0) AS tax_type,
        (((COALESCE((SELECT MAX(balance_qty) FROM sml_ic_function_stock_balance_warehouse_location('NOW()',a.ic_code, '${safeWhCode}', '') WHERE ic_unit_code = a.unit_code),0)
           /((SELECT unit_standard_stand_value FROM ic_inventory WHERE code=a.ic_code)
             /(SELECT unit_standard_divide_value FROM ic_inventory WHERE code=a.ic_code))))
          -(SELECT accrued_out_qty FROM ic_inventory WHERE code=a.ic_code)) AS sum_balance_qty,
        COALESCE((SELECT MAX(balance_qty) FROM sml_ic_function_stock_balance_warehouse_location('NOW()',a.ic_code, '${safeWhCode}', '')),0) AS balance_qty,
        (CASE WHEN (COALESCE((SELECT MAX(balance_qty) FROM sml_ic_function_stock_balance_warehouse_location('NOW()',a.ic_code, '${safeWhCode}', '') WHERE ic_unit_code = a.unit_code LIMIT 1),0)
                /((SELECT unit_standard_stand_value FROM ic_inventory WHERE code=a.ic_code)
                  /(SELECT unit_standard_divide_value FROM ic_inventory WHERE code=a.ic_code)))
              <= ROUND((COALESCE(c.maximum_qty,0)*5)/100) THEN '1' ELSE '0' END) AS sold_out,
        COALESCE(((SELECT SUM(qty) FROM ic_trans_detail WHERE a.ic_code=item_code AND a.unit_code=unit_code AND doc_date BETWEEN '2025-01-01' AND 'NOW()')
          *(SELECT stand_value FROM ic_trans_detail WHERE a.ic_code=item_code AND a.unit_code=unit_code LIMIT 1)),0) AS sum_sale,
        COALESCE((SELECT status FROM ar_item_by_customer WHERE ic_code=a.ic_code AND ar_code='${strCust.replace(/'/g, "''")}' LIMIT 1),0) AS favorite_item,
        c.start_sale_wh, c.start_sale_shelf,
        0 AS price, icu.stand_value, icu.divide_value, icu.ratio
      FROM ic_inventory_barcode a
      LEFT JOIN ic_inventory b ON a.ic_code=b.code
      LEFT JOIN ic_inventory_detail c ON a.ic_code=c.ic_code
      LEFT JOIN ic_unit_use icu ON icu.code = a.unit_code AND icu.ic_code = a.ic_code
      WHERE a.ic_code = '${strItemCode.replace(/'/g, "''")}' AND a.unit_code = '${strUnit.replace(/'/g, "''")}'
      -- 🚨 ic_inventory_barcode มีได้หลายบาร์โค้ดต่อหนึ่งหน่วย เดิมจึงคืนแถวซ้ำ 1 แถวต่อ 1 บาร์โค้ด
      --    (01-0004 หน่วย ชิ้น มี 72 บาร์โค้ด = 72 แถวที่เหมือนกันทุกอย่างยกเว้น barcode ~25KB)
      --    เอาแถวเดียวพอ เรียงให้ผลคงที่ไม่สุ่มเปลี่ยนไปมาระหว่างเรียก
      ORDER BY a.barcode
      LIMIT 1
    `;

    const result = await query(sql, []);
    // 🚨 endpoint นี้เคยคืน balance_qty ดิบจาก ERP โดยไม่ผ่านกฎ stock_display_percent
    //    ทั้งที่ getProductList / getProductDetail / cart / sendorder ใส่กันหมด
    //    ยิงจริงแล้ว: 01-0009 สต็อกจริง 36 หน้าร้านโชว์ 25 (70%) แต่ endpoint นี้คืน 36
    //    หน้า "สั่งซ้ำจากประวัติ" เอาค่านี้ไปจำกัดจำนวน และขึ้น toast บอกลูกค้าว่า "มีในสต็อกเพียง 36"
    //    คือเปิดตัวเลขจริงที่ร้านตั้งใจไม่ให้เห็น
    //    ใช้สูตรเดียวกับ cart.js: TRUNC((balance * pct / 100) / ratio)
    //    ซึ่งแปลงหน่วยฐานเป็นหน่วยที่ขอมาด้วย ตรงกับ getProductDetail (ชิ้น 25 · ลัง24 = 1)
    const stockDisplayPercent = await getStockDisplayPercent();
    const basketCtx = await resolveBasketPricingContext(strCust);
    const saleTypeReq = toInt(strSaleType, NaN);
    const vatTypeReq = toInt(strVatType, NaN);
    const vatRateReq = toNumber(strVatRate, NaN);
    const docDate = strDocDate.trim() || undefined;

    const data = [];

    for (const r of result.rows) {
      const obj = {
        barcode: r.barcode,
        item_code: r.ic_code,
        item_name: r.item_name,
        name_eng_1: r.name_eng_1 || "",
        unit_code: r.unit_code,
        balance_qty: toStockDisplayQty(r.balance_qty, r.ratio, stockDisplayPercent),
        sold_out: r.sold_out,
        sum_sale: r.sum_sale,
        wh_code: r.start_sale_wh,
        shelf_code: r.start_sale_shelf,
        stand_value: r.stand_value,
        divide_value: r.divide_value,
        ratio: r.ratio,
        favorite_item: r.favorite_item,
        price: "0",
      };

      try {
        const saleType = Number.isNaN(saleTypeReq) ? (Number.isNaN(basketCtx.saleType) ? 0 : basketCtx.saleType) : saleTypeReq;
        const vatType = Number.isNaN(vatTypeReq) ? (Number.isNaN(basketCtx.vatType) ? toInt(r.tax_type, 0) : basketCtx.vatType) : vatTypeReq;
        const vatRate = Number.isNaN(vatRateReq) ? (Number.isNaN(basketCtx.vatRate) ? null : basketCtx.vatRate) : vatRateReq;

        const prices = await getProductPriceLocalx(r.ic_code, r.unit_code, "1", strCust, vatType, vatRate, saleType, r.barcode, docDate);
        const arr = prices.data || [];
        if (arr.length > 0) {
          obj.price = arr[0].price !== undefined ? String(arr[0].price) : "0";
        }
      } catch (_) {}

      data.push(obj);
    }

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getProductPrice
// ดึงราคาสินค้าตัวเดียวผ่าน getProductPriceLocalx โดยตรง — ใช้สำหรับ catalog lazy-price
router.get("/getProductPrice", async (req, res) => {
  const {
    item_code: strItemCode = "",
    unit_code: strUnitCode = "",
    qty: strQty = "1",
    cust_code: strCustCode = "",
    vat_type: strVatType = "",
    sale_type: strSaleType = "",
    vat_rate: strVatRate = "",
    barcode: strBarcode = "",
    doc_date: strDocDate = "",
  } = req.query;

  const resp = { success: false };

  try {
    const basketCtx = await resolveBasketPricingContext(strCustCode);

    let vatType = toInt(strVatType, NaN);
    if (Number.isNaN(vatType)) {
      vatType = Number.isNaN(basketCtx.vatType) ? 0 : basketCtx.vatType;
    }

    let saleType = toInt(strSaleType, NaN);
    if (Number.isNaN(saleType)) {
      saleType = Number.isNaN(basketCtx.saleType) ? 0 : basketCtx.saleType;
    }

    let vatRate = toNumber(strVatRate, NaN);
    if (Number.isNaN(vatRate)) {
      vatRate = Number.isNaN(basketCtx.vatRate) ? null : basketCtx.vatRate;
    }

    const docDate = strDocDate.trim() || undefined;
    const result = await getProductPriceLocalx(strItemCode, strUnitCode, strQty || "1", strCustCode, vatType, vatRate, saleType, strBarcode, docDate);
    resp.success = true;
    resp.data = result.data || [];
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getCategoryList
// เลียนแบบ Java: SELECT code, name_1 FROM ic_category
router.get("/getCategoryList", async (req, res) => {
  const resp = { success: false };
  try {
    const [result, categoryMeta] = await Promise.all([query("SELECT code, name_1, name_2 FROM ic_category ORDER BY code", []), readCategoryMeta()]);
    const virtualData = VIRTUAL_CATEGORIES.map((category) => withCategoryMeta({ ...category, is_virtual: true }, categoryMeta));
    const data = result.rows
      .filter((r) => !VIRTUAL_CATEGORY_CODES.has(r.code))
      .map((r) =>
        withCategoryMeta(
          {
            code: r.code,
            name: r.name_1,
            name_1: r.name_1,
            name_2: r.name_2 || "",
            is_virtual: false,
          },
          categoryMeta,
        ),
      );
    resp.success = true;
    resp.data = [...virtualData, ...data];
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

router.post("/createCategory", requireAdmin("admin.categories"), async (req, res) => {
  const code = cleanCategoryCode(req.body?.code);
  const name1 = cleanCategoryText(req.body?.name_1 || req.body?.name);
  const name2 = cleanCategoryText(req.body?.name_2);
  const imageUrl = cleanCategoryImageUrl(req.body?.image_url);

  if (!code || !name1) {
    return res.status(400).json({ success: false, ERROR: "code and name_1 are required" });
  }
  if (getVirtualCategory(code)) {
    return res.status(409).json({ success: false, ERROR: "category code already exists" });
  }

  try {
    const exists = await query("SELECT code FROM ic_category WHERE code=$1 LIMIT 1", [code]);
    if (exists.rows.length) {
      return res.status(409).json({ success: false, ERROR: "category code already exists" });
    }

    await query("INSERT INTO ic_category (code, name_1, name_2) VALUES ($1, $2, $3)", [code, name1, name2]);
    const meta = await saveCategoryMeta(code, { image_url: imageUrl });
    return res.json({
      success: true,
      data: { code, name: name1, name_1: name1, name_2: name2, image_url: meta.image_url || "" },
    });
  } catch (ex) {
    return res.status(400).json({ success: false, ERROR: ex.message });
  }
});

router.post("/updateCategory", requireAdmin("admin.categories"), async (req, res) => {
  const code = cleanCategoryCode(req.body?.code);
  const name1 = cleanCategoryText(req.body?.name_1 || req.body?.name);
  const name2 = cleanCategoryText(req.body?.name_2);
  const imageUrl = cleanCategoryImageUrl(req.body?.image_url);
  // ไม่ส่ง image_url มา = ไม่แตะรูปเดิม (cleanCategoryImageUrl คืน "" ทั้งกรณีไม่ส่งและส่งค่าว่าง)
  const providedImage = hasOwn(req.body || {}, "image_url");
  const virtualCategory = getVirtualCategory(code);

  if (!code || (!name1 && !virtualCategory)) {
    return res.status(400).json({ success: false, ERROR: "code and name_1 are required" });
  }

  try {
    if (virtualCategory) {
      const meta = await saveCategoryMeta(code, providedImage ? { image_url: imageUrl } : {});
      return res.json({
        success: true,
        data: { ...virtualCategory, image_url: meta.image_url || "", is_virtual: true },
      });
    }

    // \ud83d\udea8 เดิมทับ name_2 เสมอ ส่งแค่ { code, name_1 } ก็ล้างชื่อที่สองทิ้ง
    const result = await query(
      `UPDATE ic_category SET name_1=$2, name_2=CASE WHEN $4 THEN $3 ELSE name_2 END
        WHERE code=$1 RETURNING code, name_1, name_2`,
      [code, name1, name2, hasOwn(req.body || {}, "name_2")],
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, ERROR: "category not found" });
    }

    const meta = await saveCategoryMeta(code, providedImage ? { image_url: imageUrl } : {});
    const row = result.rows[0];
    return res.json({
      success: true,
      data: { code: row.code, name: row.name_1, name_1: row.name_1, name_2: row.name_2 || "", image_url: meta.image_url || "" },
    });
  } catch (ex) {
    return res.status(400).json({ success: false, ERROR: ex.message });
  }
});

router.post("/deleteCategory", requireAdmin("admin.categories"), async (req, res) => {
  const code = cleanCategoryCode(req.body?.code);
  if (!code) {
    return res.status(400).json({ success: false, ERROR: "code is required" });
  }
  if (getVirtualCategory(code)) {
    return res.status(400).json({ success: false, ERROR: "default category cannot be deleted" });
  }

  try {
    const used = await query("SELECT COUNT(*)::int AS count FROM ic_inventory WHERE item_category=$1", [code]);
    const usedCount = used.rows[0]?.count || 0;
    if (usedCount > 0) {
      return res.status(409).json({
        success: false,
        ERROR: "category is used by products",
        used_count: usedCount,
      });
    }

    const result = await query("DELETE FROM ic_category WHERE code=$1 RETURNING code", [code]);
    if (!result.rows.length) {
      return res.status(404).json({ success: false, ERROR: "category not found" });
    }

    await deleteCategoryMeta(code);
    return res.json({ success: true, data: { code } });
  } catch (ex) {
    return res.status(400).json({ success: false, ERROR: ex.message });
  }
});

// GET /service/v1/getProductByBarcode
// ค้นหาสินค้าจากบาร์โค้ดใน ic_inventory_barcode
router.get("/getProductByBarcode", async (req, res) => {
  const { barcode: strBarcode = "" } = req.query;
  const resp = { success: false };

  if (!strBarcode.trim()) {
    return res.status(400).json({ ERROR: "barcode is required" });
  }

  try {
    const result = await query(
      `SELECT b.ic_code AS item_code, i.name_1 AS item_name, COALESCE(i.name_eng_1,'') AS name_eng_1
       FROM ic_inventory_barcode b
       JOIN ic_inventory i ON i.code = b.ic_code
       WHERE b.barcode = $1
       LIMIT 1`,
      [strBarcode.trim()],
    );

    if (result.rows.length === 0) {
      resp.success = false;
      resp.data = null;
      return res.json(resp);
    }

    resp.success = true;
    resp.data = {
      item_code: result.rows[0].item_code,
      item_name: result.rows[0].item_name,
      name_eng_1: result.rows[0].name_eng_1 || "",
    };
    return res.json(resp);
  } catch (ex) {
    console.error("getProductByBarcode error:", ex.message);
    return res.status(500).json({ ERROR: ex.message });
  }
});

// POST /service/v1/adjustStock
// ตรวจนับสต๊อก (76) + ปรับปรุงผลต่าง: เพิ่ม (66) หรือ ลด (68)
router.post("/adjustStock", requireAdmin("admin.inventory"), async (req, res) => {
  const { item_code = "", item_name = "", unit_code = "", barcode = "", wh_code = "", shelf_code = "", branch_code = "", emp_code = "", qty } = req.body;
  const resp = { success: false };

  if (!item_code || qty === undefined || qty === null) {
    return res.status(400).json({ ERROR: "item_code and qty are required" });
  }

  // ⚠️ ฟังก์ชันสต็อกของ ERP เอาค่าไปต่อ SQL แล้ว EXECUTE เอง $1 จึงกันไม่ได้
  //    ต้องกรองรหัสก่อนเสมอ ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ item_code, wh_code, shelf_code });
  if (codeError) return res.status(400).json({ ERROR: codeError });

  // 🚨 เดิมใช้ toNumber(qty, 0) กลืนค่าขยะเป็น 0 เงียบๆ
  //    พิมพ์ qty:"abc" ผิดครั้งเดียว = ออกเอกสารปรับสต็อกเป็นศูนย์ทั้งรายการ
  //    และ qty ติดลบก็ทำให้สต็อกใน ic_inventory ติดลบตาม
  //    ⚠️ Number("") คือ 0 ไม่ใช่ NaN ด่านเดิมจึงปล่อยค่าว่างผ่าน
  //    ยิงจริงแล้ว: qty:"" ตอบ 200 ออกใบนับ "นับจริง = 0"
  //    แล้วออกใบลด (68) ล้างสต็อก 26 ชิ้นเป็นศูนย์ทันที
  //    เช่นเดียวกัน [] ก็ Number([]) === 0 จึงรับเฉพาะ number กับ string ที่มีตัวจริง
  const qtyText = typeof qty === "string" ? qty.replace(/,/g, "").trim() : qty;
  const qtyNum =
    typeof qtyText === "number" || (typeof qtyText === "string" && qtyText !== "")
      ? Number(qtyText)
      : NaN;
  if (!Number.isFinite(qtyNum) || qtyNum < 0) {
    return res.status(400).json({ ERROR: "จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" });
  }

  try {
    // 🚨 เดิมไม่เช็คว่ามีสินค้าจริงไหม ส่งรหัสมั่วมาก็สร้างเอกสารกำพร้าลง ERP ได้
    //    (UPDATE ic_inventory โดน 0 แถวแบบเงียบๆ ไม่มีอะไรฟ้อง)
    const itemExists = await query(`SELECT 1 FROM ic_inventory WHERE code=$1 LIMIT 1`, [item_code]);
    if (!itemExists.rows.length) {
      return res.status(400).json({ ERROR: "ไม่พบสินค้ารหัสนี้" });
    }

    // 🚨 เดิม doc_date มาจาก toISOString() ซึ่งเป็น UTC ส่วนเลขที่เอกสารมาจาก
    //    getFullYear/getMonth/getDate ซึ่งเป็นเวลาไทย ช่วง 00:00-06:59 น. ของไทย
    //    ยังเป็นวันก่อนหน้าในเขต UTC เอกสารจึงออกมาเป็น IS20260824-0001 แต่ doc_date
    //    เป็น 2026-08-23 — ค้นตามวันที่ไม่เจอ และยอดสต็อกรายวันของ ERP เพี้ยน
    //    ใช้ตัวช่วยเวลาไทยชุดเดียวกับใบสั่งซื้อ/ใบยกเลิก (REQ6) ให้ทั้งไฟล์อ้างเวลาเดียวกัน
    const now = new Date();
    const doc_date = serverDocDate(now);
    const doc_time = serverDocTime(now);

    const [yyyy, mm, dd] = doc_date.split("-");
    const prefix = `MSTC${yyyy}${dd}${mm}-`;
    const adjPrefix = `IS${yyyy}${mm}${dd}-`;
    // 🚨 เดิมออกเลขนอกทรานแซกชันและไม่มี lock ยิงพร้อมกัน 3 ครั้งได้เลขซ้ำ
    //    สำเร็จ 1 อีก 2 ตัวตอบ 500 duplicate key ... "ic_trans_ic_trans_pk_primary"
    //    ย้ายเข้ามาออกในทรานแซกชันเดียวกับที่ INSERT และจับ advisory lock ก่อนอ่าน
    //    lock ต่อวันเหมือนที่ resolveMainDocNo ของฝั่งสั่งซื้อทำ
    let doc_no = "";
    let doc_no_adj = "";

    // ดึง ratio, stand_value, divide_value จาก ic_unit_use
    const unitRes = await query(`SELECT ratio, stand_value, divide_value FROM ic_unit_use WHERE ic_code = $1 AND code = $2 LIMIT 1`, [item_code, unit_code]);
    const unitRow = unitRes.rows[0] || {};
    const ratio = toNumber(unitRow.ratio, 1);
    const stand_value = toNumber(unitRow.stand_value, 1);
    const divide_value = toNumber(unitRow.divide_value, 1);

    // คำนวณยอดคงเหลือปัจจุบัน (base units) เพื่อหา diff
    const balRes = await query(
      `SELECT COALESCE(SUM(balance_qty), 0) AS sum_balance_qty
       FROM sml_ic_function_stock_balance_warehouse_location('NOW()', $1, $2, $3)`,
      [item_code, wh_code, shelf_code],
    );

    const sum_balance_qty = toNumber(balRes.rows[0]?.sum_balance_qty, 0);

    const balance_in_unit = Math.floor(sum_balance_qty / Math.max(1, ratio));
    // ใช้ค่าที่ผ่านด่านแล้ว — เดิมเรียก toNumber(qty, 0) ซ้ำ ด่านจึงไม่มีผลกับค่าที่ใช้จริง
    const check_qty = qtyNum;
    const diff_qty = check_qty - balance_in_unit;

    await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`adjustStock:${prefix}`]);
      const lastRes = await client.query(`SELECT doc_no FROM ic_trans WHERE doc_no LIKE $1 ORDER BY doc_no DESC LIMIT 1`, [`${prefix}%`]);
      doc_no = `${prefix}${String((lastRes.rows.length > 0 ? toInt(lastRes.rows[0].doc_no.slice(-4), 0) : 0) + 1).padStart(4, "0")}`;
      const lastAdjRes = await client.query(`SELECT doc_no FROM ic_trans WHERE doc_no LIKE $1 ORDER BY doc_no DESC LIMIT 1`, [`${adjPrefix}%`]);
      doc_no_adj = `${adjPrefix}${String((lastAdjRes.rows.length > 0 ? toInt(lastAdjRes.rows[0].doc_no.slice(-4), 0) : 0) + 1).padStart(4, "0")}`;

      // 1. ic_trans_detail_temp (log scan)
      await client.query(
        `INSERT INTO ic_trans_detail_temp
          (doc_no, doc_date, trans_flag, item_code, item_name, unit_code, barcode,
           wh_code, shelf_code, doc_time, user_code, qty)
         VALUES ($1, NOW(), 13, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [doc_no, item_code, item_name, unit_code, barcode, wh_code, shelf_code, doc_time, emp_code, check_qty],
      );

      // 2. ic_trans header (76 = ตรวจนับ)
      await client.query(
        `INSERT INTO ic_trans
          (trans_flag, trans_type, doc_no, doc_date, doc_time, doc_format_code,
           remark, branch_code, wh_from, location_from)
         VALUES (76, 3, $1, $2, $3, 'CO', 'ปรับปรุงสต๊อกไม่ตรง', $4, $5, $6)`,
        [doc_no, doc_date, doc_time, branch_code, wh_code, shelf_code],
      );

      // 3. ic_trans_detail (76)
      const detailRes = await client.query(
        `INSERT INTO ic_trans_detail
          (trans_flag, trans_type, calc_flag, doc_no, doc_date, doc_time,
           doc_date_calc, doc_time_calc, last_status, line_number,
           ratio, stand_value, divide_value,
           item_code, item_name, unit_code, qty,
           wh_code, shelf_code, branch_code)
         VALUES (76, 3, 1, $1, $2, $3, $2, $3, 0, 0, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [doc_no, doc_date, doc_time, ratio, stand_value, divide_value, item_code, item_name, unit_code, check_qty, wh_code, shelf_code, branch_code],
      );
      if (detailRes.rowCount === 0) {
        throw new Error("ic_trans_detail(76): insert failed (rowCount=0)");
      }

      // 4. เอกสารปรับผลต่าง — 66 (เพิ่ม) หรือ 68 (ลด) เฉพาะเมื่อ diff != 0
      if (diff_qty !== 0) {
        const adj_flag = diff_qty > 0 ? 66 : 68;
        const adj_calc_flag = diff_qty > 0 ? 1 : -1;
        const adj_qty = Math.abs(diff_qty);

        await client.query(
          `INSERT INTO ic_trans
            (trans_flag, trans_type, doc_no, doc_date, doc_time, doc_format_code,
             branch_code, wh_from, location_from,doc_ref)
           VALUES ($1, 3, $2, $3, $4, 'IS', $5, $6, $7, $8)`,
          [adj_flag, doc_no_adj, doc_date, doc_time, branch_code, wh_code, shelf_code, doc_no],
        );

        await client.query(
          `INSERT INTO ap_ar_trans_detail (
            trans_type,trans_flag,doc_date,doc_no,billing_no,calc_flag)
            VALUES (2, $1, $2, $3, $4, $5)`,
          [adj_flag, doc_date, doc_no_adj, doc_no, adj_calc_flag],
        );

        const adjRes = await client.query(
          `INSERT INTO ic_trans_detail
            (trans_flag, trans_type, calc_flag, doc_no, doc_date, doc_time,
             doc_date_calc, doc_time_calc, last_status, line_number,
             ratio, stand_value, divide_value,
             item_code, item_name, unit_code, qty,
             wh_code, shelf_code, branch_code, doc_ref)
           VALUES ($1, 3, $2, $3, $4, $5, $4, $5, 0, 0, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [adj_flag, adj_calc_flag, doc_no_adj, doc_date, doc_time, ratio, stand_value, divide_value, item_code, item_name, unit_code, adj_qty, wh_code, shelf_code, branch_code, doc_no],
        );
        if (adjRes.rowCount === 0) {
          throw new Error(`ic_trans_detail(${adj_flag}): insert failed (rowCount=0)`);
        }
      }

      // 5. process queue
      const docNos = diff_qty !== 0 ? [doc_no, doc_no_adj] : [doc_no];
      await client.query(
        `INSERT INTO process (process_name, wherein)
         SELECT 'IC', item_code FROM ic_trans_detail WHERE doc_no = ANY($1::text[]) and trans_flag = '76' `,
        [docNos],
      );

      // 6. อัปเดต balance_qty ใน ic_inventory จากยอดจริงหลังปรับ
      const newBalRes = await client.query(
        `SELECT COALESCE(SUM(balance_qty), 0) AS new_balance
         FROM sml_ic_function_stock_balance_warehouse_location('NOW()', $1, '', '')`,
        [item_code],
      );
      const new_balance = toNumber(newBalRes.rows[0].new_balance, 0);
      await client.query(`UPDATE ic_inventory SET balance_qty = $1 WHERE code = $2`, [new_balance, item_code]);
    });

    resp.success = true;
    resp.doc_no = doc_no;
    // ใบปรับผลต่าง (66/68) เคยไม่ถูกส่งกลับไป แอดมินจึงตามเอกสารไม่ได้จากหน้าจอ
    resp.doc_no_adj = diff_qty !== 0 ? doc_no_adj : "";
    resp.balance_qty = balance_in_unit;
    resp.check_qty = check_qty;
    resp.diff_qty = diff_qty;
    return res.json(resp);
  } catch (ex) {
    console.error("adjustStock error:", ex.message);
    return res.status(500).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getInventoryBalance
router.get("/getInventoryBalance", async (req, res) => {
  const { item_code = "", wh_code = "", shelf_code = "" } = req.query;
  if (!item_code) return res.status(400).json({ ERROR: "item_code is required" });

  // ⚠️ ฟังก์ชันสต็อกของ ERP เอาค่าไปต่อ SQL แล้ว EXECUTE เอง $1 จึงกันไม่ได้
  //    ต้องกรองรหัสก่อนเสมอ ดู src/utils/erpCodeGuard.js
  const codeError = checkErpCodes({ item_code, wh_code, shelf_code });
  if (codeError) return res.status(400).json({ ERROR: codeError });
  try {
    const balRes = await query(
      `SELECT COALESCE(SUM(balance_qty), 0) AS sum_balance_qty
       FROM sml_ic_function_stock_balance_warehouse_location('NOW()', $1, $2, $3)`,
      [item_code, wh_code, shelf_code],
    );
    return res.json({ success: true, data: { sum_balance_qty: toNumber(balRes.rows[0].sum_balance_qty, 0) } });
  } catch (ex) {
    console.error("getInventoryBalance error:", ex.message);
    return res.status(500).json({ ERROR: ex.message });
  }
});

// ========== MASTER DATA DROPDOWNS ==========

// helper ลด code ซ้ำสำหรับ master data ที่มี search filter
function makeMasterListRoute(tableName, extraFields = "") {
  return async (req, res) => {
    const s = (req.query.search || "").trim();
    const like = likeContains(s);
    try {
      const result = await query(
        `SELECT code, COALESCE(name_1,'') AS name_1, COALESCE(name_2,'') AS name_2${extraFields} FROM ${tableName}` +
          ` WHERE ($1 = '' OR code ILIKE $2 OR name_1 ILIKE $2 OR name_2 ILIKE $2)` +
          ` ORDER BY code`,
        [s, like],
      );
      return res.json({ success: true, data: result.rows });
    } catch (ex) {
      console.error(`${tableName} list error:`, ex.message);
      return res.status(500).json({ success: false, message: ex.message });
    }
  };
}

// GET /service/v1/getProductGroupList
router.get("/getProductGroupList", makeMasterListRoute("ic_group"));
// GET /service/v1/getProductGroupSubList
router.get("/getProductGroupSubList", makeMasterListRoute("ic_group_sub"));
// GET /service/v1/getProductGroupSub2List
router.get("/getProductGroupSub2List", makeMasterListRoute("ic_group_sub2"));
// GET /service/v1/getProductBrandList
router.get("/getProductBrandList", makeMasterListRoute("ic_brand"));
// GET /service/v1/getProductCategoryList
router.get("/getProductCategoryList", makeMasterListRoute("ic_category"));
// GET /service/v1/getProductDesignList
router.get("/getProductDesignList", makeMasterListRoute("ic_design"));
// GET /service/v1/getProductModelList
router.get("/getProductModelList", makeMasterListRoute("ic_model"));
// GET /service/v1/getProductPatternList
router.get("/getProductPatternList", makeMasterListRoute("ic_pattern"));
// GET /service/v1/getProductGradeList
router.get("/getProductGradeList", makeMasterListRoute("ic_grade"));
// GET /service/v1/getCustomerGroupList
router.get("/getCustomerGroupList", makeMasterListRoute("ar_group"));
// GET /service/v1/getCustomerGroupSubList
router.get("/getCustomerGroupSubList", makeMasterListRoute("ar_group_sub"));

// GET /service/v1/getUnitManageList
router.get("/getUnitManageList", async (req, res) => {
  const s = (req.query.search || "").trim();
  const like = likeContains(s);
  try {
    const result = await query(
      `SELECT code, COALESCE(name_1,'') AS name_1, COALESCE(name_2,'') AS name_2` + ` FROM ic_unit` + ` WHERE ($1 = '' OR code ILIKE $2 OR name_1 ILIKE $2 OR name_2 ILIKE $2)` + ` ORDER BY code`,
      [s, like],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error("getUnitManageList error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// ========== PRODUCT MANAGE LIST ==========

// GET /service/v1/getProductManageList
// port จาก Java getProductManageList — parameterized WHERE, sort whitelist, parallel count
router.get("/getProductManageList", requireAdmin("admin.products"), async (req, res) => {
  const { search = "", group = "", groupsub = "", groupsub2 = "", brand = "", category = "", design = "", model = "", sort_field = "", sort_order = "", offset = "0", limit = "20" } = req.query;

  const s = search.trim();
  const searchTerms = getSearchTerms(s);
  const g = group.trim() === "all" ? "" : group.trim();
  const gs = groupsub.trim() === "all" ? "" : groupsub.trim();
  const gs2 = groupsub2.trim() === "all" ? "" : groupsub2.trim();
  const br = brand.trim() === "all" ? "" : brand.trim();
  const cat = category.trim() === "all" ? "" : category.trim();
  const des = design.trim() === "all" ? "" : design.trim();
  const mod = model.trim() === "all" ? "" : model.trim();

  const offsetNum = Math.max(0, toInt(offset, 0));
  let limitNum = toInt(limit, 20);
  if (limitNum <= 0 || limitNum > 500) limitNum = 20;

  const sortWhitelist = {
    code: "code",
    name_1: "name_1",
    balance_qty: "COALESCE(balance_qty,0)",
    book_out_qty: "COALESCE(book_out_qty,0)",
    accrued_out_qty: "COALESCE(accrued_out_qty,0)",
    accrued_in_qty: "COALESCE(accrued_in_qty,0)",
  };
  const sortCol = sortWhitelist[sort_field] || "code";
  const sortDir = sort_order === "desc" ? "DESC" : "ASC";
  const orderBy = `${sortCol} ${sortDir}`;

  const whereParams = [];
  const whereClauses = [];
  const addParam = (value) => {
    whereParams.push(value);
    return `$${whereParams.length}`;
  };

  if (searchTerms.length) {
    const searchableFields = ["code", "name_1", "name_2", "name_eng_1", "name_eng_2"];
    const termClauses = searchTerms.map((term) => {
      const termParam = addParam(likeContains(term));
      const fieldClauses = searchableFields.map((field) => `COALESCE(${field},'') ILIKE ${termParam}`);
      fieldClauses.push(`EXISTS (SELECT 1 FROM ic_inventory_barcode ib WHERE ib.ic_code = ic_inventory.code AND COALESCE(ib.barcode,'') ILIKE ${termParam})`);
      return `(${fieldClauses.join(" OR ")})`;
    });
    whereClauses.push(`(${termClauses.join(" AND ")})`);
  }

  if (g) whereClauses.push(`group_main = ${addParam(g)}`);
  if (gs) whereClauses.push(`group_sub = ${addParam(gs)}`);
  if (gs2) whereClauses.push(`group_sub2 = ${addParam(gs2)}`);
  if (br) whereClauses.push(`item_brand = ${addParam(br)}`);
  if (cat) whereClauses.push(`item_category = ${addParam(cat)}`);
  if (des) whereClauses.push(`item_design = ${addParam(des)}`);
  if (mod) whereClauses.push(`item_model = ${addParam(mod)}`);

  const whereSql = whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : "";
  const offsetParam = `$${whereParams.length + 1}`;
  const limitParam = `$${whereParams.length + 2}`;

  try {
    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) AS cnt FROM ic_inventory${whereSql}`, whereParams),
      query(
        `SELECT code, COALESCE(name_1,'') AS name_1, COALESCE(name_eng_1,'') AS name_eng_1,` +
          ` COALESCE(unit_standard,'') AS unit_standard,` +
          ` COALESCE(balance_qty,0) AS balance_qty, COALESCE(book_out_qty,0) AS book_out_qty,` +
          ` COALESCE(accrued_out_qty,0) AS accrued_out_qty, COALESCE(accrued_in_qty,0) AS accrued_in_qty` +
          ` FROM ic_inventory${whereSql} ORDER BY ${orderBy} OFFSET ${offsetParam} LIMIT ${limitParam}`,
        [...whereParams, offsetNum, limitNum],
      ),
    ]);
    const totalCount = toInt(countRes.rows[0].cnt, 0);
    return res.json({ success: true, data: dataRes.rows, totalCount });
  } catch (ex) {
    console.error("getProductManageList error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// GET /service/v1/exportProductData
router.get("/exportProductData", requireAdmin("admin.productImportExport"), async (req, res) => {
  try {
    const result = await query(
      `SELECT
          i.code,
          COALESCE(i.name_1,'') AS name_1,
          COALESCE(i.name_2,'') AS name_2,
          COALESCE(i.name_eng_1,'') AS name_eng_1,
          COALESCE(i.name_eng_2,'') AS name_eng_2,
          COALESCE(i.unit_standard,'') AS unit_standard,
          COALESCE(i.unit_cost,'') AS unit_cost,
          COALESCE(i.item_category,'') AS item_category,
          COALESCE(i.item_brand,'') AS item_brand,
          COALESCE(i.group_main,'') AS group_main,
          COALESCE(i.group_sub,'') AS group_sub,
          COALESCE(i.group_sub2,'') AS group_sub2,
          COALESCE(i.item_design,'') AS item_design,
          COALESCE(i.item_model,'') AS item_model,
          COALESCE(i.item_pattern,'') AS item_pattern,
          COALESCE(i.item_grade,'') AS item_grade,
          COALESCE(i.description,'') AS description,
          COALESCE(d.dimension_31,'') AS dimension_31,
          COALESCE(d.dimension_32,'') AS dimension_32,
          COALESCE(d.dimension_33,'') AS dimension_33,
          COALESCE(d.dimension_34,'') AS dimension_34,
          COALESCE(d.dimension_35,'') AS dimension_35,
          COALESCE(d.dimension_36,'') AS dimension_36,
          COALESCE(d.dimension_37,'') AS dimension_37,
          COALESCE(d.dimension_38,'') AS dimension_38
       FROM ic_inventory i
       LEFT JOIN ic_inventory_detail d ON d.ic_code = i.code
       ORDER BY i.code`,
    );

    const csv = rowsToCsv(result.rows);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="product-export-${stamp}.csv"`);
    return res.send(csv);
  } catch (ex) {
    console.error("exportProductData error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// GET /service/v1/getProductImportTemplate
router.get("/getProductImportTemplate", async (req, res) => {
  try {
    const csv = rowsToCsv([]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="product-import-template.csv"`);
    return res.send(csv);
  } catch (ex) {
    console.error("getProductImportTemplate error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/verifyProductImportData
router.post("/verifyProductImportData", requireAdmin("admin.productImportExport"), async (req, res) => {
  try {
    const csvText = req.body?.csv_text || req.body?.csv || "";
    const parsed = parseProductImportCsv(csvText);
    const validation = await validateProductImportRows(parsed.headers, parsed.rows);
    const { preparedRows, ...safeValidation } = validation;
    return res.json({ success: validation.success, data: safeValidation });
  } catch (ex) {
    console.error("verifyProductImportData error:", ex.message);
    return res.status(ex.statusCode || 500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/importProductData
router.post("/importProductData", requireAdmin("admin.productImportExport"), async (req, res) => {
  try {
    const csvText = req.body?.csv_text || req.body?.csv || "";
    const parsed = parseProductImportCsv(csvText);
    const validation = await validateProductImportRows(parsed.headers, parsed.rows);
    if (!validation.success) {
      const { preparedRows, ...safeValidation } = validation;
      return res.status(400).json({ success: false, message: "ข้อมูลยังไม่ผ่านการตรวจสอบ", data: safeValidation });
    }

    await withTransaction(async (client) => {
      await updateProductImportBatch(client, validation.preparedRows, validation.update_fields);
    });

    return res.json({
      success: true,
      data: {
        total_rows: validation.total_rows,
        imported_rows: validation.preparedRows.length,
        update_fields: validation.update_fields,
      },
    });
  } catch (ex) {
    console.error("importProductData error:", ex.message);
    return res.status(ex.statusCode || 500).json({ success: false, message: ex.message });
  }
});

// ========== MARKETPLACE PRODUCT PARTICIPATION ==========

// GET /service/v1/getProductMarketplaceParticipation
router.get("/getProductMarketplaceParticipation", async (req, res) => {
  const { search = "", limit = "100", side = "all", cursor_code = "", not_joined_cursor = "", joined_cursor = "" } = req.query;
  const s = String(search || "").trim();
  const like = likeContains(s);
  const requestedSide = ["not_joined", "joined"].includes(String(side || "").trim()) ? String(side).trim() : "all";
  let limitNum = toInt(limit, 100);
  if (limitNum <= 0 || limitNum > 300) limitNum = 100;

  const searchSql =
    ` AND ($1 = '' OR i.code ILIKE $2 OR i.name_1 ILIKE $2 OR i.name_eng_1 ILIKE $2` + ` OR EXISTS (SELECT 1 FROM ic_inventory_barcode ib WHERE ib.ic_code = i.code AND ib.barcode ILIKE $2))`;
  const selectFields =
    `SELECT i.code, COALESCE(i.name_1,'') AS name_1, COALESCE(i.name_eng_1,'') AS name_eng_1,` +
    ` COALESCE(i.unit_standard,'') AS unit_standard, COALESCE(i.balance_qty,0) AS balance_qty,` +
    ` COALESCE(i.item_pattern,'') AS item_pattern FROM ic_inventory i`;
  const loadSide = async (targetSide, cursor) => {
    const joinedFilter = targetSide === "joined" ? "COALESCE(i.item_pattern,'') = '[W]'" : "COALESCE(i.item_pattern,'') <> '[W]'";
    const cleanCursor = String(cursor || "").trim();
    const cursorSql = cleanCursor ? " AND i.code > $3" : "";
    const params = cleanCursor ? [s, like, cleanCursor, limitNum] : [s, like, limitNum];
    const limitParam = cleanCursor ? "$4" : "$3";
    const result = await query(`${selectFields} WHERE ${joinedFilter}${searchSql}${cursorSql} ORDER BY i.code LIMIT ${limitParam}`, params);
    return result.rows.map((row) => ({ ...row, joined: targetSide === "joined" }));
  };

  try {
    const [notJoinedRows, joinedRows, notJoinedCountRes, joinedCountRes] = await Promise.all([
      requestedSide === "joined" ? Promise.resolve([]) : loadSide("not_joined", requestedSide === "not_joined" ? cursor_code : not_joined_cursor),
      requestedSide === "not_joined" ? Promise.resolve([]) : loadSide("joined", requestedSide === "joined" ? cursor_code : joined_cursor),
      query(`SELECT COUNT(*) AS cnt FROM ic_inventory i WHERE COALESCE(i.item_pattern,'') <> '[W]'${searchSql}`, [s, like]),
      query(`SELECT COUNT(*) AS cnt FROM ic_inventory i WHERE COALESCE(i.item_pattern,'') = '[W]'${searchSql}`, [s, like]),
    ]);

    return res.json({
      success: true,
      data: {
        not_joined: notJoinedRows,
        joined: joinedRows,
        not_joined_count: toInt(notJoinedCountRes.rows[0]?.cnt, 0),
        joined_count: toInt(joinedCountRes.rows[0]?.cnt, 0),
      },
    });
  } catch (ex) {
    console.error("getProductMarketplaceParticipation error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/setProductMarketplaceParticipation
router.post("/setProductMarketplaceParticipation", requireAdmin("admin.productParticipation"), async (req, res) => {
  const code = String(req.body?.code || "").trim();
  const joined = req.body?.joined === true || req.body?.joined === "1" || req.body?.joined === 1;
  if (!code) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });

  try {
    const result = await query(
      `UPDATE ic_inventory
          SET item_pattern = $2
        WHERE code = $1
        RETURNING code, COALESCE(name_1,'') AS name_1, COALESCE(name_eng_1,'') AS name_eng_1,
                  COALESCE(unit_standard,'') AS unit_standard, COALESCE(balance_qty,0) AS balance_qty,
                  COALESCE(item_pattern,'') AS item_pattern`,
      [code, joined ? "[W]" : ""],
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return res.json({ success: true, data: { ...result.rows[0], joined } });
  } catch (ex) {
    console.error("setProductMarketplaceParticipation error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// ========== PRODUCT ITEM DETAIL (สำหรับหน้าแก้ไข) ==========

// GET /service/v1/getProductItemDetail?code=
router.get("/getProductItemDetail", requireAdmin("admin.products"), async (req, res) => {
  const code = (req.query.code || "").trim();
  if (!code) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  try {
    const result = await query(
      `SELECT i.code, COALESCE(i.name_1,'') AS name_1, COALESCE(i.name_2,'') AS name_2,` +
        ` COALESCE(i.name_eng_1,'') AS name_eng_1, COALESCE(i.name_eng_2,'') AS name_eng_2,` +
        ` COALESCE(i.description,'') AS description,` +
        ` COALESCE(i.unit_standard,'') AS unit_standard, COALESCE(i.unit_cost,'') AS unit_cost,` +
        ` COALESCE(i.item_pattern,'') AS item_pattern, COALESCE(i.item_grade,'') AS item_grade,` +
        ` COALESCE(d.maximum_qty,0) AS maximum_qty, COALESCE(d.minimum_qty,0) AS minimum_qty, COALESCE(d.purchase_point,0) AS purchase_point,` +
        ` COALESCE(d.start_purchase_wh,'') AS start_purchase_wh, COALESCE(d.start_purchase_shelf,'') AS start_purchase_shelf,` +
        ` COALESCE(d.start_sale_wh,'') AS start_sale_wh, COALESCE(d.start_sale_shelf,'') AS start_sale_shelf,` +
        ` COALESCE(d.start_purchase_unit,'') AS start_purchase_unit, COALESCE(d.start_sale_unit,'') AS start_sale_unit,` +
        ` COALESCE(d.is_hold_sale,0) AS is_hold_sale, COALESCE(d.is_hold_purchase,0) AS is_hold_purchase, COALESCE(d.is_end,0) AS is_end,` +
        ` COALESCE(d.is_premium,0) AS is_premium,` +
        ` COALESCE(d.dimension_31,'') AS dimension_31, COALESCE(d.dimension_32,'') AS dimension_32,` +
        ` COALESCE(d.dimension_33,'') AS dimension_33, COALESCE(d.dimension_34,'') AS dimension_34,` +
        ` COALESCE(d.dimension_35,'') AS dimension_35, COALESCE(d.dimension_36,'') AS dimension_36,` +
        ` COALESCE(d.dimension_37,'') AS dimension_37, COALESCE(d.dimension_38,'') AS dimension_38,` +
        ` COALESCE(d.dimension_39,'') AS dimension_39, COALESCE(d.dimension_41,'') AS dimension_41,` +
        ` COALESCE(g.name_2,'') AS group_name_2,` +
        ` COALESCE(u.width_length_height,'') AS width_length_height, COALESCE(u.weight,'') AS weight,` +
        ` COALESCE(i.item_category,'') AS item_category, COALESCE(i.item_brand,'') AS item_brand,` +
        ` COALESCE(i.group_main,'') AS group_main, COALESCE(i.group_sub,'') AS group_sub,` +
        ` COALESCE(i.group_sub2,'') AS group_sub2,` +
        ` COALESCE(i.item_design,'') AS item_design, COALESCE(i.item_model,'') AS item_model` +
        ` FROM ic_inventory i` +
        ` LEFT JOIN ic_inventory_detail d ON d.ic_code = i.code` +
        ` LEFT JOIN ic_group g ON g.code = i.group_main` +
        ` LEFT JOIN ic_unit_use u ON u.ic_code = i.code AND u.code = i.unit_standard` +
        ` WHERE i.code = $1`,
      [code],
    );
    if (!result.rows.length) return res.status(400).json({ success: false, message: "ไม่พบสินค้า" });
    const warehouseShelfResult = await query(
      `SELECT ws.ic_code,
              COALESCE(ws.wh_code,'') AS wh_code,
              COALESCE(w.name_1,'') AS wh_name,
              COALESCE(ws.shelf_code,'') AS shelf_code,
              COALESCE(s.name_1,'') AS shelf_name,
              COALESCE(ws.shelf_list,'') AS shelf_list,
              COALESCE(ws.min_point,0) AS min_point,
              COALESCE(ws.max_point,0) AS max_point,
              COALESCE(ws.status,1) AS status
       FROM ic_wh_shelf ws
       LEFT JOIN ic_warehouse w ON w.code = ws.wh_code
       LEFT JOIN ic_shelf s ON s.whcode = ws.wh_code AND s.code = ws.shelf_code
       WHERE ws.ic_code=$1
       ORDER BY ws.wh_code, ws.shelf_code`,
      [code],
    );
    return res.json({ success: true, data: { ...result.rows[0], warehouse_shelves: warehouseShelfResult.rows } });
  } catch (ex) {
    console.error("getProductItemDetail error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/updateProductItemMain
// ── whitelist คอลัมน์ของ updateProductItemMain ────────────────────────────
//
// ชื่อคอลัมน์ทั้งหมดมาจากที่นี่เท่านั้น ห้ามเอา key ของ client ไปต่อเป็น SQL
// normalize ยกมาจากพฤติกรรมเดิมของ endpoint ทุกตัว เพื่อไม่ให้ค่าที่บันทึกเปลี่ยนรูป
const trimText = (v) => String(v ?? "").trim();

const PRODUCT_MAIN_INVENTORY_FIELDS = [
  { key: "name_1", normalize: trimText },
  { key: "name_2", normalize: trimText },
  { key: "name_eng_1", normalize: trimText },
  { key: "name_eng_2", normalize: trimText },
  // description เก็บทั้งก้อนไม่ trim เพราะเป็นเนื้อหายาวที่จัดรูปแบบไว้
  { key: "description", normalize: (v) => String(v ?? "") },
  { key: "unit_standard", normalize: trimText },
  { key: "unit_cost", normalize: trimText },
  { key: "item_category", normalize: trimText },
  { key: "item_brand", normalize: trimText },
  { key: "group_main", normalize: trimText },
  { key: "group_sub", normalize: trimText },
  { key: "group_sub2", normalize: trimText },
  { key: "item_design", normalize: trimText },
  { key: "item_model", normalize: trimText },
  { key: "item_pattern", normalize: trimText },
  { key: "item_grade", normalize: trimText },
];

const PRODUCT_MAIN_DETAIL_FIELDS = [
  { key: "maximum_qty", normalize: (v) => toNumber(v, 0) },
  { key: "minimum_qty", normalize: (v) => toNumber(v, 0) },
  { key: "purchase_point", normalize: (v) => toNumber(v, 0) },
  { key: "start_purchase_wh", normalize: trimText },
  { key: "start_purchase_shelf", normalize: trimText },
  { key: "start_sale_wh", normalize: trimText },
  { key: "start_sale_shelf", normalize: trimText },
  { key: "start_purchase_unit", normalize: trimText },
  { key: "start_sale_unit", normalize: trimText },
  { key: "is_hold_sale", normalize: (v) => (toNumber(v, 0) ? 1 : 0) },
  { key: "is_hold_purchase", normalize: (v) => (toNumber(v, 0) ? 1 : 0) },
  { key: "is_end", normalize: (v) => (toNumber(v, 0) ? 1 : 0) },
  { key: "is_premium", normalize: (v) => (toNumber(v, 0) ? 1 : 0) },
  { key: "dimension_31", normalize: (v) => normalizeHiddenDetailFields(v).join(",") },
  { key: "dimension_32", normalize: (v) => normalizeProductNameMode(v) },
  { key: "dimension_33", normalize: (v) => cleanDimensionText(v) },
  { key: "dimension_34", normalize: (v) => (String(v ?? "").trim() === "" ? "" : normalizeSalesDisplayMode(v)) },
  { key: "dimension_35", normalize: (v) => normalizePreorderMode(v) },
  { key: "dimension_36", normalize: (v) => cleanProductMediaUrl(v) },
  { key: "dimension_37", normalize: (v) => normalizeHiddenOnlineUnits(v) },
  { key: "dimension_38", normalize: (v) => normalizeMaxAllowance(v) },
  // รายละเอียดโปรโมชั่น — เนื้อหายาวที่จัดรูปแบบไว้ เก็บทั้งก้อนเหมือน description
  { key: "dimension_39", normalize: cleanPromotionDetail },
  // สวิตช์โปรโมชั่น — ปิดแล้วรายละเอียดโปรโมชั่นที่บันทึกไว้ยังอยู่ครบ แค่ไม่ถูกใช้งาน
  { key: "dimension_41", normalize: normalizePromotionSwitch },
];

const PRODUCT_MAIN_UNIT_FIELDS = [
  { key: "width_length_height", normalize: trimText },
  { key: "weight", normalize: trimText },
];
router.post("/updateProductItemMain", requireAdmin("admin.products"), async (req, res) => {
  const body = req.body || {};
  const c = String(body.code ?? "").trim();
  if (!c) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });

  // 🚨 เดิม destructure ทุกฟิลด์พร้อม default เป็น "" แล้ว UPDATE ทับทุกคอลัมน์เสมอ
  //    ส่งแค่ { code, dimension_38 } มาก็ล้าง name_1 / description / item_pattern ทิ้งหมด
  //    (item_pattern ว่าง = สินค้าหลุดจากหน้าร้านทันที) ตอบ 200 เหมือนสำเร็จ
  //    ตอนนี้เขียนเฉพาะคอลัมน์ที่ client ส่งมาจริง — ไม่ส่ง = ไม่แตะ, ส่งค่าว่าง = ล้างตามเจตนา
  const inventory = pickProvidedFields(body, PRODUCT_MAIN_INVENTORY_FIELDS);
  const detail = pickProvidedFields(body, PRODUCT_MAIN_DETAIL_FIELDS);
  // แยก 2 เจตนานี้ออกจากกัน — เดิมยุบเป็นตัวเดียวกัน ทำให้ "แก้แค่คลังเริ่มต้นขาย"
  // ไปเรียก replaceProductWarehouseShelves ที่ลบ ic_wh_shelf ทุกแถวของสินค้านั้นทิ้ง
  const replacesWarehouseShelves = hasOwn(body, "warehouse_shelves"); // ตั้งใจกำหนดรายการคลังใหม่ทั้งชุด
  const touchesStartSaleShelf = hasOwn(body, "start_sale_wh") || hasOwn(body, "start_sale_shelf");
  const touchesWarehouseShelves = replacesWarehouseShelves || touchesStartSaleShelf;
  const touchesUnitDimension = hasOwn(body, "width_length_height") || hasOwn(body, "weight");

  if (!inventory.columns.length && !detail.columns.length && !touchesWarehouseShelves && !touchesUnitDimension) {
    return res.status(400).json({ success: false, message: "ไม่มีข้อมูลที่ต้องบันทึก" });
  }

  if (hasOwn(body, "dimension_33") && !isValidProvidedStarThresholds(body.dimension_33)) {
    return res.status(400).json({ success: false, message: "ช่วงระดับดาวต้องเป็นตัวเลข 4 ค่า และเรียงจากน้อยไปมาก เช่น 100,500,1000,5000" });
  }

  // ส่งมาผิดชนิด = ปฏิเสธ  เดิม ?? [] กับ Array.isArray ยุบ null/สตริง เป็น [] ทำให้กลายเป็น "ตั้งใจล้าง"
  if (replacesWarehouseShelves && !Array.isArray(body.warehouse_shelves)) {
    return res.status(400).json({ success: false, message: "warehouse_shelves ต้องเป็นรายการ (array)" });
  }

  // คลัง/ที่เก็บต้องมาคู่กันเสมอ — ตรวจเฉพาะเมื่อ client แตะเรื่องนี้จริง
  const whCode = String(body.start_sale_wh ?? "").trim();
  const shelfCode = String(body.start_sale_shelf ?? "").trim();
  if (touchesWarehouseShelves && ((whCode && !shelfCode) || (!whCode && shelfCode))) {
    return res.status(400).json({ success: false, message: "กรุณาเลือกคลัง/ที่เก็บให้ครบ" });
  }
  const warehouseShelves = normalizeWarehouseShelfRows(body.warehouse_shelves ?? [], whCode, shelfCode);

  try {
    await withTransaction(async (client) => {
      if (whCode && shelfCode) await ensureWarehouseShelfExists(client, whCode, shelfCode);

      if (inventory.columns.length) {
        const setSql = buildSetClause(inventory.columns, 1);
        await client.query(`UPDATE ic_inventory SET ${setSql} WHERE code=$${inventory.values.length + 1}`, [...inventory.values, c]);
      }

      if (detail.columns.length) {
        // แถวใน ic_inventory_detail อาจยังไม่มี จึงต้อง INSERT ... ON CONFLICT
        // คอลัมน์ที่ไม่ได้ส่งมาจะได้ค่า default ตอน INSERT และไม่ถูกแตะตอน UPDATE
        const cols = ["ic_code", ...detail.columns];
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
        const conflictSql = buildConflictSetClause(detail.columns);
        await client.query(
          `INSERT INTO ic_inventory_detail (${cols.join(", ")}) VALUES (${placeholders})` +
            ` ON CONFLICT (ic_code) DO UPDATE SET ${conflictSql}`,
          [c, ...detail.values],
        );
      }

      const unitStd = String(body.unit_standard ?? "").trim();
      if (unitStd && touchesUnitDimension) {
        await ensureProductUnitUse(client, c, unitStd);
        const unitFields = pickProvidedFields(body, PRODUCT_MAIN_UNIT_FIELDS);
        if (unitFields.columns.length) {
          const setSql = buildSetClause(unitFields.columns, 1);
          await client.query(
            `UPDATE ic_unit_use SET ${setSql} WHERE ic_code=$${unitFields.values.length + 1} AND code=$${unitFields.values.length + 2}`,
            [...unitFields.values, c, unitStd],
          );
        }
      } else if (unitStd) {
        await ensureProductUnitUse(client, c, unitStd);
      }

      // ⚠️ replaceProductWarehouseShelves เริ่มด้วย DELETE ทุกแถวของสินค้านั้น
      //    เรียกได้เฉพาะตอน client ส่ง warehouse_shelves มาจริง = ตั้งใจกำหนดรายการใหม่ทั้งชุด
      if (replacesWarehouseShelves) {
        await ensureWarehouseShelfRowsExist(client, warehouseShelves);
        await replaceProductWarehouseShelves(client, c, warehouseShelves);
      } else if (touchesStartSaleShelf) {
        // แก้แค่คลัง/ที่เก็บเริ่มต้นขาย — เพิ่มแถวนั้นถ้ายังไม่มี ห้ามแตะแถวอื่น
        await addProductWarehouseShelfIfMissing(client, c, whCode, shelfCode);
      }

      await syncProductUnitType(client, c);
    });
    return res.json({ success: true });
  } catch (ex) {
    console.error("updateProductItemMain error:", ex.message);
    return res.status(ex.statusCode || 500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/createProductItemMain
router.post("/createProductItemMain", requireAdmin("admin.products"), async (req, res) => {
  const {
    code = "",
    name_1 = "",
    name_2 = "",
    name_eng_1 = "",
    name_eng_2 = "",
    description = "",
    unit_standard = "",
    unit_cost = "",
    maximum_qty = 0,
    minimum_qty = 0,
    purchase_point = 0,
    is_premium = 0,
    wh_code = "",
    shelf_code = "",
    start_sale_wh = "",
    start_sale_shelf = "",
    warehouse_shelves = [],
    width_length_height = "",
    weight = "",
    item_category = "",
    item_brand = "",
    group_main = "",
    group_sub = "",
    group_sub2 = "",
    item_design = "",
    item_model = "",
    item_grade = "",
    dimension_31 = "",
    dimension_32 = "",
    dimension_33 = "",
    dimension_34 = "",
    dimension_35 = "default",
    dimension_36 = "",
    dimension_37 = "",
    dimension_38 = "",
    dimension_39 = "",
    dimension_41 = "",
  } = req.body || {};

  const c = String(code).trim().toUpperCase();
  if (!c) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  if (!PRODUCT_CODE_PATTERN.test(c)) {
    return res.status(400).json({ success: false, message: "รูปแบบรหัสสินค้าไม่ถูกต้อง (อนุญาต A-Z, 0-9, -, _)" });
  }
  if (!String(name_1).trim()) return res.status(400).json({ success: false, message: "กรุณาระบุชื่อสินค้า" });
  if (!String(unit_standard).trim()) return res.status(400).json({ success: false, message: "กรุณาเลือกหน่วยมาตรฐาน" });
  if (!isValidProvidedStarThresholds(dimension_33)) {
    return res.status(400).json({ success: false, message: "ช่วงระดับดาวต้องเป็นตัวเลข 4 ค่า และเรียงจากน้อยไปมาก เช่น 100,500,1000,5000" });
  }

  const whCode = String(wh_code || start_sale_wh || "").trim();
  const shelfCode = String(shelf_code || start_sale_shelf || "").trim();
  const warehouseShelves = normalizeWarehouseShelfRows(warehouse_shelves, whCode, shelfCode);
  if ((whCode && !shelfCode) || (!whCode && shelfCode)) {
    return res.status(400).json({ success: false, message: "กรุณาเลือกคลัง/ที่เก็บให้ครบ" });
  }

  try {
    await withTransaction(async (client) => {
      if (whCode && shelfCode) await ensureWarehouseShelfExists(client, whCode, shelfCode);
      if (warehouseShelves.length) await ensureWarehouseShelfRowsExist(client, warehouseShelves);
      const exists = await client.query(`SELECT 1 FROM ic_inventory WHERE code = $1 LIMIT 1`, [c]);
      if (exists.rows.length) {
        const err = new Error("รหัสสินค้านี้มีอยู่แล้ว");
        err.statusCode = 400;
        throw err;
      }

      await client.query(
        `INSERT INTO ic_inventory (` +
          ` code, name_1, name_2, name_eng_1, name_eng_2,` +
          ` description, unit_standard, unit_cost, item_category, item_brand,` +
          ` group_main, group_sub, group_sub2, item_design, item_model, item_grade, unit_standard_stand_value, unit_standard_divide_value, update_price, update_detail` +
          `) VALUES (` +
          ` $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20` +
          `)`,
        [
          c,
          String(name_1).trim(),
          String(name_2).trim(),
          String(name_eng_1).trim(),
          String(name_eng_2).trim(),
          String(description),
          String(unit_standard).trim(),
          String(unit_cost).trim() || String(unit_standard).trim(),
          String(item_category).trim(),
          String(item_brand).trim(),
          String(group_main).trim(),
          String(group_sub).trim(),
          String(group_sub2).trim(),
          String(item_design).trim(),
          String(item_model).trim(),
          String(item_grade).trim(),
          1,
          1,
          1,
          1,
        ],
      );

      const unitStd = String(unit_standard).trim();
      await client.query(
        `INSERT INTO ic_inventory_detail (ic_code, maximum_qty, minimum_qty, purchase_point, is_premium, start_sale_wh, start_sale_shelf, dimension_31, dimension_32, dimension_33, dimension_34, dimension_35, dimension_36, dimension_37, dimension_38, dimension_39, dimension_41)` +
          ` VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)` +
          ` ON CONFLICT (ic_code) DO UPDATE SET maximum_qty=EXCLUDED.maximum_qty, minimum_qty=EXCLUDED.minimum_qty, purchase_point=EXCLUDED.purchase_point,` +
          ` is_premium=EXCLUDED.is_premium,` +
          ` start_sale_wh=EXCLUDED.start_sale_wh, start_sale_shelf=EXCLUDED.start_sale_shelf,` +
          ` dimension_31=EXCLUDED.dimension_31, dimension_32=EXCLUDED.dimension_32, dimension_33=EXCLUDED.dimension_33,` +
          ` dimension_34=EXCLUDED.dimension_34, dimension_35=EXCLUDED.dimension_35, dimension_36=EXCLUDED.dimension_36,` +
          ` dimension_37=EXCLUDED.dimension_37, dimension_38=EXCLUDED.dimension_38, dimension_39=EXCLUDED.dimension_39,` +
          ` dimension_41=EXCLUDED.dimension_41`,
        [
          c,
          toNumber(maximum_qty, 0),
          toNumber(minimum_qty, 0),
          toNumber(purchase_point, 0),
          toNumber(is_premium, 0) ? 1 : 0,
          whCode,
          shelfCode,
          normalizeHiddenDetailFields(dimension_31).join(","),
          normalizeProductNameMode(dimension_32),
          cleanDimensionText(dimension_33),
          String(dimension_34 ?? "").trim() === "" ? "" : normalizeSalesDisplayMode(dimension_34),
          normalizePreorderMode(dimension_35),
          cleanProductMediaUrl(dimension_36),
          normalizeHiddenOnlineUnits(dimension_37),
          // เดิมขาดตัวนี้ ทำให้ SQL ขอ 14 พารามิเตอร์แต่ส่งไป 13 สร้างสินค้าใหม่ไม่ได้เลยทุกครั้ง
          normalizeMaxAllowance(dimension_38),
          // รายละเอียดโปรโมชั่น — เก็บทั้งก้อน ไม่ตัด (คอลัมน์เป็น text)
          cleanPromotionDetail(dimension_39),
          normalizePromotionSwitch(dimension_41),
        ],
      );

      const unitUseExists = await client.query(`SELECT 1 FROM ic_unit_use WHERE ic_code = $1 AND code = $2 LIMIT 1`, [c, unitStd]);
      if (!unitUseExists.rows.length) {
        await client.query(`INSERT INTO ic_unit_use (ic_code, code, stand_value, divide_value, ratio, row_order, width_length_height, weight)` + ` VALUES ($1,$2,1,1,1,0,$3,$4)`, [
          c,
          unitStd,
          String(width_length_height).trim(),
          String(weight).trim(),
        ]);
      } else {
        await client.query(`UPDATE ic_unit_use SET width_length_height=$1, weight=$2 WHERE ic_code=$3 AND code=$4`, [String(width_length_height).trim(), String(weight).trim(), c, unitStd]);
      }
      if (warehouseShelves.length) await replaceProductWarehouseShelves(client, c, warehouseShelves);
      await syncProductUnitType(client, c);
    });

    return res.json({ success: true, code: c });
  } catch (ex) {
    if (isDuplicateKeyError(ex)) {
      return res.status(400).json({ success: false, message: "รหัสสินค้านี้มีอยู่แล้ว" });
    }
    console.error("createProductItemMain error:", ex.message);
    return res.status(ex.statusCode || 500).json({ success: false, message: ex.message });
  }
});

// ========== RELATED PRODUCTS (REPLACEMENT / SUGGEST) ==========

// GET /service/v1/getProductRelatedItems?ic_code=&kind=replacement|suggest
router.get("/getProductRelatedItems", async (req, res) => {
  const icCode = String(req.query.ic_code || "").trim();
  const config = resolveProductRelatedConfig(req.query.kind);
  if (!icCode) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  if (!config) return res.status(400).json({ success: false, message: "ประเภทข้อมูลไม่ถูกต้อง" });

  try {
    const result = await query(
      `SELECT rel.ic_code,
              rel.ic_code AS item_code,
              COALESCE(i.name_1,'') AS item_name,
              COALESCE(i.name_eng_1,'') AS name_eng_1,
              COALESCE(i.unit_standard,'') AS unit_code,
              COALESCE(i.item_type,0) AS item_type,
              COALESCE(rel.line_number,0) AS line_number,
              COALESCE(rel.status,1) AS status
       FROM ${config.table} rel
       LEFT JOIN ic_inventory i ON i.code = rel.ic_code
       WHERE rel.${config.ownerColumn} = $1
       ORDER BY COALESCE(rel.line_number,0), rel.ic_code`,
      [icCode],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error("getProductRelatedItems error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/saveProductRelatedItem
router.post("/saveProductRelatedItem", requireAdmin("admin.products"), async (req, res) => {
  const { kind = "", ic_code = "", item_code = "", original_item_code = "", line_number = 0, status = 1 } = req.body || {};
  const config = resolveProductRelatedConfig(kind);
  const ownerCode = String(ic_code).trim();
  const relatedCode = String(item_code).trim();
  const originalCode = String(original_item_code || relatedCode).trim();
  const lineNumber = toNumber(line_number, 0) || 0;
  const activeStatus = toInt(status, 1) === 0 ? 0 : 1;

  if (!config) return res.status(400).json({ success: false, message: "ประเภทข้อมูลไม่ถูกต้อง" });
  if (!ownerCode || !relatedCode) return res.status(400).json({ success: false, message: "กรุณาระบุสินค้าให้ครบ" });
  if (ownerCode === relatedCode) return res.status(400).json({ success: false, message: "ไม่สามารถเลือกสินค้าตัวเองได้" });

  try {
    await withTransaction(async (client) => {
      const productExists = await client.query(`SELECT 1 FROM ic_inventory WHERE code=$1 LIMIT 1`, [relatedCode]);
      if (!productExists.rows.length) {
        const err = new Error("ไม่พบสินค้าที่เลือก");
        err.statusCode = 400;
        throw err;
      }

      if (originalCode && originalCode !== relatedCode) {
        await client.query(`DELETE FROM ${config.table} WHERE ${config.ownerColumn}=$1 AND ic_code=$2`, [ownerCode, originalCode]);
      }

      const updated = await client.query(`UPDATE ${config.table} SET line_number=$3, status=$4 WHERE ${config.ownerColumn}=$1 AND ic_code=$2`, [ownerCode, relatedCode, lineNumber, activeStatus]);

      if (updated.rowCount === 0) {
        await client.query(`INSERT INTO ${config.table} (${config.ownerColumn}, ic_code, line_number, status) VALUES ($1,$2,$3,$4)`, [ownerCode, relatedCode, lineNumber, activeStatus]);
      }
    });
    return res.json({ success: true });
  } catch (ex) {
    console.error("saveProductRelatedItem error:", ex.message);
    return res.status(ex.statusCode || 500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/deleteProductRelatedItem
router.post("/deleteProductRelatedItem", requireAdmin("admin.products"), async (req, res) => {
  const { kind = "", ic_code = "", item_code = "" } = req.body || {};
  const config = resolveProductRelatedConfig(kind);
  const ownerCode = String(ic_code).trim();
  const relatedCode = String(item_code).trim();

  if (!config) return res.status(400).json({ success: false, message: "ประเภทข้อมูลไม่ถูกต้อง" });
  if (!ownerCode || !relatedCode) return res.status(400).json({ success: false, message: "กรุณาระบุสินค้าให้ครบ" });

  try {
    await query(`DELETE FROM ${config.table} WHERE ${config.ownerColumn}=$1 AND ic_code=$2`, [ownerCode, relatedCode]);
    return res.json({ success: true });
  } catch (ex) {
    console.error("deleteProductRelatedItem error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// แปลง duplicate key ของ PostgreSQL (23505) เป็น 400 ข้อความไทย
//
// เดิมโยน 500 พร้อมชื่อ constraint ดิบออกไปให้ client
// เช่น duplicate key value violates unique constraint "ic_inventory_barcode_pk_code"
// นอกจากอ่านไม่รู้เรื่องแล้ว ยังเป็นการเผยโครงสร้างฐานออกไปด้วย
// การเช็คก่อน INSERT กันการยิงพร้อมกันไม่ได้ (TOCTOU) จึงต้องดักที่ปลายทางด้วย
function isDuplicateKeyError(ex) {
  return ex && (ex.code === "23505" || String(ex.message || "").includes("duplicate key value"));
}

// ========== BARCODE CRUD ==========

// GET /service/v1/getProductItemBarcodes?ic_code=
router.get("/getProductItemBarcodes", requireAdmin("admin.products"), async (req, res) => {
  const ic_code = (req.query.ic_code || "").trim();
  if (!ic_code) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  try {
    const result = await query(
      `SELECT b.barcode, b.unit_code,` +
        ` COALESCE(b.price,0) AS price, COALESCE(b.price_member,0) AS price_member,` +
        ` COALESCE(b.price_2,0) AS price_2, COALESCE(b.price_member_2,0) AS price_member_2,` +
        ` COALESCE(b.price_member_3,0) AS price_member_3, COALESCE(b.price_member_4,0) AS price_member_4,` +
        ` COALESCE(u.name_1,'') AS unit_name, COALESCE(u.name_2,'') AS unit_name_2` +
        ` FROM ic_inventory_barcode b LEFT JOIN ic_unit u ON u.code = b.unit_code` +
        ` WHERE b.ic_code = $1 ORDER BY b.barcode DESC`,
      [ic_code],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error("getProductItemBarcodes error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// GET /service/v1/checkBarcodeInUse?ic_code=&barcode=
router.get("/checkBarcodeInUse", async (req, res) => {
  const ic_code = (req.query.ic_code || "").trim();
  const barcode = (req.query.barcode || "").trim();
  try {
    const result = await query(`SELECT COUNT(*) AS cnt FROM ic_trans_detail WHERE barcode=$1 AND item_code=$2`, [barcode, ic_code]);
    return res.json({ success: true, in_use: toInt(result.rows[0].cnt, 0) > 0 });
  } catch (ex) {
    console.error("checkBarcodeInUse error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/createProductItemBarcode
router.post("/createProductItemBarcode", requireAdmin("admin.products"), async (req, res) => {
  const { ic_code = "", barcode = "", unit_code = "", price = 0, price_member = 0, price_2 = 0, price_member_2 = 0, price_member_3 = 0, price_member_4 = 0 } = req.body || {};
  const c = String(ic_code).trim();
  const b = String(barcode).trim();
  if (!c || !b) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและบาร์โค้ด" });
  try {
    await query(`INSERT INTO ic_inventory_barcode (ic_code, barcode, unit_code, price, price_member, price_2, price_member_2, price_member_3, price_member_4)` + ` VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      c,
      b,
      String(unit_code).trim(),
      toNumber(price, 0),
      toNumber(price_member, 0),
      toNumber(price_2, 0),
      toNumber(price_member_2, 0),
      [0, 1, 2].includes(toInt(price_member_3, 0)) ? toInt(price_member_3, 0) : 0,
      toInt(price_member_4, 0) === 1 ? 1 : 0,
    ]);
    return res.json({ success: true });
  } catch (ex) {
    if (isDuplicateKeyError(ex)) {
      return res.status(400).json({ success: false, message: "บาร์โค้ดนี้มีอยู่แล้ว" });
    }
    console.error("createProductItemBarcode error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/updateProductItemBarcode
// whitelist ของบาร์โค้ด — ชื่อคอลัมน์มาจากที่นี่เท่านั้น ห้ามเอา key ของ client ไปต่อ SQL
const PRODUCT_BARCODE_FIELDS = [
  { key: "unit_code", normalize: (v) => String(v ?? "").trim() },
  { key: "price", normalize: (v) => toNumber(v, 0) },
  { key: "price_member", normalize: (v) => toNumber(v, 0) },
  { key: "price_2", normalize: (v) => toNumber(v, 0) },
  { key: "price_member_2", normalize: (v) => toNumber(v, 0) },
  { key: "price_member_3", normalize: (v) => ([0, 1, 2].includes(toInt(v, 0)) ? toInt(v, 0) : 0) },
  { key: "price_member_4", normalize: (v) => (toInt(v, 0) === 1 ? 1 : 0) },
];

router.post("/updateProductItemBarcode", requireAdmin("admin.products"), async (req, res) => {
  const body = req.body || {};
  const c = String(body.ic_code ?? "").trim();
  const b = String(body.barcode ?? "").trim();
  if (!c || !b) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและบาร์โค้ด" });

  // \ud83d\udea8 เดิม destructure พร้อม default 0/"" ทุกฟิลด์ แล้ว UPDATE ทับทุกคอลัมน์เสมอ
  //    ส่งแค่ { ic_code, barcode, price } ก็ล้าง unit_code และราคาสมาชิกทุกขั้นเป็น 0
  //    หลักการเดียวกันกับ updateProductItemMain: ไม่ส่ง = ไม่แตะ
  const fields = pickProvidedFields(body, PRODUCT_BARCODE_FIELDS);
  if (!fields.columns.length) {
    return res.status(400).json({ success: false, message: "ไม่มีข้อมูลที่ต้องบันทึก" });
  }

  try {
    const setSql = buildSetClause(fields.columns, 1);
    const n = fields.values.length;
    const result = await query(
      `UPDATE ic_inventory_barcode SET ${setSql} WHERE barcode=$${n + 1} AND ic_code=$${n + 2}`,
      [...fields.values, b, c],
    );
    // ไม่เช็ค rowCount ทำให้แก้บาร์โค้ดที่ไม่มีอยู่จริงแล้วได้ 200 เหมือนสำเร็จ
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบบาร์โค้ดนี้ของสินค้า" });
    }
    return res.json({ success: true });
  } catch (ex) {
    console.error("updateProductItemBarcode error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/deleteProductItemBarcode
router.post("/deleteProductItemBarcode", requireAdmin("admin.products"), async (req, res) => {
  const { ic_code = "", barcode = "" } = req.body || {};
  const c = String(ic_code).trim();
  const b = String(barcode).trim();
  if (!c || !b) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและบาร์โค้ด" });
  try {
    await query(`DELETE FROM ic_inventory_barcode WHERE barcode=$1 AND ic_code=$2`, [b, c]);
    return res.json({ success: true });
  } catch (ex) {
    console.error("deleteProductItemBarcode error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// ========== UNIT USE CRUD ==========

// GET /service/v1/getProductItemUnitUse?ic_code=
router.get("/getProductItemUnitUse", requireAdmin("admin.products"), async (req, res) => {
  const ic_code = (req.query.ic_code || "").trim();
  if (!ic_code) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  try {
    const result = await query(
      `SELECT u.code, COALESCE(u.stand_value,1::numeric) AS stand_value,` +
        ` COALESCE(u.divide_value,1::numeric) AS divide_value,` +
        ` COALESCE(u.ratio,1::numeric) AS ratio,` +
        ` COALESCE(u.row_order,0) AS row_order,` +
        ` COALESCE(u.width_length_height,'') AS width_length_height,` +
        ` COALESCE(u.weight,'') AS weight,` +
        ` CASE WHEN u.code = ANY(string_to_array(COALESCE(d.dimension_37,''), ',')) THEN 1 ELSE 0 END AS online_hidden,` +
        ` COALESCE(m.name_1,'') AS unit_name, COALESCE(m.name_2,'') AS unit_name_2` +
        ` FROM ic_unit_use u LEFT JOIN ic_unit m ON m.code = u.code` +
        ` LEFT JOIN ic_inventory_detail d ON d.ic_code = u.ic_code` +
        ` WHERE u.ic_code = $1 ORDER BY u.row_order`,
      [ic_code],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error("getProductItemUnitUse error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// GET /service/v1/checkUnitUseInUse?ic_code=&unit_code=
router.get("/checkUnitUseInUse", async (req, res) => {
  const ic_code = (req.query.ic_code || "").trim();
  const unit_code = (req.query.unit_code || "").trim();
  try {
    const result = await query(`SELECT COUNT(*) AS cnt FROM ic_trans_detail WHERE item_code=$1 AND unit_code=$2`, [ic_code, unit_code]);
    return res.json({ success: true, in_use: toInt(result.rows[0].cnt, 0) > 0 });
  } catch (ex) {
    console.error("checkUnitUseInUse error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/createProductItemUnitUse
router.post("/createProductItemUnitUse", requireAdmin("admin.products"), async (req, res) => {
  const { ic_code = "", code = "", stand_value = 1, divide_value = 1, row_order = 0, width_length_height = "", weight = "" } = req.body || {};
  const c = String(ic_code).trim();
  const u = String(code).trim();
  if (!c || !u) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและรหัสหน่วยนับ" });
  const sv = toNumber(stand_value, 1) || 1;
  const dv = toNumber(divide_value, 1) || 1;
  const ratio = dv !== 0 ? sv / dv : 0;
  try {
    await query(`INSERT INTO ic_unit_use (ic_code, code, stand_value, divide_value, ratio, row_order, width_length_height, weight)` + ` VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      c,
      u,
      sv,
      dv,
      ratio,
      toNumber(row_order, 0),
      String(width_length_height).trim(),
      String(weight).trim(),
    ]);
    // \ud83d\udea8 unit_type และ unit_standard_stand_value เป็นค่าที่ derive จาก ic_unit_use
    //    เดิม sync เฉพาะตอนบันทึกฟอร์มหลัก เพิ่ม/ลบหน่วยแล้วค่าจึงค้างของเก่า
    await syncProductUnitType({ query }, c);
    return res.json({ success: true });
  } catch (ex) {
    if (isDuplicateKeyError(ex)) {
      return res.status(400).json({ success: false, message: "หน่วยนับนี้มีอยู่แล้ว" });
    }
    console.error("createProductItemUnitUse error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/updateProductItemUnitUse
const PRODUCT_UNIT_USE_FIELDS = [
  { key: "row_order", normalize: (v) => toNumber(v, 0) },
  { key: "width_length_height", normalize: (v) => String(v ?? "").trim() },
  { key: "weight", normalize: (v) => String(v ?? "").trim() },
];

router.post("/updateProductItemUnitUse", requireAdmin("admin.products"), async (req, res) => {
  const body = req.body || {};
  const c = String(body.ic_code ?? "").trim();
  const u = String(body.code ?? "").trim();
  if (!c || !u) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและรหัสหน่วยนับ" });

  // \ud83d\udea8 เดิมทับทุกคอลัมน์เสมอ ส่งแค่ { ic_code, code, row_order } ก็รีเซ็ต stand_value/ratio เป็น 1
  //    อันตรายกว่าชื่อหาย เพราะ stand_value คืออัตราแปลงหน่วย พลาดแล้วสต็อก/ราคาผิดทั้งระบบ
  // ratio เป็นค่าที่ derive จาก stand_value/divide_value จึงอัปเดตเฉพาะตอนสองตัวนั้นถูกส่งมา
  const fields = pickProvidedFields(body, PRODUCT_UNIT_USE_FIELDS);
  const touchesRatio = hasOwn(body, "stand_value") || hasOwn(body, "divide_value");
  if (!fields.columns.length && !touchesRatio) {
    return res.status(400).json({ success: false, message: "ไม่มีข้อมูลที่ต้องบันทึก" });
  }

  try {
    const columns = [...fields.columns];
    const values = [...fields.values];
    if (touchesRatio) {
      const existing = await query(
        `SELECT COALESCE(stand_value,1) AS stand_value, COALESCE(divide_value,1) AS divide_value FROM ic_unit_use WHERE ic_code=$1 AND code=$2 LIMIT 1`,
        [c, u],
      );
      if (!existing.rows.length) {
        return res.status(404).json({ success: false, message: "ไม่พบหน่วยนับนี้ของสินค้า" });
      }
      const sv = hasOwn(body, "stand_value") ? (toNumber(body.stand_value, 1) || 1) : (toNumber(existing.rows[0].stand_value, 1) || 1);
      const dv = hasOwn(body, "divide_value") ? (toNumber(body.divide_value, 1) || 1) : (toNumber(existing.rows[0].divide_value, 1) || 1);
      columns.push("stand_value", "divide_value", "ratio");
      values.push(sv, dv, dv !== 0 ? sv / dv : 0);
    }

    const setSql = buildSetClause(columns, 1);
    const n = values.length;
    const result = await query(
      `UPDATE ic_unit_use SET ${setSql} WHERE ic_code=$${n + 1} AND code=$${n + 2}`,
      [...values, c, u],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบหน่วยนับนี้ของสินค้า" });
    }
    // unit_standard_stand_value ใน ic_inventory derive มาจากตารางนี้ ต้อง sync ทันที
    await syncProductUnitType({ query }, c);
    return res.json({ success: true });
  } catch (ex) {
    console.error("updateProductItemUnitUse error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/deleteProductItemUnitUse
router.post("/deleteProductItemUnitUse", requireAdmin("admin.products"), async (req, res) => {
  const { ic_code = "", code = "" } = req.body || {};
  const c = String(ic_code).trim();
  const u = String(code).trim();
  if (!c || !u) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและรหัสหน่วยนับ" });
  try {
    await query(`DELETE FROM ic_unit_use WHERE ic_code=$1 AND code=$2`, [c, u]);
    await syncProductUnitType({ query }, c);
    return res.json({ success: true });
  } catch (ex) {
    console.error("deleteProductItemUnitUse error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// ========== IMAGE MANAGEMENT ==========

// GET /service/v1/getProductImages?item_code=
// query จาก main pool (metadata only) — ตรงตาม Java
router.get("/getProductImages", async (req, res) => {
  const item_code = (req.query.item_code || "").trim();
  if (!item_code) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  try {
    const result = await queryImages(`SELECT image_id, guid_code, image_order FROM images WHERE image_id = $1 ORDER BY image_order ASC`, [item_code]);
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error("getProductImages error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/saveProductImage
// dual-pool transaction: main + images — ตรงตาม Java saveProductImage
router.post("/saveProductImage", requireAdmin("admin.products"), async (req, res) => {
  const { item_code = "", image_file = "" } = req.body || {};
  const ic = String(item_code).trim();
  const imgData = String(image_file);
  if (!ic || !imgData) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและรูปภาพ" });

  const base64 = imgData.replace(/^data:[^;]+;base64,/, "");
  const bytes = Buffer.from(base64, "base64");
  const guid = randomUUID();

  const clientMain = await pool.connect();
  const clientImg = await poolImages.connect();
  try {
    await clientMain.query("BEGIN");
    await clientImg.query("BEGIN");

    const orderRes = await clientMain.query(`SELECT COALESCE(MAX(image_order), -1) + 1 AS next_order FROM images WHERE image_id = $1`, [ic]);
    const nextOrder = toInt(orderRes.rows[0].next_order, 0) || 0;

    await clientImg.query(`INSERT INTO images (image_id, image_file, guid_code, image_order) VALUES ($1,$2,$3,$4)`, [ic, bytes, guid, nextOrder]);
    await clientMain.query(`INSERT INTO images (image_id, guid_code, image_order) VALUES ($1,$2,$3)`, [ic, guid, nextOrder]);

    // 2 DB commit แยกกันไม่ใช่ atomic — เรียง commit ให้ DB รูปก่อน DB หลัก
    // ถ้าพังระหว่างกลาง จะเหลือ BLOB กำพร้า (มองไม่เห็น เปลืองที่อย่างเดียว)
    // แทนที่จะเหลือ metadata กำพร้าซึ่งทำให้รูปเสียในหน้าร้าน
    await clientImg.query("COMMIT");
    try {
      await clientMain.query("COMMIT");
    } catch (commitEx) {
      // compensating action: ลบ BLOB ที่ commit ไปแล้วออก เพราะ metadata ไม่ได้ลง
      await clientImg.query(`DELETE FROM images WHERE guid_code = $1`, [guid]).catch((cleanupEx) => {
        console.error(`saveProductImage: ลบ BLOB กำพร้า guid=${guid} ไม่สำเร็จ —`, cleanupEx.message);
      });
      throw commitEx;
    }
    return res.json({ success: true, guid_code: guid });
  } catch (ex) {
    await clientMain.query("ROLLBACK").catch(() => {});
    await clientImg.query("ROLLBACK").catch(() => {});
    console.error("saveProductImage error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  } finally {
    clientMain.release();
    clientImg.release();
  }
});

// POST /service/v1/deleteProductImage
// dual-pool: ลบทั้ง 2 DB
router.post("/deleteProductImage", requireAdmin("admin.products"), async (req, res) => {
  const { guid_code = "" } = req.body || {};
  const guid = String(guid_code).trim();
  if (!guid) return res.status(400).json({ success: false, message: "กรุณาระบุ guid_code" });

  const clientMain = await pool.connect();
  const clientImg = await poolImages.connect();
  try {
    await clientMain.query("BEGIN");
    await clientImg.query("BEGIN");

    await clientImg.query(`DELETE FROM images WHERE guid_code = $1`, [guid]);
    await clientMain.query(`DELETE FROM images WHERE guid_code = $1`, [guid]);

    await clientMain.query("COMMIT");
    await clientImg.query("COMMIT");
    return res.json({ success: true });
  } catch (ex) {
    await clientMain.query("ROLLBACK").catch(() => {});
    await clientImg.query("ROLLBACK").catch(() => {});
    console.error("deleteProductImage error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  } finally {
    clientMain.release();
    clientImg.release();
  }
});

// POST /service/v1/reorderProductImages
// dual-pool batch UPDATE image_order
router.post("/reorderProductImages", requireAdmin("admin.products"), async (req, res) => {
  const { item_code = "", orders = [] } = req.body || {};
  const ic = String(item_code).trim();
  if (!ic || !Array.isArray(orders) || !orders.length) {
    return res.status(400).json({ success: false, message: "ข้อมูลไม่ครบ" });
  }

  const clientMain = await pool.connect();
  const clientImg = await poolImages.connect();
  try {
    await clientMain.query("BEGIN");
    await clientImg.query("BEGIN");

    for (const o of orders) {
      const guid = String(o.guid_code || "");
      const order = toInt(o.image_order, 0) || 0;
      await clientImg.query(`UPDATE images SET image_order=$1 WHERE guid_code=$2 AND image_id=$3`, [order, guid, ic]);
      await clientMain.query(`UPDATE images SET image_order=$1 WHERE guid_code=$2 AND image_id=$3`, [order, guid, ic]);
    }

    await clientMain.query("COMMIT");
    await clientImg.query("COMMIT");
    return res.json({ success: true });
  } catch (ex) {
    await clientMain.query("ROLLBACK").catch(() => {});
    await clientImg.query("ROLLBACK").catch(() => {});
    console.error("reorderProductImages error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  } finally {
    clientMain.release();
    clientImg.release();
  }
});

// ========== SALE PRICE / PROMOTION CRUD ==========

function cleanDateText(value) {
  return String(value || "")
    .trim()
    .slice(0, 10);
}

function cleanNumber(value, fallback = 0) {
  return toNumber(value, fallback);
}

async function syncRoworderSequence(client, tableName) {
  if (!["ic_inventory_price", "ic_inventory_discount"].includes(tableName)) throw httpError("invalid roworder table", 500);
  await client.query(
    `WITH stats AS (SELECT COALESCE(MAX(roworder), 0) AS max_roworder FROM ${tableName})
     SELECT setval(
       pg_get_serial_sequence($1, 'roworder'),
       GREATEST((SELECT max_roworder FROM stats), 1),
       (SELECT max_roworder > 0 FROM stats)
     )`,
    [tableName],
  );
}

router.get("/getProductSalePrices", async (req, res) => {
  const ic_code = String(req.query.ic_code || "").trim();
  if (!ic_code) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  try {
    const result = await query(
      `SELECT COALESCE(roworder,0) AS roworder, COALESCE(line_number,0) AS line_number,
              ic_code, unit_code,
              COALESCE(price_type,1) AS price_type,
              COALESCE(price_mode,0) AS price_mode,
              COALESCE(sale_type,0) AS sale_type,
              to_char(from_date,'YYYY-MM-DD') AS from_date,
              to_char(to_date,'YYYY-MM-DD') AS to_date,
              COALESCE(from_qty,0) AS from_qty,
              COALESCE(to_qty,0) AS to_qty,
              COALESCE(sale_price1,0) AS sale_price1,
              COALESCE(sale_price2,0) AS sale_price2,
              COALESCE(cust_code,'') AS cust_code,
              COALESCE(cust_group_1,'') AS cust_group_1,
              COALESCE(cust_group_2,'') AS cust_group_2,
              COALESCE(transport_type,0) AS transport_type,
              COALESCE(currency_code,'') AS currency_code,
              COALESCE(price_currency,0) AS price_currency
         FROM ic_inventory_price
        WHERE ic_code=$1
        ORDER BY unit_code, price_type DESC, price_mode DESC, sale_type DESC, from_date DESC, from_qty, roworder DESC, line_number DESC`,
      [ic_code],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error("getProductSalePrices error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

router.post("/saveProductSalePrice", requireAdmin("admin.products"), async (req, res) => {
  const body = req.body || {};
  const icCode = String(body.ic_code || "").trim();
  const unitCode = String(body.unit_code || "").trim();
  const roworder = body.roworder === undefined || body.roworder === null || body.roworder === "" ? null : toInt(body.roworder, NaN);
  if (!icCode || !unitCode) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและหน่วยนับ" });
  if (!cleanDateText(body.from_date) || !cleanDateText(body.to_date)) return res.status(400).json({ success: false, message: "กรุณาระบุช่วงวันที่" });
  if (cleanNumber(body.from_qty, 0) > cleanNumber(body.to_qty, 0)) return res.status(400).json({ success: false, message: "ช่วงจำนวนไม่ถูกต้อง" });
  const priceType = toInt(body.price_type, 1) || 1;
  if (priceType === 1) {
    body.cust_code = "";
    body.cust_group_1 = "";
    body.cust_group_2 = "";
  } else if (priceType === 2) {
    body.cust_code = "";
    if (!String(body.cust_group_1 || "").trim()) return res.status(400).json({ success: false, message: "กรุณาเลือกกลุ่มลูกค้า 1" });
  } else if (priceType === 3) {
    body.cust_group_1 = "";
    body.cust_group_2 = "";
    if (!String(body.cust_code || "").trim()) return res.status(400).json({ success: false, message: "กรุณาเลือกรหัสลูกค้า" });
  }

  try {
    await withTransaction(async (client) => {
      if (roworder !== null && Number.isFinite(roworder)) {
        const updated = await client.query(
          `UPDATE ic_inventory_price
              SET unit_code=$3, price_type=$4, price_mode=$5, sale_type=$6,
                  from_date=$7::date, to_date=$8::date, from_qty=$9, to_qty=$10,
                  sale_price1=$11, sale_price2=$12,
                  cust_code=$13, cust_group_1=$14, cust_group_2=$15,
                  transport_type=$16, currency_code=$17, price_currency=$18
            WHERE ic_code=$1 AND roworder=$2`,
          [
            icCode,
            roworder,
            unitCode,
            toInt(body.price_type, 1) || 1,
            toInt(body.price_mode, 0) || 0,
            toInt(body.sale_type, 0) || 0,
            cleanDateText(body.from_date),
            cleanDateText(body.to_date),
            cleanNumber(body.from_qty, 0),
            cleanNumber(body.to_qty, 0),
            cleanNumber(body.sale_price1, 0),
            cleanNumber(body.sale_price2, 0),
            String(body.cust_code || "").trim(),
            String(body.cust_group_1 || "").trim(),
            String(body.cust_group_2 || "").trim(),
            toInt(body.transport_type, 0) || 0,
            String(body.currency_code || "").trim(),
            toInt(body.price_currency, 0) || 0,
          ],
        );
        if (updated.rowCount > 0) return;
      }

      const next = await client.query(`SELECT COALESCE(MAX(line_number),0)+1 AS line_number FROM ic_inventory_price WHERE ic_code=$1`, [icCode]);
      await syncRoworderSequence(client, "ic_inventory_price");
      await client.query(
        `INSERT INTO ic_inventory_price (
            ic_code, unit_code, line_number, price_type, price_mode, sale_type,
            from_date, to_date, from_qty, to_qty, sale_price1, sale_price2,
            cust_code, cust_group_1, cust_group_2, transport_type, currency_code, price_currency
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          icCode,
          unitCode,
          toInt(next.rows[0].line_number, 1) || 1,
          toInt(body.price_type, 1) || 1,
          toInt(body.price_mode, 0) || 0,
          toInt(body.sale_type, 0) || 0,
          cleanDateText(body.from_date),
          cleanDateText(body.to_date),
          cleanNumber(body.from_qty, 0),
          cleanNumber(body.to_qty, 0),
          cleanNumber(body.sale_price1, 0),
          cleanNumber(body.sale_price2, 0),
          String(body.cust_code || "").trim(),
          String(body.cust_group_1 || "").trim(),
          String(body.cust_group_2 || "").trim(),
          toInt(body.transport_type, 0) || 0,
          String(body.currency_code || "").trim(),
          toInt(body.price_currency, 0) || 0,
        ],
      );
    });
    return res.json({ success: true });
  } catch (ex) {
    console.error("saveProductSalePrice error:", ex.message);
    return res.status(ex.statusCode || 500).json({ success: false, message: ex.message });
  }
});

router.post("/deleteProductSalePrice", requireAdmin("admin.products"), async (req, res) => {
  const icCode = String(req.body?.ic_code || "").trim();
  const roworder = toInt(req.body?.roworder, NaN);
  if (!icCode || !Number.isFinite(roworder)) return res.status(400).json({ success: false, message: "ข้อมูลไม่ครบ" });
  try {
    await query(`DELETE FROM ic_inventory_price WHERE ic_code=$1 AND roworder=$2`, [icCode, roworder]);
    return res.json({ success: true });
  } catch (ex) {
    console.error("deleteProductSalePrice error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// ========== DISCOUNT CONDITION CRUD ==========

router.get("/getProductDiscountConditions", async (req, res) => {
  const ic_code = String(req.query.ic_code || "").trim();
  if (!ic_code) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  try {
    const result = await query(
      `SELECT COALESCE(roworder,0) AS roworder, COALESCE(line_number,0) AS line_number,
              ic_code, unit_code,
              COALESCE(discount_type,0) AS discount_type,
              COALESCE(sale_type,0) AS sale_type,
              to_char(from_date,'YYYY-MM-DD') AS from_date,
              to_char(to_date,'YYYY-MM-DD') AS to_date,
              COALESCE(from_qty,0) AS from_qty,
              COALESCE(to_qty,0) AS to_qty,
              COALESCE(discount,'') AS discount,
              COALESCE(cust_code,'') AS cust_code,
              COALESCE(cust_group_1,'') AS cust_group_1,
              COALESCE(cust_group_2,'') AS cust_group_2
         FROM ic_inventory_discount
        WHERE ic_code=$1
        ORDER BY unit_code, discount_type DESC, sale_type DESC, from_date DESC, from_qty, roworder DESC, line_number DESC`,
      [ic_code],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error("getProductDiscountConditions error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

router.post("/saveProductDiscountCondition", requireAdmin("admin.products"), async (req, res) => {
  const body = req.body || {};
  const icCode = String(body.ic_code || "").trim();
  const unitCode = String(body.unit_code || "").trim();
  const roworder = body.roworder === undefined || body.roworder === null || body.roworder === "" ? null : toInt(body.roworder, NaN);
  if (!icCode || !unitCode) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและหน่วยนับ" });
  if (!String(body.discount || "").trim()) return res.status(400).json({ success: false, message: "กรุณาระบุส่วนลด" });
  if (!cleanDateText(body.from_date) || !cleanDateText(body.to_date)) return res.status(400).json({ success: false, message: "กรุณาระบุช่วงวันที่" });
  if (cleanNumber(body.from_qty, 0) > cleanNumber(body.to_qty, 0)) return res.status(400).json({ success: false, message: "ช่วงจำนวนไม่ถูกต้อง" });
  const discountType = toInt(body.discount_type, 0) || 0;
  if (discountType === 0) {
    body.cust_code = "";
    body.cust_group_1 = "";
    body.cust_group_2 = "";
  } else if (discountType === 1) {
    body.cust_code = "";
    if (!String(body.cust_group_1 || "").trim()) return res.status(400).json({ success: false, message: "กรุณาเลือกกลุ่มลูกค้า 1" });
  } else if (discountType === 2) {
    body.cust_group_1 = "";
    body.cust_group_2 = "";
    if (!String(body.cust_code || "").trim()) return res.status(400).json({ success: false, message: "กรุณาเลือกรหัสลูกค้า" });
  }

  try {
    await withTransaction(async (client) => {
      if (roworder !== null && Number.isFinite(roworder)) {
        const updated = await client.query(
          `UPDATE ic_inventory_discount
              SET unit_code=$3, discount_type=$4, sale_type=$5,
                  from_date=$6::date, to_date=$7::date, from_qty=$8, to_qty=$9,
                  discount=$10, cust_code=$11, cust_group_1=$12, cust_group_2=$13
            WHERE ic_code=$1 AND roworder=$2`,
          [
            icCode,
            roworder,
            unitCode,
            toInt(body.discount_type, 0) || 0,
            toInt(body.sale_type, 0) || 0,
            cleanDateText(body.from_date),
            cleanDateText(body.to_date),
            cleanNumber(body.from_qty, 0),
            cleanNumber(body.to_qty, 0),
            String(body.discount || "").trim(),
            String(body.cust_code || "").trim(),
            String(body.cust_group_1 || "").trim(),
            String(body.cust_group_2 || "").trim(),
          ],
        );
        if (updated.rowCount > 0) return;
      }

      const next = await client.query(`SELECT COALESCE(MAX(line_number),0)+1 AS line_number FROM ic_inventory_discount WHERE ic_code=$1`, [icCode]);
      await syncRoworderSequence(client, "ic_inventory_discount");
      await client.query(
        `INSERT INTO ic_inventory_discount (
            ic_code, unit_code, line_number, discount_type, sale_type,
            from_date, to_date, from_qty, to_qty, discount,
            cust_code, cust_group_1, cust_group_2
         ) VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13)`,
        [
          icCode,
          unitCode,
          toInt(next.rows[0].line_number, 1) || 1,
          toInt(body.discount_type, 0) || 0,
          toInt(body.sale_type, 0) || 0,
          cleanDateText(body.from_date),
          cleanDateText(body.to_date),
          cleanNumber(body.from_qty, 0),
          cleanNumber(body.to_qty, 0),
          String(body.discount || "").trim(),
          String(body.cust_code || "").trim(),
          String(body.cust_group_1 || "").trim(),
          String(body.cust_group_2 || "").trim(),
        ],
      );
    });
    return res.json({ success: true });
  } catch (ex) {
    console.error("saveProductDiscountCondition error:", ex.message);
    return res.status(ex.statusCode || 500).json({ success: false, message: ex.message });
  }
});

router.post("/deleteProductDiscountCondition", requireAdmin("admin.products"), async (req, res) => {
  const icCode = String(req.body?.ic_code || "").trim();
  const roworder = toInt(req.body?.roworder, NaN);
  if (!icCode || !Number.isFinite(roworder)) return res.status(400).json({ success: false, message: "ข้อมูลไม่ครบ" });
  try {
    await query(`DELETE FROM ic_inventory_discount WHERE ic_code=$1 AND roworder=$2`, [icCode, roworder]);
    return res.json({ success: true });
  } catch (ex) {
    console.error("deleteProductDiscountCondition error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// ========== PRICE FORMULA CRUD ==========

// GET /service/v1/getProductPriceFormulas?ic_code=
router.get("/getProductPriceFormulas", async (req, res) => {
  const ic_code = (req.query.ic_code || "").trim();
  if (!ic_code) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้า" });
  try {
    const result = await query(
      `SELECT ic_code, unit_code, sale_type, tax_type,` +
        ` COALESCE(price_0,'') AS price_0, COALESCE(price_1,'') AS price_1,` +
        ` COALESCE(price_2,'') AS price_2, COALESCE(price_3,'') AS price_3,` +
        ` COALESCE(price_4,'') AS price_4, COALESCE(price_5,'') AS price_5,` +
        ` COALESCE(price_6,'') AS price_6, COALESCE(price_7,'') AS price_7,` +
        ` COALESCE(price_8,'') AS price_8, COALESCE(price_9,'') AS price_9` +
        ` FROM ic_inventory_price_formula WHERE ic_code = $1 AND currency_code = ''` +
        ` ORDER BY unit_code, sale_type, tax_type`,
      [ic_code],
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    console.error("getProductPriceFormulas error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/saveProductPriceFormula
router.post("/saveProductPriceFormula", requireAdmin("admin.products"), async (req, res) => {
  const {
    ic_code = "",
    unit_code = "",
    sale_type = 0,
    tax_type = 0,
    price_0 = "",
    price_1 = "",
    price_2 = "",
    price_3 = "",
    price_4 = "",
    price_5 = "",
    price_6 = "",
    price_7 = "",
    price_8 = "",
    price_9 = "",
  } = req.body || {};
  const c = String(ic_code).trim();
  const uc = String(unit_code).trim();
  if (!c || !uc) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและหน่วยนับ" });
  const st = toInt(sale_type, 0) || 0;
  const tt = toInt(tax_type, 0) || 0;
  const toStr = (v) => String(v ?? "").trim();
  const prices = [toStr(price_0), toStr(price_1), toStr(price_2), toStr(price_3), toStr(price_4), toStr(price_5), toStr(price_6), toStr(price_7), toStr(price_8), toStr(price_9)];
  try {
    await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE ic_inventory_price_formula SET` +
          `  price_0=$5, price_1=$6, price_2=$7, price_3=$8, price_4=$9,` +
          `  price_5=$10, price_6=$11, price_7=$12, price_8=$13, price_9=$14` +
          ` WHERE ic_code=$1 AND unit_code=$2 AND sale_type=$3 AND tax_type=$4 AND currency_code=''`,
        [c, uc, st, tt, ...prices],
      );
      if (upd.rowCount === 0) {
        await client.query(
          `INSERT INTO ic_inventory_price_formula` +
            ` (ic_code, unit_code, sale_type, tax_type, currency_code,` +
            `  price_0, price_1, price_2, price_3, price_4, price_5, price_6, price_7, price_8, price_9)` +
            ` VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [c, uc, st, tt, ...prices],
        );
      }
    });
    return res.json({ success: true });
  } catch (ex) {
    console.error("saveProductPriceFormula error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

// POST /service/v1/deleteProductPriceFormula
router.post("/deleteProductPriceFormula", requireAdmin("admin.products"), async (req, res) => {
  const { ic_code = "", unit_code = "", sale_type = 0, tax_type = 0 } = req.body || {};
  const c = String(ic_code).trim();
  const uc = String(unit_code).trim();
  if (!c || !uc) return res.status(400).json({ success: false, message: "กรุณาระบุรหัสสินค้าและหน่วยนับ" });
  try {
    await query(`DELETE FROM ic_inventory_price_formula WHERE ic_code=$1 AND unit_code=$2 AND sale_type=$3 AND tax_type=$4 AND currency_code=''`, [
      c,
      uc,
      toInt(sale_type, 0) || 0,
      toInt(tax_type, 0) || 0,
    ]);
    return res.json({ success: true });
  } catch (ex) {
    console.error("deleteProductPriceFormula error:", ex.message);
    return res.status(500).json({ success: false, message: ex.message });
  }
});

module.exports = router;
// เปิดให้เทสต์เรียกกติกาสวิตช์โปรโมชั่นได้ตรงๆ (แพทเทิร์นเดียวกับ routes/order.js)
module.exports.normalizePromotionSwitch = normalizePromotionSwitch;
module.exports.cleanPromotionDetail = cleanPromotionDetail;
