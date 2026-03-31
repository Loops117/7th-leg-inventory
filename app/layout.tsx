import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { ActiveCompanySwitcher } from "@/components/ActiveCompanySwitcher";
import { UserMenu } from "@/components/UserMenu";
import { SidebarAside } from "@/components/SidebarAside";
import { RoutePermissionGate } from "@/components/RoutePermissionGate";

export const metadata = {
  title: "In2uition",
  description: "Inventory and manufacturing management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-slate-100">
        <div className="flex min-h-screen flex-col">
          {/* Top thin header */}
          <header className="flex items-center justify-between border-b border-emerald-700/60 bg-neutral-950 px-4 py-2 text-xs shadow-sm shadow-emerald-900/40">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-sm font-semibold text-emerald-300">
                In2uition
              </Link>
              <span className="hidden text-slate-500 sm:inline">
                • Manufacturing & inventory
              </span>
            </div>
            <div className="flex items-center gap-4">
              <ActiveCompanySwitcher />
              <UserMenu />
            </div>
          </header>

          {/* Main content area with left menu */}
          <div className="flex flex-1 bg-gradient-to-b from-black via-slate-950 to-black">
            <SidebarAside />

            <main className="min-w-0 flex-1 px-5 py-5">
              <div className="mx-auto max-w-5xl rounded-lg border border-slate-900 bg-slate-950/60 p-5 shadow-sm shadow-black/50">
                <RoutePermissionGate>{children}</RoutePermissionGate>
              </div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}




