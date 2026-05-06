import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase/PostgREST returns at most 1000 rows per request by default unless you paginate with .range().
 */
export const SUPABASE_PAGE_SIZE = 1000;

/** Split an array into fixed-size chunks (e.g. for large .in() filters). */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type RangeQueryResult<R> = { data: R[] | null; error: { message: string } | null };

/** Fetch every row matching a stable-ordered PostgREST query using .range. */
export async function fetchAllInPages<R>(
  runPage: (from: number, to: number) => PromiseLike<RangeQueryResult<R>>,
): Promise<{ rows: R[]; error: { message: string } | null }> {
  const rows: R[] = [];
  let from = 0;
  for (;;) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await runPage(from, to);
    if (error) return { rows, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return { rows, error: null };
}

/** SKU → item id map for the active company (all pages). */
export async function fetchAllItemsSkuToIdMap(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{ map: Map<string, string>; error: string | null }> {
  const { rows, error } = await fetchAllInPages<{ id: string; sku: string }>((from, to) =>
    supabase.from("items").select("id, sku").eq("company_id", companyId).order("sku").range(from, to),
  );
  if (error) return { map: new Map(), error: error.message };
  return {
    map: new Map(rows.map((r) => [String(r.sku), String(r.id)])),
    error: null,
  };
}

/** Lowercase location code → location id map (all pages). */
export async function fetchAllLocationsCodeToIdMap(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{ map: Map<string, string>; error: string | null }> {
  const { rows, error } = await fetchAllInPages<{ id: string; code: string }>((from, to) =>
    supabase.from("locations").select("id, code").eq("company_id", companyId).order("code").range(from, to),
  );
  if (error) return { map: new Map(), error: error.message };
  return {
    map: new Map(rows.map((r) => [String(r.code).toLowerCase(), String(r.id)])),
    error: null,
  };
}
