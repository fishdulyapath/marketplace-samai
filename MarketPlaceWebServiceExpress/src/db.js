require('./loadEnv');
const { Pool } = require('pg');

// ── ขนาด connection pool ────────────────────────────────────────────────
//
// เดิม max: 10 ทั้งสอง pool ซึ่งน้อยเกินไปสำหรับ /sendorder
// วัดจริงแล้ว: สั่งซื้อพร้อมกัน 8 คน = สำเร็จหมด · 11 คน = ล้มทั้งหมดด้วย
// "timeout exceeded when trying to connect" เพราะ checkout ถือ connection ไว้
// ตลอด transaction ที่ advisory lock บังคับให้ทำทีละคน พอเกิน 10 คน connection หมด
//
// ⚠️ ขยาย pool ช่วยได้ถึงระดับหนึ่งเท่านั้น — advisory lock ทำให้ throughput
//    เพดานอยู่ที่ ~1/เวลาต่อออเดอร์ (วัดได้ 270ms → ~3.7 ออเดอร์/วินาที)
//    ถ้าต้องรับมากกว่านี้ ต้องลดขอบเขต lock ให้ครอบเฉพาะตอนออกเลขเอกสาร
//
// ⚠️ Postgres เครื่องนี้ max_connections = 100 และมีระบบอื่นใช้ร่วมอยู่
//    ค่ารวมของทุก instance ต้องไม่ชนเพดาน จึงเปิดให้ตั้งผ่าน env ได้
//    (ค่าเริ่มต้น 25 + 10 = 35 ต่อ instance)
const toPositiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  idleTimeoutMillis: toPositiveInt(process.env.DB_IDLE_TIMEOUT_MS, 30000),
  connectionTimeoutMillis: toPositiveInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10000),
};

// pool หลักรับงานเขียน (checkout/ยกเลิก) จึงต้องใหญ่กว่า
const POOL_MAX = toPositiveInt(process.env.DB_POOL_MAX, 25);
// pool รูปภาพ query สั้นและคืน connection เร็ว ไม่ต้องใหญ่เท่า
const POOL_MAX_IMAGES = toPositiveInt(process.env.DB_POOL_MAX_IMAGES, 10);

const pool = new Pool({ ...dbConfig, max: POOL_MAX, database: process.env.DB_NAME || 'demo' });
const poolImages = new Pool({ ...dbConfig, max: POOL_MAX_IMAGES, database: process.env.DB_IMAGES_NAME || 'demo_images' });

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

poolImages.on('error', (err) => {
  console.error('PostgreSQL poolImages error:', err.message);
});

async function query(sql, params) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function queryImages(sql, params) {
  const client = await poolImages.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, poolImages, query, queryImages, withTransaction };
