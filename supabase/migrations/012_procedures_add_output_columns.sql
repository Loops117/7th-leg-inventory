-- ============================================
-- Ensure procedures has output_item_id and output_quantity
-- (for schemas created before migration 010)
-- ============================================

ALTER TABLE public.procedures
ADD COLUMN IF NOT EXISTS output_item_id uuid REFERENCES public.items (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS output_quantity numeric(18,6);

