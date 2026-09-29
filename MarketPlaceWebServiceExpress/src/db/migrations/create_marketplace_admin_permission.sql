CREATE TABLE IF NOT EXISTS marketplace_admin_permission (
  user_code VARCHAR(50) PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketplace_admin_permission IS 'Back office page permissions by erp_user.code';
COMMENT ON COLUMN marketplace_admin_permission.user_code IS 'Employee code from erp_user.code';
COMMENT ON COLUMN marketplace_admin_permission.permissions IS 'Allowed admin page permission codes. Missing row means legacy allow all.';
