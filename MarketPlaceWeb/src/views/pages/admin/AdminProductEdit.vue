<script setup>
import {
  checkBarcodeInUse,
  checkUnitUseInUse,
  createProductItemBarcode,
  createProductItemUnitUse,
  deleteProductImage,
  deleteProductItemBarcode,
  deleteProductItemUnitUse,
  deleteProductDiscountCondition,
  deleteProductPriceFormula,
  deleteProductSalePrice,
  getCustomerGroupList,
  getCustomerGroupSubList,
  getProductDiscountConditions,
  getProductBrandList,
  getProductCategoryList,
  getProductDesignList,
  getProductGroupList,
  getProductGroupSubList,
  getProductGroupSub2List,
  getProductGradeList,
  getProductImageGuidUrl,
  getProductImages,
  getProductItemBarcodes,
  getProductItemDetail,
  getProductItemUnitUse,
  getProductManageList,
  getProductModelList,
  getProductPatternList,
  getProductPriceFormulas,
  getProductRelatedItems,
  getProductSalePrices,
  getUnitManageList,
  reorderProductImages,
  saveProductDiscountCondition,
  saveProductImage,
  saveProductPriceFormula,
  saveProductRelatedItem,
  saveProductSalePrice,
  deleteProductRelatedItem,
  updateProductItemBarcode,
  updateProductItemMain,
  updateProductItemUnitUse,
} from "@/services/productManageService";
import CustomerService from "@/services/CustomerService";
import InventoryService from "@/services/InventoryService";
import MediaService from "@/services/MediaService";
import SalesSettingsService from "@/services/SalesSettingsService";
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import Editor from "primevue/editor";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { useToast } from "primevue/usetoast";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const toast = useToast();

const itemCode = route.params.code;

// ส่วนที่ 1 — ข้อมูลหลัก
const form = ref({
  code: "",
  name_1: "",
  name_2: "",
  name_eng_1: "",
  name_eng_2: "",
  description: "",
  unit_standard: "",
  unit_cost: "",
  item_pattern: "",
  item_grade: "",
  start_purchase_wh: "",
  start_purchase_shelf: "",
  start_sale_wh: "",
  start_sale_shelf: "",
  start_purchase_unit: "",
  start_sale_unit: "",
  maximum_qty: 0,
  minimum_qty: 0,
  purchase_point: 0,
  is_hold_sale: false,
  is_hold_purchase: false,
  is_end: false,
  is_premium: false,
  width_length_height: "",
  weight: "",
  item_category: "",
  item_brand: "",
  group_main: "",
  group_sub: "",
  group_sub2: "",
  item_design: "",
  item_model: "",
  dimension_31: "",
  dimension_32: "",
  dimension_33: "",
  dimension_34: "",
  dimension_35: "default",
  dimension_36: "",
  dimension_37: "",
  dimension_38: "",
  // รายละเอียดโปรโมชั่นที่พิมพ์เอง — แสดงคู่กับโปรโมชันจากระบบในหน้าสินค้า
  dimension_39: "",
  // สวิตช์เปิด/ปิดโปรโมชั่น (dimension_41) — ปิดเป็นค่าเริ่มต้น
  dimension_41: false,
});
const isLoadingMain = ref(false);
const isSavingMain = ref(false);
const isSavingOnlineUnits = ref(false);
const showExtraDetails = ref(false);
const preorderDefaultEnabled = ref(null);

// dropdowns
const unitOptions = ref([]);
const categoryOptions = ref([]);
const productBrandOptions = ref([]);
const productGroupOptions = ref([]);
const productGroupSubOptions = ref([]);
const productGroupSub2Options = ref([]);
const productDesignOptions = ref([]);
const productModelOptions = ref([]);
const productPatternOptions = ref([]);
const productGradeOptions = ref([]);
const customerGroupOptions = ref([]);
const customerGroupSubOptions = ref([]);
const customerOptions = ref([]);
const isLoadingCustomers = ref(false);
const warehouseOptions = ref([]);
const shelfOptions = ref([]);
const warehouseShelves = ref([]);

// ส่วนที่ 2 — บาร์โค้ด
const barcodes = ref([]);
const isLoadingBarcodes = ref(false);
const barcodeSearch = ref("");
const barcodePage = ref(1);
const BARCODE_PAGE_SIZE = 10;

const filteredBarcodes = computed(() => {
  const q = barcodeSearch.value.trim().toLowerCase();
  if (!q) return barcodes.value;
  return barcodes.value.filter((b) => b.barcode.toLowerCase().includes(q) || (b.unit_name || b.unit_code).toLowerCase().includes(q));
});
const barcodeTotalPages = computed(() => Math.max(1, Math.ceil(filteredBarcodes.value.length / BARCODE_PAGE_SIZE)));
const pagedBarcodes = computed(() => {
  const start = (barcodePage.value - 1) * BARCODE_PAGE_SIZE;
  return filteredBarcodes.value.slice(start, start + BARCODE_PAGE_SIZE);
});

const showBarcodeDialog = ref(false);
const barcodeMode = ref("create");
const barcodeForm = ref({ ic_code: itemCode, barcode: "", unit_code: "", price: 0, price_member: 0, price_2: 0, price_member_2: 0, price_member_3: 0, price_member_4: 0 });
const isSavingBarcode = ref(false);

// ส่วนที่ 3 — หน่วยนับ
const unitUseList = ref([]);
const isLoadingUnitUse = ref(false);
const showUnitUseDialog = ref(false);
const unitUseMode = ref("create");
const unitUseForm = ref({ ic_code: itemCode, code: "", stand_value: 1, divide_value: 1, row_order: 0, width_length_height: "", weight: "" });
const isSavingUnitUse = ref(false);

// ส่วนที่ 4 — รูปภาพ
const images = ref([]);
const isLoadingImages = ref(false);
const isSavingImage = ref(false);
const dragFromIndex = ref(-1);
const imageFileInput = ref(null);
const videoFileInput = ref(null);
const isUploadingVideo = ref(false);

// ส่วนที่ 4.1 — สินค้าทดแทน / สินค้าแนะนำ
const replacementItems = ref([]);
const suggestItems = ref([]);
const isLoadingRelated = ref(false);
const showRelatedDialog = ref(false);
const relatedMode = ref("create");
const relatedKind = ref("replacement");
const relatedForm = ref({ kind: "replacement", ic_code: itemCode, item_code: "", original_item_code: "", line_number: 0, status: 1 });
const isSavingRelated = ref(false);
const relatedProductOptions = ref([]);
const isLoadingRelatedProducts = ref(false);

// confirm dialog
const showConfirmDialog = ref(false);
const confirmMessage = ref("");
const confirmAction = ref(null);
const isDeleting = ref(false);
const isMobile = ref(false);

const MOBILE_BREAKPOINT = 768;
let mobileMediaQuery = null;

const productNameModeOptions = [
  { value: "", label: "ใช้ค่าระบบ" },
  { value: "name_1", label: "ชื่อสินค้า 1" },
  { value: "name_2", label: "ชื่อสินค้า 2" },
  { value: "name_eng_1", label: "ชื่ออังกฤษ 1" },
  { value: "name_eng_2", label: "ชื่ออังกฤษ 2" },
];
const salesDisplayModeOptions = [
  { value: 0, label: "แสดงยอดขาย" },
  { value: 1, label: "ไม่แสดงยอดขาย" },
  { value: 2, label: "แสดงเป็นระดับความนิยม" },
];
const productSalesDisplayModeOptions = [{ value: "", label: "ใช้ค่าระบบ" }, ...salesDisplayModeOptions.map((item) => ({ ...item, value: String(item.value) }))];
const preorderModeOptions = [
  { value: "default", label: "ตามค่าเริ่มต้นของระบบ" },
  { value: "1", label: "อนุญาต Preorder" },
  { value: "0", label: "ไม่อนุญาต Preorder" },
];
const preorderEffectiveStatusText = computed(() => {
  const mode = String(form.value.dimension_35 ?? "default");
  if (mode === "1") return "ผลลัพธ์: สินค้านี้เปิด Preorder";
  if (mode === "0") return "ผลลัพธ์: สินค้านี้ปิด Preorder";
  if (preorderDefaultEnabled.value === null) return "ผลลัพธ์: ใช้ค่าเริ่มต้นของระบบ";
  return Number(preorderDefaultEnabled.value) === 1
    ? "ผลลัพธ์: เปิด Preorder ตามค่าเริ่มต้นของระบบ"
    : "ผลลัพธ์: ปิด Preorder ตามค่าเริ่มต้นของระบบ";
});
function parseSalesStarThresholds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));
}

const salesStarThresholdError = computed(() => {
  if (!String(form.value.dimension_33 || "").trim()) return "";
  const values = parseSalesStarThresholds(form.value.dimension_33);
  if (values.length !== 4) return "กรุณาระบุช่วงดาว 4 ค่า เช่น 100,500,1000,5000";
  if (values.some((item) => !Number.isFinite(item) || item <= 0)) return "ช่วงดาวต้องเป็นตัวเลขมากกว่า 0";
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) return "ช่วงดาวต้องเรียงจากน้อยไปมาก";
  }
  return "";
});
const canSaveMain = computed(() => !isSavingMain.value && !salesStarThresholdError.value);
function extractHtmlAttribute(html, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(html || "").match(pattern);
  return match ? String(match[1] || match[2] || match[3] || "").trim() : "";
}

function toPositiveMediaSize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 && size <= 10000 ? Math.trunc(size) : 0;
}

function normalizeYoutubeEmbedUrl(value) {
  const text = String(value || "").trim().replace(/&amp;/g, "&");
  if (!text) return "";
  try {
    const url = new URL(text, window.location.origin);
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
    return `https://${embedHost}/embed/${videoId}`;
  } catch (error) {
    return "";
  }
}

function isAllowedProductVideoSource(value) {
  const source = String(value || "").trim();
  return source.startsWith("/media/") || /^https?:\/\//i.test(source);
}

function isVideoFileUrl(value) {
  return /\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(String(value || "").trim());
}

function parseProductVideoPreview(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
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
      return null;
    }
  } else if (/<iframe\b/i.test(raw)) {
    source = extractHtmlAttribute(raw, "src").replace(/&amp;/g, "&");
    width = toPositiveMediaSize(extractHtmlAttribute(raw, "width"));
    height = toPositiveMediaSize(extractHtmlAttribute(raw, "height"));
    forceIframe = true;
  }
  if (!isAllowedProductVideoSource(source)) return null;
  const youtubeEmbedUrl = normalizeYoutubeEmbedUrl(source);
  const resolvedSource = youtubeEmbedUrl || source;
  return {
    type: forceIframe || youtubeEmbedUrl || !isVideoFileUrl(resolvedSource) ? "iframe" : "video",
    src: resolvedSource,
    ratio: width > 0 && height > 0 ? `${width} / ${height}` : "16 / 9",
  };
}

