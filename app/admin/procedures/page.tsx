"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type Procedure = {
  id: string;
  company_id: string;
  name: string;
  procedure_code: string;
  output_item_id: string | null;
  output_quantity: number | null;
  tools_required?: string | null;
  steps?: string | null;
};

type ItemRow = {
  sku: string;
  quantity: string;
  name?: string;
};

export default function AdminProceduresPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [toolsRequired, setToolsRequired] = useState("");
  const [steps, setSteps] = useState("");
  const [outputSku, setOutputSku] = useState("");
  const [outputName, setOutputName] = useState("");
  const [outputQty, setOutputQty] = useState("1");
  const [itemsRequired, setItemsRequired] = useState<ItemRow[]>([]);
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
    loadProcedures(active.id);
  }, []);

  async function loadProcedures(companyId: string) {
    const { data, error } = await supabase
      .from("procedures")
      .select(
        "id, company_id, name, procedure_code, output_item_id, output_quantity",
      )
      .eq("company_id", companyId)
      .order("name");
    if (error) setError(error.message);
    else setProcedures((data ?? []) as Procedure[]);
    setLoading(false);
  }

  function openNew() {
    setEditingId(null);
    setShowForm(true);
    setError(null);
    setName("");
    setCode("");
    setToolsRequired("");
    setSteps("");
    setOutputSku("");
    setOutputName("");
    setOutputQty("1");
    setItemsRequired([]);
  }

  async function openEditFull(id: string) {
    if (!activeCompanyId) return;
    setError(null);
    setShowForm(true);
    setEditingId(id);
    setSaving(false);

    const { data: proc, error: procErr } = await supabase
      .from("procedures")
      .select(
        "id, name, procedure_code, tools_required, steps, output_item_id, output_quantity",
      )
      .eq("id", id)
      .single();

    if (procErr || !proc) {
      setError(procErr?.message ?? "Procedure not found.");
      setShowForm(false);
      setEditingId(null);
      return;
    }

    setName(proc.name ?? "");
    setCode(proc.procedure_code ?? "");
    setToolsRequired(proc.tools_required ?? "");
    setSteps(proc.steps ?? "");
    setOutputQty(
      proc.output_quantity != null ? String(proc.output_quantity) : "1",
    );

    let outSku = "";
    let outName = "";
    if (proc.output_item_id) {
      const { data: outItem } = await supabase
        .from("items")
        .select("sku, name")
        .eq("id", proc.output_item_id)
        .maybeSingle();
      if (outItem) {
        outSku = outItem.sku ?? "";
        outName = outItem.name ?? "";
      }
    }
    setOutputSku(outSku);
    setOutputName(outName);

    const { data: pi } = await supabase
      .from("procedure_items")
      .select("quantity_required, items ( sku, name )")
      .eq("procedure_id", id);

    const rows: ItemRow[] =
      (pi ?? []).map((row: any) => ({
        sku: row.items?.sku ?? "",
        name: row.items?.name ?? "",
        quantity:
          row.quantity_required != null
            ? String(row.quantity_required)
            : "1",
      })) ?? [];

    setItemsRequired(rows);
  }

  async function duplicateProcedure(id: string) {
    if (!activeCompanyId) return;
    setError(null);
    setDuplicatingId(id);
    try {
      const { data: proc, error: procErr } = await supabase
        .from("procedures")
        .select(
          "id, company_id, name, procedure_code, tools_required, steps, output_item_id, output_quantity, item_id",
        )
        .eq("id", id)
        .single();
      if (procErr || !proc) {
        setError(procErr?.message ?? "Procedure not found for duplication.");
        setDuplicatingId(null);
        return;
      }

      const baseName = proc.name ?? "";
      const newName = baseName ? `${baseName} (Copy)` : "New procedure (Copy)";

      const baseCode = proc.procedure_code ?? "";
      let candidate = baseCode ? `${baseCode}-COPY` : "PROC-COPY";
      // ensure unique procedure_code within company
      for (let i = 2; i < 20; i += 1) {
        const { data: existing } = await supabase
          .from("procedures")
          .select("id")
          .eq("company_id", activeCompanyId)
          .eq("procedure_code", candidate)
          .maybeSingle();
        if (!existing) break;
        candidate = `${baseCode || "PROC"}-COPY${i}`;
      }

      const sourceItemId = proc.output_item_id ?? proc.item_id ?? null;
      let nextVersion: number | null = null;
      if (sourceItemId) {
        const { data: maxRow } = await supabase
          .from("procedures")
          .select("version")
          .eq("company_id", activeCompanyId)
          .eq("item_id", sourceItemId)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        nextVersion = ((maxRow as any)?.version ?? 0) + 1;
      }

      const { data: inserted, error: insErr } = await supabase
        .from("procedures")
        .insert({
          company_id: activeCompanyId,
          name: newName,
          procedure_code: candidate,
          tools_required: proc.tools_required ?? null,
          steps: proc.steps ?? null,
          output_item_id: proc.output_item_id ?? null,
          output_quantity: proc.output_quantity ?? null,
          item_id: sourceItemId,
          ...(nextVersion != null ? { version: nextVersion } : {}),
        })
        .select("id")
        .single();
      if (insErr || !inserted) {
        setError(insErr?.message ?? "Failed to duplicate procedure.");
        setDuplicatingId(null);
        return;
      }

      const newId = inserted.id as string;
      const { data: items } = await supabase
        .from("procedure_items")
        .select("item_id, quantity_required")
        .eq("procedure_id", id);
      if (items && items.length > 0) {
        const rows = items.map((row: any) => ({
          procedure_id: newId,
          item_id: row.item_id,
          quantity_required: row.quantity_required,
        }));
        await supabase.from("procedure_items").insert(rows);
      }

      await loadProcedures(activeCompanyId);
    } finally {
      setDuplicatingId(null);
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  function updateItemRow(index: number, field: keyof ItemRow, value: string) {
    setItemsRequired((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addItemRow() {
    setItemsRequired((prev) => [...prev, { sku: "", quantity: "1", name: "" }]);
  }

  function removeItemRow(index: number) {
    setItemsRequired((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    setError(null);

    const trimmedItems = itemsRequired
      .map((row) => ({
        sku: row.sku.trim(),
        quantity: parseFloat(row.quantity) || 0,
      }))
      .filter((row) => row.sku && row.quantity > 0);

    if (!name.trim() || !code.trim()) {
      setError("Name and Procedure ID are required.");
      setSaving(false);
      return;
    }
    if (trimmedItems.length === 0) {
      setError("At least one required item (SKU and quantity) is needed.");
      setSaving(false);
      return;
    }

    const skuSet = new Set<string>(trimmedItems.map((r) => r.sku));
    if (outputSku.trim()) {
      skuSet.add(outputSku.trim());
    }
    const skuList = Array.from(skuSet);

    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("id, sku")
      .eq("company_id", activeCompanyId)
      .in("sku", skuList);
    if (itemsErr) {
      setError(itemsErr.message);
      setSaving(false);
      return;
    }
    const map = new Map<string, string>(
      (items ?? []).map((it: any) => [it.sku, it.id])
    );

    const missing = skuList.filter((sku) => !map.has(sku));
    if (missing.length > 0) {
      setError(
        `These SKUs were not found for this company: ${missing.join(", ")}`
      );
      setSaving(false);
      return;
    }

    const outSkuTrimmed = outputSku.trim();
    const outputItemId = outSkuTrimmed ? map.get(outSkuTrimmed) ?? null : null;
    const outQty = outSkuTrimmed ? parseFloat(outputQty) || 0 : null;

    let procedureId = editingId;
    if (!procedureId) {
      const { data: inserted, error: insertErr } = await supabase
        .from("procedures")
        .insert({
          company_id: activeCompanyId,
          name: name.trim(),
          procedure_code: code.trim(),
          tools_required: toolsRequired.trim() || null,
          steps: steps.trim() || null,
          output_item_id: outputItemId,
          output_quantity: outQty,
          // For item-scoped views, prefer the output item; fall back to first required item
          item_id:
            outputItemId ??
            (trimmedItems.length > 0 ? map.get(trimmedItems[0].sku)! : null),
        })
        .select("id")
        .single();
      if (insertErr) {
        setError(insertErr.message);
        setSaving(false);
        return;
      }
      procedureId = inserted?.id as string;
    } else {
      const { error: updErr } = await supabase
        .from("procedures")
        .update({
          name: name.trim(),
          procedure_code: code.trim(),
          tools_required: toolsRequired.trim() || null,
          steps: steps.trim() || null,
          output_item_id: outputItemId,
          output_quantity: outQty,
        })
        .eq("id", procedureId);
      if (updErr) {
        setError(updErr.message);
        setSaving(false);
        return;
      }
      await supabase
        .from("procedure_items")
        .delete()
        .eq("procedure_id", procedureId);
    }

    const rows = trimmedItems.map((row) => ({
      procedure_id: procedureId,
      item_id: map.get(row.sku)!,
      quantity_required: row.quantity,
    }));
    const { error: piErr } = await supabase
      .from("procedure_items")
      .insert(rows);
    if (piErr) {
      setError(piErr.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    closeForm();
    loadProcedures(activeCompanyId);
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Procedures</h2>
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
        <h2 className="text-xl font-semibold">Procedures</h2>
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
        + Add procedure
      </button>

      {showForm && (
        <form
          onSubmit={handleSave}
          className="max-w-2xl space-y-4 rounded border border-slate-800 bg-slate-900/50 p-4"
        >
          <h3 className="text-sm font-semibold">
            {editingId ? "Edit procedure" : "Add procedure"}
          </h3>
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
            <div>
              <label className="block text-xs text-slate-500">
                Procedure ID (short code)
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                placeholder="e.g. LASER-CUT-01"
                required
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-500">
                Tools required (optional)
              </label>
              <textarea
                value={toolsRequired}
                onChange={(e) => setToolsRequired(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm min-h-[60px]"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">
                Steps (optional)
              </label>
              <textarea
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm min-h-[60px]"
              />
            </div>
          </div>

          {/* Item search (for both inputs and output) */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Search items to add as input or set as output
            </label>
            <ItemSearch
              companyId={activeCompanyId}
              onAddInput={(sku, name) => {
                setItemsRequired((prev) => {
                  if (prev.some((r) => r.sku === sku)) return prev;
                  return [...prev, { sku, name, quantity: "1" }];
                });
              }}
              onSetOutput={(sku, name) => {
                setOutputSku(sku);
                setOutputName(name);
              }}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-[2fr,1fr]">
            <div>
              <label className="block text-xs text-slate-500">
                Output item (optional)
              </label>
              {outputSku ? (
                <div className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm flex items-center gap-2">
                  <span className="font-mono text-emerald-300">{outputSku}</span>
                  <span className="flex-1 truncate text-xs text-slate-400">
                    {outputName || "Output item"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setOutputSku("");
                      setOutputName("");
                    }}
                    className="text-xs text-red-400 hover:underline"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No output item selected. Use the search above to set one.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-500">
                Output quantity
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={outputQty}
                onChange={(e) => setOutputQty(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div>
            <div className="mb-1">
              <label className="block text-xs text-slate-500">
                Input items – at least one (added via search above)
              </label>
            </div>
            {itemsRequired.length === 0 ? (
              <p className="text-xs text-slate-500">
                No input items yet. Use the search above to add them.
              </p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-400">
                    <th className="py-1 pr-2">SKU</th>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2">Qty</th>
                    <th className="py-1 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {itemsRequired.map((row, index) => (
                    <tr key={row.sku} className="border-b border-slate-900">
                      <td className="py-1 pr-2 font-mono text-emerald-300">
                        {row.sku}
                      </td>
                      <td className="py-1 pr-2 text-slate-300">
                        {row.name || "—"}
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={row.quantity}
                          onChange={(e) =>
                            updateItemRow(index, "quantity", e.target.value)
                          }
                          className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs"
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <button
                          type="button"
                          onClick={() => removeItemRow(index)}
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
              {saving ? "Saving…" : "Save procedure"}
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
              <th className="py-2 pr-3">Procedure ID</th>
              <th className="py-2 pr-3">Output qty</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {procedures.map((p) => (
              <tr key={p.id} className="border-b border-slate-900">
                <td className="py-2 pr-3 text-slate-200">{p.name}</td>
                <td className="py-2 pr-3 font-mono text-slate-400">
                  {p.procedure_code}
                </td>
                <td className="py-2 pr-3 text-slate-300">
                  {p.output_quantity ?? "—"}
                </td>
                <td className="py-2 pr-3 space-x-2">
                  <button
                    type="button"
                    onClick={() => openEditFull(p.id)}
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateProcedure(p.id)}
                    disabled={duplicatingId === p.id}
                    className="text-xs text-slate-400 hover:underline disabled:opacity-50"
                  >
                    {duplicatingId === p.id ? "Duplicating…" : "Duplicate"}
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

type ItemSearchProps = {
  companyId: string;
  onAddInput: (sku: string, name: string) => void;
  onSetOutput: (sku: string, name: string) => void;
};

function ItemSearch({ companyId, onAddInput, onSetOutput }: ItemSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ sku: string; name: string }[]>([]);
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
        .from("items")
        .select("sku, name")
        .eq("company_id", companyId)
        .or(
          `sku.ilike.%${q.replace(/%/g, "\\%")}%,name.ilike.%${q.replace(
            /%/g,
            "\\%"
          )}%`
        )
        .limit(10);
      if (!cancelled) {
        setResults((data as { sku: string; name: string }[]) ?? []);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, query]);

  return (
    <div className="space-y-2 rounded border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by SKU or name…"
          className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
        />
        {searching && (
          <span className="text-[10px] text-slate-500">Searching…</span>
        )}
      </div>
      {results.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-1 pr-2">SKU</th>
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.sku} className="border-b border-slate-900">
                <td className="py-1 pr-2 font-mono text-emerald-300">
                  {r.sku}
                </td>
                <td className="py-1 pr-2 text-slate-300">{r.name}</td>
                <td className="py-1 pr-2 text-right space-x-1">
                  <button
                    type="button"
                    onClick={() => onAddInput(r.sku, r.name)}
                    className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800"
                  >
                    Add as input
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetOutput(r.sku, r.name)}
                    className="rounded border border-emerald-600 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-900/40"
                  >
                    Set as output
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


