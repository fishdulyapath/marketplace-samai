# Marketplace License Subscription

License control is optional and disabled by default. Enable it per customer deployment with environment variables.

## Central Database

Create this table in the central CRM database:

- host: `wawa.iszai.com`
- port: `6543`
- database: `crm_fishsoft`
- table: `license_marketplace`

Migration file:

```text
src/db/migrations/create_license_marketplace.sql
```

Example row:

```sql
INSERT INTO license_marketplace (apikey, shop_name, status, expire_at, package_code)
VALUES ('SHOP-ABC-001', 'Customer Shop', 1, '2026-12-31 23:59:59+07', 'standard');
```

## Customer Deployment Env

Set these values in the customer `.env`:

```env
MARKETPLACE_LICENSE_ENABLED=1
MARKETPLACE_LICENSE_KEY=SHOP-ABC-001
MARKETPLACE_LICENSE_DB_HOST=wawa.iszai.com
MARKETPLACE_LICENSE_DB_PORT=6543
MARKETPLACE_LICENSE_DB_USER=postgres
MARKETPLACE_LICENSE_DB_PASSWORD=sml
MARKETPLACE_LICENSE_DB_NAME=crm_fishsoft
MARKETPLACE_LICENSE_CHECK_INTERVAL_HOURS=24
MARKETPLACE_LICENSE_GRACE_HOURS=24
```

For development/testing you can use minute-level checks:

```env
MARKETPLACE_LICENSE_CHECK_INTERVAL_MINUTES=1
```

`MARKETPLACE_LICENSE_KEY` must match `license_marketplace.apikey`.

## Behavior

- `status = 1`: active.
- `status = 0`: blocks immediately after a successful central DB check.
- central DB error: enters grace for 24 hours. If the DB is still unreachable after grace, API is blocked.
- expired `expire_at`: enters grace for 24 hours, then blocks if still expired.

The API stores state in:

```text
MARKETPLACE_LICENSE_STATE_FILE
```

Default path:

```text
<MARKETPLACE_CONTENT_DIR>/license-state.json
```

This file must be on a Docker volume so restart does not reset grace.

## Endpoints

```http
GET /service/v1/license/status
POST /service/v1/license/check-now
GET /service/v1/license/check-now
```

When blocked, protected APIs return:

```json
{
  "success": false,
  "license_error": true,
  "code": "LICENSE_BLOCKED",
  "message": "ระบบถูกระงับการใช้งาน กรุณาติดต่อผู้ให้บริการ"
}
```
