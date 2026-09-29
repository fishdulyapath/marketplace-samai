-- MarketPlace production bootstrap.
-- Safe to re-run. This file only creates marketplace-owned structures and
-- adds customer columns the web/admin features read or write.
--
-- Existing ERP product pricing and related-product tables are intentionally
-- left untouched because their schema belongs to the main ERP system.

BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_cart_order (
    roworder serial PRIMARY KEY,
    cust_code varchar(255),
    guid_code varchar(255),
    item_code varchar(255),
    unit_code varchar(255),
    item_type numeric DEFAULT 0,
    qty numeric DEFAULT 0,
    create_datetime timestamp without time zone DEFAULT now(),
    price numeric DEFAULT 0,
    wh_code varchar(255),
    shelf_code varchar(255),
    creator_code varchar(255),
    barcode varchar(255),
    item_name varchar(255),
    stand_value numeric DEFAULT 1,
    divide_value numeric DEFAULT 1,
    ratio numeric DEFAULT 1,
    remark varchar(255)
);

CREATE INDEX IF NOT EXISTS staff_cart_order_cust_code_idx
    ON public.staff_cart_order (cust_code);

CREATE INDEX IF NOT EXISTS staff_cart_order_guid_cust_idx
    ON public.staff_cart_order (guid_code, cust_code);

CREATE TABLE IF NOT EXISTS public.pos_basket (
    basket_id smallint PRIMARY KEY,
    cust_code varchar(50) NOT NULL DEFAULT '',
    cust_name varchar(255) NOT NULL DEFAULT '',
    inquiry_type smallint NOT NULL DEFAULT 1,
    vat_type smallint NOT NULL DEFAULT 1,
    vat_rate numeric(5,2) NOT NULL DEFAULT 7.00,
    sale_code varchar(50) NOT NULL DEFAULT '',
    sale_name varchar(255) NOT NULL DEFAULT '',
    status varchar(10) NOT NULL DEFAULT 'empty',
    updated_at timestamp NOT NULL DEFAULT now()
);

INSERT INTO public.pos_basket (basket_id)
SELECT generate_series(1, 200)
ON CONFLICT (basket_id) DO NOTHING;

ALTER TABLE IF EXISTS public.ar_customer
    ADD COLUMN IF NOT EXISTS email varchar(255);

ALTER TABLE IF EXISTS public.ar_customer
    ADD COLUMN IF NOT EXISTS website varchar(255);

ALTER TABLE IF EXISTS public.ar_customer
    ADD COLUMN IF NOT EXISTS price_level numeric DEFAULT 0;

ALTER TABLE IF EXISTS public.ar_customer
    ADD COLUMN IF NOT EXISTS country varchar(255);

ALTER TABLE IF EXISTS public.ar_customer_detail
    ADD COLUMN IF NOT EXISTS tax_id varchar(255);

ALTER TABLE IF EXISTS public.ar_customer_detail
    ADD COLUMN IF NOT EXISTS group_main varchar(255);

ALTER TABLE IF EXISTS public.ar_customer_detail
    ADD COLUMN IF NOT EXISTS group_sub_1 varchar(255);

ALTER TABLE IF EXISTS public.ar_customer_detail
    ADD COLUMN IF NOT EXISTS group_sub_3 varchar(255);

ALTER TABLE IF EXISTS public.ar_customer_detail
    ADD COLUMN IF NOT EXISTS group_sub_4 varchar(255);

ALTER TABLE IF EXISTS public.ar_customer_detail
    ADD COLUMN IF NOT EXISTS logistic_area varchar(255);

ALTER TABLE IF EXISTS public.ar_customer_detail
    ADD COLUMN IF NOT EXISTS credit_day numeric DEFAULT 0;

COMMIT;
