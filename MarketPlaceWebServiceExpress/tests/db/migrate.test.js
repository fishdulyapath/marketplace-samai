const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  AUTO_MIGRATIONS,
  checksumSql,
  isAutoMigrateEnabled,
  runMigrations,
} = require('../../src/db/migrate');

function createLogger() {
  return {
    info: jest.fn(),
    error: jest.fn(),
  };
}

function createFakePool(initialHistory = new Map()) {
  const state = {
    history: new Map(initialHistory),
    executions: new Map(),
    locked: false,
    waiters: [],
    connectCount: 0,
    releaseCount: 0,
  };

  async function acquireLock() {
    if (!state.locked) {
      state.locked = true;
      return;
    }
    await new Promise((resolve) => state.waiters.push(resolve));
    state.locked = true;
  }

  function releaseLock() {
    state.locked = false;
    const next = state.waiters.shift();
    if (next) next();
  }

  const pool = {
    state,
    async connect() {
      state.connectCount += 1;
      return {
        async query(sql, params = []) {
          const normalized = String(sql).trim().replace(/\s+/g, ' ');

          if (normalized.includes('pg_advisory_lock')) {
            await acquireLock();
            return { rows: [] };
          }
          if (normalized.includes('pg_advisory_unlock')) {
            releaseLock();
            return { rows: [] };
          }
          if (normalized.startsWith('CREATE TABLE IF NOT EXISTS marketplace_schema_migration')) {
            return { rows: [] };
          }
          if (normalized.startsWith('SELECT migration_name, checksum')) {
            return {
              rows: [...state.history.entries()].map(([migration_name, checksum]) => ({
                migration_name,
                checksum,
              })),
            };
          }
          if (normalized.startsWith('INSERT INTO marketplace_schema_migration')) {
            state.history.set(params[0], params[1]);
            return { rows: [] };
          }
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
            return { rows: [] };
          }

          const marker = /-- migration: ([^\r\n]+)/.exec(String(sql))?.[1] || normalized;
          state.executions.set(marker, (state.executions.get(marker) || 0) + 1);
          if (String(sql).includes('FAIL_MIGRATION')) {
            throw new Error('synthetic migration failure');
          }
          return { rows: [] };
        },
        release() {
          state.releaseCount += 1;
        },
      };
    },
  };

  return pool;
}

describe('startup migration runner', () => {
  let migrationDir;

  beforeEach(async () => {
    migrationDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marketplace-migrate-'));
  });

  afterEach(async () => {
    await fs.rm(migrationDir, { recursive: true, force: true });
  });

  async function writeMigration(name, marker = name) {
    const sql = `-- migration: ${marker}\nSELECT 1;\n`;
    await fs.writeFile(path.join(migrationDir, name), sql, 'utf8');
    return sql;
  }

  it('เปิดใช้งานเป็นค่าเริ่มต้น และปิดได้ด้วยค่ามาตรฐาน', () => {
    expect(isAutoMigrateEnabled({})).toBe(true);
    for (const value of ['0', 'false', 'FALSE', 'no', 'off']) {
      expect(isAutoMigrateEnabled({ MARKETPLACE_AUTO_MIGRATE: value })).toBe(false);
    }
  });

  it('allowlist ไม่รวม migration ที่แตะฐาน license, ลบข้อมูล ERP หรือไฟล์เก่าที่ไม่ idempotent', () => {
    expect(AUTO_MIGRATIONS).toEqual([
      'create_marketplace_admin_permission.sql',
      'create_order_document.sql',
      'create_marketplace_core.sql',
      'create_sale_premium.sql',
      'create_pending_order.sql',
    ]);
    expect(AUTO_MIGRATIONS).not.toContain('create_license_marketplace.sql');
    expect(AUTO_MIGRATIONS).not.toContain('add_price_formula_unique.sql');
    expect(AUTO_MIGRATIONS).not.toContain('create_pos_basket.sql');
  });

  it('สร้างตารางแกน Marketplace ก่อน migration ของ Sale Premium โดยไม่แก้ตาราง ERP', async () => {
    const coreIndex = AUTO_MIGRATIONS.indexOf('create_marketplace_core.sql');
    const premiumIndex = AUTO_MIGRATIONS.indexOf('create_sale_premium.sql');
    const coreSql = await fs.readFile(
      path.join(__dirname, '../../src/db/migrations/create_marketplace_core.sql'),
      'utf8'
    );

    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(coreIndex).toBeLessThan(premiumIndex);
    expect(coreSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.staff_cart_order/i);
    expect(coreSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.pos_basket/i);
    expect(coreSql).not.toMatch(/ALTER TABLE(?: IF EXISTS)? public\.ar_/i);
  });

  it('รันครั้งแรกตามลำดับและ restart ครั้งถัดไปเป็น no-op', async () => {
    const names = ['001.sql', '002.sql'];
    await writeMigration(names[0], 'first');
    await writeMigration(names[1], 'second');
    const pool = createFakePool();

    const first = await runMigrations({ pool, migrationDir, migrations: names, logger: createLogger() });
    const second = await runMigrations({ pool, migrationDir, migrations: names, logger: createLogger() });

    expect(first).toMatchObject({ applied: names, skipped: [] });
    expect(second).toMatchObject({ applied: [], skipped: names });
    expect(pool.state.executions.get('first')).toBe(1);
    expect(pool.state.executions.get('second')).toBe(1);
    expect(pool.state.releaseCount).toBe(2);
  });

  it('advisory lock กันสอง instance ไม่ให้ใช้ migration ซ้ำ', async () => {
    const names = ['001.sql'];
    await writeMigration(names[0], 'concurrent');
    const pool = createFakePool();

    const [one, two] = await Promise.all([
      runMigrations({ pool, migrationDir, migrations: names, logger: createLogger() }),
      runMigrations({ pool, migrationDir, migrations: names, logger: createLogger() }),
    ]);

    expect(pool.state.executions.get('concurrent')).toBe(1);
    expect([...one.applied, ...two.applied]).toEqual(names);
    expect([...one.skipped, ...two.skipped]).toEqual(names);
  });

  it('checksum เปลี่ยนแล้วหยุดโดยไม่รัน SQL ซ้ำ', async () => {
    const name = '001.sql';
    const sql = await writeMigration(name, 'changed');
    const pool = createFakePool(new Map([[name, checksumSql(`${sql}-- edited`)]]));

    await expect(
      runMigrations({ pool, migrationDir, migrations: [name], logger: createLogger() })
    ).rejects.toThrow(/checksum mismatch/i);
    expect(pool.state.executions.size).toBe(0);
  });

  it('migration ล้มเหลวแล้ว rollback, ไม่บันทึก history และคืน connection', async () => {
    const name = '001.sql';
    await fs.writeFile(
      path.join(migrationDir, name),
      '-- migration: failing\nFAIL_MIGRATION;\n',
      'utf8'
    );
    const pool = createFakePool();

    await expect(
      runMigrations({ pool, migrationDir, migrations: [name], logger: createLogger() })
    ).rejects.toThrow(/Migration failed: 001\.sql/);
    expect(pool.state.history.size).toBe(0);
    expect(pool.state.releaseCount).toBe(1);
  });

  it('ปิดผ่าน env แล้วไม่เปิด connection', async () => {
    const pool = createFakePool();
    const result = await runMigrations({
      pool,
      env: { MARKETPLACE_AUTO_MIGRATE: '0' },
      migrationDir,
      migrations: ['missing.sql'],
      logger: createLogger(),
    });

    expect(result).toEqual({ enabled: false, applied: [], skipped: [] });
    expect(pool.state.connectCount).toBe(0);
  });
});
