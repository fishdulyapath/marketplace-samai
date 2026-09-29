// แบ่งรายการสินค้าเป็นเอกสารย่อยตามจำนวนบรรทัดที่ ERP รับได้ (REQ4)
//
// ERP รองรับไม่เกิน 8 บรรทัดต่อเอกสาร ถ้าเกินต้องแยกเป็น BSW...-1, -2, -3
//
// ต้องเรียก "หลัง" expandOrderItems เพราะจำนวนบรรทัดจริงเพิ่งถูกกำหนดตรงนั้น
// (ของแถม 1 บรรทัดในตะกร้า → หลายบรรทัดจริง: ของที่ต้องซื้อ + ของแถม)

const DEFAULT_MAX_LINES = 8;

// จำนวนบรรทัดที่ item หนึ่งจะกินใน ic_trans_detail
//   สินค้าปกติ      = 1
//   ชุดสินค้า (3)   = 1 (หัวชุด) + จำนวน sub_item
function countLines(item) {
  if (String(item?.item_type) === '3') {
    const subs = Array.isArray(item?.sub_item) ? item.sub_item.length : 0;
    return 1 + subs;
  }
  return 1;
}

// กลุ่มที่ห้ามหลุดคนละเอกสาร:
//   - ชุดสินค้า: หัวชุดกับ sub_item ผูกกันด้วย ref_guid/set_ref_line ถ้าแยกใบ ข้อมูลจะขาด
//   - ของแถม: ของที่ต้องซื้อกับของแถมต้องอยู่ใบเดียวกัน ไม่งั้นบัญชีอธิบายไม่ได้ว่าแถมจากอะไร
//
// __group_id ถูกแปะโดย expandOrderItems ตอน expand โปรโมชัน — ใช้แทนการ group ด้วย
// sale_premium_code เพราะลูกค้าอาจใส่โปรโมชันรหัสเดียวกัน 2 บรรทัดในตะกร้า
function groupKeyOf(item, index) {
  const groupId = String(item?.__group_id ?? '').trim();
  return groupId || `line:${index}`;
}

function buildGroups(items) {
  const groups = [];
  const indexByKey = new Map();

  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const key = groupKeyOf(item, index);
    if (!indexByKey.has(key)) {
      indexByKey.set(key, groups.length);
      groups.push({ key, items: [], lineCount: 0 });
    }
    const group = groups[indexByKey.get(key)];
    group.items.push(item);
    group.lineCount += countLines(item);
  });

  return groups;
}

function makeGroupTooLargeError(group, maxLines) {
  const first = group.items[0] || {};
  const err = new Error(
    `รายการนี้มี ${group.lineCount} บรรทัด เกินที่เอกสารเดียวรองรับได้ (${maxLines} บรรทัด) กรุณาติดต่อฝ่ายขาย`
  );
  err.statusCode = 400;
  err.code = 'ORDER_ITEM_GROUP_TOO_LARGE';
  err.item_code = String(first.item_code || '');
  err.line_count = group.lineCount;
  err.max_lines = maxLines;
  return err;
}

// แบ่งเป็นเอกสารย่อยแบบ greedy ตามลำดับเดิม
// ไม่ทำ bin-packing เพราะประหยัดใบได้นิดเดียวแต่ลำดับสินค้าจะสลับ ตรวจสอบยาก
//
// maxLines <= 0 = ไม่แบ่ง (kill switch)
function splitItemsIntoDocuments(items, maxLines = DEFAULT_MAX_LINES) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const limit = Math.trunc(Number(maxLines));
  if (!Number.isFinite(limit) || limit <= 0) {
    return [{ items: list, lineCount: list.reduce((sum, it) => sum + countLines(it), 0) }];
  }

  const groups = buildGroups(list);

  // กลุ่มเดียวใหญ่เกินโควตา → ปฏิเสธก่อน INSERT ใดๆ
  // ไม่ปล่อยเกินเพราะ ERP รับไม่ได้ และไม่ตัดชุดครึ่งเพราะ ref_guid จะขาด
  for (const group of groups) {
    if (group.lineCount > limit) throw makeGroupTooLargeError(group, limit);
  }

  const documents = [];
  let current = null;

  for (const group of groups) {
    if (!current || current.lineCount + group.lineCount > limit) {
      current = { items: [], lineCount: 0 };
      documents.push(current);
    }
    current.items.push(...group.items);
    current.lineCount += group.lineCount;
  }

  return documents;
}

module.exports = {
  DEFAULT_MAX_LINES,
  countLines,
  splitItemsIntoDocuments,
};
