process.env.AUTH_TOKEN_SECRET = 'test-secret-do-not-use-in-production';

const { signToken } = require('../../src/auth/token');
const { authMiddleware, isPublic, claimedCustomerCodes } = require('../../src/auth/authMiddleware');

const makeReq = (over = {}) => ({
    method: 'GET',
    path: '/getorderhistory',
    originalUrl: '/service/v1/getorderhistory',
    headers: {},
    query: {},
    body: {},
    ...over,
});

function run(req) {
    const res = {
        statusCode: null,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.payload = body;
            return this;
        },
    };
    let passed = false;
    authMiddleware(req, res, () => {
        passed = true;
    });
    return { passed, status: res.statusCode, body: res.payload };
}

const bearer = (claims) => ({ authorization: `Bearer ${signToken(claims)}` });

beforeEach(() => {
    process.env.AUTH_MODE = 'enforce';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('allowlist หน้าร้านสาธารณะ', () => {
    it('หน้าร้านเปิดดูได้โดยไม่ล็อกอิน', () => {
        for (const path of ['/getProductList', '/getProductDetail', '/getCategoryList', '/content/home', '/logincus', '/servertime']) {
            expect(isPublic(makeReq({ path }))).toBe(true);
        }
    });

    it('sales-settings / content / media เปิดเฉพาะ GET — POST ต้องผ่านการตรวจ', () => {
        // ถ้า path พวกนี้หลุดไปอยู่ใน PUBLIC_EXACT ด้วย POST จะข้ามการตรวจแล้วแอดมินจะเจอ 401
        for (const path of ['/sales-settings', '/content/home', '/media']) {
            expect(isPublic(makeReq({ path, method: 'GET' }))).toBe(true);
            expect(isPublic(makeReq({ path, method: 'POST' }))).toBe(false);
        }
    });

    it('endpoint ข้อมูลลูกค้าไม่ได้อยู่ใน allowlist', () => {
        for (const path of ['/getorderhistory', '/getcartlist', '/sendorder', '/saveAdminPermissions']) {
            expect(isPublic(makeReq({ path }))).toBe(false);
        }
    });
});

describe('ชั้น 1 — ยืนยันตัวตน', () => {
    it('ไม่ส่ง token = 401', () => {
        const r = run(makeReq());
        expect(r.passed).toBe(false);
        expect(r.status).toBe(401);
        expect(r.body.code).toBe('AUTH_REQUIRED');
    });

    it('token ปลอม = 401', () => {
        const r = run(makeReq({ headers: { authorization: 'Bearer ปลอม.มาก' } }));
        expect(r.status).toBe(401);
    });

    it('token ถูกต้อง = ผ่าน และได้ req.auth', () => {
        const req = makeReq({ headers: bearer({ sub: 'AR00003', typ: 'customer' }) });
        expect(run(req).passed).toBe(true);
        expect(req.auth).toMatchObject({ userCode: 'AR00003', userType: 'customer', isEmployee: false });
    });
});

describe('ชั้น 2 — ขอบเขตข้อมูลลูกค้า', () => {
    const custToken = () => bearer({ sub: 'AR00003', typ: 'customer' });

    it('ลูกค้าขอข้อมูลตัวเอง = ผ่าน', () => {
        expect(run(makeReq({ headers: custToken(), query: { cust_code: 'AR00003' } })).passed).toBe(true);
    });

    it('ตัวพิมพ์เล็กใหญ่ไม่ทำให้ถูกปฏิเสธผิดๆ', () => {
        expect(run(makeReq({ headers: custToken(), query: { cust_code: 'ar00003' } })).passed).toBe(true);
    });

    it('ลูกค้าขอข้อมูลคนอื่น = 403 (เคสที่พิสูจน์ช่องโหว่)', () => {
        const r = run(makeReq({ headers: custToken(), query: { cust_code: 'JK-00254' } }));
        expect(r.passed).toBe(false);
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('AUTH_SCOPE_DENIED');
    });

    it('ดักใน body ด้วย ไม่ใช่แค่ query (sendorder ส่งมาทาง body)', () => {
        const r = run(makeReq({ method: 'POST', path: '/sendorder', headers: custToken(), body: { cust_code: 'JK-00254' } }));
        expect(r.status).toBe(403);
    });

    it('ไม่มี cust_code ในคำขอ = ผ่าน (ไม่ได้อ้างอะไร)', () => {
        expect(run(makeReq({ headers: custToken() })).passed).toBe(true);
    });

    it('พนักงานอ้าง cust_code ของใครก็ได้ = ผ่าน (สั่งแทนลูกค้าเป็นฟีเจอร์)', () => {
        const r = run(makeReq({ headers: bearer({ sub: 'EMP01', typ: 'employee' }), query: { cust_code: 'JK-00254' } }));
        expect(r.passed).toBe(true);
    });
});

describe('โหมด audit', () => {
    beforeEach(() => {
        process.env.AUTH_MODE = 'audit';
    });

    it('ไม่มี token ก็ปล่อยผ่าน แต่ log ไว้', () => {
        const r = run(makeReq());
        expect(r.passed).toBe(true);
        expect(console.warn).toHaveBeenCalled();
    });

    it('cust_code ข้ามคนก็ปล่อยผ่าน แต่ log ไว้', () => {
        const r = run(makeReq({ headers: bearer({ sub: 'AR00003', typ: 'customer' }), query: { cust_code: 'JK-00254' } }));
        expect(r.passed).toBe(true);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('cust_code ไม่ตรง'));
    });
});

describe('โหมด off', () => {
    it('ปิดสนิท ไม่ตรวจอะไรเลย', () => {
        process.env.AUTH_MODE = 'off';
        expect(run(makeReq({ query: { cust_code: 'JK-00254' } })).passed).toBe(true);
    });
});

describe('claimedCustomerCodes', () => {
    it('เก็บได้ทั้งจาก query และ body และตัดช่องว่าง', () => {
        expect(claimedCustomerCodes({ query: { cust_code: ' A1 ' }, body: { cust_code: 'B2' } })).toEqual(['A1', 'B2']);
    });

    it('ค่าว่างหรือไม่มีคีย์ถือว่าไม่ได้อ้าง', () => {
        expect(claimedCustomerCodes({ query: { cust_code: '  ' }, body: { cust_code: null } })).toEqual([]);
        expect(claimedCustomerCodes({})).toEqual([]);
    });

    // ⚠️ เทสต์เดิมยืนยันว่า "ไม่ใช่สตริง = ไม่ได้อ้าง" ซึ่งเป็นการรับรองบั๊กเอาไว้
    //    route ฝั่งปลายทาง String() ค่าพวกนี้ใช้งานได้ (['AP002'] -> 'AP002')
    //    ปล่อยผ่านด่านนี้จึงเท่ากับสั่งซื้อแทนลูกค้าคนอื่นได้ ต้องนับเป็นรหัสที่อ้างสิทธิ์
    it('ส่งเป็นอาร์เรย์หรือตัวเลข ก็ยังนับว่าอ้างสิทธิ์', () => {
        expect(claimedCustomerCodes({ body: { cust_code: ['AP002'] } })).toEqual(['AP002']);
        expect(claimedCustomerCodes({ body: { cust_code: ['AP002', 'AP003'] } })).toEqual(['AP002', 'AP003']);
        expect(claimedCustomerCodes({ body: { cust_code: 123 } })).toEqual(['123']);
    });

    it('object ที่ String() แล้วไม่ตรงกับรหัสใคร ต้องยังถูกนับ เพื่อให้ถูกปฏิเสธ', () => {
        expect(claimedCustomerCodes({ body: { cust_code: { x: 'AP002' } } })).toEqual(['[object Object]']);
    });
});
