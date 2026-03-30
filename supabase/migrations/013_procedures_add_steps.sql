-- ============================================
-- Ensure procedures has a steps text column
-- (for older schemas created before migration 010)
-- ============================================

ALTER TABLE public.procedures
ADD COLUMN IF NOT EXISTS steps text;

