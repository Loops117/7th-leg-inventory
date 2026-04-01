-- User-facing sale date and ship date (independent of created_at / status timestamps)
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS sale_date date;

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS ship_date date;

COMMENT ON COLUMN public.sales_orders.sale_date IS 'Business date of the sale; UI may default from created_at when null.';
COMMENT ON COLUMN public.sales_orders.ship_date IS 'Date the order shipped; optional until shipped.';
