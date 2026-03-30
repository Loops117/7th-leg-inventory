"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type Category = {
  id: string;
  name: string;
  sku_prefix: string;
  sku_suffix: string;
  sku_counter: number;
};
type ItemType = {
  id: string;
  name: string;
  sku_prefix: string;
  sku_suffix: string;
};
type CategoryType = { category_id: string; type_id: string };

export default function NewItemPage() {
  const router = useRouter();
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [types, setTypes] = useState<ItemType[]>([]);
  const [categoryTypes, setCategoryTypes] = useState<CategoryType[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [generatedSku, setGeneratedSku] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    (async () => {
      const [catRes, typeRes, ctRes] = await Promise.all([
        supabase.from("item_categories").select("id, name, sku_prefix, sku_suffix, sku_counter").eq("company_id", active.id).eq("is_active", true).order("name"),
        supabase.from("item_types").select("id, name, sku_prefix, sku_suffix").eq("company_id", active.id).order("name"),
        supabase.from("item_category_types").select("category_id, type_id"),
      ]);
      setCategories((catRes.data ?? []) as Category[]);
      setTypes((typeRes.data ?? []) as ItemType[]);
      setCategoryTypes((ctRes.data ?? []) as CategoryType[]);
      setLoading(false);
    })();
  }, []);

  const typeIdsInCategory = categoryId
    ? categoryTypes.filter((ct) => ct.category_id === categoryId).map((ct) => ct.type_id)
    : [];
  const typesForCategory = types.filter((t) => typeIdsInCategory.includes(t.id));

  function handleGenerate() {
    if (!categoryId || !typeId) {
      setError("Select a category and type first.");
      return;
    }
    const cat = categories.find((c) => c.id === categoryId);
    const type = types.find((t) => t.id === typeId);
    if (!cat || !type) return;
    const next = (cat.sku_counter ?? 0) + 1;
    const padded = String(next);
    const catPrefix = (cat.sku_prefix ?? "").trim();
    const catSuffix = (cat.sku_suffix ?? "").trim();
    const typePrefix = (type.sku_prefix ?? "").trim();
    const typeSuffix = (type.sku_suffix ?? "").trim();
    setGeneratedSku(
      `${catPrefix}${typePrefix}${padded}${typeSuffix}${catSuffix}`,
    );
    setError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    const sku = generatedSku.trim();
    if (!sku) {
      setError("Generate a SKU first or enter one.");
      return;
    }
    if (!categoryId || !typeId) {
      setError("Select category and type.");
      return;
    }
    const name = description.trim() || sku;
    setSaving(true);
    setError(null);

    const { data: newItem, error: insertErr } = await supabase
      .from("items")
      .insert({
        company_id: activeCompanyId,
        sku,
        name,
        description: description.trim() || null,
        item_category_id: categoryId,
        item_type_id: typeId,
        item_type: "raw",
      })
      .select("id")
      .single();

    if (insertErr) {
      setError(insertErr.message);
      setSaving(false);
      return;
    }

    const cat = categories.find((c) => c.id === categoryId);
    if (cat) {
      const next = (cat.sku_counter ?? 0) + 1;
      await supabase.from("item_categories").update({ sku_counter: next }).eq("id", categoryId);
    }

    setSaving(false);
    router.push(`/items/${newItem.id}`);
  }

  if (!activeCompanyId && !loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Create item</h2>
        <p className="text-slate-300">Select an active company first.</p>
        <Link href="/companies" className="text-emerald-400 underline">Companies</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/items" className="text-xs text-emerald-400 hover:underline">← Items</Link>
        <h2 className="text-xl font-semibold">Create item</h2>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading && <p className="text-slate-400">Loading…</p>}

      {!loading && (
        <form onSubmit={handleSave} className="max-w-lg space-y-4 rounded border border-slate-800 bg-slate-900/50 p-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Item category</label>
            <select
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setTypeId(""); setGeneratedSku(""); }}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              required
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Item type</label>
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              required
            >
              <option value="">Select type</option>
              {typesForCategory.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              {categoryId && typesForCategory.length === 0 && (
                <option value="" disabled>No types assigned to this category</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Description (used as item name)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 min-h-[80px]"
              placeholder="e.g. Laser diode, 5W"
            />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-slate-500 mb-1">SKU</label>
              <input
                type="text"
                value={generatedSku}
                onChange={(e) => setGeneratedSku(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 font-mono"
                placeholder="Click Generate to create from category"
              />
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!categoryId || !typeId}
              className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Generate
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Generate creates the next SKU from the category and type prefixes,
            the category counter, and the category/type suffixes. You can edit
            the SKU before saving.
          </p>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving || !generatedSku.trim()}
              className="rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <Link href="/items" className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
