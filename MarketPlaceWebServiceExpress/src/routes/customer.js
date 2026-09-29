const express = require('express');
const { requireAdmin, requireEmployee } = require('../auth/requireAdmin');
const { likeContains } = require('../utils/likePattern');
const router = express.Router();
const { query, withTransaction } = require('../db');

function normalizeCustomerBody(body = {}) {
  return {
    code: String(body.code || body.user_code || body.cust_code || '').trim(),
    name_1: String(body.name_1 || body.name || body.user_name || '').trim(),
    address: String(body.address || '').trim(),
    telephone: String(body.telephone || body.phone || '').trim(),
    email: String(body.email || '').trim(),
    website: String(body.website || body.gps || '').trim(),
    price_level: body.price_level === '' || body.price_level === undefined || body.price_level === null ? 0 : Number(body.price_level) || 0,
    tax_id: String(body.tax_id || body.tax_number || '').trim(),
    group_main: String(body.group_main || '').trim(),
    group_sub_1: String(body.group_sub_1 || '').trim(),
    group_sub_3: String(body.group_sub_3 || '').trim(),
    group_sub_4: String(body.group_sub_4 || '').trim(),
    logistic_area: String(body.logistic_area || '').trim(),
    sale_code: String(body.sale_code || '').trim(),
    dimension_1: String(body.dimension_1 || '').trim(),
    credit_money: body.credit_money === '' || body.credit_money === undefined || body.credit_money === null ? 0 : Number(body.credit_money) || 0,
    credit_money_max: body.credit_money_max === '' || body.credit_money_max === undefined || body.credit_money_max === null ? 0 : Number(body.credit_money_max) || 0,
    credit_day: body.credit_day === '' || body.credit_day === undefined || body.credit_day === null ? 0 : Number(body.credit_day) || 0,
    password: String(body.password || '').trim(),
  };
}

// 🚨 password (มาจาก ar_customer.fax) ต้องไม่หลุดออกไปโดยปริยาย
//    ค่าเริ่มต้นคือ "ไม่ส่ง" เพื่อให้ผู้เรียกใหม่ที่ลืมคิดเรื่องนี้ปลอดภัยไว้ก่อน
//    ที่ยังต้องส่งคือหน้าจัดการลูกค้า ซึ่ง AdminCustomers.vue ใช้ prefill ช่องรหัสผ่านตอนแก้ไข
//    และอยู่หลัง requireAdmin('admin.customers') แล้ว
function mapCustomerRow(r, { includePassword = false } = {}) {
  return {
    code: r.user_code || r.code || '',
    name: r.user_name || r.name_1 || r.name || '',
    name_1: r.user_name || r.name_1 || r.name || '',
    address: r.address || '',
    telephone: r.telephone || '',
    email: r.email || '',
    website: r.website || r.gps || '',
    gps: r.website || r.gps || '',
    price_level: r.price_level ?? 0,
    tax_id: r.tax_id || '',
    group_main: r.group_main || '',
    group_sub_1: r.group_sub_1 || '',
    group_sub_3: r.group_sub_3 || '',
    group_sub_4: r.group_sub_4 || '',
    logistic_area: r.logistic_area || '',
    logistic_area_name: r.logistic_area_name || '',
    sale_code: r.sale_code || '',
    sale_name: r.sale_name || '',
    dimension_1: r.dimension_1 || '',
    dimension_1_name: r.dimension_1_name || '',
    credit_money: r.credit_money ?? 0,
    credit_money_max: r.credit_money_max ?? 0,
    credit_day: r.credit_day ?? 0,
    ...(includePassword ? { password: r.password || '' } : {}),
  };
}

