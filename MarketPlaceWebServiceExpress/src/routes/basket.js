const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../db');
const { successResponse, failResponse } = require('../utils/response');

// GET /service/v1/getBasketList
// ดึงรายการตะกร้าทั้งหมด พร้อม item_count และ total_price จาก staff_cart_order
router.get('/getBasketList', async (req, res) => {
  try {
    const sql = `
      SELECT
        b.basket_id, b.cust_code, b.cust_name, b.inquiry_type, b.vat_type, b.vat_rate,
        b.sale_code, b.sale_name, b.status, b.updated_at,
        COALESCE(c.item_count, 0) AS total_items,
        COALESCE(c.total_price, 0) AS total_price
      FROM pos_basket b
      LEFT JOIN (
        SELECT cust_code, COUNT(*) AS item_count, SUM(qty * price) AS total_price
        FROM staff_cart_order
        WHERE cust_code LIKE 'BASKET-%'
        GROUP BY cust_code
      ) c ON c.cust_code = 'BASKET-' || b.basket_id::text
      ORDER BY b.basket_id
    `;
    const result = await query(sql, []);
    return successResponse(res, result.rows);
  } catch (ex) {
    console.error('getBasketList error:', ex.message);
    return failResponse(res, ex.message, 500);
  }
});

// POST /service/v1/setBasketInfo
// ตั้งค่าข้อมูลตะกร้า — เปิดใช้งาน (status = 'active')
router.post('/setBasketInfo', async (req, res) => {
  const { basket_id, cust_code = '', cust_name = '', inquiry_type = 1,
    vat_type = 1, vat_rate = 7.0, sale_code = '', sale_name = '' } = req.body;

  if (!basket_id) {
    return failResponse(res, 'basket_id is required', 400);
  }

  try {
    await query(
      `UPDATE pos_basket
       SET cust_code=$2, cust_name=$3, inquiry_type=$4, vat_type=$5, vat_rate=$6,
           sale_code=$7, sale_name=$8, status='active', updated_at=NOW()
       WHERE basket_id=$1`,
      [basket_id, cust_code, cust_name, inquiry_type, vat_type, vat_rate, sale_code, sale_name],
    );
    return successResponse(res, null);
  } catch (ex) {
    console.error('setBasketInfo error:', ex.message);
    return failResponse(res, ex.message, 500);
  }
});

// POST /service/v1/clearBasket
// เคลียร์ตะกร้า — ลบสินค้าทั้งหมดและรีเซ็ต pos_basket กลับ empty
router.post('/clearBasket', async (req, res) => {
  const { basket_id } = req.body;

  if (!basket_id) {
    return failResponse(res, 'basket_id is required', 400);
  }

  try {
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM staff_cart_order WHERE cust_code = 'BASKET-' || $1::text`,
        [basket_id],
      );
      await client.query(
        `UPDATE pos_basket
         SET cust_code='', cust_name='', sale_code='', sale_name='',
             status='empty', updated_at=NOW()
         WHERE basket_id=$1`,
        [basket_id],
      );
    });
    return successResponse(res, null);
  } catch (ex) {
    console.error('clearBasket error:', ex.message);
    return failResponse(res, ex.message, 500);
  }
});

// GET /service/v1/getItemReservedQty
// ดึงจำนวนหน่วยฐานที่ถูกจองจากทุกตะกร้า BASKET-% สำหรับสินค้าชิ้นนี้
router.get('/getItemReservedQty', async (req, res) => {
  const { item_code } = req.query;

  if (!item_code) {
    return failResponse(res, 'item_code is required', 400);
  }

  try {
    const result = await query(
      `SELECT COALESCE(SUM(qty::numeric * ratio::numeric), 0) AS reserved_base_units
       FROM staff_cart_order
       WHERE item_code = $1
         AND cust_code LIKE 'BASKET-%'`,
      [item_code],
    );
    return successResponse(res, {
      item_code,
      reserved_base_units: Number(result.rows[0].reserved_base_units),
    });
  } catch (ex) {
    console.error('getItemReservedQty error:', ex.message);
    return failResponse(res, ex.message, 500);
  }
});

module.exports = router;
