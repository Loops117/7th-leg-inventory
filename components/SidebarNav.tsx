"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCurrentUserPermissions, hasPermission } from "@/lib/permissions";
import { TAB_REQUIREMENTS } from "@/lib/permissionCatalog";

type Section = "items" | "workorders" | "purchasing" | "sales" | "reports" | "admin" | null;

export function SidebarNav() {
  const pathname = usePathname();
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [canManageLocations, setCanManageLocations] = useState(false);
  const [canViewItems, setCanViewItems] = useState(true);
  const [canViewWorkOrders, setCanViewWorkOrders] = useState(true);
  const [canViewPurchasing, setCanViewPurchasing] = useState(true);
  const [canViewSales, setCanViewSales] = useState(true);
  const [canViewReports, setCanViewReports] = useState(true);
  const [canViewAdmin, setCanViewAdmin] = useState(true);
  const [expanded, setExpanded] = useState<Section>(null);

  useEffect(() => {
    const active = loadActiveCompany();
    setActiveCompanyId(active?.id ?? null);
    getCurrentUserPermissions(active?.id ?? null).then(({ isSuperAdmin: sa, permissionCodes }) => {
      setIsSuperAdmin(sa);
      setCanManageLocations(hasPermission(permissionCodes, "manage_locations"));
      const can = (codes: string[]) =>
        sa || codes.some((c) => hasPermission(permissionCodes, c));
      setCanViewItems(can(TAB_REQUIREMENTS.items));
      setCanViewWorkOrders(can(TAB_REQUIREMENTS.work_orders));
      setCanViewPurchasing(can(TAB_REQUIREMENTS.purchasing));
      setCanViewSales(can(TAB_REQUIREMENTS.sales));
      setCanViewReports(can(TAB_REQUIREMENTS.reports));
      setCanViewAdmin(can(TAB_REQUIREMENTS.admin));
    });
  }, [pathname]);

  useEffect(() => {
    if (pathname.startsWith("/admin")) setExpanded("admin");
    else if (pathname.startsWith("/items")) setExpanded("items");
    else if (pathname.startsWith("/work-orders")) setExpanded("workorders");
    else if (pathname.startsWith("/purchasing")) setExpanded("purchasing");
    else if (pathname.startsWith("/sales")) setExpanded("sales");
    else if (pathname.startsWith("/reports")) setExpanded("reports");
  }, [pathname]);

  function toggle(section: Section) {
    setExpanded((prev) => (prev === section ? null : section));
  }

  const itemsExpanded = expanded === "items";
  const workordersExpanded = expanded === "workorders";
  const purchasingExpanded = expanded === "purchasing";
  const salesExpanded = expanded === "sales";
  const reportsExpanded = expanded === "reports";
  const adminExpanded = expanded === "admin";

  const linkClass = (path: string) =>
    pathname.startsWith(path)
      ? "block rounded px-2 py-1 text-emerald-300"
      : "block rounded px-2 py-1 text-slate-200 hover:bg-emerald-500/10 hover:text-emerald-300";

  return (
    <nav className="space-y-1">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Navigation
      </div>

      <Link
        href="/"
        className={
          pathname === "/"
            ? "block rounded px-2 py-1 text-emerald-300"
            : "block rounded px-2 py-1 text-slate-200 hover:bg-emerald-500/10 hover:text-emerald-300"
        }
      >
        Home
      </Link>

      {canViewItems && (
      <div>
        <div className="flex w-full items-center justify-between rounded px-2 py-1">
          <Link href="/items" className={`flex-1 ${pathname.startsWith("/items") ? "text-emerald-300" : "text-slate-200 hover:text-emerald-300"}`}>
            Items
          </Link>
          <button type="button" onClick={() => toggle("items")} className="text-slate-500 hover:text-slate-300" aria-label="Toggle submenu">
            <span className={`inline-block transition-transform ${itemsExpanded ? "rotate-90" : ""}`}>▶</span>
          </button>
        </div>
        {itemsExpanded && (
          <div className="ml-3 space-y-0.5 border-l border-slate-700 pl-2">
            <Link
              href="/items"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/items" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              All items
            </Link>
            <Link
              href="/items/new"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/items/new" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Create item
            </Link>
            <Link
              href="/items/cycle-count"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/items/cycle-count" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Cycle count
            </Link>
          </div>
        )}
      </div>
      )}

      {canViewWorkOrders && (
      <div>
        <div className="flex w-full items-center justify-between rounded px-2 py-1">
          <Link href="/work-orders" className={`flex-1 ${pathname.startsWith("/work-orders") ? "text-emerald-300" : "text-slate-200 hover:text-emerald-300"}`}>
            Work Orders
          </Link>
          <button type="button" onClick={() => toggle("workorders")} className="text-slate-500 hover:text-slate-300" aria-label="Toggle submenu">
            <span className={`inline-block transition-transform ${workordersExpanded ? "rotate-90" : ""}`}>▶</span>
          </button>
        </div>
        {workordersExpanded && (
          <div className="ml-3 space-y-0.5 border-l border-slate-700 pl-2">
            <Link
              href="/work-orders"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/work-orders" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Assignments
            </Link>
            <Link
              href="/work-orders/pick-list"
              className={`block rounded px-2 py-1 text-sm ${
                pathname === "/work-orders/pick-list"
                  ? "text-emerald-300"
                  : "text-slate-400 hover:text-emerald-300"
              }`}
            >
              Pick list
            </Link>
            <Link
              href="/work-orders/tree"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/work-orders/tree" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Tree
            </Link>
          </div>
        )}
      </div>
      )}
      {canViewPurchasing && (
      <div>
        <div className="flex w-full items-center justify-between rounded px-2 py-1">
          <Link href="/purchasing" className={`flex-1 ${pathname.startsWith("/purchasing") ? "text-emerald-300" : "text-slate-200 hover:text-emerald-300"}`}>
            Purchasing
          </Link>
          <button type="button" onClick={() => toggle("purchasing")} className="text-slate-500 hover:text-slate-300" aria-label="Toggle submenu">
            <span className={`inline-block transition-transform ${purchasingExpanded ? "rotate-90" : ""}`}>▶</span>
          </button>
        </div>
        {purchasingExpanded && (
          <div className="ml-3 space-y-0.5 border-l border-slate-700 pl-2">
            <Link
              href="/purchasing"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/purchasing" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Quick buy
            </Link>
            <Link
              href="/purchasing/receiving"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/purchasing/receiving" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Receiving
            </Link>
          </div>
        )}
      </div>
      )}
      {canViewSales && (
      <div>
        <div className="flex w-full items-center justify-between rounded px-2 py-1">
          <Link href="/sales" className={`flex-1 ${pathname.startsWith("/sales") ? "text-emerald-300" : "text-slate-200 hover:text-emerald-300"}`}>
            Sales
          </Link>
          <button type="button" onClick={() => toggle("sales")} className="text-slate-500 hover:text-slate-300" aria-label="Toggle submenu">
            <span className={`inline-block transition-transform ${salesExpanded ? "rotate-90" : ""}`}>▶</span>
          </button>
        </div>
        {salesExpanded && (
          <div className="ml-3 space-y-0.5 border-l border-slate-700 pl-2">
            <Link
              href="/sales"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/sales" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Dashboard
            </Link>
            <Link
              href="/sales/customers"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/sales/customers" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Customers
            </Link>
          </div>
        )}
      </div>
      )}
      {canViewReports && (
      <div>
        <div className="flex w-full items-center justify-between rounded px-2 py-1">
          <Link href="/reports" className={`flex-1 ${pathname.startsWith("/reports") ? "text-emerald-300" : "text-slate-200 hover:text-emerald-300"}`}>
            Reports
          </Link>
          <button type="button" onClick={() => toggle("reports")} className="text-slate-500 hover:text-slate-300" aria-label="Toggle submenu">
            <span className={`inline-block transition-transform ${reportsExpanded ? "rotate-90" : ""}`}>▶</span>
          </button>
        </div>
        {reportsExpanded && (
          <div className="ml-3 space-y-0.5 border-l border-slate-700 pl-2">
            <Link
              href="/reports"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/reports" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Reports Home
            </Link>
          </div>
        )}
      </div>
      )}

      {canViewAdmin && (
      <div>
        <div className="flex w-full items-center justify-between rounded px-2 py-1">
          <Link href="/admin" className={`flex-1 ${pathname.startsWith("/admin") ? "text-emerald-300" : "text-slate-200 hover:text-emerald-300"}`}>
            Admin
          </Link>
          <button type="button" onClick={() => toggle("admin")} className="text-slate-500 hover:text-slate-300" aria-label="Toggle submenu">
            <span className={`inline-block transition-transform ${adminExpanded ? "rotate-90" : ""}`}>▶</span>
          </button>
        </div>
        {adminExpanded && (
          <div className="ml-3 space-y-0.5 border-l border-slate-700 pl-2">
            <Link
              href="/admin"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/admin" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Settings
            </Link>
            <Link
              href="/admin/categories"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/admin/categories" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Item categories
            </Link>
            <Link
              href="/admin/types"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/admin/types" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Item types
            </Link>
            <Link
              href="/admin/procedures"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/admin/procedures" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Procedures
            </Link>
            <Link
              href="/admin/work-orders"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/admin/work-orders" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Work orders
            </Link>
            {canManageLocations && (
              <Link
                href="/admin/locations"
                className={`block rounded px-2 py-1 text-sm ${pathname === "/admin/locations" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
              >
                Locations
              </Link>
            )}
            <Link
              href="/admin/roles"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/admin/roles" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Roles
            </Link>
            <Link
              href="/admin/users"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/admin/users" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Users
            </Link>
            <Link
              href="/admin/import"
              className={`block rounded px-2 py-1 text-sm ${pathname === "/admin/import" ? "text-emerald-300" : "text-slate-400 hover:text-emerald-300"}`}
            >
              Import
            </Link>
          </div>
        )}
      </div>
      )}

      {isSuperAdmin && (
        <Link
          href="/super-admin"
          className={`mt-2 block rounded px-2 py-1 font-medium ${pathname.startsWith("/super-admin") ? "text-amber-300" : "text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"}`}
        >
          Super Admin
        </Link>
      )}
    </nav>
  );
}