const productVideoPreview = computed(() => parseProductVideoPreview(form.value.dimension_36));
function parseHiddenOnlineUnits(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHiddenOnlineUnits(value) {
  const items = Array.isArray(value) ? value : parseHiddenOnlineUnits(value);
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const code = String(item || "").trim().replace(/,/g, "").slice(0, 40);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result.join(",").slice(0, 255);
}

const hiddenOnlineUnitSet = computed(() => new Set(parseHiddenOnlineUnits(form.value.dimension_37)));
const onlineVisibleUnitCount = computed(() => unitUseList.value.filter((unit) => !hiddenOnlineUnitSet.value.has(String(unit.code || "").trim())).length);

function isUnitHiddenOnline(unitCode) {
  return hiddenOnlineUnitSet.value.has(String(unitCode || "").trim());
}

function setUnitOnlineVisible(unitCode, visible) {
  const code = String(unitCode || "").trim();
  if (!code) return;
  const next = new Set(hiddenOnlineUnitSet.value);
  if (visible) {
    next.delete(code);
  } else {
    if (onlineVisibleUnitCount.value <= 1 && !next.has(code)) {
      toast.add({ severity: "warn", summary: "ต้องมีหน่วยออนไลน์อย่างน้อย 1 หน่วย", life: 2500 });
      return;
    }
    next.add(code);
  }
  form.value.dimension_37 = normalizeHiddenOnlineUnits([...next]);
}

// Maximum Allowance ต่อหน่วย เก็บใน dimension_38 รูปแบบ CSV "UNIT:QTY" (REQ3)
function parseMaxAllowance(value) {
  const result = {};
  for (const token of String(value || "").split(",").map((t) => t.trim()).filter(Boolean)) {
    const idx = token.lastIndexOf(":");
    if (idx <= 0) continue;
    const unit = token.slice(0, idx).trim();
    const qty = Math.trunc(Number(token.slice(idx + 1).trim()));
    if (!unit || !Number.isFinite(qty) || qty <= 0) continue;
    if (Object.prototype.hasOwnProperty.call(result, unit)) continue;
    result[unit] = qty;
  }
  return result;
}

function normalizeMaxAllowance(map) {
  const parts = [];
  const seen = new Set();
  for (const [rawUnit, rawQty] of Object.entries(map || {})) {
    const unit = String(rawUnit || "").trim().replace(/[,:]/g, "").slice(0, 40).trim();
    const qty = Math.trunc(Number(rawQty));
    if (!unit || seen.has(unit) || !Number.isFinite(qty) || qty <= 0) continue;
    seen.add(unit);
    parts.push(`${unit}:${qty}`);
  }
  return parts.join(",").slice(0, 255);
}

const maxAllowanceMap = computed(() => parseMaxAllowance(form.value.dimension_38));

function getMaxAllowance(unitCode) {
  const qty = maxAllowanceMap.value[String(unitCode || "").trim()];
  return Number.isFinite(qty) && qty > 0 ? qty : null;
}

function setMaxAllowance(unitCode, qty) {
  const code = String(unitCode || "").trim();
  if (!code) return;
  const next = { ...maxAllowanceMap.value };
  const value = Math.trunc(Number(qty));
  if (!Number.isFinite(value) || value <= 0) {
    delete next[code]; // 0/ว่าง = ไม่จำกัด
  } else {
    next[code] = value;
  }
  form.value.dimension_38 = normalizeMaxAllowance(next);
}

function getMainSavePayload() {
  const payloadWarehouseShelves = warehouseShelfPayload(warehouseShelves.value);
  if (!payloadWarehouseShelves.length && form.value.start_sale_wh && form.value.start_sale_shelf) {
    payloadWarehouseShelves.push({
      wh_code: form.value.start_sale_wh,
      shelf_code: form.value.start_sale_shelf,
      shelf_list: "",
      min_point: 0,
      max_point: 0,
      status: 1,
    });
  }
  return {
    ...form.value,
    warehouse_shelves: payloadWarehouseShelves,
    dimension_33: String(form.value.dimension_33 || "").trim() ? parseSalesStarThresholds(form.value.dimension_33).join(",") : "",
    dimension_37: normalizeHiddenOnlineUnits(form.value.dimension_37),
    dimension_38: normalizeMaxAllowance(parseMaxAllowance(form.value.dimension_38)),
    // สวิตช์โปรโมชั่นเก็บเป็นสตริง "1"/"0" ตามที่ ERP ใช้
    dimension_41: form.value.dimension_41 ? "1" : "0",
  };
}

const hiddenDetailOptions = [
  { key: "brand", label: "ยี่ห้อ" },
  { key: "model", label: "รุ่น" },
  { key: "category", label: "หมวด" },
  { key: "width_length_height", label: "ขนาด" },
  { key: "weight", label: "น้ำหนัก" },
  { key: "stock", label: "สต๊อก" },
  { key: "sales", label: "ยอดขาย" },
];

const unitUseRatio = computed(() => {
  const s = Number(unitUseForm.value.stand_value) || 0;
  const d = Number(unitUseForm.value.divide_value) || 0;
  if (d === 0) return 0;
  return Math.round((s / d) * 1000000) / 1000000;
});

const barcodeUnitOptions = computed(() => unitUseList.value.map((u) => ({ value: u.code, label: u.unit_name || u.code })));

// หน่วยเริ่มต้นซื้อ/ขายต้องเป็นหน่วยที่สินค้าตัวนี้ใช้จริง (ic_unit_use) ไม่ใช่หน่วยทั้ง master
const productUnitOptions = computed(() => unitUseList.value.map((u) => ({ value: u.code, label: `${u.code} - ${u.unit_name || u.code}` })));

// ค่าที่บันทึกไว้เดิมแต่ถูกถอดออกจาก ic_unit_use แล้ว — ยังต้องโชว์ใน dropdown ไม่งั้นช่องว่างเงียบ
// และผู้ใช้ไม่รู้ว่าค่าเก่าค้างเป็นหน่วยอะไร (เลือกหน่วยอื่นทับหรือกด clear เพื่อล้างได้)
function unitOptionsWithCurrent(current) {
  const code = String(current || "").trim();
  if (!code || productUnitOptions.value.some((o) => o.value === code)) return productUnitOptions.value;
  return [...productUnitOptions.value, { value: code, label: `${code} (ไม่อยู่ในหน่วยที่สินค้าใช้)` }];
}
const startPurchaseUnitOptions = computed(() => unitOptionsWithCurrent(form.value.start_purchase_unit));
const startSaleUnitOptions = computed(() => unitOptionsWithCurrent(form.value.start_sale_unit));
const standardUnitUse = computed(() => unitUseList.value.find((u) => u.code === form.value.unit_standard) || null);
const purchaseShelfOptions = computed(() => filterShelfOptions(form.value.start_purchase_wh));
const saleShelfOptions = computed(() => filterShelfOptions(form.value.start_sale_wh));

watch(barcodeSearch, () => {
  barcodePage.value = 1;
});

watch(
  () => form.value.unit_standard,
  (unitCode) => {
    const match = unitUseList.value.find((u) => u.code === unitCode);
    if (!match) return;
    form.value.width_length_height = match.width_length_height || "";
    form.value.weight = match.weight || "";
  },
);

watch(
  () => form.value.start_purchase_wh,
  (whCode) => {
    if (!form.value.start_purchase_shelf) return;
    if (!shelfOptions.value.length) return;
    const exists = filterShelfOptions(whCode).some((item) => item.value === form.value.start_purchase_shelf);
    if (!exists) form.value.start_purchase_shelf = "";
  },
);

watch(
  () => form.value.start_sale_wh,
  (whCode) => {
    if (!form.value.start_sale_shelf) return;
    if (!shelfOptions.value.length) return;
    const exists = filterShelfOptions(whCode).some((item) => item.value === form.value.start_sale_shelf);
    if (!exists) form.value.start_sale_shelf = "";
  },
);

function mapMasterOptions(items = []) {
  return items.map((item) => ({
    value: item.code,
    label: `${item.code} - ${item.name_1 || item.name_2 || ""}`.trim(),
  }));
}

function mapWarehouseOptions(items = []) {
  return items.map((item) => ({
    value: item.code,
    label: `${item.code} - ${item.name_1 || item.name_2 || ""}`.trim(),
  }));
}

function mapShelfOptions(items = []) {
  return items.map((item) => ({
    value: item.code,
    whcode: item.whcode || item.wh_code || "",
    label: `${item.code} - ${item.name_1 || item.name_2 || ""}${item.whcode ? ` (${item.whcode})` : ""}`.trim(),
  }));
}

function filterShelfOptions(whCode) {
  if (!whCode) return shelfOptions.value;
  return shelfOptions.value.filter((item) => !item.whcode || item.whcode === whCode);
}

function warehouseShelfKey(row) {
  return `${String(row?.wh_code || row?.whcode || "").trim()}::${String(row?.shelf_code || row?.code || "").trim()}`;
}

function normalizeWarehouseShelfList(rows = []) {
  const unique = new Map();
  for (const row of rows || []) {
    const whCode = String(row?.wh_code || row?.whcode || "").trim();
    const shelfCode = String(row?.shelf_code || row?.code || "").trim();
    if (!whCode || !shelfCode) continue;
    const whOption = warehouseOptions.value.find((item) => item.value === whCode);
    const shelfOption = shelfOptions.value.find((item) => item.value === shelfCode && (!item.whcode || item.whcode === whCode));
    unique.set(`${whCode}::${shelfCode}`, {
      wh_code: whCode,
      wh_name: row?.wh_name || whOption?.label || "",
      shelf_code: shelfCode,
      shelf_name: row?.shelf_name || shelfOption?.label || "",
      shelf_list: row?.shelf_list || "",
      min_point: Number(row?.min_point || 0),
      max_point: Number(row?.max_point || 0),
      status: Number(row?.status ?? 1) === 0 ? 0 : 1,
    });
  }
  return Array.from(unique.values());
}

function warehouseShelfPayload(rows = []) {
  return normalizeWarehouseShelfList(rows).map((row) => ({
    wh_code: row.wh_code,
    shelf_code: row.shelf_code,
    shelf_list: row.shelf_list || "",
    min_point: Number(row.min_point || 0),
    max_point: Number(row.max_point || 0),
    status: Number(row.status ?? 1) === 0 ? 0 : 1,
  }));
}

function addMainWarehouseShelf() {
  if (!form.value.start_sale_wh || !form.value.start_sale_shelf) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกคลังเริ่มต้นขายและที่เก็บ", life: 2500 });
    return;
  }
  const row = {
    wh_code: form.value.start_sale_wh,
    shelf_code: form.value.start_sale_shelf,
    status: 1,
  };
  const key = warehouseShelfKey(row);
  if (warehouseShelves.value.some((item) => warehouseShelfKey(item) === key)) {
    toast.add({ severity: "info", summary: "มีคลัง/ที่เก็บนี้แล้ว", life: 2000 });
    return;
  }
  warehouseShelves.value = normalizeWarehouseShelfList([...warehouseShelves.value, row]);
}

function removeMainWarehouseShelf(row) {
  const key = warehouseShelfKey(row);
  warehouseShelves.value = warehouseShelves.value.filter((item) => warehouseShelfKey(item) !== key);
}

async function loadWarehouseShelfOptions() {
  try {
    const [warehouses, shelves] = await Promise.all([InventoryService.getWarehouseList(), InventoryService.getShelfList("")]);
    warehouseOptions.value = mapWarehouseOptions(warehouses || []);
    shelfOptions.value = mapShelfOptions(shelves || []);
  } catch (error) {
    toast.add({ severity: "warn", summary: "โหลดคลัง/ที่เก็บไม่สำเร็จ", detail: error.message, life: 3000 });
  }
}

async function reloadAll() {
  await Promise.all([loadMain(), loadBarcodes(), loadUnitUse(), loadImages(), loadRelatedItems(), loadFormulas(), loadSalePrices(), loadDiscountConditions()]);
}

async function loadMain() {
  isLoadingMain.value = true;
  try {
    const res = await getProductItemDetail(itemCode);
    if (res.success) {
      Object.assign(form.value, {
        ...res.data,
        dimension_33: res.data?.dimension_33 || "",
        dimension_34: String(res.data?.dimension_34 ?? ""),
        dimension_35: res.data?.dimension_35 || "default",
        dimension_37: res.data?.dimension_37 || "",
        dimension_38: res.data?.dimension_38 || "",
        dimension_39: res.data?.dimension_39 || "",
        // ค่าว่าง null "" 0 = ปิด — มีแต่ "1" เท่านั้นที่นับว่าเปิด
        dimension_41: String(res.data?.dimension_41 ?? "").trim() === "1",
        is_hold_sale: Number(res.data?.is_hold_sale || 0) === 1,
        is_hold_purchase: Number(res.data?.is_hold_purchase || 0) === 1,
        is_end: Number(res.data?.is_end || 0) === 1,
        is_premium: Number(res.data?.is_premium || 0) === 1,
      });
      warehouseShelves.value = normalizeWarehouseShelfList(res.data?.warehouse_shelves || []);
    }
    else toast.add({ severity: "error", summary: "โหลดข้อมูลไม่สำเร็จ", detail: res.message, life: 3000 });
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดข้อมูลไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingMain.value = false;
  }
}

async function loadBarcodes() {
  isLoadingBarcodes.value = true;
  try {
    const res = await getProductItemBarcodes(itemCode);
    if (res.success) barcodes.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดบาร์โค้ดไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingBarcodes.value = false;
  }
}

async function loadUnitUse() {
  isLoadingUnitUse.value = true;
  try {
    const res = await getProductItemUnitUse(itemCode);
    if (res.success) unitUseList.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดหน่วยนับไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingUnitUse.value = false;
  }
}

async function loadImages() {
  isLoadingImages.value = true;
  try {
    const res = await getProductImages(itemCode);
    if (res.success) images.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดรูปภาพไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingImages.value = false;
  }
}

async function saveMain() {
  if (salesStarThresholdError.value) {
    toast.add({ severity: "warn", summary: salesStarThresholdError.value, life: 2600 });
    return;
  }
  isSavingMain.value = true;
  try {
    const res = await updateProductItemMain(getMainSavePayload());
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      await reloadAll();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingMain.value = false;
  }
}

async function saveOnlineUnitVisibility() {
  if (!unitUseList.value.length) return;
  if (salesStarThresholdError.value) {
    toast.add({ severity: "warn", summary: salesStarThresholdError.value, life: 2600 });
    return;
  }
  isSavingOnlineUnits.value = true;
  try {
    const res = await updateProductItemMain(getMainSavePayload());
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกการแสดงหน่วยออนไลน์แล้ว", life: 2000 });
      await Promise.all([loadMain(), loadUnitUse()]);
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingOnlineUnits.value = false;
  }
}

// บาร์โค้ด
function openAddBarcode() {
  barcodeMode.value = "create";
  barcodeForm.value = { ic_code: itemCode, barcode: "", unit_code: "", price: 0, price_member: 0, price_2: 0, price_member_2: 0, price_member_3: 0, price_member_4: 0 };
  showBarcodeDialog.value = true;
}

async function loadSalesSettings() {
  try {
    const settings = await SalesSettingsService.getSettings();
    preorderDefaultEnabled.value = Number(settings?.preorder_default_enabled || 0);
  } catch (error) {
    preorderDefaultEnabled.value = null;
    console.warn("Unable to load preorder default setting", error);
  }
}

function openEditBarcode(row) {
  barcodeMode.value = "edit";
  barcodeForm.value = { ic_code: itemCode, ...row };
  showBarcodeDialog.value = true;
}

async function saveBarcode() {
  if (!barcodeForm.value.barcode.trim()) {
    toast.add({ severity: "warn", summary: "กรุณากรอกบาร์โค้ด", life: 2500 });
    return;
  }
  isSavingBarcode.value = true;
  try {
    const fn = barcodeMode.value === "create" ? createProductItemBarcode : updateProductItemBarcode;
    const res = await fn(barcodeForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      showBarcodeDialog.value = false;
      await reloadAll();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingBarcode.value = false;
  }
}

async function confirmDeleteBarcode(row) {
  try {
    const check = await checkBarcodeInUse(itemCode, row.barcode);
    if (check.in_use) {
      toast.add({ severity: "warn", summary: "ไม่สามารถลบได้", detail: `บาร์โค้ด "${row.barcode}" ถูกใช้งานในเอกสารแล้ว`, life: 4000 });
      return;
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "เกิดข้อผิดพลาด", detail: e.message, life: 3000 });
    return;
  }
  confirmMessage.value = `ต้องการลบบาร์โค้ด "${row.barcode}" ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductItemBarcode({ ic_code: itemCode, barcode: row.barcode });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await reloadAll();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

async function executeConfirm() {
  if (!confirmAction.value) return;
  isDeleting.value = true;
  try {
    await confirmAction.value();
  } catch (e) {
    toast.add({ severity: "error", summary: "เกิดข้อผิดพลาด", detail: e.message, life: 3000 });
  } finally {
    isDeleting.value = false;
    showConfirmDialog.value = false;
    confirmAction.value = null;
  }
}

// หน่วยนับ
function openAddUnitUse() {
  unitUseMode.value = "create";
  unitUseForm.value = { ic_code: itemCode, code: "", stand_value: 1, divide_value: 1, row_order: 0, width_length_height: "", weight: "" };
  showUnitUseDialog.value = true;
}

function openEditUnitUse(row) {
  unitUseMode.value = "edit";
  unitUseForm.value = { ic_code: itemCode, ...row };
  showUnitUseDialog.value = true;
}

async function saveUnitUse() {
  if (!unitUseForm.value.code) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกหน่วยนับ", life: 2500 });
    return;
  }
  isSavingUnitUse.value = true;
  try {
    const fn = unitUseMode.value === "create" ? createProductItemUnitUse : updateProductItemUnitUse;
    const res = await fn(unitUseForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      showUnitUseDialog.value = false;
      await reloadAll();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingUnitUse.value = false;
  }
}

async function confirmDeleteUnitUse(row) {
  try {
    const check = await checkUnitUseInUse(itemCode, row.code);
    if (check.in_use) {
      toast.add({ severity: "warn", summary: "ไม่สามารถลบได้", detail: `หน่วยนับ "${row.code}" ถูกใช้งานในเอกสารแล้ว`, life: 4000 });
      return;
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "เกิดข้อผิดพลาด", detail: e.message, life: 3000 });
    return;
  }
  confirmMessage.value = `ต้องการลบหน่วยนับ "${row.code} - ${row.unit_name}" ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductItemUnitUse({ ic_code: itemCode, code: row.code });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await loadUnitUse();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

// รูปภาพ
function onClickAddImage() {
  if (imageFileInput.value) imageFileInput.value.click();
}

function onImageFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";
  const reader = new FileReader();
  reader.onload = async (e) => {
    isSavingImage.value = true;
    try {
      const res = await saveProductImage(itemCode, e.target.result);
      if (res.success) {
        toast.add({ severity: "success", summary: "เพิ่มรูปภาพสำเร็จ", life: 2000 });
        await loadImages();
      } else {
        toast.add({ severity: "error", summary: "เพิ่มรูปภาพไม่สำเร็จ", detail: res.message, life: 3000 });
      }
    } catch (err) {
      toast.add({ severity: "error", summary: "เพิ่มรูปภาพไม่สำเร็จ", detail: err.message, life: 3000 });
    } finally {
      isSavingImage.value = false;
    }
  };
  reader.readAsDataURL(file);
}

