-- ============================================
-- 0. Profiles: add email for user search (e.g. add member by email)
-- ============================================
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email text;

-- Update trigger to set email on new signups (and backfill existing from auth.users)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    email = COALESCE(EXCLUDED.email, public.profiles.email);
  RETURN new;
END;
$$;

-- Backfill email for existing profiles (run once)
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email <> u.email);

-- ============================================
-- 1. Item–location assignment (multiple locations per item, one default)
-- ============================================
CREATE TABLE IF NOT EXISTS public.item_locations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id uuid NOT NULL REFERENCES public.items (id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations (id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (item_id, location_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_locations_one_default
ON public.item_locations (item_id) WHERE is_default = true;

ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS default_location_id uuid REFERENCES public.locations (id) ON DELETE SET NULL;

-- ============================================
-- 2. Permission: manage_locations
-- ============================================
INSERT INTO public.permissions (code, description)
VALUES ('manage_locations', 'Create, edit, duplicate, and delete locations; manage item–location assignment')
ON CONFLICT (code) DO NOTHING;

-- Grant to Main Account role (global template)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code = 'manage_locations'
WHERE r.company_id IS NULL AND r.name = 'Main Account'
ON CONFLICT DO NOTHING;

-- ============================================
-- 3. RLS for item_locations
-- ============================================
ALTER TABLE public.item_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_locations_all" ON public.item_locations;
CREATE POLICY "item_locations_all"
ON public.item_locations
FOR ALL
USING (
  public.is_super_admin()
  OR public.is_company_member((
    SELECT company_id FROM public.items i WHERE i.id = item_locations.item_id
  ))
)
WITH CHECK (
  public.is_super_admin()
  OR public.is_company_member((
    SELECT company_id FROM public.items i WHERE i.id = item_locations.item_id
  ))
);

-- ============================================
-- Super admins: allow delete companies
-- ============================================
DROP POLICY IF EXISTS "companies_delete" ON public.companies;
CREATE POLICY "companies_delete"
ON public.companies
FOR DELETE
USING ( public.is_super_admin() );

-- ============================================
-- Profiles: allow reading same-company members (for Admin > Users)
-- ============================================
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
ON public.profiles
FOR SELECT
USING (
  id = auth.uid()
  OR is_super_admin = true
  OR EXISTS (
    SELECT 1
    FROM public.company_memberships m1
    JOIN public.company_memberships m2 ON m1.company_id = m2.company_id AND m2.is_active = true
    WHERE m1.user_id = auth.uid() AND m1.is_active = true AND m2.user_id = profiles.id
  )
);
