# Preorder UI Verification

Date: 2026-07-01

## Captured Screens

1. `01-marketplace.png` - Marketplace product listing. Public page loaded with product cards and categories.
2. `02-product-detail-popup.png` - Product detail popup before interaction. Dialog opened from a product card.
3. `03-product-detail-preorder-qty.png` - Quantity set above ready stock before UI copy adjustment.
4. `04-after-improvements.png` - Quantity set above ready stock after improvement.

## Findings And Fixes

1. Product card accessibility: cards were clickable `div` elements without keyboard access. Added `role="button"`, `tabindex="0"`, `aria-label`, and Enter/Space handlers in `MarketPlaceWeb/src/components/catalog/ProductList.vue`.
2. Blocked preorder copy: when quantity exceeded ready stock and preorder was disabled, the cart button stayed disabled but still said add to cart. Changed the disabled label to `ปรับจำนวนก่อน` / `Adjust quantity first` / Lao equivalent in product and set dialogs.
3. Preorder preview: verified the popup shows ready quantity and blocked preorder message clearly when selected quantity is above ready stock for a non-preorder item.
4. Image loading: the first screenshot caught the product image before it visually stabilized. After waiting for the dialog state, the image loaded correctly in `04-after-improvements.png`.

## Limits

- Admin sales settings UI could not be fully browser-tested because the active browser session was not logged in as an employee. Reading employee passwords from the test DB was rejected for credential-safety reasons. Backend syntax and frontend build were still verified.

## Admin Retest With Provided Employee

Date: 2026-07-01

- Employee login API on local backend accepted the provided employee account and returned user `001`.
- The account returned `admin_permission_custom=true`, `is_superadmin=false`, and `admin_permissions=[]`. With the current permission design this means the employee is intentionally blocked from `/admin/sales-settings`.
- The production API configured in `MarketPlaceWeb/.env` returned `502 Bad Gateway` for both employee login and sales-settings endpoints during the test window, so the in-app admin UI could not complete against that API.
- The already-running local backend on port `47300` appears to be an older process: `/sales-settings` responds, but `/sales-settings/product-preorder-settings` returns `404` until the backend process is restarted with the latest code.
- Frontend permission compatibility was improved so `admin_permission_custom=false` removes the stored custom permission list and falls back to default access, while a deliberate custom empty permission list remains blocked.

## Admin Retest With SUPERADMIN

Date: 2026-07-01

- Production API configured by the active dev env (`https://nextstepapp2.iszai.com/`) returned `502 Bad Gateway` for employee login and `/sales-settings`.
- Started a local test stack with the latest backend on `47309` and frontend on `5174`, with the frontend API pointed to the local backend.
- Employee login API accepted `SUPERADMIN` and returned `is_superadmin=true` with `admin.salesSettings` permission.
- Browser login in employee mode redirected successfully to `/admin/sales-settings`.
- Admin sales settings UI loaded stock display percent `70`, document history mode `marketplace_only`, preorder default disabled, product preorder rows, and the existing featured product `01-0004`.
- No browser console errors were observed after the admin page data finished loading.
- Screenshot: `05-admin-sales-settings-superadmin.png`.

## Admin Sales Settings UX Hardening

Date: 2026-07-01

- Added accessible labels to icon-only buttons on the sales settings admin screen so browser/assistive tech no longer exposes them as icon glyphs only.
- Changed featured-product deletion to require a confirmation dialog before calling the delete API.
- Changed product-level preorder save to update `ic_inventory_detail.dimension_35` first, then insert when missing, instead of relying on `ON CONFLICT (ic_code)`.
- Validation passed: `node --check src/routes/salesSettings.js`, `node --check src/index.js`, `node --check src/utils/marketplaceSalesSettings.js`, and `cmd.exe /d /c npm.cmd run build`.
- Verified against the test DB with a temporary latest backend: POST `/service/v1/sales-settings/product-preorder-settings` for item `01-0004` returned `success=true`.
- Browser automation became unresponsive during the final post-change DOM snapshot, so the final UI confirmation was verified by source/build evidence rather than a fresh screenshot.

## Cart UX Hardening

Date: 2026-07-01

