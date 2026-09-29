const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.MARKETPLACE_LICENSE_DB_HOST || 'wawa.iszai.com',
  port: Number(process.env.MARKETPLACE_LICENSE_DB_PORT || 6543),
  user: process.env.MARKETPLACE_LICENSE_DB_USER || 'postgres',
  password: process.env.MARKETPLACE_LICENSE_DB_PASSWORD || 'sml',
  database: process.env.MARKETPLACE_LICENSE_DB_NAME || 'crm_fishsoft',
  connectionTimeoutMillis: 10000
});

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS license_marketplace (
      apikey TEXT PRIMARY KEY,
      shop_name TEXT NOT NULL DEFAULT '',
      status SMALLINT NOT NULL DEFAULT 1,
      expire_at TIMESTAMPTZ,
      package_code TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const result = await pool.query(
    `
      INSERT INTO license_marketplace (apikey, shop_name, status, expire_at, package_code, remark)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (apikey) DO UPDATE SET
        shop_name = EXCLUDED.shop_name,
        status = EXCLUDED.status,
        expire_at = EXCLUDED.expire_at,
        package_code = EXCLUDED.package_code,
        remark = EXCLUDED.remark,
        updated_at = now()
      RETURNING apikey, shop_name, status, expire_at, package_code
    `,
    ['DEVELOP', 'Develop Shop', 1, '2036-12-31T16:59:59.999Z', 'DEVELOPMENT', 'Development license for npm run dev']
  );

  console.log(JSON.stringify(result.rows[0], null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
