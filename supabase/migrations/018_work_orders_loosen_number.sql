-- ============================================
-- Make legacy work_order_number nullable / ensure it exists
-- ============================================

ALTER TABLE public.work_orders
ADD COLUMN IF NOT EXISTS work_order_number text;

ALTER TABLE public.work_orders
ALTER COLUMN work_order_number DROP NOT NULL;

