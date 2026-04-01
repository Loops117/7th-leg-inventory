"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCostFromTransactions, type CostType } from "@/lib/cost";

const ITEMS_COLUMN_KEYS = ["sku", "name", "category", "type", "incoming", "quantity", "price", "cost", "locations", "actions"] as const;
const COLUMN_LABELS: Record<string, string> = {
  sku: "SKU",
  name: "Name",
  category: "Category",
  type: "Type",
  incoming: "Incoming",
  quantity: "Quantity",
  price: "Price",
  cost: "Cost",
  locations: "Locations",
  actions: "Actions",
};
const DEFAULT_COLUMNS: Record<string, boolean> = Object.fromEntries(ITEMS_COLUMN_KEYS.map((k) => [k, true]));
const STORAGE_KEY = "itemsPageColumns";

type Item = {
  id: string;
  sku: string;
  name: string;
  item_type: string;
  sale_price: number | null;
  is_catalog_item: boolean;
  is_active: boolean;
  item_category_id: string | null;
  item_type_id: string | null;
  item_categories?: { name: string } | null;
  item_types?: { name: string; track_inventory?: boolean } | null;
};

type Location = {
  id: string;
  code: string;
  name: string | null;
  warehouse: string | null;
  section: string | null;
  rack: string | null;
  shelf: string | null;
  position: string | null;
};

function locationNamePath(loc: Location): string {
  return [loc.warehouse, loc.section, loc.rack, loc.shelf].filter(Boolean).join(" / ");
}

function locationDisplayLabel(loc: Location): string {
  const path = locationNamePath(loc);
  return loc.name || path || loc.code;
}

function locationHoverTitle(loc: Location): string | undefined {
  const parts: string[] = [];
  if (loc.warehouse) parts.push(`Warehouse: ${loc.warehouse}`);
  if (loc.section) parts.push(`Section: ${loc.section}`);
  if (loc.rack) parts.push(`Rack: ${loc.rack}`);
  if (loc.shelf) parts.push(`Shelf: ${loc.shelf}`);
  if (!parts.length) return undefined;
  return parts.join("\n");
}

type ItemLocation = {
  item_id: string;
  location_id: string;
  is_default: boolean;
};

