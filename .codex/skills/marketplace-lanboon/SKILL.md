---
name: marketplace-lanboon
description: Work on the MarketPlace Lanboon repository at D:\FishSoft\MarketPlace-lanboon, including the Vue 3/Vite/PrimeVue customer marketplace frontend, the plain JavaScript Express/PostgreSQL backend, API routes under /service/v1, content/media/admin/product/cart/order flows, Docker deployment, environment configuration, and project-specific validation. Use when Codex is asked to analyze, edit, debug, run, build, deploy, or explain this project.
---

# Marketplace Lanboon

## Overview

Use this skill to work in the project without rediscovering the repository shape. The repo is a two-app marketplace system:

- `MarketPlaceWeb`: Vue 3 + Vite + PrimeVue frontend.
- `MarketPlaceWebServiceExpress`: Express 4 + PostgreSQL backend ported from SML/MarketPlaceWebService Java behavior.
- `docker-deploy`: Docker Compose and deployment scripts for web, API, nginx, content, and media.

## First Steps

1. Inspect `git status --short` before editing. Do not revert unrelated user changes.
2. Read the smallest relevant reference below before changing code.
3. Use `rg` for search and follow existing local patterns.
4. Use `apply_patch` for manual edits.
5. Avoid reading or copying real `.env` secrets into responses or skill resources.

## References

- Read `references/project-map.md` when orienting, planning, or answering architecture questions.
- Read `references/backend.md` before changing Express routes, database access, API responses, license/content/media behavior, or backend validation.
- Read `references/frontend.md` before changing Vue views, PrimeVue UI, router guards, Pinia stores, services, cart/catalog/admin/customer flows, or frontend builds.
- Read `references/deploy.md` before changing Docker files, nginx, deployment scripts, image names, runtime volumes, ports, or production env behavior.
- Read `references/requirements.md` before implementing Lanboon customer-request phases, especially login, contact login, product display settings, unit visibility, media/video, preorder/QT split, cart checkout UX, and SML field mappings.

For sales document save, product-set sale flow, basket reset/concurrency, or SML ERP parity work, also use the external SML/BizSuit domain skills if they are available in the current Codex session.

## Common Workflows

### Backend changes

1. Map the endpoint in `MarketPlaceWebServiceExpress/src/index.js`.
2. Edit the relevant file in `MarketPlaceWebServiceExpress/src/routes` or `src/utils`.
3. Keep SQL parameterized. Use `withTransaction()` for multi-table writes.
4. Preserve response shapes expected by existing frontend services.
5. Run syntax checks for touched files, for example `node --check src/routes/product.js`.

### Frontend changes

1. Find the view in `MarketPlaceWeb/src/views/pages`, the service in `src/services`, and shared state in `src/stores`.
2. Keep API URLs based on `import.meta.env.VITE_APP_API`; do not hard-code production hosts.
3. Keep Vue 3 Composition API and existing PrimeVue/Tailwind conventions.
4. For cart/order changes, check `CartService.js`, `cartStore.js`, cart components, and backend cart/order routes together.
5. Run `npm run build` in `MarketPlaceWeb` when the change affects frontend behavior.

### Full-stack feature changes

1. Start at the frontend service method that calls the endpoint.
2. Confirm the backend route path and response shape.
3. Update docs or OpenAPI only when endpoint behavior changes.
4. Validate both sides: backend `node --check` and frontend `npm run build`.

## Validation Commands

Backend, from `MarketPlaceWebServiceExpress`:

```powershell
node --check src/index.js
node --check src/routes/product.js
node --check src/routes/cart.js
node --check src/routes/order.js
node --check src/routes/pos.js
node --check src/routes/content.js
node --check src/routes/media.js
```

Frontend, from `MarketPlaceWeb`:

```powershell
npm run build
```
