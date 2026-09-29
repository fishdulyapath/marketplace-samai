// ตั้ง secret ก่อน require เสมอ ไม่งั้นโมดูลจะสุ่ม ephemeral secret ให้
process.env.AUTH_TOKEN_SECRET = 'test-secret-do-not-use-in-production';

const { signToken, verifyToken, assertSecretConfiguredForEnforce } = require('../../src/auth/token');

describe('signToken / verifyToken', () => {
    it('เซ็นแล้วตรวจกลับได้ พร้อมข้อมูลตัวตนครบ', () => {
        const token = signToken({ sub: 'AR00003', typ: 'customer', cc: 'CT-1' });
        const payload = verifyToken(token);
        expect(payload).toMatchObject({ sub: 'AR00003', typ: 'customer', cc: 'CT-1' });
        expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('typ ที่ไม่ใช่ employee ถูกบังคับเป็น customer (กันการยกระดับสิทธิ์ด้วยค่าแปลกๆ)', () => {
        expect(verifyToken(signToken({ sub: 'X', typ: 'admin' })).typ).toBe('customer');
        expect(verifyToken(signToken({ sub: 'X', typ: 'employee' })).typ).toBe('employee');
    });

    it('แก้ payload แม้ตัวอักษรเดียว = ใช้ไม่ได้', () => {
        const token = signToken({ sub: 'AR00003', typ: 'customer' });
        const [body, sig] = token.split('.');
        const tampered = Buffer.from(JSON.stringify({ sub: 'AR99999', typ: 'employee', exp: 9999999999 })).toString('base64url');
        expect(verifyToken(`${tampered}.${sig}`)).toBeNull();
        expect(verifyToken(`${body}x.${sig}`)).toBeNull();
    });

    it('แก้ลายเซ็น = ใช้ไม่ได้', () => {
        const token = signToken({ sub: 'AR00003', typ: 'customer' });
        const [body] = token.split('.');
        expect(verifyToken(`${body}.aaaa`)).toBeNull();
    });

    it('secret คนละตัว = ใช้ไม่ได้', () => {
        const token = signToken({ sub: 'AR00003', typ: 'customer' });
        const original = process.env.AUTH_TOKEN_SECRET;
        process.env.AUTH_TOKEN_SECRET = 'another-secret';
        expect(verifyToken(token)).toBeNull();
        process.env.AUTH_TOKEN_SECRET = original;
        expect(verifyToken(token)).not.toBeNull();
    });

    it('หมดอายุแล้ว = ใช้ไม่ได้', () => {
        const original = process.env.AUTH_TOKEN_TTL_HOURS;
        // TTL ติดลบ/ศูนย์จะตกไปใช้ค่า default จึงต้องปลอมเวลาแทน
        const realNow = Date.now;
        const token = signToken({ sub: 'AR00003', typ: 'customer' });
        Date.now = () => realNow() + 13 * 3600 * 1000; // เลย TTL 12 ชม.
        expect(verifyToken(token)).toBeNull();
        Date.now = realNow;
        process.env.AUTH_TOKEN_TTL_HOURS = original;
    });

    it('ค่าขยะไม่ทำให้ throw — คืน null เฉยๆ', () => {
        for (const bad of [null, undefined, '', '   ', 'abc', 'a.b.c', '.', 'x.', '.y', 123, {}, []]) {
            expect(() => verifyToken(bad)).not.toThrow();
            expect(verifyToken(bad)).toBeNull();
        }
    });

    it('token ที่ไม่มี sub = ใช้ไม่ได้ (กัน token ว่างเปล่าที่ผ่านลายเซ็น)', () => {
        expect(verifyToken(signToken({ sub: '', typ: 'customer' }))).toBeNull();
    });
});

describe('assertSecretConfiguredForEnforce', () => {
    it('มี secret = ผ่าน', () => {
        expect(() => assertSecretConfiguredForEnforce()).not.toThrow();
    });

    it('ไม่มี secret = โยน error พร้อมบอกวิธีสร้าง', () => {
        const original = process.env.AUTH_TOKEN_SECRET;
        delete process.env.AUTH_TOKEN_SECRET;
        expect(() => assertSecretConfiguredForEnforce()).toThrow(/AUTH_TOKEN_SECRET/);
        process.env.AUTH_TOKEN_SECRET = original;
    });
});
