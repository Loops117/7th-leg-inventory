-- ============================================
-- Cycle count lists and sessions
-- ============================================

CREATE TABLE IF NOT EXISTS public.cycle_count_lists (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.cycle_count_list_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id uuid NOT NULL REFERENCES public.cycle_count_lists (id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items (id) ON DELETE CASCADE,
  UNIQUE (list_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.cycle_count_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  list_id uuid NOT NULL REFERENCES public.cycle_count_lists (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  created_by uuid REFERENCES auth.users (id)
);

CREATE TABLE IF NOT EXISTS public.cycle_count_session_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid NOT NULL REFERENCES public.cycle_count_sessions (id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items (id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations (id) ON DELETE CASCADE,
  expected_qty numeric(18,6) NOT NULL DEFAULT 0,
  counted_qty numeric(18,6),
  UNIQUE (session_id, item_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_cycle_count_list_items_list ON public.cycle_count_list_items (list_id);
CREATE INDEX IF NOT EXISTS idx_cycle_count_sessions_list ON public.cycle_count_sessions (list_id);
CREATE INDEX IF NOT EXISTS idx_cycle_count_sessions_company ON public.cycle_count_sessions (company_id);
CREATE INDEX IF NOT EXISTS idx_cycle_count_session_lines_session ON public.cycle_count_session_lines (session_id);

ALTER TABLE public.cycle_count_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_count_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_count_session_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cycle_count_lists_company" ON public.cycle_count_lists;
CREATE POLICY "cycle_count_lists_company" ON public.cycle_count_lists
  FOR ALL USING (public.is_super_admin() OR public.is_company_member(company_id))
  WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "cycle_count_list_items_via_list" ON public.cycle_count_list_items;
CREATE POLICY "cycle_count_list_items_via_list" ON public.cycle_count_list_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.cycle_count_lists ccl
      WHERE ccl.id = cycle_count_list_items.list_id
      AND (public.is_super_admin() OR public.is_company_member(ccl.company_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cycle_count_lists ccl
      WHERE ccl.id = cycle_count_list_items.list_id
      AND (public.is_super_admin() OR public.is_company_member(ccl.company_id))
    )
  );

DROP POLICY IF EXISTS "cycle_count_sessions_company" ON public.cycle_count_sessions;
CREATE POLICY "cycle_count_sessions_company" ON public.cycle_count_sessions
  FOR ALL USING (public.is_super_admin() OR public.is_company_member(company_id))
  WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "cycle_count_session_lines_via_session" ON public.cycle_count_session_lines;
CREATE POLICY "cycle_count_session_lines_via_session" ON public.cycle_count_session_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.cycle_count_sessions ccs
      WHERE ccs.id = cycle_count_session_lines.session_id
      AND (public.is_super_admin() OR public.is_company_member(ccs.company_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cycle_count_sessions ccs
      WHERE ccs.id = cycle_count_session_lines.session_id
      AND (public.is_super_admin() OR public.is_company_member(ccs.company_id))
    )
  );
