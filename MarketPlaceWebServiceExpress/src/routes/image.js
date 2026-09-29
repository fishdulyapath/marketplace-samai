const express = require('express');
const router = express.Router();
const { query, queryImages } = require('../db');
const { DOC_HISTORY_MARKETPLACE_ONLY, getDocHistoryMode, marketplaceDocWhere } = require('../utils/marketplaceSalesSettings');

const IMAGE_CACHE_SECONDS = 3600;

function applyImageCacheHeaders(res) {
  return res.set('Cache-Control', `public, max-age=${IMAGE_CACHE_SECONDS}, must-revalidate`);
}

function detectImageContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/png';
}

// GET /service/v1/getImageList?item_code=
router.get('/getImageList', async (req, res) => {
  const { item_code } = req.query;
  try {
    const result = await queryImages(
      'SELECT image_id, guid_code FROM images WHERE image_id = $1 ORDER BY image_order ASC',
      [item_code || '']
    );
    return applyImageCacheHeaders(res).json({ success: true, data: result.rows });
  } catch (ex) {
    return res.status(400).json({ ERROR: ex.message });
  }
});

// GET /service/v1/images?item_code=
router.get('/images', async (req, res) => {
  const { item_code } = req.query;
  if (!item_code || item_code.trim() === '') {
    return res.status(400).type('text/plain').send('ERROR: item_code is required');
  }

  try {
    const result = await queryImages(
      'SELECT image_file FROM images WHERE image_id = $1  limit 1',
      [item_code]
    );

    if (result.rows.length === 0 || !result.rows[0].image_file) {
      return res.status(404).type('text/plain').send('ERROR: image not found');
    }

    const imageBytes = result.rows[0].image_file;

    // ไฟล์ในฐานเป็น JPEG เกือบทั้งหมด ติดป้าย png ตายตัวจึงผิดชนิด
    // detectImageContentType มีอยู่ในไฟล์นี้แล้ว แต่เดิมใช้แค่ที่ delivery-proof-image
    return applyImageCacheHeaders(res.status(200).type(detectImageContentType(imageBytes)))
      .set('Content-Length', String(imageBytes.length))
      .send(imageBytes);
  } catch (ex) {
    return res.status(500).type('text/plain').send('ERROR: ' + ex.message);
  }
});

// GET /service/v1/imagesguid?guid_code=
router.get('/imagesguid', async (req, res) => {
  const { guid_code } = req.query;
  try {
    const result = await queryImages(
      'SELECT image_file FROM images WHERE guid_code = $1 limit 1',
      [guid_code || '']
    );

    // 🚨 เดิมตอบ 200 + PNG ว่าง + Cache-Control 1 ชั่วโมง = สั่งให้เบราว์เซอร์จำความพังไว้ทั้งชั่วโมง
    //    และ catch ด้านล่างก็กลืน error ทุกชนิดเป็น 200 เหมือนกัน จนแยกไม่ออกว่า "ไม่มีรูป" หรือ "พัง"
    //    ทำให้เหมือน /images ที่ตอบ 404/500 ตรงไปตรงมา (ฝั่งหน้าร้านใช้เป็น <img src> อย่างเดียว)
    if (result.rows.length === 0 || !result.rows[0].image_file) {
      return res.status(404).type('text/plain').send('ERROR: image not found');
    }

    const imageBytes = result.rows[0].image_file;

    return applyImageCacheHeaders(res.status(200).type(detectImageContentType(imageBytes)))
      .set('Content-Length', String(imageBytes.length))
      .send(imageBytes);
  } catch (ex) {
    return res.status(500).type('text/plain').send('ERROR: ' + ex.message);
  }
});

// GET /service/v1/delivery-proof-image?doc_no=&cust_code=&index=0
router.get('/delivery-proof-image', async (req, res) => {
  const docNo = String(req.query.doc_no || '').trim();
  const custCode = String(req.query.cust_code || '').trim();
  const index = Math.max(0, parseInt(req.query.index, 10) || 0);

  if (!docNo || !custCode) {
    return res.status(400).type('text/plain').send('ERROR: doc_no and cust_code are required');
  }

  try {
    const docHistoryMode = await getDocHistoryMode();
    const marketplaceWhere = docHistoryMode === DOC_HISTORY_MARKETPLACE_ONLY ? marketplaceDocWhere('t') : '';
    const result = await query(
      `SELECT img.image_file
       FROM sml_doc_images img
       WHERE img.image_id = $1
         AND img.image_file IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM ic_trans t
           WHERE t.doc_no = $1
             AND t.cust_code = $2
             ${marketplaceWhere}
             AND COALESCE(t.approve_code::text,'0') <> '0'
         )
       ORDER BY img.ctid
       LIMIT 1 OFFSET $3`,
      [docNo, custCode, index]
    );

    if (result.rows.length === 0 || !result.rows[0].image_file) {
      return res.status(404).type('text/plain').send('ERROR: delivery proof image not found');
    }

    const imageBytes = result.rows[0].image_file;
    return applyImageCacheHeaders(res.status(200).type(detectImageContentType(imageBytes)))
      .set('Content-Length', String(imageBytes.length))
      .send(imageBytes);
  } catch (ex) {
    return res.status(500).type('text/plain').send('ERROR: ' + ex.message);
  }
});

module.exports = router;
