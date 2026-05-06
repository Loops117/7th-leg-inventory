ALTER TABLE public.receiving_orders
  ADD COLUMN IF NOT EXISTS tracking_number text;

COMMENT ON COLUMN public.receiving_orders.tracking_number IS 'Carrier tracking/reference number for inbound shipment.';
