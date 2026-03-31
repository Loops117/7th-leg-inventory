"use client";

import { SidebarNav } from "@/components/SidebarNav";
import { useAuthSession } from "@/hooks/useAuthSession";

export function SidebarAside() {
  const { authReady, loggedIn } = useAuthSession();
  if (!authReady || !loggedIn) return null;
  return (
    <aside className="w-52 shrink-0 border-r border-slate-900 bg-black/80 px-3 py-4 text-sm">
      <SidebarNav />
    </aside>
  );
}