// GET /service/v1/getCustomerList
router.get('/getCustomerList', requireEmployee(), async (req, res) => {
  const { search = '', code = '' } = req.query;
  try {
    const params = [];
    let where = '';
    if (code) {
      params.push(code);
      where = ` AND UPPER(code) = UPPER($1)`;
    } else if (search) {
      params.push(likeContains(search));
      where = ` AND (code ILIKE $1 OR name_1 ILIKE $1)`;
    }
    const sql = `SELECT code AS user_code, name_1 AS user_name, address, telephone, COALESCE(email,'') AS email,
      COALESCE((SELECT tax_id FROM ar_customer_detail WHERE ar_code=code),'') AS tax_id
      FROM ar_customer WHERE 1=1 ${where} ORDER BY code ASC LIMIT 50`;
    const result = await query(sql, params);
    const data = result.rows.map(mapCustomerRow);
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getEmployeeList
router.get('/getEmployeeList', requireAdmin('admin.employees'), async (req, res) => {
  const { search = '', code = '', selectable_only = '' } = req.query;
  try {
    const params = [];
    const conditions = [];
    const selectableOnly = ['1', 'true'].includes(String(selectable_only).toLowerCase());

    if (selectableOnly) {
      conditions.push('COALESCE(mobile_user,0) <> 1');
    }

    if (code) {
      params.push(code);
      conditions.push(`UPPER(code) = UPPER($${params.length})`);
    } else if (search) {
      params.push(likeContains(search));
      conditions.push(`(code ILIKE $${params.length} OR name_1 ILIKE $${params.length})`);
    }

    const where = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
    const sql = `SELECT code, name_1 AS name FROM erp_user WHERE 1=1 ${where} LIMIT 50`;
    const result = await query(sql, params);
    const data = result.rows.map(r => ({ code: r.code, name: r.name }));
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getDimensionList
router.get('/getDimensionList', requireEmployee(), async (req, res) => {
  const { search = '' } = req.query;
  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(likeContains(search));
      where = ` WHERE code ILIKE $1 OR name_1 ILIKE $1`;
    }
    const result = await query(
      `SELECT code, COALESCE(name_1,'') AS name_1 FROM ar_dimension${where} ORDER BY code LIMIT 100`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

// GET /service/v1/getLogisticAreaList
router.get('/getLogisticAreaList', requireEmployee(), async (req, res) => {
  const { search = '' } = req.query;
  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(likeContains(search));
      where = ` WHERE code ILIKE $1 OR name_1 ILIKE $1`;
    }
    const result = await query(
      `SELECT code, COALESCE(name_1,'') AS name_1 FROM ar_logistic_area${where} ORDER BY code LIMIT 100`,
      params
    );
    return res.json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

// GET /service/v1/getCustomerCRM
router.get('/getCustomerCRM', requireEmployee(), async (req, res) => {
  const { search = '', limit = '50', offset = '0' } = req.query;
  const lim = parseInt(limit) || 50;
  const off = parseInt(offset) || 0;
  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(likeContains(search));
      where = ` AND (code ILIKE $1 OR name_1 ILIKE $1)`;
    }

    const countSql = `SELECT COUNT(*) AS total FROM ar_customer WHERE 1=1 ${where}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].total);

    const paramIdx = params.length + 1;
    const dataSql = `
      SELECT code AS user_code, name_1 AS user_name,
        COALESCE(address,'') AS address, COALESCE(telephone,'') AS telephone, COALESCE(email,'') AS email,
        COALESCE(website,'') AS website,
        COALESCE((SELECT logistic_area FROM ar_customer_detail WHERE ar_code=code),'') AS logistic_area,
        COALESCE((SELECT group_main FROM ar_customer_detail WHERE ar_code=code),'') AS group_main
      FROM ar_customer WHERE 1=1 ${where}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    const dataResult = await query(dataSql, [...params, lim, off]);
    const data = dataResult.rows.map(mapCustomerRow);

    const currentPage = Math.floor(off / lim) + 1;
    const totalPage = Math.ceil(total / lim);

    return res.json({
      success: true,
      data,
      pagination: { total, limit: lim, offset: off, current_page: currentPage, total_page: totalPage },
    });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getCustomerManageList
router.get('/getCustomerManageList', requireAdmin('admin.customers'), async (req, res) => {
  const { search = '', limit = '30', offset = '0' } = req.query;
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
  const off = Math.max(0, parseInt(offset, 10) || 0);

  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(likeContains(search));
      where = ` AND (c.code ILIKE $1 OR c.name_1 ILIKE $1 OR COALESCE(c.telephone,'') ILIKE $1 OR COALESCE(c.email,'') ILIKE $1)`;
    }

    const countResult = await query(`SELECT COUNT(*) AS total FROM ar_customer c WHERE 1=1 ${where}`, params);
    const total = parseInt(countResult.rows[0]?.total, 10) || 0;
    const idx = params.length + 1;
    const dataResult = await query(
      `SELECT c.code AS user_code, c.name_1 AS user_name,
              COALESCE(c.address,'') AS address,
              COALESCE(c.telephone,'') AS telephone,
              COALESCE(c.email,'') AS email,
              COALESCE(c.fax,'') AS password,
              COALESCE(c.website,'') AS website,
              COALESCE(c.price_level,0) AS price_level,
              COALESCE(d.tax_id,'') AS tax_id,
              COALESCE(d.group_main,'') AS group_main,
              COALESCE(d.group_sub_1,'') AS group_sub_1,
              COALESCE(d.group_sub_3,'') AS group_sub_3,
              COALESCE(d.group_sub_4,'') AS group_sub_4,
              COALESCE(d.logistic_area,'') AS logistic_area,
              COALESCE((SELECT name_1 FROM ar_logistic_area WHERE UPPER(code)=UPPER(d.logistic_area) LIMIT 1),'') AS logistic_area_name,
              COALESCE(d.sale_code,'') AS sale_code,
              COALESCE((SELECT name_1 FROM erp_user WHERE UPPER(code)=UPPER(d.sale_code) LIMIT 1),'') AS sale_name,
              COALESCE(d.dimension_1,'') AS dimension_1,
              COALESCE((SELECT name_1 FROM ar_dimension WHERE UPPER(code)=UPPER(d.dimension_1) LIMIT 1),'') AS dimension_1_name,
              COALESCE(d.credit_money,0) AS credit_money,
              COALESCE(d.credit_money_max,0) AS credit_money_max,
              COALESCE(d.credit_day,0) AS credit_day
       FROM ar_customer c
       LEFT JOIN ar_customer_detail d ON d.ar_code = c.code
       WHERE 1=1 ${where}
       ORDER BY c.code
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, lim, off]
    );

    return res.json({
      success: true,
      // หน้าจัดการลูกค้าต้องใช้ password prefill ช่องแก้ไข — จุดเดียวที่ยังส่งออกไป
      data: dataResult.rows.map((row) => mapCustomerRow(row, { includePassword: true })),
      pagination: {
        total,
        limit: lim,
        offset: off,
        current_page: Math.floor(off / lim) + 1,
        total_page: Math.ceil(total / lim),
      },
    });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/getNextCustomerCode
router.get('/getNextCustomerCode', requireAdmin('admin.customers'), async (_req, res) => {
  try {
    const result = await query(
      `SELECT CAST(SUBSTRING(code FROM 4) AS INTEGER) AS last_no
       FROM ar_customer
       WHERE code ~ '^OR-[0-9]+$'
       ORDER BY CAST(SUBSTRING(code FROM 4) AS INTEGER) DESC
       LIMIT 1`,
      []
    );
    let nextNo = (parseInt(result.rows[0]?.last_no, 10) || 0) + 1;
    let nextCode = `OR-${String(nextNo).padStart(5, '0')}`;

    for (let i = 0; i < 100; i++) {
      const exists = await query('SELECT 1 FROM ar_customer WHERE code=$1 LIMIT 1', [nextCode]);
      if (exists.rows.length === 0) {
        return res.json({ success: true, code: nextCode });
      }
      nextNo += 1;
      nextCode = `OR-${String(nextNo).padStart(5, '0')}`;
    }

    return res.status(409).json({ success: false, message: 'ไม่สามารถสร้างรหัสลูกค้าที่ไม่ซ้ำได้', ERROR: 'unable to generate unique customer code' });
  } catch (ex) {
    return res.status(400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

// GET /service/v1/getCustomerDetail
router.get('/getCustomerDetail', async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสลูกค้า' });

  try {
    const result = await query(
      `SELECT c.code AS user_code, c.name_1 AS user_name,
              COALESCE(c.address,'') AS address,
              COALESCE(c.telephone,'') AS telephone,
              COALESCE(c.email,'') AS email,
              -- 🚨 เดิมส่งคอลัมน์นี้ออกไปด้วย: COALESCE(c.fax,'') AS password
              --    endpoint นี้เป็นของหน้าโปรไฟล์ลูกค้า (CustomerProfile.vue) ซึ่งไม่เคยใช้ค่านี้เลย
              --    fillForm ตั้ง password: '' ตายตัว แต่ค่าจริงหลุดออกไปให้ใครก็ตามที่เรียกได้
              --    รวมกับการที่ชั้น 2 ไม่เคยคุมพารามิเตอร์ชื่อ 'code' = ดึงรหัสผ่านลูกค้าคนอื่นได้
              --    (getCustomerManageList ยังคงส่งอยู่ เพราะหน้าแอดมินใช้ prefill และอยู่หลัง requireAdmin แล้ว)
              COALESCE(c.website,'') AS website,
              COALESCE(c.price_level,0) AS price_level,
              COALESCE(d.tax_id,'') AS tax_id,
              COALESCE(d.group_main,'') AS group_main,
              COALESCE(d.group_sub_1,'') AS group_sub_1,
              COALESCE(d.group_sub_3,'') AS group_sub_3,
              COALESCE(d.group_sub_4,'') AS group_sub_4,
              COALESCE(d.logistic_area,'') AS logistic_area,
              COALESCE((SELECT name_1 FROM ar_logistic_area WHERE UPPER(code)=UPPER(d.logistic_area) LIMIT 1),'') AS logistic_area_name,
              COALESCE(d.sale_code,'') AS sale_code,
              COALESCE((SELECT name_1 FROM erp_user WHERE UPPER(code)=UPPER(d.sale_code) LIMIT 1),'') AS sale_name,
              COALESCE(d.dimension_1,'') AS dimension_1,
              COALESCE((SELECT name_1 FROM ar_dimension WHERE UPPER(code)=UPPER(d.dimension_1) LIMIT 1),'') AS dimension_1_name,
              COALESCE(d.credit_money,0) AS credit_money,
              COALESCE(d.credit_money_max,0) AS credit_money_max,
              COALESCE(d.credit_day,0) AS credit_day
       FROM ar_customer c
       LEFT JOIN ar_customer_detail d ON d.ar_code = c.code
       WHERE UPPER(c.code) = UPPER($1)
       LIMIT 1`,
      [code]
    );

    return res.json({ success: true, data: result.rows[0] ? mapCustomerRow(result.rows[0]) : null });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

async function upsertCustomerDetail(client, body) {
  const update = await client.query(
    `UPDATE ar_customer_detail
     SET tax_id=$2, group_main=$3, group_sub_1=$4, group_sub_3=$5, group_sub_4=$6,
         logistic_area=$7, credit_day=$8, sale_code=$9, credit_money=$10, credit_money_max=$11, dimension_1=$12
     WHERE ar_code=$1`,
    [body.code, body.tax_id, body.group_main, body.group_sub_1, body.group_sub_3, body.group_sub_4, body.logistic_area, body.credit_day, body.sale_code, body.credit_money, body.credit_money_max, body.dimension_1]
  );
  if (update.rowCount === 0) {
    await client.query(
      `INSERT INTO ar_customer_detail
       (ar_code, tax_id, group_main, group_sub_1, group_sub_3, group_sub_4, logistic_area, credit_day, sale_code, credit_money, credit_money_max, dimension_1)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [body.code, body.tax_id, body.group_main, body.group_sub_1, body.group_sub_3, body.group_sub_4, body.logistic_area, body.credit_day, body.sale_code, body.credit_money, body.credit_money_max, body.dimension_1]
    );
  }
}

async function upsertCustomerProfileDetail(client, body) {
  const update = await client.query(
    `UPDATE ar_customer_detail SET tax_id=$2 WHERE ar_code=$1`,
    [body.code, body.tax_id]
  );
  if (update.rowCount === 0) {
    await client.query(
      `INSERT INTO ar_customer_detail (ar_code, tax_id) VALUES ($1,$2)`,
      [body.code, body.tax_id]
    );
  }
}

// POST /service/v1/createCustomer
router.post('/createCustomer', requireAdmin('admin.customers'), async (req, res) => {
  const body = normalizeCustomerBody(req.body);
  if (!body.code || !body.name_1) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสลูกค้าและชื่อลูกค้า' });
  }
  if (!body.password) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสผ่านลูกค้า' });
  }

  try {
    const data = await withTransaction(async (client) => {
      const exists = await client.query('SELECT code FROM ar_customer WHERE UPPER(code)=UPPER($1) LIMIT 1', [body.code]);
      if (exists.rows.length > 0) {
        const err = new Error('รหัสลูกค้านี้มีอยู่แล้ว');
        err.statusCode = 409;
        throw err;
      }

      await client.query(
        `INSERT INTO ar_customer (code, name_1, address, telephone, email, website, price_level, fax)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [body.code, body.name_1, body.address, body.telephone, body.email, body.website, body.price_level, body.password]
      );
      await upsertCustomerDetail(client, body);

      return { ...body, password: undefined };
    });

    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(ex.statusCode || 400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

// POST /service/v1/updateCustomer
router.post('/updateCustomer', requireAdmin('admin.customers'), async (req, res) => {
  const body = normalizeCustomerBody(req.body);
  if (!body.code || !body.name_1) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสลูกค้าและชื่อลูกค้า' });
  }

  try {
    await withTransaction(async (client) => {
      const params = [body.name_1, body.address, body.telephone, body.email, body.website, body.price_level, body.password, body.code];
      const sql = `UPDATE ar_customer SET name_1=$1, address=$2, telephone=$3, email=$4, website=$5, price_level=$6, fax=$7 WHERE code=$8`;
      const updated = await client.query(sql, params);
      if (updated.rowCount === 0) {
        const err = new Error('ไม่พบรหัสลูกค้า');
        err.statusCode = 404;
        throw err;
      }
      await upsertCustomerDetail(client, body);
    });

    return res.json({ success: true, data: { ...body, password: undefined } });
  } catch (ex) {
    return res.status(ex.statusCode || 400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

// POST /service/v1/updateCustomerProfile
router.post('/updateCustomerProfile', async (req, res) => {
  const body = normalizeCustomerBody(req.body);
  if (!body.code || !body.name_1) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสลูกค้าและชื่อลูกค้า' });
  }

  try {
    await withTransaction(async (client) => {
      const params = [body.name_1, body.address, body.telephone, body.email];
      let sql = `UPDATE ar_customer SET name_1=$1, address=$2, telephone=$3, email=$4`;
      if (body.password) {
        params.push(body.password);
        sql += `, fax=$${params.length}`;
      }
      params.push(body.code);
      sql += ` WHERE code=$${params.length}`;

      const updated = await client.query(sql, params);
      if (updated.rowCount === 0) {
        const err = new Error('ไม่พบรหัสลูกค้า');
        err.statusCode = 404;
        throw err;
      }
      await upsertCustomerProfileDetail(client, body);
    });

    return res.json({ success: true, data: { ...body, password: undefined } });
  } catch (ex) {
    return res.status(ex.statusCode || 400).json({ success: false, message: ex.message, ERROR: ex.message });
  }
});

// POST /service/v1/deleteCustomer
router.post('/deleteCustomer', requireAdmin('admin.customers'), async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสลูกค้า' });

  try {
    await withTransaction(async (client) => {
      const used = await client.query('SELECT COUNT(*)::int AS used_count FROM ic_trans WHERE cust_code=$1', [code]);
      const usedCount = used.rows[0]?.used_count || 0;
      if (usedCount > 0) {
        const err = new Error('ลบไม่ได้ เพราะลูกค้าถูกใช้งานในเอกสารแล้ว');
        err.statusCode = 409;
        err.usedCount = usedCount;
        throw err;
      }

      await client.query('DELETE FROM ar_item_by_customer WHERE ar_code=$1', [code]).catch(() => {});
      await client.query('DELETE FROM ar_customer_detail WHERE ar_code=$1', [code]);
      const deleted = await client.query('DELETE FROM ar_customer WHERE code=$1', [code]);
      if (deleted.rowCount === 0) {
        const err = new Error('ไม่พบรหัสลูกค้า');
        err.statusCode = 404;
        throw err;
      }
    });

    return res.json({ success: true });
  } catch (ex) {
    return res.status(ex.statusCode || 400).json({
      success: false,
      message: ex.message,
      ERROR: ex.message,
      used_count: ex.usedCount || 0,
    });
  }
});

// GET /service/v1/getEmployeeCRM
router.get('/getEmployeeCRM', requireEmployee(), async (req, res) => {
  const { search = '', limit = '50', offset = '0' } = req.query;
  const lim = parseInt(limit) || 50;
  const off = parseInt(offset) || 0;
  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(likeContains(search));
      where = ` AND (code ILIKE $1 OR name_1 ILIKE $1)`;
    }
    const paramIdx = params.length + 1;
    const sql = `SELECT code, name_1 AS name FROM erp_user WHERE 1=1 ${where}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    const result = await query(sql, [...params, lim, off]);
    const data = result.rows.map(r => ({ code: r.code, name: r.name }));
    return res.json({ success: true, data });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

module.exports = router;
