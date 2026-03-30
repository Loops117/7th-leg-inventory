-- ============================================
-- Company settings: location code auto-generation
-- ============================================
ALTER TABLE public.company_settings
ADD COLUMN IF NOT EXISTS location_code_prefix text NOT NULL DEFAULT 'LOC-',
ADD COLUMN IF NOT EXISTS location_code_suffix text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS location_code_counter integer NOT NULL DEFAULT 0;
