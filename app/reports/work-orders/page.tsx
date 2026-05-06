"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import {
  assignmentDurationMinutesWithFallback,
  durationCountsForWorkOrderAverage,
  formatDurationMinutes,
} from "@/lib/workOrderTiming";

type Completion = {
  assignmentId: string;
  lastCompletedAt: string;
  minutes: number | null;
};

type WoGroup = {
  workOrderId: string;
  name: string;
  completions: Completion[];
  avgMinutes: number | null;
};

export default function ReportsWorkOrdersPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<WoGroup[]>([]);
  const [visibleCountByWo, setVisibleCountByWo] = useState<
    Record<string, number>
  >({});

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
        const { data: assignments, error: aErr } = await supabase
          .from("work_order_assignments")
          .select(
            "id, work_order_id, last_completed_at, work_order:work_orders ( id, name, status )",
          )
          .eq("company_id", companyId)
          .eq("status", "completed");
        if (aErr) throw aErr;
        if (cancelled) return;

        const list = (assignments ?? []).filter((a: any) => {
          const wo = a.work_order as { status?: string } | null;
          return wo?.status !== "cancelled";
        });
        const assignIds = list.map((a: { id: string }) => a.id);
        const evByAssign = new Map<
          string,
          { event_type: string; occurred_at: string }[]
        >();
        for (const id of assignIds) evByAssign.set(id, []);

        if (assignIds.length) {
          const { data: events, error: eErr } = await supabase
            .from("work_order_events")
            .select("assignment_id, event_type, occurred_at")
            .in("assignment_id", assignIds);
          if (eErr) throw eErr;
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
        }

        const byWo = new Map<string, { name: string; completions: Completion[] }>();
        for (const a of list) {
          const aid = (a as { id: string }).id;
          const woid = (a as { work_order_id: string }).work_order_id;
          const wo = (a as { work_order: { name: string } | null }).work_order;
          const name = wo?.name ?? "Work order";
          const last = (a as { last_completed_at: string | null }).last_completed_at;
          const mins = assignmentDurationMinutesWithFallback(
            evByAssign.get(aid) ?? [],
            (a as { created_at?: string }).created_at,
            last,
          );
          if (!byWo.has(woid)) byWo.set(woid, { name, completions: [] });
          byWo.get(woid)!.completions.push({
            assignmentId: aid,
            lastCompletedAt: last ?? "",
            minutes: mins,
          });
        }

        const gs: WoGroup[] = [];
        for (const [workOrderId, v] of byWo) {
          v.completions.sort(
            (x, y) =>
              new Date(y.lastCompletedAt).getTime() -
              new Date(x.lastCompletedAt).getTime(),
          );
          const timed = v.completions
            .map((c) => c.minutes)
            .filter(durationCountsForWorkOrderAverage);
          const avg = timed.length
            ? timed.reduce((s, m) => s + m, 0) / timed.length
            : null;
          gs.push({
            workOrderId,
            name: v.name,
            completions: v.completions,
            avgMinutes: avg,
          });
        }
        gs.sort((a, b) => a.name.localeCompare(b.name));
        if (cancelled) return;
        setGroups(gs);
        setVisibleCountByWo((prev) => {
          const next = { ...prev };
          for (const g of gs) {
            if (next[g.workOrderId] == null) next[g.workOrderId] = 3;
          }
          return next;
        });
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

  function seeMore(workOrderId: string, total: number) {
    setVisibleCountByWo((prev) => {
      const cur = prev[workOrderId] ?? 3;
      return {
        ...prev,
        [workOrderId]: Math.min(cur + 5, total),
      };
    });
  }

  function seeLess(workOrderId: string) {
    setVisibleCountByWo((prev) => ({ ...prev, [workOrderId]: 3 }));
  }

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
          <h2 className="text-xl font-semibold">Completed work orders</h2>
          <p className="text-xs text-slate-500">
            Times use recorded start / pause / resume / complete events per
            assignment.
          </p>
        </div>
        <Link href="/reports" className="text-xs text-emerald-400 hover:underline">
          ← Reports dashboard
        </Link>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-500">
          No completed assignments yet (or all are on cancelled work orders).
        </p>
      ) : (
        <ul className="space-y-6">
          {groups.map((g) => {
            const vis = visibleCountByWo[g.workOrderId] ?? 3;
            const slice = g.completions.slice(0, vis);
            const hasMore = g.completions.length > vis;
            const canCollapse = vis > 3;

            return (
              <li
                key={g.workOrderId}
                className="rounded border border-slate-800 bg-slate-950/70 p-4"
              >
                <h3 className="text-sm font-semibold text-emerald-300">
                  {g.name}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Average time:{" "}
                  <span className="text-slate-200">
                    {formatDurationMinutes(g.avgMinutes)}
                  </span>
                </p>
                <ul className="mt-3 space-y-2 border-l border-slate-800 pl-3 text-xs">
                  {slice.map((c) => (
                    <li key={c.assignmentId} className="text-slate-300">
                      <span className="text-slate-500">
                        {c.lastCompletedAt
                          ? new Date(c.lastCompletedAt).toLocaleString()
                          : "—"}
                      </span>
                      {": "}
                      {formatDurationMinutes(c.minutes)}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-3">
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => seeMore(g.workOrderId, g.completions.length)}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      See more (+5)
                    </button>
                  )}
                  {canCollapse && (
                    <button
                      type="button"
                      onClick={() => seeLess(g.workOrderId)}
                      className="text-xs text-slate-400 hover:underline"
                    >
                      See less
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
