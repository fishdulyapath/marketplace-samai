const { mapOrderRow, buildDeliveryRemark, buildPickupRemark } = require('../../src/routes/order');

// กติกาสถานะ 4 ระดับ (รีวิว 260908 สไลด์ 8)
describe('mapOrderRow status', () => {
  const row = (over = {}) => ({ doc_no: 'MQT1', status: 'pending', balance: '0', ...over });

  test('ยังไม่มีใบสั่งขาย = รอตรวจสอบ', () => {
    expect(mapOrderRow(row({ status: 'pending' })).status).toBe('pending');
  });

  test('มีใบสั่งขายแล้ว = กำลังจัดสินค้า', () => {
    expect(mapOrderRow(row({ status: 'packing' })).status).toBe('packing');
  });

  test('ออกใบกำกับแล้ว = เตรียมนำส่ง-กำลังนำส่ง', () => {
    expect(mapOrderRow(row({ status: 'payment' })).status).toBe('payment');
  });

  test('ชำระครบแล้ว = จัดส่งสำเร็จ', () => {
    expect(mapOrderRow(row({ status: 'success', balance: '0' })).status).toBe('success');
  });

  test('มีใบเสร็จแต่ยังค้างชำระ = ยังนับเป็นกำลังนำส่ง ไม่ใช่จัดส่งสำเร็จ', () => {
    expect(mapOrderRow(row({ status: 'success', balance: '1500' })).status).toBe('payment');
    expect(mapOrderRow(row({ status: 'success', balance: 250.5 })).status).toBe('payment');
  });

  test('ไม่มีสถานะ partial หลุดออกไปอีกแล้ว', () => {
    for (const balance of ['0', '999']) {
      for (const status of ['pending', 'packing', 'payment', 'success', 'cancel']) {
        expect(mapOrderRow(row({ status, balance })).status).not.toBe('partial');
      }
    }
  });

  test('ใบที่ยกเลิกไม่ถูกเปลี่ยนสถานะแม้มียอดค้าง', () => {
    expect(mapOrderRow(row({ status: 'cancel', balance: '800' })).status).toBe('cancel');
  });
});

// ข้อมูลรับเองต้องลงหมายเหตุของ QT (รีวิว 260908 สไลด์ 6)
describe('buildDeliveryRemark pickup', () => {
  const pickup = { date: '10/09/2026', timeSlot: '09:00-10:00', receiver: 'สมชาย', vehicle: 'กข 1234' };

  test('รับเองประกอบข้อความครบและต่อท้ายด้วยหมายเหตุลูกค้า', () => {
    expect(buildDeliveryRemark('0', '', 'ฝากไว้หน้าร้าน', pickup))
      .toBe('รับเอง 10/09/2026 09:00-10:00 ผู้รับ: สมชาย ทะเบียน: กข 1234 ฝากไว้หน้าร้าน');
  });

  test('ส่งให้ยังใช้รูปแบบเดิม ไม่ปนข้อมูลรับเอง', () => {
    expect(buildDeliveryRemark('1', '123 ถนนA', 'ด่วน', pickup)).toBe('ส่งให้ 123 ถนนA ด่วน');
  });

  test('รับเองที่ไม่มีข้อมูลเลย เหลือแต่หมายเหตุลูกค้า', () => {
    expect(buildDeliveryRemark('0', '', 'ทดสอบ', {})).toBe('ทดสอบ');
    expect(buildDeliveryRemark('0', '', '', {})).toBe('');
  });

  test('ข้ามช่องที่ยังไม่กรอก', () => {
    expect(buildPickupRemark({ date: '10/09/2026' })).toBe('รับเอง 10/09/2026');
  });
});
