-- ระบบของแถมขาย (Sale Premium) — เฟส 2 ของ docs/sale-premium-plan.md
--
-- ตารางทั้งหมดในไฟล์นี้เป็นของ marketplace เอง SML ERP ไม่รู้จักและไม่ต้องรู้จัก
-- ไม่มีการเพิ่ม/แก้คอลัมน์ในตารางของ ERP แม้แต่ที่เดียว
-- ของแถมถูกบันทึกลง ic_trans_detail.is_permium ซึ่งเป็นคอลัมน์ที่ ERP มีและใช้อยู่แล้ว
--
-- รันซ้ำได้ (idempotent)

-- ============================================================
-- หัวโปรโมชัน
-- ============================================================
CREATE TABLE IF NOT EXISTS sml_sale_premium (
  roworder             SERIAL PRIMARY KEY,
  premium_code         VARCHAR(25)  NOT NULL,
  name_1               VARCHAR(255) NOT NULL,          -- ชื่อภาษาไทย
  name_2               VARCHAR(255) DEFAULT '',        -- ชื่อสำรอง (ใช้แบบเดียวกับ master data ของ ERP)
  name_eng_1           VARCHAR(255) DEFAULT '',        -- ชื่อภาษาอังกฤษ (languageDisplay.js ใช้ฟิลด์นี้)
  date_begin           DATE,
  date_end             DATE,
  important            SMALLINT     DEFAULT 0,         -- 0 = เปิดใช้งาน (ตามกลไกเดิมของ ubon)
  show_on_web          SMALLINT     DEFAULT 1,         -- 1 = แสดงบนหน้าร้าน (เทียบเท่า item_pattern='[W]' ของสินค้า)
  image_guid           VARCHAR(50)  DEFAULT '',        -- รูปโปรโมชัน อ้างอิงตาราง images; ว่าง = fallback ใช้รูปของแถมชิ้นแรก
  remark               VARCHAR(255) DEFAULT '',
  guid_code            VARCHAR(50)  DEFAULT '',
  creator_code         VARCHAR(25)  DEFAULT '',
  create_date_time_now TIMESTAMP    DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sml_sale_premium_code_uq
  ON sml_sale_premium (premium_code);

-- ใช้ค้นโปรโมชันที่ active ตามวันที่ — query หลักของหน้าร้าน
CREATE INDEX IF NOT EXISTS sml_sale_premium_active_idx
  ON sml_sale_premium (important, show_on_web, date_begin, date_end);

-- ============================================================
-- เงื่อนไข: ต้องซื้ออะไรบ้าง (AND ทุกแถว)
-- ============================================================
CREATE TABLE IF NOT EXISTS sml_sale_premium_condition (
  roworder     SERIAL PRIMARY KEY,
  premium_code VARCHAR(25)   NOT NULL,
  ic_code      VARCHAR(25)   NOT NULL,
  unit_code    VARCHAR(25)   NOT NULL,
  qty          NUMERIC(18,4) DEFAULT 0,
  stand_value  NUMERIC(18,4) DEFAULT 1,
  divide_value NUMERIC(18,4) DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sml_sale_premium_condition_code_idx
  ON sml_sale_premium_condition (premium_code);

-- ============================================================
-- ของแถม: ได้อะไรบ้าง
-- ============================================================
CREATE TABLE IF NOT EXISTS sml_sale_premium_free_list (
  roworder     SERIAL PRIMARY KEY,
  premium_code VARCHAR(25)   NOT NULL,
  ic_code      VARCHAR(25)   NOT NULL,
  unit_code    VARCHAR(25)   NOT NULL,
  qty          NUMERIC(18,4) DEFAULT 0,
  stand_value  NUMERIC(18,4) DEFAULT 1,
  divide_value NUMERIC(18,4) DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sml_sale_premium_free_list_code_idx
  ON sml_sale_premium_free_list (premium_code);

-- ============================================================
-- ตะกร้า: จำว่ารายการนี้เป็นโปรโมชันไหน เพื่อ expand ตอน checkout
-- staff_cart_order เป็นตารางของ marketplace เอง (สร้างจาก 001_marketplace_bootstrap.sql)
-- ไม่ใช่ตารางของ ERP
-- ============================================================
ALTER TABLE staff_cart_order ADD COLUMN IF NOT EXISTS sale_premium_code VARCHAR(25)  DEFAULT '';
ALTER TABLE staff_cart_order ADD COLUMN IF NOT EXISTS sale_premium_name VARCHAR(255) DEFAULT '';
ALTER TABLE staff_cart_order ADD COLUMN IF NOT EXISTS sale_premium_data TEXT         DEFAULT '';

-- ============================================================
-- ค่าตั้งระบบ: เปิด/ปิดของแถมทั้งระบบ (ค่าเริ่มต้น = ปิด)
-- marketplace_sales_setting เป็นตารางของ marketplace เอง
-- ปกติถูกสร้างตอน runtime โดย ensureSalesSettingsTables() แต่ประกาศซ้ำไว้กันกรณี
-- migration ถูกรันก่อนที่แอปจะเคยสตาร์ต (DDL ตรงกับ marketplaceSalesSettings.js)
-- ============================================================
CREATE TABLE IF NOT EXISTS marketplace_sales_setting (
  setting_key   VARCHAR(80) PRIMARY KEY,
  setting_value TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO marketplace_sales_setting (setting_key, setting_value)
VALUES ('sale_premium_enabled', '0')
ON CONFLICT (setting_key) DO NOTHING;
