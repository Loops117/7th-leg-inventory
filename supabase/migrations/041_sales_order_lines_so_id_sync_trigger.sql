-- ============================================
-- sales_order_lines: sync legacy so_id
-- ============================================
-- Your app inserts `sales_order_id`, but the DB is enforcing NOT NULL on `so_id`.
-- This migration backfills existing rows and adds a trigger so `so_id` is automatically
-- set from `sales_order_id` on new inserts/updates.

-- Backfill existing rows (only where so_id is missing).
UPDATE public.sales_order_lines
SET so_id = sales_order_id
WHERE so_id IS NULL
  AND sales_order_id IS NOT NULL;

-- Keep so_id aligned for future writes.
CREATE OR REPLACE FUNCTION public.sales_order_lines_sync_so_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If DB uses legacy column `so_id`, ensure it matches `sales_order_id`.
  IF NEW.so_id IS NULL AND NEW.sales_order_id IS NOT NULL THEN
    NEW.so_id := NEW.sales_order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_order_lines_sync_so_id ON public.sales_order_lines;

CREATE TRIGGER trg_sales_order_lines_sync_so_id
BEFORE INSERT OR UPDATE ON public.sales_order_lines
FOR EACH ROW
EXECUTE FUNCTION public.sales_order_lines_sync_so_id();

