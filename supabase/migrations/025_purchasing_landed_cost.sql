-- ============================================
-- Purchasing: landed cost support (shipping/tariff and landed_unit_cost)
-- ============================================

-- Order-level shipping and tariff for allocation across lines
ALTER TABLE public.receiving_orders
ADD COLUMN IF NOT EXISTS shipping_cost numeric(18,6),
ADD COLUMN IF NOT EXISTS tariff_cost numeric(18,6);

-- Inventory transactions: store both base unit cost and landed (with shipping/tariff)
ALTER TABLE public.inventory_transactions
ADD COLUMN IF NOT EXISTS landed_unit_cost numeric(18,6);

-- Company setting: whether to treat landed cost as the primary unit cost
ALTER TABLE public.company_settings
ADD COLUMN IF NOT EXISTS use_landed_cost boolean NOT NULL DEFAULT false;

