"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarNav } from "@/components/SidebarNav";
import { useAuthSession } from "@/hooks/useAuthSession";

export function SidebarAside() {
  const { authReady, loggedIn } = useAuthSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (!authReady || !loggedIn) return null;
  return (
    <>
      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed left-0 top-1/2 z-30 -translate-y-1/2 rounded-r-md border border-slate-700 border-l-0 bg-slate-900/95 px-2 py-3 text-xs font-semibold text-emerald-300 shadow-lg md:hidden"
          aria-label="Open navigation menu"
        >
          Menu
        </button>
      )}

      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu overlay"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-30 h-screen w-52 shrink-0 border-r border-slate-900 bg-black/95 px-3 py-4 text-sm transition-transform duration-200 md:static md:z-auto md:h-auto md:translate-x-0 md:bg-black/80 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mt-10 md:mt-0">
          <SidebarNav />
        </div>
      </aside>
    </>
  );
}
