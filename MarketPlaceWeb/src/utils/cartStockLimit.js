import { isSalePremiumItem } from './itemType';
import { isPreorderAllowed, toOrderQty, toStockQty } from './preorderSplit';
import { normalizeMaxOrderQty } from './cartLimits';

function unitRatio(item) {
    const ratio = Number(item?.ratio);
    if (Number.isFinite(ratio) && ratio > 0) return ratio;
    const stand = Number(item?.stand_value);
    const divide = Number(item?.divide_value);
    return Number.isFinite(stand) && stand > 0 && Number.isFinite(divide) && divide > 0 ? stand / divide : 1;
}

// The stock shown for each unit is the same product's base stock divided by its ratio.
// A blocked row reserves all other cart rows; preorder display assigns stock in cart order
// so the same available pieces are never shown as ready on two rows at once.
export function cartStockBreakdown(item, cartItems, stockReady = true) {
    if (!stockReady) return null;
    const premium = isSalePremiumItem(item);
    const set = String(item?.item_type ?? '') === '3';
    const sameProduct = premium || set ? [item] : (cartItems || []).filter((row) => String(row.item_code) === String(item.item_code) && !isSalePremiumItem(row));
    const known = sameProduct.filter((row) => toStockQty(row.balance_qty) !== null);
    if (!known.length) return null;
    const ratio = premium || set ? 1 : unitRatio(item);
    const standardUnit = String(item?.unit_standard || '').trim();
    const exactBase = premium || set ? null : (
        known.find((row) => row.base_balance_qty != null && toStockQty(row.base_balance_qty) !== null)?.base_balance_qty
        ?? known.find((row) => standardUnit && String(row.unit_code) === standardUnit && unitRatio(row) === 1)?.balance_qty
    );
    const availableBase = exactBase == null ? Math.max(...known.map((row) => toStockQty(row.balance_qty) * (premium || set ? 1 : unitRatio(row)))) : toStockQty(exactBase);
    const otherBase = sameProduct.reduce((sum, row) => row === item ? sum : sum + toOrderQty(row.qty) * unitRatio(row), 0);
    const precedingBase = sameProduct.slice(0, sameProduct.indexOf(item)).reduce((sum, row) => sum + toOrderQty(row.qty) * unitRatio(row), 0);
    const preorderAllowed = isPreorderAllowed(item);
    const availableForLineBase = Math.max(0, availableBase - (preorderAllowed ? precedingBase : otherBase));
    const maxReadyQty = Math.max(0, Math.floor((availableForLineBase + 1e-9) / ratio));
    const requestedQty = toOrderQty(item.qty);
    const readyQty = premium && requestedQty > maxReadyQty ? 0 : Math.min(requestedQty, maxReadyQty);
    return {
        requestedQty,
        readyQty,
        preorderQty: preorderAllowed ? requestedQty - readyQty : 0,
        shortageQty: preorderAllowed ? 0 : Math.max(0, requestedQty - readyQty),
        maxReadyQty,
        ratio,
        requiredBase: requestedQty * ratio,
        availableForLineBase,
        baseUnit: exactBase != null ? standardUnit : (ratio === 1 ? String(item?.unit_code || '').trim() : ''),
    };
}

export function stockQtyLimit(item, cartItems, stockReady = true) {
    const allowance = normalizeMaxOrderQty(item?.max_order_qty);
    if (!stockReady || isPreorderAllowed(item)) return allowance;
    const breakdown = cartStockBreakdown(item, cartItems, stockReady);
    if (!breakdown) return allowance;
    return allowance === null ? breakdown.maxReadyQty : Math.min(allowance, breakdown.maxReadyQty);
}

export function hasCartStockShortage(item, cartItems, stockReady = true) {
    const breakdown = cartStockBreakdown(item, cartItems, stockReady);
    return Boolean(breakdown && breakdown.shortageQty > 0);
}
