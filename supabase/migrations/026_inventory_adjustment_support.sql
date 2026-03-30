-- ============================================
-- Allow inventory_adjustment transactions without reference_table/reference_id
-- ============================================
ALTER TABLE public.inventory_transactions
  ALTER COLUMN reference_table DROP NOT NULL,
  ALTER COLUMN reference_id DROP NOT NULL;