- Reviewed the cart quantity controls used after preorder split calculation.
- Added accessible labels to icon-only controls in `StepCart.vue`: clear search, search, product-set expand/collapse, quantity minus/plus, quantity input, and pagination.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## SUPERADMIN Local Backend Verification

Date: 2026-07-01

- Verified the provided SUPERADMIN employee credential against the latest local backend on port `47309`.
- Login returned `success=true`, `is_superadmin=true`, and included `admin.salesSettings`.
- `/service/v1/sales-settings` returned `success=true` with existing featured-product and product-preorder settings.
- Backend validation passed: `node --check src/routes/salesSettings.js`, `node --check src/utils/marketplaceSalesSettings.js`, and `node --check src/index.js`.
- In-app browser automation timed out while inspecting the current login page, so this pass used direct local endpoint verification plus build/source checks.

## Product Dialog UX Hardening

Date: 2026-07-01

- Added translated accessible labels for product quantity increase/decrease controls in Thai, English, and Lao.
- Applied the labels to product detail and product set quantity stepper buttons.
- Added explicit `type="button"` to product detail unit, share, favorite, and detail-page buttons to prevent accidental form-submit behavior if these controls are embedded inside a form later.
- Removed normal-flow debug `console.log` output from product infinite scroll and cart stock-issue validation.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Catalog Control State Hardening

Date: 2026-07-01

- Added `aria-pressed` state to catalog favorite filter, in-stock filter, compact category chips, and product unit selectors.
- Replaced the clickable clear-search icon in the catalog search field with a real button that has an accessible label and visible focus/hover state.
- Added `aria-expanded` to the product description read-more control.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Sales Settings Form Hardening

Date: 2026-07-01

- Connected the stock display percent label, validation message, and input control through `inputId`, `for`, `aria-invalid`, and `aria-describedby`.
- Added explicit accessible names to admin search fields, product selectors, feature type/status selectors, note field, and preorder mode selector.
- Added validation state linkage for featured-product date and display-order inputs.
- Made table row edit/delete actions announce the specific product code instead of a generic action label.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## History And Shipping Detail Hardening

Date: 2026-07-01

- Added accessible labels to document-history search, document-type, and date-range filters.
- Added accessible labels to order/shipping detail item search, clear-search, search, and detail pagination icon buttons.
- Added `aria-expanded` and action labels to product-set expand/collapse buttons in order and shipping detail dialogs.
- Removed a normal-flow debug `console.log` from multi-order payment selection.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Login And Profile Form Hardening

Date: 2026-07-01

- Removed normal-flow debug `console.log` output from customer cart loading and customer/employee search in the login flow.
- Added accessible names to customer and employee selection dropdowns.
- Made login errors announce with `role="alert"` and `aria-live="assertive"`.
- Reworked customer profile fields to use explicit label/input links, autocomplete hints, and inline validation feedback for required name and password mismatch/length errors.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin List And Recommended Products Hardening

Date: 2026-07-01

- Removed normal-flow debug `console.log` output from recommended-products auto-scroll and load-more behavior.
- Added accessible names to admin product search, edit, and mobile pagination icon buttons.
- Added accessible names and selected state to admin customer search, customer row selection, and pagination icon buttons.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## SUPERADMIN Browser Admin Settings Check

Date: 2026-07-01

- Verified the in-app browser is authenticated into `/admin/sales-settings` with the provided SUPERADMIN credential context.
- The page title is `จัดการตั้งค่าการขาย - Lanboon Kitchenware`.
- The visible UI includes `จัดการตั้งค่าการขาย`, `Preorder`, and `บันทึกตั้งค่าทั่วไป`.
- No visible page alert/error message was present during the check.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Checkout And Mini Cart UX Hardening

Date: 2026-07-01

- Added accessible names to checkout confirmation search, clear-search, product-set expand/collapse, and pagination icon buttons.
- Added Thai, English, and Lao labels for product-set expand/collapse actions in the review-order translations.
- Added accessible names to the mini-cart trigger and remove-item buttons.
- Prevented the mini-cart remove button from also activating the surrounding product link by calling `preventDefault()` before removing the item.
- Added accessible names to floating theme/configurator icon buttons.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Product Edit Action Hardening

Date: 2026-07-01

