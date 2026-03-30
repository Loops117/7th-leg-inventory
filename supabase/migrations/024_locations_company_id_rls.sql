-- Ensure locations has company_id and is_active for filtering; allow company members to read
ALTER TABLE public.locations
ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies (id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Backfill company_id from shelf hierarchy where missing
UPDATE public.locations l
SET company_id = (
  SELECT w.company_id
  FROM public.shelves sh
  JOIN public.racks r ON r.id = sh.rack_id
  JOIN public.sections s ON s.id = r.section_id
  JOIN public.warehouses w ON w.id = s.warehouse_id
  WHERE sh.id = l.shelf_id
  LIMIT 1
)
WHERE l.shelf_id IS NOT NULL AND (l.company_id IS NULL OR l.company_id NOT IN (SELECT id FROM public.companies));

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "locations_company_member" ON public.locations;
CREATE POLICY "locations_company_member" ON public.locations
FOR ALL
USING (
  public.is_super_admin()
  OR (company_id IS NOT NULL AND public.is_company_member(company_id))
  OR (
    shelf_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.shelves sh
      JOIN public.racks r ON r.id = sh.rack_id
      JOIN public.sections s ON s.id = r.section_id
      JOIN public.warehouses w ON w.id = s.warehouse_id
      WHERE sh.id = locations.shelf_id AND public.is_company_member(w.company_id)
    )
  )
)
WITH CHECK (
  public.is_super_admin()
  OR (company_id IS NOT NULL AND public.is_company_member(company_id))
);
