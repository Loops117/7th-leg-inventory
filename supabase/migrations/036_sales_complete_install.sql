-- ============================================
-- Sales: full install / repair (run once)
-- ============================================
-- Paste into Supabase → SQL → New query, then Run.
--
-- Order of operations:
-- 1) company_settings.enable_trades (safe if column already exists)
-- 2) customers, sales_orders, sales_order_lines + triggers
-- 3) Enable RLS + drop existing policies (clean re-apply)
-- 4) Fix legacy sales_order_lines if an old table lacked sales_order_id
-- 5) Create RLS policies
-- 6) inventory_transactions: allow transaction_type = sale_shipment
-- ============================================

-- Optional: trades toggle (Phase 2). No-op if already present.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS enable_trades boolean NOT NULL DEFAULT false;

-- 1) Customers (per company)
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  customer_code text,
  name text NOT NULL,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (company_id, customer_code)
);

-- Existing `customers` tables created without these columns (IF NOT EXISTS skipped the DDL)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS customer_code text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes text;

DROP TRIGGER IF EXISTS set_customers_updated_at ON public.customers;
CREATE TRIGGER set_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Sales orders
CREATE TABLE IF NOT EXISTS public.sales_orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  so_number bigint,
  order_type text NOT NULL DEFAULT 'sale' CHECK (order_type IN ('sale', 'trade')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'shipped', 'completed', 'back_order')),
  po_number text,
  order_notes text,
  is_local_sale boolean NOT NULL DEFAULT false,
  shipping_fee numeric(18,6),
  trade_shipping_fee_outgoing numeric(18,6),
  trade_shipping_fee_incoming numeric(18,6),
  expected_arrival_date date,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_by uuid REFERENCES public.profiles (id)
);

ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'sale';
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS po_number text;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS order_notes text;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS is_local_sale boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS shipping_fee numeric(18,6);
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS trade_shipping_fee_outgoing numeric(18,6);
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS trade_shipping_fee_incoming numeric(18,6);
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS expected_arrival_date date;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles (id);
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS so_number bigint;

DROP TRIGGER IF EXISTS set_sales_orders_updated_at ON public.sales_orders;
CREATE TRIGGER set_sales_orders_updated_at
BEFORE UPDATE ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Sales order lines (outgoing)
CREATE TABLE IF NOT EXISTS public.sales_order_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders (id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items (id) ON DELETE RESTRICT,
  sku_text text,
  description text,
  quantity numeric(18,6) NOT NULL DEFAULT 0,
  shipped_quantity numeric(18,6) NOT NULL DEFAULT 0,
  unit_price numeric(18,6) NOT NULL DEFAULT 0,
  unit_cost numeric(18,6),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.items (id) ON DELETE RESTRICT;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS sku_text text;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS quantity numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS shipped_quantity numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS unit_price numeric(18,6) NOT NULL DEFAULT 0;
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS unit_cost numeric(18,6);
ALTER TABLE public.sales_order_lines ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());

-- 4) RLS: enable + strip old policies (safe to re-run)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers_all" ON public.customers;
DROP POLICY IF EXISTS "sales_orders_all" ON public.sales_orders;
DROP POLICY IF EXISTS "sales_order_lines_all" ON public.sales_order_lines;

-- 5) Repair legacy sales_order_lines (IF NOT EXISTS skipped your table earlier)
DO $$
BEGIN
  IF to_regclass('public.sales_order_lines') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_order_lines'
      AND column_name = 'sales_order_id'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sales_order_lines'
        AND column_name = 'order_id'
    ) THEN
      ALTER TABLE public.sales_order_lines RENAME COLUMN order_id TO sales_order_id;
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sales_order_lines'
        AND column_name = 'sales_orders_id'
    ) THEN
      ALTER TABLE public.sales_order_lines RENAME COLUMN sales_orders_id TO sales_order_id;
    ELSE
      ALTER TABLE public.sales_order_lines
        ADD COLUMN sales_order_id uuid;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_order_lines'
      AND column_name = 'sales_order_id'
  ) THEN
    ALTER TABLE public.sales_order_lines
      DROP CONSTRAINT IF EXISTS sales_order_lines_sales_order_id_fkey;
    ALTER TABLE public.sales_order_lines
      ADD CONSTRAINT sales_order_lines_sales_order_id_fkey
      FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders (id) ON DELETE CASCADE;
  END IF;
END $$;

-- 6) RLS policies
CREATE POLICY "customers_all"
ON public.customers
FOR ALL
USING (public.is_super_admin() OR public.is_company_member(company_id))
WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

CREATE POLICY "sales_orders_all"
ON public.sales_orders
FOR ALL
USING (public.is_super_admin() OR public.is_company_member(company_id))
WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

CREATE POLICY "sales_order_lines_all"
ON public.sales_order_lines
FOR ALL
USING (
  public.is_super_admin()
  OR public.is_company_member((
    SELECT company_id FROM public.sales_orders so WHERE so.id = sales_order_lines.sales_order_id
  ))
)
WITH CHECK (
  public.is_super_admin()
  OR public.is_company_member((
    SELECT company_id FROM public.sales_orders so WHERE so.id = sales_order_lines.sales_order_id
  ))
);

-- 7) Inventory: allow sale shipments
ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check;

ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_transaction_type_check
  CHECK (transaction_type IN ('purchase_receipt', 'work_order_completion', 'inventory_adjustment', 'sale_shipment'));
