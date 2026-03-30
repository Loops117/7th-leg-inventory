-- ============================================
-- Ensure procedures has a tools_required text column
-- (for schemas created before migration 010)
-- ============================================

ALTER TABLE public.procedures
ADD COLUMN IF NOT EXISTS tools_required text;

