const {
  ERP_CODE_SQL_PATTERN,
  ERP_CODE_SQL_PATTERN_OPTIONAL,
  isSafeErpCode,
  checkErpCode,
  checkErpCodes,
  filterErpCodeList,
} = require('../../src/utils/erpCodeGuard');

// เพย์โหลดที่ยิงจริงกับฐานทดสอบแล้วได้ผล — ยอดคงเหลือ 26 กลายเป็น 3,704,846
const REAL_PAYLOAD = "ZZZ') or 1=1 or ic_code in ('";
const BLIND_PAYLOAD = "ZZZ') or (select count(*) from ar_customer)>0 or ic_code in ('";

describe('isSafeErpCode — ปิดช่องที่ $1 กันไม่ได้', () => {
  it('รหัสจริงในฐานผ่านหมด', () => {
    for (const code of ['01-0006', '0100001', 'MAIN', '01', 'A/1', 'X_1', 'a.b']) {
      expect(isSafeErpCode(code)).toBe(true);
    }
  });

  it('พยัญชนะไทยล้วนผ่าน', () => {
    expect(isSafeErpCode('มก-001')).toBe(true);
  });

  it('รหัสไทยที่มีสระ/วรรณยุกต์ผ่าน เพื่อรองรับรหัสที่เก็บจาก master ERP', () => {
    expect(isSafeErpCode('ลัง24')).toBe(true);
    expect(isSafeErpCode('น้ำ')).toBe(true);
    expect(isSafeErpCode('หน้าร้าน')).toBe(true);
  });

  it('เพย์โหลดที่ยิงทะลุได้จริงต้องถูกปฏิเสธ', () => {
    expect(isSafeErpCode(REAL_PAYLOAD)).toBe(false);
    expect(isSafeErpCode(BLIND_PAYLOAD)).toBe(false);
  });

  it('อักขระที่ทำให้หลุดจาก string literal ถูกปฏิเสธทุกตัว', () => {
    for (const ch of ["'", '"', '\\', ';', '(', ')', '\n', '\r', '\t']) {
      expect(isSafeErpCode(`01${ch}06`)).toBe(false);
    }
  });

  it('ตัวคั่นของ gen_code_list เองก็ห้าม — กันการแอบขยายเป็นหลายรหัส/ช่วง', () => {
    expect(isSafeErpCode('01-0006,01-0007')).toBe(false); // , = คั่นรายการ
    expect(isSafeErpCode('01:99')).toBe(false); // : = ช่วง between
  });

  it('ค่าว่างและค่าที่ไม่ใช่สตริงไม่ผ่าน', () => {
    expect(isSafeErpCode('')).toBe(false);
    expect(isSafeErpCode(null)).toBe(false);
    expect(isSafeErpCode(undefined)).toBe(false);
  });

  it('ยาวเกิน 50 ตัวไม่ผ่าน แม้อักขระจะสะอาด', () => {
    expect(isSafeErpCode('A'.repeat(50))).toBe(true);
    expect(isSafeErpCode('A'.repeat(51))).toBe(false);
  });
});

describe('checkErpCode', () => {
  it('ค่าว่างผ่าน เพราะฟังก์ชัน ERP ใช้ \'\' แปลว่า "ไม่กรอง"', () => {
    expect(checkErpCode('', 'wh_code')).toBeNull();
    expect(checkErpCode('   ', 'wh_code')).toBeNull();
    expect(checkErpCode(undefined, 'wh_code')).toBeNull();
  });

  it('คืนข้อความไทยที่มีชื่อฟิลด์ ให้ผู้เรียกส่งกลับเป็น 400 ได้เลย', () => {
    expect(checkErpCode(REAL_PAYLOAD, 'item_code')).toBe('item_code มีอักขระที่ไม่อนุญาต');
    expect(checkErpCode('A'.repeat(60), 'wh_code')).toBe('wh_code ยาวเกินกำหนด');
    expect(checkErpCode("หน้าร้าน'", 'shelf_code')).toBe('shelf_code มีอักขระที่ไม่อนุญาต');
  });

  it('รองรับรหัสที่เก็บภาษาไทยจาก master', () => {
    expect(checkErpCode('หน้าร้าน', 'shelf_code')).toBeNull();
  });

  it('รหัสที่มีเว้นวรรคหัวท้ายยังผ่าน เพราะช่องว่างอยู่ใน allowlist', () => {
    expect(checkErpCode('  01-0006  ', 'item_code')).toBeNull();
  });

  // เดิม trim ก่อนตรวจ ทำให้ตรวจคนละค่ากับที่ route เอาไปต่อ SQL
  // item_code=%0A จึงได้ 200 เพราะ trim แล้วเหลือสตริงว่าง = ถือว่าไม่กรอง
  it('ช่องว่างที่ไม่ใช่ space ต้องไม่ถูก trim ทิ้งจนรอดด่าน', () => {
    expect(checkErpCode('\n', 'item_code')).toBe('item_code มีอักขระที่ไม่อนุญาต');
    expect(checkErpCode('\t', 'item_code')).toBe('item_code มีอักขระที่ไม่อนุญาต');
    expect(checkErpCode('01\r\n0006', 'item_code')).toBe('item_code มีอักขระที่ไม่อนุญาต');
  });
});

