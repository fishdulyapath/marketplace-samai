# Samai pending orders (300 → 30)

Checkout saves one request in `ic_trans`, `ic_trans_detail`, and `ic_trans_shipment` with `trans_flag=300`, format `MPR`, and a server number `MPRYYMMDD######`. Warehouse/shelf and sale_code are empty. The server validates customer, prices, product participation, sets, promotions and maximum allowance. It does not gate submission on stock or split ready/preorder quantities.

The immutable 300 document holds the customer’s submitted commercial terms. Staff can select only warehouse/shelf per top-level line. Set components inherit their parent’s selection. Confirmation copies persisted prices, quantities, VAT, discounts, free-item flags, delivery and contact details into QT documents; it never reprices or accepts those values from the confirmation payload. Source documents remain stored; closed requests have `last_status=1`.

When the ERP line limit splits a request into several QTs, its saved header discount is allocated across the documents and currency rounding is reconciled to the original totals. A percentage discount is not reapplied to just the first QT. Product/promotion quantity controls no longer block on default-warehouse stock; pricing and maximum allowance rules remain active.

## API

All paths are under `/service/v1`. These endpoints verify Bearer tokens even when legacy `AUTH_MODE` is audit/off. Staff must have `admin.orders`; customer reads/cancellation are scoped to the authenticated customer.

| Method | Path | Contract |
| --- | --- | --- |
| POST | `/sendorder` | Existing checkout body, `request_id` ≤ 64 characters. `doc_no` is required in client numbering mode and is reserved as the future QT number. Returns `success`, `doc_no`, `main_doc_no`, `sub_doc_nos`, `doc_count`, `doc_date`, `doc_time`, `request_id`, `trans_flag:300`, `status:"pending"`, `is_preorder:false`, `duplicate`. |
| GET | `/admin/pending-orders` | Pending queue, newest first; `search`, optional ISO `date_from/date_to`, `page`. No default date cutoff. |
| GET | `/pending-orders` | Customer pending/cancelled/rejected requests; confirmed requests disappear because existing QT history takes over. Same filters. Authorized staff viewing a customer must supply `cust_code`. |
| GET | `/pending-orders/{docNo}` | Header, status, rejection reason, resulting `qt_doc_no`, and `items` with `line_number`, warehouse/shelf, and nested set components. |
| POST | `/admin/pending-orders/{docNo}/confirm` | `{ "allocations": [{ "line_number": 1, "wh_code": "W1", "shelf_code": "S1" }] }`. Exactly one allocation per root line; both master codes required and shelf must belong to warehouse. Returns `doc_no`, `sub_doc_nos`, `request_doc_no`, `duplicate`. |
| POST | `/admin/pending-orders/{docNo}/reject` | `{ "reason": "..." }`, nonempty, max 1,000 characters. |
| POST | `/pending-orders/{docNo}/cancel` | Customer cancels their own pending request; no body required. |

List response: `{ success:true, data:[...], total, page, page_size:20 }`. Errors use `{ success:false, message }` and HTTP 400/401/403/404/409. Confirmation/cancellation/rejection serialize on the lifecycle row using `SELECT ... FOR UPDATE`, within the same transaction as all ERP writes. A repeated identical terminal action is idempotent; a competing action returns 409. Cancellation/rejection of 300 never creates SOC 31.

QT `sale_code` in header and details is the authenticated confirming employee. `creator_code='market'` keeps existing history/report filtering. `doc_ref` and `doc_ref_date` point back to MPR. The numbering mode is captured at submission: client mode keeps the reserved number; server mode uses the current QT pattern and ERP line limit at confirmation. Set/promotion groups stay together. Server numbering skips client reservations. No stock function is called during submission or confirmation, including promotion expansion.

## Rollout and verification

- Deploy the API and frontend together: `/sendorder` now returns a request, not a QT. Old clients may still split checkout according to their own old UI; refresh frontend caches during rollout.
- The new idempotent migration `create_pending_order.sql` is included in the startup allowlist. With `MARKETPLACE_AUTO_MIGRATE=0`, run it manually before serving this version. It adds only `marketplace_pending_order`, with indexes and unique request/QT reservation constraints; no ERP schema change.
- Existing QT/SO/INV records remain on their current history and cancellation paths. The new queue only includes 300 documents registered in the marketplace lifecycle table.
- Set a persistent `AUTH_TOKEN_SECRET` for deployment and log in again if an existing session predates server-issued tokens.
- Smoke test with an approved test customer: submit MPR, select master warehouse/shelf in `/admin/pending-orders`, confirm, verify employee `sale_code`, then verify ERP SO/INV processing in the target environment. Local fixture tests establish SQL/link compatibility but do not run the ERP application.
- Do not remove the lifecycle table on rollback. Returning to an older version would leave pending MPR requests inaccessible; finish those requests or roll forward with a fixed version.

## Automated tests

Backend: `node node_modules/jest/bin/jest.js --runInBand`.

Real PostgreSQL transactions: create a disposable **local** database named `samai_pending_test`, set `PENDING_TEST_DATABASE_URL`, then run `node node_modules/jest/bin/jest.js --runInBand tests/routes/pendingOrders.integration.test.js`. This suite resets that test database's public schema, loads a minimal ERP fixture and tests concurrent submit/confirm/cancel, rollback, master validation, sets/promotions, numbering, authorization and migration replay. It refuses remote hosts or any other database name. Never point it at production data.

Browser smoke test: start local Vite, make Playwright available, and run `node tests/e2e/pending-orders.cjs` from `MarketPlaceWeb`. Optional variables: `PENDING_UI_URL` (default localhost:5179), `PENDING_BROWSER_EXECUTABLE`, `PENDING_SCREENSHOT_DIR`. The test intercepts API calls and checks dependent master dropdowns, confirmation payload, rejection reason, mobile customer cancellation, zero-stock product ordering and pending checkout/cart cleanup without contacting ERP.
