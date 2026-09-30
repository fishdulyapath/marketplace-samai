export function allocationError(source, allocations) {
    if (!allocations?.length) return 'กรุณาเพิ่มรายการจัดสรร';
    if (allocations.some(row => !row.item_code || !Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0 || !row.wh_code || !row.shelf_code)) return 'กรุณาเลือกสินค้า จำนวน คลัง และที่เก็บให้ครบ';
    const total = allocations.reduce((sum, row) => sum + Number(row.qty), 0);
    if (Math.abs(total - Number(source.qty)) > 1e-8) return `จำนวนจัดสรรรวม ${total} ต้องเท่ากับ ${source.qty} ${source.unit_code}`;
    const keys = allocations.map(row => `${row.item_code}\0${row.wh_code}\0${row.shelf_code}`);
    if (new Set(keys).size !== keys.length) return 'สินค้า คลัง และที่เก็บซ้ำกัน กรุณารวมจำนวนในรายการเดียว';
    return '';
}

export function allocationPayload(items) {
    return items.flatMap(item => item.allocations
        ? item.allocations.map(({ item_code, qty, wh_code, shelf_code }) => ({ line_number: item.line_number, item_code, qty, wh_code, shelf_code }))
        : [{ line_number: item.line_number, wh_code: item.wh_code, shelf_code: item.shelf_code }]);
}