- Added reusable action-label helpers for product edit rows so table/mobile actions announce the affected product, unit, price rule, discount rule, or barcode.
- Added accessible names to icon-only actions in admin product edit: back, delete image, upload video, related products, price formulas, sale prices, discounts, unit use, barcode edit/delete, and barcode pagination.
- Added selected-state announcements to sale-price and discount type tabs through `aria-pressed`.
- Added an accessible name to the barcode/unit search input.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Inventory Permissions Participation Category Hardening

Date: 2026-07-01

- Added accessible names to admin inventory warehouse/shelf selects, product search, barcode search, stock-adjust input, and back-to-search action.
- Made inventory search-result rows keyboard reachable with `role="button"`, `tabindex="0"`, and Enter/Space activation.
- Added accessible names and selected-state announcements to admin permission employee rows and permission cards.
- Added accessible names to admin participation back, refresh, search, and product join/remove row actions.
- Added accessible names and selected-state announcements to admin category search and category row selection.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Catalog And Product Detail UX Hardening

Date: 2026-07-01

- Added `type="button"`, accessible names, and selected-state announcements to desktop/mobile category scroll and category selection buttons.
- Fixed category resize listener cleanup by registering and removing the same `handleResize` function reference.
- Added accessible names to catalog favorite/in-stock filters and the product search input.
- Added `type="button"`, accessible names, and selected-state announcements to product detail share/favorite, unit selection, quantity controls, add-to-cart/login, and related-product cards.
- Added `productDetail.selectUnit` translations in Thai, English, and Lao, and replaced the hardcoded close label with the localized product-detail close label.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Product Dialog And SUPERADMIN Smoke Check

Date: 2026-07-01

- Converted product and product-set dialog share overlay actions from clickable `div` rows into real buttons with accessible names.
- Added selected-state announcements to product dialog favorite controls and unit selectors.
- Added accessible labels to product dialog unit selection, full-detail, quantity, and inline-login actions.
- Verified employee admin login with `SUPERADMIN / 0` and confirmed redirect to `/admin/sales-settings`.
- Browser console error check passed on `/admin/sales-settings`.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Marketplace Strip And Order History Action Hardening

Date: 2026-07-01

- Made recommended-product cards keyboard reachable with `role="button"`, `tabindex="0"`, and Enter/Space activation.
- Replaced the generic recommended-product favorite label with localized add/remove favorite labels and selected-state announcements.
- Added a concrete remove-item label and explicit `type="button"` to the topbar mini-cart remove action.
- Added explicit button types to promotion carousel navigation and order-history status/action buttons.
- Added selected-state announcements to order-history status tabs and multi-select order actions, plus an accessible name for the order-history search input.
- Added accessible labels and selected-state announcements to layout configurator color swatches and labels to its preset/menu-mode selectors.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.
- Browser smoke passed on `/marketplace`: recommended cards/favorite controls/promo navigation rendered with the expected attributes and no console errors.
- Browser smoke reached the employee login/customer-selection guard for `/orders-history` with `SUPERADMIN / 0`; no console errors were present. The order-history page itself remains gated until a customer is selected.

## Admin Content And Product Edit Form Hardening

Date: 2026-07-01

- Added accessible names to homepage layout drag handles and move up/down controls.
- Added selected-state announcements to homepage theme presets and category/product picker chips.
- Added accessible names to hero slide, promo banner, product section, and media library edit/delete actions so icon-only controls identify the affected item.
- Added accessible names to theme color picker/hex inputs, product picker search, media picker cards, and rename-media input.
- Added accessible names to admin product create fields and key product-edit fields for names, units, marketplace display settings, preorder mode, barcodes, unit-use, sale-price, discount, and formula dialogs.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Cart Checkout And SUPERADMIN Admin Retest

Date: 2026-07-01

- Retested employee login with `SUPERADMIN / 0`; login reached the employee customer-selection screen, then `/admin/sales-settings` loaded with the title `จัดการตั้งค่าการขาย - Lanboon Kitchenware`.
- Confirmed the dev server returns `200` for `/admin/sales-settings`; the browser bridge timed out while reading the full admin DOM, so visual DOM details were not used as evidence in this pass.
- Converted customer and employee checkout delivery-method cards from clickable `div` rows into real `type="button"` controls with selected-state announcements.
- Added keyboard activation and radio state announcements to checkout address-choice cards.
- Added accessible labels to checkout employee selection, readonly delivery/credit fields, advance-payment selectors, and checkout pagination page buttons.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Login Selection And Profile Guard Hardening

