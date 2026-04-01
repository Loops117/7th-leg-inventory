"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type ImportTab =
  | "items"
  | "items_export"
  | "buying_options"
  | "locations"
  | "procedures"
  | "work_orders"
  | "purchases";

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cell.trim());
        cell = "";
      } else if (c === "\r" || c === "\n") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell.trim());
        cell = "";
        if (row.some((x) => x)) rows.push(row);
        row = [];
      } else {
        cell += c;
      }
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some((x) => x)) rows.push(row);
  }
  return rows;
}

function downloadCSV(rows: string[][], filename: string) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const c = cell ?? "";
          if (/[",\r\n]/.test(c)) {
            return `"${c.replace(/"/g, '""')}"`;
          }
          return c;
        })
        .join(","),
    )
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const ITEM_COLS = ["sku", "name", "description", "item_type", "sale_price"];
const BUYING_OPT_COLS = [
  "sku",
  "vendor_company_name",
  "url",
  "standard_buy_quantity",
  "pieces_per_pack",
  "qty_buying_trigger",
  "is_default",
];
const LOCATION_COLS = [
  "warehouse_code",
  "warehouse_name",
  "section_code",
  "section_name",
  "rack_code",
  "rack_name",
  "shelf_code",
  "shelf_name",
  "location_code",
  "location_name",
  "position",
];
const ITEM_EXPORT_COLS = [
  "sku",
  "name",
  "category",
  "product_type",
  "sale_price",
  "locations",
];
// One row per input item; a procedure with N inputs will appear on N rows
const PROCEDURE_COLS = [
  "procedure_code",
  "name",
  "tools_required",
  "steps",
  "output_item_sku",
  "output_quantity",
  "input_item_sku",
  "input_quantity",
  "is_active",
];
// One row per work order / procedure link
const WORK_ORDER_COLS = [
  "work_order_number",
  "name",
  "standard_quantity",
  "standard_time_minutes",
  "status",
  "procedure_code",
];

// One row per purchase line
const PURCHASE_COLS = [
  "po_number",
  "item_sku",
  "vendor_company_name",
  "vendor_url",
  "order_date",
  "expected_ship_date",
  "expected_arrival_date",
  "quantity_ordered",
  "quantity_received",
  "unit_cost",
  "location_code",
  "notes",
];

/** Export uses "ProductType" and "SellingPrice"; import expects product_type and sale_price. */
const ITEM_EXPORT_HEADER_ALIASES: Record<string, string[]> = {
  product_type: ["producttype"],
  sale_price: ["sellingprice"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/\s/g, "_");
}

