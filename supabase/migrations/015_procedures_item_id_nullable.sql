-- ============================================
-- Make procedures.item_id nullable (legacy schemas)
-- ============================================

ALTER TABLE public.procedures
ALTER COLUMN item_id DROP NOT NULL;

