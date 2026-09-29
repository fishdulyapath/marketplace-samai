# Project Map

## Repository layout

- `MarketPlaceWeb/`: customer marketplace frontend.
- `MarketPlaceWebServiceExpress/`: Express backend that serves `/service/v1` APIs and `/api-docs`.
- `docker-deploy/`: deployment compose, nginx config, SQL bootstrap, and PowerShell scripts.
- `banner/`: project assets outside the application source.

## Frontend stack

- Vue 3, Vite 5, PrimeVue 4, Pinia, Vue Router, Axios, Tailwind/Sass.
- Important entry files:
  - `MarketPlaceWeb/src/main.js`: app setup, PrimeVue, router, Pinia.
  - `MarketPlaceWeb/src/router/index.js`: routes and auth/admin guards.
  - `MarketPlaceWeb/src/api/http.js`: shared Axios factory using `VITE_APP_API`.
  - `MarketPlaceWeb/vite.config.mjs`: Vue plugin, PrimeVue component auto-import, `@` alias.

## Backend stack

- Node.js plain JavaScript, Express 4, PostgreSQL via `pg`, `sharp`, Swagger UI, `js-yaml`.
- Important entry files:
  - `MarketPlaceWebServiceExpress/src/index.js`: app bootstrap, CORS, parsers, route mounting, `/health`.
  - `MarketPlaceWebServiceExpress/src/db.js`: main and image database pools plus `withTransaction()`.
  - `MarketPlaceWebServiceExpress/src/loadEnv.js`: environment loading.
  - `MarketPlaceWebServiceExpress/src/license.js`: license middleware and license status endpoints.

## Route areas

- Auth: `src/routes/auth.js`.
- Product/catalog/admin product management: `src/routes/product.js`.
- Cart: `src/routes/cart.js`.
- Basket/session cart helpers: `src/routes/basket.js`.
- Orders/payment/cancel/history: `src/routes/order.js`.
- POS/sale document save/dashboard/master lists: `src/routes/pos.js`.
- Customers/admin customer management: `src/routes/customer.js`.
- Financial: `src/routes/financial.js`.
- Documents/receipts/company profile: `src/routes/document.js`.
- Favorites/images: `src/routes/favorite.js`, `src/routes/image.js`.
- Home content and media uploads: `src/routes/content.js`, `src/routes/media.js`.
- Admin permissions: `src/routes/adminPermission.js`.
- Tiger integration: `src/routes/tiger.js`.

## Documentation already in repo

- `MarketPlaceWebServiceExpress/CLAUDE.md`: backend-oriented project guide.
- `MarketPlaceWebServiceExpress/docs/api/README.md`: API endpoint index.
- `MarketPlaceWebServiceExpress/docs/api/openapi.yaml`: Swagger source loaded by `/api-docs`.
- `MarketPlaceWebServiceExpress/docs/license-subscription.md`: license behavior.
- `MarketPlaceWebServiceExpress/cart_schema.md`: cart table sketch.
- `docker-deploy/README.md`: deployment notes and operational commands.

## Known caveats

- Backend default port in `src/index.js` is `47300`; some docs still mention `47302` and docker health may expose a different host port. Always verify `PORT`, compose port mapping, and `VITE_APP_API` before giving run/deploy instructions.
- Real `.env` files exist in the repo. Do not echo secrets. Prefer reading code, examples, and variable names.
- Generated/build folders such as `node_modules/` and `dist/` exist locally. Do not edit them unless the user explicitly asks.
