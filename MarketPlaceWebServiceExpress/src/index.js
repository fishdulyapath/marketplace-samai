require('./loadEnv');
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const fs = require('fs');
const swaggerDocument = yaml.load(
  fs.readFileSync(require('path').join(__dirname, '../docs/api/openapi.yaml'), 'utf8')
);

const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/cart');
const productRoutes = require('./routes/product');
const orderRoutes = require('./routes/order');
const financialRoutes = require('./routes/financial');
const favoriteRoutes = require('./routes/favorite');
const documentRoutes = require('./routes/document');
const imageRoutes = require('./routes/image');
const customerRoutes = require('./routes/customer');
const posRoutes = require('./routes/pos');
const basketRoutes = require('./routes/basket');
const tigerRoutes = require('./routes/tiger');
const contentRoutes = require('./routes/content');
const mediaRoutes = require('./routes/media');
const adminPermissionRoutes = require('./routes/adminPermission');
const adminEmployeeRoutes = require('./routes/adminEmployee');
const salesSettingsRoutes = require('./routes/salesSettings');
const salePremiumRoutes = require('./routes/salePremium');
const adminReportRoutes = require('./routes/adminReports');
const { licenseMiddleware, licenseRouter, startLicenseScheduler } = require('./license');
const { authMiddleware, assertAuthConfig } = require('./auth/authMiddleware');
const { serverTimeInfo, serverNowIso } = require('./utils/serverTime');
const { queryParser } = require('./middleware/normalizeQuery');
const { errorHandler, wrapRouterAsync } = require('./middleware/errorHandler');
const { runMigrations } = require('./db/migrate');
const { pool, poolImages } = require('./db');

const app = express();
const PORT = process.env.PORT || 47300;

// ชั้น A - ยุบค่าใน query string ให้เป็นสตริงเสมอ
// `?cust_code=a&cust_code=b` เคยกลายเป็น array แล้วทำให้ `.trim()` โยน TypeError
// จน process ตายทั้งตัว (request เดียวจากภายนอก ไม่ต้องล็อกอิน)
// ตัดที่ชั้น parse ครอบทุก route พร้อมกัน ไม่ต้องไล่แก้ 43 จุด
app.set('query parser', queryParser);


app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'GUID',
    'configFileName',
    'databaseName',
    'Authorization',
    'Content-Type',
    'Accept',
    'Origin',
  ],
}));

// Increase parser limits for base64 image uploads and bulk product CSV imports.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.text({ type: 'text/*', limit: '50mb' }));
app.use('/media', express.static(mediaRoutes.MEDIA_DIR));

// แนบเวลา server ไปกับทุก response เพื่อให้ client sync clock skew ได้โดยไม่ต้องยิงเพิ่ม (REQ6)
app.use((req, res, next) => {
  res.set('X-Server-Time', serverNowIso());
  next();
});

// GET /service/v1/servertime — เวลาอ้างอิงของระบบ (Asia/Bangkok)
app.get('/service/v1/servertime', (req, res) => {
  res.json({ success: true, data: serverTimeInfo() });
});

// Routes — base path: /service/v1
app.use('/service/v1', wrapRouterAsync(licenseRouter));
app.use('/service/v1', wrapRouterAsync(licenseMiddleware));
// ยืนยันตัวตน + จำกัดขอบเขตข้อมูลลูกค้า — ต้องมาก่อน route ทั้งหมด
// ควบคุมด้วย AUTH_MODE (off | audit | enforce) ดู src/auth/authMiddleware.js
app.use('/service/v1', wrapRouterAsync(authMiddleware));
app.use('/service/v1', wrapRouterAsync(authRoutes));
app.use('/service/v1', wrapRouterAsync(cartRoutes));
app.use('/service/v1', wrapRouterAsync(productRoutes));
app.use('/service/v1', wrapRouterAsync(orderRoutes));
app.use('/service/v1', wrapRouterAsync(financialRoutes));
app.use('/service/v1', wrapRouterAsync(favoriteRoutes));
app.use('/service/v1', wrapRouterAsync(documentRoutes));
app.use('/service/v1', wrapRouterAsync(imageRoutes));
app.use('/service/v1', wrapRouterAsync(customerRoutes));
app.use('/service/v1', wrapRouterAsync(posRoutes));
app.use('/service/v1', wrapRouterAsync(basketRoutes));
app.use('/service/v1', wrapRouterAsync(tigerRoutes));
app.use('/service/v1', wrapRouterAsync(contentRoutes));
app.use('/service/v1', wrapRouterAsync(mediaRoutes));
app.use('/service/v1', wrapRouterAsync(adminPermissionRoutes));
app.use('/service/v1', wrapRouterAsync(adminEmployeeRoutes));
app.use('/service/v1', wrapRouterAsync(salesSettingsRoutes));
app.use('/service/v1', wrapRouterAsync(salePremiumRoutes));
app.use('/service/v1', wrapRouterAsync(adminReportRoutes));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// พังตอน start ดีกว่าพังตอนลูกค้าใช้งาน — โหมด enforce ที่ไม่มี AUTH_TOKEN_SECRET
// จะทำให้ token ทั้งระบบตายทุกครั้งที่ restart
assertAuthConfig();

// ชั้น B - error middleware ตัวสุดท้าย ต้องอยู่หลัง route ทั้งหมด
// จับทั้ง throw แบบ sync และ rejection ที่ wrapRouterAsync ส่งเข้า next()
app.use(errorHandler);

// ชั้น C - ตาข่ายสุดท้ายระดับ process
// unhandledRejection: แค่ request เดียวพัง ไม่ควรพาทั้งร้านลงไปด้วย จึง log แล้วไปต่อ
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] ไม่ควรมาถึงตรงนี้ - มี async ที่หลุดจาก wrapRouterAsync:', reason?.stack || reason);
});

// uncaughtException: สถานะของ process ไม่น่าไว้ใจแล้ว ปิดอย่างสุภาพให้ตัวคุม process เปิดใหม่
// (docker-compose ตั้ง restart: unless-stopped ไว้แล้ว)
let server = null;

process.on('uncaughtException', (error) => {
  console.error('[uncaughtException] ปิดตัวเพื่อให้เริ่มใหม่:', error?.stack || error);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
  setTimeout(() => process.exit(1), 5000).unref();
});

async function startServer() {
  await runMigrations();

  server = app.listen(PORT, () => {
    console.log(`MarketPlaceWebService Express running on port ${PORT}`);
    console.log(`Base URL: http://localhost:${PORT}/service/v1/`);
  });

  startLicenseScheduler();
  return server;
}

async function closePoolsAfterStartupFailure() {
  await Promise.allSettled([pool.end(), poolImages.end()]);
}

if (require.main === module) {
  startServer().catch(async (error) => {
    console.error('[startup] API not started:', error?.stack || error);
    await closePoolsAfterStartupFailure();
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = startServer;
