-- ============================================
-- Auto-generate codes for warehouse, section, rack, shelf (counters in company_settings)
-- ============================================
ALTER TABLE public.company_settings
ADD COLUMN IF NOT EXISTS warehouse_code_counter integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS section_code_counter integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS rack_code_counter integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS shelf_code_counter integer NOT NULL DEFAULT 0;
