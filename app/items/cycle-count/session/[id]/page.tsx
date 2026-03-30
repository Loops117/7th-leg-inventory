"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(cell.trim());
        cell = "";
      } else if (c === "\r" || c === "\n") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell.trim());
        cell = "";
        if (row.some((x) => x)) rows.push(row);
        row = [];
      } else cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some((x) => x)) rows.push(row);
  }
  return rows;
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const c = cell ?? "";
          if (/[",\r\n]/.test(c)) return `"${c.replace(/"/g, '""')}"`;
          return c;
        })
        .join(",")
    )
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

type SessionLine = {
  id: string;
  session_id: string;
  item_id: string;
  location_id: string;
  expected_qty: number;
  counted_qty: number | null;
  items?: { sku: string; name: string | null };
  locations?: { code: string; name: string | null };
};

type Session = {
  id: string;
  list_id: string;
  company_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
};

export default function CycleCountSessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [lines, setLines] = useState<SessionLine[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(function loadCompany() {
    const active = loadActiveCompany();
    setActiveCompanyId(active?.id ?? null);
  }, []);

  useEffect(function loadSession() {
    if (!sessionId) return;
    (async () => {
      const { data: sess, error: sessErr } = await supabase
        .from("cycle_count_sessions")
        .select("id, list_id, company_id, started_at, completed_at, status")
        .eq("id", sessionId)
        .single();
      if (sessErr || !sess) {
        setError(sessErr?.message ?? "Session not found");
        setLoading(false);
        return;
      }
      setSession(sess as Session);
      const { data: lineData, error: lineErr } = await supabase
        .from("cycle_count_session_lines")
        .select("id, session_id, item_id, location_id, expected_qty, counted_qty, items(sku, name), locations(code, name)")
        .eq("session_id", sessionId)
        .order("item_id");
      if (lineErr) {
        setError(lineErr.message);
        setLoading(false);
        return;
      }
      const rows = (lineData ?? []) as SessionLine[];
      setLines(rows);
      const initial: Record<string, string> = {};
      rows.forEach((l) => {
        initial[l.id] = l.counted_qty != null ? String(l.counted_qty) : "";
      });
      setCounted(initial);
      setLoading(false);
    })();
  }, [sessionId]);

  async function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    for (const line of lines) {
      const val = counted[line.id];
      const num = val.trim() === "" ? null : parseFloat(val);
      const safeNum = num != null && !isNaN(num) ? num : null;
      await supabase
        .from("cycle_count_session_lines")
        .update({ counted_qty: safeNum })
        .eq("id", line.id);
    }
    setSaving(false);
  }

  function getDiffs(): { line: SessionLine; expected: number; counted: number; diff: number }[] {
    const out: { line: SessionLine; expected: number; counted: number; diff: number }[] = [];
    lines.forEach((l) => {
      const val = counted[l.id];
      const countedNum = val.trim() === "" ? null : parseFloat(val);
      const exp = Number(l.expected_qty) ?? 0;
      const cnt = countedNum != null && !isNaN(countedNum) ? countedNum : exp;
      const diff = cnt - exp;
      if (diff !== 0) out.push({ line: l, expected: exp, counted: cnt, diff });
    });
    return out;
  }

  async function handleComplete() {
    if (!session || !activeCompanyId) return;
    setCompleting(true);
    setError(null);
    for (const line of lines) {
      const val = counted[line.id];
      const num = val.trim() === "" ? null : parseFloat(val);
      const safeNum = num != null && !isNaN(num) ? num : null;
      await supabase
        .from("cycle_count_session_lines")
        .update({ counted_qty: safeNum })
        .eq("id", line.id);
    }
    setLines((prev) =>
      prev.map((l) => {
        const val = counted[l.id];
        const num = val.trim() === "" ? null : parseFloat(val);
        const safeNum = num != null && !isNaN(num) ? num : null;
        return { ...l, counted_qty: safeNum ?? l.expected_qty };
      })
    );
    const diffs = getDiffs();
    await supabase
      .from("inventory_transactions")
      .delete()
      .eq("reference_table", "cycle_count_sessions")
      .eq("reference_id", sessionId);
    const { data: { user } } = await supabase.auth.getUser();
    for (const { line, diff } of diffs) {
      if (diff === 0) continue;
      await supabase.from("inventory_transactions").insert({
        company_id: session.company_id,
        item_id: line.item_id,
        location_id: line.location_id,
        qty_change: diff,
        transaction_type: "inventory_adjustment",
        unit_cost: null,
        landed_unit_cost: null,
        reference_table: "cycle_count_sessions",
        reference_id: session.id,
        created_by: user?.id ?? null,
      });
    }
    await supabase
      .from("cycle_count_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", sessionId);
    setCompleting(false);
    setShowCompleteConfirm(false);
    setSession((s) => (s ? { ...s, status: "completed", completed_at: new Date().toISOString() } : null));
  }

  function handleExportCSV() {
    const header = ["sku", "item_name", "location", "expected_qty", "counted_qty"];
    const rows = lines.map((l) => {
      const loc = (l.locations?.name || l.locations?.code) ?? "";
      const exp = Number(l.expected_qty) ?? 0;
      const cnt = counted[l.id] !== undefined && counted[l.id] !== "" ? counted[l.id] : (l.counted_qty != null ? String(l.counted_qty) : "");
      return [l.items?.sku ?? "", l.items?.name ?? "", loc, String(exp), cnt];
    });
    downloadCSV([header, ...rows], `cycle_count_session_${sessionId.slice(0, 8)}.csv`);
  }

  async function handleImportCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setImportMessage(null);
    if (!file || lines.length === 0) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) {
      setImportMessage("CSV has no data rows.");
      return;
    }
    const header = rows[0].map((h) => h.toLowerCase().trim());
    const skuIdx = header.findIndex((h) => h === "sku");
    const nameIdx = header.findIndex((h) => h === "item_name" || h === "name");
    const locIdx = header.findIndex((h) => h === "location");
    const countedIdx = header.findIndex((h) => h === "counted_qty" || h === "counted");
    if (skuIdx === -1 || locIdx === -1 || countedIdx === -1) {
      setImportMessage("CSV must have columns: sku, location, counted_qty (or counted).");
      return;
    }
    let updated = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sku = (row[skuIdx] ?? "").trim();
      const locVal = (row[locIdx] ?? "").trim();
      const countedVal = row[countedIdx] ?? "";
      const num = countedVal.trim() === "" ? null : parseFloat(countedVal);
      if (!sku && !locVal) continue;
      const line = lines.find(
        (l) =>
          (l.items?.sku ?? "").toLowerCase() === sku.toLowerCase() &&
          ((l.locations?.name ?? "").toLowerCase() === locVal.toLowerCase() ||
            (l.locations?.code ?? "").toLowerCase() === locVal.toLowerCase())
      );
      if (line) {
        setCounted((prev) => ({ ...prev, [line.id]: countedVal.trim() }));
        await supabase
          .from("cycle_count_session_lines")
          .update({ counted_qty: num != null && !isNaN(num) ? num : null })
          .eq("id", line.id);
        updated++;
      }
    }
    setImportMessage(updated > 0 ? `Updated ${updated} line(s) from CSV.` : "No matching lines found. Use sku and location (name or code) to match.");
  }

  async function handleReopen() {
    if (!confirm("Reopen this cycle count? You can edit counts and complete again. Previous inventory adjustments will be replaced when you complete.")) return;
    setReopening(true);
    setError(null);
    const { error: updErr } = await supabase
      .from("cycle_count_sessions")
      .update({ status: "in_progress", completed_at: null })
      .eq("id", sessionId);
    if (updErr) setError(updErr.message);
    else setSession((s) => (s ? { ...s, status: "in_progress", completed_at: null } : null));
    setReopening(false);
  }

  const diffs = showCompleteConfirm ? getDiffs() : [];
  const isCompleted = session?.status === "completed";

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Cycle count session</h2>
        <p className="text-slate-300">Select an active company.</p>
        <Link href="/items/cycle-count" className="text-emerald-400 hover:underline text-sm">← Cycle count</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Link href="/items/cycle-count" className="text-emerald-400 hover:underline text-sm">← Cycle count</Link>
        <p className="text-slate-400">Loading session…</p>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="space-y-4">
        <Link href="/items/cycle-count" className="text-emerald-400 hover:underline text-sm">← Cycle count</Link>
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/items/cycle-count" className="text-slate-400 hover:text-emerald-400 text-sm">← Cycle count</Link>
      </div>
      <h2 className="text-xl font-semibold">Cycle count session</h2>
      {session && (
        <p className="text-sm text-slate-400">
          Started {new Date(session.started_at).toLocaleString()}
          {session.completed_at && ` · Completed ${new Date(session.completed_at).toLocaleString()}`}
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {importMessage && <p className="text-sm text-slate-400">{importMessage}</p>}

      {lines.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900/50 px-3 py-2">
          <span className="text-xs text-slate-500">Options:</span>
          <button type="button" onClick={handleExportCSV} className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
            Export CSV
          </button>
          <label className="cursor-pointer rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
            Import CSV
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImportCSV}
            />
          </label>
          <Link
            href={`/items/cycle-count/session/${sessionId}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            Print list
          </Link>
        </div>
      )}

      {!isCompleted && lines.length > 0 && (
        <form onSubmit={handleSaveDraft} className="space-y-4">
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Location</th>
                  <th className="py-2 pr-3 text-right">Expected (on hand)</th>
                  <th className="py-2 pr-3 text-right">Counted</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-800">
                    <td className="py-2 pr-3 font-mono text-emerald-300">{l.items?.sku ?? l.item_id}</td>
                    <td className="py-2 pr-3 text-slate-300">{l.items?.name ?? "—"}</td>
                    <td className="py-2 pr-3 text-slate-400">{(l.locations?.name || l.locations?.code) ?? l.location_id}</td>
                    <td className="py-2 pr-3 text-right text-slate-300">{Number(l.expected_qty)}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={counted[l.id] ?? ""}
                        onChange={(e) => setCounted((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded bg-slate-600 px-3 py-1.5 text-sm text-white hover:bg-slate-500 disabled:opacity-50">
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => setShowCompleteConfirm(true)}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
            >
              Complete cycle count
            </button>
          </div>
        </form>
      )}

      {isCompleted && (
        <section className="space-y-3">
          {lines.length > 0 ? (
            <>
          <h3 className="text-sm font-semibold text-slate-200">Completed count – previous vs updated</h3>
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Location</th>
                  <th className="py-2 pr-3 text-right">Previous qty</th>
                  <th className="py-2 pr-3 text-right">Updated qty</th>
                  <th className="py-2 pr-3 text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const prev = Number(l.expected_qty) ?? 0;
                  const updated = l.counted_qty != null ? Number(l.counted_qty) : prev;
                  const change = updated - prev;
                  return (
                    <tr key={l.id} className="border-b border-slate-800">
                      <td className="py-2 pr-3 font-mono text-emerald-300">{l.items?.sku ?? l.item_id}</td>
                      <td className="py-2 pr-3 text-slate-300">{l.items?.name ?? "—"}</td>
                      <td className="py-2 pr-3 text-slate-400">{(l.locations?.name || l.locations?.code) ?? l.location_id}</td>
                      <td className="py-2 pr-3 text-right text-slate-300">{prev}</td>
                      <td className="py-2 pr-3 text-right text-slate-300">{updated}</td>
                      <td className={`py-2 pr-3 text-right font-medium ${change > 0 ? "text-emerald-400" : change < 0 ? "text-red-400" : "text-slate-500"}`}>
                        {change > 0 ? "+" : ""}{change}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            </>
          ) : (
            <p className="text-slate-400 text-sm">This session is completed. No line items were recorded.</p>
          )}
          <button
            type="button"
            onClick={handleReopen}
            disabled={reopening}
            className="rounded border border-amber-600 px-3 py-1.5 text-sm text-amber-400 hover:bg-amber-900/30 disabled:opacity-50"
          >
            {reopening ? "Reopening…" : "Reopen count"}
          </button>
        </section>
      )}

      {showCompleteConfirm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">Confirm inventory changes</h3>
            <p className="text-xs text-slate-400 mb-3">
              The following adjustments will be applied. Proceed?
            </p>
            {diffs.length === 0 ? (
              <p className="text-sm text-slate-300 mb-3">No quantity changes (all counts match expected). Session will be marked complete.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded border border-slate-700 mb-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700 text-left text-slate-400">
                      <th className="py-1 pr-2">SKU</th>
                      <th className="py-1 pr-2">Location</th>
                      <th className="py-1 pr-2 text-right">Expected</th>
                      <th className="py-1 pr-2 text-right">Counted</th>
                      <th className="py-1 pr-2 text-right">Adjustment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => (
                      <tr key={d.line.id} className="border-b border-slate-800">
                        <td className="py-1 pr-2 font-mono text-emerald-300">{d.line.items?.sku}</td>
                        <td className="py-1 pr-2 text-slate-400">{d.line.locations?.name || d.line.locations?.code}</td>
                        <td className="py-1 pr-2 text-right">{d.expected}</td>
                        <td className="py-1 pr-2 text-right">{d.counted}</td>
                        <td className={`py-1 pr-2 text-right font-medium ${d.diff > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {d.diff > 0 ? "+" : ""}{d.diff}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleComplete()}
                disabled={completing}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {completing ? "Applying…" : "Commit changes"}
              </button>
              <button
                type="button"
                onClick={() => setShowCompleteConfirm(false)}
                className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
