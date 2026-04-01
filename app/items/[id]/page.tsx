"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCostFromTransactions, type CostType } from "@/lib/cost";
import {
  getCurrentUserPermissions,
  hasPermission,
} from "@/lib/permissions";

type Item = {
  id: string;
  company_id: string;
  sku: string;
  name: string;
  description: string | null;
  item_type: string;
  sale_price: number | null;
  manual_unit_cost: number | null;
  is_catalog_item: boolean;
  item_category_id?: string | null;
  item_type_id?: string | null;
  item_categories?: { name: string } | null;
  item_types?: { name: string; track_inventory?: boolean } | null;
};

type ItemCategory = { id: string; name: string };
type ProductType = { id: string; name: string; track_inventory: boolean };
type CategoryType = { category_id: string; type_id: string };

type BuyingOption = {
  id: string;
  item_id: string;
  vendor_company_name: string;
  url: string | null;
  standard_buy_quantity: number;
  pieces_per_pack: number;
  qty_buying_trigger: number | null;
  is_default: boolean;
};

type InvTx = {
  id: string;
  qty_change: number;
  unit_cost: number | null;
  created_at: string;
  transaction_type: string;
  landed_unit_cost?: number | null;
  reference_table?: string | null;
  reference_id?: string | null;
};

type BomRow = {
  id: string;
  parent_item_id: string;
  revision: string;
  parent_name?: string;
  parent_sku?: string;
};

type ProcedureRow = {
  id: string;
  name: string;
  version: string;
};

type AssemblyComponentRow = {
  procedure_id: string;
  procedure_name: string;
  procedure_code: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  quantity_required: number;
  unit_cost: number | null;
  line_total_cost: number | null;
};

type WorkOrderRow = {
  id: string;
  work_order_number: string;
  status: string;
  quantity: number;
};

type ItemLocationRow = {
  id: string;
  item_id: string;
  location_id: string;
  is_default: boolean;
};

type LocationRow = {
  id: string;
  code: string;
  name: string | null;
  warehouse: string | null;
  section: string | null;
  rack: string | null;
  shelf: string | null;
  position: string | null;
  shelf_id?: string | null;
  shelves?: {
    code: string;
    name?: string | null;
    racks?: {
      code: string;
      name?: string | null;
      sections?: {
        code: string;
        name?: string | null;
        warehouse?: { code: string; name?: string | null };
        warehouses?: { code: string; name?: string | null };
      };
    };
  } | null;
  company_id?: string;
  is_active?: boolean;
};

function locationPath(loc: LocationRow): string {
  const sec = loc.shelves?.racks?.sections as
    | {
        code?: string;
        warehouse?: { code: string; name?: string | null };
        warehouses?: { code: string; name?: string | null };
      }
    | undefined;
  const wh = sec?.warehouses ?? sec?.warehouse;
  if (wh && typeof wh === "object" && "code" in wh) {
    const parts = [
      (wh as { code: string }).code,
      sec?.code,
      loc.shelves?.racks?.code,
      loc.shelves?.code,
    ].filter(Boolean);
    return parts.join(" / ") + (loc.position ? ` / ${loc.position}` : "");
  }
  return [loc.warehouse, loc.section, loc.rack, loc.shelf, loc.position].filter(Boolean).join(" / ");
}

