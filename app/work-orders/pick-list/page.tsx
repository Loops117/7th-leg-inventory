"use client";

import { useEffect, useMemo, useState } from "react";
import type { Database } from "@/types/supabase";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCurrentUserPermissions } from "@/lib/permissions";

type WorkOrder = Database["public"]["Tables"]["work_orders"]["Row"];
type WorkOrderAssignment =
  Database["public"]["Tables"]["work_order_assignments"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type AssignmentWithRelations = WorkOrderAssignment & {
  work_order: WorkOrder;
  assignee_profile: Pick<Profile, "id" | "full_name" | "email"> | null;
};

type PickListItemRow = {
  item_id: string;
  sku: string;
  item_name: string;
  location_name: string;
  current_qty: number;
  required_qty: number;
};

export default function WorkOrdersPickListPage() {
  const [assignments, setAssignments] = useState<AssignmentWithRelations[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [pickSelectedAssignmentIds, setPickSelectedAssignmentIds] = useState<
    string[]
  >([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickItems, setPickItems] = useState<PickListItemRow[]>([]);

  const [pickSortKey, setPickSortKey] = useState<
    "sku" | "item_name" | "location_name" | "current_qty" | "required_qty"
  >("sku");
  const [pickSortDir, setPickSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      const activeCompany = loadActiveCompany();
      if (!auth.user || !activeCompany) {
        setAssignments([]);
        setLoading(false);
        return;
      }

      setUserId(auth.user.id);
      setActiveCompanyId(activeCompany.id);

      const perms = await getCurrentUserPermissions(activeCompany.id);
      const isAdminUser = perms.isSuperAdmin;
      setIsAdmin(isAdminUser);

      let baseQuery = supabase
        .from("work_order_assignments")
        .select(
          `
          *,
          work_order:work_orders(*),
          assignee_profile:profiles!work_order_assignments_assignee_id_fkey(id, full_name, email)
        `,
        )
        .eq("company_id", activeCompany.id)
        .in("status", ["open", "in_progress", "paused"])
        .order("order_index", { ascending: true });

      const data = isAdminUser
        ? await baseQuery
        : await baseQuery.or(
            `assignee_id.eq.${auth.user.id},is_open.eq.true`,
          );

      const { data: rows, error: qError } = data as any;
      if (qError) {
        console.error(qError);
        setError("Failed to load work orders.");
        setAssignments([]);
      } else {
        setAssignments((rows ?? []) as AssignmentWithRelations[]);
      }

      setLoading(false);
    };

    load();
  }, []);

  const getAssignmentQtyToBuild = (assignment: AssignmentWithRelations) => {
    const n =
      (assignment.quantity_to_build as number | null | undefined) ??
      (assignment.work_order?.standard_quantity as number | null | undefined) ??
      0;
    const qty = Number(n ?? 0);
    return Number.isFinite(qty) ? qty : 0;
  };

  const loadPickList = async () => {
    if (!activeCompanyId) return;
    if (!userId) return;
    if (pickSelectedAssignmentIds.length === 0) {
      setPickItems([]);
      return;
    }

    setPickLoading(true);
    setPickError(null);

    try {
      const selectedAssignments = assignments.filter((a) =>
        pickSelectedAssignmentIds.includes(a.id),
      );
      if (!selectedAssignments.length) {
        setPickItems([]);
        return;
      }

      const requiredByItemId = new Map<string, number>();
      const itemMeta = new Map<string, { sku: string; item_name: string }>();

      // Cache procedure inputs so we don't re-query repeatedly
      const workOrderProceduresCache = new Map<string, string[]>();
      const procedureItemsCache = new Map<
        string,
        { item_id: string; quantity_required: number; sku: string; item_name: string }[]
      >();

      for (const a of selectedAssignments) {
        const qtyToBuild = getAssignmentQtyToBuild(a);
        if (!qtyToBuild || qtyToBuild <= 0) continue;

        const workOrderId = a.work_order_id;
        if (!workOrderId) continue;

        let procedureIds = workOrderProceduresCache.get(workOrderId);
        if (!procedureIds) {
          const { data: links, error: linksErr } = await supabase
            .from("work_order_procedures")
            .select(
              `
                procedures:procedures(id)
              `,
            )
            .eq("work_order_id", workOrderId)
            .order("sequence", { ascending: true });

          if (linksErr) {
            console.error(linksErr);
            procedureIds = [];
          } else {
            procedureIds =
              (links as any[] | null)
                ?.map((row) => row.procedures?.id)
                .filter(Boolean) ?? [];
          }

          workOrderProceduresCache.set(workOrderId, procedureIds);
        }

        for (const procId of procedureIds) {
          let inputs = procedureItemsCache.get(procId);
          if (!inputs) {
            const { data, error: inputsErr } = await supabase
              .from("procedure_items")
              .select(
                `
                item_id,
                quantity_required,
                items ( sku, name )
              `,
              )
              .eq("procedure_id", procId);

            if (inputsErr) {
              console.error(inputsErr);
              inputs = [];
            } else {
              inputs =
                (data as any[] | null)?.map((row) => ({
                  item_id: row.item_id as string,
                  quantity_required: Number(row.quantity_required ?? 0),
                  sku: row.items?.sku ?? "",
                  item_name: row.items?.name ?? "",
                })) ?? [];
            }

            procedureItemsCache.set(procId, inputs);
          }

          for (const inp of inputs) {
            if (!inp.item_id) continue;
            const reqQty = (inp.quantity_required ?? 0) * qtyToBuild;
            if (!reqQty || reqQty <= 0) continue;

            requiredByItemId.set(
              inp.item_id,
              (requiredByItemId.get(inp.item_id) ?? 0) + reqQty,
            );

            if (!itemMeta.has(inp.item_id)) {
              itemMeta.set(inp.item_id, {
                sku: inp.sku,
                item_name: inp.item_name,
              });
            }
          }
        }
      }

      const itemIds = Array.from(requiredByItemId.keys());
      if (itemIds.length === 0) {
        setPickItems([]);
        return;
      }

      // Choose one location per item (default if available)
      const { data: ilRows, error: ilErr } = await supabase
        .from("item_locations")
        .select("item_id, location_id, is_default")
        .in("item_id", itemIds);
      if (ilErr) console.error(ilErr);

      const defaultLocByItemId = new Map<string, string | null>();
      const ilList = (ilRows ?? []) as {
        item_id: string;
        location_id: string | null;
        is_default: boolean | null;
      }[];

      for (const id of itemIds) {
        const forItem = ilList.filter((r) => r.item_id === id);
        const def = forItem.find((r) => r.is_default);
        defaultLocByItemId.set(
          id,
          def?.location_id ?? forItem[0]?.location_id ?? null,
        );
      }

      const chosenLocationIds = Array.from(
        new Set(
          itemIds
            .map((id) => defaultLocByItemId.get(id))
            .filter(Boolean),
        ),
      ) as string[];

      const locNameById = new Map<string, string>();
      const qtyByItemLoc = new Map<string, number>();

      if (chosenLocationIds.length > 0) {
        const { data: locRows, error: locErr } = await supabase
          .from("locations")
          .select("id, name")
          .in("id", chosenLocationIds);
        if (locErr) console.error(locErr);
        (locRows ?? []).forEach((l: any) => {
          if (l?.id) locNameById.set(l.id as string, l.name ?? "");
        });

        const { data: balRows, error: balErr } = await supabase
          .from("inventory_balances")
          .select("item_id, location_id, on_hand_qty")
          .in("item_id", itemIds)
          .in("location_id", chosenLocationIds);
        if (balErr) console.error(balErr);

        (balRows ?? []).forEach((b: any) => {
          if (!b?.item_id || !b?.location_id) return;
          qtyByItemLoc.set(
            `${b.item_id}:${b.location_id}`,
            Number(b.on_hand_qty ?? 0),
          );
        });
      }

      const rows: PickListItemRow[] = itemIds.map((itemId) => {
        const meta = itemMeta.get(itemId);
        const locId = defaultLocByItemId.get(itemId) ?? null;
        const location_name =
          (locId && locNameById.get(locId)) ?? (locId ? "—" : "—");
        const current_qty =
          locId != null ? qtyByItemLoc.get(`${itemId}:${locId}`) ?? 0 : 0;

        return {
          item_id: itemId,
          sku: meta?.sku ?? "",
          item_name: meta?.item_name ?? "",
          location_name,
          current_qty,
          required_qty: requiredByItemId.get(itemId) ?? 0,
        };
      });

      setPickItems(rows);
    } catch (e) {
      console.error(e);
      setPickError("Failed to build pick list.");
      setPickItems([]);
    } finally {
      setPickLoading(false);
    }
  };

  useEffect(() => {
    // Reload required items when the selection changes
    loadPickList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickSelectedAssignmentIds, assignments, activeCompanyId, userId]);

  const sortedPickItems = useMemo(() => {
    const dir = pickSortDir === "asc" ? 1 : -1;
    const list = [...pickItems];
    list.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";

      if (pickSortKey === "sku") {
        av = a.sku ?? "";
        bv = b.sku ?? "";
      } else if (pickSortKey === "item_name") {
        av = a.item_name ?? "";
        bv = b.item_name ?? "";
      } else if (pickSortKey === "location_name") {
        av = a.location_name ?? "";
        bv = b.location_name ?? "";
      } else if (pickSortKey === "current_qty") {
        av = Number(a.current_qty ?? 0);
        bv = Number(b.current_qty ?? 0);
      } else if (pickSortKey === "required_qty") {
        av = Number(a.required_qty ?? 0);
        bv = Number(b.required_qty ?? 0);
      }

      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
    return list;
  }, [pickItems, pickSortKey, pickSortDir]);

  const pickTotals = useMemo(() => {
    const totalRequired = sortedPickItems.reduce(
      (s, r) => s + (Number(r.required_qty ?? 0) || 0),
      0,
    );
    return {
      totalRequired,
      distinctItems: sortedPickItems.length,
    };
  }, [sortedPickItems]);

  const togglePickSort = (key: typeof pickSortKey) => {
    if (pickSortKey === key) {
      setPickSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPickSortKey(key);
      setPickSortDir("asc");
    }
  };

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #picklist-print-area, #picklist-print-area * { visibility: visible !important; }
          #picklist-print-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-emerald-300">Pick list</h1>
        <div className="text-[11px] text-slate-400">
          Check work orders, then print required inputs.
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading work orders…</div>
      ) : (
        <>
          <div className="rounded border border-slate-800 bg-black/30 p-3 text-xs text-slate-200">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-[11px] font-medium text-slate-100">
                  Assigned work orders
                </div>
                <div className="text-[10px] text-slate-500">
                  Select which ones to build.
                </div>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={pickLoading || pickItems.length === 0}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-50"
              >
                Print
              </button>
            </div>

            <div className="overflow-hidden rounded border border-slate-900/60 bg-black/20">
              <table className="min-w-full text-left text-[11px]">
                <thead className="bg-slate-900/70 text-slate-400">
                  <tr>
                    <th className="px-2 py-2 w-[3rem] font-normal">Pick</th>
                    <th className="px-2 py-2 font-normal">Work order</th>
                    <th className="px-2 py-2 font-normal w-[7rem]">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => {
                    const wo = a.work_order;
                    const isOrphaned =
                      wo == null ||
                      (wo && (wo.name == null || String(wo.name).trim() === ""));
                    const label = isOrphaned
                      ? "Unknown work order (orphaned)"
                      : wo?.name ?? "Work order";
                    const qtyAssigned =
                      a.quantity_to_build ?? wo?.standard_quantity ?? 0;
                    const checked = pickSelectedAssignmentIds.includes(a.id);
                    return (
                      <tr
                        key={a.id}
                        className="border-t border-slate-900/70 hover:bg-slate-900/40"
                      >
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setPickSelectedAssignmentIds((prev) => {
                                const set = new Set(prev);
                                if (set.has(a.id)) set.delete(a.id);
                                else set.add(a.id);
                                return Array.from(set);
                              });
                            }}
                          />
                        </td>
                        <td className="px-2 py-1">{label}</td>
                        <td className="px-2 py-1 tabular-nums">
                          {qtyAssigned ?? 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div id="picklist-print-area">
            {pickLoading && (
              <div className="rounded border border-slate-800 bg-black/20 p-3 text-[11px] text-slate-400">
                Building pick list…
              </div>
            )}

            {!pickLoading && pickError && (
              <div className="rounded border border-red-800 bg-red-950/50 p-3 text-[11px] text-red-200">
                {pickError}
              </div>
            )}

            {!pickLoading && pickSelectedAssignmentIds.length === 0 && (
              <div className="rounded border border-slate-800 bg-black/20 p-3 text-[11px] text-slate-400">
                Select work orders above to build the required inputs list.
              </div>
            )}

            {!pickLoading && pickSelectedAssignmentIds.length > 0 && (
              <div className="rounded border border-slate-800 bg-black/30 p-3 text-xs">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-[11px] font-medium text-slate-100">
                    Required input items
                  </div>
                  <div className="text-[10px] text-slate-400 tabular-nums">
                    {pickTotals.distinctItems} items • Total pieces{" "}
                    {pickTotals.totalRequired}
                  </div>
                </div>

                <div className="overflow-hidden rounded border border-slate-800 bg-slate-950/30">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="bg-slate-900/70 text-slate-400">
                      <tr>
                        <th className="px-2 py-2 font-normal">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => togglePickSort("sku")}
                          >
                            SKU{" "}
                            {pickSortKey === "sku"
                              ? pickSortDir === "asc"
                                ? "▲"
                                : "▼"
                              : ""}
                          </button>
                        </th>
                        <th className="px-2 py-2 font-normal">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => togglePickSort("item_name")}
                          >
                            Item name{" "}
                            {pickSortKey === "item_name"
                              ? pickSortDir === "asc"
                                ? "▲"
                                : "▼"
                              : ""}
                          </button>
                        </th>
                        <th className="px-2 py-2 font-normal">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => togglePickSort("location_name")}
                          >
                            Location{" "}
                            {pickSortKey === "location_name"
                              ? pickSortDir === "asc"
                                ? "▲"
                                : "▼"
                              : ""}
                          </button>
                        </th>
                        <th className="px-2 py-2 font-normal text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => togglePickSort("current_qty")}
                          >
                            Current{" "}
                            {pickSortKey === "current_qty"
                              ? pickSortDir === "asc"
                                ? "▲"
                                : "▼"
                              : ""}
                          </button>
                        </th>
                        <th className="px-2 py-2 font-normal text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => togglePickSort("required_qty")}
                          >
                            Qty needed{" "}
                            {pickSortKey === "required_qty"
                              ? pickSortDir === "asc"
                                ? "▲"
                                : "▼"
                              : ""}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPickItems.map((r) => (
                        <tr
                          key={r.item_id}
                          className="border-t border-slate-900/70 hover:bg-slate-900/40"
                        >
                          <td className="px-2 py-1 tabular-nums">
                            {r.sku || "—"}
                          </td>
                          <td className="px-2 py-1">{r.item_name || "—"}</td>
                          <td className="px-2 py-1">{r.location_name || "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {r.current_qty}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {r.required_qty}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

