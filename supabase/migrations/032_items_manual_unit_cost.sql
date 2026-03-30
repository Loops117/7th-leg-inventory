-- Optional admin override for displayed / planning unit cost (per SKU).
-- When set, item detail uses this value instead of average from inventory_transactions.

ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS manual_unit_cost numeric(18,6);

COMMENT ON COLUMN public.items.manual_unit_cost IS
  'When not null, overrides transaction-derived average unit cost for display and BOM costing on this item.';
