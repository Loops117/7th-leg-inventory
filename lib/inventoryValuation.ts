import { getCostFromTransactions, type CostType } from "@/lib/cost";

export type InvTxRow = {
  item_id: string;
  qty_change: number;
  unit_cost: number | null;
  landed_unit_cost?: number | null;
  created_at: string;
  transaction_type?: string;
};

/** End of local calendar day for `yyyy-mm-dd`. */
export function endOfLocalDayIso(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return end.toISOString();
}

export function filterTxsThroughDate(
  txs: InvTxRow[],
  throughIso: string,
): InvTxRow[] {
  const cutoff = new Date(throughIso).getTime();
  return txs.filter((t) => new Date(t.created_at).getTime() <= cutoff);
}

export function qtyFromTxs(txs: InvTxRow[]): number {
  return txs.reduce((s, t) => s + Number(t.qty_change ?? 0), 0);
}

export function unitCostFromTxs(
  txs: InvTxRow[],
  costType: CostType,
  useLanded: boolean,
): number | null {
  const mapped = txs.map((t) => ({
    qty_change: Number(t.qty_change ?? 0),
    unit_cost:
      useLanded && t.landed_unit_cost != null
        ? t.landed_unit_cost
        : t.unit_cost,
  }));
  return getCostFromTransactions(mapped, costType);
}

export function computeInventoryRollupForItems(options: {
  itemIds: string[];
  txsByItem: Map<string, InvTxRow[]>;
  costType: CostType;
  useLanded: boolean;
  salePriceByItem: Record<string, number | null>;
  throughIso: string;
}): {
  totalQty: number;
  totalCostExtended: number;
  totalValueExtended: number;
  perItem: Record<
    string,
    { qty: number; unitCost: number | null; valueExtended: number }
  >;
} {
  const perItem: Record<
    string,
    { qty: number; unitCost: number | null; valueExtended: number }
  > = {};
  let totalQty = 0;
  let totalCostExtended = 0;
  let totalValueExtended = 0;

  for (const id of options.itemIds) {
    const raw = options.txsByItem.get(id) ?? [];
    const sliced = filterTxsThroughDate(raw, options.throughIso);
    const qty = qtyFromTxs(sliced);
    const unitCost = unitCostFromTxs(sliced, options.costType, options.useLanded);
    const price = options.salePriceByItem[id] ?? null;
    const valueExtended =
      price != null && Number.isFinite(price) ? qty * price : 0;
    const costExt =
      unitCost != null && Number.isFinite(unitCost) ? qty * unitCost : 0;

    perItem[id] = {
      qty,
      unitCost,
      valueExtended,
    };
    totalQty += qty;
    totalCostExtended += costExt;
    totalValueExtended += valueExtended;
  }

  return {
    totalQty,
    totalCostExtended,
    totalValueExtended,
    perItem,
  };
}
