# Backend Guide

## Run and validate

Work from `MarketPlaceWebServiceExpress`.

```powershell
npm run dev
npm start
node --check src/index.js
node --check src/routes/product.js
```

Use `node --check` on every touched backend `.js` file because this repo has no dedicated test script in `package.json`.

## Route mounting

`src/index.js` mounts all API routers under `/service/v1`, except:

- `/health`: health check.
- `/api-docs`: Swagger UI from `docs/api/openapi.yaml`.
- `/media`: static serving from `mediaRoutes.MEDIA_DIR`.

License routes and `licenseMiddleware` are mounted before the business routes. If an endpoint appears blocked, inspect `src/license.js` before changing the route.

## Database rules

- Use `query(sql, params)` for read/simple single-statement operations.
- Use `withTransaction(async (client) => { ... })` for mutations that touch multiple rows or tables.
- Keep all SQL parameterized with `$1`, `$2`, etc.
- `db.js` opens two pools:
  - main DB: `DB_NAME`, default `demo`.
  - image DB: `DB_IMAGES_NAME`, default `demo_images`.
- Pool connections run `SET enable_seqscan = false`; preserve this unless the user explicitly wants database tuning changes.

## Important environment variables

- Core DB: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_IMAGES_NAME`.
- Runtime: `PORT`, `MARKETPLACE_ENV`.
- Data directories: `MARKETPLACE_DATA_DIR`, `MARKETPLACE_CONTENT_DIR`, `MARKETPLACE_MEDIA_DIR`.
- Public media URL: `MARKETPLACE_PUBLIC_URL`.
- Content scoping: `MARKETPLACE_CONTENT_SCOPE`, `MARKETPLACE_SITE_NAME`.
- License: `MARKETPLACE_LICENSE_ENABLED`, `MARKETPLACE_LICENSE_KEY`, `MARKETPLACE_LICENSE_DB_*`, `MARKETPLACE_LICENSE_CHECK_INTERVAL_HOURS`, `MARKETPLACE_LICENSE_GRACE_HOURS`.

## Response and compatibility rules

- Preserve existing response shapes used by frontend service classes.
- Check `src/utils/response.js` before introducing new helper patterns.
- Keep intentional SML/ERP business behavior intact, especially price, VAT, stock, document, and product-set rules.
- `src/utils/priceHelper.js` contains cascading price logic ported from the original system. Do not simplify it casually.

## Feature areas

- Cart checkout flows often span:
  - frontend `src/stores/cartStore.js`
  - frontend `src/services/CartService.js`
  - backend `src/routes/cart.js`
  - backend `src/routes/order.js`
  - Also read `references/requirements.md` Phase 5 before changing `/sendorder`, preorder splitting, product-set detail rows, or checkout validation.
- Sales settings spans:
  - frontend `src/views/pages/admin/AdminSalesSettings.vue`
  - frontend `src/services/SalesSettingsService.js`
  - backend `src/routes/salesSettings.js`
  - backend `src/utils/marketplaceSalesSettings.js`
- Product management spans:
  - frontend `src/views/pages/admin/AdminProducts.vue`
  - frontend `src/views/pages/admin/AdminProductEdit.vue`
  - frontend `src/services/productManageService.js`
  - backend `src/routes/product.js`
- Content/media admin spans:
  - frontend `src/views/pages/admin/AdminContent.vue`
  - frontend `src/services/ContentService.js`
  - frontend `src/services/MediaService.js`
  - backend `src/routes/content.js`
  - backend `src/routes/media.js`

## Documentation updates

Update `docs/api/openapi.yaml` and the relevant `docs/api/phase-*.md` only when the request/response contract changes or the user asks for API docs.

## Order API guardrails

- `/service/v1/sendorder` writes QT documents to `ic_trans` and `ic_trans_detail`; keep document-save changes compatible with SML ERP behavior.
- Contact login attribution is stored in `ic_trans.remark_5`; do not reuse this field for preorder markers or customer-visible tracking text without URL validation.
- Use JSON error responses for user-fixable validation failures: `{ success:false, msg, message }`.
- Validate required header fields (`doc_no`, `doc_date`, `cust_code`) and item fields (`item_code`, `unit_code`, positive `qty`) before entering the transaction.
- Validate product-set child rows as well; do not allow incomplete child items to reach `ic_trans_detail`.
