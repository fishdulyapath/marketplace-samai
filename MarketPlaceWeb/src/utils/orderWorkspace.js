// Pure workspace helpers. Drafts contain allocations, never customer contact data or credentials.
export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
export function remainingQty(source, rows, except = -1) {
    return Math.round((Number(source.qty) - rows.reduce((sum, row, index) => sum + (index === except ? 0 : Number(row.qty || 0)), 0)) * 1e8) / 1e8;
}
export function documentSignature(doc) {
    const fields = ['line_number', 'item_code', 'qty', 'unit_code', 'price', 'sum_amount', 'discount', 'discount_amount', 'tax_type', 'vat_type', 'vat_rate', 'stand_value', 'divide_value', 'item_type', 'is_permium', 'ref_guid', 'set_ref_line'];
    const line = (item) => [fields.map((field) => String(item[field] ?? '')), (item.sub_item || []).map(line)];
    return JSON.stringify([doc.doc_no, doc.cust_code, String(doc.total_amount), (doc.items || []).map(line)]);
}
export function createOrderDraftStore(storage, scope, employee) {
    const prefix = `samai-order-draft:v1:${encodeURIComponent(scope)}:${encodeURIComponent(employee || '')}:`;
    const key = (docNo) => prefix + encodeURIComponent(docNo);
    return {
        save(doc, now = Date.now()) {
            if (!employee) throw new Error('ไม่พบรหัสพนักงานสำหรับเก็บร่าง');
            const data = {
                version: 1,
                savedAt: now,
                signature: documentSignature(doc),
                lines: doc.items.map((item) => ({ line_number: item.line_number, allocations: item.allocations.map(({ item_code, qty, wh_code, shelf_code }) => ({ item_code, qty, wh_code, shelf_code })) }))
            };
            storage.setItem(key(doc.doc_no), JSON.stringify(data));
        },
        restore(doc, now = Date.now()) {
            if (!employee) return { status: 'none' };
            const raw = storage.getItem(key(doc.doc_no));
            if (!raw) return { status: 'none' };
            try {
                const data = JSON.parse(raw);
                if (
                    data.version !== 1 ||
                    !Number.isFinite(data.savedAt) ||
                    now - data.savedAt > DRAFT_TTL ||
                    data.savedAt > now + 60000 ||
                    data.signature !== documentSignature(doc) ||
                    !Array.isArray(data.lines) ||
                    data.lines.length !== doc.items.length
                )
                    throw new Error('stale');
                const lines = doc.items.map((item) => {
                    const found = data.lines.filter((row) => row.line_number === item.line_number);
                    if (found.length !== 1 || !Array.isArray(found[0].allocations) || !found[0].allocations.length || found[0].allocations.length > 2000) throw new Error('invalid');
                    return found[0].allocations.map((row) => {
                        if (!row || !['item_code', 'wh_code', 'shelf_code'].every((field) => typeof row[field] === 'string' && row[field].length < 256) || (row.qty !== null && (typeof row.qty !== 'number' || !Number.isFinite(row.qty))))
                            throw new Error('invalid');
                        return { item_code: row.item_code, qty: row.qty, wh_code: row.wh_code, shelf_code: row.shelf_code };
                    });
                });
                doc.items.forEach((item, index) => {
                    item.allocations = lines[index];
                });
                return { status: 'restored', savedAt: data.savedAt };
            } catch {
                storage.removeItem(key(doc.doc_no));
                return { status: 'discarded' };
            }
        },
        remove(docNo) {
            if (employee) storage.removeItem(key(docNo));
        },
        list(now = Date.now()) {
            if (!employee) return [];
            const found = [];
            for (let i = storage.length - 1; i >= 0; i--) {
                const entry = storage.key(i);
                if (!entry?.startsWith(prefix)) continue;
                try {
                    const data = JSON.parse(storage.getItem(entry));
                    if (data.version !== 1 || !Number.isFinite(data.savedAt) || now - data.savedAt > DRAFT_TTL) {
                        storage.removeItem(entry);
                        continue;
                    }
                    found.push(decodeURIComponent(entry.slice(prefix.length)));
                } catch {
                    storage.removeItem(entry);
                }
            }
            return found;
        }
    };
}
export function requestAge(createdAt, now = Date.now()) {
    const value = Date.parse(createdAt);
    if (!Number.isFinite(value)) return 'ไม่ทราบเวลารับคำขอ';
    const minutes = Math.max(0, Math.floor((now - value) / 60000));
    return minutes < 60 ? `รอ ${minutes} นาที` : minutes < 1440 ? `รอ ${Math.floor(minutes / 60)} ชม.` : `รอ ${Math.floor(minutes / 1440)} วัน`;
}
export function unassignedRows(items, chosenLines) {
    return items.flatMap((item) => (!chosenLines || chosenLines.includes(item.line_number) ? item.allocations.filter((row) => !row.wh_code && !row.shelf_code) : []));
}
