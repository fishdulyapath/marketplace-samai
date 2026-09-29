const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.join(__dirname, '..');
const lifecycle = String(process.env.npm_lifecycle_event || '').toLowerCase();
const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
const envName = process.env.MARKETPLACE_ENV || (lifecycle === 'dev' ? 'development' : nodeEnv);
const envFile = envName ? path.join(rootDir, `.env.${envName}`) : '';

if (envFile && fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
} else {
  dotenv.config();
}

// บังคับ timezone ของ process เป็นเวลาไทย (REQ6)
// ต้องอยู่ในไฟล์นี้เพราะ index.js/db.js require เป็นบรรทัดแรกสุด จึงเซ็ตก่อน Date ตัวแรกของระบบ
// utils/serverTime.js ไม่ได้พึ่งค่านี้อยู่แล้ว — ตรงนี้เป็นชั้นป้องกันสำหรับโค้ดเดิมที่ยังใช้ new Date() ตรงๆ
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Bangkok';
}
