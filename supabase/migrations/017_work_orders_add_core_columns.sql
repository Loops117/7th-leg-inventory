-- ============================================
-- Ensure work_orders has name, standard_quantity, standard_time_minutes, status
-- for schemas created before migration 016
-- ============================================

ALTER TABLE public.work_orders
ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.work_orders
ADD COLUMN IF NOT EXISTS standard_quantity numeric(18,6);

ALTER TABLE public.work_orders
ADD COLUMN IF NOT EXISTS standard_time_minutes integer;

ALTER TABLE public.work_orders
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';

