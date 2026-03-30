-- ============================================
-- Tree: pixel offsets per node, connector options per tree
-- ============================================
-- Run this in Supabase: SQL Editor → paste and run.
-- If you see "column ... in the schema cache" errors, run this migration
-- then in Supabase Dashboard go to Settings → API and click "Reload schema"
-- (or restart the PostgREST server / run migrations via CLI: supabase db push).

-- Node position offset from parent (pixels). Null = use layout default.
ALTER TABLE public.work_order_tree_nodes
  ADD COLUMN IF NOT EXISTS offset_x integer DEFAULT 0;
ALTER TABLE public.work_order_tree_nodes
  ADD COLUMN IF NOT EXISTS offset_y integer DEFAULT 0;

-- Connector style (per tree)
ALTER TABLE public.work_order_trees
  ADD COLUMN IF NOT EXISTS connector_stroke_width numeric(6,2) DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS connector_curve numeric(6,2) DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS connector_color text DEFAULT '#64748b',
  ADD COLUMN IF NOT EXISTS connector_brightness numeric(5,2) DEFAULT 100;
