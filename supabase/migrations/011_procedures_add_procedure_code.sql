-- ============================================
-- Ensure procedures.procedure_code (for older schemas)
-- ============================================

-- Add the column if it does not exist
ALTER TABLE public.procedures
ADD COLUMN IF NOT EXISTS procedure_code text;

-- Backfill any NULL values with a generated code based on id
UPDATE public.procedures
SET procedure_code = 'PROC-' || left(id::text, 8)
WHERE procedure_code IS NULL;

-- Make sure it's NOT NULL going forward
ALTER TABLE public.procedures
ALTER COLUMN procedure_code SET NOT NULL;

-- Add a uniqueness guarantee per company if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_procedures_company_code_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_procedures_company_code_unique
    ON public.procedures (company_id, procedure_code);
  END IF;
END;
$$;

