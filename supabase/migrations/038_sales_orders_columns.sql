-- Backfill columns when public.sales_orders / lines existed without full DDL
-- (CREATE TABLE IF NOT EXISTS skipped adding newer columns.)

ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'sale';
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS po_number text;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS order_notes text;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS is_local_sale boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS shipping_fee numeric(18,6);
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS trade_shipping_fee_outgoing numeric(18,6);
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS trade_shipping_fee_incoming numeric(18,6);
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS expected_arrival_date date;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles (id);
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS so_number bigint;

ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.items (id) ON DELETE RESTRICT;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS sku_text text;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS quantity numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS shipped_quantity numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS unit_price numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS unit_cost numeric(18,6);
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());
