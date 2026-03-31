"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { TAB_REQUIREMENTS } from "@/lib/permissionCatalog";

function requiredCodesForPath(pathname: string): string[] {
  if (pathname.startsWith("/items")) return TAB_REQUIREMENTS.items;
  if (pathname.startsWith("/work-orders")) return TAB_REQUIREMENTS.work_orders;
  if (pathname.startsWith("/purchasing")) return TAB_REQUIREMENTS.purchasing;
  if (pathname.startsWith("/sales")) return TAB_REQUIREMENTS.sales;
  if (pathname.startsWith("/reports")) return TAB_REQUIREMENTS.reports;
  if (pathname.startsWith("/admin")) return TAB_REQUIREMENTS.admin;
  return [];
}

export function RoutePermissionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(true);
  const [checking, setChecking] = useState(true);

  const requiredCodes = useMemo(() => requiredCodesForPath(pathname), [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (requiredCodes.length === 0) {
        setAllowed(true);
        setChecking(false);
        return;
      }
      const active = loadActiveCompany();
      if (!active) {
        setAllowed(true);
        setChecking(false);
        return;
      }
      const { isSuperAdmin, permissionCodes } = await getCurrentUserPermissions(active.id);
      if (cancelled) return;
      if (isSuperAdmin || permissionCodes.includes("*")) {
        setAllowed(true);
        setChecking(false);
        return;
      }
      setAllowed(requiredCodes.some((c) => permissionCodes.includes(c)));
      setChecking(false);
    }
    setChecking(true);
    void run();
    return () => {
      cancelled = true;
    };
  }, [requiredCodes, pathname]);

  if (checking) return <>{children}</>;
  if (allowed) return <>{children}</>;

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Access restricted</h2>
      <p className="text-sm text-slate-300">
        Your role does not have permission to access this tab.
      </p>
    </div>
  );
}