Date: 2026-07-01

- Added in-progress guards and loading/disabled states to customer and employee selection actions on the login screen to prevent duplicate selection while cart/session handoff is running.
- Connected login customer/employee selects and password input to their visible labels through stable input ids.
- Added profile reload/save early returns so load and save requests cannot overlap.
- Disabled profile save until required customer data is present, validation passes, and no load/save operation is active.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Order History Action Guard Hardening

Date: 2026-07-01

- Added a shared busy state for order-history actions so cancel, QR payment, selection, details, and buy-again buttons do not overlap with page loading, detail loading, reorder, or payment work.
- Replaced inline status-tab fetch handlers with a guarded status-filter helper that ignores duplicate tab clicks and clicks while the order list is loading.
- Disabled order status tabs during list refresh and added disabled styling so users see the list is busy.
- Added guards to order-detail opening and cancel confirmation so empty/stale order actions cannot fire.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Shipping Status Action Guard Hardening

Date: 2026-07-01

- Added a shared busy state for shipping-status actions so multi-select, payment, detail loading, and QR dialog work do not overlap.
- Added guards to shipping detail loading, detail search, QR payment, multi-select toggles, select-all, and pay-selected actions.
- Disabled shipping action buttons, checkboxes, detail search controls, QR regenerate/download/cancel controls, and filter retry/clear actions while their relevant work is active.
- Added an accessible label to the shipping search field and selected-state announcements to multi-select order actions.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Sales Settings Action Guard Hardening

Date: 2026-07-01

- Verified employee admin login with `SUPERADMIN / 0`; login redirected to `/admin/sales-settings`.
- Added busy-state and early-return guards to sales-settings load, save, search, preorder, featured-product, and delete actions so admin clicks cannot overlap.
- Disabled settings, preorder, featured-product, and row action controls while their corresponding load/save/delete operations are active.
- Kept internal refreshes after save/delete working by allowing forced preorder reloads and featured-product reloads inside save/delete flows.
- Found environment issue during browser smoke: the dev frontend is using `VITE_APP_API=https://nextstepapp2.iszai.com/`, and that API currently returns `404` for `/service/v1/sales-settings/product-preorder-settings`; the local source has this route and `node --check src/routes/salesSettings.js` passed.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Sales Settings Preorder Endpoint Fallback

Date: 2026-07-01

- Changed the product-preorder settings loader so a missing preorder endpoint (`404`) no longer shows a disruptive error toast on page load.
- Added an inline status note in the preorder section explaining that product-level Preorder settings are not available on the current API, while general settings and featured products remain usable.
- Disabled product-level preorder search/select/save controls when the endpoint is unavailable, while leaving refresh/search actions available to retry after the API is deployed.
- Browser smoke passed on `/admin/sales-settings`: the inline unavailable note appears, the old preorder error toast is absent, affected controls are disabled, and browser console errors are empty.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Products List And Create Guard Hardening

Date: 2026-07-01

- Added stale-response protection to the admin product list loader so older search/page/sort responses cannot overwrite newer results.
- Disabled search/edit/pagination controls while the product list is loading to prevent accidental overlapping actions.
- Guarded the create-product dialog against duplicate submits and accidental close/navigation while creation is in progress.
- Disabled create-product fields during save and disabled the save action until product code, name, and standard unit are valid.
- Browser smoke passed on `/admin/products`: the create dialog opens, the save-and-edit action is disabled while required fields are empty, the dialog closes cleanly, and browser console errors are empty.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Customers Action Guard Hardening

Date: 2026-07-01

- Added stale-response protection to the admin customer list loader so older search/page responses cannot overwrite newer results.
- Disabled list, search, pagination, generate-code, delete, and form controls while their related load/save/delete actions are active.
- Guarded duplicate save/delete/generate/select/new-customer actions and kept internal post-save/post-delete resets working with an explicit forced reset.
- Added the missing `common.clear` translation key for Thai, English, and Lao so the customer search clear button no longer renders the raw key.
- Browser smoke passed on `/admin/customers` after employee login with `SUPERADMIN / 0`: the page loads real customer rows, the clear button is translated, the empty new-customer save action is disabled, and browser console errors are empty.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Product Participation Action Guard Hardening

