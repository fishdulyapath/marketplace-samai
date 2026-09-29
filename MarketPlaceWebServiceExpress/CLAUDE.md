# SML Staff Service Express

Express.js REST API — a Node.js port of the original Java/JAX-RS MarketPlaceWebService, serving the SML staff-facing marketplace.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (plain JavaScript, no TypeScript) |
| Framework | Express 4.x |
| Database | PostgreSQL via `pg` (two pools: main + images) |
| Image processing | `sharp` |
| Dev server | `nodemon` |
| Frontend (planned) | Vue 3 + Vite |

## Running the Project

```bash
# Install dependencies
npm install

# Development (auto-reload via nodemon)
npm run dev

# Production
npm start
```

The server starts on **port 47302** (or `process.env.PORT`).

## Project Structure

```
src/
├── index.js          # Express app bootstrap, CORS, route mounting
├── db.js             # Two pg pools (main DB + image DB), withTransaction helper
├── routes/
│   ├── auth.js       # GET /loginemp, GET /logincus
│   ├── product.js    # Product list, detail, set, balance/price
│   ├── order.js      # POST /sendorder — complex order creation with VAT
│   ├── cart.js       # Cart CRUD against ws_cart_order_temp
│   ├── customer.js   # Customer master data
│   ├── financial.js  # Financial/accounting endpoints
│   ├── document.js   # Document (invoice/report) endpoints
│   ├── favorite.js   # Customer favourite items
│   └── image.js      # Image serving with ETag + 7-day cache
└── utils/
    ├── response.js   # success(), fail(), paginated() helpers
    └── priceHelper.js # getProductPriceLocalx() — 7-strategy cascading price logic
```

## API Base Path

All endpoints are mounted under `/service/v1`.

```
GET  /service/v1/loginemp
GET  /service/v1/getProductList
POST /service/v1/sendorder
...
```

## Database

Two PostgreSQL databases, both configured via `.env`:

- **demo** (`DB_NAME`) — transactional data (products, orders, customers)
- **demo_images** (`DB_IMAGES_NAME`) — binary image BLOBs

Key tables: `ic_inventory`, `ic_trans`, `ic_trans_detail`, `ar_customer`, `staff_cart_order`, `images`.

All queries use **parameterized placeholders** (`$1, $2, …`) — never string-interpolate user input into SQL.

> ⚠️ **`$1` is not enough for `sml_ic_function_stock_balance_warehouse_location()`.**
> That ERP function concatenates its arguments into a string and `EXECUTE`s it (via `gen_code_list()`,
> which wraps values in quotes without escaping them). A value that is safe in the outer query is
> re-parsed as SQL inside the function — a second-order injection that parameterization cannot stop.
> Every code passed to it must go through `src/utils/erpCodeGuard.js` first. The function belongs to
> smlerp and is shared with other systems, so it cannot be fixed at the source.

Connections disable sequential scans on connect: `SET enable_seqscan = false`.

## Pricing Logic

`src/utils/priceHelper.js` — `getProductPriceLocalx()` implements 7 cascading price strategies:

1. Customer-specific price
2. Customer-group price
3. Promotion price
4. Standard price
5. Formula-based price
6. Barcode price
7. Last recorded price

Do **not** simplify or refactor this function without fully understanding the downstream business impact. It replicates exact Java logic including intentional quirks.

## Request Headers (Required by Clients)

| Header | Purpose |
|---|---|
| `GUID` | Session identifier |
| `configFileName` | Config profile selector |
| `databaseName` | Target database override |
| `Authorization` | Auth token |

## Environment Variables

Copy `.env.example` to `.env` — never commit `.env` directly.

