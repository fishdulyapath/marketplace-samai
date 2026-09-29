const { aggregateOrderRowsByMainDoc, resolveGroupStatus } = require('../../src/utils/orderHistoryAggregate');

// REQ4 — ยุบเอกสารย่อยเป็น 1 คำสั่งซื้อที่ลูกค้าเห็น

function row(overrides = {}) {
  return {
    doc_no: 'BSW2608010001-1',
    main_doc_no: 'BSW2608010001',
    doc_date: '2026-08-01',
    doc_time: '10:00',
    cust_code: 'AR001',
    status: 'pending',
    total_amount: 100,
    balance: 0,
    wallet_amount: 0,
    total_before_vat: 93,
    total_except_vat: 0,
    total_after_vat: 100,
    total_vat_value: 7,
    cn_total_amount: 0,
    delivery_image_count: 0,
    delivery_image_doc_no: '',
    ...overrides,
  };
}

describe('การยุบกลุ่ม', () => {
  it('เอกสารย่อย 3 ใบ → 1 รายการ ใช้เลขหลัก', () => {
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'BSW2608010001-1' }),
      row({ doc_no: 'BSW2608010001-2' }),
      row({ doc_no: 'BSW2608010001-3' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].doc_no).toBe('BSW2608010001');
    expect(result[0].sub_doc_count).toBe(3);
  });

  it('>>> ยอดเงินรวมจากทุกใบ', () => {
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'BSW2608010001-1', total_amount: 100, total_before_vat: 93, total_vat_value: 7 }),
      row({ doc_no: 'BSW2608010001-2', total_amount: 250, total_before_vat: 232.5, total_vat_value: 17.5 }),
      row({ doc_no: 'BSW2608010001-3', total_amount: 50, total_before_vat: 46.5, total_vat_value: 3.5 }),
    ]);
    expect(result[0].total_amount).toBe(400);
    expect(result[0].total_before_vat).toBe(372);
    expect(result[0].total_vat_value).toBe(28);
  });

  it('คำสั่งซื้อคนละเลขหลักไม่ปนกัน', () => {
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'BSW2608010001-1', main_doc_no: 'BSW2608010001', total_amount: 100 }),
      row({ doc_no: 'BSW2608010002', main_doc_no: 'BSW2608010002', total_amount: 300 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].total_amount).toBe(100);
    expect(result[1].total_amount).toBe(300);
  });

  it('ใช้วันเวลาของใบแรกสุด', () => {
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'BSW2608010001-1', doc_date: '2026-08-01', doc_time: '14:30' }),
      row({ doc_no: 'BSW2608010001-2', doc_date: '2026-08-01', doc_time: '09:15' }),
    ]);
    expect(result[0].doc_time).toBe('09:15');
  });
});

describe('🚨 ข้อมูลเก่าต้องไม่เปลี่ยนรูป', () => {
  it('เอกสาร MQT เดิมผ่านเป็น 1 รายการต่อ 1 ใบ ไม่ยุบรวม', () => {
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'MQT20250815-ABC12', main_doc_no: 'MQT20250815-ABC12', total_amount: 100 }),
      row({ doc_no: 'MQT20250815-XYZ99', main_doc_no: 'MQT20250815-XYZ99', total_amount: 200 }),
    ]);
    // ถ้ายุบรวมผิด จะเหลือ 1 แถวยอด 300 — ประวัติลูกค้าพัง
    expect(result).toHaveLength(2);
    expect(result[0].doc_no).toBe('MQT20250815-ABC12');
    expect(result[0].total_amount).toBe(100);
    expect(result[1].total_amount).toBe(200);
  });

  it('ยอดและ field เดิมไม่ถูกแก้เมื่อมีใบเดียว', () => {
    const input = row({ doc_no: 'MQT20250815-ABC12', main_doc_no: 'MQT20250815-ABC12', remark_qt: 'หมายเหตุ' });
    const [out] = aggregateOrderRowsByMainDoc([input]);
    expect(out.total_amount).toBe(input.total_amount);
    expect(out.remark_qt).toBe('หมายเหตุ');
    expect(out.status).toBe(input.status);
  });
});

