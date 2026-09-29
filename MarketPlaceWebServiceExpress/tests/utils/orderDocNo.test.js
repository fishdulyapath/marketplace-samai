const {
  buildDocPattern,
  splitPattern,
  maxRunningFromDocNos,
  formatSubDocNo,
  mainDocNoOf,
  MAIN_DOC_NO_SQL,
  docNoPrefixCondition,
  isValidDocNoParam,
} = require('../../src/utils/orderDocNo');

// REQ4 — เลขเอกสาร BSW + running รีเซ็ตรายวัน + suffix เอกสารย่อย

describe('buildDocPattern', () => {
  it('แทนที่ YYMMDD ด้วยวันที่จริง', () => {
    expect(buildDocPattern('BSWYYMMDD####', '2026-08-01')).toBe('BSW260801####');
  });

  it('รองรับ YYYY', () => {
    expect(buildDocPattern('BSWYYYYMMDD####', '2026-08-01')).toBe('BSW20260801####');
  });

  it('วันที่ผิดรูปแบบ คืน pattern เดิม', () => {
    expect(buildDocPattern('BSWYYMMDD####', 'ไม่ใช่วันที่')).toBe('BSWYYMMDD####');
  });

  it('pattern ว่างใช้ค่า default', () => {
    expect(buildDocPattern('', '2026-08-01')).toBe('BSW260801####');
  });
});

describe('splitPattern', () => {
  it('แยก prefix กับความยาว running', () => {
    expect(splitPattern('BSW260801####')).toEqual({ prefix: 'BSW260801', runLen: 4 });
  });

  it('ไม่มี # → runLen = 0', () => {
    expect(splitPattern('BSW260801')).toEqual({ prefix: 'BSW260801', runLen: 0 });
  });
});

describe('maxRunningFromDocNos', () => {
  const P = 'BSW260801';

  it('หาเลขสูงสุดจากเอกสารของวันนั้น', () => {
    expect(maxRunningFromDocNos(['BSW2608010001', 'BSW2608010007', 'BSW2608010003'], P, 4)).toBe(7);
  });

  it('>>> ต้องนับเลขที่มี suffix ด้วย ไม่งั้นออกเลขซ้ำ', () => {
    // BSW2608010009-3 คือ running 9 ที่ถูกแบ่งเป็นใบย่อย
    expect(maxRunningFromDocNos(['BSW2608010001', 'BSW2608010009-3'], P, 4)).toBe(9);
  });

  it('>>> ต้องไม่นับเลขของ prefix อื่น (ข้อมูลเก่า MQT/PREQT)', () => {
    expect(maxRunningFromDocNos(['MQT20260801-ABC12', 'PREQT20260801-XYZ99', 'BSW2608010002'], P, 4)).toBe(2);
  });

  it('ไม่นับเลขของวันอื่น', () => {
    expect(maxRunningFromDocNos(['BSW2607310099', 'BSW2608010002'], P, 4)).toBe(2);
  });

  it('ไม่มีเอกสารเลย → 0 (เริ่มที่ 1)', () => {
    expect(maxRunningFromDocNos([], P, 4)).toBe(0);
    expect(maxRunningFromDocNos(null, P, 4)).toBe(0);
  });

  it('ความยาว running ไม่ตรงไม่นับ', () => {
    expect(maxRunningFromDocNos(['BSW26080100001'], P, 4)).toBe(0);
  });
});

describe('formatSubDocNo', () => {
  it('>>> ใบเดียวไม่มี suffix — เลขที่ลูกค้าเห็นตรงกับใน ERP', () => {
    expect(formatSubDocNo('BSW2608010001', 1, 1)).toBe('BSW2608010001');
  });

  it('หลายใบต่อท้ายด้วยลำดับ', () => {
    expect(formatSubDocNo('BSW2608010001', 1, 4)).toBe('BSW2608010001-1');
    expect(formatSubDocNo('BSW2608010001', 4, 4)).toBe('BSW2608010001-4');
  });
});

