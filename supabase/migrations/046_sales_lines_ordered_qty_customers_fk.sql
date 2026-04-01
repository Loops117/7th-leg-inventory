-- ordered_qty: legacy NOT NULL column (mirror of quantity)
ALTER TABLE public.sales_order_lines
  ADD COLUMN IF NOT EXISTS ordered_qty numeric(18,6);

UPDATE public.sales_order_lines
SET ordered_qty = COALESCE(ordered_qty, quantity, 0)
WHERE ordered_qty IS NULL;

ALTER TABLE public.sales_order_lines
  ALTER COLUMN ordered_qty SET DEFAULT 0;

ALTER TABLE public.sales_order_lines
  ALTER COLUMN ordered_qty SET NOT NULL;

-- Allow deleting customers: unlink sales orders instead of blocking
ALTER TABLE public.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_customer_id_fkey;

ALTER TABLE public.sales_orders
  ADD CONSTRAINT sales_orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers (id) ON DELETE SET NULL;
