const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

const router = express.Router();

const enabled = String(process.env.MARKETPLACE_LICENSE_ENABLED || '0') === '1';
const licenseKey = String(process.env.MARKETPLACE_LICENSE_KEY || '').trim();
const checkIntervalHours = clampNumber(process.env.MARKETPLACE_LICENSE_CHECK_INTERVAL_HOURS, 1, 168, 24);
const checkIntervalMinutes = process.env.MARKETPLACE_LICENSE_CHECK_INTERVAL_MINUTES
  ? clampNumber(process.env.MARKETPLACE_LICENSE_CHECK_INTERVAL_MINUTES, 1, 10080, checkIntervalHours * 60)
  : checkIntervalHours * 60;
const checkIntervalMs = checkIntervalMinutes * 60 * 1000;
const graceHours = clampNumber(process.env.MARKETPLACE_LICENSE_GRACE_HOURS, 1, 168, 24);
const stateFile =
  process.env.MARKETPLACE_LICENSE_STATE_FILE ||
  path.join(process.env.MARKETPLACE_CONTENT_DIR || path.join(__dirname, '../data/content'), 'license-state.json');

const licenseDbConfig = {
  host: process.env.MARKETPLACE_LICENSE_DB_HOST || 'wawa.iszai.com',
  port: parseInt(process.env.MARKETPLACE_LICENSE_DB_PORT || '6543', 10),
  user: process.env.MARKETPLACE_LICENSE_DB_USER || 'postgres',
  password: process.env.MARKETPLACE_LICENSE_DB_PASSWORD || 'sml',
  database: process.env.MARKETPLACE_LICENSE_DB_NAME || 'crm_fishsoft',
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

let pool = null;
let state = null;
let initPromise = null;
let checkTimer = null;
let checkPromise = null;

function clampNumber(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function nowIso() {
  return new Date().toISOString();
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function hoursSince(value) {
  const date = parseDate(value);
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / 36e5;
}

function defaultState(patch = {}) {
  return {
    enabled,
    license_key: licenseKey,
    status: enabled ? 'checking' : 'disabled',
    remote_status: null,
    shop_name: '',
    expire_at: null,
    package_code: '',
    last_checked_at: null,
    last_success_at: null,
    next_check_at: null,
    grace_started_at: null,
    blocked_at: null,
    reason: enabled ? 'CHECK_PENDING' : 'LICENSE_DISABLED',
    last_error: '',
    ...patch,
  };
}

async function readState() {
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const stored = JSON.parse(String(raw || '{}').replace(/^\uFEFF/, ''));
    return defaultState(stored);
  } catch (error) {
    if (error.code === 'ENOENT') return defaultState();
    console.warn('License state read failed:', error.message);
    return defaultState({ reason: 'STATE_READ_FAILED', last_error: error.message });
  }
}

async function writeState(nextState) {
  state = defaultState(nextState);
  try {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.warn('License state write failed:', error.message);
  }
  return state;
}

function getPool() {
  if (!pool) {
    pool = new Pool(licenseDbConfig);
    pool.on('error', (error) => {
      console.error('License PostgreSQL pool error:', error.message);
    });
  }
  return pool;
}

function publicState(value = state) {
  const source = value || defaultState();
  const allowed = !enabled || source.status === 'active' || source.status === 'grace' || source.status === 'checking';
  return {
    enabled,
    allowed,
    status: enabled ? source.status : 'disabled',
    code: source.reason || '',
    message: licenseMessage(source),
    license_key: licenseKey ? maskLicenseKey(licenseKey) : '',
    shop_name: source.shop_name || '',
    expire_at: source.expire_at || null,
    package_code: source.package_code || '',
    last_checked_at: source.last_checked_at || null,
    next_check_at: source.next_check_at || null,
    grace_started_at: source.grace_started_at || null,
    blocked_at: source.blocked_at || null,
    grace_hours: graceHours,
    check_interval_hours: checkIntervalMinutes / 60,
    check_interval_minutes: checkIntervalMinutes,
  };
}

function maskLicenseKey(value) {
  const text = String(value || '');
  if (text.length <= 6) return '******';
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

function licenseMessage(value = state) {
  if (!enabled) return 'License check disabled';
  if (!licenseKey) return 'ยังไม่ได้กำหนดรหัส license ของร้าน';
  if (!value) return 'กำลังตรวจสอบสิทธิ์การใช้งาน';
  if (value.status === 'active') return 'ระบบพร้อมใช้งาน';
  if (value.status === 'grace') return 'อยู่ในช่วงผ่อนผันการใช้งาน 24 ชั่วโมง';
  if (value.status === 'blocked') return 'ระบบถูกระงับการใช้งาน กรุณาติดต่อผู้ให้บริการ';
  return 'กำลังตรวจสอบสิทธิ์การใช้งาน';
}

function isBlockedByGrace(currentState) {
  return currentState?.status === 'grace' && hoursSince(currentState.grace_started_at) >= graceHours;
}

async function ensureInitialized() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    state = await readState();
    if (!enabled) {
      await writeState(defaultState({ status: 'disabled', reason: 'LICENSE_DISABLED' }));
      return state;
    }

    if (!licenseKey) {
      await writeState(defaultState({ status: 'blocked', blocked_at: nowIso(), reason: 'LICENSE_KEY_MISSING' }));
      return state;
    }

    if (isBlockedByGrace(state)) {
      await writeState({ ...state, status: 'blocked', blocked_at: state.blocked_at || nowIso(), reason: state.reason || 'GRACE_EXPIRED' });
    }
    return state;
  })();
  return initPromise;
}

