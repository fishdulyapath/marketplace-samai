import { describe, expect, it } from 'vitest';
import { isQrPaymentConfigured } from '../src/utils/qrPayment';

// ปุ่มชำระเงิน QR ต้องหายไปเมื่อยังไม่ได้ตั้งคีย์ ไม่ใช่ให้กดแล้วเจอ error
describe('isQrPaymentConfigured', () => {
    it('ไม่ได้ตั้งคีย์ = ปิดใช้งาน', () => {
        expect(isQrPaymentConfigured({})).toBe(false);
        expect(isQrPaymentConfigured({ VITE_QR_API_KEY: undefined })).toBe(false);
        expect(isQrPaymentConfigured({ VITE_QR_API_KEY: null })).toBe(false);
    });

    it('คีย์ว่างหรือมีแต่ช่องว่าง = ปิดใช้งาน', () => {
        expect(isQrPaymentConfigured({ VITE_QR_API_KEY: '', VITE_QR_API_URL: 'https://x' })).toBe(false);
        expect(isQrPaymentConfigured({ VITE_QR_API_KEY: '   ', VITE_QR_API_URL: 'https://x' })).toBe(false);
    });

    it('มี URL แต่ไม่มีคีย์ หรือมีคีย์แต่ไม่มี URL = ปิดใช้งาน', () => {
        expect(isQrPaymentConfigured({ VITE_QR_API_URL: 'https://kapiqr.smlsoft.com/qrapi/create-promptpay-qrcode' })).toBe(false);
        expect(isQrPaymentConfigured({ VITE_QR_API_KEY: '1c867090de28' })).toBe(false);
        expect(isQrPaymentConfigured({ VITE_QR_API_KEY: '1c867090de28', VITE_QR_API_URL: '  ' })).toBe(false);
    });

    it('ครบทั้งคีย์และ URL = เปิดใช้งาน', () => {
        expect(
            isQrPaymentConfigured({
                VITE_QR_API_KEY: '1c867090de28',
                VITE_QR_API_URL: 'https://kapiqr.smlsoft.com/qrapi/create-promptpay-qrcode'
            })
        ).toBe(true);
    });
});
