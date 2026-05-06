-- Separate saved layouts per dashboard (home vs reports).

ALTER TABLE public.dashboard_layouts
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'home';

ALTER TABLE public.dashboard_layouts
  DROP CONSTRAINT IF EXISTS dashboard_layouts_user_company_unique;

ALTER TABLE public.dashboard_layouts
  ADD CONSTRAINT dashboard_layouts_user_company_scope_unique
  UNIQUE (user_id, company_id, scope);

COMMENT ON COLUMN public.dashboard_layouts.scope IS 'Layout key: home, reports, etc.';
