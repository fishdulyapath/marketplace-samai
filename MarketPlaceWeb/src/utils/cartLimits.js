export function normalizeMaxOrderQty(value) {
    const max = Math.trunc(Number(value));
    return Number.isFinite(max) && max > 0 ? max : null;
}

export function isMaxOrderQtyReached(item, quantity = item?.qty) {
    const max = normalizeMaxOrderQty(item?.max_order_qty);
    if (max === null) return false;

    const current = Math.max(0, Math.trunc(Number(quantity) || 0));
    return current >= max;
}

export function getRemainingAddableQty(stockRemaining, allowanceRemaining = null) {
    const stock = Math.max(0, Math.trunc(Number(stockRemaining) || 0));
    if (allowanceRemaining === null || allowanceRemaining === undefined) return stock;

    const allowance = Math.max(0, Math.trunc(Number(allowanceRemaining) || 0));
    return Math.min(stock, allowance);
}
