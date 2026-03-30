"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

const ALL_PANES = [
  "incoming",
  "workorder_tree",
  "recent_activity",
  "new_skus",
  "assigned_workorders",
  "procedures",
  "inventory_stats",
  "notifications",
] as const;

type PaneId = (typeof ALL_PANES)[number];

const PANE_LABEL: Record<PaneId, string> = {
  incoming: "Incoming",
  workorder_tree: "Work order tree",
  recent_activity: "Recently received / assembled",
  new_skus: "New SKUs",
  assigned_workorders: "Assigned work orders",
  procedures: "Procedures",
  inventory_stats: "Inventory stats",
  notifications: "Notifications",
};

export default function HomePage() {
  const [order, setOrder] = useState<PaneId[]>([...ALL_PANES]);
  const [visible, setVisible] = useState<Record<PaneId, boolean>>(() => {
    const init: Record<PaneId, boolean> = {
      incoming: true,
      workorder_tree: true,
      recent_activity: true,
      new_skus: true,
      assigned_workorders: true,
      procedures: false,
      inventory_stats: true,
      notifications: true,
    };
    return init;
  });
  const [dragging, setDragging] = useState<PaneId | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  type IncomingLine = {
    id: string;
    item_sku: string;
    item_name: string;
    quantity_ordered: number;
    quantity_received: number;
  };

  type RecentTx = {
    id: string;
    created_at: string;
    qty_change: number;
    unit_cost: number | null;
    transaction_type: string;
    item_sku: string;
    item_name: string;
  };

  type NewItem = {
    id: string;
    sku: string;
    name: string | null;
    created_at: string;
  };

  type AssignmentSummary = {
    id: string;
    status: string;
    order_index: number | null;
    quantity_to_build: number | null;
    work_order_name: string | null;
    work_order_number: string | null;
  };

  type ProcedureSummary = {
    id: string;
    name: string;
    procedure_code: string;
  };

  const [incoming, setIncoming] = useState<IncomingLine[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentTx[]>([]);
  const [newSkus, setNewSkus] = useState<NewItem[]>([]);
  const [assignedWos, setAssignedWos] = useState<AssignmentSummary[]>([]);
  const [procedures, setProcedures] = useState<ProcedureSummary[]>([]);
  const [stats, setStats] = useState<{
    itemCount: number;
    openWorkOrders: number;
  }>({ itemCount: 0, openWorkOrders: 0 });
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    const init = async () => {
      setDataError(null);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const active = loadActiveCompany();
        if (!auth.user || !active) {
          setLayoutLoaded(true);
          setLoadingData(false);
          return;
        }
        setUserId(auth.user.id);
        setCompanyId(active.id);

        // Load layout
        const { data: layoutRow } = await supabase
          .from("dashboard_layouts")
          .select("pane_order, pane_visible")
          .eq("user_id", auth.user.id)
          .eq("company_id", active.id)
          .maybeSingle();

        if (layoutRow) {
          if (
            Array.isArray(layoutRow.pane_order) &&
            layoutRow.pane_order.length
          ) {
            setOrder(
              layoutRow.pane_order.filter((id: string): id is PaneId =>
                (ALL_PANES as readonly string[]).includes(id)
              )
            );
          }
          if (layoutRow.pane_visible) {
            setVisible((prev) => ({
              ...prev,
              ...(layoutRow.pane_visible as Record<PaneId, boolean>),
            }));
          }
        }
        setLayoutLoaded(true);

        // Load data for panes
        const [
          incomingOrdersRes,
          recentTxRes,
          itemsRes,
          assignedRes,
          procsRes,
          statsItemsRes,
          statsWosRes,
        ] = await Promise.all([
          supabase
            .from("receiving_orders")
            .select("id")
            .eq("company_id", active.id)
            .eq("status", "open"),
          supabase
            .from("inventory_transactions")
            .select(
              `
              id,
              created_at,
              qty_change,
              unit_cost,
              transaction_type,
              items ( sku, name )
            `
            )
            .eq("company_id", active.id)
            .in("transaction_type", [
              "purchase_receipt",
              "work_order_completion",
            ])
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("items")
            .select("id, sku, name, created_at")
            .eq("company_id", active.id)
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("work_order_assignments")
            .select(
              `
              id,
              status,
              order_index,
              quantity_to_build,
              work_order:work_orders ( name, work_order_number )
            `
            )
            .eq("company_id", active.id)
            .in("status", ["open", "in_progress", "paused"])
            .or(`assignee_id.eq.${auth.user.id},is_open.eq.true`)
            .order("order_index", { ascending: true })
            .limit(10),
          supabase
            .from("procedures")
            .select("id, name, procedure_code")
            .eq("company_id", active.id)
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(10),
          supabase
            .from("items")
            .select("id", { count: "exact", head: true })
            .eq("company_id", active.id),
          supabase
            .from("work_orders")
            .select("id", { count: "exact", head: true })
            .eq("company_id", active.id)
            .in("status", ["open", "in_progress", "paused"]),
        ]);

        // Incoming lines (if any open receiving order)
        const orderIds = (incomingOrdersRes.data ?? []).map((o: any) => o.id);
        if (orderIds.length > 0) {
          const { data: lines } = await supabase
            .from("receiving_order_lines")
            .select(
              `
              id,
              quantity_ordered,
              quantity_received,
              items ( sku, name )
            `
            )
            .in("receiving_order_id", orderIds)
            .order("created_at", { ascending: false })
            .limit(10);

          setIncoming(
            (lines ?? []).map((l: any) => ({
              id: l.id,
              item_sku: l.items?.sku ?? "",
              item_name: l.items?.name ?? "",
              quantity_ordered: Number(l.quantity_ordered ?? 0),
              quantity_received: Number(l.quantity_received ?? 0),
            }))
          );
        } else {
          setIncoming([]);
        }

        setRecentActivity(
          (recentTxRes.data ?? []).map((t: any) => ({
            id: t.id,
            created_at: t.created_at,
            qty_change: Number(t.qty_change ?? 0),
            unit_cost: t.unit_cost,
            transaction_type: t.transaction_type,
            item_sku: t.items?.sku ?? "",
            item_name: t.items?.name ?? "",
          }))
        );

        setNewSkus(
          (itemsRes.data ?? []).map((i: any) => ({
            id: i.id,
            sku: i.sku,
            name: i.name,
            created_at: i.created_at,
          }))
        );

        setAssignedWos(
          (assignedRes.data ?? []).map((a: any) => ({
            id: a.id,
            status: a.status,
            order_index: a.order_index,
            quantity_to_build: a.quantity_to_build,
            work_order_name: a.work_order?.name ?? null,
            work_order_number: a.work_order?.work_order_number ?? null,
          }))
        );

        setProcedures(
          (procsRes.data ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            procedure_code: p.procedure_code,
          }))
        );

        setStats({
          itemCount: (statsItemsRes.count as number | null) ?? 0,
          openWorkOrders: (statsWosRes.count as number | null) ?? 0,
        });
      } catch (err: any) {
        console.error(err);
        setDataError("Failed to load dashboard data.");
      } finally {
        setLoadingData(false);
      }
    };

    init();
  }, []);

  useEffect(() => {
    if (!layoutLoaded || !userId || !companyId) return;
    const saveLayout = async () => {
      try {
        await supabase.from("dashboard_layouts").upsert(
          {
            user_id: userId,
            company_id: companyId,
            pane_order: order,
            pane_visible: visible,
          },
          { onConflict: "user_id,company_id" }
        );
      } catch (err) {
        console.error("Failed to save dashboard layout", err);
      }
    };
    saveLayout();
  }, [order, visible, layoutLoaded, userId, companyId]);

  function handleDragStart(id: PaneId) {
    setDragging(id);
  }

  function handleDragEnter(targetId: PaneId) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Home dashboard</h2>
          <p className="text-xs text-slate-500">
            Drag panes to reorder. Use the menu to toggle which panes are
            visible. Layout is saved per user.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowConfig((v) => !v)}
          className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
        >
          {showConfig ? "Close layout menu" : "Customize dashboard"}
        </button>
      </div>

      {showConfig && (
        <div className="mb-2 rounded border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-200">
          <p className="mb-2 font-semibold">Visible panes</p>
          <div className="flex flex-wrap gap-3">
            {ALL_PANES.map((id) => (
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
          <p className="mt-2 text-[10px] text-slate-500">
            Layout is saved per user.
          </p>
        </div>
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
            <header className="mb-2 flex shrink-0 items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                {PANE_LABEL[id]}
              </h3>
              <span className="text-[10px] text-slate-500">
                {showConfig ? "Drag" : ""}
              </span>
            </header>
            {dataError && (
              <p className="mb-2 text-xs text-red-400">{dataError}</p>
            )}
            {loadingData ? (
              <p className="text-xs text-slate-500">Loading…</p>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
              <>
                {id === "incoming" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                      {incoming.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No open incoming lines.
                        </p>
                      ) : (
                        <table className="w-full text-[11px]">
                          <thead className="border-b border-slate-800 text-slate-400">
                            <tr>
                              <th className="py-1 pr-2 text-left">Item</th>
                              <th className="py-1 pr-2 text-right">Ordered</th>
                              <th className="py-1 pr-2 text-right">Received</th>
                            </tr>
                          </thead>
                          <tbody>
                            {incoming.map((l) => (
                              <tr key={l.id} className="border-b border-slate-900">
                                <td className="py-1 pr-2">
                                  <div className="truncate text-slate-100">
                                    {l.item_sku}
                                  </div>
                                  <div className="truncate text-[10px] text-slate-500">
                                    {l.item_name}
                                  </div>
                                </td>
                                <td className="py-1 pr-2 text-right">
                                  {l.quantity_ordered}
                                </td>
                                <td className="py-1 pr-2 text-right">
                                  {l.quantity_received}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    <div className="mt-2 shrink-0">
                      <Link
                        href="/purchasing"
                        className="text-[11px] text-emerald-400 hover:underline"
                      >
                        Go to Purchasing
                      </Link>
                    </div>
                  </div>
                )}
                {id === "workorder_tree" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    <p className="text-xs text-slate-400">
                      Tree view is coming soon. Use the Work Orders section for
                      now.
                    </p>
                  </div>
                  </div>
                )}
                {id === "recent_activity" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                      {recentActivity.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No recent incoming inventory.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-[11px]">
                          {recentActivity.map((t) => (
                            <li
                              key={t.id}
                              className="flex items-center justify-between gap-2 border-b border-slate-900 pb-1"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-slate-100">
                                  {t.item_sku}{" "}
                                  <span className="text-[10px] text-slate-500">
                                    {t.item_name}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {new Date(
                                    t.created_at
                                  ).toLocaleDateString()}{" "}
                                  •{" "}
                                  {t.transaction_type === "purchase_receipt"
                                    ? "Purchase"
                                    : t.transaction_type ===
                                        "work_order_completion"
                                    ? "Work order"
                                    : t.transaction_type}
                                </div>
                              </div>
                              <div className="text-right">
                                <div>{t.qty_change}</div>
                                {t.unit_cost != null && (
                                  <div className="text-[10px] text-slate-500">
                                    @ ${t.unit_cost.toFixed(2)}
                                  </div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="mt-2 shrink-0">
                      <Link
                        href={`/items`}
                        className="text-[11px] text-emerald-400 hover:underline"
                      >
                        View items
                      </Link>
                    </div>
                  </div>
                )}
                {id === "new_skus" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                      {newSkus.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No items created yet.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-[11px]">
                          {newSkus.map((i) => (
                            <li
                              key={i.id}
                              className="flex items-center justify-between gap-2 border-b border-slate-900 pb-1"
                            >
                              <div className="min-w-0">
                                <Link
                                  href={`/items/${i.id}`}
                                  className="truncate text-emerald-300 hover:underline"
                                >
                                  {i.sku}
                                </Link>
                                <div className="truncate text-[10px] text-slate-500">
                                  {i.name}
                                </div>
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {new Date(i.created_at).toLocaleDateString()}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="mt-2 shrink-0">
                      <Link
                        href="/items"
                        className="text-[11px] text-emerald-400 hover:underline"
                      >
                        Go to Items
                      </Link>
                    </div>
                  </div>
                )}
                {id === "assigned_workorders" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                      {assignedWos.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No work orders assigned or open.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-[11px]">
                          {assignedWos.map((w) => (
                            <li
                              key={w.id}
                              className="flex items-center justify-between gap-2 border-b border-slate-900 pb-1"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-slate-100">
                                  {w.work_order_name ?? "Work order"}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {w.work_order_number ?? w.id.slice(0, 8)} •{" "}
                                  <span className="capitalize">{w.status}</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div>{w.quantity_to_build ?? ""}</div>
                                <div className="text-[10px] text-slate-500">
                                  Order {w.order_index ?? "-"}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="mt-2 shrink-0">
                      <Link
                        href="/work-orders"
                        className="text-[11px] text-emerald-400 hover:underline"
                      >
                        Go to Work orders
                      </Link>
                    </div>
                  </div>
                )}
                {id === "procedures" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                      {procedures.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No procedures defined yet.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-[11px]">
                          {procedures.map((p) => (
                            <li
                              key={p.id}
                              className="flex items-center justify-between gap-2 border-b border-slate-900 pb-1"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-slate-100">
                                  {p.procedure_code}
                                </div>
                                <div className="truncate text-[10px] text-slate-500">
                                  {p.name}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="mt-2 shrink-0">
                      <Link
                        href="/admin/procedures"
                        className="text-[11px] text-emerald-400 hover:underline"
                      >
                        Manage procedures
                      </Link>
                    </div>
                  </div>
                )}
                {id === "inventory_stats" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1 text-[11px] text-slate-200">
                    <div className="flex items-center justify-between">
                      <span>Total items</span>
                      <span>{stats.itemCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Open work orders</span>
                      <span>{stats.openWorkOrders}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      More detailed KPIs (inventory value, costs) can be added
                      later.
                    </p>
                  </div>
                  </div>
                )}
                {id === "notifications" && (
                  <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    <p className="text-xs text-slate-400">
                      Notification rules and alerts will be added later. For now,
                      use Purchasing and Work Orders panes to monitor activity.
                    </p>
                  </div>
                  </div>
                )}
              </>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

