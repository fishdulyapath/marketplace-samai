CREATE TABLE IF NOT EXISTS license_marketplace (
  apikey TEXT PRIMARY KEY,
  shop_name TEXT DEFAULT '',
  status SMALLINT NOT NULL DEFAULT 1,
  expire_at TIMESTAMPTZ NULL,
  package_code TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_license_marketplace_status
  ON license_marketplace(status);

COMMENT ON TABLE license_marketplace IS 'Marketplace subscription/license control table in central FishSoft CRM database.';
COMMENT ON COLUMN license_marketplace.apikey IS 'Customer/shop license key. Put this value in MARKETPLACE_LICENSE_KEY on customer deployment.';
COMMENT ON COLUMN license_marketplace.status IS '1 = active, 0 = inactive. Inactive enters 24-hour grace before blocking.';
COMMENT ON COLUMN license_marketplace.expire_at IS 'Optional subscription expiry. Expired license enters 24-hour grace before blocking.';

