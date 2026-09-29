export const PREORDER_REMARK = 'PREORDER';

function toNumericValue(value, fallback = 0) {
    const numberValue = typeof value === 'string' ? Number(value.replace(/,/g, '').trim()) : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function toOrderQty(value) {
    const qty = Math.trunc(toNumericValue(value, 0));
    return qty > 0 ? qty : 0;
}

export function toStockQty(value) {
    const qty = toNumericValue(value, null);
    return qty === null ? null : Math.max(0, Math.floor(qty));
}

export function getReadyQty(item) {
    const qty = toOrderQty(item?.qty);
    const stock = toStockQty(item?.balance_qty);
    if (stock === null) return qty;
    return Math.min(qty, stock);
}

export function isPreorderAllowed(item) {
    const value = item?.preorder_allowed ?? item?.preorderAllowed ?? item?.allow_preorder;
    if (value === true || value === 1) return true;
    const text = String(value ?? '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'enabled', 'allow'].includes(text);
}

export function getPreorderQty(item) {
    if (!isPreorderAllowed(item)) return 0;
    const qty = toOrderQty(item?.qty);
    return Math.max(0, qty - getReadyQty(item));
}

export function hasPreorderQty(item) {
    return getPreorderQty(item) > 0;
}

// โปรโมชันของแถม (item_type=4) แยกชิ้นส่วนหรือแบ่งจำนวนระหว่าง 2 ใบไม่ได้
// ถ้าสต๊อกของชิ้นส่วนใดไม่ครบ ต้องย้ายโปรโมชันทั้งบรรทัดไปใบ Preorder
function isSalePremiumItem(item) {
    return String(item?.item_type ?? '') === '4' || String(item?.sale_premium_code ?? '').trim() !== '';
}

export function getPreorderSplit(item) {
    const qty = toOrderQty(item?.qty);

    if (isSalePremiumItem(item)) {
        const stock = toStockQty(item?.balance_qty);
        // client/API รุ่นเก่าที่ไม่มี stock ยังผ่อนปรนเป็นพร้อมส่งเหมือนพฤติกรรมเดิม
        const hasEnoughStock = stock === null || qty <= stock;
        const allowed = isPreorderAllowed(item);
        const readyQty = hasEnoughStock ? qty : 0;
        const shortageQty = hasEnoughStock ? 0 : qty;
        const preorderQty = !hasEnoughStock && allowed ? qty : 0;
        return {
            totalQty: qty,
            stockQty: stock,
            readyQty,
            shortageQty,
            preorderQty,
            hasPreorder: preorderQty > 0,
            preorderAllowed: allowed,
            isBlockedByPreorderSetting: !hasEnoughStock && !allowed
        };
    }

    const stock = toStockQty(item?.balance_qty);
    const readyQty = getReadyQty(item);
    const allowed = isPreorderAllowed(item);
    const shortageQty = Math.max(0, qty - readyQty);
    const preorderQty = allowed ? shortageQty : 0;

    return {
        totalQty: qty,
        stockQty: stock,
        readyQty,
        shortageQty,
        preorderQty,
        hasPreorder: preorderQty > 0,
        preorderAllowed: allowed,
        isBlockedByPreorderSetting: shortageQty > 0 && !allowed,
    };
}

function roundMoney(value) {
    return Math.round(toNumericValue(value, 0) * 100) / 100;
}

function getLineAmount(item) {
    const priceSource = item.price_confirm !== undefined && item.price_confirm !== null ? item.price_confirm : item.price;
    const price = toNumericValue(priceSource, 0);
    const originalQty = toOrderQty(item?.qty);
    const originalSum = toNumericValue(item?.sum_amount, null);
    return {
        originalQty,
        sumAmount: originalSum !== null && originalQty > 0 ? originalSum : price * originalQty,
        discountAmount: toNumericValue(item?.discount_amount, 0),
    };
}

function prorateLineValues(item, qty) {
    const { originalQty, sumAmount, discountAmount } = getLineAmount(item);
    if (originalQty <= 0) return { sum_amount: 0, discount_amount: 0 };
    const ratio = qty / originalQty;
    return {
        sum_amount: roundMoney(sumAmount * ratio),
        discount_amount: roundMoney(discountAmount * ratio),
    };
}

function subtractLineValues(item, firstValues) {
    const { sumAmount, discountAmount } = getLineAmount(item);
    return {
        sum_amount: roundMoney(sumAmount - toNumericValue(firstValues.sum_amount, 0)),
        discount_amount: roundMoney(discountAmount - toNumericValue(firstValues.discount_amount, 0)),
    };
}

function mergeRemarkMarker(itemRemark, marker = '') {
    const remark = String(itemRemark || '').trim();
    const cleanMarker = String(marker || '').trim();
    if (!cleanMarker) return remark;
    const words = remark.toUpperCase().split(/\s+/);
    if (words.includes(cleanMarker.toUpperCase())) return remark;
    return [cleanMarker, remark].filter(Boolean).join(' ');
}

function cloneForQty(item, qty, marker = '', lineValues = null) {
    const values = lineValues || prorateLineValues(item, qty);
    return {
        ...item,
        qty,
        sum_amount: values.sum_amount,
        discount_amount: values.discount_amount,
        remark: mergeRemarkMarker(item.remark, marker),
    };
}

export function splitItemsForPreorder(items) {
    const readyItems = [];
    const preorderItems = [];

    for (const item of Array.isArray(items) ? items : []) {
        const split = getPreorderSplit(item);
        if (split.readyQty > 0 && split.preorderQty > 0) {
            const readyValues = prorateLineValues(item, split.readyQty);
            readyItems.push(cloneForQty(item, split.readyQty, '', readyValues));
            preorderItems.push(cloneForQty(item, split.preorderQty, PREORDER_REMARK, subtractLineValues(item, readyValues)));
            continue;
        }
        if (split.readyQty > 0) readyItems.push(cloneForQty(item, split.readyQty));
        if (split.preorderQty > 0) preorderItems.push(cloneForQty(item, split.preorderQty, PREORDER_REMARK));
    }

    return {
        readyItems,
        preorderItems,
        hasReadyItems: readyItems.length > 0,
        hasPreorderItems: preorderItems.length > 0,
    };
}
