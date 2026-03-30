-- ============================================
-- Procedures and procedure_items
-- ============================================

CREATE TABLE IF NOT EXISTS public.procedures (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  -- Optional: link to a primary item this procedure belongs to
  item_id uuid REFERENCES public.items (id) ON DELETE SET NULL,
  name text NOT NULL,
  procedure_code text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  tools_required text,
  steps text,
  output_item_id uuid REFERENCES public.items (id) ON DELETE SET NULL,
  output_quantity numeric(18,6),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (company_id, procedure_code)
);

CREATE TABLE IF NOT EXISTS public.procedure_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  procedure_id uuid NOT NULL REFERENCES public.procedures (id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items (id) ON DELETE RESTRICT,
  quantity_required numeric(18,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

DROP TRIGGER IF EXISTS set_procedures_updated_at ON public.procedures;
CREATE TRIGGER set_procedures_updated_at
BEFORE UPDATE ON public.procedures
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedure_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "procedures_all" ON public.procedures;
CREATE POLICY "procedures_all" ON public.procedures
FOR ALL
USING (
  public.is_super_admin() OR public.is_company_member(company_id)
)
WITH CHECK (
  public.is_super_admin() OR public.is_company_member(company_id)
);

DROP POLICY IF EXISTS "procedure_items_all" ON public.procedure_items;
CREATE POLICY "procedure_items_all" ON public.procedure_items
FOR ALL
USING (
  public.is_super_admin()
  OR public.is_company_member(
    (SELECT company_id FROM public.procedures p WHERE p.id = public.procedure_items.procedure_id)
  )
)
WITH CHECK (
  public.is_super_admin()
  OR public.is_company_member(
    (SELECT company_id FROM public.procedures p WHERE p.id = public.procedure_items.procedure_id)
  )
);

