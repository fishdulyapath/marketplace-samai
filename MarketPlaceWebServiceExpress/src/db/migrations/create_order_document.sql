-- เลขเอกสารคำสั่งซื้อ + idempotency (REQ4)
--
-- ตารางทั้งสองเป็นของ marketplace เอง SML ERP ไม่รู้จักและไม่ต้องรู้จัก
-- ไม่มีการเพิ่ม/แก้คอลัมน์ในตารางของ ERP
-- read path ของประวัติไม่ได้พึ่งตารางนี้ (derive จาก doc_no) — ตารางหายก็ยังอ่านประวัติได้
--
-- รันซ้ำได้ (idempotent)

-- ============================================================
-- แผนที่เลขย่อย → เลขหลัก
-- sub_doc_no เป็น PK = safety net กันเลขซ้ำระดับ DB ถ้า advisory lock หลุด
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_order_document (
  sub_doc_no   VARCHAR(30)  PRIMARY KEY,
  main_doc_no  VARCHAR(30)  NOT NULL,
  seq          SMALLINT     NOT NULL DEFAULT 1,
  doc_kind     VARCHAR(10)  NOT NULL DEFAULT 'ready',  -- 'ready' | 'preorder'
  request_id   VARCHAR(64)  DEFAULT '',
  cust_code    VARCHAR(25)  DEFAULT '',
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketplace_order_document_main_idx
  ON marketplace_order_document (main_doc_no);
CREATE INDEX IF NOT EXISTS marketplace_order_document_request_idx
  ON marketplace_order_document (request_id);
CREATE INDEX IF NOT EXISTS marketplace_order_document_cust_idx
  ON marketplace_order_document (cust_code, created_at DESC);

-- ============================================================
-- Idempotency: กันกดยืนยันซ้ำ / axios retry / refresh / เปิด 2 แท็บ
-- เก็บ response ที่เคยตอบไปทั้งก้อน เพื่อตอบซ้ำได้โดยไม่สร้างเอกสารใหม่
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_order_request (
  request_id    VARCHAR(64) PRIMARY KEY,
  cust_code     VARCHAR(25) NOT NULL DEFAULT '',
  response_json TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketplace_order_request_created_idx
  ON marketplace_order_request (created_at DESC);

-- ============================================================
-- ค่าตั้งระบบ (marketplace_sales_setting เป็นตารางของ marketplace เอง)
--   order_doc_pattern     รูปแบบเลขเอกสาร แก้ได้โดยไม่ต้อง deploy
--   cancel_doc_pattern    รูปแบบเลขใบยกเลิก (SOC)
--   order_doc_source      server | client — kill switch ของเฟส E
--   erp_max_lines_per_doc จำนวนบรรทัดสูงสุดต่อเอกสาร (0 = ไม่แบ่ง) — kill switch ของเฟส F
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_sales_setting (
  setting_key   VARCHAR(80) PRIMARY KEY,
  setting_value TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO marketplace_sales_setting (setting_key, setting_value) VALUES
  ('order_doc_pattern', 'BSWYYMMDD####'),
  ('cancel_doc_pattern', 'BSCYYMMDD####'),
  ('order_doc_source', 'client'),
  ('erp_max_lines_per_doc', '0')
ON CONFLICT (setting_key) DO NOTHING;