describe('mainDocNoOf', () => {
  it('เลขย่อย → เลขหลัก', () => {
    expect(mainDocNoOf('BSW2608010001-2')).toBe('BSW2608010001');
  });

  it('เลขใบเดียวคืนค่าเดิม', () => {
    expect(mainDocNoOf('BSW2608010001')).toBe('BSW2608010001');
  });

  it('🚨 ข้อมูลเก่า MQT ต้องคืนค่าเดิมทั้งหมด ห้ามตัดที่ขีด', () => {
    // ถ้าตัด จะกลายเป็น MQT20250815 ทำให้ทุกใบของวันเดียวกันยุบรวมกัน ประวัติลูกค้าพัง
    expect(mainDocNoOf('MQT20250815-ABC12')).toBe('MQT20250815-ABC12');
    expect(mainDocNoOf('PREQT20250815-XYZ99')).toBe('PREQT20250815-XYZ99');
    expect(mainDocNoOf('MSOC20250815-12345')).toBe('MSOC20250815-12345');
  });

  it('เลขที่ไม่รู้จักคืนค่าเดิม', () => {
    expect(mainDocNoOf('INV-2026-001')).toBe('INV-2026-001');
    expect(mainDocNoOf('')).toBe('');
  });

  it('suffix ต้องเป็นตัวเลข 1-3 หลักเท่านั้น', () => {
    expect(mainDocNoOf('BSW2608010001-ABC')).toBe('BSW2608010001-ABC');
    expect(mainDocNoOf('BSW2608010001-1234')).toBe('BSW2608010001-1234');
  });
});

describe('MAIN_DOC_NO_SQL', () => {
  it('มี regex guard ไม่ใช่ split_part เปล่าๆ', () => {
    const sql = MAIN_DOC_NO_SQL('ic_qt');
    expect(sql).toContain('ic_qt.doc_no ~');
    expect(sql).toContain('^BSW[0-9]{10}');
    expect(sql).toContain('split_part');
    expect(sql).toContain('ELSE ic_qt.doc_no');
  });

  it('regex ใน SQL ตรงกับที่ mainDocNoOf ใช้', () => {
    const sql = MAIN_DOC_NO_SQL('d');
    const match = /~ '([^']+)'/.exec(sql);
    const re = new RegExp(match[1]);
    expect(re.test('BSW2608010001-2')).toBe(true);
    expect(re.test('BSW2608010001')).toBe(true);
    expect(re.test('MQT20250815-ABC12')).toBe(false);
  });
});

describe('docNoPrefixCondition + isValidDocNoParam', () => {
  it('ค้นทั้งเลขตรงตัวและเลขย่อย', () => {
    const cond = docNoPrefixCondition('d', 1);
    expect(cond).toBe("(d.doc_no = $1 OR d.doc_no LIKE $1 || '-%')");
  });

  it('กัน wildcard ของ LIKE หลุดเข้ามา', () => {
    expect(isValidDocNoParam('BSW2608010001')).toBe(true);
    expect(isValidDocNoParam('MQT20250815-ABC12')).toBe(true);
    expect(isValidDocNoParam('%')).toBe(false);
    expect(isValidDocNoParam('BSW_001')).toBe(false);
    expect(isValidDocNoParam("'; DROP TABLE--")).toBe(false);
    expect(isValidDocNoParam('')).toBe(false);
  });
});

describe('วงจรออกเลขจริง', () => {
  it('ออกเลขถัดไปจากที่มีอยู่', () => {
    const pattern = buildDocPattern('BSWYYMMDD####', '2026-08-01');
    const { prefix, runLen } = splitPattern(pattern);
    const existing = ['BSW2608010001', 'BSW2608010002-1', 'BSW2608010002-2'];
    const next = maxRunningFromDocNos(existing, prefix, runLen) + 1;
    const mainDocNo = prefix + String(next).padStart(runLen, '0');

    expect(mainDocNo).toBe('BSW2608010003');
    expect(formatSubDocNo(mainDocNo, 1, 2)).toBe('BSW2608010003-1');
  });

  it('วันใหม่เริ่มนับ 1 ใหม่', () => {
    const pattern = buildDocPattern('BSWYYMMDD####', '2026-08-02');
    const { prefix, runLen } = splitPattern(pattern);
    const yesterdayDocs = ['BSW2608010099'];
    expect(maxRunningFromDocNos(yesterdayDocs, prefix, runLen) + 1).toBe(1);
    expect(prefix + '0001').toBe('BSW2608020001');
  });
});
