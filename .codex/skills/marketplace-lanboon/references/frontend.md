# Frontend Guide

## Run and validate

Work from `MarketPlaceWeb`.

```powershell
npm run dev
npm run build
npm run lint
```

`npm run lint` runs ESLint with `--fix`; mention this if it modifies files.

## Architecture

- Vue 3 Composition API is used throughout the app.
- PrimeVue is the main component library; component auto-import is configured in `vite.config.mjs`.
- Pinia stores live in `src/stores`.
- Axios service wrappers live in `src/services`.
- Shared Axios factory lives in `src/api/http.js`.
- Router and access guards live in `src/router/index.js`.

## Environment variables

Do not hard-code deployment hosts in app code. Prefer existing env variables:

- `VITE_APP_API`: API base URL consumed by services.
- `VITE_APP_BASE_URL`: router history base and preview/admin links.
- `VITE_APP_NAME`, `VITE_APP_COMPANY_NAME`, `VITE_APP_LOGO`, `VITE_APP_ADDRESS`, `VITE_APP_PHONE`, `VITE_APP_LINE_URL`: branding/contact display.
- `VITE_MARKETPLACE_SALE_TYPE`: ERP sale type option.
- `VITE_APP_BRANCH_CODE`: inventory/admin default branch.

Some service files still contain fallback IPs. Avoid adding new fallbacks.

## Main routes and files

- `/`: `src/views/pages/Landing.vue`.
- `/marketplace`: `src/views/pages/Catalog.vue`.
- `/product/:id`, `/product-detail/:id`: `src/views/pages/ProductDetail.vue`.
- `/cart`: `src/views/pages/CartView.vue`.
- `/orders-history`: `src/views/pages/OrderHistory.vue`.
- `/doc-history`: `src/views/pages/DocHistory.vue`.
- `/order-shipping-status`: `src/views/pages/OrderShippingStatus.vue`.
- `/advance-payment-history`: `src/views/pages/AdvancePayment.vue`.
- `/profile`: `src/views/pages/CustomerProfile.vue`.
- `/admin`: `src/views/pages/admin/AdminMenu.vue`.
- `/admin/content`: `src/views/pages/admin/AdminContent.vue`.
- `/admin/categories`: `src/views/pages/admin/AdminCategories.vue`.
- `/admin/customers`: `src/views/pages/admin/AdminCustomers.vue`.
- `/admin/inventory`: `src/views/pages/admin/AdminInventory.vue`.
- `/admin/products`: `src/views/pages/admin/AdminProducts.vue`.
- `/admin/product-participation`: `src/views/pages/admin/AdminProductParticipation.vue`.
- `/admin/products/:code`: `src/views/pages/admin/AdminProductEdit.vue`.
- `/admin/sales-settings`: `src/views/pages/admin/AdminSalesSettings.vue`.
- `/admin/permissions`: `src/views/pages/admin/AdminPermissions.vue`.
- `/auth/login`: `src/views/pages/auth/Login.vue`.

## Common file clusters

- Cart/checkout:
  - `src/stores/cartStore.js`
  - `src/services/CartService.js`
  - `src/components/cart/StepCart.vue`
  - `src/components/cart/StepConfirmation.vue`
  - `src/components/cart/StepComplete.vue`
  - `src/views/pages/CartView.vue`
  - Also read `references/requirements.md` Phase 5 before changing preorder, stock guards, quantity math, checkout errors, or QT split behavior.
- Catalog/product detail:
  - `src/components/catalog/ProductList.vue`
  - `src/components/catalog/CategorySelection.vue`
  - `src/views/pages/ProductDetail.vue`
  - `src/views/pages/ProductSetDialog.vue`
  - `src/services/ProductService.js`
- Admin product/customer/content:
  - `src/views/pages/admin/*`
  - `src/services/productManageService.js`
  - `src/services/CustomerService.js`
  - `src/services/ContentService.js`
  - `src/services/MediaService.js`
- Auth and permissions:
  - `src/stores/authen.js`
  - `src/services/UserService.js`
  - `src/services/AdminPermissionService.js`
  - `src/utils/adminPermissions.js`

## UI conventions

- Match the existing PrimeVue + Tailwind/Sass look instead of introducing a new design system.
- Keep pages usable on narrow screens; many existing files are large and dense, so make scoped edits.
- Prefer service/store updates over direct Axios calls inside views unless the existing local pattern already does so.
- For cart and product-detail quantity handling, prefer shared helpers from `src/utils/preorderSplit.js` (`toOrderQty`, `toStockQty`, `getPreorderSplit`) so product detail, cart, confirmation, and store agree on stock/preorder behavior.
- Show checkout failures as persistent page errors in `StepConfirmation` when they require user action; do not rely only on toast notifications.
- Do not show `ic_trans.remark_5` directly as a customer-facing tracking link unless it is a real URL (`http://`, `https://`, or `www.`). Contact login stores contact attribution in this field.
