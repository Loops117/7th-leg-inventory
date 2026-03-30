-- ============================================
-- 1. Items: add sale_price
-- ============================================
ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS sale_price numeric(18,6),
ADD COLUMN IF NOT EXISTS description text;

-- ============================================
-- 2. Item buying options (multiple vendors/URLs per SKU)
-- ============================================
CREATE TABLE IF NOT EXISTS public.item_buying_options (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id uuid NOT NULL REFERENCES public.items (id) ON DELETE CASCADE,
  vendor_company_name text NOT NULL,
  url text,
  standard_buy_quantity numeric(18,6) NOT NULL DEFAULT 1,
  pieces_per_pack numeric(18,6) NOT NULL DEFAULT 1,
  qty_buying_trigger numeric(18,6),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Only one default buying option per item
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_buying_options_one_default
ON public.item_buying_options (item_id) WHERE is_default = true;

DROP TRIGGER IF EXISTS set_item_buying_options_updated_at ON public.item_buying_options;
CREATE TRIGGER set_item_buying_options_updated_at
BEFORE UPDATE ON public.item_buying_options
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- 3. Inventory transactions: store unit cost on purchase receipts
-- ============================================
ALTER TABLE public.inventory_transactions
ADD COLUMN IF NOT EXISTS unit_cost numeric(18,6);

-- ============================================
-- 4. Company settings (cost type, SKU auto-generation)
-- ============================================
CREATE TABLE IF NOT EXISTS public.company_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies (id) ON DELETE CASCADE,
  cost_type text NOT NULL DEFAULT 'average'
    CHECK (cost_type IN ('average', 'first', 'set', 'last')),
  enable_trades boolean NOT NULL DEFAULT false,
  sku_prefix text NOT NULL DEFAULT '',
  sku_suffix text NOT NULL DEFAULT '',
  sku_counter integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

DROP TRIGGER IF EXISTS set_company_settings_updated_at ON public.company_settings;
CREATE TRIGGER set_company_settings_updated_at
BEFORE UPDATE ON public.company_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- 5. Receiving orders (inbound / quick-buy list)
-- ============================================
CREATE TABLE IF NOT EXISTS public.receiving_orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_by uuid REFERENCES public.profiles (id)
);

DROP TRIGGER IF EXISTS set_receiving_orders_updated_at ON public.receiving_orders;
CREATE TRIGGER set_receiving_orders_updated_at
BEFORE UPDATE ON public.receiving_orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.receiving_order_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  receiving_order_id uuid NOT NULL REFERENCES public.receiving_orders (id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items (id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.locations (id) ON DELETE SET NULL,
  quantity_ordered numeric(18,6) NOT NULL,
  quantity_received numeric(18,6) NOT NULL DEFAULT 0,
  unit_cost numeric(18,6),
  pieces_per_pack numeric(18,6),
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================
-- 6. Enable RLS on new tables
-- ============================================
ALTER TABLE public.item_buying_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving_order_lines ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 7. RLS policies: item_buying_options (via items.company_id)
-- ============================================
DROP POLICY IF EXISTS "item_buying_options_all" ON public.item_buying_options;
CREATE POLICY "item_buying_options_all"
ON public.item_buying_options
FOR ALL
USING (
  public.is_super_admin()
  OR public.is_company_member((SELECT company_id FROM public.items i WHERE i.id = item_buying_options.item_id))
)
WITH CHECK (
  public.is_super_admin()
  OR public.is_company_member((SELECT company_id FROM public.items i WHERE i.id = item_buying_options.item_id))
);

-- ============================================
-- 8. RLS policies: company_settings
-- ============================================
DROP POLICY IF EXISTS "company_settings_all" ON public.company_settings;
CREATE POLICY "company_settings_all"
ON public.company_settings
FOR ALL
USING (
  public.is_super_admin() OR public.is_company_member(company_id)
)
WITH CHECK (
  public.is_super_admin() OR public.is_company_member(company_id)
);

-- ============================================
-- 9. RLS policies: receiving_orders
-- ============================================
DROP POLICY IF EXISTS "receiving_orders_all" ON public.receiving_orders;
CREATE POLICY "receiving_orders_all"
ON public.receiving_orders
FOR ALL
USING (
  public.is_super_admin() OR public.is_company_member(company_id)
)
WITH CHECK (
  public.is_super_admin() OR public.is_company_member(company_id)
);

-- ============================================
-- 10. RLS policies: receiving_order_lines
-- ============================================
DROP POLICY IF EXISTS "receiving_order_lines_all" ON public.receiving_order_lines;
CREATE POLICY "receiving_order_lines_all"
ON public.receiving_order_lines
FOR ALL
USING (
  public.is_super_admin()
  OR public.is_company_member((
    SELECT company_id FROM public.receiving_orders ro WHERE ro.id = receiving_order_lines.receiving_order_id
  ))
)
WITH CHECK (
  public.is_super_admin()
  OR public.is_company_member((
    SELECT company_id FROM public.receiving_orders ro WHERE ro.id = receiving_order_lines.receiving_order_id
  ))
);

-- ============================================
-- 11. Seed company_settings for existing companies (optional)
-- ============================================
INSERT INTO public.company_settings (company_id, cost_type, sku_prefix, sku_suffix, sku_counter)
SELECT id, 'average', '', '', 0
FROM public.companies
ON CONFLICT (company_id) DO NOTHING;
