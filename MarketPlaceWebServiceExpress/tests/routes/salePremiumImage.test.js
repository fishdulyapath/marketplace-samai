const { parseSalePremiumImage } = require('../../src/routes/salePremium');

describe('sale premium image validation', () => {
  it('รับรูป PNG แบบ data URL และแปลงเป็น Buffer', () => {
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const result = parseSalePremiumImage(png1x1);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('ปฏิเสธไฟล์ที่ไม่ใช่ชนิดรูปที่รองรับ', () => {
    expect(() => parseSalePremiumImage('data:text/plain;base64,SGVsbG8=')).toThrow(
      'รองรับรูป JPG, PNG, WEBP หรือ GIF เท่านั้น',
    );
  });
});
