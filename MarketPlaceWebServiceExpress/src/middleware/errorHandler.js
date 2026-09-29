// ── ตาข่ายรับ error ของ Express ─────────────────────────────────────────
//
// Express 4 จับได้เฉพาะ throw แบบ sync กับ next(err) เท่านั้น
// ถ้า handler เป็น async แล้ว reject ออกมา Express จะไม่รู้เรื่อง
// กลายเป็น unhandled rejection แล้ว Node 23 ฆ่า process ทิ้ง (Express 5 ถึงจะจับให้เอง)
//
// wrapRouterAsync จึงครอบ handler ทุกตัวของ router ให้ส่ง rejection เข้า next()
// ทำตอน mount ใน index.js ทีเดียว ดีกว่าไล่แก้ 153 route ทีละตัว

// ครอบเฉพาะ handler ที่รับ (req, res, next) ไม่แตะ error middleware (4 พารามิเตอร์)
function wrapHandler(fn) {
  if (typeof fn !== 'function' || fn.length >= 4) return fn;
  const wrapped = function (req, res, next) {
    try {
      const result = fn.call(this, req, res, next);
      if (result && typeof result.then === 'function') {
        return result.catch(next);
      }
      return result;
    } catch (error) {
      return next(error);
    }
  };
  // คงชื่อและจำนวนพารามิเตอร์ไว้ เผื่อมีโค้ดอื่นตรวจ fn.length
  Object.defineProperty(wrapped, 'length', { value: fn.length });
  Object.defineProperty(wrapped, 'name', { value: fn.name || 'wrapped' });
  return wrapped;
}

// เดินเข้าไปใน router.stack แล้วครอบ handler ที่ลงทะเบียนไว้แล้ว
// ไม่เปลี่ยนลำดับ ไม่เพิ่ม/ลบ layer จึงไม่กระทบเส้นทางเดิม
function wrapRouterAsync(router) {
  // middleware ที่เป็นฟังก์ชันเดี่ยว (ไม่ใช่ router) เช่น licenseMiddleware / authMiddleware
  // ทั้งคู่เป็น async ถ้าไม่ครอบ rejection จะหลุดไปฆ่า process เหมือนเดิม
  if (typeof router === 'function' && !Array.isArray(router.stack)) return wrapHandler(router);

  const stack = router && router.stack;
  if (!Array.isArray(stack)) return router;

  for (const layer of stack) {
    if (layer.route && Array.isArray(layer.route.stack)) {
      for (const routeLayer of layer.route.stack) {
        routeLayer.handle = wrapHandler(routeLayer.handle);
      }
    } else if (typeof layer.handle === 'function' && layer.handle.stack) {
      wrapRouterAsync(layer.handle);
    } else if (typeof layer.handle === 'function') {
      layer.handle = wrapHandler(layer.handle);
    }
  }
  return router;
}

// error middleware ตัวสุดท้ายของ chain
// ตอบข้อความกลางๆ ไม่ส่ง stack หรือข้อความของ Postgres ออกไปให้ client
// (ตอนตรวจระบบพบว่าหลาย endpoint พ่น error ของ PG ดิบๆ ออกไป เช่น
//  'invalid byte sequence for encoding "UTF8"' ซึ่งบอกโครงสร้างภายในให้ผู้โจมตี)
function errorHandler(err, req, res, _next) {
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : Number.isInteger(err?.status) ? err.status : 500;

  // log ให้ครบเสมอ ไม่งั้นบั๊กจะถูกกลืนจนตามไม่เจอ
  console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}:`, err?.message || err);
  if (status >= 500 && err?.stack) console.error(err.stack);

  if (res.headersSent) return;

  // 4xx ที่โค้ดตั้งใจโยนเอง ส่งข้อความของมันไปได้ (เป็นข้อความที่เขียนให้ผู้ใช้อ่าน)
  // ส่วน 5xx คือข้อผิดพลาดที่ไม่ได้คาดไว้ ห้ามส่งรายละเอียดออกไป
  const message = status < 500 && err?.message ? err.message : 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง';

  res.status(status).json({ success: false, message, ERROR: message });
}

module.exports = { errorHandler, wrapRouterAsync, wrapHandler };
