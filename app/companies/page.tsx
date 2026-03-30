"use client";

import { useEffect, useState } from "react";
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

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [activeCompany, setActiveCompany] = useState<ActiveCompany | null>(
    null
  );

  useEffect(() => {
    async function loadCompanies() {
      setLoading(true);
      setError(null);
      setNeedLogin(false);

      const stored = loadActiveCompany();
      if (stored) {
        setActiveCompany(stored);
      }
      const {
        data: sessionData,
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !sessionData.session) {
        setNeedLogin(true);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("companies")
        .select("id, name, is_active")
        .order("name");

      if (error) {
        setError(error.message);
      } else {
        setCompanies(data ?? []);
      }
      setLoading(false);
    }

    loadCompanies();
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Companies</h2>

      {needLogin && (
        <p className="text-slate-300">
          You&apos;re not logged in. Please{" "}
          <a href="/login" className="text-emerald-400 underline">
            log in
          </a>{" "}
          to see your companies.
        </p>
      )}

      {loading && <p className="text-slate-300">Loading companies…</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}

      {!loading && !error && !needLogin && companies.length === 0 && (
        <p className="text-slate-300">
          No companies found yet. Once you create them in Supabase (or later
          from this app), they will show up here.
        </p>
      )}

      {!loading && !error && companies.length > 0 && (
        <div className="space-y-3">
          {activeCompany && (
            <p className="text-sm text-emerald-300">
              Current active company:{" "}
              <span className="font-semibold">{activeCompany.name}</span>
            </p>
          )}
          <ul className="space-y-2">
            {companies.map((c) => {
              const isActive =
                activeCompany && activeCompany.id === c.id ? true : false;
              return (
                <li
                  key={c.id}
                  className="rounded border border-slate-800 bg-slate-900 px-4 py-2 flex items-center justify-between gap-4"
                >
                  <div className="flex flex-col">
                    <span>{c.name}</span>
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      {c.is_active ? "Company Enabled" : "Company Disabled"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next: ActiveCompany = { id: c.id, name: c.name };
                      setActiveCompany(next);
                      saveActiveCompany(next);
                    }}
                    className={`rounded px-3 py-1 text-xs font-medium ${
                      isActive
                        ? "bg-emerald-500 text-slate-950"
                        : "border border-slate-700 text-slate-200 hover:border-emerald-400 hover:text-emerald-400"
                    }`}
                  >
                    {isActive ? "Active" : "Set active"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

