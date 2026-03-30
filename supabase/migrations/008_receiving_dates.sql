-- ============================================
-- Receiving order dates: order, expected ship, expected arrival
-- ============================================

ALTER TABLE public.receiving_order_lines
ADD COLUMN IF NOT EXISTS order_date date,
ADD COLUMN IF NOT EXISTS expected_ship_date date,
ADD COLUMN IF NOT EXISTS expected_arrival_date date;