export default function ImportPage() {
  const [tab, setTab] = useState<ImportTab>("items");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; errors: string[] } | null>(null);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);

  useEffect(() => {
    const active = loadActiveCompany();
    setActiveCompanyId(active?.id ?? null);
  }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setResult(null);
    if (!f) {
      setPreview([]);
      setHeaders([]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rows = parseCSV(text);
      setHeaders(rows[0] ?? []);
      setPreview(rows.slice(0, 11));
    };
    reader.readAsText(f, "UTF-8");
  }

  function rowToObj(row: string[], cols: string[]): Record<string, string> {
    const obj: Record<string, string> = {};
    cols.forEach((col) => {
      const normalizedCol = col.toLowerCase().replace(/\s/g, "_");
      const aliases = ITEM_EXPORT_HEADER_ALIASES[col];
      const idx = headers.findIndex((h) => {
        const norm = normalizeHeader(h);
        return norm === normalizedCol || h === col || (aliases && aliases.includes(norm));
      });
      obj[col] = row[idx] ?? "";
    });
    return obj;
  }

  async function handleImportItems(e: FormEvent) {
    e.preventDefault();
    if (!file || !activeCompanyId) return;
    setImporting(true);
    setResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const h = rows[0] ?? [];
    setHeaders(h);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));
    const errors: string[] = [];
    let ok = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const o = rowToObj(dataRows[i], ITEM_COLS);
      const sku = (o.sku ?? "").trim();
      if (!sku) continue;
      const { error } = await supabase.from("items").insert({
        company_id: activeCompanyId,
        sku,
        name: (o.name ?? "").trim() || null,
        description: (o.description ?? "").trim() || null,
        item_type: (o.item_type ?? "raw").trim() || "raw",
        sale_price: o.sale_price ? parseFloat(o.sale_price) : null,
      });
      if (error) errors.push(`Row ${i + 2}: ${error.message}`);
      else ok++;
    }
    setResult({ ok, errors });
    setImporting(false);
  }

  async function handleImportBuyingOptions(e: FormEvent) {
    e.preventDefault();
    if (!file || !activeCompanyId) return;
    setImporting(true);
    setResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const h = rows[0] ?? [];
    setHeaders(h);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));
    const errors: string[] = [];
    let ok = 0;
    const { data: companyItems } = await supabase.from("items").select("id, sku").eq("company_id", activeCompanyId);
    const skuToId = new Map((companyItems ?? []).map((x) => [x.sku, x.id]));
    for (let i = 0; i < dataRows.length; i++) {
      const o = rowToObj(dataRows[i], BUYING_OPT_COLS);
      const sku = (o.sku ?? "").trim();
      const itemId = skuToId.get(sku);
      if (!itemId) {
        errors.push(`Row ${i + 2}: Item SKU "${sku}" not found`);
        continue;
      }
      const { error } = await supabase.from("item_buying_options").insert({
        item_id: itemId,
        vendor_company_name: (o.vendor_company_name ?? "").trim() || null,
        url: (o.url ?? "").trim() || null,
        standard_buy_quantity: parseInt(o.standard_buy_quantity || "1", 10) || 1,
        pieces_per_pack: parseInt(o.pieces_per_pack || "1", 10) || 1,
        qty_buying_trigger: o.qty_buying_trigger ? parseInt(o.qty_buying_trigger, 10) : null,
        is_default: /^(1|true|yes)$/i.test((o.is_default ?? "").trim()),
      });
      if (error) errors.push(`Row ${i + 2}: ${error.message}`);
      else ok++;
    }
    setResult({ ok, errors });
    setImporting(false);
  }

  async function handleImportLocations(e: FormEvent) {
    e.preventDefault();
    if (!file || !activeCompanyId) return;
    setImporting(true);
    setResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const h = rows[0] ?? [];
    setHeaders(h);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));
    const errors: string[] = [];
    let ok = 0;
    const whByCode = new Map<string, string>();
    const secByKey = new Map<string, string>();
    const rackByKey = new Map<string, string>();
    const shelfByKey = new Map<string, string>();
    for (let i = 0; i < dataRows.length; i++) {
      const o = rowToObj(dataRows[i], LOCATION_COLS);
      const whCode = (o.warehouse_code ?? "").trim();
      const secCode = (o.section_code ?? "").trim();
      const rackCode = (o.rack_code ?? "").trim();
      const shelfCode = (o.shelf_code ?? "").trim();
      const locCode = (o.location_code ?? "").trim();
      if (!whCode) continue;
      let warehouseId = whByCode.get(whCode);
      if (!warehouseId) {
        const { data: existing } = await supabase.from("warehouses").select("id").eq("company_id", activeCompanyId).eq("code", whCode).maybeSingle();
        if (existing?.id) {
          const wid = existing.id;
          warehouseId = wid;
          whByCode.set(whCode, wid);
        } else {
          const { data: wh, error: insertErr } = await supabase.from("warehouses").insert({ company_id: activeCompanyId, code: whCode, name: (o.warehouse_name ?? "").trim() || null }).select("id").single();
          if (insertErr) {
            errors.push(`Row ${i + 2}: Warehouse ${whCode}: ${insertErr.message}`);
            continue;
          }
          warehouseId = wh?.id ?? "";
          if (warehouseId) whByCode.set(whCode, warehouseId);
        }
      }
      if (!secCode) continue;
      const secKey = `${warehouseId}:${secCode}`;
      let sectionId = secByKey.get(secKey);
      if (!sectionId) {
        const { data: existing } = await supabase.from("sections").select("id").eq("warehouse_id", warehouseId).eq("code", secCode).maybeSingle();
        if (existing?.id) {
          const sid = existing.id;
          sectionId = sid;
          secByKey.set(secKey, sid);
        } else {
          const { data: sec, error: insertErr } = await supabase.from("sections").insert({ warehouse_id: warehouseId, code: secCode, name: (o.section_name ?? "").trim() || null }).select("id").single();
          if (insertErr) {
            errors.push(`Row ${i + 2}: Section ${secCode}: ${insertErr.message}`);
            continue;
          }
          sectionId = sec?.id ?? "";
          if (sectionId) secByKey.set(secKey, sectionId);
        }
      }
      if (!rackCode) continue;
      const rackKey = `${sectionId}:${rackCode}`;
      let rackId = rackByKey.get(rackKey);
      if (!rackId) {
        const { data: existing } = await supabase.from("racks").select("id").eq("section_id", sectionId).eq("code", rackCode).maybeSingle();
        if (existing?.id) {
          const rid = existing.id;
          rackId = rid;
          rackByKey.set(rackKey, rid);
        } else {
          const { data: r, error: insertErr } = await supabase.from("racks").insert({ section_id: sectionId, code: rackCode, name: (o.rack_name ?? "").trim() || null }).select("id").single();
          if (insertErr) {
            errors.push(`Row ${i + 2}: Rack ${rackCode}: ${insertErr.message}`);
            continue;
          }
          rackId = r?.id ?? "";
          if (rackId) rackByKey.set(rackKey, rackId);
        }
      }
      if (!shelfCode) continue;
      const shelfKey = `${rackId}:${shelfCode}`;
      let shelfId = shelfByKey.get(shelfKey);
      if (!shelfId) {
        const { data: existing } = await supabase.from("shelves").select("id").eq("rack_id", rackId).eq("code", shelfCode).maybeSingle();
        if (existing?.id) {
          const shid = existing.id;
          shelfId = shid;
          shelfByKey.set(shelfKey, shid);
        } else {
          const { data: sh, error: insertErr } = await supabase.from("shelves").insert({ rack_id: rackId, code: shelfCode, name: (o.shelf_name ?? "").trim() || null }).select("id").single();
          if (insertErr) {
            errors.push(`Row ${i + 2}: Shelf ${shelfCode}: ${insertErr.message}`);
            continue;
          }
          shelfId = sh?.id ?? "";
          if (shelfId) shelfByKey.set(shelfKey, shelfId);
        }
      }
      const code = locCode || `LOC-${whCode}-${secCode}-${rackCode}-${shelfCode}`;
      const { error } = await supabase.from("locations").insert({
        company_id: activeCompanyId,
        shelf_id: shelfId,
        code,
        name: (o.location_name ?? "").trim() || null,
        position: (o.position ?? "").trim() || null,
        is_active: true,
      });
      if (error) errors.push(`Row ${i + 2}: ${error.message}`);
      else ok++;
    }
    setResult({ ok, errors });
    setImporting(false);
  }

  async function handleImportItemExport(e: FormEvent) {
    e.preventDefault();
    if (!file || !activeCompanyId) return;
    setImporting(true);
    setResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const h = rows[0] ?? [];
    setHeaders(h);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));
    const errors: string[] = [];
    let ok = 0;

    const { data: itemsData } = await supabase
      .from("items")
      .select("id, sku")
      .eq("company_id", activeCompanyId);
    const skuToId = new Map((itemsData ?? []).map((x) => [x.sku as string, x.id as string]));

    const { data: catData } = await supabase
      .from("item_categories")
      .select("id, name")
      .eq("company_id", activeCompanyId);
    const catByName = new Map(
      (catData ?? []).map((c) => [(c.name as string).toLowerCase(), c.id as string])
    );

    const { data: typeData } = await supabase
      .from("item_types")
      .select("id, name")
      .eq("company_id", activeCompanyId);
    const typeByName = new Map(
      (typeData ?? []).map((t) => [(t.name as string).toLowerCase(), t.id as string])
    );

    const { data: locData } = await supabase
      .from("locations")
      .select("id, code")
      .eq("company_id", activeCompanyId);
    const locByCode = new Map(
      (locData ?? []).map((l) => [(l.code as string).toLowerCase(), l.id as string])
    );

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const o = rowToObj(row, ITEM_EXPORT_COLS);
      const sku = (o.sku ?? "").trim();
      if (!sku) continue;
      const name = (o.name ?? "").trim() || null;
      const categoryName = (o.category ?? "").trim();
      const typeName = (o.product_type ?? "").trim();
      const salePrice = o.sale_price ? parseFloat(o.sale_price) : null;
      const locStr = (o.locations ?? "").trim();

      let itemId = skuToId.get(sku);
      let categoryId: string | null = null;
      let typeId: string | null = null;

      if (categoryName) {
        const key = categoryName.toLowerCase();
        categoryId = catByName.get(key) ?? null;
        if (!categoryId) {
          const { data: cat, error: catErr } = await supabase
            .from("item_categories")
            .insert({
              company_id: activeCompanyId,
              name: categoryName,
            })
            .select("id")
            .single();
          if (catErr) {
            errors.push(`Row ${i + 2}: category "${categoryName}": ${catErr.message}`);
          } else if (cat?.id) {
            categoryId = cat.id as string;
            catByName.set(key, categoryId);
          }
        }
      }

      if (typeName) {
        const key = typeName.toLowerCase();
        typeId = typeByName.get(key) ?? null;
        if (!typeId) {
          const { data: typeRow, error: typeErr } = await supabase
            .from("item_types")
            .insert({
              company_id: activeCompanyId,
              name: typeName,
            })
            .select("id")
            .single();
          if (typeErr) {
            errors.push(`Row ${i + 2}: type "${typeName}": ${typeErr.message}`);
          } else if (typeRow?.id) {
            typeId = typeRow.id as string;
            typeByName.set(key, typeId);
          }
        }
      }

      if (!itemId) {
        const { data: newItem, error: insertErr } = await supabase
          .from("items")
          .insert({
            company_id: activeCompanyId,
            sku,
            name,
            sale_price: salePrice,
            item_category_id: categoryId,
            item_type_id: typeId,
          })
          .select("id")
          .single();
        if (insertErr) {
          errors.push(`Row ${i + 2}: ${insertErr.message}`);
          continue;
        }
        itemId = newItem?.id as string;
        if (itemId) skuToId.set(sku, itemId);
      } else {
        const { error: updErr } = await supabase
          .from("items")
          .update({
            name,
            sale_price: salePrice,
            item_category_id: categoryId,
            item_type_id: typeId,
          })
          .eq("id", itemId);
        if (updErr) {
          errors.push(`Row ${i + 2}: ${updErr.message}`);
          continue;
        }
      }

      if (locStr && itemId) {
        const codes = locStr
          .split(/[|,]/)
          .map((c) => c.trim())
          .filter(Boolean);
        const locIds: string[] = [];
        for (const code of codes) {
          const key = code.toLowerCase();
          const locId = locByCode.get(key);
          if (!locId) {
            errors.push(`Row ${i + 2}: location code "${code}" not found`);
            continue;
          }
          locIds.push(locId);
        }
        if (locIds.length > 0) {
          await supabase
            .from("item_locations")
            .delete()
            .eq("item_id", itemId);
          const rowsToInsert = locIds.map((locId, idx) => ({
            item_id: itemId,
            location_id: locId,
            is_default: idx === 0,
          }));
          const { error: ilErr } = await supabase
            .from("item_locations")
            .insert(rowsToInsert);
          if (ilErr) {
            errors.push(`Row ${i + 2}: locations: ${ilErr.message}`);
          }
        }
      }

      ok++;
    }

    setResult({ ok, errors });
    setImporting(false);
  }

  async function handleImportProcedures(e: FormEvent) {
    e.preventDefault();
    if (!file || !activeCompanyId) return;
    setImporting(true);
    setResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const h = rows[0] ?? [];
    setHeaders(h);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));
    const errors: string[] = [];
    let ok = 0;

    const { data: itemsData } = await supabase
      .from("items")
      .select("id, sku")
      .eq("company_id", activeCompanyId);
    const skuToId = new Map(
      (itemsData ?? []).map((x) => [String(x.sku), String(x.id)]),
    );

    // Group rows by procedure_code
    const byCode = new Map<
      string,
      {
        header: {
          name: string;
          tools_required: string;
          steps: string;
          output_item_sku: string;
          output_quantity: string;
          is_active: string;
        };
        inputs: { sku: string; qty: string }[];
      }
    >();

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const o = rowToObj(row, PROCEDURE_COLS);
      const code = (o.procedure_code ?? "").trim();
      if (!code) continue;
      const existing = byCode.get(code) ?? {
        header: {
          name: (o.name ?? "").trim(),
          tools_required: (o.tools_required ?? "").trim(),
          steps: (o.steps ?? "").trim(),
          output_item_sku: (o.output_item_sku ?? "").trim(),
          output_quantity: (o.output_quantity ?? "").trim(),
          is_active: (o.is_active ?? "").trim(),
        },
        inputs: [],
      };
      const inputSku = (o.input_item_sku ?? "").trim();
      const inputQty = (o.input_quantity ?? "").trim();
      if (inputSku) {
        existing.inputs.push({ sku: inputSku, qty: inputQty });
      }
      byCode.set(code, existing);
    }

    for (const [procedureCode, data] of byCode.entries()) {
      const { header, inputs } = data;
      if (!header.name) {
        errors.push(
          `Procedure "${procedureCode}": name is required; skipping this procedure.`,
        );
        continue;
      }
      if (inputs.length === 0) {
        errors.push(
          `Procedure "${procedureCode}": at least one input_item_sku is required; skipping.`,
        );
        continue;
      }

      // Resolve output item
      let outputItemId: string | null = null;
      if (header.output_item_sku) {
        const outId = skuToId.get(header.output_item_sku);
        if (!outId) {
          errors.push(
            `Procedure "${procedureCode}": output_item_sku "${header.output_item_sku}" not found; skipping.`,
          );
          continue;
        }
        outputItemId = outId;
      }
      const outQty =
        header.output_quantity && header.output_quantity.trim()
          ? parseFloat(header.output_quantity)
          : null;

      // Resolve input SKUs
      const trimmedInputs = inputs
        .map((r) => ({
          sku: r.sku.trim(),
          qty: parseFloat(r.qty || "0"),
        }))
        .filter((r) => r.sku && r.qty > 0);
      if (trimmedInputs.length === 0) {
        errors.push(
          `Procedure "${procedureCode}": all inputs have missing/zero quantity; skipping.`,
        );
        continue;
      }
      const missing: string[] = [];
      for (const r of trimmedInputs) {
        if (!skuToId.get(r.sku)) missing.push(r.sku);
      }
      if (missing.length > 0) {
        errors.push(
          `Procedure "${procedureCode}": input SKUs not found: ${missing.join(
            ", ",
          )}`,
        );
        continue;
      }

      // Find existing procedure by procedure_code
      const { data: existing } = await supabase
        .from("procedures")
        .select("id, item_id, version")
        .eq("company_id", activeCompanyId)
        .eq("procedure_code", procedureCode)
        .maybeSingle();

      let procedureId: string;
      let itemIdForVersion: string | null = null;

      if (existing?.id) {
        procedureId = String(existing.id);
        itemIdForVersion = existing.item_id
          ? String(existing.item_id)
          : outputItemId;

        const { error: updErr } = await supabase
          .from("procedures")
          .update({
            name: header.name,
            tools_required: header.tools_required || null,
            steps: header.steps || null,
            output_item_id: outputItemId,
            output_quantity: outQty,
            is_active: /^(1|true|yes)$/i.test(header.is_active || "1"),
          })
          .eq("id", procedureId);
        if (updErr) {
          errors.push(
            `Procedure "${procedureCode}": ${updErr.message}; skipping.`,
          );
          continue;
        }

        await supabase
          .from("procedure_items")
          .delete()
          .eq("procedure_id", procedureId);
      } else {
        itemIdForVersion = outputItemId ?? null;
        let nextVersion: number | null = null;
        if (itemIdForVersion) {
          const { data: maxRow } = await supabase
            .from("procedures")
            .select("version")
            .eq("company_id", activeCompanyId)
            .eq("item_id", itemIdForVersion)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();
          nextVersion = ((maxRow as any)?.version ?? 0) + 1;
        }

        const { data: inserted, error: insErr } = await supabase
          .from("procedures")
          .insert({
            company_id: activeCompanyId,
            name: header.name,
            procedure_code: procedureCode,
            tools_required: header.tools_required || null,
            steps: header.steps || null,
            output_item_id: outputItemId,
            output_quantity: outQty,
            item_id: itemIdForVersion,
            ...(nextVersion != null ? { version: nextVersion } : {}),
          })
          .select("id")
          .single();
        if (insErr || !inserted) {
          errors.push(
            `Procedure "${procedureCode}": ${insErr?.message ?? "insert failed"}`,
          );
          continue;
        }
        procedureId = String(inserted.id);
      }

      const rowsToInsert = trimmedInputs.map((r) => ({
        procedure_id: procedureId,
        item_id: skuToId.get(r.sku)!,
        quantity_required: r.qty,
      }));
      const { error: piErr } = await supabase
        .from("procedure_items")
        .insert(rowsToInsert);
      if (piErr) {
        errors.push(`Procedure "${procedureCode}": inputs: ${piErr.message}`);
        continue;
      }
      ok++;
    }

    setResult({ ok, errors });
    setImporting(false);
  }

  async function handleImportWorkOrders(e: FormEvent) {
    e.preventDefault();
    if (!file || !activeCompanyId) return;
    setImporting(true);
    setResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const h = rows[0] ?? [];
    setHeaders(h);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));
    const errors: string[] = [];
    let ok = 0;

    const { data: procs } = await supabase
      .from("procedures")
      .select("id, procedure_code")
      .eq("company_id", activeCompanyId);
    const procCodeToId = new Map(
      (procs ?? []).map((p) => [String(p.procedure_code), String(p.id)]),
    );

    // Group by work_order_number (preferred) or name
    type WoGroup = {
      header: {
        name: string;
        work_order_number: string;
        standard_quantity: string;
        standard_time_minutes: string;
        status: string;
      };
      procedures: string[];
    };
    const groups = new Map<string, WoGroup>();

    for (let i = 0; i < dataRows.length; i++) {
      const o = rowToObj(dataRows[i], WORK_ORDER_COLS);
      const name = (o.name ?? "").trim();
      const woNumber = (o.work_order_number ?? "").trim();
      if (!name && !woNumber) continue;
      const key = woNumber || name;
      const existing = groups.get(key) ?? {
        header: {
          name,
          work_order_number: woNumber,
          standard_quantity: (o.standard_quantity ?? "").trim(),
          standard_time_minutes: (o.standard_time_minutes ?? "").trim(),
          status: (o.status ?? "").trim(),
        },
        procedures: [],
      };
      const procCode = (o.procedure_code ?? "").trim();
      if (procCode) existing.procedures.push(procCode);
      groups.set(key, existing);
    }

    for (const [key, data] of groups.entries()) {
      const { header, procedures } = data;
      if (!header.name) {
        errors.push(`Work order "${key}": name is required; skipping.`);
        continue;
      }
      const qty =
        header.standard_quantity && header.standard_quantity.trim()
          ? parseFloat(header.standard_quantity)
          : 0;
      const time =
        header.standard_time_minutes && header.standard_time_minutes.trim()
          ? parseInt(header.standard_time_minutes, 10)
          : 0;
      if (qty <= 0 || time <= 0) {
        errors.push(
          `Work order "${key}": standard_quantity and standard_time_minutes must be > 0; skipping.`,
        );
        continue;
      }

      const procIds: string[] = [];
      for (const code of procedures) {
        const id = procCodeToId.get(code);
        if (!id) {
          errors.push(
            `Work order "${key}": procedure_code "${code}" not found; skipping this procedure link.`,
          );
          continue;
        }
        procIds.push(id);
      }
      if (procIds.length === 0) {
        errors.push(
          `Work order "${key}": no valid procedure codes; skipping work order.`,
        );
        continue;
      }

      // Try to find existing work order by work_order_number (if provided), else by name
      let woQuery = supabase
        .from("work_orders")
        .select("id")
        .eq("company_id", activeCompanyId)
        .limit(1);
      if (header.work_order_number) {
        woQuery = woQuery.eq("work_order_number", header.work_order_number);
      } else {
        woQuery = woQuery.eq("name", header.name);
      }
      const { data: existing } = await woQuery.maybeSingle();

      let workOrderId: string;
      if (existing?.id) {
        workOrderId = String(existing.id);
        const { error: updErr } = await supabase
          .from("work_orders")
          .update({
            name: header.name,
            standard_quantity: qty,
            standard_time_minutes: time,
            status: header.status || "open",
          })
          .eq("id", workOrderId);
        if (updErr) {
          errors.push(`Work order "${key}": ${updErr.message}; skipping.`);
          continue;
        }
        await supabase
          .from("work_order_procedures")
          .delete()
          .eq("work_order_id", workOrderId);
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("work_orders")
          .insert({
            company_id: activeCompanyId,
            name: header.name,
            standard_quantity: qty,
            standard_time_minutes: time,
            status: header.status || "open",
            work_order_number: header.work_order_number || null,
          })
          .select("id")
          .single();
        if (insErr || !inserted) {
          errors.push(
            `Work order "${key}": ${insErr?.message ?? "insert failed"}`,
          );
          continue;
        }
        workOrderId = String(inserted.id);
      }

      const rowsToInsert = procIds.map((pid, idx) => ({
        work_order_id: workOrderId,
        procedure_id: pid,
        sequence: idx + 1,
      }));
      const { error: linkErr } = await supabase
        .from("work_order_procedures")
        .insert(rowsToInsert);
      if (linkErr) {
        errors.push(`Work order "${key}": procedures: ${linkErr.message}`);
        continue;
      }
      ok++;
    }

    setResult({ ok, errors });
    setImporting(false);
  }

  async function handleImportPurchases(e: FormEvent) {
    e.preventDefault();
    if (!file || !activeCompanyId) return;
    setImporting(true);
    setResult(null);
    const text = await file.text();
    const rows = parseCSV(text);
    const h = rows[0] ?? [];
    setHeaders(h);
    const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim()));
    const errors: string[] = [];
    let ok = 0;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: itemsData } = await supabase
      .from("items")
      .select("id, sku")
      .eq("company_id", activeCompanyId);
    const skuToId = new Map(
      (itemsData ?? []).map((x) => [String(x.sku), String(x.id)]),
    );

    const { data: locData } = await supabase
      .from("locations")
      .select("id, code")
      .eq("company_id", activeCompanyId);
    const locByCode = new Map(
      (locData ?? []).map((l) => [
        String(l.code).toLowerCase(),
        String(l.id),
      ]),
    );

    // Group by PO number (or a synthetic key)
    type PoGroup = {
      po: string;
      lines: ReturnType<typeof rowToObj>[];
    };
    const groups = new Map<string, PoGroup>();

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const o = rowToObj(row, PURCHASE_COLS);
      const po = (o.po_number ?? "").trim() || `NO-PO-${i + 2}`;
      const existing = groups.get(po) ?? { po, lines: [] };
      existing.lines.push(o);
      groups.set(po, existing);
    }

    for (const [po, group] of groups.entries()) {
      const { lines } = group;
      if (lines.length === 0) continue;

      // Create one receiving_order per PO
      const { data: ro, error: roErr } = await supabase
        .from("receiving_orders")
        .insert({
          company_id: activeCompanyId,
          status: "open",
          notes: po ? `Imported PO ${po}` : null,
        })
        .select("id")
        .single();
      if (roErr || !ro) {
        errors.push(
          `PO "${po}": failed to create receiving order: ${
            roErr?.message ?? "insert failed"
          }`,
        );
        continue;
      }
      const roId = String(ro.id);

      for (let i = 0; i < lines.length; i++) {
        const o = lines[i];
        const rowIndex = `PO "${po}" row ${i + 2}`;
        const sku = (o.item_sku ?? "").trim();
        if (!sku) {
          errors.push(`${rowIndex}: item_sku is required; skipping line.`);
          continue;
        }
        const itemId = skuToId.get(sku);
        if (!itemId) {
          errors.push(
            `${rowIndex}: item_sku "${sku}" not found for this company; skipping line.`,
          );
          continue;
        }

        const qtyOrdered = o.quantity_ordered
          ? parseFloat(o.quantity_ordered)
          : 0;
        const qtyReceived = o.quantity_received
          ? parseFloat(o.quantity_received)
          : 0;
        if (qtyOrdered <= 0) {
          errors.push(
            `${rowIndex}: quantity_ordered must be > 0; skipping line.`,
          );
          continue;
        }

        let locationId: string | null = null;
        const locCode = (o.location_code ?? "").trim();
        if (locCode) {
          const key = locCode.toLowerCase();
          const id = locByCode.get(key);
          if (!id) {
            errors.push(
              `${rowIndex}: location_code "${locCode}" not found; leaving location empty.`,
            );
          } else {
            locationId = id;
          }
        }

        const unitCost = o.unit_cost ? parseFloat(o.unit_cost) : null;
        const orderDate = (o.order_date ?? "").trim() || null;
        const expectedArrival = (o.expected_arrival_date ?? "").trim() || null;
        const receivedAt = expectedArrival || orderDate || null;

        const { data: insertedLine, error: lineErr } = await supabase
          .from("receiving_order_lines")
          .insert({
            receiving_order_id: roId,
            item_id: itemId,
            location_id: locationId,
            quantity_ordered: qtyOrdered,
            quantity_received: qtyReceived > 0 ? qtyReceived : 0,
            unit_cost: unitCost,
            pieces_per_pack: null,
            notes: (o.notes ?? "").trim() || null,
            order_date: orderDate,
            expected_ship_date: (o.expected_ship_date ?? "").trim() || null,
            expected_arrival_date: expectedArrival,
            vendor_company_name: (o.vendor_company_name ?? "").trim() || null,
            vendor_url: (o.vendor_url ?? "").trim() || null,
          })
          .select("id")
          .single();
        if (lineErr) {
          errors.push(`${rowIndex}: ${lineErr.message}`);
        } else {
          if (qtyReceived > 0) {
            const { error: txErr } = await supabase
              .from("inventory_transactions")
              .insert({
                company_id: activeCompanyId,
                item_id: itemId,
                location_id: locationId,
                qty_change: qtyReceived,
                transaction_type: "purchase_receipt",
                unit_cost: unitCost,
                landed_unit_cost: unitCost,
                reference_table: "receiving_order_lines",
                reference_id: insertedLine.id,
                created_by: user?.id ?? null,
                created_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
              });
            if (txErr) {
              errors.push(`${rowIndex}: receipt transaction: ${txErr.message}`);
            }
          }
          if (locationId) {
            const { data: existingDefault } = await supabase
              .from("item_locations")
              .select("id")
              .eq("item_id", itemId)
              .eq("is_default", true)
              .maybeSingle();

            const { error: ilErr } = await supabase
              .from("item_locations")
              .upsert(
                {
                  item_id: itemId,
                  location_id: locationId,
                  is_default: !existingDefault,
                },
                { onConflict: "item_id,location_id" },
              );

            if (ilErr) {
              errors.push(`${rowIndex}: item location link: ${ilErr.message}`);
            }
          }
          ok++;
        }
      }
    }

    setResult({ ok, errors });
    setImporting(false);
  }

  async function handleExportProcedures() {
    if (!activeCompanyId) return;
    const { data: procs } = await supabase
      .from("procedures")
      .select(
        "id, name, procedure_code, tools_required, steps, output_item_id, output_quantity, is_active",
      )
      .eq("company_id", activeCompanyId);
    if (!procs || procs.length === 0) {
      setResult({ ok: 0, errors: ["No procedures to export."] });
      return;
    }
    const procIds = procs.map((p) => String(p.id));
    const outputItemIds = Array.from(
      new Set(
        procs
          .map((p) => p.output_item_id as string | null)
          .filter((id): id is string => !!id),
      ),
    );

    const { data: outItems } = outputItemIds.length
      ? await supabase
          .from("items")
          .select("id, sku")
          .in("id", outputItemIds)
      : { data: [] as any[] };
    const outputIdToSku = new Map(
      (outItems ?? []).map((it) => [String(it.id), String(it.sku)]),
    );

    const { data: inputs } = await supabase
      .from("procedure_items")
      .select("procedure_id, quantity_required, items ( sku )")
      .in("procedure_id", procIds);

    type ProcInput = { sku: string; qty: number };
    const inputsByProc = new Map<string, ProcInput[]>();
    (inputs ?? []).forEach((row: any) => {
      const pid = String(row.procedure_id);
      const arr = inputsByProc.get(pid) ?? [];
      arr.push({
        sku: row.items?.sku ?? "",
        qty:
          row.quantity_required != null
            ? Number(row.quantity_required)
            : 0,
      });
      inputsByProc.set(pid, arr);
    });

    const header = PROCEDURE_COLS;
    const rows: string[][] = [header];

    for (const p of procs as any[]) {
      const pid = String(p.id);
      const headerBase = [
        String(p.procedure_code ?? ""),
        String(p.name ?? ""),
        String(p.tools_required ?? ""),
        String(p.steps ?? ""),
        outputIdToSku.get(p.output_item_id as string) ?? "",
        p.output_quantity != null ? String(p.output_quantity) : "",
      ];
      const isActive =
        p.is_active === false || p.is_active === "false" ? "0" : "1";
      const ins = inputsByProc.get(pid) ?? [];
      if (ins.length === 0) {
        rows.push([...headerBase, "", "", isActive]);
      } else {
        for (const inp of ins) {
          rows.push([
            ...headerBase,
            inp.sku,
            inp.qty > 0 ? String(inp.qty) : "",
            isActive,
          ]);
        }
      }
    }

    downloadCSV(rows, "procedures_export.csv");
  }

  async function handleExportWorkOrders() {
    if (!activeCompanyId) return;
    const { data: wos } = await supabase
      .from("work_orders")
      .select(
        "id, work_order_number, name, standard_quantity, standard_time_minutes, status",
      )
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: true });
    if (!wos || wos.length === 0) {
      setResult({ ok: 0, errors: ["No work orders to export."] });
      return;
    }
    const woIds = wos.map((w) => String(w.id));

    const { data: links } = await supabase
      .from("work_order_procedures")
      .select("work_order_id, sequence, procedures ( procedure_code )")
      .in("work_order_id", woIds)
      .order("sequence", { ascending: true });

    type LinkRow = { work_order_id: string; sequence: number; code: string };
    const linksByWo = new Map<string, LinkRow[]>();
    (links ?? []).forEach((row: any) => {
      const wid = String(row.work_order_id);
      const arr = linksByWo.get(wid) ?? [];
      arr.push({
        work_order_id: wid,
        sequence: Number(row.sequence ?? 0),
        code: row.procedures?.procedure_code ?? "",
      });
      linksByWo.set(wid, arr);
    });

    const header = WORK_ORDER_COLS;
    const rows: string[][] = [header];

    for (const w of wos as any[]) {
      const wid = String(w.id);
      const base = [
        String(w.work_order_number ?? ""),
        String(w.name ?? ""),
        w.standard_quantity != null ? String(w.standard_quantity) : "",
        w.standard_time_minutes != null
          ? String(w.standard_time_minutes)
          : "",
        String(w.status ?? "open"),
      ];
      const linksForWo = linksByWo.get(wid) ?? [];
      if (linksForWo.length === 0) {
        rows.push([...base, ""]);
      } else {
        for (const l of linksForWo) {
          rows.push([...base, l.code]);
        }
      }
    }

    downloadCSV(rows, "work_orders_export.csv");
  }

  async function handleExportPurchases() {
    if (!activeCompanyId) return;
    const { data } = await supabase
      .from("receiving_order_lines")
      .select(
        "id, receiving_order_id, item_id, quantity_ordered, quantity_received, unit_cost, notes, order_date, expected_ship_date, expected_arrival_date, vendor_company_name, vendor_url, locations ( code ), items ( sku ), receiving_orders!inner ( company_id )",
      )
      .eq("receiving_orders.company_id", activeCompanyId);
    if (!data || data.length === 0) {
      setResult({ ok: 0, errors: ["No purchases to export."] });
      return;
    }

    const header = PURCHASE_COLS;
    const rows: string[][] = [header];

    for (const row of data as any[]) {
      const poNumber = String(row.receiving_order_id ?? "");
      const sku = row.items?.sku ?? "";
      const locCode = row.locations?.code ?? "";
      rows.push([
        poNumber,
        sku,
        row.vendor_company_name ?? "",
        row.vendor_url ?? "",
        row.order_date ?? "",
        row.expected_ship_date ?? "",
        row.expected_arrival_date ?? "",
        row.quantity_ordered != null ? String(row.quantity_ordered) : "",
        row.quantity_received != null ? String(row.quantity_received) : "",
        row.unit_cost != null ? String(row.unit_cost) : "",
        locCode,
        row.notes ?? "",
      ]);
    }

    downloadCSV(rows, "purchases_export.csv");
  }

  const expectedCols =
    tab === "items"
      ? ITEM_COLS
      : tab === "items_export"
      ? ITEM_EXPORT_COLS
      : tab === "buying_options"
      ? BUYING_OPT_COLS
      : tab === "locations"
      ? LOCATION_COLS
      : tab === "procedures"
      ? PROCEDURE_COLS
      : tab === "work_orders"
      ? WORK_ORDER_COLS
      : PURCHASE_COLS;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-emerald-400 hover:underline">← Admin</Link>
        <h2 className="text-xl font-semibold">Import (CSV)</h2>
        <p className="text-sm text-slate-400">Upload a CSV file. First row must be headers. Export from Excel as &quot;CSV UTF-8&quot;.</p>
      </div>

      {!activeCompanyId && <p className="text-amber-400">Select an active company first.</p>}

      <div className="flex gap-2 border-b border-slate-800 pb-2">
        {(
          [
            "items",
            "items_export",
            "buying_options",
            "locations",
            "procedures",
            "work_orders",
            "purchases",
          ] as const
        ).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setFile(null);
              setPreview([]);
              setResult(null);
            }}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === t ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            {t === "items"
              ? "Items (create)"
              : t === "items_export"
              ? "Items (export/import)"
              : t === "buying_options"
              ? "Buying options"
              : t === "locations"
              ? "Locations"
              : t === "procedures"
              ? "Procedures"
              : t === "work_orders"
              ? "Work orders"
              : "Purchases"}
          </button>
        ))}
      </div>

      <div className="rounded border border-slate-800 bg-slate-900/50 p-4 max-w-2xl">
        <p className="text-xs text-slate-400 mb-2">Expected columns: {expectedCols.join(", ")}</p>
        {tab === "locations" && (
          <p className="text-xs text-slate-500 mb-2">Locations: warehouse_code, warehouse_name, section_code, section_name, rack_code, rack_name, shelf_code, shelf_name, location_code, location_name, position. Hierarchy is created if missing.</p>
        )}
        {tab === "items_export" && (
          <p className="text-xs text-slate-500 mb-2">
            Items (export/import): use the CSV exported from the Items page, then edit and re-import.
            Existing SKUs are updated; new SKUs are created. Locations are matched by location code.
          </p>
        )}
        {tab === "procedures" && (
          <p className="text-xs text-slate-500 mb-2">
            Procedures: one row per input item. Use procedure_code as the key; existing procedures are
            updated and their inputs replaced. input_item_sku and output_item_sku must exist as items.
          </p>
        )}
        {tab === "work_orders" && (
          <p className="text-xs text-slate-500 mb-2">
            Work orders: one row per work-order/procedure link. Use work_order_number (preferred) or
            name as the key. Existing work orders are updated and their procedure list replaced.
            procedure_code must exist as a procedure.
          </p>
        )}
        {tab === "purchases" && (
          <p className="text-xs text-slate-500 mb-2">
            Purchases: one row per purchase line. po_number groups lines into a single receiving order;
            item_sku and location_code must match existing items/locations. Dates are optional.
          </p>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {tab === "procedures" && (
            <button
              type="button"
              onClick={handleExportProcedures}
              disabled={!activeCompanyId}
              className="rounded border border-emerald-600 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
            >
              Export procedures CSV
            </button>
          )}
          {tab === "work_orders" && (
            <button
              type="button"
              onClick={handleExportWorkOrders}
              disabled={!activeCompanyId}
              className="rounded border border-emerald-600 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
            >
              Export work orders CSV
            </button>
          )}
          {tab === "purchases" && (
            <button
              type="button"
              onClick={handleExportPurchases}
              disabled={!activeCompanyId}
              className="rounded border border-emerald-600 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
            >
              Export purchases CSV
            </button>
          )}
        </div>

        <form
          onSubmit={
            tab === "items"
              ? handleImportItems
              : tab === "items_export"
              ? handleImportItemExport
              : tab === "buying_options"
              ? handleImportBuyingOptions
              : tab === "locations"
              ? handleImportLocations
              : tab === "procedures"
              ? handleImportProcedures
              : tab === "work_orders"
              ? handleImportWorkOrders
              : handleImportPurchases
          }
          className="space-y-3"
        >
          <input type="file" accept=".csv,.txt" onChange={onFileChange} className="text-sm text-slate-300" />
          {preview.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs text-slate-500 mb-1">Preview (first 10 data rows):</p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    {headers.map((h, i) => <th key={i} className="py-1 pr-2 text-left">{h || `Col ${i + 1}`}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(1).map((row, ri) => (
                    <tr key={ri} className="border-b border-slate-800">
                      {row.map((c, ci) => <td key={ci} className="py-1 pr-2">{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button type="submit" disabled={!file || !activeCompanyId || importing} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {importing ? "Importing…" : "Import"}
          </button>
        </form>
      </div>

      {result && (
        <div className="rounded border border-slate-700 p-3 text-sm">
          <p className="text-emerald-400">Imported: {result.ok}</p>
          {result.errors.length > 0 && (
            <div className="mt-2 text-red-400">
              <p className="font-medium">Errors:</p>
              <ul className="list-disc pl-4 mt-1 max-h-40 overflow-y-auto">
                {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                {result.errors.length > 20 && <li>… and {result.errors.length - 20} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
