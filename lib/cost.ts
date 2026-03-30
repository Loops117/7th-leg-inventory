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
  // average: include all transactions with unit_cost (incl. adjustments with negative qty)
  // so that "reset cost" (adjustment to 0 with unit_cost 0) can bring totalQty to 0
  const withCost = transactions.filter((t) => t.unit_cost != null);
  let totalCost = 0;
  let totalQty = 0;
  for (const t of withCost) {
    totalCost += (t.unit_cost ?? 0) * t.qty_change;
    totalQty += t.qty_change;
  }
  return totalQty > 0 ? totalCost / totalQty : null;
}