Date: 2026-07-01

- Added a page-level busy state for marketplace participation so reload, search, navigation, infinite-scroll loading, and product toggle actions do not overlap.
- Added request sequencing to the participation list loader and stale-response checks to both full reload and side-specific load-more calls.
- Captured search text and cursor values at request start so late responses cannot merge rows from an older query or cursor into the current list.
- Disabled search, refresh, back navigation, and both side's product row actions while the participation page is loading or updating a product.
- Browser smoke passed on `/admin/product-participation`: real product rows render on both sides, search/reload controls are enabled at idle, a search refresh returns to a usable state, and browser console errors are empty.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Categories Action Guard Hardening

Date: 2026-07-01

- Added delete/upload states, a shared category busy state, and save validation so category actions cannot overlap while loading, saving, deleting, or uploading.
- Added request sequencing to the category loader so older category-list responses cannot overwrite newer results.
- Disabled list selection, search, reload, add-new, delete, form fields, upload, clear-image, cancel, and save controls while their related work is active.
- Kept post-save and post-delete list refreshes working through an explicit forced reload, while user-triggered duplicate loads are ignored.
- Fixed an initial-load guard regression found during browser smoke by starting `loading` as false so `onMounted(loadCategories)` can actually fetch data.
- Browser smoke passed on `/admin/categories`: the page loads real category rows, the empty new-category save action is disabled, idle search/reload/add controls are enabled, and browser console errors are empty.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Permissions Action Guard Hardening

Date: 2026-07-01

- Added shared permission busy state so employee search, employee selection, permission loading, and permission saving cannot overlap.
- Added request sequencing to employee search and permission loading so older responses cannot overwrite the current employee list or selected employee's permission state.
- Disabled employee search, employee rows, back navigation, select-all, permission cards, and save while permission work is active.
- Guarded permission toggles, select-all, employee selection, and save actions against stale/disabled states.
- Browser smoke passed on `/admin/permissions`: employee rows load, the empty editor keeps save unavailable before selecting an employee, selecting a normal employee loads permission cards, edit/save controls become available, and browser console errors are empty.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Inventory Action Guard Hardening

Date: 2026-07-01

- Added request sequencing to warehouse, shelf, product search, product detail, and balance loads so older responses cannot overwrite the latest selected product/location state.
- Added page and action busy states to disable navigation, location selects, search fields, barcode search, back-to-search, adjust buttons, and dialog controls while related work is active.
- Guarded duplicate product selection, barcode search, clear selection, open adjust, and stock adjust submit actions.
- Kept the post-adjust stock refresh path working through an explicit forced product-detail refresh, while user-triggered duplicate actions remain blocked.
- Browser smoke passed on `/admin/inventory`: product search returns real rows, selecting a product loads unit balances, adjust buttons stay disabled until warehouse and shelf are selected, selecting `` / `` enables adjust, the adjust dialog opens with the current quantity, Cancel closes it, no stock save was submitted, and browser console errors are empty.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.

## Admin Sales Settings UX Restructure

Date: 2026-07-01

- Added a summary strip for current sales settings so admins can confirm stock percent, document-history scope, preorder default, and featured-product count before editing.
- Split the page into three task tabs: general settings, product preorder, and featured products.
- Reworked product preorder into a split view with search/filter/table on the left and the selected product editor on the right.
- Added preorder status filter chips with counts and selected-row highlighting so admins can quickly find and edit the correct product.
- Kept featured-product management in its own tab and preserved its existing save/delete behavior.
- Browser smoke passed on `/admin/sales-settings`: tabs switch correctly, preorder split view renders with 80 rows in an internal scroll area, selecting a row updates the editor panel, filter chips show expected empty/default states, featured tab remains usable, mobile 390px layout stacks cleanly without body horizontal overflow, and browser console errors are empty.
- Validation passed: `cmd.exe /d /c npm.cmd run build`.
