-- Item-type and item flags for non-inventory/catalog behavior
ALTER TABLE public.item_types
ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT true;

ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS is_catalog_item boolean NOT NULL DEFAULT false;

-- Permission model grouped by tab-level view/manage controls.
INSERT INTO public.permissions (code, description)
VALUES
  ('view_inventory', 'View inventory tab and item pages'),
  ('manage_inventory', 'Create and edit items and inventory metadata'),
  ('view_work_orders', 'View work-order tab and pages'),
  ('manage_work_orders', 'Create and manage work orders and assignments'),
  ('view_purchasing', 'View purchasing tab and pages'),
  ('manage_purchasing', 'Create and manage purchasing and receiving'),
  ('view_sales', 'View sales tab and pages'),
  ('manage_sales', 'Create and manage sales records'),
  ('view_admin', 'View admin tab and pages'),
  ('manage_admin', 'Manage admin settings, roles, users, and setup')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

-- Ensure location management remains present in this grouped model.
INSERT INTO public.permissions (code, description)
VALUES ('manage_locations', 'Create, edit, duplicate, and delete locations; manage item-location assignment')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

-- Grant all tab permissions to the default template roles so existing
-- installations remain functional until roles are customized.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'view_inventory','manage_inventory',
  'view_work_orders','manage_work_orders',
  'view_purchasing','manage_purchasing',
  'view_sales','manage_sales',
  'view_admin','manage_admin',
  'manage_locations'
)
WHERE r.company_id IS NULL
  AND r.name IN ('Main Account', 'Super Admin')
ON CONFLICT DO NOTHING;
