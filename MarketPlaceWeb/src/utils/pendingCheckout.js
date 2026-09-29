// Keep an uncertain checkout retry on the same server idempotency key, including reloads.
export function pendingCheckoutIdentity(customer, payload, { storage = localStorage, requestId, docNo, now = Date.now() }) {
    const key = `samai:pending-checkout:${customer}`;
    const { doc_no, doc_date, doc_time, ...businessData } = payload;
    const signature = JSON.stringify(businessData);
    try {
        const existing = JSON.parse(storage.getItem(key) || 'null');
        if (existing?.signature === signature && now - existing.createdAt < 86400000) return existing;
    } catch { /* Storage can be disabled; server idempotency still applies to this attempt. */ }
    const identity = { requestId, docNo, signature, createdAt: now };
    try { storage.setItem(key, JSON.stringify(identity)); } catch { /* Best effort persistence. */ }
    return identity;
}

export function clearPendingCheckout(customer, storage = localStorage) {
    try { storage.removeItem(`samai:pending-checkout:${customer}`); } catch { /* Best effort cleanup. */ }
}
