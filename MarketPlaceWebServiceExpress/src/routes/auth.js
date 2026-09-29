const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { getAdminPermissionsForUser } = require('../utils/adminPermissions');
const { signToken } = require('../auth/token');

// GET /service/v1/loginemp
// Java: query erp_user WHERE upper(code)=upper(user_code) AND password=password
router.get('/loginemp', async (req, res) => {
  const { user_code, password } = req.query;
  const normalizedUserCode = String(user_code || '').trim();
  const normalizedPassword = String(password || '').trim();

  const resp = { success: false };
  try {
    if (!normalizedUserCode || !normalizedPassword) {
      resp.success = true;
      resp.data = [];
      return res.json(resp);
    }

    const sql = `
      SELECT code AS user_code, name_1 AS user_name
      FROM erp_user
      WHERE UPPER(code) = UPPER($1) AND password = $2
      ORDER BY code
    `;
    const result = await query(sql, [normalizedUserCode, normalizedPassword]);

    const data = [];
    for (const r of result.rows) {
      const permissionInfo = await getAdminPermissionsForUser(r.user_code);
      data.push({
        user_code: r.user_code,
        user_name: r.user_name,
        admin_permissions: permissionInfo.permissions,
        admin_permission_custom: permissionInfo.has_custom_permissions,
        is_superadmin: permissionInfo.is_superadmin,
        // สิทธิ์แอดมินไม่ได้ฝังใน token — server ไปอ่านจากฐานข้อมูลตอนตรวจทุกครั้ง
        // เพราะถ้าฝังไว้ การถอนสิทธิ์จะไม่มีผลจนกว่า token จะหมดอายุ
        token: signToken({ sub: r.user_code, typ: 'employee' }),
      });
    }

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/logincus
// Customer login accepts ar_customer.code or ar_customer.email with password in ar_customer.fax.
// Contact login accepts ar_contactor.telephone with password in ar_contactor.mobile.
router.get('/logincus', async (req, res) => {
  const { user_code, password } = req.query;
  const normalizedUserCode = String(user_code || '').trim();
  const normalizedPassword = String(password || '').trim();

  const resp = { success: false };
  try {
    if (!normalizedUserCode || !normalizedPassword) {
      resp.success = true;
      resp.data = [];
      return res.json(resp);
    }

    const sql = `
      SELECT
        code AS user_code,
        name_1 AS user_name,
        address,
        telephone,
        COALESCE(
          (SELECT tax_id FROM ar_customer_detail WHERE ar_code = code),
          ''
        ) AS tax_id,
        '' AS contact_code,
        '' AS contact_name,
        'customer' AS login_source,
        0 AS login_priority
      FROM ar_customer
      WHERE (UPPER(code) = UPPER($1) OR UPPER(COALESCE(email, '')) = UPPER($1))
        AND COALESCE(fax, '') = $2

      UNION ALL

      SELECT
        cus.code AS user_code,
        cus.name_1 AS user_name,
        cus.address,
        cus.telephone,
        COALESCE(
          (SELECT tax_id FROM ar_customer_detail WHERE ar_code = cus.code),
          ''
        ) AS tax_id,
        COALESCE(con.roworder::text, '') AS contact_code,
        COALESCE(con.name, '') AS contact_name,
        'contact' AS login_source,
        1 AS login_priority
      FROM ar_contactor con
      JOIN ar_customer cus ON cus.code = con.ar_code
      WHERE COALESCE(con.telephone, '') = $1
        AND COALESCE(con.mobile, '') = $2

      ORDER BY login_priority, user_code, contact_code
    `;
    const result = await query(sql, [normalizedUserCode, normalizedPassword]);

    const data = result.rows.map((r) => ({
      user_code: r.user_code,
      user_name: r.user_name,
      address: r.address,
      telephone: r.telephone,
      tax_id: r.tax_id,
      contact_code: r.contact_code || '',
      contact_name: r.contact_name || '',
      login_source: r.login_source || 'customer',
      // ผู้ติดต่อ (ar_contactor) ล็อกอินแล้วได้ user_code เป็นรหัสลูกค้าที่สังกัด
      // จึงใช้ค่าเดียวกันเป็นตัวตนได้ ส่วนรหัสผู้ติดต่อเก็บแยกไว้ใน cc
      token: signToken({ sub: r.user_code, typ: 'customer', cc: r.contact_code || '' }),
    }));

    resp.success = true;
    resp.data = data;
    return res.json(resp);
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

module.exports = router;
