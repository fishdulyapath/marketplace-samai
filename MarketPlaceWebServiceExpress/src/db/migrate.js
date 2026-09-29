const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MIGRATION_LOCK_KEY = 'marketplace:schema-migration';
const DEFAULT_MIGRATION_DIR = path.join(__dirname, 'migrations');

// Allowlist only marketplace-owned, idempotent migrations. Files that touch the
// central license DB, deduplicate ERP data, or are not safely repeatable must
// never be added here.
const AUTO_MIGRATIONS = Object.freeze([
  'create_marketplace_admin_permission.sql',
  'create_order_document.sql',
  'create_marketplace_core.sql',
  'create_sale_premium.sql',
]);

function isAutoMigrateEnabled(env = process.env) {
  const value = String(env.MARKETPLACE_AUTO_MIGRATE ?? '1').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

function checksumSql(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function loadMigrations({
  migrationDir = DEFAULT_MIGRATION_DIR,
  migrations = AUTO_MIGRATIONS,
} = {}) {
  const loaded = [];
  for (const migrationName of migrations) {
    const sql = await fs.readFile(path.join(migrationDir, migrationName), 'utf8');
    loaded.push({
      name: migrationName,
      sql,
      checksum: checksumSql(sql),
    });
  }
  return loaded;
}

async function rollbackQuietly(client, logger) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackError) {
    logger.error(`[migration] rollback failed: ${rollbackError.message}`);
  }
}

async function runMigrations({
  pool = null,
  env = process.env,
  logger = console,
  migrationDir = DEFAULT_MIGRATION_DIR,
  migrations = AUTO_MIGRATIONS,
} = {}) {
  if (!isAutoMigrateEnabled(env)) {
    logger.info('[migration] skipped (MARKETPLACE_AUTO_MIGRATE=0)');
    return { enabled: false, applied: [], skipped: [] };
  }

  const targetPool = pool || require('../db.js').pool;
  const migrationFiles = await loadMigrations({ migrationDir, migrations });
  const client = await targetPool.connect();
  let lockAcquired = false;

  try {
    logger.info('[migration] waiting for schema lock');
    await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [MIGRATION_LOCK_KEY]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_schema_migration (
        migration_name TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const historyResult = await client.query(
      'SELECT migration_name, checksum FROM marketplace_schema_migration'
    );
    const history = new Map(
      historyResult.rows.map((row) => [row.migration_name, String(row.checksum || '').trim()])
    );
    const applied = [];
    const skipped = [];

    for (const migration of migrationFiles) {
      const previousChecksum = history.get(migration.name);
      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Migration checksum mismatch: ${migration.name}. ` +
              'Create a new migration instead of editing an applied file.'
          );
        }
        logger.info(`[migration] skip ${migration.name}`);
        skipped.push(migration.name);
        continue;
      }

      logger.info(`[migration] apply ${migration.name}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO marketplace_schema_migration (migration_name, checksum)
           VALUES ($1, $2)`,
          [migration.name, migration.checksum]
        );
        await client.query('COMMIT');
      } catch (error) {
        await rollbackQuietly(client, logger);
        throw new Error(`Migration failed: ${migration.name}: ${error.message}`, {
          cause: error,
        });
      }

      logger.info(`[migration] applied ${migration.name}`);
      applied.push(migration.name);
    }

    logger.info(`[migration] complete (applied=${applied.length}, skipped=${skipped.length})`);
    return { enabled: true, applied, skipped };
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [
          MIGRATION_LOCK_KEY,
        ]);
      } catch (unlockError) {
        logger.error(`[migration] unlock failed: ${unlockError.message}`);
      }
    }
    client.release();
  }
}

module.exports = {
  AUTO_MIGRATIONS,
  MIGRATION_LOCK_KEY,
  checksumSql,
  isAutoMigrateEnabled,
  loadMigrations,
  runMigrations,
};