describe('สถานะรวมของกลุ่ม', () => {
  it('ทุกใบยกเลิก → cancel', () => {
    expect(resolveGroupStatus(['cancel', 'cancel'])).toBe('cancel');
  });

  it('>>> บางใบยังไม่คืบหน้า → ใช้สถานะที่คืบหน้าน้อยสุด', () => {
    expect(resolveGroupStatus(['success', 'pending'])).toBe('pending');
    expect(resolveGroupStatus(['payment', 'packing'])).toBe('packing');
  });

  it('ทุกใบสำเร็จ → success', () => {
    expect(resolveGroupStatus(['success', 'success'])).toBe('success');
  });

  it('ยกเลิกบางใบ ไม่ทำให้ทั้งกลุ่มเป็น cancel', () => {
    expect(resolveGroupStatus(['cancel', 'packing'])).toBe('packing');
  });

  it('รายการว่างคืนค่าว่าง', () => {
    expect(resolveGroupStatus([])).toBe('');
  });
});

describe('🚨 รูปหลักฐานการส่ง', () => {
  it('delivery_image_doc_no ต้องเป็นเลขเอกสารจริง ไม่ใช่เลขหลัก', () => {
    // image.js ค้น sml_doc_images.image_id = doc_no ตรงตัว — ถ้าใส่เลขหลักรูปจะหายทั้งหมด
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'BSW2608010001-1', delivery_image_count: 0, delivery_image_doc_no: '' }),
      row({ doc_no: 'BSW2608010001-2', delivery_image_count: 2, delivery_image_doc_no: 'BSW2608010001-2' }),
    ]);
    expect(result[0].delivery_image_doc_no).toBe('BSW2608010001-2');
    expect(result[0].delivery_image_doc_no).not.toBe('BSW2608010001');
    expect(result[0].delivery_image_count).toBe(2);
  });

  it('รวมจำนวนรูปจากทุกใบ', () => {
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'BSW2608010001-1', delivery_image_count: 1, delivery_image_doc_no: 'BSW2608010001-1' }),
      row({ doc_no: 'BSW2608010001-2', delivery_image_count: 3, delivery_image_doc_no: 'BSW2608010001-2' }),
    ]);
    expect(result[0].delivery_image_count).toBe(4);
    // ใช้ใบแรกที่มีรูป
    expect(result[0].delivery_image_doc_no).toBe('BSW2608010001-1');
  });

  it('ไม่มีรูปเลย → doc_no ว่าง', () => {
    const result = aggregateOrderRowsByMainDoc([row({ delivery_image_count: 0 })]);
    expect(result[0].delivery_image_doc_no).toBe('');
  });
});

describe('field ข้อความ', () => {
  it('เอาค่าแรกที่ไม่ว่าง', () => {
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'BSW2608010001-1', remark_qt: '', emp_name: '' }),
      row({ doc_no: 'BSW2608010001-2', remark_qt: 'หมายเหตุ', emp_name: 'พนักงาน' }),
    ]);
    expect(result[0].remark_qt).toBe('หมายเหตุ');
    expect(result[0].emp_name).toBe('พนักงาน');
  });

  it('inv_doc_no เอาใบแรกที่มี', () => {
    const result = aggregateOrderRowsByMainDoc([
      row({ doc_no: 'BSW2608010001-1', inv_doc_no: '' }),
      row({ doc_no: 'BSW2608010001-2', inv_doc_no: 'INV001' }),
    ]);
    expect(result[0].inv_doc_no).toBe('INV001');
  });
});

describe('เคสขอบ', () => {
  it('input ว่าง', () => {
    expect(aggregateOrderRowsByMainDoc([])).toEqual([]);
    expect(aggregateOrderRowsByMainDoc(null)).toEqual([]);
  });

  it('ไม่มี main_doc_no ใช้ doc_no แทน', () => {
    const result = aggregateOrderRowsByMainDoc([{ doc_no: 'X001', status: 'pending' }]);
    expect(result[0].doc_no).toBe('X001');
  });

  it('ข้ามแถวที่ไม่มีเลขเอกสาร', () => {
    expect(aggregateOrderRowsByMainDoc([{ status: 'pending' }])).toEqual([]);
  });
});

