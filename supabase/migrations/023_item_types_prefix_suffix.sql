-- ============================================
-- Item types: add SKU prefix/suffix
-- ============================================

ALTER TABLE public.item_types
ADD COLUMN IF NOT EXISTS sku_prefix text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS sku_suffix text NOT NULL DEFAULT '';

