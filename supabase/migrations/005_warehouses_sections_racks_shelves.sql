-- ============================================
-- Hierarchy: Warehouses → Sections → Racks → Shelves
-- Locations can link to a shelf (and optional position)
-- ============================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.warehouses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS public.sections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id uuid NOT NULL REFERENCES public.warehouses (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS public.racks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id uuid NOT NULL REFERENCES public.sections (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (section_id, code)
);

CREATE TABLE IF NOT EXISTS public.shelves (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rack_id uuid NOT NULL REFERENCES public.racks (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (rack_id, code)
);

-- Locations: add optional link to shelf (hierarchy); keep existing text columns for legacy
ALTER TABLE public.locations
ADD COLUMN IF NOT EXISTS shelf_id uuid REFERENCES public.shelves (id) ON DELETE SET NULL;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS set_warehouses_updated_at ON public.warehouses;
CREATE TRIGGER set_warehouses_updated_at BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_sections_updated_at ON public.sections;
CREATE TRIGGER set_sections_updated_at BEFORE UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_racks_updated_at ON public.racks;
CREATE TRIGGER set_racks_updated_at BEFORE UPDATE ON public.racks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_shelves_updated_at ON public.shelves;
CREATE TRIGGER set_shelves_updated_at BEFORE UPDATE ON public.shelves FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.racks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shelves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouses_all" ON public.warehouses;
CREATE POLICY "warehouses_all" ON public.warehouses FOR ALL
USING (public.is_super_admin() OR public.is_company_member(company_id))
WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "sections_all" ON public.sections;
CREATE POLICY "sections_all" ON public.sections FOR ALL
USING (public.is_super_admin() OR public.is_company_member((SELECT company_id FROM public.warehouses w WHERE w.id = sections.warehouse_id)))
WITH CHECK (public.is_super_admin() OR public.is_company_member((SELECT company_id FROM public.warehouses w WHERE w.id = sections.warehouse_id)));

DROP POLICY IF EXISTS "racks_all" ON public.racks;
CREATE POLICY "racks_all" ON public.racks FOR ALL
USING (public.is_super_admin() OR public.is_company_member((
  SELECT w.company_id FROM public.sections s JOIN public.warehouses w ON w.id = s.warehouse_id WHERE s.id = racks.section_id
)))
WITH CHECK (public.is_super_admin() OR public.is_company_member((
  SELECT w.company_id FROM public.sections s JOIN public.warehouses w ON w.id = s.warehouse_id WHERE s.id = racks.section_id
)));

DROP POLICY IF EXISTS "shelves_all" ON public.shelves;
CREATE POLICY "shelves_all" ON public.shelves FOR ALL
USING (public.is_super_admin() OR public.is_company_member((
  SELECT w.company_id FROM public.racks r
  JOIN public.sections s ON s.id = r.section_id
  JOIN public.warehouses w ON w.id = s.warehouse_id
  WHERE r.id = shelves.rack_id
)))
WITH CHECK (public.is_super_admin() OR public.is_company_member((
  SELECT w.company_id FROM public.racks r
  JOIN public.sections s ON s.id = r.section_id
  JOIN public.warehouses w ON w.id = s.warehouse_id
  WHERE r.id = shelves.rack_id
)));
