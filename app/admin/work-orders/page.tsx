"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type WorkOrder = {
  id: string;
  name: string;
  standard_quantity: number;
  standard_time_minutes: number;
  status?: string;
};

type ProcedureRow = {
  id: string;
  name: string;
};

export default function AdminWorkOrdersPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [standardQty, setStandardQty] = useState("1");
  const [standardTime, setStandardTime] = useState("60");
  const [selectedProcedures, setSelectedProcedures] = useState<ProcedureRow[]>(
    []
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    loadWorkOrders(active.id);
  }, []);

  async function loadWorkOrders(companyId: string) {
    const { data, error } = await supabase
      .from("work_orders")
      .select("id, name, standard_quantity, standard_time_minutes, status")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setWorkOrders((data ?? []) as WorkOrder[]);
    setLoading(false);
  }

  function openNew() {
    setEditingId(null);
    setShowForm(true);
    setError(null);
    setName("");
    setStandardQty("1");
    setStandardTime("60");
    setSelectedProcedures([]);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function openEdit(id: string) {
    if (!activeCompanyId) return;
    setError(null);
    setSaving(false);
    setEditingId(id);
    setShowForm(true);

    const { data: wo, error: woErr } = await supabase
      .from("work_orders")
      .select("name, standard_quantity, standard_time_minutes")
      .eq("id", id)
      .single();
    if (woErr || !wo) {
      setError(woErr?.message ?? "Work order not found");
      return;
    }
    setName(wo.name);
    setStandardQty(String(wo.standard_quantity ?? 1));
    setStandardTime(String(wo.standard_time_minutes ?? 60));

    const { data: links } = await supabase
      .from("work_order_procedures")
      .select("sequence, procedures(id, name, procedure_code)")
      .eq("work_order_id", id)
      .order("sequence", { ascending: true });
    setSelectedProcedures(
      ((links as any[]) ?? [])
        .map((row) => row.procedures)
        .filter(Boolean)
        .map((p: any) => ({
          id: p.id,
          name: `${p.procedure_code ?? ""} – ${p.name}`,
        }))
    );
  }

  async function duplicateWorkOrder(id: string) {
    if (!activeCompanyId) return;
    setError(null);
    setDuplicatingId(id);
    try {
      const { data: wo, error: woErr } = await supabase
        .from("work_orders")
        .select("id, company_id, name, standard_quantity, standard_time_minutes")
        .eq("id", id)
        .single();
      if (woErr || !wo) {
        setError(woErr?.message ?? "Work order not found for duplication.");
        setDuplicatingId(null);
        return;
      }

      const baseName = wo.name ?? "";
      const newName = baseName ? `${baseName} (Copy)` : "New work order (Copy)";

      const { data: inserted, error: insErr } = await supabase
        .from("work_orders")
        .insert({
          company_id: activeCompanyId,
          name: newName,
          standard_quantity: wo.standard_quantity ?? 0,
          standard_time_minutes: wo.standard_time_minutes ?? 0,
        })
        .select("id")
        .single();
      if (insErr || !inserted) {
        setError(insErr?.message ?? "Failed to duplicate work order.");
        setDuplicatingId(null);
        return;
      }

      const newId = inserted.id as string;
      const { data: links } = await supabase
        .from("work_order_procedures")
        .select("procedure_id, sequence")
        .eq("work_order_id", id)
        .order("sequence", { ascending: true });
      if (links && links.length > 0) {
        const rows = (links as any[]).map((row, idx) => ({
          work_order_id: newId,
          procedure_id: row.procedure_id,
          sequence: row.sequence ?? idx + 1,
        }));
        await supabase.from("work_order_procedures").insert(rows);
      }

      await loadWorkOrders(activeCompanyId);
    } finally {
      setDuplicatingId(null);
    }
  }

  async function deleteWorkOrder(id: string) {
    if (!activeCompanyId) return;
    if (!confirm("Delete this work order? This cannot be undone.")) return;
    const { error: delErr } = await supabase
      .from("work_orders")
      .delete()
      .eq("id", id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    loadWorkOrders(activeCompanyId);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    setError(null);

    const qty = parseFloat(standardQty) || 0;
    const time = parseInt(standardTime, 10) || 0;
    if (!name.trim() || qty <= 0 || time <= 0) {
      setError("Name, standard quantity, and standard time are required.");
      setSaving(false);
      return;
    }
    if (selectedProcedures.length === 0) {
      setError("Select at least one procedure.");
      setSaving(false);
      return;
    }

    let workOrderId = editingId;
    if (!workOrderId) {
      const { data: inserted, error: insertErr } = await supabase
        .from("work_orders")
        .insert({
          company_id: activeCompanyId,
          name: name.trim(),
          standard_quantity: qty,
          standard_time_minutes: time,
        })
        .select("id")
        .single();
      if (insertErr) {
        setError(insertErr.message);
        setSaving(false);
        return;
      }
      workOrderId = inserted?.id as string;
    } else {
      const { error: updErr } = await supabase
        .from("work_orders")
        .update({
          name: name.trim(),
          standard_quantity: qty,
          standard_time_minutes: time,
        })
        .eq("id", workOrderId);
      if (updErr) {
        setError(updErr.message);
        setSaving(false);
        return;
      }
      await supabase
        .from("work_order_procedures")
        .delete()
        .eq("work_order_id", workOrderId);
    }

    const rows = selectedProcedures.map((p, idx) => ({
      work_order_id: workOrderId,
      procedure_id: p.id,
      sequence: idx + 1,
    }));
    const { error: linkErr } = await supabase
      .from("work_order_procedures")
      .insert(rows);
    if (linkErr) {
      setError(linkErr.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    closeForm();
    loadWorkOrders(activeCompanyId);
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Work orders</h2>
        <p className="text-slate-300">Select an active company first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-xs text-emerald-400 hover:underline"
        >
          ← Admin
        </Link>
        <h2 className="text-xl font-semibold">Work orders</h2>
        {companyName && (
          <p className="text-sm text-slate-400">Company: {companyName}</p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="button"
        onClick={openNew}
        className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
      >
        + Create work order
      </button>

      {showForm && (
        <form
          onSubmit={handleSave}
          className="max-w-2xl space-y-4 rounded border border-slate-800 bg-slate-900/50 p-4"
        >
          <h3 className="text-sm font-semibold">New work order</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-500">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-500">
                  Standard quantity
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={standardQty}
                  onChange={(e) => setStandardQty(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500">
                  Standard time (minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={standardTime}
                  onChange={(e) => setStandardTime(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Search procedures to add to this work order
            </label>
            <ProcedureSearch
              companyId={activeCompanyId}
              selected={selectedProcedures}
              onSelect={(proc) => {
                setSelectedProcedures((prev) => {
                  if (prev.some((p) => p.id === proc.id)) return prev;
                  return [...prev, proc];
                });
              }}
            />
          </div>

          <div>
            <div className="mb-1">
              <label className="block text-xs text-slate-500">
                Procedures required (in order)
              </label>
            </div>
            {selectedProcedures.length === 0 ? (
              <p className="text-xs text-slate-500">
                No procedures yet. Use the search above to add them.
              </p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-400">
                    <th className="py-1 pr-2">#</th>
                    <th className="py-1 pr-2">Procedure</th>
                    <th className="py-1 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProcedures.map((p, idx) => (
                    <tr key={p.id} className="border-b border-slate-900">
                      <td className="py-1 pr-2 text-slate-500">{idx + 1}</td>
                      <td className="py-1 pr-2 text-slate-200">{p.name}</td>
                      <td className="py-1 pr-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedProcedures((prev) =>
                              prev.filter((x) => x.id !== p.id)
                            )
                          }
                          className="text-[11px] text-red-400 hover:underline"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save work order"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-slate-400">Loading…</p>}
      {!loading && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Std qty</th>
              <th className="py-2 pr-3">Std time (min)</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {workOrders.map((w) => (
              <tr key={w.id} className="border-b border-slate-900">
                <td className="py-2 pr-3 text-slate-200">{w.name}</td>
                <td className="py-2 pr-3 text-slate-300">
                  {w.standard_quantity}
                </td>
                <td className="py-2 pr-3 text-slate-300">
                  {w.standard_time_minutes}
                </td>
                <td className="py-2 pr-3 text-slate-400">
                  {w.status ?? "open"}
                </td>
                <td className="py-2 pr-3 space-x-2">
                  <button
                    type="button"
                    onClick={() => openEdit(w.id)}
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateWorkOrder(w.id)}
                    disabled={duplicatingId === w.id}
                    className="text-xs text-slate-400 hover:underline disabled:opacity-50"
                  >
                    {duplicatingId === w.id ? "Duplicating…" : "Duplicate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteWorkOrder(w.id)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

type ProcedureSearchProps = {
  companyId: string;
  selected: ProcedureRow[];
  onSelect: (proc: ProcedureRow) => void;
};

function ProcedureSearch({
  companyId,
  selected,
  onSelect,
}: ProcedureSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProcedureRow[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!companyId || q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setSearching(true);
      const { data } = await supabase
        .from("procedures")
        .select("id, name, procedure_code")
        .eq("company_id", companyId)
        .or(
          `name.ilike.%${q.replace(/%/g, "\\%")}%,procedure_code.ilike.%${q.replace(
            /%/g,
            "\\%"
          )}%`
        )
        .limit(10);
      if (!cancelled) {
        setResults(
          ((data as any[]) ?? []).map((p) => ({
            id: p.id,
            name: `${p.procedure_code} – ${p.name}`,
          }))
        );
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, query]);

  return (
    <div className="space-y-2 rounded border border-slate-800 bg-slate-950/60 p-3 text-xs">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search procedures by name or ID…"
          className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
        />
        {searching && (
          <span className="text-[10px] text-slate-500">Searching…</span>
        )}
      </div>
      {results.length > 0 && (
        <table className="w-full border-collapse">
          <tbody>
            {results.map((p) => {
              const already = selected.some((s) => s.id === p.id);
              return (
                <tr key={p.id} className="border-b border-slate-900">
                  <td className="py-1 pr-2 text-slate-200">{p.name}</td>
                  <td className="py-1 pr-2 text-right">
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => onSelect(p)}
                      className={`rounded border px-2 py-0.5 text-[11px] ${
                        already
                          ? "border-slate-700 text-slate-600"
                          : "border-emerald-600 text-emerald-300 hover:bg-emerald-900/40"
                      }`}
                    >
                      {already ? "Added" : "Add"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

