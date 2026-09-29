# Lanboon Requirements

## Phase 1: Customer Login

- Customer login user can be `ar_customer.code` or `ar_customer.email`.
- Customer password must compare with `ar_customer.fax`. Do not use `country` as a temporary fallback.
- Add contact login:
  - user: `ar_contactor.telephone`
  - password: `ar_contactor.mobile`
  - parent customer comes from the contact row.
- When a contact places an order, preserve the contact code and write it to `ic_trans.remark_5` so staff can identify which contact ordered.
- Because `ic_trans.remark_5` may contain a contact code, customer-facing history/status screens must not display it as a tracking link unless the value is a real URL.

## Phase 2: Product Display And Admin Settings

Use `ic_inventory_detail.dimension_30` through `dimension_45` for per-product marketplace settings where a dedicated marketplace table is not introduced.

### Product Name Priority

- Use `ic_group.name_2` as the group-level default for which product name field should be displayed.
- Do not reuse `ic_group.name_2` for unrelated marketplace settings such as hidden detail fields.
- If a product belongs to a group and has no product-level name-display setting, display the product name according to the group's `ic_group.name_2`.
- If the product has its own name-display setting in `ic_inventory_detail` dimension, the product-level setting wins over the group.
- Store product-level name-display mode in a product dimension, for example `ic_inventory_detail.dimension_32`.
- Supported product name fields are `ic_inventory.name_1`, `ic_inventory.name_2`, `ic_inventory.name_eng_1`, and `ic_inventory.name_eng_2`.

### Detail Visibility

- Let admin hide selected product detail fields such as brand, size, volume, weight, category, model, and sales display.
- Prefer a product dimension such as `dimension_31` for hidden-field keys when implementing per-product settings.
- Group-level defaults may be implemented only if there is a clear non-conflicting storage rule; do not overload `ic_group.name_2` for hidden-field settings.

### Product Images And Video

- Check existing product detail image support before changing it. Multiple product images may already be supported.
- Add product video support through the existing media/content approach where possible.

### Sales Display

- Read unit-level sales display mode from `ic_inventory_barcode.price_member_3`:
  - `0`: show sales quantity
  - `1`: hide sales quantity
  - `2`: show popularity as stars
- Default star thresholds:
  - 1-100: 1 star
  - 101-500: 2 stars
  - 501-1000: 3 stars
  - 1001-5000: 4 stars
  - more than 5000: 5 stars
- Maximum popularity display is 5 stars.
- Store configurable star thresholds in an `ic_inventory_detail` dimension when adding admin settings.

### Unit Visibility

- Unit rows are tied by `ic_inventory_barcode.ic_code` and `ic_inventory_barcode.unit_code`.
- Read `ic_inventory_barcode.price_member_4` for online unit visibility.
- Treat value `1` as hidden from online sale/display; null or other values should remain visible unless a later requirement says otherwise.

## Phase 3: Sales Settings Admin

- Add a web admin menu named `จัดการตั้งค่าการขาย`.
- Admin permission code for the menu is `admin.salesSettings`.
- Frontend route is `/admin/sales-settings`; backend routes are implemented in `src/routes/salesSettings.js` under `/service/v1`.
- Stock display can be configured as a percentage of real stock. For example, real stock 500 and display percent 70 means web/customer-facing stock should be 350.
- Store stock display percent in marketplace settings storage. The current implementation uses `marketplace_sales_setting.setting_key = 'stock_display_percent'`.
- Customer-facing product list/detail stock and cart stock validation should use the display percentage, not full real stock.
- New products and recommended products should be configurable in web admin with active date ranges.
- The current implementation stores those rows in `marketplace_featured_product` with `feature_type` values:
  - `recommend`
  - `new`
- Active featured rows must have `status = 1` and match the current date between optional `from_date` and `to_date`.
- Document history mode is configured on the web and stored in `erp_option.wallet_bcel_mcid`.
- Supported document history modes:
  - `marketplace_only`: customer history sees only marketplace documents.
  - `all`: customer history sees all matching customer documents.

## Phase 4: Delivery Proof Images And Hidden Documents

- Delivery proof images come from `sml_doc_images`.
- `sml_doc_images.image_id` stores the document number.
- `sml_doc_images.image_file` is `bytea`.
- Customer document history and order history must hide `ic_trans` rows where `approve_code` is `0`.
- Document history should apply the approve filter to list, detail, and page summary totals.
- Order history should apply the approve filter to list, header, and item detail access checks.
- Show delivery proof images in document history or order history only for successful/completed records.
- For order history, prefer delivery proof images attached to the invoice document number when available; fall back to the marketplace quote/order document number.

## Phase 5: Preorder And Checkout UX

- Preorder should use the existing ERP quote/document tables. Do not add a new preorder table unless the user explicitly changes direction.
- Split normal available quantity and preorder shortage into separate QT documents when a cart has both:
  - available/ready items use the normal generated `doc_no`.
  - preorder items use a second generated `doc_no`.
  - preorder-only carts use one QT document.
  - Do not link preorder back with `ic_trans.doc_ref`; the user explicitly removed that requirement.
- Mark preorder documents with `PREORDER` in header/detail remark text so document history can label them.
- Keep contact login attribution in `ic_trans.remark_5`; do not overwrite it with preorder markers.
- Use `ic_inventory_detail.dimension_35` for product-level preorder mode:
  - `default`: follow sales setting default.
  - `1`: allow preorder for this product.
  - `0`: block preorder for this product.
- Use `marketplace_sales_setting.preorder_default_enabled` as the global default.
- Product-level `dimension_35` overrides the global default. A product set to `0` must stay blocked even when the global default is enabled.
- Product/card/detail/cart APIs should expose `preorder_allowed` so UI can block or split consistently.
- Non-preorder products must not allow order quantity above display stock. Preorder products may exceed display stock and should show ready vs preorder quantities.
- On checkout, validate both frontend and backend:
  - Reject missing or invalid `qty`, `item_code`, and `unit_code`.
  - Reject missing `cust_code`, `doc_no`, and `doc_date`.
  - Product-set child rows must also have valid `item_code`, `unit_code`, and `qty > 0`.
- For product-set child detail rows, line quantity is `parent.qty * child.qty_per_set`; child `sum_amount` must use `child.price * parent.qty * child.qty_per_set`.
- Backend `/service/v1/sendorder` should return JSON `{ success:false, msg, message }` for user-fixable validation errors so the checkout UI can show actionable text.
- Frontend cart/order quantity math should use `src/utils/preorderSplit.js` helpers such as `toOrderQty()` and `toStockQty()` instead of scattered `parseInt`/`parseFloat` for order quantities and stock guards.
- Checkout UX should keep errors visible on `StepConfirmation`, not only in transient toasts.
