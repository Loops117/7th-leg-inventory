"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type UseDashboardLayoutOptions<T extends string> = {
  scope: string;
  defaultOrder: T[];
  defaultVisible: Record<T, boolean>;
  isValidPaneId: (id: string) => id is T;
  authReady: boolean;
  loggedIn: boolean;
  userId: string | null;
  companyId: string | null;
};

export function useDashboardLayout<T extends string>(
  opts: UseDashboardLayoutOptions<T>,
) {
  const {
    scope,
    defaultOrder,
    defaultVisible,
    isValidPaneId,
    authReady,
    loggedIn,
    userId,
    companyId,
  } = opts;

  const [order, setOrder] = useState<T[]>([...defaultOrder]);
  const [visible, setVisible] = useState<Record<T, boolean>>(() => ({
    ...defaultVisible,
  }));
  const [layoutLoaded, setLayoutLoaded] = useState(false);

  useEffect(() => {
    if (!authReady) return;

    if (!loggedIn) {
      setLayoutLoaded(true);
      return;
    }

    if (!userId || !companyId) return;

    let cancelled = false;
    setLayoutLoaded(false);

    void (async () => {
      const { data: layoutRow } = await supabase
        .from("dashboard_layouts")
        .select("pane_order, pane_visible")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .eq("scope", scope)
        .maybeSingle();

      if (cancelled) return;

      if (layoutRow) {
        if (Array.isArray(layoutRow.pane_order) && layoutRow.pane_order.length) {
          const next = layoutRow.pane_order.filter((id: string) =>
            isValidPaneId(id),
          );
          if (next.length) setOrder(next);
        }
        if (layoutRow.pane_visible && typeof layoutRow.pane_visible === "object") {
          setVisible((prev) => {
            const merged = { ...prev } as Record<T, boolean>;
            const pv = layoutRow.pane_visible as Record<string, boolean>;
            for (const key of Object.keys(pv)) {
              if (isValidPaneId(key) && typeof pv[key] === "boolean") {
                merged[key] = pv[key];
              }
            }
            return merged;
          });
        }
      }
      setLayoutLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    loggedIn,
    userId,
    companyId,
    scope,
    isValidPaneId,
  ]);

  useEffect(() => {
    if (!layoutLoaded || !userId || !companyId) return;
    void supabase.from("dashboard_layouts").upsert(
      {
        user_id: userId,
        company_id: companyId,
        scope,
        pane_order: order,
        pane_visible: visible,
      },
      { onConflict: "user_id,company_id,scope" },
    );
  }, [order, visible, layoutLoaded, userId, companyId, scope]);

  return { order, setOrder, visible, setVisible, layoutLoaded };
}
