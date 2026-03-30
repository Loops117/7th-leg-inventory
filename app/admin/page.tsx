"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type CompanySettings = {
  id: string;
  company_id: string;
  cost_type: string;
  location_code_prefix: string;
  location_code_suffix: string;
  location_code_counter: number;
  use_landed_cost?: boolean;
};

export default function AdminPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [costType, setCostType] = useState<string>("average");
  const [useLandedCost, setUseLandedCost] = useState<boolean>(false);
  const [locationCodePrefix, setLocationCodePrefix] = useState("LOC-");
  const [locationCodeSuffix, setLocationCodeSuffix] = useState("");
  const [locationCodeCounter, setLocationCodeCounter] = useState(0);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    loadSettings(active.id);
  }, []);

  async function loadSettings(companyId: string) {
    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .eq("company_id", companyId)
      .single();
    if (error && error.code !== "PGRST116") setError(error.message);
    else if (data) {
      setSettings(data as CompanySettings);
      setCostType(data.cost_type);
      setLocationCodePrefix(data.location_code_prefix ?? "LOC-");
      setLocationCodeSuffix(data.location_code_suffix ?? "");
      setLocationCodeCounter(data.location_code_counter ?? 0);
      setUseLandedCost(Boolean((data as any).use_landed_cost));
    } else {
      setCostType("average");
      setLocationCodePrefix("LOC-");
      setLocationCodeSuffix("");
      setLocationCodeCounter(0);
    }
    setLoading(false);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    setError(null);
    const payload = {
      company_id: activeCompanyId,
      cost_type: costType,
      location_code_prefix: locationCodePrefix.trim() || "LOC-",
      location_code_suffix: locationCodeSuffix.trim(),
      location_code_counter: locationCodeCounter,
      use_landed_cost: useLandedCost,
    };
    if (settings) {
      const { error } = await supabase
        .from("company_settings")
        .update(payload)
        .eq("company_id", activeCompanyId);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from("company_settings").insert(payload);
      if (error) setError(error.message);
    }
    setSaving(false);
    if (activeCompanyId) loadSettings(activeCompanyId);
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Admin – Company settings</h2>
        <p className="text-slate-300">Select an active company to manage settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Admin – Company settings</h2>
      {companyName && (
        <p className="text-sm text-slate-400">Company: {companyName}</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <form onSubmit={handleSave} className="max-w-xl space-y-4 rounded border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Cost</h3>

        <div>
          <label className="block text-xs text-slate-500 mb-1">Cost type</label>
          <select
            value={costType}
            onChange={(e) => setCostType(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="average">Average cost</option>
            <option value="first">First cost</option>
            <option value="set">Set cost (use last receipt)</option>
            <option value="last">Last cost</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">
            How item cost is calculated from purchase receipts.
          </p>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">
            Unit cost basis
          </label>
          <select
            value={useLandedCost ? "landed" : "base"}
            onChange={(e) => setUseLandedCost(e.target.value === "landed")}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="base">Use cost before shipping</option>
            <option value="landed">Use landed cost (with shipping/tariff)</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Controls whether SKU cost uses only purchase price or includes
            allocated shipping/tariff.
          </p>
        </div>

        <h3 className="text-sm font-semibold text-slate-200 pt-2">Location code auto-generation</h3>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Location code prefix</label>
          <input
            type="text"
            value={locationCodePrefix}
            onChange={(e) => setLocationCodePrefix(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            placeholder="e.g. LOC-"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Location code suffix</label>
          <input
            type="text"
            value={locationCodeSuffix}
            onChange={(e) => setLocationCodeSuffix(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Location code counter (editable)</label>
          <input
            type="number"
            min={0}
            value={locationCodeCounter}
            onChange={(e) => setLocationCodeCounter(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <p className="mt-1 text-xs text-slate-500">
            Next location code: {locationCodePrefix || "..."}{locationCodeCounter + 1}{locationCodeSuffix || ""}
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}
