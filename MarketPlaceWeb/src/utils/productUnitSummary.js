function unitSize(unit) {
    const stand = Number(unit.stand_value);
    const divide = Number(unit.divide_value);
    if (stand > 0 && divide > 0) return stand / divide;
    return Number(unit.ratio);
}

export function unitConversionText(selected, units, locale) {
    if (!selected?.unit_code) return '';
    const selectedSize = unitSize(selected);
    if (!Number.isFinite(selectedSize) || selectedSize <= 0) return '';

    let smallerSize = 0;
    let smallerCode = '';
    for (const unit of units) {
        if (!unit.unit_code || unit.unit_code === selected.unit_code) continue;
        const size = unitSize(unit);
        if (size > smallerSize && size < selectedSize) {
            smallerSize = size;
            smallerCode = unit.unit_code;
        }
    }
    if (!smallerCode) return '';
    const factor = selectedSize / smallerSize;
    const rounded = Number(factor.toFixed(6));
    const sign = Math.abs(factor - rounded) < 1e-9 ? '=' : '≈';
    return `1 ${selected.unit_code} ${sign} ${rounded.toLocaleString(locale, { maximumFractionDigits: 6 })} ${smallerCode}`;
}

export function cartUnitSummaries(items, locale, separator = ' · ') {
    const totalsByCode = new Map();
    for (const item of items) {
        if (!item.item_code || !item.unit_code) continue;
        const qty = Number(item.qty);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        if (!totalsByCode.has(item.item_code)) totalsByCode.set(item.item_code, new Map());
        const totals = totalsByCode.get(item.item_code);
        totals.set(item.unit_code, (totals.get(item.unit_code) || 0) + qty);
    }
    const summaries = new Map();
    for (const [code, totals] of totalsByCode) {
        summaries.set(code, Array.from(totals, ([unit, qty]) => `${qty.toLocaleString(locale)} ${unit}`).join(separator));
    }
    return summaries;
}

export function cartUnitSummary(items, code, locale) {
    if (!code) return '';
    return cartUnitSummaries(items.filter(item => item.item_code === code), locale, ' , ').get(code) || '';
}
