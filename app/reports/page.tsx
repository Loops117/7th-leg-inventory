"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import {
  computeInventoryRollupForItems,
  endOfLocalDayIso,
  type InvTxRow,
} from "@/lib/inventoryValuation";
import type { CostType } from "@/lib/cost";
import {
  assignmentDurationMinutesWithFallback,
  durationCountsForWorkOrderAverage,
  formatDurationMinutes,
} from "@/lib/workOrderTiming";

const ALL_REPORT_PANES = ["inventory", "sales", "workorders"] as const;
type ReportPaneId = (typeof ALL_REPORT_PANES)[number];

const PANE_LABEL: Record<ReportPaneId, string> = {
  inventory: "Inventory",
  sales: "Sales",
  workorders: "Completed work orders",
};

function todayLocalISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function orderBusinessDate(o: {
  sale_date: string | null;
  created_at: string;
}): string {
  if (o.sale_date) return o.sale_date.slice(0, 10);
  return o.created_at.slice(0, 10);
}

export default function ReportsPage() {
  const { authReady, loggedIn } = useAuthSession();
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<ReportPaneId | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const isValidPaneId = useCallback(
    (id: string): id is ReportPaneId =>
      (ALL_REPORT_PANES as readonly string[]).includes(id),
    [],
  );

  const { order, setOrder, visible, setVisible } = useDashboardLayout({
    scope: "reports",
    defaultOrder: [...ALL_REPORT_PANES],
    defaultVisible: {
      inventory: true,
      sales: true,
      workorders: true,
    },
    isValidPaneId,
    authReady,
    loggedIn,
    userId,
    companyId,
  });

  const [invLoading, setInvLoading] = useState(true);
  const [itemCount, setItemCount] = useState(0);
  const [invCostTotal, setInvCostTotal] = useState(0);
  const [invValueTotal, setInvValueTotal] = useState(0);

  const [salesDays, setSalesDays] = useState<7 | 30 | 60 | 90 | 365>(30);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesOrderCount, setSalesOrderCount] = useState(0);
  const [salesCostTotal, setSalesCostTotal] = useState(0);
  const [salesValueTotal, setSalesValueTotal] = useState(0);

  const [woLoading, setWoLoading] = useState(true);
  const [woRows, setWoRows] = useState<
    { workOrderId: string; name: string; avgMinutes: number | null }[]
  >([]);

  const [dashError, setDashError] = useState<string | null>(null);

  useEffect(() => {
    if (!authReady || !loggedIn) return;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const active = loadActiveCompany();
      if (!auth.user || !active) return;
      setUserId(auth.user.id);
      setCompanyId(active.id);
    })();
  }, [authReady, loggedIn]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setDashError(null);
    setInvLoading(true);

    void (async () => {
      try {
        const { count } = await supabase
          .from("items")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId);
        if (cancelled) return;
        setItemCount(count ?? 0);

        const { data: settings } = await supabase
          .from("company_settings")
          .select("cost_type, use_landed_cost")
          .eq("company_id", companyId)
          .single();
        const costType = (settings?.cost_type as CostType) ?? "average";
        const useLanded = Boolean((settings as { use_landed_cost?: boolean })?.use_landed_cost);

        const { data: items } = await supabase
          .from("items")
          .select("id, sale_price")
          .eq("company_id", companyId);
        if (cancelled) return;
        const ids = (items ?? []).map((i: { id: string }) => i.id);
        const salePriceByItem: Record<string, number | null> = {};
        for (const i of items ?? []) {
          const row = i as { id: string; sale_price: number | null };
          salePriceByItem[row.id] = row.sale_price;
        }

        if (ids.length === 0) {
          setInvCostTotal(0);
          setInvValueTotal(0);
          setInvLoading(false);
          return;
        }

        const { data: txs } = await supabase
          .from("inventory_transactions")
          .select(
            "item_id, qty_change, unit_cost, landed_unit_cost, created_at, transaction_type",
          )
          .eq("company_id", companyId)
          .in("item_id", ids)
          .in("transaction_type", [
            "purchase_receipt",
            "work_order_completion",
            "inventory_adjustment",
          ])
          .order("created_at", { ascending: true });
        if (cancelled) return;

        const txsByItem = new Map<string, InvTxRow[]>();
        for (const id of ids) txsByItem.set(id, []);
        for (const t of txs ?? []) {
          const row = t as InvTxRow;
          if (!txsByItem.has(row.item_id)) continue;
          txsByItem.get(row.item_id)!.push(row);
        }

        const through = endOfLocalDayIso(todayLocalISODate());
        const rollup = computeInventoryRollupForItems({
          itemIds: ids,
          txsByItem,
          costType,
          useLanded,
          salePriceByItem,
          throughIso: through,
        });
        setInvCostTotal(rollup.totalCostExtended);
        setInvValueTotal(rollup.totalValueExtended);
      } catch (e) {
        console.error(e);
        setDashError("Could not load inventory stats.");
      } finally {
        if (!cancelled) setInvLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setSalesLoading(true);

    void (async () => {
      try {
        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - (salesDays - 1));
        const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
        const endStr = todayLocalISODate();
        const startIso = `${startStr}T00:00:00.000Z`;

        const { data: orders } = await supabase
          .from("sales_orders")
          .select(
            "id, sale_date, created_at",
          )
          .eq("company_id", companyId)
          .or(`created_at.gte.${startIso},sale_date.gte.${startStr}`);
        if (cancelled) return;

        const inWindow = (orders ?? []).filter((o: any) => {
          const d = orderBusinessDate(o);
          return d >= startStr && d <= endStr;
        });
        const orderIds = inWindow.map((o: { id: string }) => o.id);
        if (orderIds.length === 0) {
          setSalesOrderCount(0);
          setSalesCostTotal(0);
          setSalesValueTotal(0);
          setSalesLoading(false);
          return;
        }

        const { data: lines } = await supabase
          .from("sales_order_lines")
          .select("sales_order_id, quantity, unit_price, unit_cost")
          .in("sales_order_id", orderIds);
        if (cancelled) return;

        let cost = 0;
        let val = 0;
        for (const line of lines ?? []) {
          const l = line as {
            quantity: number;
            unit_price: number;
            unit_cost: number | null;
          };
          const q = Number(l.quantity ?? 0);
          cost += q * (l.unit_cost != null ? Number(l.unit_cost) : 0);
          val += q * Number(l.unit_price ?? 0);
        }
        setSalesOrderCount(inWindow.length);
        setSalesCostTotal(cost);
        setSalesValueTotal(val);
      } catch (e) {
        console.error(e);
        setDashError("Could not load sales stats.");
      } finally {
        if (!cancelled) setSalesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId, salesDays]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setWoLoading(true);

    void (async () => {
      try {
        const { data: assignments } = await supabase
          .from("work_order_assignments")
          .select(
            "id, work_order_id, created_at, last_completed_at, work_order:work_orders ( id, name, status )",
          )
          .eq("company_id", companyId)
          .eq("status", "completed");
        if (cancelled) return;

        // Use all completed assignments — parent work_order often stays open/in_progress
        // while individual assignments are marked completed.
        const completedAssignments = (assignments ?? []).filter((a: any) => {
          const wo = a.work_order as { status?: string } | null;
          return wo?.status !== "cancelled";
        });
        const assignIds = completedAssignments.map(
          (a: { id: string }) => a.id,
        );
        if (assignIds.length === 0) {
          setWoRows([]);
          setWoLoading(false);
          return;
        }

        const { data: events } = await supabase
          .from("work_order_events")
          .select("assignment_id, event_type, occurred_at")
          .in("assignment_id", assignIds);
        if (cancelled) return;

        const evByAssign = new Map<string, { event_type: string; occurred_at: string }[]>();
        for (const id of assignIds) evByAssign.set(id, []);
        for (const e of events ?? []) {
          const row = e as {
            assignment_id: string;
            event_type: string;
            occurred_at: string;
          };
          if (!evByAssign.has(row.assignment_id)) continue;
          evByAssign.get(row.assignment_id)!.push({
            event_type: row.event_type,
            occurred_at: row.occurred_at,
          });
        }

        const byWo = new Map<
          string,
          { name: string; durations: number[] }
        >();
        for (const a of completedAssignments) {
          const aid = (a as { id: string; work_order_id: string }).id;
          const woid = (a as { work_order_id: string }).work_order_id;
          const wo = (a as { work_order: { name: string } | null }).work_order;
          const name = wo?.name ?? "Work order";
          const mins = assignmentDurationMinutesWithFallback(
            evByAssign.get(aid) ?? [],
            (a as { created_at?: string }).created_at,
            (a as { last_completed_at?: string | null }).last_completed_at,
          );
          if (!byWo.has(woid)) byWo.set(woid, { name, durations: [] });
          if (durationCountsForWorkOrderAverage(mins)) {
            byWo.get(woid)!.durations.push(mins);
          }
        }

        const rows = [...byWo.entries()].map(([workOrderId, v]) => {
          const sum = v.durations.reduce((s, x) => s + x, 0);
          const avg = v.durations.length ? sum / v.durations.length : null;
          return {
            workOrderId,
            name: v.name,
            avgMinutes: avg,
          };
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setWoRows(rows);
      } catch (e) {
        console.error(e);
        setDashError("Could not load work order stats.");
      } finally {
        if (!cancelled) setWoLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  function handleDragStart(id: ReportPaneId) {
    setDragging(id);
  }
  function handleDragEnter(targetId: ReportPaneId) {
    if (!dragging || dragging === targetId) return;
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragging);
      const to = next.indexOf(targetId);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragging);
      return next;
    });
  }
  function handleDragEnd() {
    setDragging(null);
  }

  const activePanes = order.filter((id) => visible[id]);

  if (!authReady) {
    return (
      <p className="text-sm text-slate-500" aria-busy="true">
        Checking sign-in…
      </p>
    );
  }

  if (!loggedIn) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center px-4 text-center">
        <p className="text-sm font-semibold text-emerald-300">Reports</p>
        <p className="mt-2 text-sm text-slate-400">Please log in</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Reports dashboard</h2>
          <p className="text-xs text-slate-500">
            Drag panes while customizing to reorder. Layout is saved per user.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            {showConfig ? "Close layout menu" : "Customize dashboard"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/reports/inventory"
          className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
        >
          Inventory report
        </Link>
        <Link
          href="/reports/sales"
          className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
        >
          Sales report
        </Link>
        <Link
          href="/reports/work-orders"
          className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
        >
          Completed work orders
        </Link>
      </div>

      {showConfig && (
        <div className="mb-2 rounded border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-200">
          <p className="mb-2 font-semibold">Visible panes</p>
          <div className="flex flex-wrap gap-3">
            {ALL_REPORT_PANES.map((id) => (
              <label
                key={id}
                className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1"
              >
                <input
                  type="checkbox"
                  checked={visible[id]}
                  onChange={(e) =>
                    setVisible((prev) => ({
                      ...prev,
                      [id]: e.target.checked,
                    }))
                  }
                />
                {PANE_LABEL[id]}
              </label>
            ))}
          </div>
        </div>
      )}

      {dashError && (
        <p className="text-xs text-amber-400/90">{dashError}</p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {activePanes.map((id) => (
          <section
            key={id}
            draggable={showConfig}
            onDragStart={showConfig ? () => handleDragStart(id) : undefined}
            onDragEnter={showConfig ? () => handleDragEnter(id) : undefined}
            onDragEnd={showConfig ? handleDragEnd : undefined}
            onDragOver={showConfig ? (e) => e.preventDefault() : undefined}
            className={`flex h-72 flex-col rounded border border-slate-800 bg-slate-950/80 p-3 text-sm shadow-sm shadow-black/40 ${
              showConfig ? "cursor-move" : ""
            }`}
          >
            <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                {PANE_LABEL[id]}
              </h3>
              {id === "sales" && (
                <select
                  value={salesDays}
                  onChange={(e) =>
                    setSalesDays(Number(e.target.value) as typeof salesDays)
                  }
                  className="max-w-[7rem] rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[10px] text-slate-200"
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>365 days</option>
                </select>
              )}
            </header>

            {id === "inventory" && (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-[11px] text-slate-200">
                {invLoading ? (
                  <p className="text-slate-500">Loading…</p>
                ) : (
                  <>
                    <div className="flex justify-between border-b border-slate-800 py-1">
                      <span className="text-slate-400">Total items</span>
                      <span className="tabular-nums">{itemCount}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 py-1">
                      <span className="text-slate-400">Total inventory cost</span>
                      <span className="tabular-nums">
                        ${invCostTotal.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">
                        Total inventory value
                      </span>
                      <span className="tabular-nums">
                        ${invValueTotal.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Cost and value use on-hand quantity × unit cost / sale price
                      (per company cost settings).
                    </p>
                  </>
                )}
              </div>
            )}

            {id === "sales" && (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-[11px] text-slate-200">
                {salesLoading ? (
                  <p className="text-slate-500">Loading…</p>
                ) : (
                  <>
                    <div className="flex justify-between border-b border-slate-800 py-1">
                      <span className="text-slate-400">Sales orders</span>
                      <span className="tabular-nums">{salesOrderCount}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 py-1">
                      <span className="text-slate-400">Total order cost</span>
                      <span className="tabular-nums">
                        ${salesCostTotal.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Total order value</span>
                      <span className="tabular-nums">
                        ${salesValueTotal.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Orders counted by sale date, or created date if sale date is
                      empty. Line totals use ordered quantity.
                    </p>
                  </>
                )}
              </div>
            )}

            {id === "workorders" && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-[11px]">
                {woLoading ? (
                  <p className="text-slate-500">Loading…</p>
                ) : woRows.length === 0 ? (
                  <p className="text-slate-500">
                    No completed assignments yet (or all are on cancelled work
                    orders).
                  </p>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <table className="w-full text-left">
                      <thead className="sticky top-0 border-b border-slate-800 bg-slate-950 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="py-1 pr-2 font-medium">Work order</th>
                          <th className="py-1 text-right font-medium">
                            Avg time
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {woRows.map((r) => (
                          <tr key={r.workOrderId} className="border-b border-slate-900">
                            <td className="py-1 pr-2 text-slate-200">
                              {r.name}
                            </td>
                            <td className="py-1 text-right tabular-nums text-slate-300">
                              {formatDurationMinutes(r.avgMinutes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
