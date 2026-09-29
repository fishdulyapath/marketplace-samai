// ── ปุ่มชำระเงินด้วย QR Code ──────────────────────────────────────────────
//
// ปุ่มพวกนี้เดิมขึ้นตามสถานะคำสั่งซื้ออย่างเดียว (payment) โดยไม่สนว่าตั้งค่า
// คีย์ของ QR API ไว้หรือยัง ถ้าไม่ได้ตั้ง ลูกค้าจะกดได้ตามปกติ รอ loading
// แล้วเจอ toast แดง "สร้าง QR ไม่สำเร็จ" — เจอทางตันหลังกดไปแล้ว
//
// เว้นคีย์ว่าง = ยังไม่เปิดใช้ช่องทางนี้ ให้ซ่อนปุ่มไปเลย
// (MarketPlaceWeb/.env.production.local ตั้ง VITE_QR_API_KEY= และ VITE_QR_API_URL= ว่างไว้จริงทั้งคู่)

export function isQrPaymentConfigured(env) {
    const source = env || import.meta.env || {};
    const hasValue = (value) => String(value ?? '').trim().length > 0;
    // ต้องครบทั้งคู่ ขาดตัวใดตัวหนึ่งก็ยิง API ไม่ได้อยู่ดี
    return hasValue(source.VITE_QR_API_KEY) && hasValue(source.VITE_QR_API_URL);
}
