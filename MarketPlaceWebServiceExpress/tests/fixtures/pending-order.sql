-- Minimal ERP contract in a disposable local database, never a live ERP schema.
CREATE TABLE ar_customer (code text PRIMARY KEY, name_1 text, telephone text);
CREATE TABLE ar_contactor (ar_code text, roworder integer, name text, telephone text);
CREATE TABLE ic_inventory (code text PRIMARY KEY, name_1 text, name_2 text, name_eng_1 text, item_type integer DEFAULT 0, item_pattern text DEFAULT '[W]', tax_type integer DEFAULT 0);
CREATE TABLE ic_inventory_detail (ic_code text PRIMARY KEY, dimension_35 text, dimension_38 text, start_sale_wh text, start_sale_shelf text);
CREATE TABLE ic_inventory_set_detail (ic_set_code text, ic_code text, unit_code text, qty numeric, price numeric, sum_amount numeric, barcode text, price_ratio numeric, line_number integer, roworder integer);
CREATE TABLE ic_unit_use (ic_code text, code text, stand_value numeric DEFAULT 1, divide_value numeric DEFAULT 1, ratio numeric DEFAULT 1);
CREATE TABLE ic_inventory_barcode (ic_code text,unit_code text,barcode text);
CREATE TABLE ic_warehouse (code text PRIMARY KEY, name_1 text);
CREATE TABLE ic_shelf (whcode text, code text, name_1 text, PRIMARY KEY(whcode,code));
CREATE TABLE sml_sale_premium (premium_code text PRIMARY KEY,name_1 text,name_2 text,name_eng_1 text,image_guid text,date_begin date,date_end date,important integer DEFAULT 0,show_on_web integer DEFAULT 1,remark text);
CREATE TABLE sml_sale_premium_condition (premium_code text,ic_code text,unit_code text,qty numeric,stand_value numeric,divide_value numeric,roworder integer);
CREATE TABLE sml_sale_premium_free_list (LIKE sml_sale_premium_condition);
CREATE TABLE ic_trans (
  doc_no varchar(30), trans_flag integer, trans_type integer, doc_date date, doc_time text,
  doc_format_code text, cust_code text, creator_code text, sale_code text,
  doc_ref text, doc_ref_date date, last_status integer DEFAULT 0, approve_code integer DEFAULT 1,
  inquiry_type integer,vat_type integer,vat_rate numeric,send_date date,send_day integer,
  total_value numeric,total_vat_value numeric,total_after_vat numeric,total_amount numeric,total_before_vat numeric,total_discount numeric,
  remark text,remark_5 text,send_type integer,total_except_vat numeric,credit_day integer,credit_date date,branch_code text,
  PRIMARY KEY(doc_no,trans_flag)
);
CREATE TABLE ic_trans_detail (
  doc_no varchar(30),trans_flag integer,trans_type integer,doc_date date,doc_time text,doc_date_calc date,
  cust_code text,branch_code text,sale_code text,item_code text,item_name text,unit_code text,
  qty numeric,price numeric,sum_amount numeric,line_number integer,remark text,wh_code text,shelf_code text,
  stand_value numeric,divide_value numeric,ratio numeric,discount text,discount_amount numeric,barcode text,calc_flag integer,
  tax_type integer,sum_amount_exclude_vat numeric,total_vat_value numeric,price_exclude_vat numeric,is_permium integer,
  set_ref_line text,set_ref_price numeric,set_ref_qty numeric,item_type integer,item_code_main text,ref_guid text,price_set_ratio numeric,
  inquiry_type integer,vat_type integer, PRIMARY KEY(doc_no,trans_flag,line_number)
);
CREATE TABLE ic_trans_shipment (doc_no text,doc_date date,trans_flag integer,cust_code text,transport_name text,transport_address text,transport_telephone text,create_date_time_now timestamptz);
CREATE TABLE ap_ar_trans_detail (doc_no text,billing_no text,trans_flag integer);
INSERT INTO ar_customer VALUES ('C1','ลูกค้าทดสอบ','053 562 595'),('C2','ลูกค้าอื่น','');
INSERT INTO ic_inventory(code,name_1) VALUES ('P1','สินค้า 1'),('P2','สินค้า 2'),('SET1','สินค้าชุด'),('FREE1','ของแถม');
INSERT INTO ic_inventory_detail(ic_code,dimension_35,dimension_38) VALUES ('P1','0',''),('P2','0',''),('SET1','0',''),('FREE1','0','');
INSERT INTO ic_unit_use(ic_code,code) VALUES ('P1','EA'),('P2','EA'),('FREE1','EA');
INSERT INTO ic_warehouse VALUES ('W1','คลัง 1'),('W2','คลัง 2');
INSERT INTO ic_shelf VALUES ('W1','S1','ที่เก็บ 1'),('W2','S2','ที่เก็บ 2');
INSERT INTO ic_inventory_set_detail VALUES ('SET1','P1','EA',1,100,100,'',1,1,1),('SET1','P2','EA',2,0,0,'',0,2,2);
INSERT INTO sml_sale_premium(premium_code,name_1) VALUES ('PROMO','โปรโมชัน');
INSERT INTO sml_sale_premium_condition VALUES ('PROMO','P1','EA',1,1,1,1);
INSERT INTO sml_sale_premium_free_list VALUES ('PROMO','FREE1','EA',1,1,1,1);
