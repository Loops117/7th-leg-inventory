export type PermissionGroup = {
  id: string;
  label: string;
  permissions: { code: string; label: string; description: string }[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "inventory",
    label: "Inventory",
    permissions: [
      {
        code: "view_inventory",
        label: "View Inventory",
        description: "See inventory pages, quantities, and item details.",
      },
      {
        code: "manage_inventory",
        label: "Manage Inventory",
        description: "Create and edit items, costs, and item metadata.",
      },
      {
        code: "manage_locations",
        label: "Manage Locations",
        description: "Create and edit warehouses, shelves, and item locations.",
      },
    ],
  },
  {
    id: "work_orders",
    label: "Work Orders",
    permissions: [
      {
        code: "view_work_orders",
        label: "View Work Orders",
        description: "Open work-order pages and assignment boards.",
      },
      {
        code: "manage_work_orders",
        label: "Manage Work Orders",
        description: "Create, assign, and update work orders and trees.",
      },
      {
        code: "assign_work_orders",
        label: "Assign Work Orders",
        description: "Assign work orders to users and manage assignment queues.",
      },
      {
        code: "operate_work_orders",
        label: "Operate Work Orders",
        description: "Start, pause, complete, and report progress on work orders.",
      },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    permissions: [
      {
        code: "view_purchasing",
        label: "View Purchasing",
        description: "View purchasing and receiving pages.",
      },
      {
        code: "manage_purchasing",
        label: "Manage Purchasing",
        description: "Create and receive purchase orders and incoming stock.",
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    permissions: [
      {
        code: "view_sales",
        label: "View Sales",
        description: "View sales dashboard, customers, and order pages.",
      },
      {
        code: "manage_sales",
        label: "Manage Sales",
        description: "Create and edit customers and sales orders.",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    permissions: [
      {
        code: "view_reports",
        label: "View Reports",
        description: "Open and view report dashboards and exports.",
      },
      {
        code: "manage_reports",
        label: "Manage Reports",
        description: "Create, edit, and manage report definitions.",
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    permissions: [
      {
        code: "view_admin",
        label: "View Admin",
        description: "Access company admin pages.",
      },
      {
        code: "manage_admin",
        label: "Manage Admin",
        description: "Modify company settings, roles, users, and setup data.",
      },
      {
        code: "manage_boms",
        label: "Manage BOMs",
        description: "Create and edit bill-of-material configurations.",
      },
      {
        code: "manage_procedures",
        label: "Manage Procedures",
        description: "Create and edit manufacturing procedures and steps.",
      },
      {
        code: "manage_company_roles",
        label: "Manage Company Roles",
        description: "Create and edit company roles and permission assignments.",
      },
      {
        code: "manage_company_users",
        label: "Manage Company Users",
        description: "Invite users and manage company membership.",
      },
    ],
  },
];

export const ALL_PERMISSION_CODES = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.code)
);

export const TAB_REQUIREMENTS: Record<
  "items" | "work_orders" | "purchasing" | "sales" | "reports" | "admin",
  string[]
> = {
  items: ["view_inventory", "manage_inventory"],
  work_orders: ["view_work_orders", "manage_work_orders"],
  purchasing: ["view_purchasing", "manage_purchasing"],
  sales: ["view_sales", "manage_sales"],
  reports: ["view_reports", "manage_reports"],
  admin: ["view_admin", "manage_admin"],
};
