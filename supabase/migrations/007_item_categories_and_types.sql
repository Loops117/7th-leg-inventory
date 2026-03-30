-- ============================================
-- Item categories (SKU prefix/suffix/counter per category; taxable, purchasable, active)
-- Item types (Plastic, Metal, Screw, etc.) – assign to one or multiple categories
-- ============================================

CREATE TABLE IF NOT EXISTS public.item_categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  sku_prefix text NOT NULL DEFAULT '',
  sku_suffix text NOT NULL DEFAULT '',
  sku_counter integer NOT NULL DEFAULT 0,
  taxable boolean NOT NULL DEFAULT true,
  purchasable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.item_types (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS public.item_category_types (
  category_id uuid NOT NULL REFERENCES public.item_categories (id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES public.item_types (id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, type_id)
);

ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS item_category_id uuid REFERENCES public.item_categories (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS item_type_id uuid REFERENCES public.item_types (id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS set_item_categories_updated_at ON public.item_categories;
CREATE TRIGGER set_item_categories_updated_at BEFORE UPDATE ON public.item_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_item_types_updated_at ON public.item_types;
CREATE TRIGGER set_item_types_updated_at BEFORE UPDATE ON public.item_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_category_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_categories_all" ON public.item_categories;
CREATE POLICY "item_categories_all" ON public.item_categories FOR ALL
USING (public.is_super_admin() OR public.is_company_member(company_id))
WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "item_types_all" ON public.item_types;
CREATE POLICY "item_types_all" ON public.item_types FOR ALL
USING (public.is_super_admin() OR public.is_company_member(company_id))
WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "item_category_types_all" ON public.item_category_types;
CREATE POLICY "item_category_types_all" ON public.item_category_types FOR ALL
USING (public.is_super_admin() OR public.is_company_member((
  SELECT company_id FROM public.item_categories c WHERE c.id = item_category_types.category_id
)))
WITH CHECK (public.is_super_admin() OR public.is_company_member((
  SELECT company_id FROM public.item_categories c WHERE c.id = item_category_types.category_id
)));
