-- ============================================
-- Work order trees and nodes
-- ============================================

CREATE TABLE IF NOT EXISTS public.work_order_trees (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.work_order_tree_nodes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tree_id uuid NOT NULL REFERENCES public.work_order_trees (id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.work_order_tree_nodes (id) ON DELETE CASCADE,
  -- 'left' or 'right' relative to the parent
  side text NOT NULL DEFAULT 'right' CHECK (side IN ('left', 'right')),
  work_order_id uuid NOT NULL REFERENCES public.work_orders (id) ON DELETE RESTRICT,
  -- position within siblings on the same side for ordering
  position integer NOT NULL DEFAULT 0,
  -- Alert settings per node
  alert_mode text NOT NULL DEFAULT 'days' CHECK (alert_mode IN ('days', 'inventory')),
  alert_days integer NOT NULL DEFAULT 60,
  alert_inventory_threshold numeric(18,6),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_work_order_tree_nodes_tree ON public.work_order_tree_nodes (tree_id);
CREATE INDEX IF NOT EXISTS idx_work_order_tree_nodes_parent ON public.work_order_tree_nodes (parent_id);
CREATE INDEX IF NOT EXISTS idx_work_order_tree_nodes_work_order ON public.work_order_tree_nodes (work_order_id);

DROP TRIGGER IF EXISTS set_work_order_tree_nodes_updated_at ON public.work_order_tree_nodes;
CREATE TRIGGER set_work_order_tree_nodes_updated_at
BEFORE UPDATE ON public.work_order_tree_nodes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.work_order_trees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_tree_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_order_trees_company" ON public.work_order_trees;
CREATE POLICY "work_order_trees_company" ON public.work_order_trees
FOR ALL
USING (public.is_super_admin() OR public.is_company_member(company_id))
WITH CHECK (public.is_super_admin() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "work_order_tree_nodes_company" ON public.work_order_tree_nodes;
CREATE POLICY "work_order_tree_nodes_company" ON public.work_order_tree_nodes
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.work_order_trees t
    WHERE t.id = work_order_tree_nodes.tree_id
      AND (public.is_super_admin() OR public.is_company_member(t.company_id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.work_order_trees t
    WHERE t.id = work_order_tree_nodes.tree_id
      AND (public.is_super_admin() OR public.is_company_member(t.company_id))
  )
);

