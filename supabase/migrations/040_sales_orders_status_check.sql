-- App uses snake_case only: new | in_progress | shipped | completed | back_order
ALTER TABLE public.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_status_check;

-- Normalize legacy / human-readable values (order matters: specific maps first)
UPDATE public.sales_orders SET status = 'in_progress'
WHERE status ILIKE '%in progress%' OR status IN ('processing', 'Processing', 'open');

UPDATE public.sales_orders SET status = 'shipped' WHERE status ILIKE 'shipped';

UPDATE public.sales_orders SET status = 'completed'
WHERE status ILIKE 'completed' OR status IN ('complete', 'Complete', 'done');

UPDATE public.sales_orders SET status = 'back_order'
WHERE status ILIKE '%back order%' OR status IN ('backorder', 'back-order', 'Backorder');

UPDATE public.sales_orders SET status = 'new'
WHERE status ILIKE 'new order%' OR status IN ('New Order', 'pending', 'Pending', 'draft', 'Draft');

-- Remaining invalid or null → new
UPDATE public.sales_orders SET status = 'new'
WHERE status IS NULL OR status NOT IN ('new', 'in_progress', 'shipped', 'completed', 'back_order');

ALTER TABLE public.sales_orders
  ADD CONSTRAINT sales_orders_status_check
  CHECK (status IN ('new', 'in_progress', 'shipped', 'completed', 'back_order'));