export default function ItemsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [itemLocations, setItemLocations] = useState<ItemLocation[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [productTypes, setProductTypes] = useState<{ id: string; name: string; track_inventory: boolean }[]>([]);
  const [categoryTypes, setCategoryTypes] = useState<{ category_id: string; type_id: string }[]>([]);
  const [filterCategoryId, setFilterCategoryId] = useState<string>("");
  const [filterTypeId, setFilterTypeId] = useState<string>("");
  const [filterCatalog, setFilterCatalog] = useState<"all" | "catalog" | "stock">("all");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortKey, setSortKey] = useState<"sku" | "name" | "category" | "type" | "incoming" | "quantity" | "price" | "cost">("sku");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [needCompany, setNeedCompany] = useState(false);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_COLUMNS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        return { ...DEFAULT_COLUMNS, ...parsed };
      }
    } catch {}
    return { ...DEFAULT_COLUMNS };
  });
  const [quantityByItem, setQuantityByItem] = useState<Record<string, number>>({});
  const [costByItem, setCostByItem] = useState<Record<string, number | null>>({});
  const [incomingByItem, setIncomingByItem] = useState<Record<string, number>>({});
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const setColumnVisible = useCallback((key: string, visible: boolean) => {
    setColumnVisibility((prev) => {
      const next = { ...prev, [key]: visible };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!showColumnPicker) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-column-picker]") || t.closest("[data-column-picker-trigger]")) return;
      setShowColumnPicker(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [showColumnPicker]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      setNeedCompany(false);

      const active = loadActiveCompany();
      if (!active) {
        setNeedCompany(true);
        setLoading(false);
        return;
      }

      setCompanyName(active.name);
      setActiveCompanyId(active.id);

      const { data: catData } = await supabase.from("item_categories").select("id, name").eq("company_id", active.id).eq("is_active", true).order("name");
      setCategories((catData ?? []) as { id: string; name: string }[]);

      const { data: typeData } = await supabase
        .from("item_types")
        .select("id, name, track_inventory")
        .eq("company_id", active.id)
        .order("name");
      setProductTypes((typeData ?? []) as { id: string; name: string; track_inventory: boolean }[]);
      const { data: ctData } = await supabase
        .from("item_category_types")
        .select("category_id, type_id");
      setCategoryTypes((ctData ?? []) as { category_id: string; type_id: string }[]);

      const { data: itemsData, error } = await supabase
        .from("items")
        .select("id, sku, name, item_type, sale_price, is_catalog_item, is_active, item_category_id, item_type_id, item_categories(name), item_types(name, track_inventory)")
        .eq("company_id", active.id)
        .order("sku");

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setItems((itemsData ?? []) as Item[]);

      const ids = (itemsData ?? []).map((i) => i.id);
      if (ids.length > 0) {
        const { data: ilData } = await supabase.from("item_locations").select("item_id, location_id, is_default").in("item_id", ids);
        setItemLocations(ilData ?? []);
      } else {
        setItemLocations([]);
      }

      const { data: locData } = await supabase
        .from("locations")
        .select("id, code, name, warehouse, section, rack, shelf, position")
        .eq("company_id", active.id);
      setLocations(locData ?? []);

      const qtyMap: Record<string, number> = {};
      const costMap: Record<string, number | null> = {};
      const incomingMap: Record<string, number> = {};
      ids.forEach((id: string) => {
        qtyMap[id] = 0;
        costMap[id] = null;
        incomingMap[id] = 0;
      });

      if (ids.length > 0) {
        const { data: settings } = await supabase
          .from("company_settings")
          .select("cost_type, use_landed_cost")
          .eq("company_id", active.id)
          .single();
        const costType = (settings?.cost_type as CostType) ?? "average";
        const useLanded = Boolean((settings as any)?.use_landed_cost);

        const { data: txs } = await supabase
          .from("inventory_transactions")
          .select("item_id, qty_change, unit_cost, landed_unit_cost")
          .eq("company_id", active.id)
          .in("item_id", ids)
          .in("transaction_type", ["purchase_receipt", "work_order_completion", "inventory_adjustment"]);
        const txList = (txs ?? []) as { item_id: string; qty_change: number; unit_cost: number | null; landed_unit_cost?: number | null }[];
        const byItem = new Map<string, typeof txList>();
        for (const t of txList) {
          if (!byItem.has(t.item_id)) byItem.set(t.item_id, []);
          byItem.get(t.item_id)!.push(t);
        }
        byItem.forEach((arr, itemId) => {
          const totalQty = arr.reduce((s, t) => s + t.qty_change, 0);
          qtyMap[itemId] = totalQty;
          const mapped = arr.map((t) => ({
            unit_cost: useLanded && t.landed_unit_cost != null ? t.landed_unit_cost : t.unit_cost,
            qty_change: t.qty_change,
          }));
          costMap[itemId] = getCostFromTransactions(mapped, costType);
        });

        const { data: orderRows } = await supabase
          .from("receiving_orders")
          .select("id")
          .eq("company_id", active.id)
          .neq("status", "cancelled");
        const orderIds = (orderRows ?? []).map((r: { id: string }) => r.id);
        if (orderIds.length > 0) {
          const { data: lines } = await supabase
            .from("receiving_order_lines")
            .select("item_id, quantity_ordered, quantity_received, pieces_per_pack")
            .in("receiving_order_id", orderIds)
            .in("item_id", ids);
          (lines ?? []).forEach(
            (row: { item_id: string; quantity_ordered?: number; quantity_received?: number; pieces_per_pack?: number }) => {
              const ord = Number(row.quantity_ordered ?? 0);
              const recv = Number(row.quantity_received ?? 0);
              const remPacks = Math.max(0, ord - recv);
              const packSize = Number(row.pieces_per_pack ?? 1) || 1;
              const remPieces = remPacks * packSize;
              incomingMap[row.item_id] = (incomingMap[row.item_id] ?? 0) + remPieces;
            },
          );
        }
      }

      setQuantityByItem(qtyMap);
      setCostByItem(costMap);
      setIncomingByItem(incomingMap);

      setLoading(false);
    }

    load();
  }, []);

  const typesForFilterCategory = useMemo(() => {
    if (!filterCategoryId) return productTypes;
    const allowedTypeIds = new Set(
      categoryTypes
        .filter((ct) => ct.category_id === filterCategoryId)
        .map((ct) => ct.type_id),
    );
    return productTypes.filter((t) => allowedTypeIds.has(t.id));
  }, [filterCategoryId, categoryTypes, productTypes]);

  useEffect(() => {
    if (!filterTypeId) return;
    if (!typesForFilterCategory.some((t) => t.id === filterTypeId)) {
      setFilterTypeId("");
    }
  }, [filterTypeId, typesForFilterCategory]);

  const filteredItems = items.filter((item) => {
    if (filterCategoryId && item.item_category_id !== filterCategoryId) return false;
    if (filterTypeId && item.item_type_id !== filterTypeId) return false;
    if (filterCatalog === "catalog" && !item.is_catalog_item) return false;
    if (filterCatalog === "stock" && item.is_catalog_item) return false;
    if (filterActive === "active" && item.is_active === false) return false;
    if (filterActive === "inactive" && item.is_active !== false) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const cat = item.item_categories?.name ?? "";
      const type = item.item_types?.name ?? item.item_type ?? "";
      const activeState = item.is_active === false ? "inactive" : "active";
      const haystack = `${item.sku} ${item.name} ${cat} ${type} ${activeState}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const getCategory = (it: Item) => it.item_categories?.name ?? "";
    const getType = (it: Item) => it.item_types?.name ?? it.item_type ?? "";
    let av: string | number = "";
    let bv: string | number = "";
    if (sortKey === "sku") {
      av = a.sku || "";
      bv = b.sku || "";
    } else if (sortKey === "name") {
      av = a.name || "";
      bv = b.name || "";
    } else if (sortKey === "category") {
      av = getCategory(a);
      bv = getCategory(b);
    } else if (sortKey === "type") {
      av = getType(a);
      bv = getType(b);
    } else if (sortKey === "incoming") {
      av = incomingByItem[a.id] ?? 0;
      bv = incomingByItem[b.id] ?? 0;
    } else if (sortKey === "quantity") {
      av = quantityByItem[a.id] ?? 0;
      bv = quantityByItem[b.id] ?? 0;
    } else if (sortKey === "price") {
      av = a.sale_price ?? 0;
      bv = b.sale_price ?? 0;
    } else if (sortKey === "cost") {
      av = costByItem[a.id] ?? 0;
      bv = costByItem[b.id] ?? 0;
    }
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  function toggleSort(
    key: "sku" | "name" | "category" | "type" | "incoming" | "quantity" | "price" | "cost",
  ) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (prev.size && filteredItems.every((i) => prev.has(i.id))) {
        return new Set();
      }
      return new Set(filteredItems.map((i) => i.id));
    });
  }

  async function handleExportSelected() {
    if (!activeCompanyId) return;
    const selected = filteredItems.filter(
      (i) => selectedIds.size === 0 || selectedIds.has(i.id)
    );
    if (selected.length === 0) return;

    // Load average cost per item for selected items
    const ids = selected.map((i) => i.id);
    const { data: txs } = await supabase
      .from("inventory_transactions")
      .select("item_id, qty_change, unit_cost")
      .eq("company_id", activeCompanyId)
      .in("transaction_type", ["purchase_receipt", "work_order_completion"] as any)
      .in("item_id", ids);

    const costByItem = new Map<string, number | null>();
    for (const id of ids) costByItem.set(id, null);
    (txs ?? []).forEach((t: any) => {
      const key = t.item_id as string;
      if (!costByItem.has(key)) costByItem.set(key, null);
    });
    for (const id of ids) {
      const perItem =
        (txs ?? []).filter((t: any) => t.item_id === id && t.qty_change > 0 && t.unit_cost != null) ??
        [];
      if (perItem.length === 0) {
        costByItem.set(id, null);
      } else {
        let totalCost = 0;
        let totalQty = 0;
        for (const t of perItem) {
          totalCost += (t.unit_cost ?? 0) * t.qty_change;
          totalQty += t.qty_change;
        }
        costByItem.set(id, totalQty > 0 ? totalCost / totalQty : null);
      }
    }

    const header = ["SKU", "Name", "Category", "ProductType", "SellingPrice", "Cost", "Locations"];
    const rows = [header];

    for (const item of selected) {
      const defaultIl = itemLocations.find(
        (il) => il.item_id === item.id && il.is_default
      );
      const otherIls = itemLocations.filter(
        (il) => il.item_id === item.id && !il.is_default
      );
      const defaultLoc = defaultIl
        ? locations.find((l) => l.id === defaultIl.location_id)
        : null;
      const otherLocs = otherIls
        .map((il) => locations.find((l) => l.id === il.location_id))
        .filter(Boolean) as Location[];
      const allCodes = [
        ...(defaultLoc ? [defaultLoc.code] : []),
        ...otherLocs.map((l) => l.code),
      ].filter(Boolean);
      const locStr = allCodes.join(" | ");

      const cost = costByItem.get(item.id);
      const row = [
        item.sku,
        item.name ?? "",
        item.item_categories?.name ?? "",
        item.item_types?.name ?? item.item_type ?? "",
        item.sale_price != null ? String(item.sale_price) : "",
        cost != null ? cost.toFixed(4) : "",
        locStr,
      ];
      rows.push(row);
    }

    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const c = cell ?? "";
            if (/[",\r\n]/.test(c)) {
              return `"${c.replace(/"/g, '""')}"`;
            }
            return c;
          })
          .join(",")
      )
      .join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "items_export.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleDuplicate(item: Item) {
    if (!activeCompanyId) return;
    setDuplicatingId(item.id);
    const { data: fullItem } = await supabase
      .from("items")
      .select("id, company_id, sku, name, description, item_type, sale_price, is_catalog_item, item_category_id, item_type_id")
      .eq("id", item.id)
      .single();
    if (!fullItem) {
      setDuplicatingId(null);
      return;
    }
    const { data: opts } = await supabase.from("item_buying_options").select("*").eq("item_id", item.id);
    const { data: newItem, error: insertErr } = await supabase
      .from("items")
      .insert({
        company_id: fullItem.company_id,
        sku: `${fullItem.sku}-COPY`,
        name: `${fullItem.name} (Copy)`,
        description: fullItem.description,
        item_type: fullItem.item_type,
        sale_price: fullItem.sale_price,
        is_catalog_item: fullItem.is_catalog_item ?? false,
        item_category_id: fullItem.item_category_id ?? undefined,
        item_type_id: fullItem.item_type_id ?? undefined,
      })
      .select("id")
      .single();
    if (insertErr) {
      setError(insertErr.message);
      setDuplicatingId(null);
      return;
    }
    if (newItem && opts?.length) {
      for (const o of opts as any[]) {
        await supabase.from("item_buying_options").insert({
          item_id: newItem.id,
          vendor_company_name: o.vendor_company_name,
          url: o.url,
          standard_buy_quantity: o.standard_buy_quantity,
          pieces_per_pack: o.pieces_per_pack,
          qty_buying_trigger: o.qty_buying_trigger,
          is_default: o.is_default,
        });
      }
    }
    setDuplicatingId(null);
    setItems((prev) => [...prev, { ...item, id: newItem.id, sku: `${item.sku}-COPY`, name: `${item.name} (Copy)` }]);
    router.push(`/items/${newItem.id}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Items</h2>
        <Link
          href="/items/new"
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
        >
          Create item
        </Link>
      </div>

      {needCompany && (
        <p className="text-slate-300">
          No active company selected. Please go to{" "}
          <a href="/companies" className="text-emerald-400 underline">Companies</a> and set an active company first.
        </p>
      )}

      {companyName && (
        <p className="text-sm text-slate-300">
          Showing items for: <span className="font-semibold text-emerald-300">{companyName}</span>
        </p>
      )}

      {!needCompany && activeCompanyId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
            <label className="block text-xs text-slate-500">Category</label>
            <select
              value={filterCategoryId}
              onChange={(e) => setFilterCategoryId(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            </div>
            <div>
            <label className="block text-xs text-slate-500">Type</label>
            <select
              value={filterTypeId}
              onChange={(e) => setFilterTypeId(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
            >
              <option value="">All types</option>
              {typesForFilterCategory.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.track_inventory === false ? " (non-inventory)" : ""}</option>
              ))}
            </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">Catalog</label>
              <select
                value={filterCatalog}
                onChange={(e) => setFilterCatalog(e.target.value as "all" | "catalog" | "stock")}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
              >
                <option value="all">All</option>
                <option value="catalog">Catalog only</option>
                <option value="stock">Stock only</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">Status</label>
              <select
                value={filterActive}
                onChange={(e) => setFilterActive(e.target.value as "all" | "active" | "inactive")}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
              >
                <option value="all">All</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">Search</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="SKU, name, category, type…"
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 w-52"
              />
            </div>
            <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => { setFilterCategoryId(""); setFilterTypeId(""); setFilterCatalog("all"); setFilterActive("all"); }}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
            >
              Clear filters
            </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" data-column-picker-trigger>
              <button
                type="button"
                onClick={() => setShowColumnPicker((v) => !v)}
                className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Columns
              </button>
              {showColumnPicker && (
                <div data-column-picker className="absolute right-0 top-full z-10 mt-1 min-w-[160px] rounded border border-slate-700 bg-slate-900 py-2 shadow-lg">
                  {ITEMS_COLUMN_KEYS.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      <input
                        type="checkbox"
                        checked={columnVisibility[key] ?? true}
                        onChange={(e) => setColumnVisible(key, e.target.checked)}
                        className="rounded border-slate-600"
                      />
                      <span>{COLUMN_LABELS[key] ?? key}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleExportSelected}
              disabled={filteredItems.length === 0}
              className="rounded border border-emerald-600 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
            >
              Export selected (or all)
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-slate-300">Loading items…</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}

      {!loading && !error && !needCompany && filteredItems.length === 0 && (
        <p className="text-slate-300">
          No items match. Create one with <Link href="/items/new" className="text-emerald-400 underline">Create item</Link>.
        </p>
      )}

      {!loading && !error && filteredItems.length > 0 && (
        <div className="overflow-y-auto max-h-[35rem] rounded border border-slate-800">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-900">
              <tr className="border-b border-slate-800 text-left text-slate-400">
                <th className="py-2 pr-3">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={
                      selectedIds.size > 0 &&
                      filteredItems.every((i) => selectedIds.has(i.id))
                    }
                    onChange={toggleSelectAll}
                  />
                </th>
                {columnVisibility.sku && (
                  <th className="py-2 pr-3">
                    <button type="button" onClick={() => toggleSort("sku")} className="inline-flex items-center gap-1 text-xs">
                      <span>SKU</span>
                      {sortKey === "sku" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                )}
                {columnVisibility.name && (
                  <th className="py-2 pr-3">
                    <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 text-xs">
                      <span>Name</span>
                      {sortKey === "name" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                )}
                {columnVisibility.category && (
                  <th className="py-2 pr-3">
                    <button type="button" onClick={() => toggleSort("category")} className="inline-flex items-center gap-1 text-xs">
                      <span>Category</span>
                      {sortKey === "category" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                )}
                {columnVisibility.type && (
                  <th className="py-2 pr-3">
                    <button type="button" onClick={() => toggleSort("type")} className="inline-flex items-center gap-1 text-xs">
                      <span>Type</span>
                      {sortKey === "type" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                )}
                {columnVisibility.incoming && (
                  <th className="py-2 pr-3">
                    <button type="button" onClick={() => toggleSort("incoming")} className="inline-flex items-center gap-1 text-xs">
                      <span>Incoming</span>
                      {sortKey === "incoming" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                )}
                {columnVisibility.quantity && (
                  <th className="py-2 pr-3">
                    <button type="button" onClick={() => toggleSort("quantity")} className="inline-flex items-center gap-1 text-xs">
                      <span>Quantity</span>
                      {sortKey === "quantity" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                )}
                {columnVisibility.price && (
                  <th className="py-2 pr-3">
                    <button type="button" onClick={() => toggleSort("price")} className="inline-flex items-center gap-1 text-xs">
                      <span>Price</span>
                      {sortKey === "price" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                )}
                {columnVisibility.cost && (
                  <th className="py-2 pr-3">
                    <button type="button" onClick={() => toggleSort("cost")} className="inline-flex items-center gap-1 text-xs">
                      <span>Cost</span>
                      {sortKey === "cost" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                )}
                {columnVisibility.locations && <th className="py-2 pr-3">Locations</th>}
                {columnVisibility.actions && <th></th>}
              </tr>
            </thead>
          <tbody>
            {sortedItems.map((item) => {
              const tracksInventory = item.item_types?.track_inventory !== false;
              const defaultIl = itemLocations.find((il) => il.item_id === item.id && il.is_default);
              const otherIls = itemLocations.filter((il) => il.item_id === item.id && !il.is_default);
              const defaultLoc = defaultIl ? locations.find((l) => l.id === defaultIl.location_id) : null;
              const otherLocs = otherIls.map((il) => locations.find((l) => l.id === il.location_id)).filter(Boolean) as Location[];
              const locationLabel = defaultLoc
                ? otherLocs.length > 0
                  ? `${locationDisplayLabel(defaultLoc)} (default), ${otherLocs
                      .map((l) => locationDisplayLabel(l))
                      .join(", ")}`
                  : locationDisplayLabel(defaultLoc)
                : otherLocs.length > 0
                ? otherLocs.map((l) => locationDisplayLabel(l)).join(", ")
                : "—";
              const isSelected = selectedIds.has(item.id);
              return (
                <tr key={item.id} className="border-b border-slate-900 hover:bg-slate-900/60">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      className="h-3 w-3"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                    />
                  </td>
                  {columnVisibility.sku && (
                    <td className="py-2 pr-3 font-mono text-xs text-slate-200">
                      <Link href={`/items/${item.id}`} className="text-emerald-400 hover:underline">{item.sku}</Link>
                    </td>
                  )}
                  {columnVisibility.name && (
                    <td className="py-2 pr-3">
                      <Link href={`/items/${item.id}`} className="text-slate-200 hover:text-emerald-300">{item.name}</Link>
                      {item.is_catalog_item && <span className="ml-2 rounded bg-sky-900/50 px-1.5 py-0.5 text-[10px] text-sky-200">Catalog</span>}
                    </td>
                  )}
                  {columnVisibility.category && (
                    <td className="py-2 pr-3 text-slate-400">{item.item_categories?.name ?? "—"}</td>
                  )}
                  {columnVisibility.type && (
                    <td className="py-2 pr-3 text-slate-400">{item.item_types?.name ?? item.item_type ?? "—"}</td>
                  )}
                  {columnVisibility.incoming && (
                    <td className="py-2 pr-3 text-slate-400 tabular-nums">{tracksInventory ? (incomingByItem[item.id] ?? 0) : "—"}</td>
                  )}
                  {columnVisibility.quantity && (
                    <td className="py-2 pr-3 text-slate-300 tabular-nums">{tracksInventory ? (quantityByItem[item.id] ?? 0) : "—"}</td>
                  )}
                  {columnVisibility.price && (
                    <td className="py-2 pr-3 text-slate-400">
                      {item.sale_price != null ? `$${Number(item.sale_price).toFixed(2)}` : "—"}
                    </td>
                  )}
                  {columnVisibility.cost && (
                    <td className="py-2 pr-3 text-slate-400">
                      {tracksInventory && costByItem[item.id] != null ? `$${Number(costByItem[item.id]).toFixed(2)}` : "—"}
                    </td>
                  )}
                  {columnVisibility.locations && (
                    <td
                      className="py-2 pr-3 text-slate-400 text-xs"
                      title={
                        defaultLoc
                          ? locationHoverTitle(defaultLoc) ??
                            (otherLocs[0] ? locationHoverTitle(otherLocs[0]) : undefined)
                          : otherLocs[0]
                          ? locationHoverTitle(otherLocs[0])
                          : undefined
                      }
                    >
                      {locationLabel}
                    </td>
                  )}
                  {columnVisibility.actions && (
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => handleDuplicate(item)}
                        disabled={duplicatingId === item.id}
                        className="text-xs text-slate-400 hover:text-emerald-400 disabled:opacity-50"
                      >
                        {duplicatingId === item.id ? "…" : "Duplicate"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
