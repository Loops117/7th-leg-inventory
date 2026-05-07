/**
 * Cost is calculated from inventory_transactions (purchase_receipt) with unit_cost.
 * company_settings.cost_type: average | first | set | last
 */

export type CostType = "average" | "first" | "set" | "last";

export function getCostFromTransactions(
  transactions: { unit_cost: number | null; qty_change: number }[],
  costType: CostType
): number | null {
  // For first/last/set we only consider positive (incoming) transactions
  const withCostPositive = transactions.filter(
    (t) => t.unit_cost != null && t.qty_change > 0
  );
  if (withCostPositive.length === 0 && costType !== "average") return null;

  if (costType === "first") {
    const first = withCostPositive[0];
    return first?.unit_cost ?? null;
  }
  if (costType === "last") {
    const last = withCostPositive[withCostPositive.length - 1];
    return last?.unit_cost ?? null;
  }
  if (costType === "set") {
    const last = withCostPositive[withCostPositive.length - 1];
    return last?.unit_cost ?? null;
  }
  // average: keep the last known moving-average cost even when on-hand qty reaches 0.
  // This prevents display cost from being wiped by depletion and allows the next
  // positive receipt to recalculate from fresh incoming cost.
  let onHandQty = 0;
  let avgCost: number | null = null;
  for (const t of transactions) {
    const qty = Number(t.qty_change ?? 0);
    if (!qty) continue;
    const unitCost = t.unit_cost != null ? Number(t.unit_cost) : null;
    if (qty > 0) {
      // Incoming inventory with known cost: update weighted moving average.
      if (unitCost != null) {
        if (onHandQty <= 0 || avgCost == null) {
          avgCost = unitCost;
          onHandQty = qty;
        } else {
          const nextQty = onHandQty + qty;
          avgCost = ((avgCost * onHandQty) + (unitCost * qty)) / nextQty;
          onHandQty = nextQty;
        }
      } else {
        onHandQty += qty;
      }
    } else {
      onHandQty += qty;
      if (onHandQty < 0) onHandQty = 0;
    }
  }
  return avgCost;
}
