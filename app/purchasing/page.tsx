"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

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

export default function PurchasingPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewByVendor, setViewByVendor] = useState(false);
  const [items, setItems] = useState<ItemWithOptions[]>([]);
  const [receivingLines, setReceivingLines] = useState<ReceivingLine[]>([]);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    const { data: orders } = await supabase
      .from("receiving_orders")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "open")
      .limit(1);
    const orderId = orders?.[0]?.id ?? null;
    setOpenOrderId(orderId);
    if (!orderId) {
      setReceivingLines([]);
      return;
    }
    const { data: lines } = await supabase
      .from("receiving_order_lines")
      .select(
        `
        id,
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

  async function handleAddToReceiving(e: FormEvent) {
    e.preventDefault();
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
      setQuickBuyItem(null);
      loadReceiving(activeCompanyId);
    }
    setSubmitting(false);
  }

  async function receiveLine(line: ReceivingLine) {
    if (!activeCompanyId || !openOrderId) return;
    const packsToReceive = line.quantity_ordered - line.quantity_received;
    if (packsToReceive <= 0) return;

    const piecesPerPack = line.pieces_per_pack && line.pieces_per_pack > 0 ? line.pieces_per_pack : 1;
    const totalPieces = packsToReceive * piecesPerPack;
    if (totalPieces <= 0) return;

    // Load order header for shipping/tariff allocation
    const { data: order } = await supabase
      .from("receiving_orders")
      .select("shipping_cost, tariff_cost")
      .eq("id", openOrderId)
      .single();

    const { data: allLines } = await supabase
      .from("receiving_order_lines")
      .select("id, quantity_ordered, unit_cost")
      .eq("receiving_order_id", openOrderId);

    const linesArr =
      (allLines as { id: string; quantity_ordered: number; unit_cost: number | null }[] | null) ??
      [];
    let totalBaseCost = 0;
    let thisBaseCost = 0;
    for (const l of linesArr) {
      const base = (l.quantity_ordered ?? 0) * (l.unit_cost ?? 0);
      totalBaseCost += base;
      if (l.id === line.id) thisBaseCost = base;
    }

    const extraTotal =
      (order?.shipping_cost ?? 0) + (order?.tariff_cost ?? 0);
    let allocatedExtra = 0;
    if (extraTotal > 0 && totalBaseCost > 0 && thisBaseCost > 0) {
      allocatedExtra = (thisBaseCost / totalBaseCost) * extraTotal;
    }

    const baseUnitCost =
      line.unit_cost != null ? line.unit_cost / piecesPerPack : null;
    const landedUnitCost =
      line.unit_cost != null
        ? (thisBaseCost + allocatedExtra) /
          (line.quantity_ordered * piecesPerPack)
        : null;
    const { data: locs } = await supabase
      .from("locations")
      .select("id")
      .eq("company_id", activeCompanyId)
      .limit(1);
    const locationId = locs?.[0]?.id;
    if (!locationId) {
      setError("No location defined. Add a location for this company first.");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { error: txErr } = await supabase.from("inventory_transactions").insert({
      company_id: activeCompanyId,
      item_id: line.item_id,
      location_id: locationId,
      qty_change: totalPieces,
      transaction_type: "purchase_receipt",
      unit_cost: baseUnitCost,
      landed_unit_cost: landedUnitCost,
      reference_table: "receiving_order_lines",
      reference_id: line.id,
      created_by: user?.id ?? null,
    });
    if (txErr) {
      setError(txErr.message);
      return;
    }
    await supabase
      .from("receiving_order_lines")
      .update({ quantity_received: line.quantity_ordered })
      .eq("id", line.id);
    loadReceiving(activeCompanyId);
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
    if (activeCompanyId) loadReceiving(activeCompanyId);
  }

  function openEditLine(line: ReceivingLine) {
    setEditingLine(line);
    setEditQty(String(line.quantity_ordered));
    setEditCost(line.unit_cost != null ? String(line.unit_cost) : "");
    setEditPieces(line.pieces_per_pack != null ? String(line.pieces_per_pack) : "");
    setEditOrderDate(line.order_date ?? "");
    setEditExpectedShipDate(line.expected_ship_date ?? "");
    setEditExpectedArrivalDate(line.expected_arrival_date ?? "");
  }

  async function saveEditLine(e: FormEvent) {
    e.preventDefault();
    if (!editingLine) return;
    setSavingEdit(true);
    const qty = parseFloat(editQty) || 0;
    const cost = editCost.trim() ? parseFloat(editCost) : null;
    const pieces = editPieces.trim() ? parseFloat(editPieces) : null;
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
    setSavingEdit(false);
    setEditingLine(null);
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
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Inbound / Receiving list</h3>
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
                <th className="py-2 pr-2">Qty</th>
                <th className="py-2 pr-2">Cost</th>
                <th className="py-2 pr-2">Pieces/pack</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {receivingLines.map((line) => (
                <tr key={line.id} className="border-b border-slate-800">
                  <td className="py-2 pr-2">
                    {line.items?.sku ?? line.item_id}
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
                  <td className="py-2 pr-2">{line.quantity_ordered}</td>
                  <td className="py-2 pr-2">{line.unit_cost != null ? `$${line.unit_cost.toFixed(2)}` : "—"}</td>
                  <td className="py-2 pr-2">{line.pieces_per_pack ?? "—"}</td>
                  <td className="py-2 pr-2">
                    <button
                      type="button"
                      onClick={() => openEditLine(line)}
                      className="text-xs text-slate-400 hover:text-emerald-400"
                    >
                      Edit
                    </button>
                    {" "}
                    {line.quantity_received < line.quantity_ordered ? (
                      <button
                        type="button"
                        onClick={() => receiveLine(line)}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        Receive
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => unreceiveLine(line)}
                          className="text-xs text-amber-400 hover:underline"
                        >
                          Unreceive
                        </button>
                        {" "}
                        <span className="text-xs text-slate-500">Received</span>
                      </>
                    )}
                    {" "}
                    <button
                      type="button"
                      onClick={() => deleteReceivingLine(line)}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {editingLine && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">
              Edit line: {(editingLine.items as { sku?: string })?.sku ?? editingLine.item_id}
            </h3>
            <form onSubmit={saveEditLine} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-xs text-slate-500">Order date</label>
                  <input
                    type="date"
                    value={editOrderDate}
                    onChange={(e) => setEditOrderDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Expected ship</label>
                  <input
                    type="date"
                    value={editExpectedShipDate}
                    onChange={(e) => setEditExpectedShipDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Expected arrival</label>
                  <input
                    type="date"
                    value={editExpectedArrivalDate}
                    onChange={(e) => setEditExpectedArrivalDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-500">Quantity ordered</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
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
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
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
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Save
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
