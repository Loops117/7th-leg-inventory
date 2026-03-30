-- Allow 'cancelled' status on receiving_orders
ALTER TABLE public.receiving_orders
  DROP CONSTRAINT IF EXISTS receiving_orders_status_check;

ALTER TABLE public.receiving_orders
  ADD CONSTRAINT receiving_orders_status_check
  CHECK (status IN ('open', 'closed', 'cancelled'));
