"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type ItemType = {
  id: string;
  company_id: string;
  name: string;
  sku_prefix: string;
  sku_suffix: string;
};
type Category = { id: string; name: string };
type CategoryType = { category_id: string; type_id: string };

export default function AdminTypesPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [types, setTypes] = useState<ItemType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryTypes, setCategoryTypes] = useState<CategoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formPrefix, setFormPrefix] = useState("");
  const [formSuffix, setFormSuffix] = useState("");
  const [formCategoryIds, setFormCategoryIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    loadAll(active.id);
  }, []);

  async function loadAll(companyId: string) {
    const [t, c, ct] = await Promise.all([
      supabase
        .from("item_types")
        .select("id, company_id, name, sku_prefix, sku_suffix")
        .eq("company_id", companyId)
        .order("name"),
      supabase.from("item_categories").select("id, name").eq("company_id", companyId).eq("is_active", true).order("name"),
      supabase.from("item_category_types").select("category_id, type_id"),
    ]);
    setTypes((t.data ?? []) as ItemType[]);
    setCategories((c.data ?? []) as Category[]);
    setCategoryTypes((ct.data ?? []) as CategoryType[]);
    setLoading(false);
  }

  function categoriesForType(typeId: string): string[] {
    return categoryTypes.filter((ct) => ct.type_id === typeId).map((ct) => ct.category_id);
  }

  function openNew() {
    setEditingId(null);
    setShowForm(true);
    setFormName("");
    setFormPrefix("");
    setFormSuffix("");
    setFormCategoryIds([]);
  }

  function openEdit(t: ItemType) {
    setEditingId(t.id);
    setShowForm(true);
    setFormName(t.name);
    setFormPrefix(t.sku_prefix ?? "");
    setFormSuffix(t.sku_suffix ?? "");
    setFormCategoryIds(categoriesForType(t.id));
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    const name = formName.trim();
    const sku_prefix = (formPrefix ?? "").trim();
    const sku_suffix = (formSuffix ?? "").trim();
    if (editingId) {
      await supabase
        .from("item_types")
        .update({ name, sku_prefix, sku_suffix })
        .eq("id", editingId);
      await supabase.from("item_category_types").delete().eq("type_id", editingId);
      if (formCategoryIds.length) {
        await supabase.from("item_category_types").insert(formCategoryIds.map((category_id) => ({ category_id, type_id: editingId })));
      }
    } else {
      const { data: newType, error: insertErr } = await supabase
        .from("item_types")
        .insert({ company_id: activeCompanyId, name, sku_prefix, sku_suffix })
        .select("id")
        .single();
      if (!insertErr && newType && formCategoryIds.length) {
        await supabase.from("item_category_types").insert(formCategoryIds.map((category_id) => ({ category_id, type_id: newType.id })));
      }
    }
    setSaving(false);
    closeForm();
    loadAll(activeCompanyId);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item type?")) return;
    await supabase.from("item_types").delete().eq("id", id);
    loadAll(activeCompanyId!);
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Item types</h2>
        <p className="text-slate-300">Select an active company first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-emerald-400 hover:underline">← Admin</Link>
        <h2 className="text-xl font-semibold">Item types</h2>
        {companyName && <p className="text-sm text-slate-400">Company: {companyName}</p>}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <button type="button" onClick={openNew} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
        + Add type
      </button>

      {showForm && (
        <form onSubmit={handleSave} className="max-w-md space-y-3 rounded border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-semibold">{editingId ? "Edit type" : "Add type"}</h3>
          <div>
            <label className="block text-xs text-slate-500">Name</label>
            <input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" placeholder="e.g. Plastic, Metal, Screw" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500">SKU prefix</label>
              <input
                value={formPrefix}
                onChange={(e) => setFormPrefix(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-mono"
                placeholder="e.g. SCR-"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">SKU suffix</label>
              <input
                value={formSuffix}
                onChange={(e) => setFormSuffix(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-mono"
                placeholder="-SS"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Categories (assign to one or more)</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <label key={cat.id} className="flex items-center gap-1.5 rounded border border-slate-700 px-2 py-1 text-sm">
                  <input type="checkbox" checked={formCategoryIds.includes(cat.id)} onChange={(e) => setFormCategoryIds((prev) => (e.target.checked ? [...prev, cat.id] : prev.filter((id) => id !== cat.id)))} />
                  {cat.name}
                </label>
              ))}
              {categories.length === 0 && <span className="text-slate-500 text-sm">No categories yet. Create them under Item categories.</span>}
            </div>
          </div>
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
              <th className="py-2 pr-3">SKU pattern</th>
              <th className="py-2 pr-3">Categories</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const catIds = categoriesForType(t.id);
              const names = catIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
              return (
                <tr key={t.id} className="border-b border-slate-900">
                  <td className="py-2 pr-3">{t.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-400">
                    {(t.sku_prefix ?? "")}
                    {"{counter}"}
                    {(t.sku_suffix ?? "")}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{names || "—"}</td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => openEdit(t)} className="text-xs text-emerald-400 hover:underline mr-2">Edit</button>
                    <button type="button" onClick={() => handleDelete(t.id)} className="text-xs text-red-400 hover:underline">Delete</button>
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
