"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type SessionLine = {
  id: string;
  expected_qty: number;
  counted_qty: number | null;
  items?: { sku: string; name: string | null };
  locations?: { code: string; name: string | null };
};

type Session = {
  id: string;
  started_at: string;
  status: string;
  cycle_count_lists?: { name: string } | null;
};

export default function CycleCountPrintPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const [session, setSession] = useState<Session | null>(null);
  const [lines, setLines] = useState<SessionLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(function load() {
    if (!sessionId) return;
    (async () => {
      const { data: sess, error: sessErr } = await supabase
        .from("cycle_count_sessions")
        .select("id, started_at, status, cycle_count_lists(name)")
        .eq("id", sessionId)
        .single();
      if (sessErr || !sess) {
        setLoading(false);
        return;
      }
      setSession(sess as Session);
      const { data: lineData, error: lineErr } = await supabase
        .from("cycle_count_session_lines")
        .select("id, expected_qty, counted_qty, items(sku, name), locations(code, name)")
        .eq("session_id", sessionId);
      if (lineErr) {
        setLoading(false);
        return;
      }
      const rows = (lineData ?? []) as SessionLine[];
      const locationKey = (l: SessionLine) =>
        (l.locations?.name ?? l.locations?.code ?? "").toLowerCase();
      const itemKey = (l: SessionLine) =>
        (l.items?.name ?? l.items?.sku ?? "").toLowerCase();
      const sorted = [...rows].sort((a, b) => {
        const locA = locationKey(a);
        const locB = locationKey(b);
        if (locA !== locB) return locA.localeCompare(locB);
        return itemKey(a).localeCompare(itemKey(b));
      });
      setLines(sorted);
      setLoading(false);
    })();
  }, [sessionId]);

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white p-6 text-slate-800">
        <p>Loading…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-white p-6 text-slate-800">
        <p>Session not found.</p>
        <Link href="/items/cycle-count" className="text-emerald-600 underline">
          ← Cycle count
        </Link>
      </div>
    );
  }

  const listName = session.cycle_count_lists?.name ?? "Cycle count";

  return (
    <div className="min-h-screen bg-white p-6 text-slate-800 print:p-4">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={`/items/cycle-count/session/${sessionId}`}
          className="text-emerald-600 hover:underline"
        >
          ← Back to session
        </Link>
        <button
          type="button"
          onClick={handlePrint}
          className="rounded border border-slate-400 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-200"
        >
          Print
        </button>
      </div>

      <h1 className="mb-1 text-lg font-bold print:mb-2">{listName}</h1>
      <p className="mb-4 text-sm text-slate-600 print:mb-2">
        Session started: {new Date(session.started_at).toLocaleString()} · Sorted by location, then item name
      </p>

      <table className="w-full border-collapse border border-slate-300 text-sm">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-300 px-2 py-1.5 text-left font-semibold">
              Location
            </th>
            <th className="border border-slate-300 px-2 py-1.5 text-left font-semibold">
              SKU
            </th>
            <th className="border border-slate-300 px-2 py-1.5 text-left font-semibold">
              Item name
            </th>
            <th className="border border-slate-300 px-2 py-1.5 text-right font-semibold">
              Expected
            </th>
            <th className="border border-slate-300 px-2 py-1.5 text-right font-semibold">
              Counted
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-slate-300">
              <td className="border border-slate-300 px-2 py-1.5">
                {l.locations?.name ?? l.locations?.code ?? "—"}
              </td>
              <td className="border border-slate-300 px-2 py-1.5 font-mono">
                {l.items?.sku ?? "—"}
              </td>
              <td className="border border-slate-300 px-2 py-1.5">
                {l.items?.name ?? "—"}
              </td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">
                {Number(l.expected_qty)}
              </td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">
                {l.counted_qty != null ? String(l.counted_qty) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

    </div>
  );
}
