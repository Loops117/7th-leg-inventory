import type { SupabaseClient } from "@supabase/supabase-js";
import { getCostFromTransactions, type CostType } from "@/lib/cost";

/** Build finished goods from procedure BOM: consume inputs, add outputs (same cost model as work order completion). */
export async function assembleFromProcedure(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    outputItemId: string;
    procedureId: string;
    /** Completes `buildCount` batches (each yields `procedure.output_quantity` output units). */
    buildCount: number;
    outputLocationId: string;
    inputLocationId: string;
  },
  opts: {
    costType: CostType;
    useLandedCost: boolean;
    userId: string | null;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const {
    companyId,
    outputItemId,
    procedureId,
    buildCount,
    outputLocationId,
    inputLocationId,
  } = params;

  const bc = Number(buildCount);
  if (!bc || bc <= 0 || !Number.isFinite(bc))
    return { ok: false, message: "Enter a valid quantity to assemble." };

  const { data: procRaw, error: procErr } = await supabase
    .from("procedures")
    .select("id, output_item_id, output_quantity")
    .eq("id", procedureId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (procErr || !procRaw)
    return { ok: false, message: procErr?.message ?? "Procedure not found." };

  const proc = procRaw as {
    output_item_id: string | null;
    output_quantity: number | null;
  };
  if (proc.output_item_id !== outputItemId)
    return { ok: false, message: "This procedure does not build this item." };

  const outPerBatch = Number(proc.output_quantity ?? 0);
  if (!outPerBatch || outPerBatch <= 0)
    return { ok: false, message: "Procedure has no output quantity defined." };

  const totalOutput = outPerBatch * bc;
  if (totalOutput <= 0)
    return { ok: false, message: "Nothing would be produced." };

  const { data: inputs, error: inErr } = await supabase
    .from("procedure_items")
    .select("item_id, quantity_required")
    .eq("procedure_id", procedureId);

  if (inErr)
    return { ok: false, message: inErr.message };

  const inputRows =
    (inputs as { item_id: string; quantity_required: number }[] | null) ?? [];

  const { costType, useLandedCost: useLanded, userId } = opts;

  let mergedCostTotal = 0;

  for (const input of inputRows) {
    const qtyConsumed =
      (Number(input.quantity_required ?? 0) || 0) * bc;
    if (!(qtyConsumed > 0)) continue;

    const { data: txs } = await supabase
      .from("inventory_transactions")
      .select("qty_change, unit_cost, landed_unit_cost")
      .eq("item_id", input.item_id)
      .in("transaction_type", [
        "purchase_receipt",
        "work_order_completion",
        "inventory_adjustment",
      ])
      .order("created_at", { ascending: true });

    const txList =
      (txs as {
        qty_change: number;
        unit_cost: number | null;
        landed_unit_cost?: number | null;
      }[] | null) ?? [];
    const mapped = txList.map((t) => ({
      unit_cost:
        useLanded && t.landed_unit_cost != null
          ? t.landed_unit_cost
          : t.unit_cost,
      qty_change: t.qty_change,
    }));

    const unitCost = getCostFromTransactions(mapped, costType) ?? 0;
    mergedCostTotal += qtyConsumed * unitCost;

    const { error: conErr } = await supabase.from("inventory_transactions").insert({
      company_id: companyId,
      item_id: input.item_id,
      location_id: inputLocationId,
      qty_change: -qtyConsumed,
      transaction_type: "work_order_completion",
      unit_cost: unitCost,
      landed_unit_cost: useLanded ? unitCost : null,
      reference_table: "procedures",
      reference_id: procedureId,
      created_by: userId ?? null,
    });

    if (conErr)
      return { ok: false, message: conErr.message };
  }

  const unitOutputCost =
    totalOutput > 0 && mergedCostTotal > 0
      ? mergedCostTotal / totalOutput
      : null;

  const { error: posErr } = await supabase.from("inventory_transactions").insert({
    company_id: companyId,
    item_id: outputItemId,
    location_id: outputLocationId,
    qty_change: totalOutput,
    transaction_type: "work_order_completion",
    unit_cost: unitOutputCost,
    landed_unit_cost: useLanded ? unitOutputCost : null,
    reference_table: "procedures",
    reference_id: procedureId,
    created_by: userId ?? null,
  });

  if (posErr)
    return { ok: false, message: posErr.message };

  return { ok: true };
}
