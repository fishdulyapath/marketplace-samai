# MPR-first order history

All paths below are under `/service/v1`. No ERP schema or historical document rewrite is required.

## Read interfaces

- `GET /getOrderHistory?view=mpr`: customer identity comes from the verified Bearer token. Employees need `admin.orders` and must specify `cust_code`.
- `GET /admin/orders?view=mpr`: verified employee with `admin.orders`, across customers. Defaults to the existing seven-day date range. The staff UI opens on All statuses.
- Both lists accept `search`, `date_from`, `date_to`, `status`, `page`, `page_size` (1–200). MPR/QT number, customer and original product search apply before pagination. Date filtering/sorting use the MPR date; legacy groups remain intact. `total_orders`, `page_amount`, and `status_counts` count logical orders, not QTs.
- `GET /getOrderHeader?view=mpr&doc_no=...`: MPR or a linked QT alias resolves to the same MPR header. Ownership is verified.
- `GET /getOrderDetail?view=mpr&doc_no=...`: original MPR roots and original set `sub_item` only. `q`, `page`, `page_size` (1–100) paginate roots. Never exposes lifecycle metadata or physical allocation products to customers.
- `GET /admin/orders/:orderNo/items`: employee-only details with `qt_allocations` under each MPR root and `unmapped_items` for QT roots which cannot be safely linked. Legacy QTs require `cust_code` and delegate to the existing detail reader.
- Calls without `view=mpr` retain the old API behavior. The dedicated pending allocation queue is unchanged.

## Identity and projection

`doc_no` is the displayed MPR number for `order_kind=mpr`; `mpr_doc_no`, `qt_main_doc_no`, `qt_doc_nos`, `request_status`, `reason`, and `can_cancel` are separate fields. Original dates, quantities, prices, tax and totals come from the persisted 300 snapshot. MPRs stay visible after confirmation; linked QTs never become separate cards, including when the QT date falls outside the MPR date filter. Legacy unlinked quotations have `order_kind=legacy_qt` and keep their original number/products.

Matching uses lifecycle `metadata.confirmed_allocations` source line number and QT document/line number, verifying the saved item codes. Identical products in different units or repeated lines are not merged. No lookup against current `name_eng_2` is used to reconstruct history. Missing mappings or ERP line replacement stay unmapped for staff rather than guessed. Actual QT set components remain nested under their allocation and are not counted again as order roots.

## Status and actions

- Request pending → `awaiting_confirmation`; closed without QT → `cancelled`/`rejected` plus reason.
- Confirmed MPR → existing QT/SO/INV grouped status, mixed progress and partial cancellation fields. MPR `last_status=1` is not a delivery status.
- `progress_status`, `ship_state`, and `shipped_qty` use mapped physical allocations. Ambiguous partial SO quantities shared by repeated physical lines return `ship_state=unknown` and `shipped_qty=null` rather than inventing a per-line distribution.
- Pending cancellation uses `/pending-orders/:mpr/cancel`. Confirmed cancellation passes `qt_main_doc_no` to the unchanged QT/SOC cancellation API. Server-side transaction validation remains authoritative.
- Reorder reads MPR products and rechecks current product pricing through the existing cart flow.
- `payment_documents` lists real outstanding invoice numbers/dates/amounts, de-duplicated by invoice; payment never uses the MPR snapshot as the amount to collect. Delivery image references retain their actual ERP document numbers.
- Insufficient stock remains advisory in allocation/confirmation. Completion of all allocation lines is still required before review.

## Verification

Backend unit/API tests: `tests/utils/mprOrderHistory.test.js`, `tests/routes/mprOrderHistory.test.js`.
Real PostgreSQL contract: `tests/routes/mprOrderHistory.integration.test.js`. Requires `PENDING_TEST_DATABASE_URL` pointing only at localhost database `samai_pending_test`; its public schema is disposable. Never run this against demo or production.
Frontend payment/key tests: `MarketPlaceWeb/tests/mprOrderHistory.test.js`.
Interactive development-only preview: `/tests/e2e/mpr-history-preview.html` on isolated localhost port 5188. Services are replaced with fixtures; no ERP calls or real payments.
