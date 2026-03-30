"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type CycleCountList = {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
  last_performed_at?: string | null;
  item_count?: number;
};

type CycleCountSession = {
  id: string;
  list_id: string;
  company_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  list_name?: string;
};

type ItemRow = { sku: string; name: string; id?: string };

export default function CycleCountPage() {
  const router = useRouter();
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [lists, setLists] = useState<CycleCountList[]>([]);
  const [sessions, setSessions] = useState<CycleCountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [selectedItems, setSelectedItems] = useState<ItemRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const loadLists = useCallback(async (companyId: string) => {
    const { data: listData, error: listErr } = await supabase
      .from("cycle_count_lists")
      .select("id, company_id, name, created_at")
      .eq("company_id", companyId)
      .order("name");
    if (listErr) {
      setError(listErr.message);
      setLists([]);
      return;
    }
    const listRows = (listData ?? []) as { id: string; company_id: string; name: string; created_at: string }[];
    const ids = listRows.map((l) => l.id);
    if (ids.length === 0) {
      setLists(listRows.map((l) => ({ ...l, last_performed_at: null, item_count: 0 })));
      setLoading(false);
      return;
    }
    const { data: itemCounts } = await supabase
      .from("cycle_count_list_items")
      .select("list_id");
    const countByList = new Map<string, number>();
    (itemCounts ?? []).forEach((r: { list_id: string }) => {
      countByList.set(r.list_id, (countByList.get(r.list_id) ?? 0) + 1);
    });
    const { data: sessionData } = await supabase
      .from("cycle_count_sessions")
      .select("list_id, completed_at, started_at")
      .in("list_id", ids)
      .order("completed_at", { ascending: false });
    const lastByList = new Map<string, string | null>();
    (sessionData ?? []).forEach((s: { list_id: string; completed_at: string | null; started_at: string }) => {
      if (!lastByList.has(s.list_id)) {
        lastByList.set(s.list_id, s.completed_at ?? s.started_at);
      }
    });
    setLists(
      listRows.map((l) => ({
        ...l,
        last_performed_at: lastByList.get(l.id) ?? null,
        item_count: countByList.get(l.id) ?? 0,
      }))
    );
  }, []);

  const loadSessions = useCallback(async (companyId: string) => {
    const { data, error: sessErr } = await supabase
      .from("cycle_count_sessions")
      .select("id, list_id, company_id, started_at, completed_at, status")
      .eq("company_id", companyId)
      .order("started_at", { ascending: false })
      .limit(50);
    if (sessErr) {
      setSessions([]);
      return;
    }
    const rows = (data ?? []) as CycleCountSession[];
    const listIds = [...new Set(rows.map((r) => r.list_id))];
    const { data: listNames } = await supabase
      .from("cycle_count_lists")
      .select("id, name")
      .in("id", listIds);
    const nameMap = new Map((listNames ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));
    setSessions(rows.map((r) => ({ ...r, list_name: nameMap.get(r.list_id) ?? "—" })));
  }, []);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    (async () => {
      await loadLists(active.id);
      await loadSessions(active.id);
      setLoading(false);
    })();
  }, [loadLists, loadSessions]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!activeCompanyId || q.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setSearching(true);
      const { data } = await supabase
        .from("items")
        .select("id, sku, name")
        .eq("company_id", activeCompanyId)
        .or(`sku.ilike.%${q.replace(/%/g, "\\%")}%,name.ilike.%${q.replace(/%/g, "\\%")}%`)
        .limit(10);
      if (!cancelled) {
        setSearchResults((data as { id: string; sku: string; name: string }[]) ?? []);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, searchQuery]);

  function openNew() {
    setEditingListId(null);
    setShowForm(true);
    setError(null);
    setListName("");
    setSelectedItems([]);
  }

  async function openEdit(id: string) {
    setError(null);
    setShowForm(true);
    setEditingListId(id);
    const { data: list } = await supabase.from("cycle_count_lists").select("name").eq("id", id).single();
    if (list) setListName((list as { name: string }).name ?? "");
    const { data: items } = await supabase
      .from("cycle_count_list_items")
      .select("items(id, sku, name)")
      .eq("list_id", id);
    const rows: ItemRow[] = (items ?? []).map((row: any) => ({
      id: row.items?.id,
      sku: row.items?.sku ?? "",
      name: row.items?.name ?? "",
    }));
    setSelectedItems(rows);
  }

  function addItem(item: { id: string; sku: string; name: string }) {
    if (selectedItems.some((r) => r.sku === item.sku)) return;
    setSelectedItems((prev) => [...prev, { id: item.id, sku: item.sku, name: item.name }]);
  }

  function removeItem(index: number) {
    setSelectedItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveList(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || !listName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const skus = selectedItems.map((r) => r.sku);
      const { data: itemsBySku } = await supabase
        .from("items")
        .select("id, sku")
        .eq("company_id", activeCompanyId)
        .in("sku", skus);
      const skuToId = new Map((itemsBySku ?? []).map((i: any) => [i.sku, i.id]));
      const itemIds = skus.map((sku) => skuToId.get(sku)).filter(Boolean) as string[];

      if (editingListId) {
        await supabase.from("cycle_count_lists").update({ name: listName.trim(), updated_at: new Date().toISOString() }).eq("id", editingListId);
        await supabase.from("cycle_count_list_items").delete().eq("list_id", editingListId);
        if (itemIds.length > 0) {
          await supabase.from("cycle_count_list_items").insert(itemIds.map((item_id) => ({ list_id: editingListId, item_id })));
        }
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("cycle_count_lists")
          .insert({ company_id: activeCompanyId, name: listName.trim() })
          .select("id")
          .single();
        if (insErr) throw insErr;
        const listId = (inserted as { id: string }).id;
        if (itemIds.length > 0) {
          await supabase.from("cycle_count_list_items").insert(itemIds.map((item_id) => ({ list_id: listId, item_id })));
        }
      }
      setShowForm(false);
      setEditingListId(null);
      loadLists(activeCompanyId);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    }
    setSaving(false);
  }

  async function deleteList(id: string) {
    if (!confirm("Delete this cycle count list? Sessions will remain but the list will be removed.")) return;
    await supabase.from("cycle_count_lists").delete().eq("id", id);
    loadLists(activeCompanyId!);
    loadSessions(activeCompanyId!);
  }

  async function duplicateList(id: string) {
    if (!activeCompanyId) return;
    setDuplicatingId(id);
    setError(null);
    try {
      const { data: list } = await supabase.from("cycle_count_lists").select("name").eq("id", id).single();
      const { data: items } = await supabase.from("cycle_count_list_items").select("item_id").eq("list_id", id);
      const name = list ? `${(list as { name: string }).name} (Copy)` : "Cycle count (Copy)";
      const { data: inserted } = await supabase.from("cycle_count_lists").insert({ company_id: activeCompanyId, name }).select("id").single();
      const newId = (inserted as { id: string })?.id;
      if (newId && (items ?? []).length > 0) {
        await supabase.from("cycle_count_list_items").insert((items as { item_id: string }[]).map((r) => ({ list_id: newId, item_id: r.item_id })));
      }
      loadLists(activeCompanyId);
    } catch (err: any) {
      setError(err?.message ?? "Failed to duplicate");
    }
    setDuplicatingId(null);
  }

  async function startCycleCount(listId: string) {
    if (!activeCompanyId) return;
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: session, error: sessErr } = await supabase
      .from("cycle_count_sessions")
      .insert({
        list_id: listId,
        company_id: activeCompanyId,
        status: "in_progress",
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (sessErr) {
      setError(sessErr.message);
      return;
    }
    const sessionId = (session as { id: string }).id;
    const { data: listItems } = await supabase.from("cycle_count_list_items").select("item_id").eq("list_id", listId);
    const itemIds = (listItems ?? []).map((r: { item_id: string }) => r.item_id);
    const lines: { session_id: string; item_id: string; location_id: string; expected_qty: number }[] = [];
    if (itemIds.length > 0) {
      const { data: balances } = await supabase
        .from("inventory_balances")
        .select("item_id, location_id, on_hand_qty")
        .in("item_id", itemIds);
      const { data: itemLocs } = await supabase.from("item_locations").select("item_id, location_id").in("item_id", itemIds);
      const locationByItem = new Map<string, string[]>();
      (itemLocs ?? []).forEach((r: { item_id: string; location_id: string }) => {
        if (!locationByItem.has(r.item_id)) locationByItem.set(r.item_id, []);
        if (!locationByItem.get(r.item_id)!.includes(r.location_id)) locationByItem.get(r.item_id)!.push(r.location_id);
      });
      (balances ?? []).forEach((b: { item_id: string; location_id: string }) => {
        if (!locationByItem.has(b.item_id)) locationByItem.set(b.item_id, []);
        if (!locationByItem.get(b.item_id)!.includes(b.location_id)) locationByItem.get(b.item_id)!.push(b.location_id);
      });
      const balMap = new Map<string, number>();
      (balances ?? []).forEach((b: { item_id: string; location_id: string; on_hand_qty: number }) => {
        balMap.set(`${b.item_id}:${b.location_id}`, Number(b.on_hand_qty));
      });
      const { data: defaultLoc } = await supabase.from("locations").select("id").eq("company_id", activeCompanyId).limit(1).maybeSingle();
      const defaultLocationId = (defaultLoc as { id: string } | null)?.id ?? null;
      for (const itemId of itemIds) {
        const locs = locationByItem.get(itemId) ?? [];
        const seen = new Set<string>();
        if (locs.length === 0 && defaultLocationId) {
          lines.push({ session_id: sessionId, item_id: itemId, location_id: defaultLocationId, expected_qty: 0 });
        } else {
          for (const locId of locs) {
            if (seen.has(locId)) continue;
            seen.add(locId);
            const qty = balMap.get(`${itemId}:${locId}`) ?? 0;
            lines.push({ session_id: sessionId, item_id: itemId, location_id: locId, expected_qty: qty });
          }
        }
      }
      if (lines.length > 0) {
        await supabase.from("cycle_count_session_lines").insert(lines);
      }
    }
    router.push(`/items/cycle-count/session/${sessionId}`);
    loadSessions(activeCompanyId);
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Cycle count</h2>
        <p className="text-slate-300">Select an active company in the header to use Cycle count.</p>
        <Link href="/items" className="text-emerald-400 hover:underline text-sm">← Back to Items</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/items" className="text-slate-400 hover:text-emerald-400 text-sm">← Items</Link>
      </div>
      <h2 className="text-xl font-semibold">Cycle count</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <button
          type="button"
          onClick={openNew}
          className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          + Create cycle count list
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSaveList} className="max-w-2xl space-y-4 rounded border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-semibold">{editingListId ? "Edit list" : "New cycle count list"}</h3>
          <div>
            <label className="block text-xs text-slate-500">Name</label>
            <input
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Search items to add to list</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by SKU or name…"
                className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
              />
              {searching && <span className="text-[10px] text-slate-500">Searching…</span>}
            </div>
            {searchResults.length > 0 && (
              <table className="mt-2 w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-400">
                    <th className="py-1 pr-2">SKU</th>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((r) => (
                    <tr key={r.id} className="border-b border-slate-900">
                      <td className="py-1 pr-2 font-mono text-emerald-300">{r.sku}</td>
                      <td className="py-1 pr-2 text-slate-300">{r.name}</td>
                      <td className="py-1 pr-2 text-right">
                        <button
                          type="button"
                          onClick={() => addItem(r)}
                          className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800"
                        >
                          Add to list
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Items on list ({selectedItems.length})</label>
            {selectedItems.length === 0 ? (
              <p className="text-xs text-slate-500">No items yet. Use search above to add.</p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-400">
                    <th className="py-1 pr-2">SKU</th>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedItems.map((row, i) => (
                    <tr key={row.sku} className="border-b border-slate-900">
                      <td className="py-1 pr-2 font-mono text-emerald-300">{row.sku}</td>
                      <td className="py-1 pr-2 text-slate-300">{row.name || "—"}</td>
                      <td className="py-1 pr-2">
                        <button type="button" onClick={() => removeItem(i)} className="text-[11px] text-red-400 hover:underline">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditingListId(null); }} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      )}

      <section>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Cycle count lists</h3>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : lists.length === 0 ? (
          <p className="text-sm text-slate-500">No lists yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Last performed</th>
                  <th className="py-2 pr-3">Items</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {lists.map((list) => (
                  <tr key={list.id} className="border-b border-slate-800">
                    <td className="py-2 pr-3 font-medium text-slate-200">{list.name}</td>
                    <td className="py-2 pr-3 text-slate-400">
                      {list.last_performed_at ? new Date(list.last_performed_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-400">{list.item_count ?? 0}</td>
                    <td className="py-2 pr-3 flex flex-wrap items-center gap-1">
                      <button type="button" onClick={() => startCycleCount(list.id)} className="text-xs text-emerald-400 hover:underline">Start</button>
                      <span className="text-slate-600">|</span>
                      <button type="button" onClick={() => openEdit(list.id)} className="text-xs text-slate-400 hover:text-emerald-400">Edit</button>
                      <button type="button" onClick={() => duplicateList(list.id)} disabled={duplicatingId === list.id} className="text-xs text-slate-400 hover:text-emerald-400 disabled:opacity-50">
                        {duplicatingId === list.id ? "…" : "Duplicate"}
                      </button>
                      <button type="button" onClick={() => deleteList(list.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Cycle count sessions</h3>
        {sessions.length === 0 ? (
          <p className="text-sm text-slate-500">No sessions yet. Start a cycle count from a list above.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-slate-400">
                  <th className="py-2 pr-3">List</th>
                  <th className="py-2 pr-3">Started</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-slate-800">
                    <td className="py-2 pr-3 text-slate-200">{s.list_name}</td>
                    <td className="py-2 pr-3 text-slate-400">{new Date(s.started_at).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-slate-400 capitalize">{s.status}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/items/cycle-count/session/${s.id}`} className="text-xs text-emerald-400 hover:underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
