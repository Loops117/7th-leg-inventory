-- ============================================
-- Receiving order lines: vendor info (where it's coming from)
-- ============================================

ALTER TABLE public.receiving_order_lines
ADD COLUMN IF NOT EXISTS vendor_company_name text,
ADD COLUMN IF NOT EXISTS vendor_url text;