function confirmDeleteImage(img) {
  confirmMessage.value = "ต้องการลบรูปภาพนี้ใช่หรือไม่?";
  confirmAction.value = async () => {
    const res = await deleteProductImage(img.guid_code);
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบรูปภาพสำเร็จ", life: 2000 });
      await loadImages();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

function onDragStart(index) {
  dragFromIndex.value = index;
}
function onDragOver(event, index) {
  event.preventDefault();
  if (dragFromIndex.value === -1 || dragFromIndex.value === index) return;
  const arr = [...images.value];
  const dragged = arr.splice(dragFromIndex.value, 1)[0];
  arr.splice(index, 0, dragged);
  images.value = arr;
  dragFromIndex.value = index;
}
function onDragEnd() {
  dragFromIndex.value = -1;
}

async function saveImageOrder() {
  try {
    const orders = images.value.map((img, idx) => ({ guid_code: img.guid_code, image_order: idx + 1 }));
    const res = await reorderProductImages(itemCode, orders);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกลำดับสำเร็จ", life: 2000 });
      await loadImages();
    } else {
      toast.add({ severity: "error", summary: "บันทึกลำดับไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกลำดับไม่สำเร็จ", detail: e.message, life: 3000 });
  }
}

const RELATED_KIND_META = {
  replacement: {
    title: "สินค้าทดแทน",
    addLabel: "เพิ่มสินค้าทดแทน",
    empty: "ยังไม่มีสินค้าทดแทน",
  },
  suggest: {
    title: "สินค้าแนะนำ",
    addLabel: "เพิ่มสินค้าแนะนำ",
    empty: "ยังไม่มีสินค้าแนะนำ",
  },
};

function relatedMeta(kind) {
  return RELATED_KIND_META[kind] || RELATED_KIND_META.replacement;
}

function rowProductCode(row = {}) {
  return row.ic_code || row.item_code || row.code || "-";
}

function rowUnitCode(row = {}) {
  return row.unit_code || row.code || "-";
}

function relatedActionLabel(action, kind, row) {
  return `${action}${relatedMeta(kind).title} ${rowProductCode(row)}`;
}

function formulaActionLabel(action, row = {}) {
  return `${action}สูตรราคา ${rowUnitCode(row)} ${saleTypeLabel(row.sale_type)} ${taxTypeLabel(row.tax_type)}`;
}

function salePriceActionLabel(action, row = {}) {
  return `${action}ราคาขาย ${rowUnitCode(row)} ${priceModeLabel(row.price_mode)} ${dateRangeText(row)}`;
}

function discountActionLabel(action, row = {}) {
  return `${action}ส่วนลด ${rowUnitCode(row)} ${dateRangeText(row)}`;
}

function unitUseActionLabel(action, row = {}) {
  return `${action}หน่วยนับ ${row.code || "-"}`;
}

function barcodeActionLabel(action, row = {}) {
  return `${action}บาร์โค้ด ${row.barcode || "-"}`;
}

function normalizeProductOption(product = {}) {
  const code = product.code || product.item_code || "";
  const name = product.name_1 || product.item_name || product.name || "";
  return {
    ...product,
    code,
    name,
    label: `${code}${name ? ` - ${name}` : ""}`,
  };
}

function mergeRelatedProductOptions(products = []) {
  const byCode = new Map(relatedProductOptions.value.map((item) => [item.code, item]));
  products.map(normalizeProductOption).filter((item) => item.code && item.code !== itemCode).forEach((item) => byCode.set(item.code, item));
  relatedProductOptions.value = Array.from(byCode.values());
}

async function loadRelatedProductOptions(search = "") {
  isLoadingRelatedProducts.value = true;
  try {
    const res = await getProductManageList({
      search: String(search || "").trim(),
      offset: 0,
      limit: 50,
    });
    mergeRelatedProductOptions(res.data || []);
  } catch (error) {
    toast.add({ severity: "error", summary: "โหลดรายการสินค้าไม่สำเร็จ", detail: error.message, life: 3000 });
  } finally {
    isLoadingRelatedProducts.value = false;
  }
}

function filterRelatedProducts(event) {
  loadRelatedProductOptions(event?.value || "");
}

async function ensureRelatedProductOption(code) {
  const productCode = String(code || "").trim();
  if (!productCode || productCode === itemCode || relatedProductOptions.value.some((item) => item.code === productCode)) return;
  try {
    const res = await getProductManageList({ search: productCode, offset: 0, limit: 10 });
    mergeRelatedProductOptions(res.data || [{ code: productCode, name_1: "" }]);
  } catch {
    mergeRelatedProductOptions([{ code: productCode, name_1: "" }]);
  }
}

async function loadRelatedItems() {
  isLoadingRelated.value = true;
  try {
    const [replacementRes, suggestRes] = await Promise.all([getProductRelatedItems(itemCode, "replacement"), getProductRelatedItems(itemCode, "suggest")]);
    if (replacementRes.success) replacementItems.value = replacementRes.data || [];
    if (suggestRes.success) suggestItems.value = suggestRes.data || [];
    mergeRelatedProductOptions([...(replacementRes.data || []), ...(suggestRes.data || [])]);
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดสินค้าแนะนำ/ทดแทนไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingRelated.value = false;
  }
}

function openAddRelated(kind) {
  relatedMode.value = "create";
  relatedKind.value = kind;
  relatedForm.value = { kind, ic_code: itemCode, item_code: "", original_item_code: "", line_number: (kind === "replacement" ? replacementItems.value.length : suggestItems.value.length) + 1, status: 1 };
  showRelatedDialog.value = true;
}

function openEditRelated(kind, row) {
  relatedMode.value = "edit";
  relatedKind.value = kind;
  relatedForm.value = {
    kind,
    ic_code: itemCode,
    item_code: row.ic_code || row.item_code,
    original_item_code: row.ic_code || row.item_code,
    line_number: Number(row.line_number) || 0,
    status: Number(row.status) === 0 ? 0 : 1,
  };
  ensureRelatedProductOption(relatedForm.value.item_code);
  showRelatedDialog.value = true;
}

async function saveRelated() {
  const selectedCode = String(relatedForm.value.item_code || "").trim();
  if (!selectedCode) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกสินค้า", life: 2500 });
    return;
  }
  if (selectedCode === itemCode) {
    toast.add({ severity: "warn", summary: "ไม่สามารถเลือกสินค้าตัวเองได้", life: 2500 });
    return;
  }
  isSavingRelated.value = true;
  try {
    const res = await saveProductRelatedItem(relatedForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      showRelatedDialog.value = false;
      await loadRelatedItems();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.response?.data?.message || e.message, life: 3500 });
  } finally {
    isSavingRelated.value = false;
  }
}

function confirmDeleteRelated(kind, row) {
  const code = row.ic_code || row.item_code;
  confirmMessage.value = `ต้องการลบ${relatedMeta(kind).title} "${code} - ${row.item_name || ""}" ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductRelatedItem({ kind, ic_code: itemCode, item_code: code });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await loadRelatedItems();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

// ส่วนที่ 5 — สูตรราคาขาย
const priceFormulas = ref([]);
const isLoadingFormulas = ref(false);
const showFormulaDialog = ref(false);
const formulaMode = ref("create");
const isSavingFormula = ref(false);

const EMPTY_FORMULA = () => ({
  ic_code: itemCode,
  unit_code: "",
  sale_type: 0,
  tax_type: 0,
  price_0: "",
  price_1: "",
  price_2: "",
  price_3: "",
  price_4: "",
  price_5: "",
  price_6: "",
  price_7: "",
  price_8: "",
  price_9: "",
});
const formulaForm = ref(EMPTY_FORMULA());

const SALE_TYPE_OPTIONS = [
  { value: 0, label: "ไม่เลือก" },
  { value: 1, label: "ขายสด" },
  { value: 2, label: "ขายเชื่อ" },
];
const TAX_TYPE_OPTIONS = [
  { value: 0, label: "ไม่เลือก" },
  { value: 1, label: "แยกนอก" },
  { value: 2, label: "รวมใน" },
  { value: 3, label: "ภาษีศูนย์" },
];

function saleTypeLabel(v) {
  return SALE_TYPE_OPTIONS.find((o) => o.value === Number(v))?.label ?? v;
}
function taxTypeLabel(v) {
  return TAX_TYPE_OPTIONS.find((o) => o.value === Number(v))?.label ?? v;
}

async function loadFormulas() {
  isLoadingFormulas.value = true;
  try {
    const res = await getProductPriceFormulas(itemCode);
    if (res.success) priceFormulas.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดสูตรราคาไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingFormulas.value = false;
  }
}

function openAddFormula() {
  formulaMode.value = "create";
  formulaForm.value = EMPTY_FORMULA();
  showFormulaDialog.value = true;
}

function openEditFormula(row) {
  formulaMode.value = "edit";
  formulaForm.value = {
    ic_code: itemCode,
    unit_code: row.unit_code,
    sale_type: Number(row.sale_type),
    tax_type: Number(row.tax_type),
    price_0: row.price_0,
    price_1: row.price_1,
    price_2: row.price_2,
    price_3: row.price_3,
    price_4: row.price_4,
    price_5: row.price_5,
    price_6: row.price_6,
    price_7: row.price_7,
    price_8: row.price_8,
    price_9: row.price_9,
  };
  showFormulaDialog.value = true;
}

async function saveFormula() {
  if (!formulaForm.value.unit_code) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกหน่วยนับ", life: 2500 });
    return;
  }
  isSavingFormula.value = true;
  try {
    const res = await saveProductPriceFormula(formulaForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกสำเร็จ", life: 2000 });
      showFormulaDialog.value = false;
      await loadFormulas();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isSavingFormula.value = false;
  }
}

function confirmDeleteFormula(row) {
  confirmMessage.value = `ต้องการลบสูตรราคา [${row.unit_code} / ${saleTypeLabel(row.sale_type)} / ${taxTypeLabel(row.tax_type)}] ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductPriceFormula({
      ic_code: itemCode,
      unit_code: row.unit_code,
      sale_type: row.sale_type,
      tax_type: row.tax_type,
    });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await loadFormulas();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

// ส่วนที่ 6 — ราคาขาย/โปรโมชั่น และส่วนลด
const salePrices = ref([]);
const discountConditions = ref([]);
const isLoadingSalePrices = ref(false);
const isLoadingDiscountConditions = ref(false);
const showSalePriceDialog = ref(false);
const showDiscountDialog = ref(false);
const salePriceMode = ref("create");
const discountMode = ref("create");
const isSavingSalePrice = ref(false);
const isSavingDiscount = ref(false);

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

const PRICE_TYPE_OPTIONS = [
  { value: 1, label: "ราคาทั่วไป" },
  { value: 2, label: "ราคาตามกลุ่มลูกค้า" },
  { value: 3, label: "ราคาตามลูกค้า" },
];

const PRICE_MODE_OPTIONS = [
  { value: 0, label: "ราคามาตรฐาน" },
  { value: 1, label: "โปรโมชั่น" },
];

const DISCOUNT_TYPE_OPTIONS = [
  { value: 0, label: "ส่วนลดทั่วไป" },
  { value: 1, label: "ส่วนลดตามกลุ่มลูกค้า" },
  { value: 2, label: "ส่วนลดตามลูกค้า" },
];

const EMPTY_SALE_PRICE = () => ({
  ic_code: itemCode,
  roworder: "",
  unit_code: "",
  price_type: 1,
  price_mode: 1,
  sale_type: 0,
  from_date: todayText(),
  to_date: "2099-12-31",
  from_qty: 1,
  to_qty: 999999,
  sale_price1: 0,
  sale_price2: 0,
  cust_code: "",
  cust_group_1: "",
  cust_group_2: "",
  transport_type: 0,
  currency_code: "",
  price_currency: 0,
});

const EMPTY_DISCOUNT = () => ({
  ic_code: itemCode,
  roworder: "",
  unit_code: "",
  discount_type: 0,
  sale_type: 0,
  from_date: todayText(),
  to_date: "2099-12-31",
  from_qty: 1,
  to_qty: 999999,
  discount: "",
  cust_code: "",
  cust_group_1: "",
  cust_group_2: "",
});

const salePriceForm = ref(EMPTY_SALE_PRICE());
const discountForm = ref(EMPTY_DISCOUNT());
const activeSalePriceType = ref(1);
const activeDiscountType = ref(0);

const isGeneralSalePrice = computed(() => Number(salePriceForm.value.price_type) === 1);
const isGroupSalePrice = computed(() => Number(salePriceForm.value.price_type) === 2);
const isCustomerSalePrice = computed(() => Number(salePriceForm.value.price_type) === 3);
const isGeneralDiscount = computed(() => Number(discountForm.value.discount_type) === 0);
const isGroupDiscount = computed(() => Number(discountForm.value.discount_type) === 1);
const isCustomerDiscount = computed(() => Number(discountForm.value.discount_type) === 2);

function normalizeCustomerOption(customer = {}) {
  const code = customer.code || customer.user_code || customer.cust_code || "";
  const name = customer.name || customer.user_name || customer.name_1 || "";
  return { ...customer, code, name, label: `${code}${name ? ` - ${name}` : ""}` };
}

function mergeCustomerOptions(options = []) {
  const byCode = new Map(customerOptions.value.map((item) => [item.code, item]));
  options.map(normalizeCustomerOption).filter((item) => item.code).forEach((item) => byCode.set(item.code, item));
  customerOptions.value = Array.from(byCode.values());
}

async function loadCustomerOptions(search = "") {
  isLoadingCustomers.value = true;
  try {
    const data = await CustomerService.getCustomers(search, 50);
    mergeCustomerOptions(data || []);
  } catch (error) {
    toast.add({ severity: "error", summary: "โหลดลูกค้าไม่สำเร็จ", detail: error.message, life: 3000 });
  } finally {
    isLoadingCustomers.value = false;
  }
}

function filterCustomerOptions(event) {
  loadCustomerOptions(event?.value || "");
}

async function ensureCustomerOption(code) {
  const customerCode = String(code || "").trim();
  if (!customerCode || customerOptions.value.some((item) => item.code === customerCode)) return;
  try {
    const data = await CustomerService.getCustomers(customerCode, 10);
    mergeCustomerOptions(data || [{ code: customerCode, name: "" }]);
  } catch {
    mergeCustomerOptions([{ code: customerCode, name: "" }]);
  }
}

function cleanSalePriceScope() {
  const type = Number(salePriceForm.value.price_type);
  if (type === 1) {
    salePriceForm.value.cust_code = "";
    salePriceForm.value.cust_group_1 = "";
    salePriceForm.value.cust_group_2 = "";
  } else if (type === 2) {
    salePriceForm.value.cust_code = "";
  } else if (type === 3) {
    salePriceForm.value.cust_group_1 = "";
    salePriceForm.value.cust_group_2 = "";
  }
}

function cleanDiscountScope() {
  const type = Number(discountForm.value.discount_type);
  if (type === 0) {
    discountForm.value.cust_code = "";
    discountForm.value.cust_group_1 = "";
    discountForm.value.cust_group_2 = "";
  } else if (type === 1) {
    discountForm.value.cust_code = "";
  } else if (type === 2) {
    discountForm.value.cust_group_1 = "";
    discountForm.value.cust_group_2 = "";
  }
}

watch(() => salePriceForm.value.price_type, cleanSalePriceScope);
watch(() => discountForm.value.discount_type, cleanDiscountScope);

function priceTypeLabel(v) {
  return PRICE_TYPE_OPTIONS.find((o) => o.value === Number(v))?.label ?? v;
}

function priceModeLabel(v) {
  return PRICE_MODE_OPTIONS.find((o) => o.value === Number(v))?.label ?? v;
}

function discountTypeLabel(v) {
  return DISCOUNT_TYPE_OPTIONS.find((o) => o.value === Number(v))?.label ?? v;
}

const salePriceTabs = computed(() =>
  PRICE_TYPE_OPTIONS.map((option) => ({
    ...option,
    count: salePrices.value.filter((row) => Number(row.price_type) === option.value).length,
  })),
);

const discountTabs = computed(() =>
  DISCOUNT_TYPE_OPTIONS.map((option) => ({
    ...option,
    count: discountConditions.value.filter((row) => Number(row.discount_type) === option.value).length,
  })),
);

const activeSalePriceRows = computed(() => salePrices.value.filter((row) => Number(row.price_type) === Number(activeSalePriceType.value)));
const activeDiscountRows = computed(() => discountConditions.value.filter((row) => Number(row.discount_type) === Number(activeDiscountType.value)));

function conditionScopeText(row) {
  if (String(row.cust_code || "").trim()) return `ลูกค้า: ${row.cust_code}`;
  const groups = [row.cust_group_1, row.cust_group_2].filter((v) => String(v || "").trim());
  if (groups.length) return `กลุ่ม: ${groups.join(" / ")}`;
  return "ทั่วไป";
}

function dateRangeText(row) {
  return `${row.from_date || "-"} ถึง ${row.to_date || "-"}`;
}

function qtyRangeText(row) {
  return `${formatNum(row.from_qty)} - ${formatNum(row.to_qty)}`;
}

async function loadSalePrices() {
  isLoadingSalePrices.value = true;
  try {
    const res = await getProductSalePrices(itemCode);
    if (res.success) salePrices.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดราคาขายไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingSalePrices.value = false;
  }
}

async function loadDiscountConditions() {
  isLoadingDiscountConditions.value = true;
  try {
    const res = await getProductDiscountConditions(itemCode);
    if (res.success) discountConditions.value = res.data || [];
  } catch (e) {
    toast.add({ severity: "error", summary: "โหลดเงื่อนไขส่วนลดไม่สำเร็จ", detail: e.message, life: 3000 });
  } finally {
    isLoadingDiscountConditions.value = false;
  }
}

function openAddSalePrice() {
  salePriceMode.value = "create";
  salePriceForm.value = EMPTY_SALE_PRICE();
  showSalePriceDialog.value = true;
}

function openEditSalePrice(row) {
  salePriceMode.value = "edit";
  salePriceForm.value = { ...EMPTY_SALE_PRICE(), ...row, ic_code: itemCode };
  ensureCustomerOption(salePriceForm.value.cust_code);
  showSalePriceDialog.value = true;
}

async function saveSalePrice() {
  if (!salePriceForm.value.unit_code) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกหน่วยนับ", life: 2500 });
    return;
  }
  cleanSalePriceScope();
  if (isGroupSalePrice.value && !String(salePriceForm.value.cust_group_1 || "").trim()) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกกลุ่มลูกค้า 1", life: 2500 });
    return;
  }
  if (isCustomerSalePrice.value && !String(salePriceForm.value.cust_code || "").trim()) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกรหัสลูกค้า", life: 2500 });
    return;
  }
  isSavingSalePrice.value = true;
  try {
    const res = await saveProductSalePrice(salePriceForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกราคาขายสำเร็จ", life: 2000 });
      showSalePriceDialog.value = false;
      await loadSalePrices();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.response?.data?.message || e.message, life: 3500 });
  } finally {
    isSavingSalePrice.value = false;
  }
}

