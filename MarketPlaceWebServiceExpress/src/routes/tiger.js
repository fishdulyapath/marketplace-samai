const express = require('express');
const router = express.Router();
const { query } = require('../db');

// อ่าน config Tiger จาก erp_option แทน env
// ถ้าไม่มีข้อมูล → ระบบ Tiger ปิด → endpoint ทุกตัวจะคืน 503
async function loadTigerConfig() {
  const result = await query(
    'SELECT tiger_app_id, tiger_end_point, tiger_x_api_key FROM erp_option LIMIT 1',
  );
  const row = result.rows[0];
  if (!row) return null;
  const appId = (row.tiger_app_id || '').trim();
  const endPoint = (row.tiger_end_point || '').trim();
  const apiKey = (row.tiger_x_api_key || '').trim();
  if (!appId || !endPoint || !apiKey) return null;
  return { appId, endPoint, apiKey };
}

async function callTiger(path, { method = 'GET', body } = {}) {
  const cfg = await loadTigerConfig();
  if (!cfg) {
    const err = new Error('Tiger not configured');
    err.status = 503;
    throw err;
  }
  const url = `${cfg.endPoint.replace(/\/$/, '')}${path}`;
  console.log(`[tiger] ${method} ${url}`);
  const res = await fetch(url, {
    method,
    headers: {
      'app-id': cfg.appId,
      'x-api-key': cfg.apiKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || `Tiger API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// GET /service/v1/tiger/config — บอก frontend ว่าระบบ Tiger เปิดใช้งานหรือไม่
router.get('/tiger/config', async (req, res) => {
  try {
    const cfg = await loadTigerConfig();
    return res.json({ status: 'success', data: { enabled: !!cfg } });
  } catch (ex) {
    console.error('tiger config error:', ex.message);
    return res.status(500).json({ status: 'error', message: ex.message });
  }
});

// POST /service/v1/tiger/orders
router.post('/tiger/orders', async (req, res) => {
  try {
    const data = await callTiger('/orders', { method: 'POST', body: req.body });
    return res.json(data);
  } catch (ex) {
    console.error('tiger create error:', ex.message);
    return res.status(ex.status || 500).json({ status: 'error', message: ex.message });
  }
});

// GET /service/v1/tiger/orders/:id
router.get('/tiger/orders/:id', async (req, res) => {
  try {
    const data = await callTiger(`/orders/${encodeURIComponent(req.params.id)}`);
    return res.json(data);
  } catch (ex) {
    console.error('tiger inquire error:', ex.message);
    return res.status(ex.status || 500).json({ status: 'error', message: ex.message });
  }
});

// PUT /service/v1/tiger/orders/:id
router.put('/tiger/orders/:id', async (req, res) => {
  try {
    const data = await callTiger(`/orders/${encodeURIComponent(req.params.id)}`, {
      method: 'PUT',
      body: req.body,
    });
    return res.json(data);
  } catch (ex) {
    console.error('tiger cancel error:', ex.message);
    return res.status(ex.status || 500).json({ status: 'error', message: ex.message });
  }
});

module.exports = router;
