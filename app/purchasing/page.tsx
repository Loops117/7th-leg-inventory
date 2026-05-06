"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import {
  fetchOpenReceivingOrderWithOptionalTracking,
} from "@/lib/receivingOrdersQuery";

type ItemWithOptions = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  item_buying_options: {
    id: string;
    vendor_company_name: string;
    url: string | null;
    standard_buy_quantity: number;
    pieces_per_pack: number;
    is_default: boolean;
  }[];
};

type ReceivingLine = {
  id: string;
  receiving_order_id: string;
  item_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number | null;
  pieces_per_pack: number | null;
  order_date: string | null;
  expected_ship_date: string | null;
  expected_arrival_date: string | null;
  vendor_company_name: string | null;
  vendor_url: string | null;
  items: { sku: string; name: string } | null;
};

type ReceiptRecord = {
  id: string;
  qty_change: number;
  created_at: string;
};

export default function PurchasingPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewByVendor, setViewByVendor] = useState(false);
  const [items, setItems] = useState<ItemWithOptions[]>([]);
  const [receivingLines, setReceivingLines] = useState<ReceivingLine[]>([]);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [openOrderStatus, setOpenOrderStatus] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Receive popup (aligned with Purchasing → Receiving page) */
  const [receiveModalLine, setReceiveModalLine] = useState<ReceivingLine | null>(null);
  const [receiveQty, setReceiveQty] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [previousReceipts, setPreviousReceipts] = useState<ReceiptRecord[]>([]);
  const [editingReceiptDate, setEditingReceiptDate] = useState<Record<string, string>>({});
  const [savingReceive, setSavingReceive] = useState(false);

  // Quick buy modal
  const [quickBuyItem, setQuickBuyItem] = useState<ItemWithOptions | null>(null);
  const [quickBuyOption, setQuickBuyOption] = useState<ItemWithOptions["item_buying_options"][0] | null>(null);
  const [qtyToBuy, setQtyToBuy] = useState("");
  const [cost, setCost] = useState("");
  const [piecesPerSet, setPiecesPerSet] = useState("");
  const [shipping, setShipping] = useState("");
  const [tariff, setTariff] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expectedShipDate, setExpectedShipDate] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingLine, setEditingLine] = useState<ReceivingLine | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editPieces, setEditPieces] = useState("");
  const [editOrderDate, setEditOrderDate] = useState("");
  const [editExpectedShipDate, setEditExpectedShipDate] = useState("");
  const [editExpectedArrivalDate, setEditExpectedArrivalDate] = useState("");
  const [editOrderStatus, setEditOrderStatus] = useState<string>("");
  const [editReceipts, setEditReceipts] = useState<ReceiptRecord[]>([]);
  const [editingReceiptDateEdit, setEditingReceiptDateEdit] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    loadItems(active.id);
    loadReceiving(active.id);
  }, []);

  async function loadItems(companyId: string) {
    const { data, error } = await supabase
      .from("items")
      .select(
        `
        id,
        sku,
        name,
        description,
        item_buying_options (
          id,
          vendor_company_name,
          url,
          standard_buy_quantity,
          pieces_per_pack,
          is_default
        )
      `
      )
      .eq("company_id", companyId)
      .order("sku");
    if (error) setError(error.message);
    else setItems((data ?? []) as ItemWithOptions[]);
    setLoading(false);
  }

  async function loadReceiving(companyId: string) {
    const got = await fetchOpenReceivingOrderWithOptionalTracking(
      supabase,
      companyId,
    );
    if (!got.ok) {
      setError(got.message);
      setOpenOrderId(null);
      setOpenOrderStatus(null);
      setTrackingNumber("");
      setReceivingLines([]);
      return;
    }
    const orderRow = got.order;
    const orderId = orderRow?.id ?? null;
    setTrackingNumber(orderRow?.tracking_number ?? "");
    setOpenOrderId(orderId);
    if (!orderId) {
      setOpenOrderStatus(null);
      setReceivingLines([]);
      return;
    }
    const { data: ordMeta } = await supabase
      .from("receiving_orders")
      .select("status")
      .eq("id", orderId)
      .maybeSingle();
    setOpenOrderStatus((ordMeta?.status as string) ?? "open");

    const { data: lines } = await supabase
      .from("receiving_order_lines")
      .select(
        `
        id,
        receiving_order_id,
        item_id,
        quantity_ordered,
        quantity_received,
        unit_cost,
        pieces_per_pack,
        order_date,
        expected_ship_date,
        expected_arrival_date,
        vendor_company_name,
        vendor_url,
        items ( sku, name )
      `
      )
      .eq("receiving_order_id", orderId)
      .order("created_at", { ascending: false });
    setReceivingLines((lines ?? []) as ReceivingLine[]);
  }

  const loadReceiptsForLine = useCallback(async (lineId: string) => {
    const { data } = await supabase
      .from("inventory_transactions")
      .select("id, qty_change, created_at")
      .eq("reference_table", "receiving_order_lines")
      .eq("reference_id", lineId)
      .eq("transaction_type", "purchase_receipt")
      .order("created_at", { ascending: true });
    return (data ?? []) as ReceiptRecord[];
  }, []);

  const openReceiveModal = useCallback(
    async (line: ReceivingLine) => {
      setReceiveModalLine(line);
      const received = Number(line.quantity_received);
      const ordered = Number(line.quantity_ordered);
      setReceiveQty(String(Math.max(0, ordered - received)));
      setReceiveDate(new Date().toISOString().slice(0, 10));
      const receipts = await loadReceiptsForLine(line.id);
      setPreviousReceipts(receipts);
      setEditingReceiptDate(
        Object.fromEntries(receipts.map((r) => [r.id, r.created_at.slice(0, 10)])),
      );
    },
    [loadReceiptsForLine],
  );

  const filteredItems = items.filter(
    (i) =>
      !search.trim() ||
      i.sku.toLowerCase().includes(search.toLowerCase()) ||
      i.name.toLowerCase().includes(search.toLowerCase())
  );

  const byVendor = new Map<string, ItemWithOptions[]>();
  if (viewByVendor) {
    for (const item of filteredItems) {
      for (const opt of item.item_buying_options || []) {
        const key = opt.vendor_company_name;
        if (!byVendor.has(key)) byVendor.set(key, []);
        byVendor.get(key)!.push(item);
      }
    }
  }

  function openQuickBuy(item: ItemWithOptions, opt?: ItemWithOptions["item_buying_options"][0]) {
    const option = opt ?? item.item_buying_options?.find((o) => o.is_default) ?? item.item_buying_options?.[0];
    setQuickBuyItem(item);
    setQuickBuyOption(option ?? null);
    setQtyToBuy(option ? String(option.standard_buy_quantity) : "1");
    setPiecesPerSet(option ? String(option.pieces_per_pack) : "1");
    setCost("");
    setShipping("");
    setTariff("");
    const today = new Date().toISOString().slice(0, 10);
    setOrderDate(today);
    setExpectedShipDate("");
    setExpectedArrivalDate("");
  }

  function selectQuickBuyOption(opt: ItemWithOptions["item_buying_options"][0]) {
    setQuickBuyOption(opt);
    setQtyToBuy(String(opt.standard_buy_quantity));
    setPiecesPerSet(String(opt.pieces_per_pack));
  }

  async function ensureOpenOrder(): Promise<string | null> {
    if (!activeCompanyId) return null;
    if (openOrderId) return openOrderId;
    const { data, error } = await supabase
      .from("receiving_orders")
      .insert({ company_id: activeCompanyId, status: "open" })
      .select("id")
      .single();
    if (error) {
      setError(error.message);
      return null;
    }
    setOpenOrderId(data.id);
    return data.id;
  }

  async function saveQuickBuyLine(closeModal: boolean) {
    if (!quickBuyItem || !activeCompanyId) return;
    const orderId = await ensureOpenOrder();
    if (!orderId) return;
    setSubmitting(true);
    const qty = parseFloat(qtyToBuy) || 1;
    const unitCost = cost.trim() ? parseFloat(cost) : null;
    const pieces = piecesPerSet.trim() ? parseFloat(piecesPerSet) : null;

    // If shipping/tariff entered, set them on the open order header (one per PO)
    if (shipping.trim() || tariff.trim()) {
      const shipVal = shipping.trim() ? parseFloat(shipping) || 0 : 0;
      const tariffVal = tariff.trim() ? parseFloat(tariff) || 0 : 0;
      await supabase
        .from("receiving_orders")
        .update({
          shipping_cost: shipVal,
          tariff_cost: tariffVal,
        })
        .eq("id", orderId);
    }

    const { error } = await supabase.from("receiving_order_lines").insert({
      receiving_order_id: orderId,
      item_id: quickBuyItem.id,
      quantity_ordered: qty,
      unit_cost: unitCost,
      pieces_per_pack: pieces,
      order_date: orderDate || null,
      expected_ship_date: expectedShipDate || null,
      expected_arrival_date: expectedArrivalDate || null,
      vendor_company_name: quickBuyOption?.vendor_company_name ?? null,
      vendor_url: quickBuyOption?.url ?? null,
    });
    if (error) setError(error.message);
    else {
      if (closeModal) setQuickBuyItem(null);
      setNotice("Added to receiving list.");
      loadReceiving(activeCompanyId);
    }
    setSubmitting(false);
  }

  async function handleAddToReceiving(e: FormEvent) {
    e.preventDefault();
    await saveQuickBuyLine(true);
  }

  async function savePurchaseReceive(e: FormEvent) {
    e.preventDefault();
    if (!receiveModalLine || !activeCompanyId) return;
    const qty = parseFloat(receiveQty) || 0;
    const piecesPerPack =
      receiveModalLine.pieces_per_pack && receiveModalLine.pieces_per_pack > 0
        ? receiveModalLine.pieces_per_pack
        : 1;
    const onlyUpdatingDates = qty <= 0;
    const totalPieces = qty * piecesPerPack;
    const ordered = Number(receiveModalLine.quantity_ordered);
    const alreadyReceived = Number(receiveModalLine.quantity_received);
    if (!onlyUpdatingDates) {
      if (totalPieces <= 0) {
        setError("Enter a quantity to receive.");
        return;
      }
      if (alreadyReceived + qty > ordered) {
        setError("Quantity would exceed order amount.");
        return;
      }
    }

    setSavingReceive(true);
    setError(null);
    setNotice(null);

    if (onlyUpdatingDates) {
      for (const [txId, dateStr] of Object.entries(editingReceiptDate)) {
        if (!dateStr) continue;
        const rec = previousReceipts.find((r) => r.id === txId);
        if (!rec || rec.created_at.slice(0, 10) === dateStr) continue;
        await supabase
          .from("inventory_transactions")
          .update({ created_at: new Date(dateStr).toISOString() })
          .eq("id", txId);
      }
      setReceiveModalLine(null);
      setSavingReceive(false);
      if (activeCompanyId) loadReceiving(activeCompanyId);
      setNotice("Receipt dates updated.");
      return;
    }

    const { data: order } = await supabase
      .from("receiving_orders")
      .select("shipping_cost, tariff_cost")
      .eq("id", receiveModalLine.receiving_order_id)
      .single();
    const { data: allLines } = await supabase
      .from("receiving_order_lines")
      .select("id, quantity_ordered, unit_cost")
      .eq("receiving_order_id", receiveModalLine.receiving_order_id);
    const linesArr =
      (allLines ?? []) as {
        id: string;
        quantity_ordered: number;
        unit_cost: number | null;
      }[];
    let totalBaseCost = 0;
    let thisBaseCost = 0;
    for (const l of linesArr) {
      const base = (l.quantity_ordered ?? 0) * (l.unit_cost ?? 0);
      totalBaseCost += base;
      if (l.id === receiveModalLine.id) thisBaseCost = base;
    }
    const extraTotal =
      (order?.shipping_cost ?? 0) + (order?.tariff_cost ?? 0);
    let allocatedExtra = 0;
    if (extraTotal > 0 && totalBaseCost > 0 && thisBaseCost > 0) {
      allocatedExtra = (thisBaseCost / totalBaseCost) * extraTotal;
    }
    const baseUnitCost =
      receiveModalLine.unit_cost != null
        ? receiveModalLine.unit_cost / piecesPerPack
        : null;
    const landedUnitCost =
      receiveModalLine.unit_cost != null && ordered * piecesPerPack > 0
        ? (thisBaseCost + allocatedExtra) / (ordered * piecesPerPack)
        : null;

    const { data: locs } = await supabase
      .from("locations")
      .select("id")
      .eq("company_id", activeCompanyId)
      .limit(1);
    const locationId = locs?.[0]?.id;
    if (!locationId) {
      setError("No location defined. Add a location first.");
      setSavingReceive(false);
      return;
    }

    const receivedAt = receiveDate
      ? new Date(receiveDate).toISOString()
      : new Date().toISOString();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: txErr } = await supabase.from("inventory_transactions").insert({
      company_id: activeCompanyId,
      item_id: receiveModalLine.item_id,
      location_id: locationId,
      qty_change: totalPieces,
      transaction_type: "purchase_receipt",
      unit_cost: baseUnitCost,
      landed_unit_cost: landedUnitCost,
      reference_table: "receiving_order_lines",
      reference_id: receiveModalLine.id,
      created_by: user?.id ?? null,
      created_at: receivedAt,
    });
    if (txErr) {
      setError(txErr.message);
      setSavingReceive(false);
      return;
    }

    const newReceived = alreadyReceived + qty;
    await supabase
      .from("receiving_order_lines")
      .update({ quantity_received: newReceived })
      .eq("id", receiveModalLine.id);

    for (const [txId, dateStr] of Object.entries(editingReceiptDate)) {
      if (!dateStr) continue;
      const rec = previousReceipts.find((r) => r.id === txId);
      if (!rec || rec.created_at.slice(0, 10) === dateStr) continue;
      await supabase
        .from("inventory_transactions")
        .update({ created_at: new Date(dateStr).toISOString() })
        .eq("id", txId);
    }

    setReceiveModalLine(null);
    setSavingReceive(false);
    setNotice("Receipt saved.");
    if (activeCompanyId) loadReceiving(activeCompanyId);
  }

  /** Reverse inventory for a received line (insert negative qty). Used by Unreceive and Delete. */
  async function reverseInventoryForLine(line: ReceivingLine): Promise<boolean> {
    if (!activeCompanyId || line.quantity_received <= 0) return true;
    const { data: txs } = await supabase
      .from("inventory_transactions")
      .select("id, qty_change, unit_cost, landed_unit_cost, location_id")
      .eq("reference_table", "receiving_order_lines")
      .eq("reference_id", line.id)
      .eq("transaction_type", "purchase_receipt");
    const list = (txs ?? []) as { qty_change: number; unit_cost: number | null; landed_unit_cost?: number | null; location_id: string | null }[];
    const totalReceived = list.reduce((s, t) => s + (t.qty_change ?? 0), 0);
    if (totalReceived <= 0) return true;
    const first = list[0];
    const locationId = first?.location_id ?? null;
    if (!locationId) {
      setError("Could not find original receipt location to reverse.");
      return false;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("inventory_transactions").insert({
      company_id: activeCompanyId,
      item_id: line.item_id,
      location_id: locationId,
      qty_change: -totalReceived,
      transaction_type: "purchase_receipt",
      unit_cost: first.unit_cost,
      landed_unit_cost: first.landed_unit_cost ?? null,
      reference_table: "receiving_order_lines",
      reference_id: line.id,
      created_by: user?.id ?? null,
    });
    if (error) {
      setError(error.message);
      return false;
    }
    return true;
  }

  async function unreceiveLine(line: ReceivingLine) {
    if (line.quantity_received <= 0) return;
    if (!confirm("Unreceive this line? Inventory will be reduced by the received quantity.")) return;
    setError(null);
    const ok = await reverseInventoryForLine(line);
    if (!ok) return;
    await supabase
      .from("receiving_order_lines")
      .update({ quantity_received: 0 })
      .eq("id", line.id);
    setNotice("Line was unreceived.");
    if (activeCompanyId) loadReceiving(activeCompanyId);
  }

  async function deleteReceivingLine(line: ReceivingLine) {
    if (!confirm("Remove this line from the receiving list?")) return;
    setError(null);
    if (line.quantity_received > 0) {
      const ok = await reverseInventoryForLine(line);
      if (!ok) return;
    }
    await supabase.from("receiving_order_lines").delete().eq("id", line.id);
    setNotice("Receiving line deleted.");
    if (activeCompanyId) loadReceiving(activeCompanyId);
  }

  async function saveTrackingNumber() {
    if (!openOrderId) return;
    setError(null);
    const { error } = await supabase
      .from("receiving_orders")
      .update({ tracking_number: trackingNumber.trim() || null })
      .eq("id", openOrderId);
    if (error) {
      setError(error.message);
      return;
    }
    setNotice("Tracking number saved.");
  }

  async function openEditLine(line: ReceivingLine) {
    setEditingLine(line);
    setEditQty(String(line.quantity_ordered));
    setEditCost(line.unit_cost != null ? String(line.unit_cost) : "");
    setEditPieces(line.pieces_per_pack != null ? String(line.pieces_per_pack) : "");
    setEditOrderDate(line.order_date ?? "");
    setEditExpectedShipDate(line.expected_ship_date ?? "");
    setEditExpectedArrivalDate(line.expected_arrival_date ?? "");
    const { data: ord } = await supabase
      .from("receiving_orders")
      .select("status")
      .eq("id", line.receiving_order_id)
      .maybeSingle();
    setEditOrderStatus((ord?.status as string) ?? "open");
    const receipts = await loadReceiptsForLine(line.id);
    setEditReceipts(receipts);
    setEditingReceiptDateEdit(
      Object.fromEntries(receipts.map((r) => [r.id, r.created_at.slice(0, 10)])),
    );
  }

  async function saveEditLine(e: FormEvent) {
    e.preventDefault();
    if (!editingLine || !activeCompanyId) return;
    setSavingEdit(true);
    setError(null);
    setNotice(null);
    const qty = parseFloat(editQty) || 0;
    const cost = editCost.trim() ? parseFloat(editCost) : null;
    const pieces = editPieces.trim() ? parseFloat(editPieces) : null;
    const piecesPerPack =
      pieces != null && pieces > 0
        ? pieces
        : editingLine.pieces_per_pack && editingLine.pieces_per_pack > 0
          ? editingLine.pieces_per_pack
          : 1;
    await supabase
      .from("receiving_order_lines")
      .update({
        quantity_ordered: qty,
        unit_cost: cost,
        pieces_per_pack: pieces,
        order_date: editOrderDate || null,
        expected_ship_date: editExpectedShipDate || null,
        expected_arrival_date: editExpectedArrivalDate || null,
      })
      .eq("id", editingLine.id);

    if (editOrderStatus && ["open", "closed", "cancelled"].includes(editOrderStatus)) {
      await supabase
        .from("receiving_orders")
        .update({ status: editOrderStatus })
        .eq("id", editingLine.receiving_order_id);
    }

    for (const [txId, dateStr] of Object.entries(editingReceiptDateEdit)) {
      if (!dateStr) continue;
      const rec = editReceipts.find((r) => r.id === txId);
      if (!rec || rec.created_at.slice(0, 10) === dateStr) continue;
      await supabase
        .from("inventory_transactions")
        .update({ created_at: new Date(dateStr).toISOString() })
        .eq("id", txId);
    }

    const { data: order } = await supabase
      .from("receiving_orders")
      .select("shipping_cost, tariff_cost")
      .eq("id", editingLine.receiving_order_id)
      .single();

    const { data: allLines } = await supabase
      .from("receiving_order_lines")
      .select("id, quantity_ordered, unit_cost")
      .eq("receiving_order_id", editingLine.receiving_order_id);

    const linesArr =
      (allLines ?? []) as {
        id: string;
        quantity_ordered: number;
        unit_cost: number | null;
      }[];

    const totalBaseCost = linesArr.reduce((sum, l) => {
      const qOrd = Number(l.quantity_ordered ?? 0);
      const uCost = l.unit_cost != null ? Number(l.unit_cost) : 0;
      return sum + qOrd * uCost;
    }, 0);

    const thisLine = linesArr.find((l) => l.id === editingLine.id);
    const orderedNow = Number(thisLine?.quantity_ordered ?? qty ?? 0);
    const unitCostNow =
      thisLine?.unit_cost != null ? Number(thisLine.unit_cost) : cost;
    const thisBaseCost = orderedNow * (unitCostNow != null ? unitCostNow : 0);

    const extraTotal =
      Number(order?.shipping_cost ?? 0) + Number(order?.tariff_cost ?? 0);

    let allocatedExtra = 0;
    if (extraTotal > 0 && totalBaseCost > 0 && thisBaseCost > 0) {
      allocatedExtra = (thisBaseCost / totalBaseCost) * extraTotal;
    }

    const baseUnitCost = unitCostNow != null ? unitCostNow / piecesPerPack : null;
    const landedUnitCost =
      unitCostNow != null && orderedNow * piecesPerPack > 0
        ? (thisBaseCost + allocatedExtra) / (orderedNow * piecesPerPack)
        : null;

    await supabase
      .from("inventory_transactions")
      .update({
        unit_cost: baseUnitCost,
        landed_unit_cost: landedUnitCost,
      })
      .eq("transaction_type", "purchase_receipt")
      .eq("reference_table", "receiving_order_lines")
      .eq("reference_id", editingLine.id);

    setSavingEdit(false);
    setEditingLine(null);
    setNotice("Receiving line updated.");
    if (activeCompanyId) loadReceiving(activeCompanyId);
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Purchasing</h2>
        <p className="text-slate-300">
          Select an active company in the header to use Purchasing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Purchasing</h2>
      {companyName && (
        <p className="text-sm text-slate-400">Company: {companyName}</p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <input
          type="text"
          placeholder="Search SKU or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 w-64"
        />
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={viewByVendor}
            onChange={(e) => setViewByVendor(e.target.checked)}
          />
          View by vendor
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}

      {viewByVendor ? (
        <div className="space-y-4">
          {Array.from(byVendor.entries()).map(([vendor, vendorItems]) => (
            <div key={vendor} className="rounded border border-slate-800 p-4">
              <h3 className="text-sm font-semibold text-emerald-300 mb-2">{vendor}</h3>
              <div className="overflow-y-auto max-h-[35rem] rounded border border-slate-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-[1] bg-slate-900">
                  <tr className="border-b border-slate-700 text-left text-slate-400">
                    <th className="py-2 pr-2">SKU</th>
                    <th className="py-2 pr-2">Description</th>
                    <th className="py-2 pr-2">Links</th>
                    <th className="py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {vendorItems.map((item) => {
                    const opt = item.item_buying_options?.find((o) => o.vendor_company_name === vendor);
                    return (
                      <tr key={item.id} className="border-b border-slate-800">
                        <td className="py-2 pr-2 font-mono text-emerald-300">
                          <Link href={`/items/${item.id}`}>{item.sku}</Link>
                        </td>
                        <td className="py-2 pr-2 text-slate-300">{item.name}</td>
                        <td className="py-2 pr-2">
                          {opt?.url ? (
                            <a href={opt.url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                              Buy link
                            </a>
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-2">
                          <button
                            type="button"
                            onClick={() => openQuickBuy(item, opt)}
                            className="text-xs text-emerald-400 hover:underline"
                          >
                            Quick buy
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-y-auto max-h-[35rem] rounded border border-slate-800">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-900">
              <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2 pr-3">SKU</th>
              <th className="py-2 pr-3">Description</th>
              <th className="py-2 pr-3">Buying options / Links</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id} className="border-b border-slate-900 hover:bg-slate-900/60">
                <td className="py-2 pr-3 font-mono text-emerald-300">
                  <Link href={`/items/${item.id}`}>{item.sku}</Link>
                </td>
                <td className="py-2 pr-3 text-slate-300">{item.name}</td>
                <td className="py-2 pr-3">
                  {(item.item_buying_options ?? []).map((opt) => (
                    <span key={opt.id} className="mr-2">
                      {opt.url ? (
                        <a href={opt.url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                          {opt.vendor_company_name}
                        </a>
                      ) : (
                        <span className="text-slate-400">{opt.vendor_company_name}</span>
                      )}
                      {opt.is_default && <span className="text-xs text-slate-500 ml-1">(default)</span>}
                    </span>
                  ))}
                  {(item.item_buying_options?.length ?? 0) === 0 && (
                    <Link href={`/items/${item.id}`} className="text-slate-500 hover:text-emerald-400">
                      Add options
                    </Link>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => openQuickBuy(item)}
                    className="text-xs text-emerald-400 hover:underline"
                  >
                    Quick buy
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <section className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <h3 className="text-sm font-semibold text-slate-200">Inbound / Receiving list</h3>
          {openOrderId && (
            <>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Tracking number"
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              />
              <button
                type="button"
                onClick={saveTrackingNumber}
                className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                Save tracking
              </button>
            </>
          )}
        </div>
        {receivingLines.length === 0 ? (
          <p className="text-sm text-slate-500">No items on the receiving list. Use Quick buy to add.</p>
        ) : (
          <div className="overflow-y-auto max-h-[35rem] rounded border border-slate-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-slate-900/95 backdrop-blur">
                <tr className="border-b border-slate-700 text-left text-slate-400">
                <th className="py-2 pr-2">SKU</th>
                <th className="py-2 pr-2">Item</th>
                <th className="py-2 pr-2">Vendor</th>
                <th className="py-2 pr-2">Order date</th>
                <th className="py-2 pr-2">Expected arrival</th>
                <th className="py-2 pr-2">Recv / ordered</th>
                <th className="py-2 pr-2">Cost</th>
                <th className="py-2 pr-2">Pieces/pack</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {receivingLines.map((line) => {
                const fullyReceived =
                  Number(line.quantity_received) >= Number(line.quantity_ordered);
                const cancelled = openOrderStatus === "cancelled";
                return (
                  <tr key={line.id} className="border-b border-slate-800 hover:bg-slate-900/50">
                    <td className="py-2 pr-2 font-mono">
                      {line.items ? (
                        <Link href={`/items/${line.item_id}`} className="text-emerald-300 hover:underline">
                          {line.items.sku}
                        </Link>
                      ) : (
                        line.item_id.slice(0, 8)
                      )}
                    </td>
                    <td className="py-2 pr-2 text-slate-300">
                      {line.items?.name ?? "—"}
                    </td>
                    <td className="py-2 pr-2 text-slate-300">
                      {line.vendor_company_name
                        ? line.vendor_url
                          ? (
                            <a
                              href={line.vendor_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-400 hover:underline"
                            >
                              {line.vendor_company_name}
                            </a>
                          )
                          : line.vendor_company_name
                        : "—"}
                    </td>
                    <td className="py-2 pr-2 text-slate-400">
                      {line.order_date ?? "—"}
                    </td>
                    <td className="py-2 pr-2 text-slate-400">
                      {line.expected_arrival_date ?? "—"}
                    </td>
                    <td className="py-2 pr-2">
                      {line.quantity_received} / {line.quantity_ordered}
                    </td>
                    <td className="py-2 pr-2">{line.unit_cost != null ? `$${line.unit_cost.toFixed(2)}` : "—"}</td>
                    <td className="py-2 pr-2">{line.pieces_per_pack ?? "—"}</td>
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        onClick={() => void openEditLine(line)}
                        className="text-xs text-slate-400 hover:text-emerald-400 mr-2"
                      >
                        Edit
                      </button>
                      {!cancelled && !fullyReceived && (
                        <button
                          type="button"
                          onClick={() => void openReceiveModal(line)}
                          className="text-xs text-emerald-400 hover:underline mr-2"
                        >
                          Receive
                        </button>
                      )}
                      {!cancelled && fullyReceived && (
                        <>
                          <button
                            type="button"
                            onClick={() => void openReceiveModal(line)}
                            className="text-xs text-slate-400 hover:text-emerald-400 mr-2"
                          >
                            Receive more
                          </button>
                          <button
                            type="button"
                            onClick={() => unreceiveLine(line)}
                            className="text-xs text-amber-400 hover:underline mr-2"
                          >
                            Unreceive
                          </button>
                          <span className="text-xs text-slate-500 mr-2">All in</span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteReceivingLine(line)}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {editingLine && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-slate-950 p-4 shadow-xl text-sm">
            <h2 className="text-base font-semibold text-slate-100 mb-2">
              Edit line: {editingLine.items?.sku ?? editingLine.item_id.slice(0, 8)}
            </h2>
            <form onSubmit={saveEditLine} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Order status</label>
                <select
                  value={editOrderStatus}
                  onChange={(e) => setEditOrderStatus(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-slate-500">Order date</label>
                  <input
                    type="date"
                    value={editOrderDate}
                    onChange={(e) => setEditOrderDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Expected ship</label>
                  <input
                    type="date"
                    value={editExpectedShipDate}
                    onChange={(e) => setEditExpectedShipDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Expected arrival</label>
                  <input
                    type="date"
                    value={editExpectedArrivalDate}
                    onChange={(e) => setEditExpectedArrivalDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-slate-500">Qty ordered</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Unit cost</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editCost}
                    onChange={(e) => setEditCost(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Pieces per pack</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={editPieces}
                    onChange={(e) => setEditPieces(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                  />
                </div>
              </div>
              {editReceipts.length > 0 && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">Received history (edit date if needed)</div>
                  <div className="max-h-32 overflow-y-auto rounded border border-slate-700">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900/80">
                        <tr>
                          <th className="px-2 py-1 text-left">Date</th>
                          <th className="px-2 py-1 text-left">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editReceipts.map((r) => (
                          <tr key={r.id}>
                            <td className="px-2 py-1">
                              <input
                                type="date"
                                value={editingReceiptDateEdit[r.id] ?? r.created_at.slice(0, 10)}
                                onChange={(e) =>
                                  setEditingReceiptDateEdit((prev) => ({
                                    ...prev,
                                    [r.id]: e.target.value,
                                  }))
                                }
                                className="w-full min-w-0 rounded border border-slate-700 bg-slate-900 px-1 py-0.5"
                              />
                            </td>
                            <td className="px-2 py-1">{r.qty_change}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {savingEdit ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingLine(null)}
                  className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {receiveModalLine && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-slate-950 p-4 shadow-xl text-sm">
            <h2 className="text-base font-semibold text-slate-100 mb-1">
              Receive: {receiveModalLine.items?.sku ?? receiveModalLine.item_id.slice(0, 8)} —{" "}
              {receiveModalLine.items?.name ?? "Item"}
            </h2>
            {receiveModalLine.vendor_company_name && (
              <p className="text-[11px] text-slate-400 mb-1">
                Vendor:{" "}
                {receiveModalLine.vendor_url ? (
                  <a
                    href={receiveModalLine.vendor_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    {receiveModalLine.vendor_company_name}
                  </a>
                ) : (
                  receiveModalLine.vendor_company_name
                )}
              </p>
            )}
            <p className="text-xs text-slate-400 mb-3">
              Ordered {receiveModalLine.quantity_ordered} · Already received{" "}
              {receiveModalLine.quantity_received} · Remaining{" "}
              {Math.max(
                0,
                Number(receiveModalLine.quantity_ordered) -
                  Number(receiveModalLine.quantity_received),
              )}
            </p>
            <form onSubmit={savePurchaseReceive} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500">Quantity to receive this time</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={receiveQty}
                    onChange={(e) => setReceiveQty(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Date received</label>
                  <input
                    type="date"
                    value={receiveDate}
                    onChange={(e) => setReceiveDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1"
                  />
                </div>
              </div>
              {previousReceipts.length > 0 && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">Previous receipts (edit date if needed)</div>
                  <div className="max-h-32 overflow-y-auto rounded border border-slate-700">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900/80">
                        <tr>
                          <th className="px-2 py-1 text-left">Date</th>
                          <th className="px-2 py-1 text-left">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previousReceipts.map((r) => (
                          <tr key={r.id}>
                            <td className="px-2 py-1">
                              <input
                                type="date"
                                value={editingReceiptDate[r.id] ?? r.created_at.slice(0, 10)}
                                onChange={(e) =>
                                  setEditingReceiptDate((prev) => ({
                                    ...prev,
                                    [r.id]: e.target.value,
                                  }))
                                }
                                className="w-full min-w-0 rounded border border-slate-700 bg-slate-900 px-1 py-0.5"
                              />
                            </td>
                            <td className="px-2 py-1">{r.qty_change}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingReceive}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {savingReceive ? "Saving…" : "Receive"}
                </button>
                <button
                  type="button"
                  onClick={() => setReceiveModalLine(null)}
                  className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {quickBuyItem && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">
              Quick buy: {quickBuyItem.sku} – {quickBuyItem.name || quickBuyItem.description || ""}
            </h3>
            {(quickBuyItem.item_buying_options?.length ?? 0) > 0 ? (
              <div className="mb-3">
                <p className="text-xs text-slate-500 mb-1">Buying option</p>
                <table className="w-full text-xs border-collapse border border-slate-700 rounded overflow-hidden">
                  <thead>
                    <tr className="bg-slate-800 text-slate-400 text-left">
                      <th className="p-1.5 w-8"></th>
                      <th className="p-1.5">Vendor</th>
                      <th className="p-1.5">Std qty</th>
                      <th className="p-1.5">Pieces/pack</th>
                      <th className="p-1.5">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quickBuyItem.item_buying_options.map((opt) => (
                      <tr
                        key={opt.id}
                        className={`border-t border-slate-700 cursor-pointer hover:bg-slate-800/80 ${quickBuyOption?.id === opt.id ? "bg-emerald-900/20" : ""}`}
                        onClick={() => selectQuickBuyOption(opt)}
                      >
                        <td className="p-1.5">
                          <input
                            type="radio"
                            name="quickbuy-option"
                            checked={quickBuyOption?.id === opt.id}
                            onChange={() => selectQuickBuyOption(opt)}
                            className="rounded"
                          />
                        </td>
                        <td className="p-1.5 text-slate-200">
                          {opt.vendor_company_name}
                          {opt.is_default && <span className="text-slate-500 ml-1">(default)</span>}
                        </td>
                        <td className="p-1.5 text-slate-300">{opt.standard_buy_quantity}</td>
                        <td className="p-1.5 text-slate-300">{opt.pieces_per_pack}</td>
                        <td className="p-1.5">
                          {opt.url ? (
                            <a href={opt.url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline" onClick={(e) => e.stopPropagation()}>
                              Link
                            </a>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500 mb-2">No buying options for this item. Add options on the item view.</p>
            )}
            <form onSubmit={handleAddToReceiving} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-xs text-slate-500">Order date</label>
                  <input
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Expected ship</label>
                  <input
                    type="date"
                    value={expectedShipDate}
                    onChange={(e) => setExpectedShipDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Expected arrival</label>
                  <input
                    type="date"
                    value={expectedArrivalDate}
                    onChange={(e) => setExpectedArrivalDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-500">Qty to buy (packs)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={qtyToBuy}
                    onChange={(e) => setQtyToBuy(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Pieces per pack</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={piecesPerSet}
                    onChange={(e) => setPiecesPerSet(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-500">Pack cost (optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
                <div className="text-[11px] text-slate-500 flex items-center">
                  {qtyToBuy && piecesPerSet && cost ? (
                    <span>
                      Approx. per-piece: $
                      {(() => {
                        const q = parseFloat(qtyToBuy) || 0;
                        const p = parseFloat(piecesPerSet) || 1;
                        const c = parseFloat(cost) || 0;
                        const totalPieces = q * p;
                        return totalPieces > 0
                          ? (c / p).toFixed(4)
                          : "0.0000";
                      })()}
                    </span>
                  ) : (
                    <span>Pack cost ÷ pieces per pack → per-piece cost.</span>
                  )}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-500">
                    Shipping for this PO (optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={shipping}
                    onChange={(e) => setShipping(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">
                    Tariff/duties (optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={tariff}
                    onChange={(e) => setTariff(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void saveQuickBuyLine(false)}
                  className="rounded border border-emerald-600 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
                >
                  {submitting ? "Adding…" : "Add & keep open"}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Add to receiving list
                </button>
                <button
                  type="button"
                  onClick={() => setQuickBuyItem(null)}
                  className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
