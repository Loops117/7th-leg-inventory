"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type ReceivingOrder = {
  id: string;
  company_id: string;
  status: string;
  created_at: string;
};

type ReceivingLineRow = {
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
  order?: ReceivingOrder;
};

type ReceiptRecord = {
  id: string;
  qty_change: number;
  created_at: string;
};

const SORT_KEYS = ["order_date", "sku", "item", "vendor", "qty_ordered", "qty_received", "created_at"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export default function ReceivingPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [orders, setOrders] = useState<ReceivingOrder[]>([]);
  const [lines, setLines] = useState<ReceivingLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"incoming" | "received" | "cancelled" | "all">("incoming");
  const [workorderFilter, setWorkorderFilter] = useState<"all" | "only" | "none">("all");
  const [sortBy, setSortBy] = useState<SortKey>("order_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [receiveLine, setReceiveLine] = useState<ReceivingLineRow | null>(null);
  const [receiveQty, setReceiveQty] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [previousReceipts, setPreviousReceipts] = useState<ReceiptRecord[]>([]);
  const [editingReceiptDate, setEditingReceiptDate] = useState<Record<string, string>>({});
  const [savingReceive, setSavingReceive] = useState(false);

  const [editLine, setEditLine] = useState<ReceivingLineRow | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editPieces, setEditPieces] = useState("");
  const [editOrderDate, setEditOrderDate] = useState("");
  const [editExpectedShipDate, setEditExpectedShipDate] = useState("");
  const [editExpectedArrivalDate, setEditExpectedArrivalDate] = useState("");
  const [editReceipts, setEditReceipts] = useState<ReceiptRecord[]>([]);
  const [editingReceiptDateEdit, setEditingReceiptDateEdit] = useState<Record<string, string>>({});
  const [editOrderStatus, setEditOrderStatus] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadData = useCallback(async (companyId: string) => {
    const { data: ordersData } = await supabase
      .from("receiving_orders")
      .select("id, company_id, status, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    const ordersList = (ordersData ?? []) as ReceivingOrder[];
    setOrders(ordersList);

    if (ordersList.length === 0) {
      setLines([]);
      return;
    }
    const { data: linesData } = await supabase
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
        created_at,
        items ( sku, name )
      `
      )
      .in("receiving_order_id", ordersList.map((o) => o.id))
      .order("created_at", { ascending: false });
    const linesList = (linesData ?? []) as (ReceivingLineRow & { created_at?: string })[];
    const orderMap = new Map(ordersList.map((o) => [o.id, o]));
    const withOrder = linesList.map((l) => ({ ...l, order: orderMap.get(l.receiving_order_id) }));
    setLines(withOrder);
  }, []);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    loadData(active.id).finally(() => setLoading(false));
  }, [loadData]);

  const filteredAndSorted = useMemo(() => {
    let list = lines.filter((l) => {
      const order = orders.find((o) => o.id === l.receiving_order_id);
      const isCancelled = order?.status === "cancelled";
      const isFullyReceived = Number(l.quantity_received) >= Number(l.quantity_ordered);
      if (statusFilter === "incoming") return !isCancelled && !isFullyReceived;
      if (statusFilter === "received") return isFullyReceived;
      if (statusFilter === "cancelled") return isCancelled;
      return true;
    });
    // Filter by workorder vendor label or notes
    list = list.filter((l) => {
      const isWo =
        (l.vendor_company_name && l.vendor_company_name.startsWith("Workorder")) ||
        (l as any).notes === "workorder";
      if (workorderFilter === "only") return isWo;
      if (workorderFilter === "none") return !isWo;
      return true;
    });
    const ord = sortBy === "order_date" ? "order_date" : sortBy === "sku" ? "sku" : sortBy === "item" ? "item" : sortBy === "vendor" ? "vendor" : sortBy === "qty_ordered" ? "qty_ordered" : sortBy === "qty_received" ? "qty_received" : "created_at";
    list = [...list].sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      if (ord === "order_date") {
        va = a.order_date ?? a.order?.created_at ?? "";
        vb = b.order_date ?? b.order?.created_at ?? "";
      } else if (ord === "sku") {
        va = a.items?.sku ?? "";
        vb = b.items?.sku ?? "";
      } else if (ord === "item") {
        va = a.items?.name ?? "";
        vb = b.items?.name ?? "";
      } else if (ord === "vendor") {
        va = a.vendor_company_name ?? "";
        vb = b.vendor_company_name ?? "";
      } else if (ord === "qty_ordered") {
        va = Number(a.quantity_ordered);
        vb = Number(b.quantity_ordered);
      } else if (ord === "qty_received") {
        va = Number(a.quantity_received);
        vb = Number(b.quantity_received);
      } else {
        va = (a as any).created_at ?? "";
        vb = (b as any).created_at ?? "";
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [lines, orders, statusFilter, sortBy, sortDir]);

  const loadReceiptsForLine = useCallback(async (lineId: string) => {
    const { data } = await supabase
      .from("inventory_transactions")
      .select("id, qty_change, created_at")
      .eq("reference_table", "receiving_order_lines")
      .eq("reference_id", lineId)
      .eq("transaction_type", "purchase_receipt")
      .order("created_at", { ascending: true });
    const list = (data ?? []) as ReceiptRecord[];
    return list;
  }, []);

  const openReceive = useCallback(
    async (line: ReceivingLineRow) => {
      setReceiveLine(line);
      const received = Number(line.quantity_received);
      const ordered = Number(line.quantity_ordered);
      setReceiveQty(String(Math.max(0, ordered - received)));
      setReceiveDate(new Date().toISOString().slice(0, 10));
      const receipts = await loadReceiptsForLine(line.id);
      setPreviousReceipts(receipts);
      setEditingReceiptDate(Object.fromEntries(receipts.map((r) => [r.id, r.created_at.slice(0, 10)])));
    },
    [loadReceiptsForLine]
  );

  const openEdit = useCallback(
    async (line: ReceivingLineRow) => {
      setEditLine(line);
      setEditQty(String(line.quantity_ordered));
      setEditCost(line.unit_cost != null ? String(line.unit_cost) : "");
      setEditPieces(line.pieces_per_pack != null ? String(line.pieces_per_pack) : "");
      setEditOrderDate(line.order_date ?? "");
      setEditExpectedShipDate(line.expected_ship_date ?? "");
      setEditExpectedArrivalDate(line.expected_arrival_date ?? "");
      const ord = orders.find((o) => o.id === line.receiving_order_id);
      setEditOrderStatus(ord?.status ?? "open");
      const receipts = await loadReceiptsForLine(line.id);
      setEditReceipts(receipts);
      setEditingReceiptDateEdit(Object.fromEntries(receipts.map((r) => [r.id, r.created_at.slice(0, 10)])));
    },
    [loadReceiptsForLine]
  );

  const saveReceive = async (e: FormEvent) => {
    e.preventDefault();
    if (!receiveLine || !activeCompanyId) return;
    const qty = parseFloat(receiveQty) || 0;
    const piecesPerPack = receiveLine.pieces_per_pack && receiveLine.pieces_per_pack > 0 ? receiveLine.pieces_per_pack : 1;
    const onlyUpdatingDates = qty <= 0;
    const totalPieces = qty * piecesPerPack;
    const ordered = Number(receiveLine.quantity_ordered);
    const alreadyReceived = Number(receiveLine.quantity_received);
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

    if (onlyUpdatingDates) {
      for (const [txId, dateStr] of Object.entries(editingReceiptDate)) {
        if (!dateStr) continue;
        const rec = previousReceipts.find((r) => r.id === txId);
        if (!rec || rec.created_at.slice(0, 10) === dateStr) continue;
        await supabase.from("inventory_transactions").update({ created_at: new Date(dateStr).toISOString() }).eq("id", txId);
      }
      setReceiveLine(null);
      setSavingReceive(false);
      loadData(activeCompanyId);
      return;
    }

    const { data: order } = await supabase.from("receiving_orders").select("shipping_cost, tariff_cost").eq("id", receiveLine.receiving_order_id).single();
    const { data: allLines } = await supabase.from("receiving_order_lines").select("id, quantity_ordered, unit_cost").eq("receiving_order_id", receiveLine.receiving_order_id);
    const linesArr = (allLines ?? []) as { id: string; quantity_ordered: number; unit_cost: number | null }[];
    let totalBaseCost = 0;
    let thisBaseCost = 0;
    for (const l of linesArr) {
      const base = (l.quantity_ordered ?? 0) * (l.unit_cost ?? 0);
      totalBaseCost += base;
      if (l.id === receiveLine.id) thisBaseCost = base;
    }
    const extraTotal = (order?.shipping_cost ?? 0) + (order?.tariff_cost ?? 0);
    let allocatedExtra = 0;
    if (extraTotal > 0 && totalBaseCost > 0 && thisBaseCost > 0) {
      allocatedExtra = (thisBaseCost / totalBaseCost) * extraTotal;
    }
    const baseUnitCost = receiveLine.unit_cost != null ? receiveLine.unit_cost / piecesPerPack : null;
    const landedUnitCost =
      receiveLine.unit_cost != null && ordered * piecesPerPack > 0
        ? (thisBaseCost + allocatedExtra) / (ordered * piecesPerPack)
        : null;

    const { data: locs } = await supabase.from("locations").select("id").eq("company_id", activeCompanyId).limit(1);
    const locationId = locs?.[0]?.id;
    if (!locationId) {
      setError("No location defined. Add a location first.");
      setSavingReceive(false);
      return;
    }

    const receivedAt = receiveDate ? new Date(receiveDate).toISOString() : new Date().toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    const { error: txErr } = await supabase.from("inventory_transactions").insert({
      company_id: activeCompanyId,
      item_id: receiveLine.item_id,
      location_id: locationId,
      qty_change: totalPieces,
      transaction_type: "purchase_receipt",
      unit_cost: baseUnitCost,
      landed_unit_cost: landedUnitCost,
      reference_table: "receiving_order_lines",
      reference_id: receiveLine.id,
      created_by: user?.id ?? null,
      created_at: receivedAt,
    });
    if (txErr) {
      setError(txErr.message);
      setSavingReceive(false);
      return;
    }

    const newReceived = alreadyReceived + qty;
    await supabase.from("receiving_order_lines").update({ quantity_received: newReceived }).eq("id", receiveLine.id);

    for (const [txId, dateStr] of Object.entries(editingReceiptDate)) {
      if (!dateStr) continue;
      const rec = previousReceipts.find((r) => r.id === txId);
      if (!rec || rec.created_at.slice(0, 10) === dateStr) continue;
      await supabase.from("inventory_transactions").update({ created_at: new Date(dateStr).toISOString() }).eq("id", txId);
    }

    setReceiveLine(null);
    setSavingReceive(false);
    loadData(activeCompanyId);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editLine || !activeCompanyId) return;
    setSavingEdit(true);
    const qty = parseFloat(editQty) || 0;
    const cost = editCost.trim() ? parseFloat(editCost) : null;
    const pieces = editPieces.trim() ? parseFloat(editPieces) : null;
    const piecesPerPack =
      pieces != null && pieces > 0
        ? pieces
        : editLine.pieces_per_pack && editLine.pieces_per_pack > 0
          ? editLine.pieces_per_pack
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
      .eq("id", editLine.id);

    if (editOrderStatus && ["open", "closed", "cancelled"].includes(editOrderStatus)) {
      await supabase.from("receiving_orders").update({ status: editOrderStatus }).eq("id", editLine.receiving_order_id);
    }

    for (const [txId, dateStr] of Object.entries(editingReceiptDateEdit)) {
      if (!dateStr) continue;
      const rec = editReceipts.find((r) => r.id === txId);
      if (!rec || rec.created_at.slice(0, 10) === dateStr) continue;
      await supabase.from("inventory_transactions").update({ created_at: new Date(dateStr).toISOString() }).eq("id", txId);
    }

    // IMPORTANT: update existing receipt inventory_transactions unit_cost/landed_unit_cost
    // so item costs recalc immediately after editing receiving lines.
    // (Previously this only updated dates, not costs.)
    const { data: order } = await supabase
      .from("receiving_orders")
      .select("shipping_cost, tariff_cost")
      .eq("id", editLine.receiving_order_id)
      .single();

    const { data: allLines } = await supabase
      .from("receiving_order_lines")
      .select("id, quantity_ordered, unit_cost")
      .eq("receiving_order_id", editLine.receiving_order_id);

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

    const thisLine = linesArr.find((l) => l.id === editLine.id);
    const orderedNow = Number(thisLine?.quantity_ordered ?? qty ?? 0);
    const unitCostNow = thisLine?.unit_cost != null ? Number(thisLine.unit_cost) : cost;
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
      .eq("reference_id", editLine.id);

    setEditLine(null);
    setSavingEdit(false);
    loadData(activeCompanyId);
  };

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else setSortBy(key);
  };

  if (!activeCompanyId && !loading) {
    return (
      <div className="space-y-4">
        <p className="text-slate-300">Select an active company to use Receiving.</p>
        <Link href="/purchasing" className="text-emerald-400 hover:underline text-sm">← Back to Purchasing</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href="/purchasing" className="text-slate-400 hover:text-emerald-400 text-sm">← Purchasing</Link>
          <h1 className="text-lg font-semibold text-slate-100">Receiving</h1>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs text-slate-500">Show:</span>
        {(["incoming", "received", "cancelled", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatusFilter(f)}
            className={`rounded border px-2 py-1 text-xs capitalize ${
              statusFilter === f ? "border-emerald-600 bg-emerald-900/50 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="text-xs text-slate-500 ml-2">Sort:</span>
        {SORT_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggleSort(k)}
            className={`rounded border px-2 py-1 text-xs ${
              sortBy === k ? "border-slate-500 bg-slate-800 text-slate-200" : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800"
            }`}
          >
            {k.replace("_", " ")} {sortBy === k ? (sortDir === "asc" ? "↑" : "↓") : ""}
          </button>
        ))}
        <span className="text-xs text-slate-500 ml-4">Work orders:</span>
        {(["all", "only", "none"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setWorkorderFilter(f)}
            className={`rounded border px-2 py-1 text-xs ${
              workorderFilter === f
                ? "border-emerald-600 bg-emerald-900/50 text-emerald-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {f === "all" ? "All" : f === "only" ? "Only WOs" : "Hide WOs"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-800">
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-700 text-left text-slate-400">
                <tr>
                  <th className="px-2 py-2 font-medium">Order status</th>
                  <th className="px-2 py-2 font-medium">Order date</th>
                  <th className="px-2 py-2 font-medium">SKU</th>
                  <th className="px-2 py-2 font-medium">Item</th>
                  <th className="px-2 py-2 font-medium">Vendor</th>
                  <th className="px-2 py-2 font-medium">Expected arrival</th>
                  <th className="px-2 py-2 font-medium">Qty ordered</th>
                  <th className="px-2 py-2 font-medium">Qty received</th>
                  <th className="px-2 py-2 font-medium">Cost</th>
                  <th className="px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-2 py-4 text-center text-slate-500">
                      No lines match the current filter. Try &quot;All&quot; or add items via Quick buy.
                    </td>
                  </tr>
                ) : (
                  filteredAndSorted.map((line) => {
                    const order = orders.find((o) => o.id === line.receiving_order_id);
                    const fullyReceived = Number(line.quantity_received) >= Number(line.quantity_ordered);
                    return (
                      <tr key={line.id} className="border-b border-slate-800 hover:bg-slate-900/50">
                        <td className="px-2 py-1.5">
                          <span className={`text-xs ${order?.status === "cancelled" ? "text-red-400" : fullyReceived ? "text-slate-500" : "text-emerald-400"}`}>
                            {order?.status ?? "—"} {fullyReceived && order?.status !== "cancelled" ? "(received)" : ""}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-slate-400">{line.order_date ?? line.order?.created_at?.slice(0, 10) ?? "—"}</td>
                        <td className="px-2 py-1.5 font-mono">
                          {line.items ? (
                            <Link href={`/items/${line.item_id}`} className="text-emerald-300 hover:underline">
                              {line.items.sku}
                            </Link>
                          ) : (
                            <span className="text-emerald-300">{line.item_id.slice(0, 8)}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-300">{line.items?.name ?? "—"}</td>
                        <td className="px-2 py-1.5 text-slate-300 max-w-[11rem] break-words">
                          {line.vendor_company_name ? (
                            line.vendor_url ? (
                              <a href={line.vendor_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                                {line.vendor_company_name}
                              </a>
                            ) : (
                              line.vendor_company_name
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-400">{line.expected_arrival_date ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          {line.quantity_ordered}
                          {line.pieces_per_pack ? (
                            <span className="ml-1 text-[11px] text-slate-500">
                              ({line.pieces_per_pack} pk)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">{line.quantity_received}</td>
                        <td className="px-2 py-1.5">{line.unit_cost != null ? `$${Number(line.unit_cost).toFixed(2)}` : "—"}</td>
                        <td className="px-2 py-1.5">
                          <button type="button" onClick={() => openEdit(line)} className="text-xs text-slate-400 hover:text-emerald-400 mr-2">
                            Edit
                          </button>
                          {order?.status !== "cancelled" && !fullyReceived && (
                            <button type="button" onClick={() => openReceive(line)} className="text-xs text-emerald-400 hover:underline">
                              Receive
                            </button>
                          )}
                          {order?.status !== "cancelled" && fullyReceived && (
                            <button type="button" onClick={() => openReceive(line)} className="text-xs text-slate-400 hover:text-emerald-400">
                              Receive more
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {receiveLine && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-slate-950 p-4 shadow-xl text-sm">
            <h2 className="text-base font-semibold text-slate-100 mb-1">
              Receive: {receiveLine.items?.sku ?? receiveLine.item_id.slice(0, 8)} — {receiveLine.items?.name ?? "Item"}
            </h2>
            {receiveLine.vendor_company_name && (
              <p className="text-[11px] text-slate-400 mb-1">
                Vendor:{" "}
                {receiveLine.vendor_url ? (
                  <a
                    href={receiveLine.vendor_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    {receiveLine.vendor_company_name}
                  </a>
                ) : (
                  receiveLine.vendor_company_name
                )}
              </p>
            )}
            <p className="text-xs text-slate-400 mb-3">
              Ordered {receiveLine.quantity_ordered} · Already received {receiveLine.quantity_received} · Remaining{" "}
              {Math.max(0, Number(receiveLine.quantity_ordered) - Number(receiveLine.quantity_received))}
            </p>
            <form onSubmit={saveReceive} className="space-y-3">
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
                                onChange={(e) => setEditingReceiptDate((prev) => ({ ...prev, [r.id]: e.target.value }))}
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
                <button type="submit" disabled={savingReceive} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50">
                  {savingReceive ? "Saving…" : "Receive"}
                </button>
                <button type="button" onClick={() => setReceiveLine(null)} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editLine && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-slate-950 p-4 shadow-xl text-sm">
            <h2 className="text-base font-semibold text-slate-100 mb-2">
              Edit line: {editLine.items?.sku ?? editLine.item_id.slice(0, 8)}
            </h2>
            <form onSubmit={saveEdit} className="space-y-3">
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
                  <input type="date" value={editOrderDate} onChange={(e) => setEditOrderDate(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Expected ship</label>
                  <input type="date" value={editExpectedShipDate} onChange={(e) => setEditExpectedShipDate(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Expected arrival</label>
                  <input type="date" value={editExpectedArrivalDate} onChange={(e) => setEditExpectedArrivalDate(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-slate-500">Qty ordered</label>
                  <input type="number" min="0" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Unit cost</label>
                  <input type="number" min="0" step="0.01" value={editCost} onChange={(e) => setEditCost(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Pieces per pack</label>
                  <input type="number" min="0" step="any" value={editPieces} onChange={(e) => setEditPieces(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1" />
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
                                onChange={(e) => setEditingReceiptDateEdit((prev) => ({ ...prev, [r.id]: e.target.value }))}
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
                <button type="submit" disabled={savingEdit} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50">
                  {savingEdit ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditLine(null)} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">
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
