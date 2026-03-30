-- If INSERT omits so_number, assign max(so_number)+1 per company (numeric types only).
-- If so_number is varchar with non-numeric values, drop this trigger and rely on the app.
CREATE OR REPLACE FUNCTION public.sales_orders_assign_so_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_next bigint;
BEGIN
  IF NEW.so_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(so_number::bigint), 0) + 1 INTO v_next
  FROM public.sales_orders
  WHERE company_id = NEW.company_id
    AND so_number IS NOT NULL;

  NEW.so_number := v_next;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_orders_so_number ON public.sales_orders;
CREATE TRIGGER trg_sales_orders_so_number
  BEFORE INSERT ON public.sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sales_orders_assign_so_number();
