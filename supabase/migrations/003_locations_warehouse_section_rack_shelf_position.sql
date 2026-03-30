-- ============================================
-- Locations: add Warehouse, Section, Rack, Shelf, Position
-- ============================================
ALTER TABLE public.locations
ADD COLUMN IF NOT EXISTS warehouse text,
ADD COLUMN IF NOT EXISTS section text,
ADD COLUMN IF NOT EXISTS rack text,
ADD COLUMN IF NOT EXISTS shelf text,
ADD COLUMN IF NOT EXISTS position text;
