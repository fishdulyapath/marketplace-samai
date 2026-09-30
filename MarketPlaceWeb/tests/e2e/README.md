# Pending-order workspace checks

Start Vite from `MarketPlaceWeb` with a localhost API base for the mocked route tests:

```powershell
$env:VITE_APP_API='http://127.0.0.1:5179/'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5179 --strictPort
```

With Playwright available (locally or through `NODE_PATH`), run:

```powershell
node tests/e2e/pending-orders.cjs
node tests/e2e/workspace.cjs
node tests/e2e/workspace-speed.cjs
node tests/e2e/workspace-benchmark.cjs
```

Optional variables: `PENDING_BROWSER_EXECUTABLE`, `PENDING_UI_URL` (localhost only), and `PENDING_SCREENSHOT_DIR`.

- `pending-orders.cjs`: actual application routes with intercepted API responses. Covers confirm/reject/customer cancel, zero-stock checkout, desktop/mobile splits, HTTP 422 shortage details and retained allocations, HTTP 503 stock failures and retry after recovery, master retry, and a 409 concurrent cancellation.
- `workspace.cjs`: multi-document, multi-line visual fixture at 1360, 820 and 390 pixels. Covers retained drafts, product-set restrictions, progress, review/back, manual request selection after confirmation/rejection and horizontal overflow. Successful actions refresh the queue but never open the next request automatically.
- `workspace-speed.cjs`: quick product/location picker, keyboard Enter safety, remaining quantity, selected-line bulk assignment without overwriting existing locations, collapse/filters, risk-focused review, refresh-safe drafts, employee isolation, changed-master validation and terminal-state draft cleanup at all three widths.
- `workspace-benchmark.cjs`: controlled comparison of manual versus bulk location assignment for 5/20/50 lines. Does not create QT documents.
- `/tests/e2e/workspace-preview.html`: interactive development-only fixture with an explicit simulated-data banner. Service methods are replaced in this isolated entry; it never connects to ERP. This HTML is not a production build entry.

The staff page uses a queue and inline allocation workspace. Customer history remains on the existing `PendingOrders` component. Drafts persist in browser localStorage for seven days, scoped to API destination and employee code. Only source fingerprint and allocation fields are stored, not contact details or credentials. Reopening reads the current document/status first, discards stale fingerprints, and revalidates products and locations. Shelf requests are shared within one open document and discarded on reopen. Storage failures retain in-memory edits and show a warning before leaving. Confirmation remains server-authoritative and requires sufficient fresh physical stock; shortage/read errors retain the draft for correction or retry. Drafts do not reserve stock or change prices. Local drafts are not encrypted server storage and do not synchronize between devices.

## Controlled benchmark (2026-09-30)

Same warehouse/shelf for every line, after opening the document, desktop Chromium with local fixtures. Manual means four clicks per line (warehouse dropdown/option, shelf dropdown/option); bulk means six clicks total. Results are UI-automation timing, **not employee productivity or live ERP performance**.

| Lines | Manual clicks | Bulk clicks | Manual seconds | Bulk seconds |
| --- | ---: | ---: | ---: | ---: |
| 5 | 20 | 6 | 2.060 | 0.545 |
| 20 | 80 | 6 | 10.063 | 0.762 |
| 50 | 200 | 6 | 32.792 | 1.885 |

For real staff acceptance, time 5/20/50-line requests with mixed products, splits, sets and shortages. Record completion time, clicks, corrections, wrong code/location, and accidental confirmation. Target at least 30% less time without more errors before assigning a 9.5–10 usability score. Bulk speed applies only when staff explicitly choose a shared location; mixed allocations still need individual decisions.

These browser checks do not validate the external ERP desktop SO/invoice flow or live database transactions.