async function setGrace(reason, details = {}) {
  const base = state || defaultState();

  // If the last successful remote check confirmed active and license is not yet expired,
  // keep the active status instead of downgrading to grace on a transient network failure.
  if (base.status === 'active' && base.last_success_at) {
    const expireDate = parseDate(base.expire_at);
    const licenseStillValid = !expireDate || expireDate.getTime() > Date.now();
    if (licenseStillValid) {
      return writeState({
        ...base,
        ...details,
        status: 'active',
        grace_started_at: null,
        blocked_at: null,
        reason: base.reason || 'LICENSE_ACTIVE',
        next_check_at: nextCheckAt(),
      });
    }
  }

  const graceStartedAt = base.grace_started_at || nowIso();
  const expired = hoursSince(graceStartedAt) >= graceHours;
  return writeState({
    ...base,
    ...details,
    status: expired ? 'blocked' : 'grace',
    grace_started_at: graceStartedAt,
    blocked_at: expired ? base.blocked_at || nowIso() : null,
    reason: expired ? `${reason}_GRACE_EXPIRED` : reason,
    next_check_at: nextCheckAt(),
  });
}

function nextCheckAt() {
  return new Date(Date.now() + checkIntervalMs).toISOString();
}

async function checkNow() {
  await ensureInitialized();
  if (!enabled) return state;
  if (!licenseKey) {
    return writeState({ ...defaultState(), status: 'blocked', blocked_at: nowIso(), reason: 'LICENSE_KEY_MISSING' });
  }
  if (checkPromise) return checkPromise;

  checkPromise = (async () => {
    try {
      const result = await getPool().query('SELECT * FROM license_marketplace WHERE apikey = $1 LIMIT 1', [licenseKey]);
      const row = result.rows[0] || null;
      const checkedAt = nowIso();
      if (!row) {
        return setGrace('LICENSE_NOT_FOUND', {
          remote_status: 0,
          last_checked_at: checkedAt,
          last_success_at: checkedAt,
          last_error: '',
        });
      }

      const remoteStatus = Number(row.status) === 1 ? 1 : 0;
      const expireAt = row.expire_at || row.expired_at || row.end_date || null;
      const expireDate = parseDate(expireAt);
      const isExpired = expireDate ? expireDate.getTime() < Date.now() : false;
      const common = {
        remote_status: remoteStatus,
        shop_name: row.shop_name || row.name || row.name_1 || '',
        expire_at: expireDate ? expireDate.toISOString() : null,
        package_code: row.package_code || row.package || '',
        last_checked_at: checkedAt,
        last_success_at: checkedAt,
        next_check_at: nextCheckAt(),
        last_error: '',
      };

      if (remoteStatus !== 1) {
        return writeState({
          ...defaultState(),
          ...common,
          status: 'blocked',
          grace_started_at: null,
          blocked_at: checkedAt,
          reason: 'LICENSE_INACTIVE',
        });
      }

      if (!isExpired) {
        return writeState({
          ...defaultState(),
          ...common,
          status: 'active',
          grace_started_at: null,
          blocked_at: null,
          reason: 'LICENSE_ACTIVE',
        });
      }

      return setGrace('LICENSE_EXPIRED', common);
    } catch (error) {
      return setGrace('LICENSE_CHECK_FAILED', {
        last_checked_at: nowIso(),
        last_error: error.message,
      });
    } finally {
      checkPromise = null;
    }
  })();

  return checkPromise;
}

