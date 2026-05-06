import type { SupabaseClient } from "@supabase/supabase-js";

/** Receiving orders list; retries without tracking_number when the column is missing (migration not applied). */
export async function fetchReceivingOrdersForCompany(
  supabase: SupabaseClient,
  companyId: string,
): Promise<
  | { ok: true; rows: ReceivingOrderRow[] }
  | { ok: false; message: string }
> {
  const withTn = await supabase
    .from("receiving_orders")
    .select("id, company_id, status, tracking_number, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (!withTn.error && withTn.data) {
    return { ok: true, rows: withTn.data as ReceivingOrderRow[] };
  }

  const msg = (withTn.error?.message ?? "").toLowerCase();
  const code = withTn.error?.code ?? "";
  if (
    code === "42703" ||
    msg.includes("tracking_number") ||
    (msg.includes("column") && msg.includes("does not exist"))
  ) {
    const noTn = await supabase
      .from("receiving_orders")
      .select("id, company_id, status, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (noTn.error)
      return { ok: false, message: noTn.error.message };

    const rows = ((noTn.data ?? []) as Omit<ReceivingOrderRow, "tracking_number">[]).map(
      (r) =>
        ({
          ...r,
          tracking_number: null,
        }) as ReceivingOrderRow,
    );
    return { ok: true, rows };
  }

  return { ok: false, message: withTn.error!.message };
}

/** First open receiving order for the company (for Purchasing inbound panel). */
export async function fetchOpenReceivingOrderWithOptionalTracking(
  supabase: SupabaseClient,
  companyId: string,
): Promise<
  | { ok: true; order: Pick<ReceivingOrderRow, "id" | "tracking_number"> | null }
  | { ok: false; message: string }
> {
  const withTn = await supabase
    .from("receiving_orders")
    .select("id, tracking_number")
    .eq("company_id", companyId)
    .eq("status", "open")
    .limit(1);

  if (!withTn.error) {
    const row =
      (withTn.data?.[0] as Pick<ReceivingOrderRow, "id" | "tracking_number"> | undefined) ??
      null;
    return { ok: true, order: row };
  }

  const msg = (withTn.error?.message ?? "").toLowerCase();
  const code = withTn.error?.code ?? "";
  if (
    code === "42703" ||
    msg.includes("tracking_number") ||
    (msg.includes("column") && msg.includes("does not exist"))
  ) {
    const noTn = await supabase
      .from("receiving_orders")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "open")
      .limit(1);

    if (noTn.error) return { ok: false, message: noTn.error.message };
    const id = (noTn.data?.[0] as { id: string } | undefined)?.id;
    return id
      ? { ok: true, order: { id, tracking_number: null } }
      : { ok: true, order: null };
  }

  return { ok: false, message: withTn.error.message };
}

export type ReceivingOrderRow = {
  id: string;
  company_id: string;
  status: string;
  tracking_number: string | null;
  created_at: string;
};