describe('ใบย่อยที่ ERP ยกเลิก', () => {
  const row = (doc_no, status, total_amount) => ({
    doc_no,
    main_doc_no: 'BSW001',
    status,
    total_amount,
    doc_date: '2026-08-24',
    doc_time: '10:00',
  });

  test('ยกเลิกบางใบ: ยอดรวมคงเดิม แต่บอกยอดที่ตกไปและยอดสุทธิ', () => {
    const [g] = aggregateOrderRowsByMainDoc([
      row('BSW001-1', 'pending', 1361),
      row('BSW001-2', 'cancel', 1966),
      row('BSW001-3', 'pending', 1111),
    ]);
    expect(g.total_amount).toBe(4438);      // ยอดที่ ERP ออกเอกสารไว้ ไม่แตะ
    expect(g.cancelled_amount).toBe(1966);
    expect(g.cancelled_doc_count).toBe(1);
    expect(g.active_amount).toBe(2472);     // ยอดที่ยังเดินหน้าจริง
    expect(g.status).toBe('pending');        // ใบที่เหลือกำหนดสถานะ
  });

  test('ยกเลิกครบทุกใบ: สถานะเป็น cancel และยอดสุทธิเป็นศูนย์', () => {
    const [g] = aggregateOrderRowsByMainDoc([
      row('BSW001-1', 'cancel', 1361),
      row('BSW001-2', 'cancel', 1966),
    ]);
    expect(g.status).toBe('cancel');
    expect(g.cancelled_doc_count).toBe(2);
    expect(g.active_amount).toBe(0);
  });

  test('ไม่มีใบไหนยกเลิก: ยอดสุทธิเท่ายอดรวม', () => {
    const [g] = aggregateOrderRowsByMainDoc([row('BSW001-1', 'pending', 500), row('BSW001-2', 'pending', 300)]);
    expect(g.cancelled_amount).toBe(0);
    expect(g.cancelled_doc_count).toBe(0);
    expect(g.active_amount).toBe(800);
  });

  test('sub_docs เก็บสถานะรายใบไว้ให้หน้าจอ', () => {
    const [g] = aggregateOrderRowsByMainDoc([row('BSW001-1', 'pending', 100), row('BSW001-2', 'cancel', 200)]);
    expect(g.sub_docs).toEqual([
      { doc_no: 'BSW001-1', so_doc_no: '', inv_doc_no: '', status: 'pending', total_amount: 100 },
      { doc_no: 'BSW001-2', so_doc_no: '', inv_doc_no: '', status: 'cancel', total_amount: 200 },
    ]);
  });
});

describe('ใบย่อยเดินไป step ไม่พร้อมกัน', () => {
  const row = (doc_no, status, total_amount) => ({ doc_no, main_doc_no: 'BSW001', status, total_amount, doc_date: '2026-08-24', doc_time: '10:00' });

  test('ใบหนึ่งไปจัดของแล้ว อีกใบยังรอ = บอกว่าคืบหน้าไม่เท่ากัน', () => {
    const [g] = aggregateOrderRowsByMainDoc([row('BSW001-1', 'packing', 100), row('BSW001-2', 'pending', 200)]);
    expect(g.mixed_progress).toBe(true);
    expect(g.status).toBe('pending'); // สถานะรวมยังใช้ใบที่ช้าสุด
  });

  test('ทุกใบสถานะเดียวกัน = ไม่ต้องเตือน', () => {
    const [g] = aggregateOrderRowsByMainDoc([row('BSW001-1', 'packing', 100), row('BSW001-2', 'packing', 200)]);
    expect(g.mixed_progress).toBe(false);
  });

  test('ใบที่ยกเลิกไม่นับเป็นความคืบหน้าที่ต่างกัน', () => {
    const [g] = aggregateOrderRowsByMainDoc([row('BSW001-1', 'pending', 100), row('BSW001-2', 'cancel', 200)]);
    expect(g.mixed_progress).toBe(false);
    expect(g.cancelled_amount).toBe(200);
  });

  test('ใบเดียวไม่แตก = ไม่เตือน', () => {
    const [g] = aggregateOrderRowsByMainDoc([row('BSW001', 'packing', 100)]);
    expect(g.mixed_progress).toBe(false);
  });
});