async function getStatus() {
  await ensureInitialized();
  if (!enabled) return state;

  if (isBlockedByGrace(state)) {
    await writeState({
      ...state,
      status: 'blocked',
      blocked_at: state.blocked_at || nowIso(),
      reason: `${state.reason || 'LICENSE'}_GRACE_EXPIRED`,
    });
  }

  if (state?.next_check_at && Date.now() >= new Date(state.next_check_at).getTime()) {
    checkNow().catch((error) => console.error('License scheduled check failed:', error.message));
  }

  return state;
}

function isRequestAllowed(currentState) {
  if (!enabled) return true;
  return ['active', 'grace', 'checking'].includes(currentState?.status);
}

async function licenseMiddleware(req, res, next) {
  if (!enabled) return next();
  if (req.path === '/license/status' || req.path === '/license/check-now') return next();

  try {
    const current = await getStatus();
    if (isRequestAllowed(current)) return next();

    return res.status(402).json({
      success: false,
      license_error: true,
      code: current?.reason || 'LICENSE_BLOCKED',
      message: licenseMessage(current),
      license: publicState(current),
    });
  } catch (error) {
    console.error('License middleware error:', error.message);
    return res.status(402).json({
      success: false,
      license_error: true,
      code: 'LICENSE_CHECK_ERROR',
      message: 'ไม่สามารถตรวจสอบสิทธิ์การใช้งานได้',
    });
  }
}

router.get('/license/status', async (_req, res) => {
  const current = await getStatus();
  res.json({ success: true, data: publicState(current) });
});

router.post('/license/check-now', async (_req, res) => {
  const current = await checkNow();
  res.json({ success: true, data: publicState(current) });
});

// 🚨 เดิมมี GET ด้วย ซึ่งเปลี่ยน state (เขียนทับ license-state.json + ต่อออกไป license DB)
//    และอยู่ใน allowlist จึงยิงได้โดยไม่ต้องมี token เลย
//    GET ที่เปลี่ยน state โดน prefetch ของเบราว์เซอร์หรือ CSRF ได้ด้วย
//    เหลือเฉพาะ POST ส่วน GET ให้ไปใช้ /license/status ที่อ่านอย่างเดียวแทน
router.get('/license/check-now', (_req, res) => {
  res.status(405).json({
    success: false,
    msg: 'method not allowed',
    message: 'กรุณาใช้ POST /license/check-now หรืออ่านสถานะจาก GET /license/status',
  });
});

function startLicenseScheduler() {
  ensureInitialized()
    .then(() => {
      if (!enabled || !licenseKey) return;
      return checkNow();
    })
    .catch((error) => console.error('License initial check failed:', error.message));

  if (!enabled || checkTimer) return;
  checkTimer = setInterval(() => {
    checkNow().catch((error) => console.error('License interval check failed:', error.message));
  }, checkIntervalMs);
  if (typeof checkTimer.unref === 'function') checkTimer.unref();
}

module.exports = {
  licenseMiddleware,
  licenseRouter: router,
  startLicenseScheduler,
  checkNow,
  getStatus,
};