function confirmDeleteSalePrice(row) {
  confirmMessage.value = `ต้องการลบราคาขาย [${row.unit_code} / ${priceTypeLabel(row.price_type)} / ${dateRangeText(row)}] ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductSalePrice({ ic_code: itemCode, roworder: row.roworder });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await loadSalePrices();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

function openAddDiscount() {
  discountMode.value = "create";
  discountForm.value = EMPTY_DISCOUNT();
  showDiscountDialog.value = true;
}

function openEditDiscount(row) {
  discountMode.value = "edit";
  discountForm.value = { ...EMPTY_DISCOUNT(), ...row, ic_code: itemCode };
  ensureCustomerOption(discountForm.value.cust_code);
  showDiscountDialog.value = true;
}

async function saveDiscount() {
  if (!discountForm.value.unit_code) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกหน่วยนับ", life: 2500 });
    return;
  }
  if (!String(discountForm.value.discount || "").trim()) {
    toast.add({ severity: "warn", summary: "กรุณาระบุส่วนลด", life: 2500 });
    return;
  }
  cleanDiscountScope();
  if (isGroupDiscount.value && !String(discountForm.value.cust_group_1 || "").trim()) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกกลุ่มลูกค้า 1", life: 2500 });
    return;
  }
  if (isCustomerDiscount.value && !String(discountForm.value.cust_code || "").trim()) {
    toast.add({ severity: "warn", summary: "กรุณาเลือกรหัสลูกค้า", life: 2500 });
    return;
  }
  isSavingDiscount.value = true;
  try {
    const res = await saveProductDiscountCondition(discountForm.value);
    if (res.success) {
      toast.add({ severity: "success", summary: "บันทึกส่วนลดสำเร็จ", life: 2000 });
      showDiscountDialog.value = false;
      await loadDiscountConditions();
    } else {
      toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  } catch (e) {
    toast.add({ severity: "error", summary: "บันทึกไม่สำเร็จ", detail: e.response?.data?.message || e.message, life: 3500 });
  } finally {
    isSavingDiscount.value = false;
  }
}

function confirmDeleteDiscount(row) {
  confirmMessage.value = `ต้องการลบส่วนลด [${row.unit_code} / ${discountTypeLabel(row.discount_type)} / ${row.discount}] ใช่หรือไม่?`;
  confirmAction.value = async () => {
    const res = await deleteProductDiscountCondition({ ic_code: itemCode, roworder: row.roworder });
    if (res.success) {
      toast.add({ severity: "success", summary: "ลบสำเร็จ", life: 2000 });
      await loadDiscountConditions();
    } else {
      toast.add({ severity: "error", summary: "ลบไม่สำเร็จ", detail: res.message, life: 3000 });
    }
  };
  showConfirmDialog.value = true;
}

function formatNum(v) {
  const n = Number(v) || 0;
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getHiddenDetailKeys() {
  return String(form.value.dimension_31 || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isDetailHidden(key) {
  return getHiddenDetailKeys().includes(key);
}

function setDetailHidden(key, checked) {
  const keys = new Set(getHiddenDetailKeys());
  if (checked) keys.add(key);
  else keys.delete(key);
  form.value.dimension_31 = hiddenDetailOptions
    .map((item) => item.key)
    .filter((item) => keys.has(item))
    .join(",");
}

function onClickUploadVideo() {
  if (videoFileInput.value) videoFileInput.value.click();
}

async function onVideoFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = "";
  isUploadingVideo.value = true;
  try {
    const asset = await MediaService.uploadMedia(file);
    form.value.dimension_36 = MediaService.getPreferredUrl(asset);
    toast.add({ severity: "success", summary: "อัปโหลดวิดีโอสำเร็จ", life: 2000 });
  } catch (err) {
    toast.add({ severity: "error", summary: "อัปโหลดวิดีโอไม่สำเร็จ", detail: err.message, life: 3000 });
  } finally {
    isUploadingVideo.value = false;
  }
}

function syncMobileState(eventOrQuery) {
  if (typeof eventOrQuery?.matches === "boolean") {
    isMobile.value = eventOrQuery.matches;
    return;
  }
  if (typeof window !== "undefined") {
    isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT;
  }
}

function getFormulaPriceEntries(row) {
  return Array.from({ length: 10 }, (_, index) => ({
    label: `ราคา ${index}`,
    value: row[`price_${index}`],
  })).filter((entry) => String(entry.value ?? "").trim() !== "");
}

onMounted(async () => {
  if (typeof window !== "undefined") {
    mobileMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    syncMobileState(mobileMediaQuery);
    if (typeof mobileMediaQuery.addEventListener === "function") {
      mobileMediaQuery.addEventListener("change", syncMobileState);
    } else {
      mobileMediaQuery.addListener(syncMobileState);
    }
  }

  const [unitRes, catRes, brandRes, groupRes, groupSubRes, groupSub2Res, designRes, modelRes, patternRes, gradeRes, customerGroupRes, customerGroupSubRes] = await Promise.all([
    getUnitManageList(""),
    getProductCategoryList(""),
    getProductBrandList(""),
    getProductGroupList(""),
    getProductGroupSubList(""),
    getProductGroupSub2List(""),
    getProductDesignList(""),
    getProductModelList(""),
    getProductPatternList(""),
    getProductGradeList(""),
    getCustomerGroupList(""),
    getCustomerGroupSubList(""),
  ]);
  unitOptions.value = (unitRes.data || []).map((u) => ({ value: u.code, label: `${u.code} - ${u.name_1}` }));
  categoryOptions.value = mapMasterOptions(catRes.data || []);
  productBrandOptions.value = mapMasterOptions(brandRes.data || []);
  productGroupOptions.value = mapMasterOptions(groupRes.data || []);
  productGroupSubOptions.value = mapMasterOptions(groupSubRes.data || []);
  productGroupSub2Options.value = mapMasterOptions(groupSub2Res.data || []);
  productDesignOptions.value = mapMasterOptions(designRes.data || []);
  productModelOptions.value = mapMasterOptions(modelRes.data || []);
  productPatternOptions.value = mapMasterOptions(patternRes.data || []);
  productGradeOptions.value = mapMasterOptions(gradeRes.data || []);
  customerGroupOptions.value = mapMasterOptions(customerGroupRes.data || []);
  customerGroupSubOptions.value = mapMasterOptions(customerGroupSubRes.data || []);
  loadWarehouseShelfOptions();
  loadCustomerOptions("");
  loadRelatedProductOptions("");

  await Promise.all([loadMain(), loadBarcodes(), loadUnitUse(), loadImages(), loadRelatedItems(), loadFormulas(), loadSalePrices(), loadDiscountConditions(), loadSalesSettings()]);
});

onBeforeUnmount(() => {
  if (!mobileMediaQuery) return;
  if (typeof mobileMediaQuery.removeEventListener === "function") {
    mobileMediaQuery.removeEventListener("change", syncMobileState);
  } else {
    mobileMediaQuery.removeListener(syncMobileState);
  }
});
</script>

<template>
  <div class="edit-page">
    <!-- Header -->
    <div class="page-header">
      <Button icon="pi pi-arrow-left" text rounded severity="secondary" aria-label="กลับหน้ารายการสินค้า" @click="router.push({ name: 'admin-products' })" />
      <div class="page-header-meta">
        <h1 class="page-title">แก้ไขสินค้า</h1>
        <p class="page-subtitle">
          {{ form.code }}<span v-if="form.name_1"> — {{ form.name_1 }}</span>
        </p>
      </div>
    </div>

    <!-- ส่วนที่ 4: รูปภาพ -->
    <div class="section-card">
      <div class="section-header">
        <h2 class="section-title">รูปภาพสินค้า</h2>
        <div class="header-actions">
          <Button label="บันทึกลำดับ" icon="pi pi-sort" size="small" severity="secondary" outlined :disabled="images.length < 2" @click="saveImageOrder" />
          <Button label="เพิ่มรูปภาพ" icon="pi pi-plus" size="small" :loading="isSavingImage" @click="onClickAddImage" />
        </div>
      </div>
      <input ref="imageFileInput" type="file" accept="image/*" style="display: none" @change="onImageFileSelected" />
      <input ref="videoFileInput" type="file" accept="video/mp4,video/webm,video/ogg" style="display: none" @change="onVideoFileSelected" />

      <div v-if="isLoadingImages" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="images.length === 0" class="image-empty">
        <i class="pi pi-image image-empty-icon" />
        <p>ยังไม่มีรูปภาพ — กด "เพิ่มรูปภาพ" เพื่ออัพโหลด</p>
      </div>
      <div v-else class="image-grid">
        <div v-for="(img, idx) in images" :key="img.guid_code" class="image-card" draggable="true" @dragstart="onDragStart(idx)" @dragover="onDragOver($event, idx)" @dragend="onDragEnd">
          <img
            :src="getProductImageGuidUrl(img.guid_code)"
            class="image-thumb"
            loading="lazy"
            alt=""
            @error="
              (e) =>
                (e.target.src =
                  'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22 viewBox=%220 0 48 48%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23e5e7eb%22/%3E%3Cpath d=%22M12 34l8-10 6 7 4-5 6 8z%22 fill=%22%239ca3af%22/%3E%3C/svg%3E')
            "
          />
          <div class="image-overlay">
            <Button icon="pi pi-trash" rounded severity="danger" size="small" :aria-label="`ลบรูปภาพลำดับ ${idx + 1}`" @click.stop="confirmDeleteImage(img)" />
          </div>
          <span class="image-order">{{ idx + 1 }}</span>
          <i class="pi pi-bars image-drag-icon" />
        </div>
      </div>
      <p v-if="images.length > 1" class="image-hint">ลากเพื่อเรียงลำดับ แล้วกด "บันทึกลำดับ"</p>
    </div>

    <!-- ส่วนที่ 1: ข้อมูลหลัก -->
    <div class="section-card">
      <div class="section-header">
        <h2 class="section-title">ข้อมูลหลัก</h2>
      </div>
      <div v-if="isLoadingMain" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else class="form-grid">
        <div class="form-field">
          <label class="field-label">ชื่อสินค้า 1</label>
          <InputText v-model="form.name_1" class="w-full" aria-label="Product name 1" />
        </div>
        <div class="form-field">
          <label class="field-label">ชื่อสินค้า 2</label>
          <InputText v-model="form.name_2" class="w-full" aria-label="Product name 2" />
        </div>
        <div class="form-field">
          <label class="field-label">ชื่อ EN 1</label>
          <InputText v-model="form.name_eng_1" class="w-full" aria-label="Product English name 1" />
        </div>
        <div class="form-field">
          <label class="field-label">ชื่อ EN 2</label>
          <InputText v-model="form.name_eng_2" class="w-full" aria-label="Product English name 2" />
        </div>
        <div class="form-field span-2">
          <label class="field-label">รายละเอียด</label>
          <Editor v-model="form.description" class="description-editor" editorStyle="height: 240px" placeholder="พิมพ์รายละเอียดสินค้า...">
            <template #toolbar>
              <span class="ql-formats">
                <select class="ql-header" defaultValue="">
                  <option value="1">หัวข้อใหญ่</option>
                  <option value="2">หัวข้อรอง</option>
                  <option value="">ปกติ</option>
                </select>
              </span>
              <span class="ql-formats">
                <button v-tooltip.top="'ตัวหนา'" class="ql-bold" type="button"></button>
                <button v-tooltip.top="'ตัวเอียง'" class="ql-italic" type="button"></button>
                <button v-tooltip.top="'ขีดเส้นใต้'" class="ql-underline" type="button"></button>
              </span>
              <span class="ql-formats">
                <select class="ql-color"></select>
                <select class="ql-background"></select>
              </span>
              <span class="ql-formats">
                <button v-tooltip.top="'รายการตัวเลข'" class="ql-list" value="ordered" type="button"></button>
                <button v-tooltip.top="'รายการหัวข้อ'" class="ql-list" value="bullet" type="button"></button>
              </span>
              <span class="ql-formats">
                <button v-tooltip.top="'ลิงก์'" class="ql-link" type="button"></button>
                <button v-tooltip.top="'ล้างรูปแบบ'" class="ql-clean" type="button"></button>
              </span>
            </template>
          </Editor>
        </div>
        <div class="form-field span-2">
          <div class="promo-switch-row">
            <label class="field-label">รายละเอียดโปรโมชั่น</label>
            <label class="promo-switch">
              <ToggleSwitch v-model="form.dimension_41" aria-label="เปิดใช้งานโปรโมชั่น" />
              <span>{{ form.dimension_41 ? "เปิดใช้งานโปรโมชั่น" : "ปิดโปรโมชั่น" }}</span>
            </label>
          </div>
          <Editor
            v-model="form.dimension_39"
            class="description-editor"
            :class="{ 'is-locked': !form.dimension_41 }"
            :readonly="!form.dimension_41"
            editorStyle="height: 180px"
            placeholder="เช่น ซื้อ 2 แถม 1 · ลด 10% เมื่อซื้อครบ 5 ลัง"
          >
            <template #toolbar>
              <span class="ql-formats">
                <button v-tooltip.top="'ตัวหนา'" class="ql-bold" type="button"></button>
                <button v-tooltip.top="'ตัวเอียง'" class="ql-italic" type="button"></button>
                <button v-tooltip.top="'ขีดเส้นใต้'" class="ql-underline" type="button"></button>
              </span>
              <span class="ql-formats">
                <select class="ql-color"></select>
                <select class="ql-background"></select>
              </span>
              <span class="ql-formats">
                <button v-tooltip.top="'รายการตัวเลข'" class="ql-list" value="ordered" type="button"></button>
                <button v-tooltip.top="'รายการหัวข้อ'" class="ql-list" value="bullet" type="button"></button>
              </span>
              <span class="ql-formats">
                <button v-tooltip.top="'ลิงก์'" class="ql-link" type="button"></button>
                <button v-tooltip.top="'ล้างรูปแบบ'" class="ql-clean" type="button"></button>
              </span>
            </template>
          </Editor>
          <small class="field-hint">
            เปิดสวิตช์แล้วสินค้านี้จะถูกนับเป็นสินค้าโปรโมชั่น และแสดงรายละเอียดในหน้าสินค้าต่อจากตัวคูณหน่วย ตำแหน่งเดียวกับโปรโมชันที่มาจากระบบ<br />
            ปิดสวิตช์แล้วแก้ไขไม่ได้และไม่แสดงหน้าเว็บ แต่ข้อความที่บันทึกไว้ยังอยู่ครบ เปิดกลับมาใช้ได้ทันที
          </small>
        </div>
        <div class="form-field">
          <label class="field-label">หน่วยมาตรฐาน</label>
          <Select v-model="form.unit_standard" :options="unitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วย" aria-label="Standard unit" class="w-full" filter />
        </div>
        <div class="form-field">
          <label class="field-label">หน่วยต้นทุน</label>
          <Select v-model="form.unit_cost" :options="unitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วย" aria-label="Cost unit" class="w-full" filter showClear />
        </div>
        <div class="form-field">
          <label class="field-label">รูปแบบสินค้า</label>
          <Select v-model="form.item_pattern" :options="productPatternOptions" optionLabel="label" optionValue="value" placeholder="เลือกรูปแบบสินค้า" aria-label="Product pattern" class="w-full" filter showClear />
        </div>
        <div class="form-field">
          <label class="field-label">หมวด</label>
          <Select v-model="form.item_category" :options="categoryOptions" optionLabel="label" optionValue="value" placeholder="เลือกหมวด" class="w-full" filter showClear />
        </div>
        <div class="form-field">
          <label class="field-label">หน่วยเริ่มต้นซื้อ</label>
          <Select v-model="form.start_purchase_unit" :options="startPurchaseUnitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วยเริ่มต้นซื้อ" class="w-full" filter showClear />
        </div>
        <div class="form-field">
          <label class="field-label">หน่วยเริ่มต้นขาย</label>
          <Select v-model="form.start_sale_unit" :options="startSaleUnitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วยเริ่มต้นขาย" class="w-full" filter showClear />
        </div>
        <div class="form-grid-2 span-2">
          <div class="form-field">
            <label class="field-label">คลังเริ่มต้นซื้อ</label>
            <Select v-model="form.start_purchase_wh" :options="warehouseOptions" optionLabel="label" optionValue="value" placeholder="เลือกคลังเริ่มต้นซื้อ" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">ที่เก็บเริ่มต้นซื้อ</label>
            <Select v-model="form.start_purchase_shelf" :options="purchaseShelfOptions" optionLabel="label" optionValue="value" placeholder="เลือกที่เก็บเริ่มต้นซื้อ" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">คลังเริ่มต้นขาย</label>
            <Select v-model="form.start_sale_wh" :options="warehouseOptions" optionLabel="label" optionValue="value" placeholder="เลือกคลังเริ่มต้นขาย" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">ที่เก็บเริ่มต้นขาย</label>
            <Select v-model="form.start_sale_shelf" :options="saleShelfOptions" optionLabel="label" optionValue="value" placeholder="เลือกที่เก็บเริ่มต้นขาย" class="w-full" filter showClear />
          </div>
        </div>
        <div class="warehouse-shelf-panel span-2">
          <div class="warehouse-shelf-toolbar">
            <div>
              <p class="warehouse-shelf-title">คลัง/ที่เก็บที่ใช้ได้</p>
              <p class="warehouse-shelf-subtitle">รายการนี้บันทึกใน ic_wh_shelf และใช้คู่กับคลังเริ่มต้นขายของสินค้า</p>
            </div>
            <Button label="เพิ่มคลัง/ที่เก็บ" icon="pi pi-plus" size="small" outlined @click="addMainWarehouseShelf" />
          </div>
          <DataTable :value="warehouseShelves" size="small" responsiveLayout="scroll" class="warehouse-shelf-table">
            <Column header="คลัง" style="min-width: 150px">
              <template #body="{ data }">
                <strong>{{ data.wh_code }}</strong>
                <span v-if="data.wh_name" class="muted-text">{{ data.wh_name }}</span>
              </template>
            </Column>
            <Column header="ที่เก็บ" style="min-width: 150px">
              <template #body="{ data }">
                <strong>{{ data.shelf_code }}</strong>
                <span v-if="data.shelf_name" class="muted-text">{{ data.shelf_name }}</span>
              </template>
            </Column>
            <Column style="width: 64px" bodyClass="col-actions">
              <template #body="{ data }">
                <Button icon="pi pi-trash" text rounded severity="danger" size="small" aria-label="ลบคลัง/ที่เก็บ" @click="removeMainWarehouseShelf(data)" />
              </template>
            </Column>
            <template #empty>
              <div class="warehouse-shelf-empty">ยังไม่ได้เลือกคลัง/ที่เก็บ</div>
            </template>
          </DataTable>
        </div>
        <div class="form-grid-3 span-2">
          <div class="form-field">
            <label class="field-label">จุดสั่งซื้อสูงสุด</label>
            <InputNumber v-model="form.maximum_qty" :minFractionDigits="0" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">จุดสั่งซื้อ</label>
            <InputNumber v-model="form.purchase_point" :minFractionDigits="0" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">จุดสั่งซื้อต่ำสุด</label>
            <InputNumber v-model="form.minimum_qty" :minFractionDigits="0" :maxFractionDigits="4" class="w-full" />
          </div>
        </div>
        <div class="product-status-grid span-2">
          <label class="switch-field">
            <ToggleSwitch v-model="form.is_hold_sale" />
            <span>สินค้าหยุดขาย</span>
          </label>
          <label class="switch-field">
            <ToggleSwitch v-model="form.is_hold_purchase" />
            <span>สินค้าหยุดซื้อ</span>
          </label>
          <label class="switch-field">
            <ToggleSwitch v-model="form.is_end" />
            <span>สินค้าเลิกผลิต</span>
          </label>
          <label class="switch-field">
            <ToggleSwitch v-model="form.is_premium" />
            <span>สินค้าแนะนำ</span>
          </label>
        </div>
        <div class="form-field">
          <label class="field-label">กว้างxยาวxสูง</label>
          <InputText v-model="form.width_length_height" placeholder="เช่น 10x20x30" class="w-full" />
        </div>
        <div class="form-field">
          <label class="field-label">น้ำหนัก</label>
          <InputText v-model="form.weight" placeholder="เช่น 1.5 kg" class="w-full" />
        </div>
        <div class="marketplace-settings span-2">
          <div class="marketplace-settings-head">
            <div>
              <h3>ตั้งค่า Marketplace</h3>
              <p>กำหนดการแสดงผลหน้าเว็บสำหรับสินค้ารายตัว</p>
            </div>
          </div>
          <div class="form-grid-2">
            <div class="form-field">
              <label class="field-label">ชื่อสินค้าที่แสดง</label>
              <Select v-model="form.dimension_32" :options="productNameModeOptions" optionLabel="label" optionValue="value" aria-label="Product display name mode" class="w-full" />
            </div>
            <div class="form-field">
              <label class="field-label">การแสดงยอดขายเริ่มต้น</label>
              <Select v-model="form.dimension_34" :options="productSalesDisplayModeOptions" optionLabel="label" optionValue="value" aria-label="Sales display mode" class="w-full" />
            </div>
            <div class="form-field">
              <label class="field-label">ช่วงระดับดาว</label>
              <InputText v-model="form.dimension_33" placeholder="เว้นว่างเพื่อใช้ค่าระบบ หรือ 100,500,1000,5000" aria-label="Sales star thresholds" class="w-full" />
              <small v-if="salesStarThresholdError" class="field-error">{{ salesStarThresholdError }}</small>
              <small v-else class="field-hint">เว้นว่าง = ใช้ช่วงระดับดาวจากจัดการตั้งค่าการขาย</small>
            </div>
            <div class="form-field">
              <label class="field-label">Preorder</label>
              <Select v-model="form.dimension_35" :options="preorderModeOptions" optionLabel="label" optionValue="value" aria-label="Preorder mode" class="w-full" />
              <div class="field-status-note" :class="{ active: form.dimension_35 === '1', inactive: form.dimension_35 === '0' }">
                <i class="pi pi-info-circle"></i>
                <span>{{ preorderEffectiveStatusText }}</span>
              </div>
            </div>
            <div class="form-field">
              <label class="field-label">วิดีโอสินค้า</label>
              <div class="inline-input-action">
                <textarea v-model="form.dimension_36" class="native-input product-video-input" rows="3" placeholder="/media/product-video.mp4, URL, หรือ iframe จาก YouTube"></textarea>
                <Button icon="pi pi-upload" text rounded aria-label="อัพโหลดวิดีโอสินค้า" :loading="isUploadingVideo" @click="onClickUploadVideo" />
              </div>
              <small class="field-hint">รองรับไฟล์วิดีโอ, URL, หรือโค้ด iframe โดยระบบจะปรับขนาดให้ responsive ในหน้ารายละเอียดสินค้า</small>
            </div>
          </div>
          <div class="hidden-detail-grid">
            <label v-for="item in hiddenDetailOptions" :key="item.key" class="switch-field compact-switch">
              <ToggleSwitch :modelValue="isDetailHidden(item.key)" @update:modelValue="setDetailHidden(item.key, $event)" />
              <span>ซ่อน{{ item.label }}</span>
            </label>
          </div>
          <div v-if="productVideoPreview" class="product-video-preview-frame" :style="{ '--product-video-ratio': productVideoPreview.ratio }">
            <iframe
              v-if="productVideoPreview.type === 'iframe'"
              :src="productVideoPreview.src"
              title="Product video preview"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerpolicy="strict-origin-when-cross-origin"
              allowfullscreen
            ></iframe>
            <video v-else :src="productVideoPreview.src" controls preload="metadata"></video>
          </div>
        </div>
      </div>

      <div class="extra-toggle">
        <Button :label="showExtraDetails ? 'ซ่อนรายละเอียดเพิ่มเติม' : 'รายละเอียดเพิ่มเติม'" :icon="showExtraDetails ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" text size="small" @click="showExtraDetails = !showExtraDetails" />
      </div>

      <div v-if="showExtraDetails" class="extra-details-panel">
        <div class="form-grid form-grid-compact">
          <div class="form-field">
            <label class="field-label">ยี่ห้อ</label>
            <Select v-model="form.item_brand" :options="productBrandOptions" optionLabel="label" optionValue="value" placeholder="เลือกยี่ห้อ" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">กลุ่มหลัก</label>
            <Select v-model="form.group_main" :options="productGroupOptions" optionLabel="label" optionValue="value" placeholder="เลือกกลุ่มหลัก" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">กลุ่มย่อย</label>
            <Select v-model="form.group_sub" :options="productGroupSubOptions" optionLabel="label" optionValue="value" placeholder="เลือกกลุ่มย่อย" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">กลุ่มย่อย 2</label>
            <Select v-model="form.group_sub2" :options="productGroupSub2Options" optionLabel="label" optionValue="value" placeholder="เลือกกลุ่มย่อย 2" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">รูปทรง</label>
            <Select v-model="form.item_design" :options="productDesignOptions" optionLabel="label" optionValue="value" placeholder="เลือกรูปทรง" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">รุ่น</label>
            <Select v-model="form.item_model" :options="productModelOptions" optionLabel="label" optionValue="value" placeholder="เลือกรุ่น" class="w-full" filter showClear />
          </div>
          <div class="form-field">
            <label class="field-label">เกรด</label>
            <Select v-model="form.item_grade" :options="productGradeOptions" optionLabel="label" optionValue="value" placeholder="เลือกเกรด" class="w-full" filter showClear />
          </div>
        </div>
      </div>

      <div class="section-footer">
        <Button label="บันทึกข้อมูลหลัก" icon="pi pi-save" :loading="isSavingMain" :disabled="!canSaveMain" @click="saveMain" />
      </div>
    </div>

    <!-- ส่วนที่ 4.1: สินค้าแนะนำ / สินค้าทดแทน -->
    <div class="related-section-grid">
      <div class="section-card">
        <div class="section-header">
          <h2 class="section-title">สินค้าทดแทน</h2>
          <Button label="เพิ่มสินค้าทดแทน" icon="pi pi-plus" size="small" @click="openAddRelated('replacement')" />
        </div>
        <DataTable v-if="!isMobile" :value="replacementItems" :loading="isLoadingRelated" scrollable class="section-table">
          <Column field="line_number" header="ลำดับ" style="width: 80px" bodyClass="col-center" headerClass="col-center" />
          <Column field="ic_code" header="รหัสสินค้า" style="min-width: 140px">
            <template #body="{ data }">{{ data.ic_code || data.item_code }}</template>
          </Column>
          <Column field="item_name" header="ชื่อสินค้า" style="min-width: 220px" />
          <Column field="status" header="สถานะ" style="width: 110px">
            <template #body="{ data }">
              <span :class="['status-pill', Number(data.status) === 1 ? 'active' : 'inactive']">{{ Number(data.status) === 1 ? 'ใช้งาน' : 'ปิด' }}</span>
            </template>
          </Column>
          <Column style="width: 88px" bodyClass="col-actions">
            <template #body="{ data }">
              <Button icon="pi pi-pencil" text rounded size="small" :aria-label="relatedActionLabel('แก้ไข', 'replacement', data)" @click="openEditRelated('replacement', data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="relatedActionLabel('ลบ', 'replacement', data)" @click="confirmDeleteRelated('replacement', data)" />
            </template>
          </Column>
          <template #empty><div class="table-empty">ยังไม่มีสินค้าทดแทน</div></template>
        </DataTable>
        <div v-else-if="isLoadingRelated" class="section-loading">
          <i class="pi pi-spinner pi-spin" />
        </div>
        <div v-else-if="replacementItems.length" class="mobile-list">
          <div v-for="data in replacementItems" :key="`replace-${data.ic_code || data.item_code}`" class="mobile-card">
            <div class="mobile-card-header">
              <div>
                <p class="mobile-card-title">{{ data.ic_code || data.item_code }}</p>
                <p class="mobile-card-subtitle">{{ data.item_name || '-' }}</p>
              </div>
              <div class="mobile-card-actions">
                <Button icon="pi pi-pencil" text rounded size="small" :aria-label="relatedActionLabel('แก้ไข', 'replacement', data)" @click="openEditRelated('replacement', data)" />
                <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="relatedActionLabel('ลบ', 'replacement', data)" @click="confirmDeleteRelated('replacement', data)" />
              </div>
            </div>
            <div class="mobile-card-meta">
              <span>ลำดับ: {{ data.line_number ?? 0 }}</span>
              <span>สถานะ: {{ Number(data.status) === 1 ? 'ใช้งาน' : 'ปิด' }}</span>
            </div>
          </div>
        </div>
        <div v-else class="table-empty">ยังไม่มีสินค้าทดแทน</div>
      </div>

      <div class="section-card">
        <div class="section-header">
          <h2 class="section-title">สินค้าแนะนำ</h2>
          <Button label="เพิ่มสินค้าแนะนำ" icon="pi pi-plus" size="small" @click="openAddRelated('suggest')" />
        </div>
        <DataTable v-if="!isMobile" :value="suggestItems" :loading="isLoadingRelated" scrollable class="section-table">
          <Column field="line_number" header="ลำดับ" style="width: 80px" bodyClass="col-center" headerClass="col-center" />
          <Column field="ic_code" header="รหัสสินค้า" style="min-width: 140px">
            <template #body="{ data }">{{ data.ic_code || data.item_code }}</template>
          </Column>
          <Column field="item_name" header="ชื่อสินค้า" style="min-width: 220px" />
          <Column field="status" header="สถานะ" style="width: 110px">
            <template #body="{ data }">
              <span :class="['status-pill', Number(data.status) === 1 ? 'active' : 'inactive']">{{ Number(data.status) === 1 ? 'ใช้งาน' : 'ปิด' }}</span>
            </template>
          </Column>
          <Column style="width: 88px" bodyClass="col-actions">
            <template #body="{ data }">
              <Button icon="pi pi-pencil" text rounded size="small" :aria-label="relatedActionLabel('แก้ไข', 'suggest', data)" @click="openEditRelated('suggest', data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="relatedActionLabel('ลบ', 'suggest', data)" @click="confirmDeleteRelated('suggest', data)" />
            </template>
          </Column>
          <template #empty><div class="table-empty">ยังไม่มีสินค้าแนะนำ</div></template>
        </DataTable>
        <div v-else-if="isLoadingRelated" class="section-loading">
          <i class="pi pi-spinner pi-spin" />
        </div>
        <div v-else-if="suggestItems.length" class="mobile-list">
          <div v-for="data in suggestItems" :key="`suggest-${data.ic_code || data.item_code}`" class="mobile-card">
            <div class="mobile-card-header">
              <div>
                <p class="mobile-card-title">{{ data.ic_code || data.item_code }}</p>
                <p class="mobile-card-subtitle">{{ data.item_name || '-' }}</p>
              </div>
              <div class="mobile-card-actions">
                <Button icon="pi pi-pencil" text rounded size="small" :aria-label="relatedActionLabel('แก้ไข', 'suggest', data)" @click="openEditRelated('suggest', data)" />
                <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="relatedActionLabel('ลบ', 'suggest', data)" @click="confirmDeleteRelated('suggest', data)" />
              </div>
            </div>
            <div class="mobile-card-meta">
              <span>ลำดับ: {{ data.line_number ?? 0 }}</span>
              <span>สถานะ: {{ Number(data.status) === 1 ? 'ใช้งาน' : 'ปิด' }}</span>
            </div>
          </div>
        </div>
        <div v-else class="table-empty">ยังไม่มีสินค้าแนะนำ</div>
      </div>
    </div>



    <!-- ส่วนที่ 2: สูตรราคาขาย -->
    <div class="section-card">
      <div class="section-header">
        <h2 class="section-title">สูตรราคาขาย</h2>
        <Button label="เพิ่มสูตรราคา" icon="pi pi-plus" size="small" @click="openAddFormula" />
      </div>
      <DataTable v-if="!isMobile" :value="priceFormulas" :loading="isLoadingFormulas" scrollable class="section-table">
        <Column field="unit_code" header="หน่วยนับ" style="min-width: 100px" />
        <Column field="sale_type" header="ประเภทการขาย" style="min-width: 120px">
          <template #body="{ data }">{{ saleTypeLabel(data.sale_type) }}</template>
        </Column>
        <Column field="tax_type" header="ภาษี" style="min-width: 100px">
          <template #body="{ data }">{{ taxTypeLabel(data.tax_type) }}</template>
        </Column>
        <Column v-for="n in 10" :key="n - 1" :field="'price_' + (n - 1)" :header="'ราคา ' + (n - 1)" style="min-width: 90px" bodyClass="col-num" headerClass="col-num" />
        <Column style="width: 88px" bodyClass="col-actions">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" :aria-label="formulaActionLabel('แก้ไข', data)" @click="openEditFormula(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="formulaActionLabel('ลบ', data)" @click="confirmDeleteFormula(data)" />
          </template>
        </Column>
        <template #empty><div class="table-empty">ไม่มีสูตรราคา</div></template>
      </DataTable>
      <div v-else-if="isLoadingFormulas" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="priceFormulas.length" class="mobile-list">
        <div v-for="data in priceFormulas" :key="`${data.unit_code}-${data.sale_type}-${data.tax_type}`" class="mobile-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ data.unit_code }}</p>
              <p class="mobile-card-subtitle">{{ saleTypeLabel(data.sale_type) }} / {{ taxTypeLabel(data.tax_type) }}</p>
            </div>
            <div class="mobile-card-actions">
              <Button icon="pi pi-pencil" text rounded size="small" :aria-label="formulaActionLabel('แก้ไข', data)" @click="openEditFormula(data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="formulaActionLabel('ลบ', data)" @click="confirmDeleteFormula(data)" />
            </div>
          </div>
          <div class="formula-chip-list">
            <span v-for="entry in getFormulaPriceEntries(data)" :key="entry.label" class="formula-chip">
              <strong>{{ entry.label }}</strong>
              <span>{{ entry.value }}</span>
            </span>
            <span v-if="getFormulaPriceEntries(data).length === 0" class="formula-empty">ไม่มีสูตรย่อย</span>
          </div>
        </div>
      </div>
      <div v-else class="table-empty">ไม่มีสูตรราคา</div>
    </div>

    <!-- ส่วนที่ 2.1: ราคาขาย/โปรโมชั่น -->
    <div class="section-card">
      <div class="section-header">
        <h2 class="section-title">ราคาขาย / โปรโมชั่น</h2>
        <Button label="เพิ่มราคาขาย" icon="pi pi-plus" size="small" @click="openAddSalePrice" />
      </div>
      <div class="type-tabs">
        <button v-for="tab in salePriceTabs" :key="`price-tab-${tab.value}`" type="button" class="type-tab" :class="{ active: activeSalePriceType === tab.value }" :aria-pressed="activeSalePriceType === tab.value" @click="activeSalePriceType = tab.value">
          <span>{{ tab.label }}</span>
          <strong>{{ tab.count }}</strong>
        </button>
      </div>
      <DataTable v-if="!isMobile" :value="activeSalePriceRows" :loading="isLoadingSalePrices" scrollable class="section-table">
        <Column field="unit_code" header="หน่วยนับ" style="min-width: 90px" />
        <Column field="price_mode" header="โหมด" style="min-width: 120px">
          <template #body="{ data }">{{ priceModeLabel(data.price_mode) }}</template>
        </Column>
        <Column field="sale_type" header="ประเภทขาย" style="min-width: 110px">
          <template #body="{ data }">{{ saleTypeLabel(data.sale_type) }}</template>
        </Column>
        <Column header="ช่วงวันที่" style="min-width: 180px">
          <template #body="{ data }">{{ dateRangeText(data) }}</template>
        </Column>
        <Column header="ช่วงจำนวน" style="min-width: 140px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ qtyRangeText(data) }}</template>
        </Column>
        <Column field="sale_price1" header="ราคาไม่รวม VAT" style="min-width: 120px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.sale_price1) }}</template>
        </Column>
        <Column field="sale_price2" header="ราคารวม VAT" style="min-width: 120px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.sale_price2) }}</template>
        </Column>
        <Column header="ขอบเขต" style="min-width: 150px">
          <template #body="{ data }">{{ conditionScopeText(data) }}</template>
        </Column>
        <Column style="width: 88px" bodyClass="col-actions">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" :aria-label="salePriceActionLabel('แก้ไข', data)" @click="openEditSalePrice(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="salePriceActionLabel('ลบ', data)" @click="confirmDeleteSalePrice(data)" />
          </template>
        </Column>
        <template #empty><div class="table-empty">ยังไม่มีรายการในประเภทนี้</div></template>
      </DataTable>
      <div v-else-if="isLoadingSalePrices" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="activeSalePriceRows.length" class="mobile-list">
        <div v-for="data in activeSalePriceRows" :key="`price-${data.roworder}`" class="mobile-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ data.unit_code }} / {{ priceModeLabel(data.price_mode) }}</p>
              <p class="mobile-card-subtitle">{{ dateRangeText(data) }}</p>
            </div>
            <div class="mobile-card-actions">
              <Button icon="pi pi-pencil" text rounded size="small" :aria-label="salePriceActionLabel('แก้ไข', data)" @click="openEditSalePrice(data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="salePriceActionLabel('ลบ', data)" @click="confirmDeleteSalePrice(data)" />
            </div>
          </div>
          <div class="mobile-card-grid mobile-card-grid-2">
            <div class="mobile-stat">
              <span class="mobile-stat-label">ช่วงจำนวน</span>
              <strong>{{ qtyRangeText(data) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคารวม VAT</span>
              <strong>{{ formatNum(data.sale_price2) }}</strong>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="table-empty">ยังไม่มีรายการในประเภทนี้</div>
    </div>

    <!-- ส่วนที่ 2.2: เงื่อนไขส่วนลด -->
    <div class="section-card">
      <div class="section-header">
        <h2 class="section-title">เงื่อนไขส่วนลด</h2>
        <Button label="เพิ่มส่วนลด" icon="pi pi-plus" size="small" @click="openAddDiscount" />
      </div>
      <div class="type-tabs">
        <button v-for="tab in discountTabs" :key="`discount-tab-${tab.value}`" type="button" class="type-tab" :class="{ active: activeDiscountType === tab.value }" :aria-pressed="activeDiscountType === tab.value" @click="activeDiscountType = tab.value">
          <span>{{ tab.label }}</span>
          <strong>{{ tab.count }}</strong>
        </button>
      </div>
      <DataTable v-if="!isMobile" :value="activeDiscountRows" :loading="isLoadingDiscountConditions" scrollable class="section-table">
        <Column field="unit_code" header="หน่วยนับ" style="min-width: 90px" />
        <Column field="sale_type" header="ประเภทขาย" style="min-width: 110px">
          <template #body="{ data }">{{ saleTypeLabel(data.sale_type) }}</template>
        </Column>
        <Column header="ช่วงวันที่" style="min-width: 180px">
          <template #body="{ data }">{{ dateRangeText(data) }}</template>
        </Column>
        <Column header="ช่วงจำนวน" style="min-width: 140px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ qtyRangeText(data) }}</template>
        </Column>
        <Column field="discount" header="ส่วนลด" style="min-width: 120px" />
        <Column header="ขอบเขต" style="min-width: 150px">
          <template #body="{ data }">{{ conditionScopeText(data) }}</template>
        </Column>
        <Column style="width: 88px" bodyClass="col-actions">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" :aria-label="discountActionLabel('แก้ไข', data)" @click="openEditDiscount(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="discountActionLabel('ลบ', data)" @click="confirmDeleteDiscount(data)" />
          </template>
        </Column>
        <template #empty><div class="table-empty">ยังไม่มีรายการในประเภทนี้</div></template>
      </DataTable>
      <div v-else-if="isLoadingDiscountConditions" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="activeDiscountRows.length" class="mobile-list">
        <div v-for="data in activeDiscountRows" :key="`discount-${data.roworder}`" class="mobile-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ data.unit_code }} / {{ data.discount }}</p>
              <p class="mobile-card-subtitle">{{ dateRangeText(data) }}</p>
            </div>
            <div class="mobile-card-actions">
              <Button icon="pi pi-pencil" text rounded size="small" :aria-label="discountActionLabel('แก้ไข', data)" @click="openEditDiscount(data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="discountActionLabel('ลบ', data)" @click="confirmDeleteDiscount(data)" />
            </div>
          </div>
        </div>
      </div>
      <div v-else class="table-empty">ยังไม่มีรายการในประเภทนี้</div>
    </div>

    <!-- ส่วนที่ 3: หน่วยนับ -->
    <div class="section-card">
      <div class="section-header">
        <h2 class="section-title">หน่วยนับ</h2>
        <Button label="เพิ่มหน่วยนับ" icon="pi pi-plus" size="small" @click="openAddUnitUse" />
      </div>
      <DataTable v-if="!isMobile" :value="unitUseList" :loading="isLoadingUnitUse" scrollable class="section-table">
        <Column field="code" header="รหัส" style="min-width: 90px" />
        <Column field="unit_name" header="ชื่อ" style="min-width: 140px" />
        <Column field="stand_value" header="ตัวตั้ง" style="min-width: 90px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.stand_value) }}</template>
        </Column>
        <Column field="divide_value" header="ตัวหาร" style="min-width: 90px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.divide_value) }}</template>
        </Column>
        <Column field="ratio" header="อัตราส่วน" style="min-width: 100px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.ratio) }}</template>
        </Column>
        <Column field="row_order" header="ลำดับ" style="min-width: 70px" bodyClass="col-center" headerClass="col-center" />
        <Column field="width_length_height" header="กว้างxยาวxสูง" style="min-width: 130px" />
        <Column field="weight" header="น้ำหนัก" style="min-width: 90px" />
        <Column style="width: 88px" bodyClass="col-actions">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" :aria-label="unitUseActionLabel('แก้ไข', data)" @click="openEditUnitUse(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="unitUseActionLabel('ลบ', data)" @click="confirmDeleteUnitUse(data)" />
          </template>
        </Column>
        <template #empty><div class="table-empty">ไม่มีหน่วยนับ</div></template>
      </DataTable>
      <div v-else-if="isLoadingUnitUse" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="unitUseList.length" class="mobile-list">
        <div v-for="data in unitUseList" :key="data.code" class="mobile-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ data.code }}</p>
              <p class="mobile-card-subtitle">{{ data.unit_name || "-" }}</p>
            </div>
            <div class="mobile-card-actions">
              <Button icon="pi pi-pencil" text rounded size="small" :aria-label="unitUseActionLabel('แก้ไข', data)" @click="openEditUnitUse(data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="unitUseActionLabel('ลบ', data)" @click="confirmDeleteUnitUse(data)" />
            </div>
          </div>
          <div class="mobile-card-grid mobile-card-grid-2">
            <div class="mobile-stat">
              <span class="mobile-stat-label">ตัวตั้ง</span>
              <strong>{{ formatNum(data.stand_value) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ตัวหาร</span>
              <strong>{{ formatNum(data.divide_value) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">อัตราส่วน</span>
              <strong>{{ formatNum(data.ratio) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ลำดับ</span>
              <strong>{{ data.row_order ?? "-" }}</strong>
            </div>
          </div>
          <div class="mobile-card-meta">
            <span>กว้างxยาวxสูง: {{ data.width_length_height || "-" }}</span>
            <span>น้ำหนัก: {{ data.weight || "-" }}</span>
          </div>
        </div>
      </div>
      <div v-else class="table-empty">ไม่มีหน่วยนับ</div>
    </div>

    <div class="section-card">
      <div class="section-header">
        <div>
          <h2 class="section-title">ตั้งค่าหน่วยขายออนไลน์</h2>
          <p class="section-help">เลือกจากหน่วยนับทั้งหมดของสินค้าใน ic_unit_use หน่วยที่ปิดจะไม่แสดงในหน้าขายออนไลน์</p>
        </div>
        <Button label="บันทึกหน่วยออนไลน์" icon="pi pi-save" size="small" :loading="isSavingOnlineUnits" :disabled="isLoadingUnitUse || !unitUseList.length" @click="saveOnlineUnitVisibility" />
      </div>
      <div v-if="isLoadingUnitUse" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="unitUseList.length" class="online-unit-grid">
        <label v-for="unit in unitUseList" :key="`online-unit-${unit.code}`" class="online-unit-toggle" :class="{ 'is-hidden': isUnitHiddenOnline(unit.code) }">
          <ToggleSwitch :modelValue="!isUnitHiddenOnline(unit.code)" @update:modelValue="setUnitOnlineVisible(unit.code, $event)" />
          <span>
            <strong>{{ unit.code }}</strong>
            <small>{{ unit.unit_name || unit.unit_name_2 || "หน่วยนับ" }}</small>
          </span>
          <em>{{ isUnitHiddenOnline(unit.code) ? "ไม่แสดง" : "แสดง" }}</em>
        </label>
      </div>
      <div v-else class="table-empty">ไม่มีหน่วยนับสำหรับตั้งค่าออนไลน์</div>

      <!-- Maximum Allowance ต่อหน่วย (REQ3) -->
      <div v-if="unitUseList.length" class="max-allowance-block">
        <h3 class="max-allowance-title">จำนวนสั่งสูงสุดต่อคำสั่งซื้อ (Maximum Allowance)</h3>
        <p class="section-help">เว้นว่างหรือใส่ 0 = ไม่จำกัด · กำหนดแยกได้ทีละหน่วย · ระบบจะแสดงข้อความแจ้งลูกค้าในหน้ารายละเอียดสินค้า</p>
        <div class="max-allowance-grid">
          <div v-for="unit in unitUseList" :key="`max-allow-${unit.code}`" class="max-allowance-row">
            <span class="max-allowance-unit">
              <strong>{{ unit.code }}</strong>
              <small>{{ unit.unit_name || unit.unit_name_2 || "หน่วยนับ" }}</small>
            </span>
            <InputNumber
              :modelValue="getMaxAllowance(unit.code)"
              :min="0"
              :useGrouping="false"
              placeholder="ไม่จำกัด"
              inputClass="w-full"
              @update:modelValue="setMaxAllowance(unit.code, $event)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ส่วนที่ 5: บาร์โค้ดสินค้า -->
    <div class="section-card">
      <div class="section-header">
        <h2 class="section-title">บาร์โค้ดสินค้า</h2>
        <Button label="เพิ่มบาร์โค้ด" icon="pi pi-plus" size="small" @click="openAddBarcode" />
      </div>
      <div class="search-bar">
        <InputText v-model="barcodeSearch" placeholder="ค้นหาบาร์โค้ด / หน่วยนับ" aria-label="ค้นหาบาร์โค้ดหรือหน่วยนับ" class="w-full search-input" />
      </div>
      <DataTable v-if="!isMobile" :value="pagedBarcodes" :loading="isLoadingBarcodes" scrollable class="section-table">
        <Column field="barcode" header="บาร์โค้ด" style="min-width: 160px" />
        <Column field="unit_code" header="หน่วยนับ" style="min-width: 100px">
          <template #body="{ data }">{{ data.unit_name || data.unit_code }}</template>
        </Column>
        <Column field="price" header="ราคา" style="min-width: 110px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.price) }}</template>
        </Column>
        <Column field="price_member" header="ราคาสมาชิก" style="min-width: 120px" bodyClass="col-num" headerClass="col-num">
          <template #body="{ data }">{{ formatNum(data.price_member) }}</template>
        </Column>
        <Column field="price_member_3" header="ยอดขาย" style="min-width: 130px">
          <template #body="{ data }">{{ salesDisplayModeOptions.find((item) => item.value === Number(data.price_member_3))?.label || "แสดงยอดขาย" }}</template>
        </Column>
        <Column style="width: 88px" bodyClass="col-actions">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" :aria-label="barcodeActionLabel('แก้ไข', data)" @click="openEditBarcode(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="barcodeActionLabel('ลบ', data)" @click="confirmDeleteBarcode(data)" />
          </template>
        </Column>
        <template #empty><div class="table-empty">ไม่มีบาร์โค้ด</div></template>
      </DataTable>
      <div v-else-if="isLoadingBarcodes" class="section-loading">
        <i class="pi pi-spinner pi-spin" />
      </div>
      <div v-else-if="pagedBarcodes.length" class="mobile-list">
        <div v-for="data in pagedBarcodes" :key="data.barcode" class="mobile-card">
          <div class="mobile-card-header">
            <div>
              <p class="mobile-card-title">{{ data.barcode }}</p>
              <p class="mobile-card-subtitle">{{ data.unit_name || data.unit_code }}</p>
            </div>
            <div class="mobile-card-actions">
              <Button icon="pi pi-pencil" text rounded size="small" :aria-label="barcodeActionLabel('แก้ไข', data)" @click="openEditBarcode(data)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="barcodeActionLabel('ลบ', data)" @click="confirmDeleteBarcode(data)" />
            </div>
          </div>
          <div class="mobile-card-grid mobile-card-grid-2">
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคา</span>
              <strong>{{ formatNum(data.price) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคาสมาชิก</span>
              <strong>{{ formatNum(data.price_member) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคา 2</span>
              <strong>{{ formatNum(data.price_2) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ราคาสมาชิก 2</span>
              <strong>{{ formatNum(data.price_member_2) }}</strong>
            </div>
            <div class="mobile-stat">
              <span class="mobile-stat-label">ยอดขาย</span>
              <strong>{{ salesDisplayModeOptions.find((item) => item.value === Number(data.price_member_3))?.label || "แสดงยอดขาย" }}</strong>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="table-empty">ไม่มีบาร์โค้ด</div>
      <div v-if="filteredBarcodes.length > 0" class="pager-row">
        <span class="pager-count">{{ filteredBarcodes.length }} รายการ</span>
        <div class="pager-nav">
          <Button icon="pi pi-angle-left" text rounded size="small" aria-label="หน้าบาร์โค้ดก่อนหน้า" :disabled="barcodePage === 1" @click="barcodePage--" />
          <span>{{ barcodePage }} / {{ barcodeTotalPages }}</span>
          <Button icon="pi pi-angle-right" text rounded size="small" aria-label="หน้าบาร์โค้ดถัดไป" :disabled="barcodePage >= barcodeTotalPages" @click="barcodePage++" />
        </div>
      </div>
    </div>

    <!-- Dialog: สินค้าทดแทน / สินค้าแนะนำ -->
    <Dialog
      :visible="showRelatedDialog"
      @update:visible="showRelatedDialog = $event"
      :header="relatedMode === 'create' ? relatedMeta(relatedKind).addLabel : `แก้ไข${relatedMeta(relatedKind).title}`"
      :modal="true"
      :draggable="false"
      style="width: min(560px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-field">
          <label class="field-label">สินค้า <span class="required">*</span></label>
          <Select
            v-model="relatedForm.item_code"
            :options="relatedProductOptions"
            optionLabel="label"
            optionValue="code"
            dataKey="code"
            placeholder="ค้นหา/เลือกสินค้า"
            aria-label="Related product"
            class="w-full"
            filter
            :filterFields="['code', 'name', 'label']"
            :loading="isLoadingRelatedProducts"
            @filter="filterRelatedProducts"
            showClear
          />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">ลำดับ</label>
            <InputNumber v-model="relatedForm.line_number" :minFractionDigits="0" :maxFractionDigits="0" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">สถานะ</label>
            <Select
              v-model="relatedForm.status"
              :options="[
                { value: 1, label: 'ใช้งาน' },
                { value: 0, label: 'ปิด' },
              ]"
              optionLabel="label"
              optionValue="value"
              aria-label="Related product status"
              class="w-full"
            />
          </div>
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showRelatedDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingRelated" @click="saveRelated" />
      </template>
    </Dialog>

    <!-- Confirm Dialog -->
    <Dialog :visible="showConfirmDialog" @update:visible="showConfirmDialog = $event" header="ยืนยันการลบ" :modal="true" :draggable="false" style="width: min(400px, 95vw)">
      <div class="confirm-body">
        <i class="pi pi-exclamation-triangle confirm-icon" />
        <span>{{ confirmMessage }}</span>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showConfirmDialog = false" />
        <Button label="ลบ" icon="pi pi-trash" severity="danger" :loading="isDeleting" @click="executeConfirm" />
      </template>
    </Dialog>

    <!-- Dialog: บาร์โค้ด -->
    <Dialog
      :visible="showBarcodeDialog"
      @update:visible="showBarcodeDialog = $event"
      :header="barcodeMode === 'create' ? 'เพิ่มบาร์โค้ด' : 'แก้ไขบาร์โค้ด'"
      :modal="true"
      :draggable="false"
      style="width: min(480px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-field">
          <label class="field-label">บาร์โค้ด <span class="required">*</span></label>
          <InputText v-model="barcodeForm.barcode" class="w-full" aria-label="Barcode" :disabled="barcodeMode === 'edit'" />
        </div>
        <div class="form-field">
          <label class="field-label">หน่วยนับ</label>
          <Select v-model="barcodeForm.unit_code" :options="barcodeUnitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วยนับ" aria-label="Barcode unit" class="w-full" showClear />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">ราคา</label>
            <InputNumber v-model="barcodeForm.price" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ราคาสมาชิก</label>
            <InputNumber v-model="barcodeForm.price_member" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ราคา 2</label>
            <InputNumber v-model="barcodeForm.price_2" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ราคาสมาชิก 2</label>
            <InputNumber v-model="barcodeForm.price_member_2" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">การแสดงยอดขาย</label>
            <Select v-model="barcodeForm.price_member_3" :options="salesDisplayModeOptions" optionLabel="label" optionValue="value" aria-label="Barcode sales display mode" class="w-full" />
          </div>
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showBarcodeDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingBarcode" @click="saveBarcode" />
      </template>
    </Dialog>

    <!-- Dialog: หน่วยนับ -->
    <Dialog
      :visible="showUnitUseDialog"
      @update:visible="showUnitUseDialog = $event"
      :header="unitUseMode === 'create' ? 'เพิ่มหน่วยนับ' : 'แก้ไขหน่วยนับ'"
      :modal="true"
      :draggable="false"
      style="width: min(500px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-field">
          <label class="field-label">รหัสหน่วยนับ <span class="required">*</span></label>
          <Select v-model="unitUseForm.code" :options="unitOptions" optionLabel="label" optionValue="value" placeholder="เลือกหน่วยนับ" aria-label="Unit use code" class="w-full" filter :disabled="unitUseMode === 'edit'" />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">ตัวตั้ง</label>
            <InputNumber v-model="unitUseForm.stand_value" :minFractionDigits="0" :maxFractionDigits="6" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ตัวหาร</label>
            <InputNumber v-model="unitUseForm.divide_value" :minFractionDigits="0" :maxFractionDigits="6" class="w-full" />
          </div>
        </div>
        <div class="form-field">
          <label class="field-label">อัตราส่วน (คำนวณอัตโนมัติ)</label>
          <InputText :value="String(unitUseRatio)" disabled aria-label="Calculated unit ratio" class="w-full ratio-input" />
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">ลำดับ</label>
            <InputNumber v-model="unitUseForm.row_order" :minFractionDigits="0" :maxFractionDigits="0" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">น้ำหนัก</label>
            <InputText v-model="unitUseForm.weight" placeholder="เช่น 1.5 kg" aria-label="Unit weight" class="w-full" />
          </div>
        </div>
        <div class="form-field">
          <label class="field-label">กว้างxยาวxสูง</label>
          <InputText v-model="unitUseForm.width_length_height" placeholder="เช่น 10x20x30" aria-label="Unit width length height" class="w-full" />
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showUnitUseDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingUnitUse" @click="saveUnitUse" />
      </template>
    </Dialog>

    <!-- Dialog: ราคาขาย / โปรโมชั่น -->
    <Dialog
      :visible="showSalePriceDialog"
      @update:visible="showSalePriceDialog = $event"
      :header="salePriceMode === 'create' ? 'เพิ่มราคาขาย / โปรโมชั่น' : 'แก้ไขราคาขาย / โปรโมชั่น'"
      :modal="true"
      :draggable="false"
      style="width: min(760px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-grid-3">
          <div class="form-field">
            <label class="field-label">หน่วยนับ <span class="required">*</span></label>
            <Select v-model="salePriceForm.unit_code" :options="barcodeUnitOptions" optionLabel="label" optionValue="value" placeholder="เลือก" aria-label="Sale price unit" class="w-full" filter />
          </div>
          <div class="form-field">
            <label class="field-label">ประเภทราคา</label>
            <Select v-model="salePriceForm.price_type" :options="PRICE_TYPE_OPTIONS" optionLabel="label" optionValue="value" aria-label="Sale price type" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">โหมดราคา</label>
            <Select v-model="salePriceForm.price_mode" :options="PRICE_MODE_OPTIONS" optionLabel="label" optionValue="value" aria-label="Sale price mode" class="w-full" />
          </div>
        </div>
        <div class="form-grid-3">
          <div class="form-field">
            <label class="field-label">ประเภทการขาย</label>
            <Select v-model="salePriceForm.sale_type" :options="SALE_TYPE_OPTIONS" optionLabel="label" optionValue="value" aria-label="Sale price sale type" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">วันที่เริ่ม</label>
            <input v-model="salePriceForm.from_date" type="date" class="native-input" />
          </div>
          <div class="form-field">
            <label class="field-label">วันที่สิ้นสุด</label>
            <input v-model="salePriceForm.to_date" type="date" class="native-input" />
          </div>
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">จำนวนเริ่ม</label>
            <InputNumber v-model="salePriceForm.from_qty" :minFractionDigits="0" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">จำนวนถึง</label>
            <InputNumber v-model="salePriceForm.to_qty" :minFractionDigits="0" :maxFractionDigits="4" class="w-full" />
          </div>
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">ราคาไม่รวม VAT (sale_price1)</label>
            <InputNumber v-model="salePriceForm.sale_price1" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ราคารวม VAT (sale_price2)</label>
            <InputNumber v-model="salePriceForm.sale_price2" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" />
          </div>
        </div>
        <div v-if="!isGeneralSalePrice" class="form-grid-3">
          <div v-if="isCustomerSalePrice" class="form-field">
            <label class="field-label">รหัสลูกค้า <span class="required">*</span></label>
            <Select
              v-model="salePriceForm.cust_code"
              :options="customerOptions"
              optionLabel="label"
              optionValue="code"
              dataKey="code"
              placeholder="เลือกลูกค้า"
              aria-label="Sale price customer"
              class="w-full"
              filter
              :filterFields="['code', 'name', 'label']"
              :loading="isLoadingCustomers"
              @filter="filterCustomerOptions"
              showClear
            />
          </div>
          <div v-if="isGroupSalePrice" class="form-field">
            <label class="field-label">กลุ่มลูกค้า 1 <span class="required">*</span></label>
            <Select v-model="salePriceForm.cust_group_1" :options="customerGroupOptions" optionLabel="label" optionValue="value" placeholder="เลือกกลุ่มลูกค้า" aria-label="Sale price customer group 1" class="w-full" filter showClear />
          </div>
          <div v-if="isGroupSalePrice" class="form-field">
            <label class="field-label">กลุ่มลูกค้า 2</label>
            <Select v-model="salePriceForm.cust_group_2" :options="customerGroupSubOptions" optionLabel="label" optionValue="value" placeholder="เลือกกลุ่มลูกค้าย่อย" aria-label="Sale price customer group 2" class="w-full" filter showClear />
          </div>
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showSalePriceDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingSalePrice" @click="saveSalePrice" />
      </template>
    </Dialog>

    <!-- Dialog: เงื่อนไขส่วนลด -->
    <Dialog
      :visible="showDiscountDialog"
      @update:visible="showDiscountDialog = $event"
      :header="discountMode === 'create' ? 'เพิ่มเงื่อนไขส่วนลด' : 'แก้ไขเงื่อนไขส่วนลด'"
      :modal="true"
      :draggable="false"
      style="width: min(720px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-grid-3">
          <div class="form-field">
            <label class="field-label">หน่วยนับ <span class="required">*</span></label>
            <Select v-model="discountForm.unit_code" :options="barcodeUnitOptions" optionLabel="label" optionValue="value" placeholder="เลือก" aria-label="Discount unit" class="w-full" filter />
          </div>
          <div class="form-field">
            <label class="field-label">ประเภทส่วนลด</label>
            <Select v-model="discountForm.discount_type" :options="DISCOUNT_TYPE_OPTIONS" optionLabel="label" optionValue="value" aria-label="Discount type" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">ประเภทการขาย</label>
            <Select v-model="discountForm.sale_type" :options="SALE_TYPE_OPTIONS" optionLabel="label" optionValue="value" aria-label="Discount sale type" class="w-full" />
          </div>
        </div>
        <div class="form-grid-3">
          <div class="form-field">
            <label class="field-label">วันที่เริ่ม</label>
            <input v-model="discountForm.from_date" type="date" class="native-input" />
          </div>
          <div class="form-field">
            <label class="field-label">วันที่สิ้นสุด</label>
            <input v-model="discountForm.to_date" type="date" class="native-input" />
          </div>
          <div class="form-field">
            <label class="field-label">ส่วนลด <span class="required">*</span></label>
            <InputText v-model="discountForm.discount" class="w-full" placeholder="เช่น 10%, 5+2%, @10" />
          </div>
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label class="field-label">จำนวนเริ่ม</label>
            <InputNumber v-model="discountForm.from_qty" :minFractionDigits="0" :maxFractionDigits="4" class="w-full" />
          </div>
          <div class="form-field">
            <label class="field-label">จำนวนถึง</label>
            <InputNumber v-model="discountForm.to_qty" :minFractionDigits="0" :maxFractionDigits="4" class="w-full" />
          </div>
        </div>
        <div v-if="!isGeneralDiscount" class="form-grid-3">
          <div v-if="isCustomerDiscount" class="form-field">
            <label class="field-label">รหัสลูกค้า <span class="required">*</span></label>
            <Select
              v-model="discountForm.cust_code"
              :options="customerOptions"
              optionLabel="label"
              optionValue="code"
              dataKey="code"
              placeholder="เลือกลูกค้า"
              aria-label="Discount customer"
              class="w-full"
              filter
              :filterFields="['code', 'name', 'label']"
              :loading="isLoadingCustomers"
              @filter="filterCustomerOptions"
              showClear
            />
          </div>
          <div v-if="isGroupDiscount" class="form-field">
            <label class="field-label">กลุ่มลูกค้า 1 <span class="required">*</span></label>
            <Select v-model="discountForm.cust_group_1" :options="customerGroupOptions" optionLabel="label" optionValue="value" placeholder="เลือกกลุ่มลูกค้า" aria-label="Discount customer group 1" class="w-full" filter showClear />
          </div>
          <div v-if="isGroupDiscount" class="form-field">
            <label class="field-label">กลุ่มลูกค้า 2</label>
            <Select v-model="discountForm.cust_group_2" :options="customerGroupSubOptions" optionLabel="label" optionValue="value" placeholder="เลือกกลุ่มลูกค้าย่อย" aria-label="Discount customer group 2" class="w-full" filter showClear />
          </div>
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showDiscountDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingDiscount" @click="saveDiscount" />
      </template>
    </Dialog>

    <!-- Dialog: สูตรราคาขาย -->
    <Dialog
      :visible="showFormulaDialog"
      @update:visible="showFormulaDialog = $event"
      :header="formulaMode === 'create' ? 'เพิ่มสูตรราคาขาย' : 'แก้ไขสูตรราคาขาย'"
      :modal="true"
      :draggable="false"
      style="width: min(560px, 95vw)"
    >
      <div class="dialog-form">
        <div class="form-grid-3">
          <div class="form-field">
            <label class="field-label">หน่วยนับ <span class="required">*</span></label>
            <Select v-model="formulaForm.unit_code" :options="barcodeUnitOptions" optionLabel="label" optionValue="value" placeholder="เลือก" aria-label="Formula unit" class="w-full" :disabled="formulaMode === 'edit'" />
          </div>
          <div class="form-field">
            <label class="field-label">ประเภทการขาย</label>
            <Select v-model="formulaForm.sale_type" :options="SALE_TYPE_OPTIONS" optionLabel="label" optionValue="value" aria-label="Formula sale type" class="w-full" :disabled="formulaMode === 'edit'" />
          </div>
          <div class="form-field">
            <label class="field-label">ภาษี</label>
            <Select v-model="formulaForm.tax_type" :options="TAX_TYPE_OPTIONS" optionLabel="label" optionValue="value" aria-label="Formula tax type" class="w-full" :disabled="formulaMode === 'edit'" />
          </div>
        </div>
        <div class="form-grid-2">
          <div v-for="n in 10" :key="n - 1" class="form-field">
            <label class="field-label">ราคา {{ n - 1 }}</label>
            <InputText :value="formulaForm['price_' + (n - 1)]" @update:modelValue="(v) => (formulaForm['price_' + (n - 1)] = v)" class="w-full" placeholder="" />
          </div>
        </div>
      </div>
      <template #footer>
        <Button label="ยกเลิก" severity="secondary" outlined @click="showFormulaDialog = false" />
        <Button label="บันทึก" icon="pi pi-save" :loading="isSavingFormula" @click="saveFormula" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.edit-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 1100px;
  margin-top: 15px;
}

/* Header */
.page-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-header-meta {
  min-width: 0;
}

.page-title {
  font-size: 1.375rem;
  font-weight: 700;
  margin: 0;
  line-height: 1.2;
}

.page-subtitle {
  font-size: 0.825rem;
  color: var(--p-text-color-secondary);
  margin: 0.1rem 0 0;
}

/* Section card */
.section-card {
  border: 1px solid var(--p-surface-200);
  border-radius: 10px;
  background: var(--p-surface-0);
  overflow: hidden;
}

.related-section-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 1.4rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}

.status-pill.active {
  background: #dcfce7;
  color: #166534;
}

.status-pill.inactive {
  background: #f1f5f9;
  color: #64748b;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.125rem;
  border-bottom: 1px solid var(--p-surface-200);
  background: var(--p-surface-50);
}

.section-title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
}

.section-help {
  margin: 0.25rem 0 0;
  color: var(--p-text-color-secondary);
  font-size: 0.8rem;
  line-height: 1.45;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.section-footer {
  display: flex;
  justify-content: flex-end;
  padding: 0.875rem 1.125rem;
  border-top: 1px solid var(--p-surface-200);
  background: var(--p-surface-50);
}

.section-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2.5rem;
  color: var(--p-text-color-secondary);
  font-size: 1.5rem;
}

.type-tabs {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1.125rem;
  border-bottom: 1px solid var(--p-surface-100);
  background: var(--p-surface-0);
  overflow-x: auto;
}

.type-tab {
  min-height: 2.35rem;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 8px;
  background: var(--p-surface-0);
  color: var(--p-text-color);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s,
    color 0.15s;
}

.type-tab strong {
  min-width: 1.35rem;
  min-height: 1.35rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--p-surface-100);
  color: var(--p-text-color-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
}

.type-tab:hover {
  border-color: var(--p-primary-300);
}

.type-tab.active {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 10%, var(--p-surface-0));
  color: var(--p-primary-color);
}

.type-tab.active strong {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, #fff);
}

/* Forms */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding: 1.125rem;
}

.form-grid-compact {
  padding: 0;
}

.span-2 {
  grid-column: 1 / -1;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-label {
  font-size: 0.775rem;
  font-weight: 500;
  color: var(--p-text-color-secondary);
}

.field-error {
  min-height: 1.15rem;
  color: var(--p-red-600);
  font-size: 0.76rem;
  font-weight: 700;
  line-height: 1.35;
}

.field-status-note {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  min-height: 1.25rem;
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  line-height: 1.35;
}

.field-status-note i {
  margin-top: 0.08rem;
  color: var(--p-primary-color);
  font-size: 0.8rem;
}

.field-status-note.active {
  color: var(--p-green-700);
}

.field-status-note.inactive {
  color: var(--p-red-600);
}

.required {
  color: var(--p-red-500);
}

.extra-toggle {
  padding: 0 1.125rem 0.75rem;
}

.description-editor {
  overflow: hidden;
  border-radius: 12px;
}

/* สวิตช์เปิด/ปิดโปรโมชั่น (dimension_41) */
.promo-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.promo-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
  cursor: pointer;
}

/* ปิดสวิตช์ = แก้ไขไม่ได้ แต่ยังอ่าน/คัดลอกข้อความเดิมได้ */
.description-editor.is-locked :deep(.p-editor-toolbar) {
  opacity: 0.45;
  pointer-events: none;
}

.description-editor.is-locked :deep(.p-editor-content) {
  background: var(--p-surface-50);
}

.description-editor.is-locked :deep(.ql-editor) {
  color: var(--p-text-muted-color);
  cursor: not-allowed;
}

.description-editor :deep(.p-editor-toolbar) {
  border-color: var(--p-surface-200);
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  background: var(--p-surface-50);
}

.description-editor :deep(.p-editor-content) {
  border-color: var(--p-surface-200);
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
}

.description-editor :deep(.ql-editor) {
  color: var(--p-text-color);
  font-family: inherit;
  font-size: 0.925rem;
  line-height: 1.7;
}

.description-editor :deep(.ql-editor.ql-blank::before) {
  color: var(--p-text-muted-color);
  font-style: normal;
}

.extra-details-panel {
  margin: 0 1.125rem 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--p-surface-100);
}

/* Search bar */
.search-bar {
  padding: 0.75rem 1.125rem 0;
}

.search-input {
  max-width: 320px;
}

/* Table */
.section-table {
  font-size: 0.875rem;
}

.table-empty {
  text-align: center;
  padding: 2rem 0;
  color: var(--p-text-color-secondary);
}

/* Pager */
.pager-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 1.125rem;
  border-top: 1px solid var(--p-surface-100);
  font-size: 0.85rem;
  color: var(--p-text-color-secondary);
}

.pager-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
}

.mobile-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.875rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 12px;
  background: var(--p-surface-0);
}

.mobile-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.mobile-card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  word-break: break-word;
}

.mobile-card-subtitle {
  margin: 0.2rem 0 0;
  font-size: 0.775rem;
  color: var(--p-text-color-secondary);
}

.mobile-card-actions {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  flex-shrink: 0;
}

.mobile-card-grid {
  display: grid;
  gap: 0.625rem;
}

.mobile-card-grid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mobile-stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.625rem;
  border-radius: 10px;
  background: var(--p-surface-50);
}

.mobile-stat-label {
  font-size: 0.72rem;
  color: var(--p-text-color-secondary);
}

.mobile-card-meta {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
}

.formula-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.formula-chip {
  display: inline-flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 110px;
  padding: 0.5rem 0.625rem;
  border-radius: 10px;
  background: var(--p-surface-50);
  font-size: 0.78rem;
}

.formula-empty {
  font-size: 0.8rem;
  color: var(--p-text-color-secondary);
}

/* Images */
.image-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem;
  color: var(--p-text-color-secondary);
}

.image-empty-icon {
  font-size: 2.5rem;
}

.image-empty p {
  margin: 0;
  font-size: 0.9rem;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 0.875rem;
  padding: 1rem 1.125rem;
}

.image-card {
  position: relative;
  border-radius: 8px;
  border: 1px solid var(--p-surface-200);
  overflow: hidden;
  background: var(--p-surface-50);
  cursor: grab;
  aspect-ratio: 1;
}

.image-card:active {
  cursor: grabbing;
}

.image-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    background 0.15s,
    opacity 0.15s;
}

.image-card:hover .image-overlay {
  background: rgba(0, 0, 0, 0.3);
  opacity: 1;
}

.image-order {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}

.image-drag-icon {
  position: absolute;
  top: 5px;
  right: 6px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.8rem;
}

.image-hint {
  margin: 0;
  padding: 0 1.125rem 0.75rem;
  font-size: 0.75rem;
  color: var(--p-text-color-secondary);
}

/* Dialog forms */
.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.25rem;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.form-grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
}

.warehouse-shelf-panel {
  border: 1px solid var(--p-surface-200);
  border-radius: 8px;
  background: var(--p-surface-0);
  overflow: hidden;
}

.warehouse-shelf-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--p-surface-200);
}

.warehouse-shelf-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--p-text-color);
}

.warehouse-shelf-subtitle {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: var(--p-text-color-secondary);
}

.warehouse-shelf-table {
  border: 0;
}

.warehouse-shelf-empty {
  padding: 1rem;
  text-align: center;
  color: var(--p-text-color-secondary);
  font-size: 0.85rem;
}

.muted-text {
  display: block;
  margin-top: 0.15rem;
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
}

.switch-field {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 2.75rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 0.7rem;
  background: var(--p-surface-0);
  padding: 0.6rem 0.75rem;
  color: var(--p-text-color);
  font-size: 0.86rem;
  font-weight: 600;
}

.online-unit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
  padding: 1rem 1.125rem;
}

.online-unit-toggle {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  min-height: 4.25rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 0.7rem;
  background: var(--p-surface-0);
  padding: 0.75rem;
}

.online-unit-toggle.is-hidden {
  background: var(--p-surface-50);
}

.online-unit-toggle span {
  display: grid;
  min-width: 0;
}

.online-unit-toggle strong {
  color: var(--p-text-color);
  font-size: 0.92rem;
  overflow-wrap: anywhere;
}

.online-unit-toggle small {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.online-unit-toggle em {
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  padding: 0.2rem 0.5rem;
  font-size: 0.72rem;
  font-style: normal;
  font-weight: 800;
}

.online-unit-toggle.is-hidden em {
  background: #f1f5f9;
  color: #64748b;
}

.product-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
}

.max-allowance-block {
  padding: 1rem 1.125rem 1.125rem;
  border-top: 1px solid var(--p-surface-200);
  background: var(--p-surface-50);
}

.max-allowance-title {
  margin: 0;
  color: var(--p-text-color);
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.4;
}

.max-allowance-block > .section-help {
  max-width: 62rem;
}

.max-allowance-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0.75rem;
  margin-top: 0.875rem;
}

.max-allowance-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(8rem, 10rem);
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
  min-height: 4.25rem;
  padding: 0.75rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 0.7rem;
  background: var(--p-surface-0);
}

.max-allowance-unit {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
}

.max-allowance-unit strong {
  color: var(--p-text-color);
  font-size: 0.92rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.max-allowance-unit small {
  color: var(--p-text-color-secondary);
  font-size: 0.78rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.max-allowance-row :deep(.p-inputnumber) {
  width: 100%;
  min-width: 0;
}

.max-allowance-row :deep(.p-inputnumber-input) {
  width: 100%;
  text-align: right;
}

.marketplace-settings {
  display: grid;
  gap: 0.9rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 0.75rem;
  background: var(--p-surface-50);
  padding: 1rem;
}

.marketplace-settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.marketplace-settings h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
}

.marketplace-settings p {
  margin: 0.2rem 0 0;
  color: var(--p-text-color-secondary);
  font-size: 0.82rem;
}

.inline-input-action {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.hidden-detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.6rem;
}

.compact-switch,
.dialog-switch {
  min-height: 2.4rem;
  background: var(--p-surface-0);
}

.product-video-input {
  min-height: 5.2rem;
  resize: vertical;
}

.product-video-preview-frame {
  width: min(100%, 560px);
  aspect-ratio: var(--product-video-ratio, 16 / 9);
  overflow: hidden;
  border-radius: 0.65rem;
  background: #020617;
}

.product-video-preview-frame iframe,
.product-video-preview-frame video {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #020617;
  object-fit: contain;
}

.ratio-input {
  background: var(--p-surface-100);
}

.native-input {
  width: 100%;
  min-height: 2.5rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--p-surface-300);
  border-radius: 6px;
  background: var(--p-surface-0);
  color: var(--p-text-color);
  font: inherit;
}

.native-input:focus {
  outline: 1px solid var(--p-primary-color);
  border-color: var(--p-primary-color);
}

/* Confirm dialog */
.confirm-body {
  display: flex;
  align-items: flex-start;
  gap: 0.875rem;
  padding: 0.5rem 0;
}

.confirm-icon {
  font-size: 1.5rem;
  color: var(--p-yellow-500);
  flex-shrink: 0;
  margin-top: 0.1rem;
}

@media (max-width: 768px) {
  .edit-page {
    gap: 0.875rem;
  }

  .page-header {
    align-items: flex-start;
  }

  .page-title {
    font-size: 1.2rem;
  }

  .section-header,
  .section-footer,
  .pager-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .section-header > :last-child,
  .section-footer > :last-child,
  .header-actions {
    width: 100%;
  }

  .section-header :deep(.p-button),
  .section-footer :deep(.p-button),
  .header-actions :deep(.p-button) {
    width: 100%;
    justify-content: center;
  }

  .search-bar,
  .mobile-list,
  .image-grid,
  .image-hint,
  .form-grid,
  .section-header,
  .section-footer,
  .pager-row {
    padding-left: 0.875rem;
    padding-right: 0.875rem;
  }

  .search-input {
    max-width: none;
  }

  .form-grid,
  .form-grid-2,
  .form-grid-3,
  .hidden-detail-grid,
  .related-section-grid,
  .mobile-card-grid-2 {
    grid-template-columns: 1fr;
  }

  .image-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .image-empty {
    padding: 2rem 1rem;
  }

  .mobile-card-header {
    flex-direction: column;
  }

  .mobile-card-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .formula-chip {
    width: 100%;
    min-width: 0;
  }

  .online-unit-grid,
  .max-allowance-block {
    padding-left: 0.875rem;
    padding-right: 0.875rem;
  }

  .online-unit-grid,
  .max-allowance-grid {
    grid-template-columns: 1fr;
  }

  .max-allowance-row {
    grid-template-columns: minmax(0, 1fr) minmax(7.5rem, 9rem);
  }

  .confirm-body {
    gap: 0.625rem;
  }
}

@media (max-width: 420px) {
  .max-allowance-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
}
</style>
