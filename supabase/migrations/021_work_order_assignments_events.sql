-- ============================================
-- Work order assignments and events
-- ============================================

CREATE TABLE IF NOT EXISTS public.work_order_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders (id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  is_open boolean NOT NULL DEFAULT false,
  quantity_to_build numeric(18,6) NOT NULL,
  standard_time_minutes integer NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'paused', 'completed', 'cancelled')),
  notes text,
  last_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.work_order_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id uuid NOT NULL REFERENCES public.work_order_assignments (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('start', 'pause', 'resume', 'complete', 'cancel')),
  occurred_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  notes text
);

DROP TRIGGER IF EXISTS set_work_order_assignments_updated_at ON public.work_order_assignments;
CREATE TRIGGER set_work_order_assignments_updated_at
BEFORE UPDATE ON public.work_order_assignments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.work_order_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_order_assignments_all" ON public.work_order_assignments;
CREATE POLICY "work_order_assignments_all" ON public.work_order_assignments
FOR ALL
USING (public.is_super_admin() OR public.is_company_member(company_id))
WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "work_order_events_all" ON public.work_order_events;
CREATE POLICY "work_order_events_all" ON public.work_order_events
FOR ALL
USING (
  public.is_super_admin()
  OR public.is_company_member(
    (SELECT company_id FROM public.work_order_assignments a WHERE a.id = public.work_order_events.assignment_id)
  )
)
WITH CHECK (
  public.is_super_admin()
  OR public.is_company_member(
    (SELECT company_id FROM public.work_order_assignments a WHERE a.id = public.work_order_events.assignment_id)
  )
);

