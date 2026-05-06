"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import {
  computeInventoryRollupForItems,
  endOfLocalDayIso,
  type InvTxRow,
} from "@/lib/inventoryValuation";
import type { CostType } from "@/lib/cost";

type ItemRow = {
  id: string;
  sku: string;
  name: string | null;
  item_category_id: string | null;
  item_type_id: string | null;
  sale_price: number | null;
  item_categories: { name: string } | null;
  item_types: { name: string } | null;
};

function todayLocalISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function ReportsInventoryPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [categoryTypes, setCategoryTypes] = useState<
    { category_id: string; type_id: string }[]
  >([]);

  const [items, setItems] = useState<ItemRow[]>([]);
  const [txsByItem, setTxsByItem] = useState<Map<string, InvTxRow[]>>(
    new Map(),
  );
  const [costType, setCostType] = useState<CostType>("average");
  const [useLanded, setUseLanded] = useState(false);

  const [searchSku, setSearchSku] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterTypeId, setFilterTypeId] = useState("");
  const [asOfDate, setAsOfDate] = useState(todayLocalISODate());
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const active = loadActiveCompany();
    setCompanyId(active?.id ?? null);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [{ data: catData }, { data: typeData }, { data: ctData }] =
          await Promise.all([
            supabase
              .from("item_categories")
              .select("id, name")
              .eq("company_id", companyId)
              .eq("is_active", true)
              .order("name"),
            supabase
              .from("item_types")
              .select("id, name")
              .eq("company_id", companyId)
              .order("name"),
            supabase.from("item_category_types").select("category_id, type_id"),
          ]);
        if (cancelled) return;
        setCategories((catData ?? []) as { id: string; name: string }[]);
        setTypes((typeData ?? []) as { id: string; name: string }[]);
        setCategoryTypes(
          (ctData ?? []) as { category_id: string; type_id: string }[],
        );

        const { data: settings } = await supabase
          .from("company_settings")
          .select("cost_type, use_landed_cost")
          .eq("company_id", companyId)
          .single();
        if (cancelled) return;
        setCostType((settings?.cost_type as CostType) ?? "average");
        setUseLanded(
          Boolean((settings as { use_landed_cost?: boolean })?.use_landed_cost),
        );

        const { data: itemRows, error: itemErr } = await supabase
          .from("items")
          .select(
            "id, sku, name, sale_price, item_category_id, item_type_id, item_categories(name), item_types(name)",
          )
          .eq("company_id", companyId)
          .order("sku");
        if (itemErr) throw itemErr;
        if (cancelled) return;
        const list = (itemRows ?? []) as ItemRow[];
        setItems(list);
        const ids = list.map((i) => i.id);

        const sel: Record<string, boolean> = {};
        for (const i of list) sel[i.id] = true;
        setSelected(sel);

        const map = new Map<string, InvTxRow[]>();
        for (const id of ids) map.set(id, []);

        if (ids.length > 0) {
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
          for (const t of txs ?? []) {
            const row = t as InvTxRow;
            if (!map.has(row.item_id)) continue;
            map.get(row.item_id)!.push(row);
          }
        }
        setTxsByItem(map);
      } catch (e: unknown) {
        console.error(e);
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const typesForCategory = useMemo(() => {
    if (!filterCategoryId) return types;
    const allowed = new Set(
      categoryTypes
        .filter((ct) => ct.category_id === filterCategoryId)
        .map((ct) => ct.type_id),
    );
    return types.filter((t) => allowed.has(t.id));
  }, [filterCategoryId, categoryTypes, types]);

  useEffect(() => {
    if (filterTypeId && !typesForCategory.some((t) => t.id === filterTypeId)) {
      setFilterTypeId("");
    }
  }, [filterTypeId, typesForCategory]);

  const filteredItems = useMemo(() => {
    const q = searchSku.trim().toLowerCase();
    return items.filter((it) => {
      if (filterCategoryId && it.item_category_id !== filterCategoryId)
        return false;
      if (filterTypeId && it.item_type_id !== filterTypeId) return false;
      if (q) {
        const hay = `${it.sku} ${it.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, searchSku, filterCategoryId, filterTypeId]);

  const salePriceByItem = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const it of items) m[it.id] = it.sale_price;
    return m;
  }, [items]);

  const selectedIds = useMemo(
    () => filteredItems.filter((it) => selected[it.id]).map((it) => it.id),
    [filteredItems, selected],
  );

  const rollup = useMemo(() => {
    if (!selectedIds.length || !asOfDate) return null;
    const through = endOfLocalDayIso(asOfDate);
    return computeInventoryRollupForItems({
      itemIds: selectedIds,
      txsByItem,
      costType,
      useLanded,
      salePriceByItem,
      throughIso: through,
    });
  }, [selectedIds, txsByItem, costType, useLanded, salePriceByItem, asOfDate]);

  function toggleAllFiltered(checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const it of filteredItems) next[it.id] = checked;
      return next;
    });
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => ({ ...prev, [id]: checked }));
  }

  const allFilteredSelected =
    filteredItems.length > 0 &&
    filteredItems.every((it) => selected[it.id]);

  if (!companyId) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-400">Select a company to continue.</p>
        <Link href="/companies" className="text-sm text-emerald-400 hover:underline">
          Companies
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Inventory report</h2>
          <p className="text-xs text-slate-500">
            Value as of end of day (local time), using transaction history.
          </p>
        </div>
        <Link
          href="/reports"
          className="text-xs text-emerald-400 hover:underline"
        >
          ← Reports dashboard
        </Link>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid gap-3 rounded border border-slate-800 bg-slate-950/70 p-3 text-sm md:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-500">As-of date</span>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-500">SKU contains</span>
          <input
            value={searchSku}
            onChange={(e) => setSearchSku(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
            placeholder="Filter list…"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-500">Category</span>
          <select
            value={filterCategoryId}
            onChange={(e) => setFilterCategoryId(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-500">Product type</span>
          <select
            value={filterTypeId}
            onChange={(e) => setFilterTypeId(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          >
            <option value="">All</option>
            {typesForCategory.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={(e) => toggleAllFiltered(e.target.checked)}
          />
          Select all in filtered list ({filteredItems.length})
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          {selectedIds.length === 0 && (
            <p className="text-sm text-amber-400/90">
              Select at least one item to see totals.
            </p>
          )}
          {rollup && (
            <div className="flex flex-wrap gap-4 text-sm text-slate-200">
              <span>
                <span className="text-slate-500">Total qty on hand</span>:{" "}
                <span className="tabular-nums">
                  {rollup.totalQty.toLocaleString()}
                </span>
              </span>
              <span>
                <span className="text-slate-500">Extended cost</span>:{" "}
                <span className="tabular-nums">
                  ${rollup.totalCostExtended.toFixed(2)}
                </span>
              </span>
              <span>
                <span className="text-slate-500">Extended value</span>:{" "}
                <span className="tabular-nums">
                  ${rollup.totalValueExtended.toFixed(2)}
                </span>
              </span>
            </div>
          )}

          <div className="max-h-[min(60vh,480px)] overflow-auto rounded border border-slate-800">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-800 bg-slate-950 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit cost</th>
                  <th className="px-2 py-2 text-right">Ext. cost</th>
                  <th className="pl-2 py-2 pr-3 text-right">Ext. value</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((it) => {
                  const r =
                    selected[it.id] && rollup
                      ? rollup.perItem[it.id]
                      : null;
                  const qty = r?.qty ?? 0;
                  const uc = r?.unitCost;
                  const ec =
                    uc != null && Number.isFinite(uc) ? qty * uc : 0;
                  const ev = r?.valueExtended ?? 0;
                  return (
                    <tr key={it.id} className="border-b border-slate-900">
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={!!selected[it.id]}
                          onChange={(e) => toggleOne(it.id, e.target.checked)}
                        />
                      </td>
                      <td className="px-2 py-1 text-slate-200">{it.sku}</td>
                      <td className="px-2 py-1 text-slate-400">{it.name}</td>
                      <td className="px-2 py-1 text-slate-400">
                        {it.item_categories?.name ?? "—"}
                      </td>
                      <td className="px-2 py-1 text-slate-400">
                        {it.item_types?.name ?? "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-300">
                        {r ? qty.toLocaleString() : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-300">
                        {!r ? "—" : uc != null ? `$${uc.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-300">
                        {r ? `$${ec.toFixed(2)}` : "—"}
                      </td>
                      <td className="pl-2 py-1 pr-3 text-right tabular-nums text-slate-300">
                        {r ? `$${ev.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
