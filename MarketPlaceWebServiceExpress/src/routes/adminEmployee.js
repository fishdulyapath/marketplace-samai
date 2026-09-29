const express = require('express');
const { requireAdmin } = require('../auth/requireAdmin');
const { query } = require('../db');

const router = express.Router();

function clampLimit(value, fallback = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}

function normalizeStatus(value) {
  const status = String(value || 'all').trim().toLowerCase();
  return ['visible', 'hidden'].includes(status) ? status : 'all';
}

// GET /service/v1/admin/employees
router.get('/admin/employees', requireAdmin('admin.employees'), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const status = normalizeStatus(req.query.status);
  const limit = clampLimit(req.query.limit);

  try {
    const baseParams = [];
    const baseConditions = [];

    if (search) {
      baseParams.push(`%${search}%`);
      baseConditions.push(`(code ILIKE $${baseParams.length} OR COALESCE(name_1,'') ILIKE $${baseParams.length})`);
    }

    const baseWhere = baseConditions.length ? `WHERE ${baseConditions.join(' AND ')}` : '';
    const rowConditions = [...baseConditions];

    if (status === 'visible') {
      rowConditions.push('COALESCE(mobile_user,0) <> 1');
    } else if (status === 'hidden') {
      rowConditions.push('COALESCE(mobile_user,0) = 1');
    }

    const rowWhere = rowConditions.length ? `WHERE ${rowConditions.join(' AND ')}` : '';
    const limitParam = baseParams.length + 1;

    const [rowsResult, summaryResult] = await Promise.all([
      query(
        `SELECT code,
                COALESCE(name_1,'') AS name,
                COALESCE(mobile_user,0)::int AS mobile_user
         FROM erp_user
         ${rowWhere}
         ORDER BY UPPER(code)
         LIMIT $${limitParam}`,
        [...baseParams, limit]
      ),
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE COALESCE(mobile_user,0) <> 1)::int AS visible,
                COUNT(*) FILTER (WHERE COALESCE(mobile_user,0) = 1)::int AS hidden
         FROM erp_user
         ${baseWhere}`,
        baseParams
      ),
    ]);

    const rows = rowsResult.rows.map((row) => ({
      code: row.code,
      name: row.name,
      mobile_user: Number(row.mobile_user) === 1 ? 1 : 0,
      selectable: Number(row.mobile_user) !== 1,
    }));
    const summary = summaryResult.rows[0] || { total: 0, visible: 0, hidden: 0 };
    const filteredTotal = status === 'visible'
      ? Number(summary.visible || 0)
      : status === 'hidden'
        ? Number(summary.hidden || 0)
        : Number(summary.total || 0);

    return res.json({
      success: true,
      data: rows,
      summary: {
        total: Number(summary.total || 0),
        visible: Number(summary.visible || 0),
        hidden: Number(summary.hidden || 0),
      },
      truncated: rows.length < filteredTotal,
    });
  } catch (ex) {
    return res.status(400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

// POST /service/v1/admin/employees/visibility
router.post('/admin/employees/visibility', requireAdmin('admin.employees'), async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const mobileUser = Number(req.body?.mobile_user);

  if (!code) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสพนักงาน' });
  }
  if (![0, 1].includes(mobileUser)) {
    return res.status(400).json({ success: false, message: 'mobile_user ต้องเป็น 0 หรือ 1' });
  }

  try {
    const result = await query(
      `UPDATE erp_user
       SET mobile_user = $2
       WHERE UPPER(code) = UPPER($1)
       RETURNING code, COALESCE(name_1,'') AS name, COALESCE(mobile_user,0)::int AS mobile_user`,
      [code, mobileUser]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'ไม่พบพนักงานที่ระบุ' });
    }

    const row = result.rows[0];
    return res.json({
      success: true,
      data: {
        code: row.code,
        name: row.name,
        mobile_user: Number(row.mobile_user) === 1 ? 1 : 0,
        selectable: Number(row.mobile_user) !== 1,
      },
    });
  } catch (ex) {
    return res.status(400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

module.exports = router;
