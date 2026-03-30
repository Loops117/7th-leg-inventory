-- ============================================
-- Make legacy work_orders.quantity nullable / ensure it exists
-- ============================================

ALTER TABLE public.work_orders
ADD COLUMN IF NOT EXISTS quantity numeric(18,6);

ALTER TABLE public.work_orders
ALTER COLUMN quantity DROP NOT NULL;

