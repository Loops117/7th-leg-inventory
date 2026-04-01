"use client";

import React, {
  FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCostFromTransactions, type CostType } from "@/lib/cost";
import { getCurrentUserPermissions, hasPermission } from "@/lib/permissions";

export default function SalesPage() {
  type Customer = {
    id: string;
    company_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };

  type SalesOrder = {
    id: string;
    company_id: string;
    customer_id: string | null;
    status: "new" | "in_progress" | "shipped" | "completed" | "back_order";
    order_type: "sale" | "trade";
    so_number: number | string | null;
    po_number: string | null;
    order_notes: string | null;
    is_local_sale: boolean;
    shipping_fee: number | null;
    sale_date: string | null;
    ship_date: string | null;
    created_at: string;
  };

  type SalesOrderLine = {
    id: string;
    sales_order_id: string;
    item_id: string | null;
    sku_text: string | null;
    description: string | null;
    quantity: number;
    shipped_quantity: number;
    unit_price: number;
    unit_cost: number | null;
    created_at: string;
  };

  type ItemLite = {
    id: string;
    sku: string;
    name: string | null;
    description: string | null;
    sale_price: number | null;
  };

  type SkuMenuPos = {
    lineId: string;
    top: number;
    left: number;
    width: number;
  };

  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [costType, setCostType] = useState<CostType>("average");
  const [useLandedCost, setUseLandedCost] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [lines, setLines] = useState<SalesOrderLine[]>([]);

  const [showEditor, setShowEditor] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [canManageSales, setCanManageSales] = useState(false);

  // Editor fields
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMatches, setCustomerMatches] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrPostal, setAddrPostal] = useState("");
  const [addrCountry, setAddrCountry] = useState("");

  const [status, setStatus] = useState<SalesOrder["status"]>("new");
  const [poNumber, setPoNumber] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [isLocalSale, setIsLocalSale] = useState(false);
  const [shippingFee, setShippingFee] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [shipDate, setShipDate] = useState("");
  const [shipNow, setShipNow] = useState(false);
  const [soNumberInput, setSoNumberInput] = useState("");

  type EditableLine = {
    id: string;
    item_id: string | null;
    sku_text: string;
    description: string;
    quantity: string;
    unit_price: string;
    unit_cost: number | null; // auto-calculated
    shipped_quantity: string;
    skuLookupOpen: boolean;
    skuMatches: ItemLite[];
    skuLoading: boolean;
  };
  const [editLines, setEditLines] = useState<EditableLine[]>([]);
  const [skuMenuPos, setSkuMenuPos] = useState<SkuMenuPos | null>(null);

  /** Line counts for save/totals only when it has a SKU, description, or linked item (ignores blank trailing row). */
  const lineHasBusinessContent = (l: EditableLine) =>
    Boolean(l.item_id || l.sku_text.trim() || l.description.trim());

  const emptyLine = (): EditableLine => ({
    id: crypto.randomUUID(),
    item_id: null,
    sku_text: "",
    description: "",
    quantity: "1",
    unit_price: "",
    unit_cost: null,
    shipped_quantity: "",
    skuLookupOpen: false,
    skuMatches: [],
    skuLoading: false,
  });

  const todayLocalISODate = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const formatStatus = (s: SalesOrder["status"]) => {
    if (s === "new") return "New Order";
    if (s === "in_progress") return "In Progress";
    if (s === "shipped") return "Shipped";
    if (s === "completed") return "Completed";
    if (s === "back_order") return "Back Order";
    return s;
  };

  const loadAll = async (companyId: string) => {
    setLoading(true);
    setError(null);

    const { data: settings } = await supabase
      .from("company_settings")
      .select("cost_type, use_landed_cost")
      .eq("company_id", companyId)
      .single();
    setCostType((settings?.cost_type as CostType) ?? "average");
    setUseLandedCost(Boolean((settings as any)?.use_landed_cost));

    const { data: custRows, error: custErr } = await supabase
      .from("customers")
      .select(
        "id, company_id, name, email, phone, address_line1, address_line2, city, state, postal_code, country",
      )
      .eq("company_id", companyId)
      .order("name");
    if (custErr) console.error(custErr);
    setCustomers((custRows ?? []) as Customer[]);

    const { data: orderRows, error: orderErr } = await supabase
      .from("sales_orders")
      .select(
        "id, company_id, customer_id, status, order_type, so_number, po_number, order_notes, is_local_sale, shipping_fee, sale_date, ship_date, created_at",
      )
      .eq("company_id", companyId)
      .eq("order_type", "sale")
      .order("created_at", { ascending: false })
      .limit(200);
    if (orderErr) console.error(orderErr);
    setOrders((orderRows ?? []) as SalesOrder[]);

    const orderIds = (orderRows ?? []).map((o: any) => o.id as string);
    if (orderIds.length > 0) {
      const { data: lineRows, error: lineErr } = await supabase
        .from("sales_order_lines")
        .select(
          "id, sales_order_id, item_id, sku_text, description, quantity, shipped_quantity, unit_price, unit_cost, created_at",
        )
        .in("sales_order_id", orderIds)
        .order("created_at", { ascending: true });
      if (lineErr) console.error(lineErr);
      setLines((lineRows ?? []) as SalesOrderLine[]);
    } else {
      setLines([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    loadAll(active.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeCompanyId) {
      setCanManageSales(false);
      return;
    }
    let cancelled = false;
    void getCurrentUserPermissions(activeCompanyId).then(({ isSuperAdmin, permissionCodes }) => {
      if (cancelled) return;
      setCanManageSales(
        isSuperAdmin || hasPermission(permissionCodes, "manage_sales"),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId]);

  // Customer mini-search (lightweight)
  useEffect(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) {
      setCustomerMatches([]);
      return;
    }
    const matches = customers
      .filter((c) => {
        const hay = `${c.name} ${c.email ?? ""} ${c.phone ?? ""} ${c.city ?? ""} ${c.address_line1 ?? ""} ${c.postal_code ?? ""}`
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
    setCustomerMatches(matches);
  }, [customerQuery, customers]);

  useEffect(() => {
    if (selectedCustomerId) {
      const c = customers.find((x) => x.id === selectedCustomerId);
      if (c) {
        setAddrLine1(c.address_line1 ?? "");
        setAddrLine2(c.address_line2 ?? "");
        setAddrCity(c.city ?? "");
        setAddrState(c.state ?? "");
        setAddrPostal(c.postal_code ?? "");
        setAddrCountry(c.country ?? "");
      }
    } else {
      setAddrLine1("");
      setAddrLine2("");
      setAddrCity("");
      setAddrState("");
      setAddrPostal("");
      setAddrCountry("");
    }
  }, [selectedCustomerId, customers]);

  // Keep SKU typeahead anchored to the input (portal), including when the modal/table scrolls.
  useLayoutEffect(() => {
    const row = editLines.find(
      (l) => l.skuLookupOpen && (l.skuLoading || l.skuMatches.length > 0),
    );
    if (!row) {
      setSkuMenuPos(null);
      return;
    }
    const el = document.getElementById(`sale-line-sku-${row.id}`);
    if (!el) {
      setSkuMenuPos(null);
      return;
    }
    const place = () => {
      const r = el.getBoundingClientRect();
      setSkuMenuPos({
        lineId: row.id,
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 288),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [editLines]);

  useEffect(() => {
    if (!skuMenuPos) return;
    const close = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (
        t.closest("[data-sale-sku-input]") ||
        t.closest("[data-sale-sku-menu]")
      ) {
        return;
      }
      setEditLines((prev) =>
        prev.map((l) => ({ ...l, skuLookupOpen: false, skuMatches: [], skuLoading: false })),
      );
      setSkuMenuPos(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [skuMenuPos]);

  /** Next sales-order number for this company (DB may also auto-fill via trigger). */
  const allocNextSoNumber = async (companyId: string): Promise<number | string> => {
    const { data, error } = await supabase
      .from("sales_orders")
      .select("so_number")
      .eq("company_id", companyId);
    if (error) throw error;
    const parseOne = (v: unknown): number | null => {
      if (v == null) return null;
      if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
      const s = String(v).trim();
      if (/^-?\d+$/.test(s)) return parseInt(s, 10);
      const digits = s.match(/\d+/g);
      if (!digits?.length) return null;
      const n = parseInt(digits[digits.length - 1]!, 10);
      return Number.isNaN(n) ? null : n;
    };
    let max = 0;
    for (const row of data ?? []) {
      const n = parseOne((row as { so_number?: unknown }).so_number);
      if (n != null && n > max) max = n;
    }
    return max + 1;
  };

  const orderRowsForTable = useMemo(() => {
    return orders.map((o) => {
      const cust = customers.find((c) => c.id === o.customer_id) ?? null;
      const these = lines.filter((l) => l.sales_order_id === o.id);
      const totalPrice =
        these.reduce((sum, l) => sum + Number(l.quantity ?? 0) * Number(l.unit_price ?? 0), 0) +
        (o.is_local_sale ? 0 : Number(o.shipping_fee ?? 0));
      const totalCost = these.reduce((sum, l) => {
        const uc = l.unit_cost != null ? Number(l.unit_cost) : 0;
        return sum + Number(l.quantity ?? 0) * uc;
      }, 0);
      const itemCount = these.reduce((sum, l) => sum + Number(l.quantity ?? 0), 0);
      return {
        order: o,
        customer: cust,
        totalPrice,
        totalCost,
        itemCount,
        lineCount: these.length,
      };
    });
  }, [orders, customers, lines]);

  const openNewSale = () => {
    setEditingOrderId(null);
    setShowEditor(true);
    setError(null);

    setCustomerQuery("");
    setCustomerMatches([]);
    setSelectedCustomerId(null);
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerPhone("");

    setStatus("new");
    setPoNumber("");
    setOrderNotes("");
    setIsLocalSale(false);
    setShippingFee("");
    setSaleDate(todayLocalISODate());
    setShipDate("");
    setShipNow(false);
    setSoNumberInput("");
    if (activeCompanyId) {
      void allocNextSoNumber(activeCompanyId)
        .then((n) => setSoNumberInput(String(n)))
        .catch(() => setSoNumberInput(""));
    }

    setEditLines([emptyLine()]);
  };

  const openEditSale = (orderId: string) => {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    setEditingOrderId(orderId);
    setShowEditor(true);
    setError(null);

    const cust = customers.find((c) => c.id === o.customer_id) ?? null;
    setSelectedCustomerId(cust?.id ?? null);
    setCustomerQuery(cust?.name ?? "");
    setCustomerMatches([]);
    setNewCustomerName("");
    setNewCustomerEmail("");
    setNewCustomerPhone("");

    setStatus(o.status);
    setPoNumber(o.po_number ?? "");
    setOrderNotes(o.order_notes ?? "");
    setIsLocalSale(Boolean(o.is_local_sale));
    setShippingFee(o.shipping_fee != null ? String(o.shipping_fee) : "");
    setSaleDate(
      o.sale_date
        ? String(o.sale_date).slice(0, 10)
        : o.created_at.slice(0, 10),
    );
    setShipDate(o.ship_date ? String(o.ship_date).slice(0, 10) : "");
    setShipNow(false);
    setSoNumberInput(
      o.so_number != null && o.so_number !== "" ? String(o.so_number) : "",
    );

    const these = lines.filter((l) => l.sales_order_id === o.id);
    setEditLines(
      these.map((l) => ({
        id: l.id,
        item_id: l.item_id ?? null,
        sku_text: l.sku_text ?? "",
        description: l.description ?? "",
        quantity: String(l.quantity ?? 0),
        unit_price: String(l.unit_price ?? 0),
        unit_cost: l.unit_cost != null ? Number(l.unit_cost) : null,
        shipped_quantity: String(l.shipped_quantity ?? 0),
        skuLookupOpen: false,
        skuMatches: [],
        skuLoading: false,
      })),
    );
    if (these.length === 0) setEditLines([emptyLine()]);
  };

  const lookupItemsBySku = async (idx: number, q: string) => {
    if (!activeCompanyId) return;
    const query = q.trim();
    if (!query) {
      setEditLines((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], skuMatches: [], skuLookupOpen: false };
        return next;
      });
      setSkuMenuPos(null);
      return;
    }
    // Avoid breaking PostgREST .or() ilike patterns
    const safe = query.replace(/%/g, "").replace(/_/g, "").replace(/,/g, "");
    if (!safe) {
      setEditLines((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], skuMatches: [], skuLookupOpen: false, skuLoading: false };
        return next;
      });
      setSkuMenuPos(null);
      return;
    }
    const pattern = `%${safe}%`;
    setEditLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], skuLoading: true, skuLookupOpen: true };
      return next;
    });
    const { data, error: qErr } = await supabase
      .from("items")
      .select("id, sku, name, description, sale_price")
      .eq("company_id", activeCompanyId)
      .or(`sku.ilike.${pattern},name.ilike.${pattern},description.ilike.${pattern}`)
      .order("sku")
      .limit(16);
    if (qErr) console.error(qErr);
    setEditLines((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        skuMatches: (data ?? []) as ItemLite[],
        skuLoading: false,
        skuLookupOpen: true,
      };
      return next;
    });
  };

  const computeUnitCostForItem = async (itemId: string) => {
    // Compute from inventory_transactions for this item (like Items page)
    const { data: txs } = await supabase
      .from("inventory_transactions")
      .select("qty_change, unit_cost, landed_unit_cost")
      .eq("item_id", itemId)
      .in("transaction_type", [
        "purchase_receipt",
        "work_order_completion",
        "inventory_adjustment",
      ])
      .order("created_at", { ascending: true });
    const mapped =
      (txs ?? []).map((t: any) => ({
        unit_cost:
          useLandedCost && t.landed_unit_cost != null
            ? Number(t.landed_unit_cost)
            : t.unit_cost != null
              ? Number(t.unit_cost)
              : null,
        qty_change: Number(t.qty_change ?? 0),
      })) ?? [];
    return getCostFromTransactions(mapped, costType);
  };

  const selectItemForLine = async (idx: number, it: ItemLite) => {
    const unitCost = await computeUnitCostForItem(it.id);
    const descParts = [it.name?.trim(), it.description?.trim()].filter(
      (x): x is string => Boolean(x && x.length > 0),
    );
    const lineDescription = descParts.length > 0 ? descParts.join(" — ") : "";
    setSkuMenuPos(null);
    setEditLines((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        item_id: it.id,
        sku_text: it.sku,
        description: lineDescription,
        unit_price:
          next[idx].unit_price.trim() !== ""
            ? next[idx].unit_price
            : it.sale_price != null
              ? String(it.sale_price)
              : "",
        unit_cost: unitCost,
        skuLookupOpen: false,
        skuMatches: [],
      };
      return next;
    });
  };

  const ensureTrailingBlankLine = () => {
    setEditLines((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return [emptyLine()];
      const touched =
        last.sku_text.trim() ||
        last.description.trim() ||
        (parseFloat(last.quantity) || 0) !== 1 ||
        (parseFloat(last.unit_price) || 0) !== 0;
      if (!touched) return prev;
      return [...prev, emptyLine()];
    });
  };

  const editorTotals = useMemo(() => {
    const clean = editLines.filter(
      (l) =>
        l.sku_text.trim() ||
        l.description.trim() ||
        (parseFloat(l.quantity) || 0) > 0,
    );
    const subtotal = clean.reduce((sum, l) => {
      const q = parseFloat(l.quantity) || 0;
      const p = parseFloat(l.unit_price) || 0;
      return sum + q * p;
    }, 0);
    const totalCost = clean.reduce((sum, l) => {
      const q = parseFloat(l.quantity) || 0;
      const uc = l.unit_cost != null ? Number(l.unit_cost) : 0;
      return sum + q * uc;
    }, 0);
    const ship = isLocalSale ? 0 : parseFloat(shippingFee) || 0;
    return { subtotal, shipping: ship, total: subtotal + ship, totalCost };
  }, [editLines, isLocalSale, shippingFee]);

  function parseSoNumberInput(raw: string): "auto" | "invalid" | { n: number } {
    const t = raw.trim();
    if (t === "") return "auto";
    if (!/^\d{1,18}$/.test(t)) return "invalid";
    const n = Number(t);
    if (!Number.isSafeInteger(n) || n < 0) return "invalid";
    return { n };
  }

  const deleteSaleOrder = async (orderId: string) => {
    if (!activeCompanyId) return;
    const ok = confirm(
      "Delete this sale permanently? Line items and linked shipment inventory transactions will be removed.",
    );
    if (!ok) return;
    setDeletingOrder(true);
    setError(null);
    try {
      const { data: lineRows, error: lineErr } = await supabase
        .from("sales_order_lines")
        .select("id")
        .eq("sales_order_id", orderId);
      if (lineErr) throw new Error(lineErr.message);
      const lineIds = (lineRows ?? []).map((r: { id: string }) => r.id);
      if (lineIds.length > 0) {
        const { error: txErr } = await supabase
          .from("inventory_transactions")
          .delete()
          .eq("reference_table", "sales_order_lines")
          .in("reference_id", lineIds);
        if (txErr) throw new Error(txErr.message);
      }
      const { error: delErr } = await supabase
        .from("sales_orders")
        .delete()
        .eq("id", orderId)
        .eq("company_id", activeCompanyId);
      if (delErr) throw new Error(delErr.message);
      setShowEditor(false);
      setEditingOrderId(null);
      await loadAll(activeCompanyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeletingOrder(false);
    }
  };

  const saveSale = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSavingOrder(true);
    setError(null);

    const addrPayload = {
      address_line1: addrLine1.trim() || null,
      address_line2: addrLine2.trim() || null,
      city: addrCity.trim() || null,
      state: addrState.trim() || null,
      postal_code: addrPostal.trim() || null,
      country: addrCountry.trim() || null,
    };

    // Customer selection / creation
    let customerId = selectedCustomerId;
    if (!customerId) {
      const name = newCustomerName.trim();
      if (!name) {
        setError("Select a customer, or enter a new customer name.");
        setSavingOrder(false);
        return;
      }
      const { data: cust, error: custErr } = await supabase
        .from("customers")
        .insert({
          company_id: activeCompanyId,
          name,
          email: newCustomerEmail.trim() || null,
          phone: newCustomerPhone.trim() || null,
          ...addrPayload,
        })
        .select("id")
        .single();
      if (custErr || !cust) {
        setError(custErr?.message ?? "Failed to create customer.");
        setSavingOrder(false);
        return;
      }
      customerId = cust.id as string;
    } else {
      const { error: addrErr } = await supabase
        .from("customers")
        .update(addrPayload)
        .eq("id", customerId)
        .eq("company_id", activeCompanyId);
      if (addrErr) {
        setError(addrErr.message);
        setSavingOrder(false);
        return;
      }
    }

    const shipFee = shippingFee.trim() ? parseFloat(shippingFee) : null;
    if (shippingFee.trim() && (shipFee == null || Number.isNaN(shipFee) || shipFee < 0)) {
      setError("Shipping fee must be 0 or greater.");
      setSavingOrder(false);
      return;
    }

    const cleaned = editLines
      .map((l) => ({
        ...l,
        quantityNum: parseFloat(l.quantity) || 0,
        unitPriceNum: parseFloat(l.unit_price) || 0,
      }))
      .filter(
        (l) => lineHasBusinessContent(l) && l.quantityNum !== 0,
      );

    if (cleaned.length === 0) {
      setError("Add at least one line item.");
      setSavingOrder(false);
      return;
    }

    // Warn for unknown SKUs
    const anyMissingItem = cleaned.some((l) => !l.item_id);
    if (anyMissingItem) {
      const ok = confirm(
        "Some lines do not match an existing SKU. Those lines will be saved without an item link and will not affect inventory on ship. Continue?",
      );
      if (!ok) {
        setSavingOrder(false);
        return;
      }
    }

    const {
      data: authData,
    } = await supabase.auth.getUser();

    const saleDateOut = saleDate.trim() || null;
    let shipDateOut = shipDate.trim() || null;
    if (!editingOrderId && shipNow && !shipDateOut) {
      shipDateOut = saleDateOut ?? todayLocalISODate();
    } else if (editingOrderId && status === "shipped" && !shipDateOut) {
      shipDateOut = saleDateOut ?? todayLocalISODate();
    }

    const soParsed = parseSoNumberInput(soNumberInput);
    if (soParsed === "invalid") {
      setError("SO number must be a non-negative whole number, or leave empty for auto number.");
      setSavingOrder(false);
      return;
    }
    const soForSave = soParsed === "auto" ? null : soParsed.n;
    if (editingOrderId && soForSave === null) {
      setError("SO number is required when editing a sale.");
      setSavingOrder(false);
      return;
    }

    // Upsert order
    let orderId = editingOrderId;
    let createdNewOrder = false;
    if (!orderId) {
      const { data: orderRow, error: oErr } = await supabase
        .from("sales_orders")
        .insert({
          company_id: activeCompanyId,
          customer_id: customerId,
          order_type: "sale",
          so_number: soForSave,
          status: shipNow ? "shipped" : status,
          po_number: poNumber.trim() || null,
          order_notes: orderNotes.trim() || null,
          is_local_sale: isLocalSale,
          shipping_fee: isLocalSale ? 0 : shipFee,
          sale_date: saleDateOut,
          ship_date: shipDateOut,
          created_by: authData?.user?.id ?? null,
        })
        .select("id")
        .single();
      if (oErr || !orderRow) {
        setError(oErr?.message ?? "Failed to create sale.");
        setSavingOrder(false);
        return;
      }
      orderId = orderRow.id as string;
      createdNewOrder = true;
    } else {
      const { error: uErr } = await supabase
        .from("sales_orders")
        .update({
          customer_id: customerId,
          status,
          so_number: soForSave,
          po_number: poNumber.trim() || null,
          order_notes: orderNotes.trim() || null,
          is_local_sale: isLocalSale,
          shipping_fee: isLocalSale ? 0 : shipFee,
          sale_date: saleDateOut,
          ship_date: shipDateOut,
        })
        .eq("id", orderId);
      if (uErr) {
        setError(uErr.message);
        setSavingOrder(false);
        return;
      }
    }

    // Upsert lines: simple approach for now—delete existing and re-insert.
    // (Keeps logic straightforward; we can optimize later.)
    await supabase.from("sales_order_lines").delete().eq("sales_order_id", orderId);

    const inserting = cleaned.map((l) => {
      const shippedQty =
        shipNow && !editingOrderId
          ? l.quantityNum
          : Math.max(0, parseFloat(l.shipped_quantity) || 0);
      return {
        sales_order_id: orderId,
        // Legacy DBs enforce NOT NULL on `so_id`; keep in sync with sales_order_id.
        so_id: orderId,
        item_id: l.item_id,
        sku_text: l.sku_text.trim() || null,
        description: l.description.trim() || null,
        quantity: l.quantityNum,
        ordered_qty: l.quantityNum,
        shipped_quantity: shippedQty,
        unit_price: l.unitPriceNum,
        unit_cost: l.unit_cost,
      };
    });

    const { data: newLines, error: insErr } = await supabase
      .from("sales_order_lines")
      .insert(inserting)
      .select("id, item_id, shipped_quantity, quantity, unit_cost");
    if (insErr) {
      if (createdNewOrder && orderId) {
        await supabase.from("sales_orders").delete().eq("id", orderId);
      }
      setError(insErr.message);
      setSavingOrder(false);
      return;
    }

    // If shipping now for new orders, deduct inventory
    if (shipNow && !editingOrderId) {
      const txPayload: any[] = [];
      const { data: locs } = await supabase
        .from("locations")
        .select("id")
        .eq("company_id", activeCompanyId)
        .limit(1);
      const locationId = (locs ?? [])[0]?.id;
      for (const l of newLines ?? []) {
        if (!l.item_id) continue;
        const shippedQty = Number(l.shipped_quantity ?? 0);
        if (!shippedQty) continue;
        txPayload.push({
          company_id: activeCompanyId,
          item_id: l.item_id,
          location_id: locationId ?? null,
          qty_change: -shippedQty,
          transaction_type: "sale_shipment",
          unit_cost: l.unit_cost ?? null,
          landed_unit_cost: l.unit_cost ?? null,
          reference_table: "sales_order_lines",
          reference_id: l.id,
          created_by: authData?.user?.id ?? null,
        });
      }
      if (txPayload.length > 0) {
        const { error: txErr } = await supabase
          .from("inventory_transactions")
          .insert(txPayload);
        if (txErr) {
          setError(txErr.message);
          setSavingOrder(false);
          return;
        }
      }
    }

    setSavingOrder(false);
    setSkuMenuPos(null);
    setShowEditor(false);
    setEditingOrderId(null);
    await loadAll(activeCompanyId);
  };

  const closeSaleEditor = () => {
    setSkuMenuPos(null);
    setEditLines((prev) =>
      prev.map((l) => ({
        ...l,
        skuLookupOpen: false,
        skuMatches: [],
        skuLoading: false,
      })),
    );
    setShowEditor(false);
    setSoNumberInput("");
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-emerald-300">Sales</h2>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] text-slate-400">
          Sales orders by customer (sale only)
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/sales/customers"
            className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900"
          >
            Customers
          </Link>
          <button
            type="button"
            onClick={openNewSale}
            className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-800/80"
          >
            Add sale
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading sales…</div>
      ) : (
        <div className="overflow-hidden rounded border border-slate-800 bg-black/30">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-normal">Customer</th>
                <th className="px-3 py-2 font-normal text-right">SO #</th>
                <th className="px-3 py-2 font-normal text-right">Total price</th>
                <th className="px-3 py-2 font-normal text-right">Total cost</th>
                <th className="px-3 py-2 font-normal">Sale date</th>
                <th className="px-3 py-2 font-normal">Ship date</th>
                <th className="px-3 py-2 font-normal text-right"># Items</th>
                <th className="px-3 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {orderRowsForTable.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-slate-500">
                    No sales yet.
                  </td>
                </tr>
              ) : (
                orderRowsForTable.map((r) => (
                  <tr
                    key={r.order.id}
                    className="cursor-pointer border-t border-slate-900/70 hover:bg-slate-900/40"
                    onClick={() => openEditSale(r.order.id)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-slate-100">
                          {r.customer?.name ?? "—"}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          PO: {r.order.po_number ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                      {r.order.so_number != null && r.order.so_number !== ""
                        ? String(r.order.so_number)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-100">
                      ${r.totalPrice.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                      ${r.totalCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {new Date(
                        (r.order.sale_date ?? r.order.created_at.slice(0, 10)) +
                          "T12:00:00",
                      ).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {r.order.ship_date
                        ? new Date(
                            String(r.order.ship_date).slice(0, 10) + "T12:00:00",
                          ).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                      {r.itemCount}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {formatStatus(r.order.status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showEditor && (
        <>
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[min(92vh,56rem)] w-full max-w-5xl overflow-y-auto rounded border border-slate-800 bg-slate-950 p-4 text-slate-200 shadow-2xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-emerald-200">
                  {editingOrderId ? "Edit sale" : "New sale"}
                </div>
                <div className="text-[11px] text-slate-500">
                  Type a customer name to search, and type a SKU to search items.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {editingOrderId && canManageSales && (
                  <button
                    type="button"
                    onClick={() => void deleteSaleOrder(editingOrderId)}
                    disabled={deletingOrder || savingOrder}
                    className="rounded border border-red-800 bg-red-950/40 px-2 py-1 text-xs text-red-200 hover:bg-red-900/60 disabled:opacity-50"
                  >
                    {deletingOrder ? "Deleting…" : "Delete sale"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeSaleEditor}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-900"
                >
                  Close
                </button>
              </div>
            </div>

            <form onSubmit={saveSale} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
                  <label className="block text-[11px] text-slate-400">
                    Customer
                  </label>
                  <div className="relative">
                    <input
                      value={customerQuery}
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        setSelectedCustomerId(null);
                      }}
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      placeholder="Search name, email, phone, or address…"
                    />
                    {customerMatches.length > 0 && !selectedCustomerId && (
                      <div className="absolute z-30 mt-1 w-full overflow-hidden rounded border border-slate-700 bg-slate-950 shadow-xl">
                        {customerMatches.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomerId(c.id);
                              setCustomerQuery(c.name);
                              setCustomerMatches([]);
                            }}
                            className="block w-full px-2 py-2 text-left text-sm hover:bg-slate-900"
                          >
                            <div className="text-slate-100">{c.name}</div>
                            <div className="text-[11px] text-slate-500">
                              {(c.email ?? "").trim() || "—"} ·{" "}
                              {(c.phone ?? "").trim() || "—"}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {!selectedCustomerId && (
                    <div className="mt-2 grid gap-2 rounded border border-slate-800 bg-black/20 p-3 md:grid-cols-3">
                      <div className="md:col-span-3 text-[11px] font-medium text-slate-300">
                        New customer (if no match)
                      </div>
                      <div className="md:col-span-1">
                        <label className="block text-[11px] text-slate-500">
                          Name
                        </label>
                        <input
                          value={newCustomerName}
                          onChange={(e) => setNewCustomerName(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          placeholder="Customer name"
                        />
                      </div>
                      <div className="md:col-span-1">
                        <label className="block text-[11px] text-slate-500">
                          Email
                        </label>
                        <input
                          value={newCustomerEmail}
                          onChange={(e) =>
                            setNewCustomerEmail(e.target.value)
                          }
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          placeholder="Optional"
                        />
                      </div>
                      <div className="md:col-span-1">
                        <label className="block text-[11px] text-slate-500">
                          Phone
                        </label>
                        <input
                          value={newCustomerPhone}
                          onChange={(e) =>
                            setNewCustomerPhone(e.target.value)
                          }
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-2 rounded border border-slate-800 bg-black/20 p-3 space-y-2">
                    <div className="text-[11px] font-medium text-slate-300">
                      Customer address
                      {selectedCustomerId && (
                        <span className="ml-2 font-normal text-slate-500">
                          (saved to customer when you save the sale)
                        </span>
                      )}
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500">Address line 1</label>
                      <input
                        value={addrLine1}
                        onChange={(e) => setAddrLine1(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500">Address line 2</label>
                      <input
                        value={addrLine2}
                        onChange={(e) => setAddrLine2(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <label className="block text-[11px] text-slate-500">City</label>
                        <input
                          value={addrCity}
                          onChange={(e) => setAddrCity(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500">State / Province</label>
                        <input
                          value={addrState}
                          onChange={(e) => setAddrState(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500">Postal code</label>
                        <input
                          value={addrPostal}
                          onChange={(e) => setAddrPostal(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500">Country</label>
                        <input
                          value={addrCountry}
                          onChange={(e) => setAddrCountry(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400">
                        Sale date
                      </label>
                      <input
                        type="date"
                        value={saleDate}
                        onChange={(e) => setSaleDate(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400">
                        Ship date
                      </label>
                      <input
                        type="date"
                        value={shipDate}
                        onChange={(e) => setShipDate(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                  <label className="block text-[11px] text-slate-400">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    disabled={!editingOrderId && shipNow}
                  >
                    <option value="new">New Order</option>
                    <option value="in_progress">In Progress</option>
                    <option value="back_order">Back Order</option>
                    <option value="shipped">Shipped</option>
                    <option value="completed">Completed</option>
                  </select>

                  {!editingOrderId && (
                    <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={shipNow}
                        onChange={(e) => setShipNow(e.target.checked)}
                      />
                      Ship now (deduct inventory)
                    </label>
                  )}

                  <div className="mt-2 grid gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500">
                        SO number
                      </label>
                      <input
                        value={soNumberInput}
                        onChange={(e) => setSoNumberInput(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm tabular-nums"
                        placeholder={editingOrderId ? undefined : "Auto if empty"}
                        inputMode="numeric"
                      />
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {editingOrderId
                          ? "Edit the numeric order number for this company."
                          : "Suggested next # is prefilled; clear to assign automatically."}
                      </p>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500">
                        PO number
                      </label>
                      <input
                        value={poNumber}
                        onChange={(e) => setPoNumber(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500">
                        Notes
                      </label>
                      <textarea
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                        className="mt-1 h-20 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="rounded border border-slate-800 bg-black/20 p-2">
                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                        <input
                          type="checkbox"
                          checked={isLocalSale}
                          onChange={(e) => setIsLocalSale(e.target.checked)}
                        />
                        Local Sale (no shipping)
                      </label>
                      {!isLocalSale && (
                        <div className="mt-2">
                          <label className="block text-[11px] text-slate-500">
                            Shipping fee
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={shippingFee}
                            onChange={(e) => setShippingFee(e.target.value)}
                            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto overflow-y-visible rounded border border-slate-800 bg-black/20">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-900/70 text-slate-400">
                    <tr>
                      <th className="px-2 py-2 font-normal w-[5.5rem]">
                        Qty
                      </th>
                      <th className="px-2 py-2 font-normal w-[10rem]">SKU</th>
                      <th className="px-2 py-2 font-normal">Description</th>
                      <th className="px-2 py-2 font-normal w-[8rem] text-right">
                        Unit price
                      </th>
                      <th className="px-2 py-2 font-normal w-[9rem] text-right">
                        Sale value
                      </th>
                      <th className="px-2 py-2 font-normal w-[9rem] text-right">
                        Cost (unit)
                      </th>
                      <th className="px-2 py-2 font-normal w-[9rem] text-right">
                        Cost (line)
                      </th>
                      <th className="px-2 py-2 font-normal w-[7rem] text-right">
                        Shipped
                      </th>
                      <th className="px-2 py-2 font-normal w-[3rem]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editLines.map((l, idx) => {
                      const q = parseFloat(l.quantity) || 0;
                      const p = parseFloat(l.unit_price) || 0;
                      const lineValue = q * p;
                      const lineCost =
                        l.unit_cost != null ? q * Number(l.unit_cost) : null;
                      return (
                        <tr
                          key={l.id}
                          className="border-t border-slate-900/70"
                        >
                          <td className="px-2 py-1">
                            <input
                              type="number"
                              step="1"
                              value={l.quantity}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditLines((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], quantity: v };
                                  return next;
                                });
                                ensureTrailingBlankLine();
                              }}
                              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1 align-top">
                            <div className="relative" data-sale-sku-input>
                              <input
                                id={`sale-line-sku-${l.id}`}
                                value={l.sku_text}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setEditLines((prev) => {
                                    const next = [...prev];
                                    next[idx] = {
                                      ...next[idx],
                                      sku_text: v,
                                      item_id: null,
                                      skuLookupOpen: true,
                                    };
                                    return next;
                                  });
                                  lookupItemsBySku(idx, v);
                                  ensureTrailingBlankLine();
                                }}
                                onFocus={() => {
                                  if (l.sku_text.trim()) lookupItemsBySku(idx, l.sku_text);
                                }}
                                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono"
                                placeholder="SKU, name, description…"
                                autoComplete="off"
                              />
                            </div>
                          </td>
                          <td className="px-2 py-1 align-top min-w-[14rem]">
                            <textarea
                              value={l.description}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditLines((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], description: v };
                                  return next;
                                });
                                ensureTrailingBlankLine();
                              }}
                              rows={4}
                              className="w-full min-h-[5.5rem] resize-y rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm leading-snug"
                              placeholder="Description"
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={l.unit_price}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditLines((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], unit_price: v };
                                  return next;
                                });
                                ensureTrailingBlankLine();
                              }}
                              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-right tabular-nums"
                            />
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-100">
                            ${lineValue.toFixed(2)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-300">
                            {l.unit_cost != null ? `$${Number(l.unit_cost).toFixed(4)}` : "—"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-300">
                            {lineCost != null ? `$${lineCost.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="number"
                              step="1"
                              value={l.shipped_quantity}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditLines((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], shipped_quantity: v };
                                  return next;
                                });
                              }}
                              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-right tabular-nums"
                              placeholder={editingOrderId ? "0" : shipNow ? l.quantity : "0"}
                              disabled={!editingOrderId}
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setEditLines((prev) =>
                                  prev.length <= 1
                                    ? [emptyLine()]
                                    : prev.filter((_, i) => i !== idx),
                                )
                              }
                              className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-900"
                            >
                              X
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] text-slate-500">
                  Tip: typing an unknown SKU will save, but won’t ship inventory.
                </div>
                <div className="text-right text-xs text-slate-300 tabular-nums">
                  <div>Subtotal: ${editorTotals.subtotal.toFixed(2)}</div>
                  <div>Shipping: ${editorTotals.shipping.toFixed(2)}</div>
                  <div className="text-slate-100 font-medium">
                    Total: ${editorTotals.total.toFixed(2)}
                  </div>
                  <div className="text-slate-400">
                    Total cost: ${editorTotals.totalCost.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeSaleEditor}
                  className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOrder || deletingOrder}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {savingOrder ? "Saving…" : "Save sale"}
                </button>
              </div>
            </form>
          </div>
        </div>
        {typeof document !== "undefined" &&
          skuMenuPos != null &&
          (() => {
            const menuRow = editLines.find((l) => l.id === skuMenuPos.lineId);
            if (
              !menuRow ||
              !menuRow.skuLookupOpen ||
              (!menuRow.skuLoading && menuRow.skuMatches.length === 0)
            ) {
              return null;
            }
            const lineIndex = editLines.findIndex((l) => l.id === skuMenuPos.lineId);
            if (lineIndex < 0) return null;
            return createPortal(
              <div
                data-sale-sku-menu
                className="fixed z-[9999] max-h-60 overflow-y-auto rounded border border-slate-700 bg-slate-950 py-1 shadow-2xl"
                style={{
                  top: skuMenuPos.top,
                  left: skuMenuPos.left,
                  width: skuMenuPos.width,
                  maxWidth: "min(24rem, calc(100vw - 1rem))",
                }}
              >
                {menuRow.skuLoading ? (
                  <div className="px-3 py-2 text-xs text-slate-500">
                    Searching…
                  </div>
                ) : (
                  menuRow.skuMatches.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => selectItemForLine(lineIndex, it)}
                      className="block w-full px-3 py-2 text-left hover:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-sm text-emerald-300">
                          {it.sku}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-500">
                          {it.sale_price != null
                            ? `$${Number(it.sale_price).toFixed(2)}`
                            : ""}
                        </span>
                      </div>
                      {it.name ? (
                        <div className="mt-0.5 text-xs text-slate-200">
                          {it.name}
                        </div>
                      ) : null}
                      {it.description ? (
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
                          {it.description}
                        </div>
                      ) : null}
                    </button>
                  ))
                )}
              </div>,
              document.body,
            );
          })()}
        </>
      )}

      <div className="text-[11px] text-slate-500">
        Inventory is deducted when you ship a sale (negative inventory allowed).
      </div>

      <div className="text-[11px] text-slate-500">
        Trades are coming next (company setting: enable trades).
      </div>
    </div>
  );
}