| Key | Description |
|---|---|
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port |
| `DB_USER` | DB username |
| `DB_PASSWORD` | DB password |
| `DB_NAME` | Main database name |
| `DB_IMAGES_NAME` | Image database name |
| `DB_POOL_MAX` | Main pool size (default 25). Checkout holds a connection for the whole transaction — too small and concurrent orders fail with `timeout exceeded when trying to connect` |
| `DB_POOL_MAX_IMAGES` | Image pool size (default 10) |
| `DB_CONNECTION_TIMEOUT_MS` | How long a request waits for a free connection (default 10000) |
| `DB_IDLE_TIMEOUT_MS` | Idle connection lifetime (default 30000) |
| `AUTH_MODE` | `off` \| `audit` \| `enforce` (default `audit`). See Authentication below |
| `AUTH_TOKEN_SECRET` | HMAC key for signing tokens. **Required when `AUTH_MODE=enforce`** — the server refuses to start without it |
| `AUTH_TOKEN_TTL_HOURS` | Token lifetime (default 12) |
| `PORT` | HTTP server port (default 47302) |
| `PROVIDER` | Environment tag (e.g. DEMO, PROD) |

> Pool sizing note: `DB_POOL_MAX + DB_POOL_MAX_IMAGES` is consumed **per app instance**, and the
> PostgreSQL server is shared with other systems. Check `SHOW max_connections` before raising these.

## Authentication

Three layers, all controlled by `AUTH_MODE`:

1. **Who are you** — `Authorization: Bearer <token>` where the token is HMAC-signed by this server at login
   (`/loginemp`, `/logincus` return it in each `data` row). See `src/auth/token.js`.
2. **Is this yours** — a customer may only pass their own `cust_code`; employees may pass any
   (ordering on behalf of a customer is a supported flow). Enforced centrally in `src/auth/authMiddleware.js`
   rather than at ~40 call sites.
3. **May you do admin work** — `requireAdmin(permissionCode)` per route, backed by the existing
   `getAdminPermissionsForUser()`. Use `requireEmployee()` for staff-only endpoints that do not
   belong to an admin page (master-data dropdowns, POS dashboards, sale history) — never invent a
   permission code that is not in `ADMIN_PAGES`, or every employee **with** a permission row is denied.
   See `src/auth/requireAdmin.js`.

> ⚠️ Layer 2 keys on the parameter name `cust_code`. Two routes identify the customer with `code`
> instead (`/getCustomerDetail`, `/updateCustomerProfile`); they are listed in
> `CUSTOMER_ID_FIELDS_BY_PATH` in `authMiddleware.js`. `code` cannot go in the global list — dozens of
> routes use it for product/category/warehouse codes. **A new route that identifies a customer by any
> other name must be added there**, or a logged-in customer can read and overwrite another customer'''s
> record. That was a real hole: `/getCustomerDetail?code=<someone else>` returned their row including
> the password column (`ar_customer.fax`).

**Rollout**: run `AUTH_MODE=audit` first. Nothing is blocked; violations are logged as `[auth:audit]`.
Each log line is a request that would break under `enforce` — fix them all, then switch.

```bash
grep "auth:audit" <logfile>        # what still needs fixing
```

⚠️ The storefront must stay browsable without logging in. The public allowlist lives in
`authMiddleware.js` and was built by walking every storefront page in audit mode — not by guessing.
Adding a new anonymous-facing endpoint means adding it there too.

⚠️ An employee with **no row** in `marketplace_admin_permission` gets **every** permission
(`getAdminPermissionsForUser` returns the full list when it finds no row). That is the pre-existing
product rule — restricting a staff member requires giving them an explicit row.

## Key Conventions

- Use `async/await` — no raw `.then()/.catch()` chains in routes.
- All DB mutations that touch multiple tables must use `withTransaction()` from `db.js`.
- Always return responses via helpers in `utils/response.js`.
- Inline SQL comments in Thai are intentional — they trace back to the original Java methods.
- Keep routes thin: business logic belongs in `utils/`, not inline in route handlers.

## Planned Vue 3 Frontend

A Vue 3 + Vite frontend will be added in a sibling directory (`../smlstaff-vue/` or `../frontend/`). When added:

- It will consume this API via Axios pointing to `http://localhost:47302/service/v1`.
- Auth flow uses the `GUID` header, stored in Pinia.
- UI component library: TBD (likely PrimeVue or Quasar).

## Agents

| Agent | Use for |
|---|---|
| `code-reviewer` | General code quality review |
| `security-auditor` | SQL injection, auth bypass, data exposure |
| `ux-ui-frontend-designer` | Vue 3 UI/UX design and component structure |
