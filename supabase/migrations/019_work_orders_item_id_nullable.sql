-- ============================================
-- Make work_orders.item_id nullable (legacy schemas)
-- ============================================

ALTER TABLE public.work_orders
ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.items (id) ON DELETE SET NULL;

ALTER TABLE public.work_orders
ALTER COLUMN item_id DROP NOT NULL;

