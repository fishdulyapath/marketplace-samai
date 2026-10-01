export function orderLineKey(item) {
    return `${item?.doc_no || ''}:${item?.line_number ?? (item?.ref_guid || item?.item_code)}:${item?.unit_code || ''}`;
}

// Display identity is MPR, but payments must target each real invoice once.
export function paymentDetails(orders) {
    const documents = new Map();
    for (const order of orders || []) {
        const rows = Array.isArray(order.payment_documents) ? order.payment_documents : [{
            doc_no: order.inv_doc_no, doc_date: order.inv_doc_date,
            total_amount: Number(order.balance) > 0 ? Number(order.balance) : Number(order.invoiced_amount || order.total_amount)
        }];
        for (const row of rows) {
            if (row.doc_no && row.doc_date && Number(row.total_amount) > 0) {
                documents.set(row.doc_no, { trans_flag: '44', doc_no: row.doc_no, doc_date: row.doc_date, total_amount: Number(row.total_amount) });
            }
        }
    }
    return [...documents.values()];
}

export const payableAmount = order => paymentDetails([order]).reduce((total, row) => total + row.total_amount, 0);
