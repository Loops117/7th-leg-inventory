-- ============================================
-- Repair partial / legacy sales_order_lines schema
-- ============================================
-- If migration 033 failed with:
--   column sales_order_lines.sales_order_id does not exist
-- it usually means public.sales_order_lines already existed from an older
-- definition. CREATE TABLE IF NOT EXISTS skipped the table, but the RLS
-- policy still referenced sales_order_id.
--
-- How to apply:
-- 1) Run the CREATE TABLE / trigger portions of 033 that succeeded (or full 033
--    if nothing ran — skip the sales_order_lines policy lines at the end if they
--    still error).
-- 2) Run this migration — it drops the lines policy, fixes the column + FK,
--    then recreates the policy.

DO $$
BEGIN
  IF to_regclass('public.sales_order_lines') IS NOT NULL THEN
    DROP POLICY IF EXISTS "sales_order_lines_all" ON public.sales_order_lines;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.sales_order_lines') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_order_lines'
      AND column_name = 'sales_order_id'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sales_order_lines'
        AND column_name = 'order_id'
    ) THEN
      ALTER TABLE public.sales_order_lines RENAME COLUMN order_id TO sales_order_id;
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sales_order_lines'
        AND column_name = 'sales_orders_id'
    ) THEN
      ALTER TABLE public.sales_order_lines RENAME COLUMN sales_orders_id TO sales_order_id;
    ELSE
      ALTER TABLE public.sales_order_lines
        ADD COLUMN sales_order_id uuid;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_order_lines'
      AND column_name = 'sales_order_id'
  ) THEN
    ALTER TABLE public.sales_order_lines
      DROP CONSTRAINT IF EXISTS sales_order_lines_sales_order_id_fkey;
    ALTER TABLE public.sales_order_lines
      ADD CONSTRAINT sales_order_lines_sales_order_id_fkey
      FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders (id) ON DELETE CASCADE;
  END IF;
END $$;

-- Policy must be top-level SQL (not inside plpgsql), matching migration 033.
CREATE POLICY "sales_order_lines_all"
ON public.sales_order_lines
FOR ALL
USING (
  public.is_super_admin()
  OR public.is_company_member((
    SELECT company_id FROM public.sales_orders so WHERE so.id = sales_order_lines.sales_order_id
  ))
)
WITH CHECK (
  public.is_super_admin()
  OR public.is_company_member((
    SELECT company_id FROM public.sales_orders so WHERE so.id = sales_order_lines.sales_order_id
  ))
);
