"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { SimpleLineChart } from "@/components/SimpleLineChart";

type PeriodKey = "7" | "30" | "60" | "90" | "last_year" | "ytd";

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

function getRange(period: PeriodKey): { startStr: string; endStr: string } {
  const today = new Date();
  const endStr = todayLocalISODate();
  if (period === "ytd") {
    return {
      startStr: `${today.getFullYear()}-01-01`,
      endStr,
    };
  }
  if (period === "last_year") {
    const y = today.getFullYear() - 1;
    return { startStr: `${y}-01-01`, endStr: `${y}-12-31` };
  }
  const days = Number(period);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { startStr, endStr };
}

function enumerateDays(startStr: string, endStr: string): string[] {
  const out: string[] = [];
  const cur = new Date(startStr + "T12:00:00");
  const end = new Date(endStr + "T12:00:00");
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

type OrderRow = {
  id: string;
  sale_date: string | null;
  created_at: string;
};

type LineRow = {
  sales_order_id: string;
  item_id: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number | null;
  items: {
    item_category_id: string | null;
    item_type_id: string | null;
  } | null;
};

export default function ReportsSalesPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("30");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterTypeId, setFilterTypeId] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [categoryTypes, setCategoryTypes] = useState<
    { category_id: string; type_id: string }[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayLabels, setDayLabels] = useState<string[]>([]);
  const [ordersByDay, setOrdersByDay] = useState<number[]>([]);
  const [valueByDay, setValueByDay] = useState<number[]>([]);
  const [costByDay, setCostByDay] = useState<number[]>([]);

  useEffect(() => {
    setCompanyId(loadActiveCompany()?.id ?? null);
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

        const { startStr, endStr } = getRange(period);
        const startIso = `${startStr}T00:00:00.000Z`;

        const { data: orders, error: oErr } = await supabase
          .from("sales_orders")
          .select("id, sale_date, created_at")
          .eq("company_id", companyId)
          .or(`created_at.gte.${startIso},sale_date.gte.${startStr}`);
        if (oErr) throw oErr;
        if (cancelled) return;

        const inWindow = (orders ?? []).filter((o: OrderRow) => {
          const d = orderBusinessDate(o);
          return d >= startStr && d <= endStr;
        });
        const orderIds = inWindow.map((o) => o.id);
        const orderDay = new Map<string, string>();
        for (const o of inWindow as OrderRow[]) {
          orderDay.set(o.id, orderBusinessDate(o));
        }

        const lines: LineRow[] = [];
        if (orderIds.length) {
          const { data: lineRows, error: lErr } = await supabase
            .from("sales_order_lines")
            .select(
              "sales_order_id, item_id, quantity, unit_price, unit_cost, items ( item_category_id, item_type_id )",
            )
            .in("sales_order_id", orderIds);
          if (lErr) throw lErr;
          for (const row of lineRows ?? []) lines.push(row as LineRow);
        }

        function lineMatches(l: LineRow): boolean {
          if (!filterCategoryId && !filterTypeId) return true;
          const item = l.items;
          if (!l.item_id || !item) return false;
          if (filterCategoryId && item.item_category_id !== filterCategoryId)
            return false;
          if (filterTypeId && item.item_type_id !== filterTypeId) return false;
          return true;
        }

        const days = enumerateDays(startStr, endStr);
        const idx = new Map<string, number>();
        days.forEach((d, i) => idx.set(d, i));
        const n = days.length;
        const ordC = new Array(n).fill(0);
        const valC = new Array(n).fill(0);
        const costC = new Array(n).fill(0);

        const ordersCounted = new Array(n).fill(0) as number[];
        const orderHasLine = new Map<string, boolean>();

        for (const l of lines) {
          if (!lineMatches(l)) continue;
          const d = orderDay.get(l.sales_order_id);
          if (d == null || !idx.has(d)) continue;
          const i = idx.get(d)!;
          const q = Number(l.quantity ?? 0);
          valC[i] += q * Number(l.unit_price ?? 0);
          costC[i] += q * (l.unit_cost != null ? Number(l.unit_cost) : 0);
          orderHasLine.set(l.sales_order_id, true);
        }

        for (const o of inWindow as OrderRow[]) {
          const d = orderDay.get(o.id);
          if (d == null || !idx.has(d)) continue;
          const i = idx.get(d)!;
          if (!filterCategoryId && !filterTypeId) {
            ordersCounted[i] += 1;
          } else if (orderHasLine.get(o.id)) {
            ordersCounted[i] += 1;
          }
        }

        for (let i = 0; i < n; i++) {
          ordC[i] = ordersCounted[i];
        }

        const shortLabels = days.map((d) => {
          const [, m, day] = d.split("-");
          return `${m}/${day}`;
        });

        if (cancelled) return;
        setDayLabels(shortLabels);
        setOrdersByDay(ordC);
        setValueByDay(valC);
        setCostByDay(costC);
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
  }, [companyId, period, filterCategoryId, filterTypeId]);

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

  const series = useMemo(
    () => [
      {
        label: "Total orders",
        color: "rgb(52 211 153)",
        values: ordersByDay,
      },
      {
        label: "Total value",
        color: "rgb(56 189 248)",
        values: valueByDay,
      },
      {
        label: "Total cost",
        color: "rgb(251 191 36)",
        values: costByDay,
      },
    ],
    [ordersByDay, valueByDay, costByDay],
  );

  if (!companyId) {
    return (
      <div className="space-y-2 text-sm text-slate-400">
        Select a company first.
        <Link href="/companies" className="block text-emerald-400 hover:underline">
          Companies
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Sales report</h2>
          <p className="text-xs text-slate-500">
            Daily totals by order date (sale date, or created date if unset).
            Values use ordered quantity × price / cost.
          </p>
        </div>
        <Link href="/reports" className="text-xs text-emerald-400 hover:underline">
          ← Reports dashboard
        </Link>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-3 rounded border border-slate-800 bg-slate-950/70 p-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-slate-500">Period</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKey)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
            <option value="last_year">Last calendar year</option>
            <option value="ytd">Year to date</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
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
        <label className="flex flex-col gap-1">
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

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : dayLabels.length === 0 ? (
        <p className="text-sm text-slate-500">No days in range.</p>
      ) : (
        <div className="rounded border border-slate-800 bg-slate-950/70 p-4">
          <p className="mb-2 text-[10px] text-slate-500">
            All three series share one vertical scale (order counts and dollar
            amounts), so order counts may appear small when values are large.
          </p>
          <SimpleLineChart
            series={series}
            labels={dayLabels}
            height={240}
          />
        </div>
      )}
    </div>
  );
}
