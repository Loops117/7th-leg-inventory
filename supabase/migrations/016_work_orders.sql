-- ============================================
-- Work orders and work_order_procedures
-- ============================================

CREATE TABLE IF NOT EXISTS public.work_orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  item_id uuid REFERENCES public.items (id) ON DELETE SET NULL,
  standard_quantity numeric(18,6) NOT NULL,
  standard_time_minutes integer NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'paused', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.work_order_procedures (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders (id) ON DELETE CASCADE,
  procedure_id uuid NOT NULL REFERENCES public.procedures (id) ON DELETE RESTRICT,
  sequence integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

DROP TRIGGER IF EXISTS set_work_orders_updated_at ON public.work_orders;
CREATE TRIGGER set_work_orders_updated_at
BEFORE UPDATE ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_orders_all" ON public.work_orders;
CREATE POLICY "work_orders_all" ON public.work_orders
FOR ALL
USING (public.is_super_admin() OR public.is_company_member(company_id))
WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "work_order_procedures_all" ON public.work_order_procedures;
CREATE POLICY "work_order_procedures_all" ON public.work_order_procedures
FOR ALL
USING (
  public.is_super_admin()
  OR public.is_company_member(
    (SELECT company_id FROM public.work_orders w WHERE w.id = public.work_order_procedures.work_order_id)
  )
)
WITH CHECK (
  public.is_super_admin()
  OR public.is_company_member(
    (SELECT company_id FROM public.work_orders w WHERE w.id = public.work_order_procedures.work_order_id)
  )
);

