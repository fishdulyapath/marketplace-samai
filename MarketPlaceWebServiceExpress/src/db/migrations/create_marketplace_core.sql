-- Marketplace core tables required before the API can serve cart/POS routes.
-- This migration is intentionally idempotent and only owns Marketplace data.
-- It must run before create_sale_premium.sql, which extends staff_cart_order.

CREATE TABLE IF NOT EXISTS public.staff_cart_order (
  roworder       SERIAL PRIMARY KEY,
  cust_code      VARCHAR(255),
  guid_code      VARCHAR(255),
  item_code      VARCHAR(255),
  unit_code      VARCHAR(255),
  item_type      NUMERIC DEFAULT 0,
  qty            NUMERIC DEFAULT 0,
  create_datetime TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  price          NUMERIC DEFAULT 0,
  wh_code        VARCHAR(255),
  shelf_code     VARCHAR(255),
  creator_code   VARCHAR(255),
  barcode        VARCHAR(255),
  item_name      VARCHAR(255),
  stand_value    NUMERIC DEFAULT 1,
  divide_value   NUMERIC DEFAULT 1,
  ratio          NUMERIC DEFAULT 1,
  remark         VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS staff_cart_order_cust_code_idx
  ON public.staff_cart_order (cust_code);

CREATE INDEX IF NOT EXISTS staff_cart_order_guid_cust_idx
  ON public.staff_cart_order (guid_code, cust_code);

CREATE TABLE IF NOT EXISTS public.pos_basket (
  basket_id   SMALLINT PRIMARY KEY,
  cust_code   VARCHAR(50)  NOT NULL DEFAULT '',
  cust_name   VARCHAR(255) NOT NULL DEFAULT '',
  inquiry_type SMALLINT     NOT NULL DEFAULT 1,
  vat_type    SMALLINT     NOT NULL DEFAULT 1,
  vat_rate    NUMERIC(5,2) NOT NULL DEFAULT 7.00,
  sale_code   VARCHAR(50)  NOT NULL DEFAULT '',
  sale_name   VARCHAR(255) NOT NULL DEFAULT '',
  status      VARCHAR(10)  NOT NULL DEFAULT 'empty',
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

INSERT INTO public.pos_basket (basket_id)
SELECT generate_series(1, 200)
ON CONFLICT (basket_id) DO NOTHING;
