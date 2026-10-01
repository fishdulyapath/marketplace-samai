-- Additional read-model ERP contract for the disposable local test database only.
ALTER TABLE ic_trans ADD COLUMN used_status integer DEFAULT 0;
ALTER TABLE ic_trans_detail ADD COLUMN ref_doc_no text;
ALTER TABLE ap_ar_trans_detail ADD COLUMN doc_date date;
ALTER TABLE ap_ar_trans_detail ADD COLUMN billing_date date;
ALTER TABLE ap_ar_trans_detail ADD COLUMN last_status integer DEFAULT 0;
ALTER TABLE ap_ar_trans_detail ADD COLUMN sum_pay_money numeric DEFAULT 0;
ALTER TABLE ap_ar_trans_detail ADD COLUMN remark text;
CREATE TABLE cb_trans (doc_no text,trans_flag integer,total_amount_pay numeric,wallet_amount numeric);
CREATE TABLE sml_doc_images (image_id text,image_file bytea);
CREATE TABLE erp_user (code text,name_1 text);
