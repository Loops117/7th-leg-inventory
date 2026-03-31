INSERT INTO public.permissions (code, description)
VALUES
  ('view_reports', 'Open and view report dashboards and exports'),
  ('manage_reports', 'Create, edit, and manage report definitions')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN ('view_reports', 'manage_reports')
WHERE r.company_id IS NULL
  AND r.name IN ('Main Account', 'Super Admin')
ON CONFLICT DO NOTHING;