function locationSearchText(loc: LocationRow): string {
  const path = locationPath(loc);
  const shelfName = loc.shelves?.name ?? null;
  const rackName = loc.shelves?.racks?.name ?? null;
  const sec = loc.shelves?.racks?.sections as
    | {
        name?: string | null;
        warehouse?: { name?: string | null };
        warehouses?: { name?: string | null };
      }
    | undefined;
  const sectionName = sec?.name ?? null;
  const warehouseName = (sec?.warehouses ?? sec?.warehouse)?.name ?? null;
  return [loc.code, loc.name, path, warehouseName, sectionName, rackName, shelfName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function locationNamePath(loc: LocationRow): string {
  const sec = loc.shelves?.racks?.sections as
    | {
        name?: string | null;
        warehouse?: { name?: string | null };
        warehouses?: { name?: string | null };
      }
    | undefined;
  const whName = (sec?.warehouses ?? sec?.warehouse)?.name ?? null;
  const secName = sec?.name ?? null;
  const rackName = loc.shelves?.racks?.name ?? null;
  const shelfName = loc.shelves?.name ?? null;
  return [whName, secName, rackName, shelfName].filter(Boolean).join(" / ");
}

function locationDisplayLabel(loc: LocationRow): string {
  const namePath = locationNamePath(loc);
  return loc.name || namePath || loc.shelves?.name || loc.code;
}

function locationHoverTitle(loc: LocationRow): string | undefined {
  const sec = loc.shelves?.racks?.sections as
    | {
        name?: string | null;
        warehouse?: { name?: string | null };
        warehouses?: { name?: string | null };
      }
    | undefined;
  const wh = (sec?.warehouses ?? sec?.warehouse) as { name?: string | null } | undefined;
  const whName = wh?.name ?? null;
  const secName = sec?.name ?? null;
  const rackName = loc.shelves?.racks?.name ?? null;
  const shelfName = loc.shelves?.name ?? null;

  const parts: string[] = [];
  if (whName) parts.push(`Warehouse: ${whName}`);
  if (secName) parts.push(`Section: ${secName}`);
  if (rackName) parts.push(`Rack: ${rackName}`);
  if (shelfName) parts.push(`Shelf: ${shelfName}`);

  if (!parts.length) return undefined;
  return parts.join("\n");
}

type BalanceRow = {
  item_id: string;
  location_id: string;
  on_hand_qty: number;
};

export default function ItemDetailPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = params.id as string;

  const [item, setItem] = useState<Item | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [buyingOptions, setBuyingOptions] = useState<BuyingOption[]>([]);
  const [costType, setCostType] = useState<CostType>("average");
  const [purchaseTxs, setPurchaseTxs] = useState<InvTx[]>([]);
  const [bomsAsParent, setBomsAsParent] = useState<BomRow[]>([]);
  const [usedInBoms, setUsedInBoms] = useState<{ parent_id: string; parent_sku: string; parent_name: string }[]>([]);
  const [procedures, setProcedures] = useState<ProcedureRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [assemblyComponents, setAssemblyComponents] = useState<AssemblyComponentRow[]>([]);
  const [assemblyProcedureOrder, setAssemblyProcedureOrder] = useState<string[]>(
    [],
  );
  const [itemLocations, setItemLocations] = useState<ItemLocationRow[]>([]);
  const [companyLocations, setCompanyLocations] = useState<LocationRow[]>([]);
  const [inventoryByLocation, setInventoryByLocation] = useState<BalanceRow[]>([]);
  const [addLocationId, setAddLocationId] = useState<string>("");
  const [locationSearch, setLocationSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState<string>("");
  const [descriptionEdit, setDescriptionEdit] = useState<string>("");
  const [savingItemMeta, setSavingItemMeta] = useState(false);
  const [salePriceEdit, setSalePriceEdit] = useState<string>("");
  const [savingSalePrice, setSavingSalePrice] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [useLandedCost, setUseLandedCost] = useState(false);
  const [canAdjustCost, setCanAdjustCost] = useState(false);
  const [manualCostEdit, setManualCostEdit] = useState("");
  const [savingManualCost, setSavingManualCost] = useState(false);
  const [showManualCostModal, setShowManualCostModal] = useState(false);
  const [savingCatalogFlag, setSavingCatalogFlag] = useState(false);
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [categoryTypes, setCategoryTypes] = useState<CategoryType[]>([]);
  const [editingCategoryType, setEditingCategoryType] = useState(false);
  const [categoryIdEdit, setCategoryIdEdit] = useState("");
  const [typeIdEdit, setTypeIdEdit] = useState("");
  const [savingCategoryType, setSavingCategoryType] = useState(false);

  // Adjust inventory (per location)
  const [adjustingLocationId, setAdjustingLocationId] = useState<string | null>(null);
  const [adjustCurrentQty, setAdjustCurrentQty] = useState(0);
  const [adjustNewQty, setAdjustNewQty] = useState("");
  const [adjustResetCost, setAdjustResetCost] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [incomingQty, setIncomingQty] = useState(0);
  const [avgSecondsPerPiece, setAvgSecondsPerPiece] = useState<number | null>(null);
  const [savingAdjust, setSavingAdjust] = useState(false);

  // Buying option form (add/edit)
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [showAddOptionForm, setShowAddOptionForm] = useState(false);
  const [formVendor, setFormVendor] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formStdQty, setFormStdQty] = useState("1");
  const [formPiecesPerPack, setFormPiecesPerPack] = useState("1");
  const [formTrigger, setFormTrigger] = useState("");
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [savingOption, setSavingOption] = useState(false);

  async function handleSaveItemMeta(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    setSavingItemMeta(true);
    setError(null);
    const name = nameEdit.trim() || item.sku;
    const description = descriptionEdit.trim() || null;
    const { error: updErr } = await supabase
      .from("items")
      .update({ name, description })
      .eq("id", item.id);
    if (updErr) {
      setError(updErr.message);
      setSavingItemMeta(false);
      return;
    }
    setItem((prev) => (prev ? { ...prev, name, description } : prev));
    setSavingItemMeta(false);
  }

  async function handleDeleteItem() {
    if (!item || deleting) return;
    if (
      !confirm(
        "Delete this item? This cannot be undone and may fail if the item is used in BOMs, work orders, or transactions.",
      )
    )
      return;
    setDeleting(true);
    setError(null);
    try {
      // Block delete if item has inventory history or receiving history
      const [{ data: invTxs }, { data: recvLines }] = await Promise.all([
        supabase
          .from("inventory_transactions")
          .select("id")
          .eq("item_id", item.id)
          .limit(1),
        supabase
          .from("receiving_order_lines")
          .select("id")
          .eq("item_id", item.id)
          .limit(1),
      ]);

      if (invTxs && invTxs.length > 0) {
        setError(
          "Cannot delete this item because it has inventory transactions. Remove or adjust those records first.",
        );
        setDeleting(false);
        return;
      }

      if (recvLines && recvLines.length > 0) {
        setError(
          "Cannot delete this item because it appears on receiving/incoming lines. Remove those lines first.",
        );
        setDeleting(false);
        return;
      }

      // Safe to clean up dependent config data before deleting the item
      await supabase.from("item_locations").delete().eq("item_id", item.id);
      await supabase.from("item_buying_options").delete().eq("item_id", item.id);

      // Remove from BOMs (as component or parent)
      await supabase
        .from("bom_components")
        .delete()
        .eq("component_item_id", item.id);
      await supabase.from("boms").delete().eq("parent_item_id", item.id);

      // Find procedures that are scoped to this item or output this item
      const { data: procRows, error: procErr } = await supabase
        .from("procedures")
        .select("id")
        .or(`item_id.eq.${item.id},output_item_id.eq.${item.id}`);
      if (procErr) {
        setError(procErr.message);
        setDeleting(false);
        return;
      }
      const procIds = (procRows ?? []).map((p: any) => p.id as string);
      if (procIds.length > 0) {
        // Detach from work orders first (FK is RESTRICT)
        const { error: wopErr } = await supabase
          .from("work_order_procedures")
          .delete()
          .in("procedure_id", procIds);
        if (wopErr) {
          setError(
            "Cannot delete this item because its procedures are used in work orders. Remove or edit those work orders first.",
          );
          setDeleting(false);
          return;
        }
        const { error: delProcsErr } = await supabase
          .from("procedures")
          .delete()
          .in("id", procIds);
        if (delProcsErr) {
          setError(delProcsErr.message);
          setDeleting(false);
          return;
        }
      }

      // Remove work orders tied directly to this item
      await supabase.from("work_orders").delete().eq("item_id", item.id);

      const { error: delErr } = await supabase
        .from("items")
        .delete()
        .eq("id", item.id);
      if (delErr) {
        setError(delErr.message);
        setDeleting(false);
        return;
      }
      router.push("/items");
    } catch (e: any) {
      setError(
        typeof e?.message === "string"
          ? e.message
          : "Failed to delete item due to an unexpected error.",
      );
      setDeleting(false);
    }
  }

  const load = useCallback(async () => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setCompanyName(active.name);

    const { data: itemData, error: itemErr } = await supabase
      .from("items")
      .select(
        "id, company_id, sku, name, description, item_type, sale_price, manual_unit_cost, is_catalog_item, item_category_id, item_type_id, item_categories(name), item_types(name, track_inventory)",
      )
      .eq("id", itemId)
      .single();

    if (itemErr || !itemData) {
      setError(itemErr?.message ?? "Item not found");
      setLoading(false);
      return;
    }
    setItem(itemData as Item);
    setNameEdit(itemData.name ?? "");
    setDescriptionEdit(itemData.description ?? "");
    setSalePriceEdit(
      itemData.sale_price != null ? String(itemData.sale_price) : ""
    );
    setCategoryIdEdit(itemData.item_category_id ?? "");
    setTypeIdEdit(itemData.item_type_id ?? "");
    setEditingCategoryType(false);

    const [catRes, typeRes, ctRes] = await Promise.all([
      supabase
        .from("item_categories")
        .select("id, name")
        .eq("company_id", itemData.company_id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("item_types")
        .select("id, name, track_inventory")
        .eq("company_id", itemData.company_id)
        .order("name"),
      supabase.from("item_category_types").select("category_id, type_id"),
    ]);
    setCategories((catRes.data ?? []) as ItemCategory[]);
    setProductTypes((typeRes.data ?? []) as ProductType[]);
    setCategoryTypes((ctRes.data ?? []) as CategoryType[]);

    const { data: opts } = await supabase
      .from("item_buying_options")
      .select("*")
      .eq("item_id", itemId)
      .order("is_default", { ascending: false });
    setBuyingOptions((opts ?? []) as BuyingOption[]);

    const { data: settings } = await supabase
      .from("company_settings")
      .select("cost_type, use_landed_cost")
      .eq("company_id", itemData.company_id)
      .single();
    if (settings?.cost_type) setCostType(settings.cost_type as CostType);
    setUseLandedCost(Boolean((settings as any)?.use_landed_cost));

    const { data: txs } = await supabase
      .from("inventory_transactions")
      .select("id, qty_change, unit_cost, landed_unit_cost, created_at, transaction_type, reference_table, reference_id")
      .eq("item_id", itemId)
      .in("transaction_type", ["purchase_receipt", "work_order_completion", "inventory_adjustment"])
      .order("created_at", { ascending: true });
    setPurchaseTxs((txs ?? []) as InvTx[]);

    // Incoming from receiving (open orders) for this item
    const { data: recvLines } = await supabase
      .from("receiving_order_lines")
      .select(
        `
        quantity_ordered,
        quantity_received,
        pieces_per_pack,
        receiving_orders!inner(status, company_id)
      `,
      )
      .eq("item_id", itemId)
      .eq("receiving_orders.company_id", itemData.company_id)
      .neq("receiving_orders.status", "cancelled");
    const incomingTotal =
      (recvLines as any[] | null)?.reduce((sum, row) => {
        const qOrdered = Number(row.quantity_ordered ?? 0);
        const qReceived = Number(row.quantity_received ?? 0);
        const remPacks = qOrdered - qReceived;
        const packSize = Number(row.pieces_per_pack ?? 1) || 1;
        const remPieces = remPacks > 0 ? remPacks * packSize : 0;
        return sum + remPieces;
      }, 0) ?? 0;
    setIncomingQty(incomingTotal);

    const { data: bomsParent } = await supabase
      .from("boms")
      .select("id, parent_item_id, revision")
      .eq("parent_item_id", itemId)
      .eq("is_active", true);
    if (bomsParent?.length) {
      const parentIds = bomsParent.map((b) => b.parent_item_id);
      const { data: parentItems } = await supabase
        .from("items")
        .select("id, sku, name")
        .in("id", parentIds);
      const map = new Map((parentItems ?? []).map((p: any) => [p.id, p]));
      setBomsAsParent(
        (bomsParent as BomRow[]).map((b) => ({
          ...b,
          parent_sku: map.get(b.parent_item_id)?.sku,
          parent_name: map.get(b.parent_item_id)?.name,
        }))
      );
    } else {
      setBomsAsParent([]);
    }

    const { data: compRows } = await supabase
      .from("bom_components")
      .select("bom_id")
      .eq("component_item_id", itemId);
    if (compRows?.length) {
      const bomIds = compRows.map((c) => c.bom_id);
      const { data: boms } = await supabase
        .from("boms")
        .select("id, parent_item_id")
        .in("id", bomIds);
      const parentIds = [...new Set((boms ?? []).map((b: any) => b.parent_item_id))];
      if (parentIds.length) {
        const { data: parents } = await supabase
          .from("items")
          .select("id, sku, name")
          .in("id", parentIds);
        setUsedInBoms(
          (parents ?? []).map((p: any) => ({
            parent_id: p.id,
            parent_sku: p.sku,
            parent_name: p.name,
          }))
        );
      } else setUsedInBoms([]);
    } else setUsedInBoms([]);

    const { data: procs } = await supabase
      .from("procedures")
      .select("id, name, version, procedure_code, item_id, output_item_id")
      .eq("is_active", true)
      .eq("company_id", itemData.company_id)
      .or(`item_id.eq.${itemId},output_item_id.eq.${itemId}`);
    const procRows = (procs ?? []) as any[];
    setProcedures(
      procRows.map((p) => ({
        id: p.id as string,
        name: p.name as string,
        version: String(p.version ?? ""),
      })),
    );

    // Assembly components: inputs from procedures that build this item (output_item_id = this item)
    const builderProcs = procRows.filter((p) => p.output_item_id === itemId);
    if (builderProcs.length > 0) {
      const procIds = builderProcs.map((p) => p.id as string);
      setAssemblyProcedureOrder(procIds);
      const procMeta = new Map<
        string,
        { name: string; procedure_code: string }
      >();
      builderProcs.forEach((p) => {
        procMeta.set(p.id as string, {
          name: (p.name as string) ?? "",
          procedure_code: (p.procedure_code as string) ?? "",
        });
      });

      const { data: inputs } = await supabase
        .from("procedure_items")
        .select(
          "procedure_id, quantity_required, items ( id, sku, name )",
        )
        .in("procedure_id", procIds);
      const baseRows: AssemblyComponentRow[] =
        (inputs ?? []).map((row: any) => {
          const meta = procMeta.get(row.procedure_id as string);
          const compItemId = row.items?.id as string | undefined;
          return {
            procedure_id: row.procedure_id as string,
            procedure_name: meta?.name ?? "",
            procedure_code: meta?.procedure_code ?? "",
            item_id: compItemId ?? "",
            item_sku: row.items?.sku ?? "",
            item_name: row.items?.name ?? "",
            quantity_required:
              row.quantity_required != null
                ? Number(row.quantity_required)
                : 0,
            unit_cost: null,
            line_total_cost: null,
          };
        }) ?? [];

      const compItemIds = [
        ...new Set(
          baseRows.map((r) => r.item_id).filter((id) => Boolean(id)),
        ),
      ];
      const ctLocal = (settings?.cost_type as CostType) ?? "average";
      const useLandedLocal = Boolean((settings as any)?.use_landed_cost);

      let compRows = baseRows;
      if (compItemIds.length > 0) {
        const { data: compTxs } = await supabase
          .from("inventory_transactions")
          .select("item_id, qty_change, unit_cost, landed_unit_cost")
          .in("item_id", compItemIds)
          .in("transaction_type", [
            "purchase_receipt",
            "work_order_completion",
            "inventory_adjustment",
          ])
          .order("created_at", { ascending: true });

        const byItem = new Map<
          string,
          { unit_cost: number | null; qty_change: number }[]
        >();
        for (const t of compTxs ?? []) {
          const id = t.item_id as string;
          if (!byItem.has(id)) byItem.set(id, []);
          byItem.get(id)!.push({
            qty_change: Number((t as any).qty_change ?? 0),
            unit_cost:
              useLandedLocal &&
              (t as any).landed_unit_cost != null
                ? Number((t as any).landed_unit_cost)
                : (t as any).unit_cost != null
                  ? Number((t as any).unit_cost)
                  : null,
          });
        }

        compRows = baseRows.map((row) => {
          if (!row.item_id) {
            return { ...row, unit_cost: null, line_total_cost: null };
          }
          const txsForItem = byItem.get(row.item_id) ?? [];
          const unitCost = getCostFromTransactions(txsForItem, ctLocal);
          const lineTotal =
            unitCost != null ? unitCost * row.quantity_required : null;
          return {
            ...row,
            unit_cost: unitCost,
            line_total_cost: lineTotal,
          };
        });
      }

      if (compItemIds.length > 0) {
        const { data: manualRows } = await supabase
          .from("items")
          .select("id, manual_unit_cost")
          .in("id", compItemIds);
        const manualByItem = new Map(
          (manualRows ?? []).map((r: any) => [
            r.id as string,
            r.manual_unit_cost != null ? Number(r.manual_unit_cost) : null,
          ]),
        );
        compRows = compRows.map((row) => {
          const m = manualByItem.get(row.item_id);
          if (m == null || row.item_id === "") return row;
          return {
            ...row,
            unit_cost: m,
            line_total_cost: m * row.quantity_required,
          };
        });
      }

      setAssemblyComponents(compRows);
    } else {
      setAssemblyProcedureOrder([]);
      setAssemblyComponents([]);
    }

    const { data: wos } = await supabase
      .from("work_orders")
      .select("id, work_order_number, status, quantity")
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(20);
    const woRows = (wos ?? []) as WorkOrderRow[];
    setWorkOrders(woRows);

    const { data: ilData } = await supabase
      .from("item_locations")
      .select("id, item_id, location_id, is_default")
      .eq("item_id", itemId);
    setItemLocations((ilData ?? []) as ItemLocationRow[]);

    const locSelect =
      "id, code, name, warehouse, section, rack, shelf, position, shelf_id, shelves(code, name, racks(code, name, sections(code, name, warehouses(code, name))))";
    let locList: LocationRow[] = [];
    const { data: locData, error: locErr } = await supabase
      .from("locations")
      .select(locSelect)
      .eq("company_id", itemData.company_id);
    if (!locErr && locData?.length) {
      locList = locData as LocationRow[];
    } else {
      if (locErr) console.error("Locations by company_id:", locErr);
      const { data: whData } = await supabase.from("warehouses").select("id").eq("company_id", itemData.company_id);
      const whIds = (whData ?? []).map((w: { id: string }) => w.id);
      if (whIds.length) {
        const { data: secData } = await supabase.from("sections").select("id").in("warehouse_id", whIds);
        const secIds = (secData ?? []).map((s: { id: string }) => s.id);
        if (secIds.length) {
          const { data: rData } = await supabase.from("racks").select("id").in("section_id", secIds);
          const rackIds = (rData ?? []).map((r: { id: string }) => r.id);
          if (rackIds.length) {
            const { data: shData } = await supabase.from("shelves").select("id").in("rack_id", rackIds);
            const shelfIds = (shData ?? []).map((s: { id: string }) => s.id);
            if (shelfIds.length) {
              const { data: locByShelf } = await supabase.from("locations").select(locSelect).in("shelf_id", shelfIds);
              locList = (locByShelf ?? []) as LocationRow[];
            }
          }
        }
      }
    }
    setCompanyLocations(locList);

    const { data: balData } = await supabase
      .from("inventory_balances")
      .select("item_id, location_id, on_hand_qty")
      .eq("item_id", itemId);
    setInventoryByLocation((balData ?? []) as BalanceRow[]);

    // Average time per piece from last 3 completed work-order assignments for this item
    const woIds = woRows.map((w) => w.id);
    if (woIds.length > 0) {
      const { data: assigns } = await supabase
        .from("work_order_assignments")
        .select("id, work_order_id, quantity_to_build, last_completed_at")
        .in("work_order_id", woIds)
        .not("last_completed_at", "is", null)
        .order("last_completed_at", { ascending: false })
        .limit(3);
      const assignmentRows =
        (assigns as { id: string; work_order_id: string; quantity_to_build: number | null; last_completed_at: string | null }[] | null) ??
        [];
      if (assignmentRows.length > 0) {
        const assignIds = assignmentRows.map((a) => a.id);
        const { data: evData } = await supabase
          .from("work_order_events")
          .select("assignment_id, event_type, occurred_at")
          .in("assignment_id", assignIds)
          .order("occurred_at", { ascending: true });
        const events =
          (evData as { assignment_id: string; event_type: string; occurred_at: string }[] | null) ?? [];

        let totalSeconds = 0;
        let totalPieces = 0;

        for (const a of assignmentRows) {
          const qty = Number(a.quantity_to_build ?? 0);
          if (!qty || qty <= 0) continue;
          const evs = events.filter((e) => e.assignment_id === a.id);
          if (!evs.length) continue;
          let currentStart: Date | null = null;
          for (const e of evs) {
            const ts = new Date(e.occurred_at);
            if (e.event_type === "start" || e.event_type === "resume") {
              currentStart = ts;
            } else if ((e.event_type === "pause" || e.event_type === "complete") && currentStart) {
              totalSeconds += (ts.getTime() - currentStart.getTime()) / 1000;
              currentStart = null;
            }
          }
          totalPieces += qty;
        }

        if (totalPieces > 0 && totalSeconds > 0) {
          setAvgSecondsPerPiece(totalSeconds / totalPieces);
        } else {
          setAvgSecondsPerPiece(null);
        }
      } else {
        setAvgSecondsPerPiece(null);
      }
    } else {
      setAvgSecondsPerPiece(null);
    }

    setLoading(false);
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!item?.company_id) {
      setCanAdjustCost(false);
      return;
    }
    getCurrentUserPermissions(item.company_id).then(
      ({ isSuperAdmin, permissionCodes }) => {
        setCanAdjustCost(
          isSuperAdmin || hasPermission(permissionCodes, "manage_locations"),
        );
      },
    );
  }, [item?.company_id]);

  useEffect(() => {
    if (item?.manual_unit_cost != null && !Number.isNaN(Number(item.manual_unit_cost))) {
      setManualCostEdit(String(item.manual_unit_cost));
    } else {
      setManualCostEdit("");
    }
  }, [item?.id, item?.manual_unit_cost]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("itemViewCollapsed");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        setCollapsedSections(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem("itemViewCollapsed", JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  const assemblyRowsByProcedure = useMemo(() => {
    const m = new Map<string, AssemblyComponentRow[]>();
    for (const row of assemblyComponents) {
      const arr = m.get(row.procedure_id) ?? [];
      arr.push(row);
      m.set(row.procedure_id, arr);
    }
    return m;
  }, [assemblyComponents]);

  const baseCost = getCostFromTransactions(
    purchaseTxs.map((t) => ({ unit_cost: t.unit_cost, qty_change: t.qty_change })),
    costType
  );
  const landedCost = getCostFromTransactions(
    purchaseTxs.map((t) => ({
      unit_cost: t.landed_unit_cost != null ? t.landed_unit_cost : t.unit_cost,
      qty_change: t.qty_change,
    })),
    costType
  );
  const calculatedCost = useLandedCost ? landedCost ?? baseCost : baseCost;
  const effectiveCost =
    item?.manual_unit_cost != null && !Number.isNaN(Number(item.manual_unit_cost))
      ? Number(item.manual_unit_cost)
      : calculatedCost;
  const hasManualCostOverride =
    item?.manual_unit_cost != null &&
    !Number.isNaN(Number(item.manual_unit_cost));

  async function handleSaveManualCost(e: FormEvent) {
    e.preventDefault();
    if (!item || !canAdjustCost) return;
    setSavingManualCost(true);
    setError(null);
    const raw = manualCostEdit.trim();
    let manual_unit_cost: number | null = null;
    if (raw !== "") {
      const v = parseFloat(raw);
      if (Number.isNaN(v) || v < 0) {
        setError("Enter a valid cost (0 or greater), or clear the field.");
        setSavingManualCost(false);
        return;
      }
      manual_unit_cost = v;
    }
    const { error: updErr } = await supabase
      .from("items")
      .update({ manual_unit_cost })
      .eq("id", item.id);
    if (updErr) {
      setError(updErr.message);
      setSavingManualCost(false);
      return;
    }
    setSavingManualCost(false);
    setShowManualCostModal(false);
    load();
  }

  async function handleClearManualCost() {
    if (!item || !canAdjustCost) return;
    if (!hasManualCostOverride) return;
    if (!confirm("Remove the cost override and use transaction-based cost again?")) return;
    setSavingManualCost(true);
    setError(null);
    const { error: updErr } = await supabase
      .from("items")
      .update({ manual_unit_cost: null })
      .eq("id", item.id);
    if (updErr) {
      setError(updErr.message);
      setSavingManualCost(false);
      return;
    }
    setSavingManualCost(false);
    setShowManualCostModal(false);
    load();
  }

  async function handleSaveSalePrice(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    const v = parseFloat(salePriceEdit);
    if (isNaN(v) || v < 0) return;
    setSavingSalePrice(true);
    const { error } = await supabase
      .from("items")
      .update({ sale_price: v })
      .eq("id", item.id);
    if (error) setError(error.message);
    else setItem((prev) => (prev ? { ...prev, sale_price: v } : null));
    setSavingSalePrice(false);
  }

  async function handleToggleCatalogItem(next: boolean) {
    if (!item) return;
    setSavingCatalogFlag(true);
    setError(null);
    const { error: updErr } = await supabase
      .from("items")
      .update({ is_catalog_item: next })
      .eq("id", item.id);
    if (updErr) setError(updErr.message);
    else setItem((prev) => (prev ? { ...prev, is_catalog_item: next } : prev));
    setSavingCatalogFlag(false);
  }

  async function handleSaveCategoryType() {
    if (!item) return;
    if (!categoryIdEdit || !typeIdEdit) {
      setError("Select both category and type.");
      return;
    }
    setSavingCategoryType(true);
    setError(null);
    const { error: updErr } = await supabase
      .from("items")
      .update({ item_category_id: categoryIdEdit, item_type_id: typeIdEdit })
      .eq("id", item.id);
    if (updErr) {
      setError(updErr.message);
      setSavingCategoryType(false);
      return;
    }
    setItem((prev) =>
      prev
        ? {
            ...prev,
            item_category_id: categoryIdEdit,
            item_type_id: typeIdEdit,
            item_categories: {
              name: categories.find((c) => c.id === categoryIdEdit)?.name ?? "—",
            },
            item_types: {
              name: productTypes.find((t) => t.id === typeIdEdit)?.name ?? "—",
              track_inventory:
                productTypes.find((t) => t.id === typeIdEdit)?.track_inventory ?? true,
            },
          }
        : prev
    );
    setEditingCategoryType(false);
    setSavingCategoryType(false);
  }

  function openAddOption() {
    setEditingOptionId(null);
    setShowAddOptionForm(true);
    setFormVendor("");
    setFormUrl("");
    setFormStdQty("1");
    setFormPiecesPerPack("1");
    setFormTrigger("");
    setFormIsDefault(buyingOptions.length === 0);
  }

  function openEditOption(opt: BuyingOption) {
    setShowAddOptionForm(false);
    setEditingOptionId(opt.id);
    setFormVendor(opt.vendor_company_name);
    setFormUrl(opt.url ?? "");
    setFormStdQty(String(opt.standard_buy_quantity));
    setFormPiecesPerPack(String(opt.pieces_per_pack));
    setFormTrigger(opt.qty_buying_trigger != null ? String(opt.qty_buying_trigger) : "");
    setFormIsDefault(opt.is_default);
  }

  async function handleSaveOption(e: FormEvent) {
    e.preventDefault();
    if (!itemId) return;
    setSavingOption(true);
    const stdQty = parseFloat(formStdQty) || 1;
    const piecesPerPack = parseFloat(formPiecesPerPack) || 1;
    const trigger = formTrigger.trim() ? parseFloat(formTrigger) : null;

    if (editingOptionId) {
      const { error } = await supabase
        .from("item_buying_options")
        .update({
          vendor_company_name: formVendor.trim(),
          url: formUrl.trim() || null,
          standard_buy_quantity: stdQty,
          pieces_per_pack: piecesPerPack,
          qty_buying_trigger: trigger,
          is_default: formIsDefault,
        })
        .eq("id", editingOptionId);
      if (error) setError(error.message);
    } else {
      if (formIsDefault) {
        await supabase
          .from("item_buying_options")
          .update({ is_default: false })
          .eq("item_id", itemId);
      }
      const { error: insertErr } = await supabase.from("item_buying_options").insert({
        item_id: itemId,
        vendor_company_name: formVendor.trim(),
        url: formUrl.trim() || null,
        standard_buy_quantity: stdQty,
        pieces_per_pack: piecesPerPack,
        qty_buying_trigger: trigger,
        is_default: formIsDefault,
      });
      if (insertErr) setError(insertErr.message);
    }
    setSavingOption(false);
    setEditingOptionId(null);
    setShowAddOptionForm(false);
    load();
  }

  function openAdjust(locationId: string, currentQty: number) {
    setAdjustingLocationId(locationId);
    setAdjustCurrentQty(currentQty);
    setAdjustNewQty(String(currentQty));
    setAdjustResetCost(false);
  }

  async function submitAdjust(e: FormEvent) {
    e.preventDefault();
    if (!item || !adjustingLocationId) return;
    const newQty = Math.max(0, Math.floor(parseFloat(adjustNewQty) || 0));
    const currentQty = adjustCurrentQty;
    const qtyChange = newQty - currentQty;
    if (qtyChange === 0) {
      setAdjustingLocationId(null);
      return;
    }
    setSavingAdjust(true);
    setError(null);
    const resetCost = adjustResetCost && newQty === 0;
    const { data: { user } } = await supabase.auth.getUser();
    const payload: Record<string, unknown> = {
      company_id: item.company_id,
      item_id: item.id,
      location_id: adjustingLocationId,
      qty_change: qtyChange,
      transaction_type: "inventory_adjustment",
      unit_cost: resetCost ? 0 : null,
      landed_unit_cost: resetCost ? 0 : null,
      created_by: user?.id ?? null,
    };
    const { error: txErr } = await supabase.from("inventory_transactions").insert(payload);
    if (txErr) {
      setError(txErr.message);
      setSavingAdjust(false);
      return;
    }
    setSavingAdjust(false);
    setAdjustingLocationId(null);
    load();
  }

  async function setDefaultOption(optId: string) {
    await supabase
      .from("item_buying_options")
      .update({ is_default: false })
      .eq("item_id", itemId);
    await supabase
      .from("item_buying_options")
      .update({ is_default: true })
      .eq("id", optId);
    load();
  }

  async function deleteOption(optId: string) {
    if (!confirm("Delete this buying option?")) return;
    await supabase.from("item_buying_options").delete().eq("id", optId);
    load();
  }

  async function addItemLocation() {
    if (!addLocationId || !itemId) return;
    const existing = itemLocations.some((il) => il.location_id === addLocationId);
    if (existing) return;
    const isFirst = itemLocations.length === 0;
    await supabase.from("item_locations").insert({
      item_id: itemId,
      location_id: addLocationId,
      is_default: isFirst,
    });
    setAddLocationId("");
    load();
  }

  async function setDefaultItemLocation(ilId: string) {
    await supabase
      .from("item_locations")
      .update({ is_default: false })
      .eq("item_id", itemId);
    await supabase
      .from("item_locations")
      .update({ is_default: true })
      .eq("id", ilId);
    load();
  }

  async function removeItemLocation(ilId: string) {
    if (!confirm("Remove this location from the item?")) return;
    await supabase.from("item_locations").delete().eq("id", ilId);
    load();
  }

  async function handleDuplicate() {
    if (!item) return;
    const active = loadActiveCompany();
    if (!active) return;
    setDuplicating(true);
    const { data: newItem, error: insertErr } = await supabase
      .from("items")
      .insert({
        company_id: item.company_id,
        sku: `${item.sku}-COPY`,
        name: `${item.name} (Copy)`,
        description: item.description,
        item_type: item.item_type,
        sale_price: item.sale_price,
        is_catalog_item: item.is_catalog_item ?? false,
      })
      .select("id")
      .single();

    if (insertErr) {
      setError(insertErr.message);
      setDuplicating(false);
      return;
    }
    if (newItem && buyingOptions.length > 0) {
      for (const opt of buyingOptions) {
        await supabase.from("item_buying_options").insert({
          item_id: newItem.id,
          vendor_company_name: opt.vendor_company_name,
          url: opt.url,
          standard_buy_quantity: opt.standard_buy_quantity,
          pieces_per_pack: opt.pieces_per_pack,
          qty_buying_trigger: opt.qty_buying_trigger,
          is_default: opt.is_default,
        });
      }
    }
    setDuplicating(false);
    router.push(`/items/${newItem.id}`);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <p className="text-slate-400">Loading item…</p>
      </div>
    );
  }
  if (error && !item) {
    return (
      <div className="space-y-4">
        <p className="text-red-400">{error}</p>
        <Link href="/items" className="text-emerald-400 underline">
          Back to Items
        </Link>
      </div>
    );
  }
  if (!item) return null;

  const defaultOption = buyingOptions.find((o) => o.is_default) ?? buyingOptions[0];
  const tracksInventory = item.item_types?.track_inventory !== false;
  const typeIdsInCategory = categoryIdEdit
    ? categoryTypes
        .filter((ct) => ct.category_id === categoryIdEdit)
        .map((ct) => ct.type_id)
    : [];
  const typesForCategory = productTypes.filter((t) =>
    typeIdsInCategory.includes(t.id)
  );
  const totalOnHand = inventoryByLocation.reduce(
    (sum, b) => sum + Number(b.on_hand_qty ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/items" className="text-xs text-emerald-400 hover:underline">
            ← Items
          </Link>
          <h1 className="text-xl font-semibold text-emerald-300">{item.sku}</h1>
          {companyName && (
            <p className="text-xs text-slate-500">Company: {companyName}</p>
          )}
          <p className="text-xs text-slate-500">
            {tracksInventory ? "Inventory-tracked type" : "Non-inventory type"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={duplicating}
            className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {duplicating ? "Duplicating…" : "Duplicate SKU"}
          </button>
          <button
            type="button"
            onClick={handleDeleteItem}
            disabled={deleting}
            className="rounded border border-red-700 px-3 py-1 text-xs text-red-200 hover:bg-red-900/60 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete item"}
          </button>
        </div>
      </div>

      {/* General */}
      <section className="rounded border border-slate-800 bg-slate-900/50">
        <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">General</h2>
          <button
            type="button"
            onClick={() => toggleSection("general")}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            {collapsedSections["general"] ? "Show" : "Hide"}
          </button>
        </header>
        {!collapsedSections["general"] && (
          <div className="p-4">
            <div className="mb-4 space-y-3 rounded border border-slate-800 bg-slate-900/60 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-slate-500 mb-0.5">
                    Name
                  </label>
                  {editingName ? (
                    <input
                      value={nameEdit}
                      onChange={(e) => setNameEdit(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                      placeholder={item.sku}
                    />
                  ) : (
                    <p className="rounded border border-transparent bg-slate-950/40 px-2 py-1 text-sm text-slate-100">
                      {item.name || item.sku}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!editingName) {
                      setEditingName(true);
                      setNameEdit(item.name ?? "");
                      return;
                    }
                    await handleSaveItemMeta(new Event("submit") as any);
                    setEditingName(false);
                  }}
                  disabled={savingItemMeta}
                  className="mt-5 rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  {editingName ? (savingItemMeta ? "Saving…" : "Save") : "Edit"}
                </button>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(item.is_catalog_item)}
                  onChange={(e) => void handleToggleCatalogItem(e.target.checked)}
                  disabled={savingCatalogFlag}
                />
                Catalog item (listed for sale, not necessarily stocked)
              </label>

              {!editingCategoryType ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-800 bg-slate-950/40 px-2 py-1.5">
                  <div className="flex min-w-0 max-w-[min(100%,16rem)] items-center gap-1.5">
                    <span className="shrink-0 text-[11px] text-slate-500">
                      Category
                    </span>
                    <span className="truncate text-sm text-slate-200">
                      {item.item_categories?.name ?? "—"}
                    </span>
                  </div>
                  <div className="flex min-w-0 max-w-[min(100%,16rem)] items-center gap-1.5">
                    <span className="shrink-0 text-[11px] text-slate-500">Type</span>
                    <span className="truncate text-sm text-slate-200">
                      {item.item_types?.name ?? "—"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingCategoryType(true)}
                    className="ml-auto shrink-0 rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-950/40 px-2 py-1.5">
                  <label className="flex min-w-[8rem] flex-1 items-center gap-1.5 text-[11px] text-slate-500 sm:min-w-[10rem]">
                    <span className="shrink-0">Category</span>
                    <select
                      value={categoryIdEdit}
                      onChange={(e) => {
                        const nextCategoryId = e.target.value;
                        setCategoryIdEdit(nextCategoryId);
                        const nextAllowedTypeIds = categoryTypes
                          .filter((ct) => ct.category_id === nextCategoryId)
                          .map((ct) => ct.type_id);
                        if (!nextAllowedTypeIds.includes(typeIdEdit)) {
                          setTypeIdEdit(nextAllowedTypeIds[0] ?? "");
                        }
                      }}
                      className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-100"
                    >
                      <option value="">Select…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-[8rem] flex-1 items-center gap-1.5 text-[11px] text-slate-500 sm:min-w-[10rem]">
                    <span className="shrink-0">Type</span>
                    <select
                      value={typeIdEdit}
                      onChange={(e) => setTypeIdEdit(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-100"
                    >
                      <option value="">Select…</option>
                      {typesForCategory.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="ml-auto flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleSaveCategoryType()}
                      disabled={savingCategoryType}
                      className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {savingCategoryType ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategoryType(false);
                        setCategoryIdEdit(item.item_category_id ?? "");
                        setTypeIdEdit(item.item_type_id ?? "");
                      }}
                      className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-slate-500 mb-0.5">
                    Description
                  </label>
                  {editingDescription ? (
                    <textarea
                      value={descriptionEdit}
                      onChange={(e) => setDescriptionEdit(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 min-h-[60px]"
                      placeholder="Optional longer description"
                    />
                  ) : (
                    <p className="rounded border border-transparent bg-slate-950/40 px-2 py-1 text-sm text-slate-100 min-h-[40px]">
                      {item.description || "—"}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!editingDescription) {
                      setEditingDescription(true);
                      setDescriptionEdit(item.description ?? "");
                      return;
                    }
                    await handleSaveItemMeta(new Event("submit") as any);
                    setEditingDescription(false);
                  }}
                  disabled={savingItemMeta}
                  className="mt-5 rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  {editingDescription ? (savingItemMeta ? "Saving…" : "Save") : "Edit"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[180px] rounded border border-slate-800 bg-slate-950/40 p-3 space-y-1">
                <div>
                  <span className="block text-xs text-slate-500">Total on hand</span>
                  <p className="mt-1 text-lg font-medium text-slate-100">{tracksInventory ? totalOnHand : "—"}</p>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  <span>Total locations: </span>
                  <span className="font-medium text-slate-100">
                    {tracksInventory ? itemLocations.length : 0}
                  </span>
                  <span className="ml-3">Incoming qty: </span>
                  <span className="font-medium text-slate-100">
                    {tracksInventory ? incomingQty : "—"}
                  </span>
                </div>
              </div>
              <div className="relative flex-1 min-w-[200px] rounded border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">
                    Unit cost ({hasManualCostOverride ? "override" : costType})
                  </span>
                  {hasManualCostOverride && (
                    <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                      Manual
                    </span>
                  )}
                </div>
                <p className="mt-1 text-lg font-medium text-emerald-300">
                  {effectiveCost != null ? `$${effectiveCost.toFixed(2)}` : "—"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  From transactions:{" "}
                  {calculatedCost != null ? `$${calculatedCost.toFixed(2)}` : "—"} · Base:{" "}
                  {baseCost != null ? `$${baseCost.toFixed(2)}` : "—"} · Landed:{" "}
                  {landedCost != null ? `$${landedCost.toFixed(2)}` : "—"}{" "}
                  {useLandedCost ? "(prefer landed)" : "(prefer base)"}
                </p>
                {canAdjustCost && (
                  <div className="mt-3 border-t border-slate-800 pt-3">
                    <button
                      type="button"
                      onClick={() => setShowManualCostModal((v) => !v)}
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800"
                    >
                      {showManualCostModal
                        ? "Close override"
                        : hasManualCostOverride
                          ? "Edit cost override"
                          : "Adjust cost override"}
                    </button>

                    {showManualCostModal && (
                      <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded border border-slate-700 bg-slate-950 p-3 shadow-xl">
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                              Admin — cost override
                            </div>
                            <p className="mt-1 text-[10px] text-slate-500">
                              Sets this SKU&apos;s unit cost for display, margin, and assembly
                              rollups. Clearing uses transaction history again.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowManualCostModal(false)}
                            className="rounded border border-slate-800 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-900"
                          >
                            ✕
                          </button>
                        </div>

                        <form onSubmit={handleSaveManualCost} className="space-y-2">
                          <div>
                            <label className="block text-[10px] text-slate-500">
                              Override ($ / unit)
                            </label>
                            <input
                              type="number"
                              step="0.0001"
                              min="0"
                              value={manualCostEdit}
                              onChange={(e) => setManualCostEdit(e.target.value)}
                              placeholder="Leave empty to use transactions"
                              className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="submit"
                              disabled={savingManualCost}
                              className="rounded bg-emerald-700 px-2 py-1 text-[11px] text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                              {savingManualCost ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              disabled={savingManualCost || !hasManualCostOverride}
                              onClick={handleClearManualCost}
                              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                            >
                              Clear override
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-[220px] rounded border border-slate-800 bg-slate-950/40 p-3">
                <form onSubmit={handleSaveSalePrice} className="space-y-2">
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="block text-xs text-slate-500">Sale price</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={salePriceEdit}
                        onChange={(e) => setSalePriceEdit(e.target.value)}
                        className="mt-0.5 w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={savingSalePrice}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                  <div className="text-xs text-slate-400">
                    {(() => {
                      const sale = parseFloat(salePriceEdit || "0");
                      const cost = effectiveCost ?? 0;
                      if (!sale || !cost) return "Margin: —";
                      const profit = sale - cost;
                      const marginPct = (profit / sale) * 100;
                      const sign = profit >= 0 ? "+" : "-";
                      return `Margin: ${sign}$${Math.abs(profit).toFixed(
                        2,
                      )} (${marginPct.toFixed(1)}%)`;
                    })()}
                  </div>
                </form>
              </div>
              <div className="flex-1 min-w-[220px] rounded border border-slate-800 bg-slate-950/40 p-3">
                <span className="block text-xs text-slate-500">Average time per piece</span>
                <p className="mt-1 text-sm text-slate-200">
                  {avgSecondsPerPiece != null
                    ? (() => {
                        const total = Math.round(avgSecondsPerPiece);
                        const h = Math.floor(total / 3600);
                        const m = Math.floor((total % 3600) / 60);
                        const s = total % 60;
                        const parts: string[] = [];
                        if (h) parts.push(`${h}h`);
                        if (m || h) parts.push(`${m.toString().padStart(2, "0")}m`);
                        parts.push(`${s.toString().padStart(2, "0")}s`);
                        return parts.join(" ");
                      })()
                    : "—"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Based on the last 3 completed work orders for this item.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Default buying option / company & URL */}
      {defaultOption && (
        <section className="rounded border border-slate-800 bg-slate-900/50">
          <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-200">Default buying option</h2>
            <button
              type="button"
              onClick={() => toggleSection("defaultOption")}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              {collapsedSections["defaultOption"] ? "Show" : "Hide"}
            </button>
          </header>
          {!collapsedSections["defaultOption"] && (
            <div className="p-4">
              <p className="text-slate-300">
                <span className="text-slate-500">Vendor:</span>{" "}
                {defaultOption.vendor_company_name}
              </p>
              {defaultOption.url && (
                <p className="text-sm">
                  <a
                    href={defaultOption.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    {defaultOption.url}
                  </a>
                </p>
              )}
              <p className="text-xs text-slate-500">
                Std qty: {defaultOption.standard_buy_quantity} · Pieces per pack:{" "}
                {defaultOption.pieces_per_pack}
                {defaultOption.qty_buying_trigger != null &&
                  ` · Reorder at: ${defaultOption.qty_buying_trigger}`}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Locations */}
      <section className="rounded border border-slate-800 bg-slate-900/50">
        <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">Locations</h2>
          <button
            type="button"
            onClick={() => toggleSection("locations")}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            {collapsedSections["locations"] ? "Show" : "Hide"}
          </button>
        </header>
        {!collapsedSections["locations"] && (
          <div className="p-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                  <th className="py-2 pr-2">Location</th>
                  {tracksInventory && <th className="py-2 pr-2">On hand</th>}
                  <th className="py-2 pr-2">Default</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {itemLocations.map((il) => {
                  const loc = companyLocations.find((l) => l.id === il.location_id);
                  const bal = inventoryByLocation.find((b) => b.location_id === il.location_id);
                  const onHand = bal ? Number(bal.on_hand_qty) : 0;
                  return (
                    <tr key={il.id} className="border-b border-slate-800">
                      <td className="py-2 pr-2" title={loc ? locationHoverTitle(loc) : undefined}>
                        {loc ? locationDisplayLabel(loc) : il.location_id}
                      </td>
                      {tracksInventory && <td className="py-2 pr-2">{onHand}</td>}
                      <td className="py-2 pr-2">
                        {il.is_default ? (
                          <span className="text-emerald-400">Default</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDefaultItemLocation(il.id)}
                            className="text-xs text-slate-400 hover:text-emerald-400"
                          >
                            Set default
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-2 flex flex-wrap items-center gap-1">
                        {tracksInventory && (
                          <>
                            <button
                              type="button"
                              onClick={() => openAdjust(il.location_id, onHand)}
                              className="text-xs text-amber-400 hover:underline"
                            >
                              Adjust
                            </button>
                            <span className="text-slate-600">|</span>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => removeItemLocation(il.id)}
                          className="text-xs text-red-400 hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search by name, warehouse, section, rack, shelf…"
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 w-64"
              />
              <select
                value={addLocationId}
                onChange={(e) => setAddLocationId(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 min-w-[200px]"
              >
                <option value="">Add location…</option>
                {companyLocations
                  .filter((l) => !itemLocations.some((il) => il.location_id === l.id))
                  .filter(
                    (l) =>
                      !locationSearch.trim() ||
                      locationSearchText(l).includes(locationSearch.trim().toLowerCase()),
                  )
                  .map((l) => {
                    const label = locationDisplayLabel(l);
                    const title = locationHoverTitle(l);
                    return (
                      <option key={l.id} value={l.id} title={title}>
                        {label}
                      </option>
                    );
                  })}
              </select>
              <button
                type="button"
                onClick={addItemLocation}
                disabled={!addLocationId}
                className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Adjust inventory modal */}
      {tracksInventory && adjustingLocationId && item && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">Adjust inventory</h3>
            <p className="text-xs text-slate-400 mb-3">
              Location: {companyLocations.find((l) => l.id === adjustingLocationId) ? locationDisplayLabel(companyLocations.find((l) => l.id === adjustingLocationId)!) : adjustingLocationId}
            </p>
            <form onSubmit={submitAdjust} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500">Current on hand</label>
                <div className="mt-0.5 text-sm text-slate-300">{adjustCurrentQty}</div>
              </div>
              <div>
                <label className="block text-xs text-slate-500">New quantity</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={adjustNewQty}
                  onChange={(e) => setAdjustNewQty(e.target.value)}
                  className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                />
              </div>
              {parseFloat(adjustNewQty) === 0 && (
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={adjustResetCost}
                    onChange={(e) => setAdjustResetCost(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  Reset cost (clear cost until next receipt)
                </label>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingAdjust || String(Math.max(0, Math.floor(parseFloat(adjustNewQty) || 0))) === String(adjustCurrentQty)}
                  className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-500 disabled:opacity-50"
                >
                  {savingAdjust ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustingLocationId(null)}
                  className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Buying options table */}
      <section className="rounded border border-slate-800 bg-slate-900/50">
        <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">
            Buying options
          </h2>
          <button
            type="button"
            onClick={() => toggleSection("buyingOptions")}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            {collapsedSections["buyingOptions"] ? "Show" : "Hide"}
          </button>
        </header>
        {!collapsedSections["buyingOptions"] && (
          <div className="p-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                  <th className="py-2 pr-2">Vendor</th>
                  <th className="py-2 pr-2">URL</th>
                  <th className="py-2 pr-2">Std qty</th>
                  <th className="py-2 pr-2">Pieces/pack</th>
                  <th className="py-2 pr-2">Trigger</th>
                  <th className="py-2 pr-2">Default</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {buyingOptions.map((opt) => (
                  <tr key={opt.id} className="border-b border-slate-800">
                    <td className="py-2 pr-2">{opt.vendor_company_name}</td>
                    <td className="py-2 pr-2">
                      {opt.url ? (
                        <a
                          href={opt.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 hover:underline"
                        >
                          Link
                        </a>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-2">{opt.standard_buy_quantity}</td>
                    <td className="py-2 pr-2">{opt.pieces_per_pack}</td>
                    <td className="py-2 pr-2">{opt.qty_buying_trigger ?? "—"}</td>
                    <td className="py-2 pr-2">
                      {opt.is_default ? (
                        <span className="text-emerald-400">Yes</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDefaultOption(opt.id)}
                          className="text-xs text-slate-400 hover:text-emerald-400"
                        >
                          Set default
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        onClick={() => openEditOption(opt)}
                        className="text-xs text-slate-400 hover:text-emerald-400"
                      >
                        Edit
                      </button>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => deleteOption(opt.id)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAddOptionForm && !editingOptionId && (
              <button
                type="button"
                onClick={openAddOption}
                className="mt-2 rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                + Add buying option
              </button>
            )}
            {(showAddOptionForm || editingOptionId) && (
              <form
                onSubmit={handleSaveOption}
                className="mt-4 space-y-2 rounded border border-slate-700 bg-slate-950 p-3"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-slate-500">Vendor name</label>
                    <input
                      value={formVendor}
                      onChange={(e) => setFormVendor(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">URL</label>
                    <input
                      type="url"
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Standard buy qty</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={formStdQty}
                      onChange={(e) => setFormStdQty(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Pieces per pack</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={formPiecesPerPack}
                      onChange={(e) => setFormPiecesPerPack(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Qty buying trigger</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={formTrigger}
                      onChange={(e) => setFormTrigger(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="defaultOpt"
                      checked={formIsDefault}
                      onChange={(e) => setFormIsDefault(e.target.checked)}
                    />
                    <label htmlFor="defaultOpt" className="text-xs text-slate-400">
                      Default buying option
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={savingOption}
                    className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {savingOption ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOptionId(null);
                      setShowAddOptionForm(false);
                    }}
                    className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>

      {/* Recent purchases / cost breakdown */}
      {tracksInventory && (
      <section className="rounded border border-slate-800 bg-slate-900/50">
        <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">
            Incoming history &amp; cost breakdown
          </h2>
          <button
            type="button"
            onClick={() => toggleSection("incoming")}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            {collapsedSections["incoming"] ? "Show" : "Hide"}
          </button>
        </header>
        {!collapsedSections["incoming"] && (
          <div className="p-4">
            {purchaseTxs.length === 0 ? (
              <p className="text-sm text-slate-500">No incoming inventory yet.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Source</th>
                    <th className="py-2 pr-2">Qty</th>
                    <th className="py-2 pr-2">Unit cost</th>
                    <th className="py-2 pr-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseTxs.slice(-20).reverse().map((t) => (
                    <tr key={t.id} className="border-b border-slate-800">
                      <td className="py-2 pr-2 text-slate-400">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-2 text-xs text-slate-400">
                        {t.transaction_type === "purchase_receipt"
                          ? t.reference_table === "receiving_order_lines"
                            ? "Work order"
                            : "Purchase"
                          : t.transaction_type === "work_order_completion"
                          ? "Work order"
                          : t.transaction_type === "inventory_adjustment"
                          ? "Adjustment"
                          : t.transaction_type}
                      </td>
                      <td className="py-2 pr-2">{t.qty_change}</td>
                      <td className="py-2 pr-2">
                        {t.unit_cost != null ? `$${t.unit_cost.toFixed(2)}` : "—"}
                      </td>
                      <td className="py-2 pr-2">
                        {t.unit_cost != null
                          ? `$${(t.unit_cost * t.qty_change).toFixed(2)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
      )}

      {/* BOM / Kitting */}
      <section className="rounded border border-slate-800 bg-slate-900/50">
        <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">BOM / Kitting</h2>
          <button
            type="button"
            onClick={() => toggleSection("bom")}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            {collapsedSections["bom"] ? "Show" : "Hide"}
          </button>
        </header>
        {!collapsedSections["bom"] && (
          <div className="p-4">
            <p className="mb-2 text-xs text-slate-500">
              As component in: assemblies that use this SKU
            </p>
            {usedInBoms.length === 0 ? (
              <p className="text-sm text-slate-500">Not used in any BOM.</p>
            ) : (
              <ul className="list-disc pl-4 text-sm text-slate-300">
                {usedInBoms.map((u) => (
                  <li key={u.parent_id}>
                    <Link
                      href={`/items/${u.parent_id}`}
                      className="text-emerald-400 hover:underline"
                    >
                      {u.parent_sku} – {u.parent_name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {item.item_type !== "raw" && item.item_type !== "service" && (
              <>
                <p className="mt-3 text-xs text-slate-500">
                  This item as parent: BOMs where this is the assembly
                </p>
                {bomsAsParent.length === 0 ? (
                  <p className="text-sm text-slate-500">No BOM defined yet.</p>
                ) : (
                  <ul className="list-disc pl-4 text-sm text-slate-300">
                    {bomsAsParent.map((b) => (
                      <li key={b.id}>
                        {item.sku} rev {b.revision}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Assembly components from procedures */}
      <section className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">
          Assembly components (from procedures)
        </h2>
        {assemblyComponents.length === 0 ? (
          <p className="text-sm text-slate-500">
            No procedures found that build this item.
          </p>
        ) : (
          <div className="space-y-4 text-sm text-slate-200">
            {(assemblyProcedureOrder.length
              ? assemblyProcedureOrder
              : [...assemblyRowsByProcedure.keys()]
            ).map((procId) => {
              const rows = assemblyRowsByProcedure.get(procId) ?? [];
              if (!rows.length) return null;
              const head = rows[0];
              const procLabel = head.procedure_code
                ? `${head.procedure_code} – ${head.procedure_name}`
                : head.procedure_name || "Procedure";
              const assemblyTotal = rows.reduce((sum, r) => {
                if (r.line_total_cost == null) return sum;
                return sum + r.line_total_cost;
              }, 0);
              const hasAnyLineCost = rows.some(
                (r) => r.line_total_cost != null,
              );
              const sortedRows = [...rows].sort((a, b) =>
                (a.item_sku || "").localeCompare(b.item_sku || ""),
              );
              return (
                <div
                  key={procId}
                  className="overflow-hidden rounded border border-slate-800 bg-slate-950/30"
                >
                  <div className="border-b border-slate-800 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-200">
                    {procLabel}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-left text-slate-400">
                          <th className="py-2 px-3">SKU</th>
                          <th className="py-2 px-3">Name</th>
                          <th className="py-2 px-3 text-right tabular-nums">Qty</th>
                          <th className="py-2 px-3 text-right tabular-nums">
                            Unit cost
                          </th>
                          <th className="py-2 px-3 text-right tabular-nums">
                            Line total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((row, idx) => (
                          <tr
                            key={`${row.procedure_id}-${row.item_id}-${idx}`}
                            className="border-b border-slate-900/80"
                          >
                            <td className="py-2 px-3 font-mono">
                              {row.item_id ? (
                                <Link
                                  href={`/items/${row.item_id}`}
                                  className="text-emerald-400 hover:underline"
                                >
                                  {row.item_sku || "—"}
                                </Link>
                              ) : (
                                <span className="text-slate-500">
                                  {row.item_sku || "—"}
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-300">
                              {row.item_name || "—"}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-slate-300">
                              {row.quantity_required}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-slate-300">
                              {row.unit_cost != null
                                ? `$${row.unit_cost.toFixed(4)}`
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-slate-300">
                              {row.line_total_cost != null
                                ? `$${row.line_total_cost.toFixed(2)}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
                    <span className="font-medium text-slate-400">
                      Assembly total cost
                    </span>
                    <span className="tabular-nums font-semibold text-emerald-200">
                      {hasAnyLineCost ? (
                        <>
                          $
                          {assemblyTotal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Work orders */}
      <section className="rounded border border-slate-800 bg-slate-900/50">
        <header className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">
            Work orders (this SKU)
          </h2>
          <button
            type="button"
            onClick={() => toggleSection("workOrders")}
            className="text-[11px] text-slate-400 hover:text-slate-200"
          >
            {collapsedSections["workOrders"] ? "Show" : "Hide"}
          </button>
        </header>
        {!collapsedSections["workOrders"] && (
          <div className="p-4">
            {workOrders.length === 0 ? (
              <p className="text-sm text-slate-500">No work orders.</p>
            ) : (
              <ul className="space-y-1 text-sm text-slate-300">
                {workOrders.map((wo) => (
                  <li key={wo.id}>
                    <Link
                      href={`/work-orders/${wo.id}`}
                      className="text-emerald-400 hover:underline"
                    >
                      {wo.work_order_number}
                    </Link>{" "}
                    – qty {wo.quantity} – {wo.status}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
