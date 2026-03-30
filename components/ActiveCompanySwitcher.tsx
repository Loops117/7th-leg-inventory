"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  loadActiveCompany,
  saveActiveCompany,
  type ActiveCompany,
} from "@/lib/activeCompany";

type Company = {
  id: string;
  name: string;
  is_active: boolean;
};

export function ActiveCompanySwitcher() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompany, setActiveCompany] = useState<ActiveCompany | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    async function init() {
      setLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setLoggedIn(false);
        setLoading(false);
        return;
      }
      setLoggedIn(true);

      const { data, error } = await supabase
        .from("companies")
        .select("id, name, is_active")
        .order("name");

      if (error || !data) {
        setCompanies([]);
        setLoading(false);
        return;
      }

      setCompanies(data);

      // Restore from local storage if still valid
      const stored = loadActiveCompany();
      if (stored && data.some((c) => c.id === stored.id)) {
        setActiveCompany(stored);
        setLoading(false);
        return;
      }

      // If only one company, auto-select it
      if (data.length === 1) {
        const single = { id: data[0].id, name: data[0].name };
        setActiveCompany(single);
        saveActiveCompany(single);
      }

      setLoading(false);
    }

    init();
  }, []);

  if (!loggedIn) {
    return (
      <a
        href="/login"
        className="text-xs text-slate-300 hover:text-emerald-400"
      >
        Log in
      </a>
    );
  }

  if (loading) {
    return (
      <span className="text-xs text-slate-400" aria-busy="true">
        Loading company…
      </span>
    );
  }

  if (companies.length === 0) {
    return (
      <span className="text-xs text-slate-400">
        No companies. Create one in Supabase.
      </span>
    );
  }

  if (companies.length === 1 && activeCompany) {
    return (
      <span className="text-xs text-emerald-300">
        {activeCompany.name}{" "}
        <span className="text-slate-300">inventory</span>
      </span>
    );
  }

  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      <span className="text-emerald-300">
        {activeCompany
          ? `${activeCompany.name} inventory`
          : "Select company"}
      </span>
      <select
        className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
        value={activeCompany?.id ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          const company = companies.find((c) => c.id === id);
          if (!company) return;
          const next: ActiveCompany = { id: company.id, name: company.name };
          setActiveCompany(next);
          saveActiveCompany(next);
          // Hard reload so all client pages pick up the new active company
          if (typeof window !== "undefined") {
            window.location.reload();
          } else {
            router.refresh();
          }
        }}
      >
        <option value="" disabled>
          Select company…
        </option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