// รีวิว 260908 สไลด์ 8: พนักงานแตก QT ใบเดียวเป็นใบสั่งขายหลายใบ
// แถวที่ได้จะมี doc_no (QT) เดียวกัน แต่ so_doc_no/inv_doc_no ต่างกัน
describe('🚨 QT ใบเดียวถูกแตกเป็นใบสั่งขายหลายใบ', () => {
  const soRow = (so_doc_no, inv_doc_no, status, invoiced_amount) => ({
    doc_no: 'MQT001',
    main_doc_no: 'MQT001',
    so_doc_no,
    inv_doc_no,
    status,
    // ยอดระดับ QT — ซ้ำมาทุกแถวเพราะเป็นใบเดียวกัน
    total_amount: 3000,
    total_before_vat: 2803.74,
    total_vat_value: 196.26,
    // ยอดระดับใบสั่งขาย/ใบกำกับ — ต่างกันจริงในแต่ละแถว
    invoiced_amount,
    balance: 0,
    doc_date: '2026-08-24',
    doc_time: '10:00',
  });

  test('ยอดของ QT ต้องไม่ถูกบวกซ้ำตามจำนวนใบสั่งขาย', () => {
    const [g] = aggregateOrderRowsByMainDoc([
      soRow('SO-1', 'INV-1', 'payment', 2231),
      soRow('SO-2', 'INV-2', 'payment', 850),
    ]);
    expect(g.total_amount).toBe(3000);
    expect(g.total_before_vat).toBe(2803.74);
    expect(g.total_vat_value).toBe(196.26);
  });

  test('ยอดออกบิลต้องรวมทุกใบกำกับ ไม่ใช่เห็นใบเดียว', () => {
    const [g] = aggregateOrderRowsByMainDoc([
      soRow('SO-1', 'INV-1', 'payment', 2231),
      soRow('SO-2', 'INV-2', 'payment', 850),
    ]);
    expect(g.invoiced_amount).toBe(3081);
  });

  test('เห็นใบสั่งขายครบทุกใบใน sub_docs', () => {
    const [g] = aggregateOrderRowsByMainDoc([
      soRow('SO-1', 'INV-1', 'payment', 2231),
      soRow('SO-2', 'INV-2', 'packing', 0),
    ]);
    expect(g.sub_docs.map((d) => d.so_doc_no)).toEqual(['SO-1', 'SO-2']);
    expect(g.sub_doc_count).toBe(2);
  });

  test('วันส่งเอาใบที่ช้าสุด ไม่ใช่ใบแรกที่เจอ', () => {
    // เซลส์แตกใบสั่งขาย 2 ใบแล้วนัดส่งคนละวัน — ลูกค้าได้ของครบเมื่อใบสุดท้ายถึง
    // ถ้าเอา "ค่าแรกที่เจอ" หน้าประวัติกับหน้ารายละเอียดจะโชว์วันคนละวัน เพราะเรียงแถวไม่เหมือนกัน
    const early = { ...soRow('SO-1', '', 'packing', 0), send_date: '2026-09-12', send_date_confirmed: 1 };
    const late = { ...soRow('SO-2', '', 'packing', 0), send_date: '2026-09-15', send_date_confirmed: 1 };
    expect(aggregateOrderRowsByMainDoc([early, late])[0].send_date).toBe('2026-09-15');
    expect(aggregateOrderRowsByMainDoc([late, early])[0].send_date).toBe('2026-09-15');
  });

  test('ใบไหนใบหนึ่งได้วันจากเอกสารจริง ถือว่ายืนยันแล้ว', () => {
    const confirmed = { ...soRow('SO-1', '', 'packing', 0), send_date: '2026-09-12', send_date_confirmed: 1 };
    const fromQt = { ...soRow('SO-2', '', 'packing', 0), send_date: '2026-09-10', send_date_confirmed: 0 };
    expect(aggregateOrderRowsByMainDoc([fromQt, confirmed])[0].send_date_confirmed).toBe(1);
  });

  test('สถานะรวมใช้ใบที่คืบหน้าน้อยสุด', () => {
    const [g] = aggregateOrderRowsByMainDoc([
      soRow('SO-1', 'INV-1', 'payment', 2231),
      soRow('SO-2', '', 'packing', 0),
    ]);
    expect(g.status).toBe('packing');
    expect(g.mixed_progress).toBe(true);
  });

  test('ยกเลิกใบสั่งขายบางใบ ยอดที่ตกไปต้องไม่บวมเป็นเท่าตัว', () => {
    const [g] = aggregateOrderRowsByMainDoc([
      soRow('SO-1', 'INV-1', 'cancel', 0),
      soRow('SO-2', 'INV-2', 'cancel', 0),
    ]);
    // ทั้งสองแถวเป็น QT ใบเดียวกัน ยอดที่ยกเลิกจึงเท่ากับยอดของ QT ใบเดียว
    expect(g.cancelled_amount).toBe(3000);
    expect(g.cancelled_doc_count).toBe(1);
    expect(g.active_amount).toBe(0);
  });

  test('เอกสารย่อยแบบเดิม (QT คนละใบ) ยังบวกยอดรวมเหมือนเดิม', () => {
    const [g] = aggregateOrderRowsByMainDoc([
      { doc_no: 'BSW001-1', main_doc_no: 'BSW001', so_doc_no: 'SO-1', inv_doc_no: '', status: 'pending', total_amount: 500, doc_date: '2026-08-24', doc_time: '10:00' },
      { doc_no: 'BSW001-2', main_doc_no: 'BSW001', so_doc_no: 'SO-2', inv_doc_no: '', status: 'pending', total_amount: 300, doc_date: '2026-08-24', doc_time: '10:00' },
    ]);
    expect(g.total_amount).toBe(800);
  });
});
