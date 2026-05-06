"use client";

import { FormEvent, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCurrentUserPermissions, hasPermission } from "@/lib/permissions";

type Warehouse = { id: string; company_id: string; code: string; name: string | null };
type Section = { id: string; warehouse_id: string; code: string; name: string | null; warehouses?: { code: string; name: string | null } };
type Rack = { id: string; section_id: string; code: string; name: string | null; sections?: { code: string; warehouses?: { code: string } } };
type Shelf = { id: string; rack_id: string; code: string; name: string | null; racks?: { code: string; sections?: { code: string; warehouses?: { code: string } } } };
type Location = {
  id: string;
  company_id: string;
  code: string;
  name: string | null;
  shelf_id: string | null;
  position: string | null;
  is_active: boolean;
  shelves?: { code: string; racks?: { code: string; sections?: { code: string; warehouses?: { code: string } } } };
};

const TABS = ["Warehouses", "Sections", "Racks", "Shelves", "Locations"] as const;

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
    } else if (c === '"') {
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
          if (/[",\r\n]/.test(c)) return `"${c.replace(/"/g, '""')}"`;
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

export default function AdminLocationsPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Warehouses");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formWarehouseId, setFormWarehouseId] = useState("");
  const [formSectionId, setFormSectionId] = useState("");
  const [formRackId, setFormRackId] = useState("");
  const [formShelfId, setFormShelfId] = useState("");
  const [formPosition, setFormPosition] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [nextLocationCode, setNextLocationCode] = useState("");
  const [importingLocations, setImportingLocations] = useState(false);
  const [exportingLocations, setExportingLocations] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    getCurrentUserPermissions(active.id).then(({ permissionCodes }) => {
      setCanManage(hasPermission(permissionCodes, "manage_locations"));
    });
    loadAll(active.id);
  }, []);

  async function loadAll(companyId: string) {
    const { data: wData } = await supabase.from("warehouses").select("id, company_id, code, name").eq("company_id", companyId).order("code");
    const whList = (wData ?? []) as Warehouse[];
    setWarehouses(whList);
    const whIds = whList.map((w) => w.id);
    const { data: sData } = whIds.length
      ? await supabase.from("sections").select("id, warehouse_id, code, name, warehouses(code, name)").in("warehouse_id", whIds).order("code")
      : { data: [] };
    const secList = (sData ?? []) as Section[];
    setSections(secList);
    const secIds = secList.map((s) => s.id);
    const { data: rData } = secIds.length
      ? await supabase.from("racks").select("id, section_id, code, name, sections(code, warehouses(code))").in("section_id", secIds).order("code")
      : { data: [] };
    const rackList = (rData ?? []) as Rack[];
    setRacks(rackList);
    const rackIds = rackList.map((r) => r.id);
    const { data: shData } = rackIds.length
      ? await supabase.from("shelves").select("id, rack_id, code, name, racks(code, sections(code, warehouses(code)))").in("rack_id", rackIds).order("code")
      : { data: [] };
    setShelves((shData ?? []) as Shelf[]);
    const { data: locData } = await supabase
      .from("locations")
      .select("id, company_id, code, name, shelf_id, position, is_active, shelves(code, racks(code, sections(code, warehouses(code))))")
      .eq("company_id", companyId)
      .order("code");
    setLocations((locData ?? []) as Location[]);
    setLoading(false);
  }

  async function handleExportLocations() {
    if (!activeCompanyId) return;
    setExportingLocations(true);
    setError(null);
    setNotice(null);
    const rows: string[][] = [
      [
        "location_code",
        "location_name",
        "position",
        "is_active",
        "warehouse_code",
        "warehouse_name",
        "section_code",
        "section_name",
        "rack_code",
        "rack_name",
        "shelf_code",
        "shelf_name",
      ],
    ];

    const shelfById = new Map(shelves.map((s) => [s.id, s]));
    const rackById = new Map(racks.map((r) => [r.id, r]));
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const whById = new Map(warehouses.map((w) => [w.id, w]));

    for (const loc of locations) {
      const sh = loc.shelf_id ? shelfById.get(loc.shelf_id) : undefined;
      const ra = sh ? rackById.get(sh.rack_id) : undefined;
      const sec = ra ? sectionById.get(ra.section_id) : undefined;
      const wh = sec ? whById.get(sec.warehouse_id) : undefined;
      rows.push([
        loc.code,
        loc.name ?? "",
        loc.position ?? "",
        loc.is_active ? "true" : "false",
        wh?.code ?? "",
        wh?.name ?? "",
        sec?.code ?? "",
        sec?.name ?? "",
        ra?.code ?? "",
        ra?.name ?? "",
        sh?.code ?? "",
        sh?.name ?? "",
      ]);
    }
    downloadCSV(rows, "locations_export.csv");
    setExportingLocations(false);
    setNotice(`Exported ${Math.max(0, rows.length - 1)} locations.`);
  }

  async function ensureWarehouse(
    companyId: string,
    code: string,
    name: string | null,
  ): Promise<string | null> {
    const cleanCode = code.trim();
    if (!cleanCode) return null;
    const { data: existing } = await supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("code", cleanCode)
      .maybeSingle();
    if (existing?.id) {
      if (!existing.name && name?.trim()) {
        await supabase
          .from("warehouses")
          .update({ name: name.trim() })
          .eq("id", existing.id);
      }
      return existing.id as string;
    }
    const { data: inserted, error } = await supabase
      .from("warehouses")
      .insert({ company_id: companyId, code: cleanCode, name: name?.trim() || null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return inserted.id as string;
  }

  async function ensureSection(
    warehouseId: string | null,
    code: string,
    name: string | null,
  ): Promise<string | null> {
    const cleanCode = code.trim();
    if (!warehouseId || !cleanCode) return null;
    const { data: existing } = await supabase
      .from("sections")
      .select("id, name")
      .eq("warehouse_id", warehouseId)
      .eq("code", cleanCode)
      .maybeSingle();
    if (existing?.id) {
      if (!existing.name && name?.trim()) {
        await supabase.from("sections").update({ name: name.trim() }).eq("id", existing.id);
      }
      return existing.id as string;
    }
    const { data: inserted, error } = await supabase
      .from("sections")
      .insert({ warehouse_id: warehouseId, code: cleanCode, name: name?.trim() || null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return inserted.id as string;
  }

  async function ensureRack(
    sectionId: string | null,
    code: string,
    name: string | null,
  ): Promise<string | null> {
    const cleanCode = code.trim();
    if (!sectionId || !cleanCode) return null;
    const { data: existing } = await supabase
      .from("racks")
      .select("id, name")
      .eq("section_id", sectionId)
      .eq("code", cleanCode)
      .maybeSingle();
    if (existing?.id) {
      if (!existing.name && name?.trim()) {
        await supabase.from("racks").update({ name: name.trim() }).eq("id", existing.id);
      }
      return existing.id as string;
    }
    const { data: inserted, error } = await supabase
      .from("racks")
      .insert({ section_id: sectionId, code: cleanCode, name: name?.trim() || null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return inserted.id as string;
  }

  async function ensureShelf(
    rackId: string | null,
    code: string,
    name: string | null,
  ): Promise<string | null> {
    const cleanCode = code.trim();
    if (!rackId || !cleanCode) return null;
    const { data: existing } = await supabase
      .from("shelves")
      .select("id, name")
      .eq("rack_id", rackId)
      .eq("code", cleanCode)
      .maybeSingle();
    if (existing?.id) {
      if (!existing.name && name?.trim()) {
        await supabase.from("shelves").update({ name: name.trim() }).eq("id", existing.id);
      }
      return existing.id as string;
    }
    const { data: inserted, error } = await supabase
      .from("shelves")
      .insert({ rack_id: rackId, code: cleanCode, name: name?.trim() || null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return inserted.id as string;
  }

  async function handleImportLocations(file: File) {
    if (!activeCompanyId) return;
    setImportingLocations(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) throw new Error("CSV must include a header and at least one row.");
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (k: string) => header.indexOf(k);
      const iLocCode = idx("location_code");
      if (iLocCode < 0) throw new Error("Missing required header: location_code");
      const iLocName = idx("location_name");
      const iPos = idx("position");
      const iActive = idx("is_active");
      const iWhCode = idx("warehouse_code");
      const iWhName = idx("warehouse_name");
      const iSecCode = idx("section_code");
      const iSecName = idx("section_name");
      const iRackCode = idx("rack_code");
      const iRackName = idx("rack_name");
      const iShCode = idx("shelf_code");
      const iShName = idx("shelf_name");

      let created = 0;
      let updated = 0;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const locationCode = (row[iLocCode] ?? "").trim();
        if (!locationCode) continue;
        const locationName = iLocName >= 0 ? (row[iLocName] ?? "").trim() : "";
        const position = iPos >= 0 ? (row[iPos] ?? "").trim() : "";
        const rawActive = iActive >= 0 ? (row[iActive] ?? "").trim().toLowerCase() : "true";
        const isActive = !["false", "0", "no", "n"].includes(rawActive);

        const whId = await ensureWarehouse(
          activeCompanyId,
          iWhCode >= 0 ? (row[iWhCode] ?? "") : "",
          iWhName >= 0 ? (row[iWhName] ?? "") : null,
        );
        const secId = await ensureSection(
          whId,
          iSecCode >= 0 ? (row[iSecCode] ?? "") : "",
          iSecName >= 0 ? (row[iSecName] ?? "") : null,
        );
        const rackId = await ensureRack(
          secId,
          iRackCode >= 0 ? (row[iRackCode] ?? "") : "",
          iRackName >= 0 ? (row[iRackName] ?? "") : null,
        );
        const shelfId = await ensureShelf(
          rackId,
          iShCode >= 0 ? (row[iShCode] ?? "") : "",
          iShName >= 0 ? (row[iShName] ?? "") : null,
        );

        const { data: existing } = await supabase
          .from("locations")
          .select("id")
          .eq("company_id", activeCompanyId)
          .eq("code", locationCode)
          .maybeSingle();
        if (existing?.id) {
          const { error: upErr } = await supabase
            .from("locations")
            .update({
              name: locationName || null,
              position: position || null,
              shelf_id: shelfId ?? null,
              is_active: isActive,
            })
            .eq("id", existing.id);
          if (upErr) throw new Error(upErr.message);
          updated++;
        } else {
          const { error: insErr } = await supabase.from("locations").insert({
            company_id: activeCompanyId,
            code: locationCode,
            name: locationName || null,
            position: position || null,
            shelf_id: shelfId ?? null,
            is_active: isActive,
          });
          if (insErr) throw new Error(insErr.message);
          created++;
        }
      }
      await loadAll(activeCompanyId);
      setNotice(`Import complete: ${created} created, ${updated} updated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import locations.");
    } finally {
      setImportingLocations(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  async function loadNextLocationCode() {
    if (!activeCompanyId) return;
    const { data } = await supabase.from("company_settings").select("location_code_prefix, location_code_suffix, location_code_counter").eq("company_id", activeCompanyId).single();
    const prefix = (data?.location_code_prefix ?? "LOC-").trim() || "LOC-";
    const suffix = (data?.location_code_suffix ?? "").trim();
    const next = (data?.location_code_counter ?? 0) + 1;
    setNextLocationCode(`${prefix}${next}${suffix}`);
  }

  function openNew() {
    setEditingId(null);
    setShowForm(true);
    setFormName("");
    setFormWarehouseId("");
    setFormSectionId("");
    setFormRackId("");
    setFormShelfId("");
    setFormPosition("");
    setFormActive(true);
    if (tab === "Locations") loadNextLocationCode();
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSaveWarehouse(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    if (editingId) {
      await supabase.from("warehouses").update({ name: formName.trim() || null }).eq("id", editingId);
    } else {
      const { data: settings } = await supabase.from("company_settings").select("warehouse_code_counter").eq("company_id", activeCompanyId).single();
      const next = (settings?.warehouse_code_counter ?? 0) + 1;
      const code = `WH-${next}`;
      const { error } = await supabase.from("warehouses").insert({ company_id: activeCompanyId, code, name: formName.trim() || null });
      if (!error) await supabase.from("company_settings").update({ warehouse_code_counter: next }).eq("company_id", activeCompanyId);
    }
    setSaving(false);
    closeForm();
    if (activeCompanyId) loadAll(activeCompanyId);
  }

  async function handleSaveSection(e: FormEvent) {
    e.preventDefault();
    if (!formWarehouseId) return;
    setSaving(true);
    if (editingId) {
      await supabase.from("sections").update({ warehouse_id: formWarehouseId, name: formName.trim() || null }).eq("id", editingId);
    } else {
      const { data: settings } = await supabase.from("company_settings").select("section_code_counter").eq("company_id", activeCompanyId).single();
      const next = (settings?.section_code_counter ?? 0) + 1;
      const code = `SEC-${next}`;
      const { error } = await supabase.from("sections").insert({ warehouse_id: formWarehouseId, code, name: formName.trim() || null });
      if (!error) await supabase.from("company_settings").update({ section_code_counter: next }).eq("company_id", activeCompanyId);
    }
    setSaving(false);
    closeForm();
    if (activeCompanyId) loadAll(activeCompanyId);
  }

  async function handleSaveRack(e: FormEvent) {
    e.preventDefault();
    if (!formSectionId) return;
    setSaving(true);
    if (editingId) {
      await supabase.from("racks").update({ section_id: formSectionId, name: formName.trim() || null }).eq("id", editingId);
    } else {
      const { data: settings } = await supabase.from("company_settings").select("rack_code_counter").eq("company_id", activeCompanyId).single();
      const next = (settings?.rack_code_counter ?? 0) + 1;
      const code = `RACK-${next}`;
      const { error } = await supabase.from("racks").insert({ section_id: formSectionId, code, name: formName.trim() || null });
      if (!error) await supabase.from("company_settings").update({ rack_code_counter: next }).eq("company_id", activeCompanyId);
    }
    setSaving(false);
    closeForm();
    if (activeCompanyId) loadAll(activeCompanyId);
  }

  async function handleSaveShelf(e: FormEvent) {
    e.preventDefault();
    if (!formRackId) return;
    setSaving(true);
    if (editingId) {
      await supabase.from("shelves").update({ rack_id: formRackId, name: formName.trim() || null }).eq("id", editingId);
    } else {
      const { data: settings } = await supabase.from("company_settings").select("shelf_code_counter").eq("company_id", activeCompanyId).single();
      const next = (settings?.shelf_code_counter ?? 0) + 1;
      const code = `SHLF-${next}`;
      const { error } = await supabase.from("shelves").insert({ rack_id: formRackId, code, name: formName.trim() || null });
      if (!error) await supabase.from("company_settings").update({ shelf_code_counter: next }).eq("company_id", activeCompanyId);
    }
    setSaving(false);
    closeForm();
    if (activeCompanyId) loadAll(activeCompanyId);
  }

  async function handleSaveLocation(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    if (editingId) {
      await supabase.from("locations").update({ shelf_id: formShelfId || null, position: formPosition.trim() || null, name: formName.trim() || null, is_active: formActive }).eq("id", editingId);
    } else {
      const code = nextLocationCode;
      const { error } = await supabase.from("locations").insert({
        company_id: activeCompanyId,
        shelf_id: formShelfId || null,
        position: formPosition.trim() || null,
        code,
        name: formName.trim() || null,
        is_active: formActive,
      });
      if (!error) {
        const { data } = await supabase.from("company_settings").select("location_code_counter").eq("company_id", activeCompanyId).single();
        await supabase.from("company_settings").update({ location_code_counter: (data?.location_code_counter ?? 0) + 1 }).eq("company_id", activeCompanyId);
      }
    }
    setSaving(false);
    closeForm();
    if (activeCompanyId) loadAll(activeCompanyId);
  }

  function pathShelf(s: Shelf) {
    const r = s.racks;
    const sec = r?.sections;
    const w = sec?.warehouses;
  const wh = w?.name?.trim() ? `${w.name} (${w.code})` : w?.code;
  const se = sec?.name?.trim() ? `${sec.name} (${sec.code})` : sec?.code;
  const ra = r?.name?.trim() ? `${r.name} (${r.code})` : r?.code;
  const sh = s.name?.trim() ? `${s.name} (${s.code})` : s.code;
  return [wh, se, ra, sh].filter(Boolean).join(" → ");
  }

  function pathLocation(loc: Location) {
    const s = loc.shelves;
    if (!s) return loc.code;
    const r = s.racks;
    const sec = r?.sections;
    const w = sec?.warehouses;
  const wh = w?.code;
  const se = sec?.code;
  const ra = r?.code;
  const sh = s.code;
  const base = [wh, se, ra, sh].filter(Boolean).join(" → ");
  const label = loc.name?.trim() ? `${loc.name} (${loc.code})` : loc.code;
  return `${label}${base ? ` • ${base}` : ""}${loc.position ? ` (${loc.position})` : ""}`;
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Locations</h2>
        <p className="text-slate-300">Select an active company first.</p>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Locations</h2>
        <p className="text-slate-300">You don’t have permission to manage locations.</p>
        <Link href="/admin" className="text-emerald-400 hover:underline">Back to Admin</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-emerald-400 hover:underline">← Admin</Link>
        <h2 className="text-xl font-semibold">Locations</h2>
        {companyName && <p className="text-sm text-slate-400">Company: {companyName}</p>}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setShowForm(false); setEditingId(null); }}
            className={`rounded px-3 py-1.5 text-sm ${tab === t ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <p className="text-slate-400">Loading…</p>}

      {!loading && tab === "Warehouses" && (
        <section>
          <button type="button" onClick={openNew} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 mb-3">+ Add warehouse</button>
          {(showForm || editingId) && (
            <form onSubmit={handleSaveWarehouse} className="mb-4 rounded border border-slate-800 bg-slate-900/50 p-4 max-w-md space-y-3">
              <h3 className="text-sm font-semibold">{editingId ? "Edit warehouse" : "Add warehouse"}</h3>
              <div><label className="block text-xs text-slate-500">Name</label><input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" placeholder="Optional" /></div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">Save</button>
                <button type="button" onClick={closeForm} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
              </div>
            </form>
          )}
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-slate-400"><th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Name</th><th></th></tr></thead>
            <tbody>
              {warehouses.map((wh) => (
                <tr key={wh.id} className="border-b border-slate-900">
                  <td className="py-2 pr-3 font-mono">{wh.code}</td>
                  <td className="py-2 pr-3">{wh.name ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => { setEditingId(wh.id); setFormName(wh.name ?? ""); setShowForm(true); }} className="text-xs text-emerald-400 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && tab === "Sections" && (
        <section>
          <button type="button" onClick={() => { openNew(); setFormWarehouseId(warehouses[0]?.id ?? ""); }} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 mb-3">+ Add section</button>
          {(showForm || editingId) && (
            <form onSubmit={handleSaveSection} className="mb-4 rounded border border-slate-800 bg-slate-900/50 p-4 max-w-md space-y-3">
              <h3 className="text-sm font-semibold">{editingId ? "Edit section" : "Add section"}</h3>
              <div>
                <label className="block text-xs text-slate-500">Warehouse</label>
                <select value={formWarehouseId} onChange={(e) => setFormWarehouseId(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" required>
                  <option value="">Select warehouse</option>
                  {warehouses.map((wh) => <option key={wh.id} value={wh.id}>{wh.code}{wh.name ? ` – ${wh.name}` : ""}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-slate-500">Name</label><input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" placeholder="Optional" /></div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">Save</button>
                <button type="button" onClick={closeForm} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
              </div>
            </form>
          )}
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-slate-400"><th className="py-2 pr-3">Warehouse</th><th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Name</th><th></th></tr></thead>
            <tbody>
              {sections.map((sec) => (
                <tr key={sec.id} className="border-b border-slate-900">
                  <td className="py-2 pr-3 text-slate-400">{sec.warehouses?.code ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono">{sec.code}</td>
                  <td className="py-2 pr-3">{sec.name ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => { setEditingId(sec.id); setFormWarehouseId(sec.warehouse_id); setFormName(sec.name ?? ""); setShowForm(true); }} className="text-xs text-emerald-400 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && tab === "Racks" && (
        <section>
          <button type="button" onClick={() => { openNew(); setFormSectionId(sections[0]?.id ?? ""); }} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 mb-3">+ Add rack</button>
          {(showForm || editingId) && (
            <form onSubmit={handleSaveRack} className="mb-4 rounded border border-slate-800 bg-slate-900/50 p-4 max-w-md space-y-3">
              <h3 className="text-sm font-semibold">{editingId ? "Edit rack" : "Add rack"}</h3>
              <div>
                <label className="block text-xs text-slate-500">Section</label>
                <select value={formSectionId} onChange={(e) => setFormSectionId(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" required>
                  <option value="">Select section</option>
                  {sections.map((sec) => <option key={sec.id} value={sec.id}>{sec.warehouses?.code} → {sec.code}{sec.name ? ` – ${sec.name}` : ""}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-slate-500">Name</label><input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" placeholder="Optional" /></div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">Save</button>
                <button type="button" onClick={closeForm} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
              </div>
            </form>
          )}
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-slate-400"><th className="py-2 pr-3">Section</th><th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Name</th><th></th></tr></thead>
            <tbody>
              {racks.map((r) => (
                <tr key={r.id} className="border-b border-slate-900">
                  <td className="py-2 pr-3 text-slate-400">{r.sections?.warehouses?.code} → {r.sections?.code}</td>
                  <td className="py-2 pr-3 font-mono">{r.code}</td>
                  <td className="py-2 pr-3">{r.name ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => { setEditingId(r.id); setFormSectionId(r.section_id); setFormName(r.name ?? ""); setShowForm(true); }} className="text-xs text-emerald-400 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && tab === "Shelves" && (
        <section>
          <button type="button" onClick={() => { openNew(); setFormRackId(racks[0]?.id ?? ""); }} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 mb-3">+ Add shelf</button>
          {(showForm || editingId) && (
            <form onSubmit={handleSaveShelf} className="mb-4 rounded border border-slate-800 bg-slate-900/50 p-4 max-w-md space-y-3">
              <h3 className="text-sm font-semibold">{editingId ? "Edit shelf" : "Add shelf"}</h3>
              <div>
                <label className="block text-xs text-slate-500">Rack</label>
                <select value={formRackId} onChange={(e) => setFormRackId(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" required>
                  <option value="">Select rack</option>
                  {racks.map((r) => <option key={r.id} value={r.id}>{r.sections?.warehouses?.code} → {r.sections?.code} → {r.code}{r.name ? ` – ${r.name}` : ""}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-slate-500">Name</label><input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" placeholder="Optional" /></div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">Save</button>
                <button type="button" onClick={closeForm} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
              </div>
            </form>
          )}
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-slate-400"><th className="py-2 pr-3">Path</th><th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Name</th><th></th></tr></thead>
            <tbody>
              {shelves.map((s) => (
                <tr key={s.id} className="border-b border-slate-900">
                  <td className="py-2 pr-3 text-slate-400">{pathShelf(s)}</td>
                  <td className="py-2 pr-3 font-mono">{s.code}</td>
                  <td className="py-2 pr-3">{s.name ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => { setEditingId(s.id); setFormRackId(s.rack_id); setFormName(s.name ?? ""); setShowForm(true); }} className="text-xs text-emerald-400 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && tab === "Locations" && (
        <section>
          <div className="mb-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { openNew(); setFormShelfId(shelves[0]?.id ?? ""); }} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">+ Add location</button>
            <button
              type="button"
              onClick={() => void handleExportLocations()}
              disabled={exportingLocations}
              className="rounded border border-emerald-700 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
            >
              {exportingLocations ? "Exporting…" : "Export CSV"}
            </button>
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              disabled={importingLocations}
              className="rounded border border-indigo-700 px-3 py-1.5 text-sm text-indigo-300 hover:bg-indigo-900/30 disabled:opacity-50"
            >
              {importingLocations ? "Importing…" : "Import CSV"}
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportLocations(f);
              }}
            />
          </div>
          {(showForm || editingId) && (
            <form onSubmit={handleSaveLocation} className="mb-4 rounded border border-slate-800 bg-slate-900/50 p-4 max-w-md space-y-3">
              <h3 className="text-sm font-semibold">{editingId ? "Edit location" : "Add location"}</h3>
              <div>
                <label className="block text-xs text-slate-500">Shelf</label>
                <select value={formShelfId} onChange={(e) => setFormShelfId(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm">
                  <option value="">— None —</option>
                  {shelves.map((s) => <option key={s.id} value={s.id}>{pathShelf(s)}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-slate-500">Position</label><input value={formPosition} onChange={(e) => setFormPosition(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" /></div>
              <div><label className="block text-xs text-slate-500">Name</label><input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" /></div>
              {editingId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />Active</label>}
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white">Save</button>
                <button type="button" onClick={closeForm} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
              </div>
            </form>
          )}
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b border-slate-800 text-left text-slate-400"><th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Path</th><th className="py-2 pr-3">Status</th><th></th></tr></thead>
            <tbody>
              {locations.map((loc) => (
                <tr key={loc.id} className="border-b border-slate-900">
                  <td className="py-2 pr-3 font-mono">{loc.code}</td>
                  <td className="py-2 pr-3">{loc.name?.trim() ? loc.name : "—"}</td>
                  <td className="py-2 pr-3 text-slate-400">{pathLocation(loc)}</td>
                  <td className="py-2 pr-3">{loc.is_active ? "Active" : "Inactive"}</td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => { setEditingId(loc.id); setFormShelfId(loc.shelf_id ?? ""); setFormPosition(loc.position ?? ""); setFormName(loc.name ?? ""); setFormActive(loc.is_active); setShowForm(true); }} className="text-xs text-emerald-400 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