describe('checkErpCodes', () => {
  it('ผ่านหมดคืน null', () => {
    expect(checkErpCodes({ item_code: '01-0006', wh_code: 'MAIN', shelf_code: '' })).toBeNull();
  });

  it('คืน error ตัวแรกที่เจอ', () => {
    expect(checkErpCodes({ item_code: '01-0006', wh_code: REAL_PAYLOAD })).toBe('wh_code มีอักขระที่ไม่อนุญาต');
  });

  it('ไม่ส่งอะไรมาเลยก็ไม่พัง', () => {
    expect(checkErpCodes(null)).toBeNull();
    expect(checkErpCodes({})).toBeNull();
  });
});

describe('filterErpCodeList — ตะกร้าที่มีรหัสเสียหนึ่งตัวต้องไม่ล่มทั้งใบ', () => {
  it('ทิ้งเฉพาะตัวที่ไม่ผ่าน', () => {
    expect(filterErpCodeList(['01-0006', REAL_PAYLOAD, '01-0007'])).toEqual(['01-0006', '01-0007']);
  });

  it('ทิ้งค่าว่างและช่องว่างล้วน', () => {
    expect(filterErpCodeList(['01-0006', '', '   ', null, undefined])).toEqual(['01-0006']);
  });

  it('ผลลัพธ์ที่ join ด้วย , แล้วต้องไม่มีอักขระอันตรายหลงเหลือ', () => {
    const csv = filterErpCodeList(['01-0006', REAL_PAYLOAD]).join(',');
    expect(csv).not.toMatch(/['"\\;()]/);
  });

  it('ไม่ใช่อาร์เรย์คืนอาร์เรย์ว่าง', () => {
    expect(filterErpCodeList(null)).toEqual([]);
    expect(filterErpCodeList('01-0006')).toEqual([]);
  });
});

describe('ERP_CODE_SQL_PATTERN — ฝั่ง SQL ต้องคัดแบบเดียวกับฝั่ง JS', () => {
  it('เป็นค่าคงที่ในโค้ด ไม่มีอักขระที่จะทำให้ literal ใน SQL แตก', () => {
    expect(ERP_CODE_SQL_PATTERN).not.toMatch(/['\\]/);
  });

  it('ตัดสินเหมือนกันทั้งฝั่ง JS และ SQL สำหรับกรณีที่เป็น ASCII', () => {
    const sqlRe = new RegExp(ERP_CODE_SQL_PATTERN.replace('[[:alnum:]', '[A-Za-z0-9'));
    for (const code of ['01-0006', 'MAIN', 'A/1', REAL_PAYLOAD, "a'b", 'a,b', 'a:b']) {
      expect(sqlRe.test(code)).toBe(isSafeErpCode(code));
    }
  });

  // บั๊กจริงที่เคยหลุดไป: ใช้ + ทั้งสองที่ ทำให้ wh_code ว่างถูก SQL กรองทิ้ง
  // แต่ฝั่ง JS ปล่อยผ่าน สต็อกในตะกร้าเลยกลายเป็น 0 ทั้งที่ของเต็มคลัง
  it('ตัวที่ยอมให้ว่างได้ ต้องรับสตริงว่าง ส่วนตัวปกติต้องไม่รับ', () => {
    const req = new RegExp(ERP_CODE_SQL_PATTERN.replace('[[:alnum:]', '[A-Za-z0-9'));
    const opt = new RegExp(ERP_CODE_SQL_PATTERN_OPTIONAL.replace('[[:alnum:]', '[A-Za-z0-9'));
    expect(req.test('')).toBe(false);
    expect(opt.test('')).toBe(true);
  });

  it('ตัวที่ยอมให้ว่างได้ ต้องตัดสินตรงกับ checkErpCode ฝั่ง JS ทุกเคส', () => {
    const opt = new RegExp(ERP_CODE_SQL_PATTERN_OPTIONAL.replace('[[:alnum:]', '[A-Za-z0-9'));
    for (const code of ['', 'MAIN', 'WSA02', 'A/1', REAL_PAYLOAD, "a'b", 'a,b']) {
      expect(opt.test(code)).toBe(checkErpCode(code, 'wh_code') === null);
    }
  });

  it('นอกจากเรื่องค่าว่างแล้ว สองตัวต้องคัดเหมือนกัน', () => {
    const req = new RegExp(ERP_CODE_SQL_PATTERN.replace('[[:alnum:]', '[A-Za-z0-9'));
    const opt = new RegExp(ERP_CODE_SQL_PATTERN_OPTIONAL.replace('[[:alnum:]', '[A-Za-z0-9'));
    for (const code of ['01-0006', 'MAIN', 'A/1', REAL_PAYLOAD, "a'b", 'a,b', 'a:b']) {
      expect(opt.test(code)).toBe(req.test(code));
    }
  });
});
