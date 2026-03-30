-- Allow sale shipment inventory transactions
ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check;

ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_transaction_type_check
  CHECK (transaction_type IN ('purchase_receipt', 'work_order_completion', 'inventory_adjustment', 'sale_shipment'));

