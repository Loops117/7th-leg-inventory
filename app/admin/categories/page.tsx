"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type Category = {
  id: string;
  company_id: string;
  name: string;
  sku_prefix: string;
  sku_suffix: string;
  sku_counter: number;
  taxable: boolean;
  purchasable: boolean;
  is_active: boolean;
};

export default function AdminCategoriesPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSkuPrefix, setFormSkuPrefix] = useState("");
  const [formSkuSuffix, setFormSkuSuffix] = useState("");
  const [formSkuCounter, setFormSkuCounter] = useState(0);
  const [formTaxable, setFormTaxable] = useState(true);
  const [formPurchasable, setFormPurchasable] = useState(true);
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    loadCategories(active.id);
  }, []);

  async function loadCategories(companyId: string) {
    const { data, error } = await supabase
      .from("item_categories")
      .select("id, company_id, name, sku_prefix, sku_suffix, sku_counter, taxable, purchasable, is_active")
      .eq("company_id", companyId)
      .order("name");
    if (error) setError(error.message);
    else setCategories((data ?? []) as Category[]);
    setLoading(false);
  }

  function openNew() {
    setEditingId(null);
    setShowForm(true);
    setFormName("");
    setFormSkuPrefix("");
    setFormSkuSuffix("");
    setFormSkuCounter(0);
    setFormTaxable(true);
    setFormPurchasable(true);
    setFormActive(true);
  }

  function openEdit(c: Category) {
    setEditingId(c.id);
    setShowForm(true);
    setFormName(c.name);
    setFormSkuPrefix(c.sku_prefix ?? "");
    setFormSkuSuffix(c.sku_suffix ?? "");
    setFormSkuCounter(c.sku_counter ?? 0);
    setFormTaxable(c.taxable);
    setFormPurchasable(c.purchasable);
    setFormActive(c.is_active);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    const payload = {
      name: formName.trim(),
      sku_prefix: formSkuPrefix.trim(),
      sku_suffix: formSkuSuffix.trim(),
      sku_counter: formSkuCounter,
      taxable: formTaxable,
      purchasable: formPurchasable,
      is_active: formActive,
    };
    if (editingId) {
      await supabase.from("item_categories").update(payload).eq("id", editingId);
    } else {
      await supabase.from("item_categories").insert({ company_id: activeCompanyId, ...payload });
    }
    setSaving(false);
    closeForm();
    loadCategories(activeCompanyId);
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Item categories</h2>
        <p className="text-slate-300">Select an active company first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-emerald-400 hover:underline">← Admin</Link>
        <h2 className="text-xl font-semibold">Item categories</h2>
        {companyName && <p className="text-sm text-slate-400">Company: {companyName}</p>}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <button type="button" onClick={openNew} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
        + Add category
      </button>

      {showForm && (
        <form onSubmit={handleSave} className="max-w-md space-y-3 rounded border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-semibold">{editingId ? "Edit category" : "Add category"}</h3>
          <div>
            <label className="block text-xs text-slate-500">Name</label>
            <input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-slate-500">SKU prefix</label>
            <input value={formSkuPrefix} onChange={(e) => setFormSkuPrefix(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" placeholder="e.g. LB-" />
          </div>
          <div>
            <label className="block text-xs text-slate-500">SKU suffix</label>
            <input value={formSkuSuffix} onChange={(e) => setFormSkuSuffix(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" placeholder="e.g. -A" />
          </div>
          <div>
            <label className="block text-xs text-slate-500">SKU counter (next number used)</label>
            <input type="number" min={0} value={formSkuCounter} onChange={(e) => setFormSkuCounter(parseInt(e.target.value, 10) || 0)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" />
            <p className="mt-1 text-xs text-slate-500">Next SKU: {formSkuPrefix || "..."}{formSkuCounter + 1}{formSkuSuffix}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={formTaxable} onChange={(e) => setFormTaxable(e.target.checked)} />
            Taxable
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={formPurchasable} onChange={(e) => setFormPurchasable(e.target.checked)} />
            Purchasable
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
            Active / Enabled
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">Save</button>
            <button type="button" onClick={closeForm} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
          </div>
        </form>
      )}

      {loading && <p className="text-slate-400">Loading…</p>}
      {!loading && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">SKU prefix</th>
              <th className="py-2 pr-3">SKU suffix</th>
              <th className="py-2 pr-3">Counter</th>
              <th className="py-2 pr-3">Taxable</th>
              <th className="py-2 pr-3">Purchasable</th>
              <th className="py-2 pr-3">Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-b border-slate-900">
                <td className="py-2 pr-3">{c.name}</td>
                <td className="py-2 pr-3 font-mono text-slate-400">{c.sku_prefix || "—"}</td>
                <td className="py-2 pr-3 font-mono text-slate-400">{c.sku_suffix || "—"}</td>
                <td className="py-2 pr-3">{c.sku_counter}</td>
                <td className="py-2 pr-3">{c.taxable ? "Yes" : "No"}</td>
                <td className="py-2 pr-3">{c.purchasable ? "Yes" : "No"}</td>
                <td className="py-2 pr-3">{c.is_active ? "Yes" : "No"}</td>
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => openEdit(c)} className="text-xs text-emerald-400 hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
