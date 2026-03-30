-- ============================================
-- User dashboard layouts (home page panes)
-- ============================================

CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  pane_order text[] NOT NULL,
  pane_visible jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT dashboard_layouts_user_company_unique UNIQUE (user_id, company_id)
);

DROP TRIGGER IF EXISTS set_dashboard_layouts_updated_at ON public.dashboard_layouts;
CREATE TRIGGER set_dashboard_layouts_updated_at
BEFORE UPDATE ON public.dashboard_layouts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dashboard_layouts_all" ON public.dashboard_layouts;
CREATE POLICY "dashboard_layouts_all" ON public.dashboard_layouts
FOR ALL
USING (
  public.is_super_admin() OR auth.uid() = user_id
)
WITH CHECK (
  public.is_super_admin() OR auth.uid() = user_id
);

