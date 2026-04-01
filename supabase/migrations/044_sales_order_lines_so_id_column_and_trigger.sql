-- ============================================
-- sales_order_lines: legacy `so_id` + sync trigger
-- ============================================
-- Some databases have NOT NULL so_id (legacy). The app uses sales_order_id.
-- Ensure so_id exists on fresh installs, backfill, and keep both aligned on insert/update.

ALTER TABLE public.sales_order_lines
  ADD COLUMN IF NOT EXISTS so_id uuid REFERENCES public.sales_orders (id) ON DELETE CASCADE;

UPDATE public.sales_order_lines
SET so_id = sales_order_id
WHERE so_id IS NULL
  AND sales_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sales_order_lines_sync_so_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.so_id IS NULL AND NEW.sales_order_id IS NOT NULL THEN
    NEW.so_id := NEW.sales_order_id;
  END IF;
  IF NEW.sales_order_id IS NULL AND NEW.so_id IS NOT NULL THEN
    NEW.sales_order_id := NEW.so_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_order_lines_sync_so_id ON public.sales_order_lines;

CREATE TRIGGER trg_sales_order_lines_sync_so_id
BEFORE INSERT OR UPDATE ON public.sales_order_lines
FOR EACH ROW
EXECUTE FUNCTION public.sales_order_lines_sync_so_id();
