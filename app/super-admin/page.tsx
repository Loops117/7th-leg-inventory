"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { getCurrentUserPermissions } from "@/lib/permissions";

type Company = {
  id: string;
  name: string;
  is_active: boolean;
};

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  is_super_admin: boolean;
};

export default function SuperAdminPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [companyForm, setCompanyForm] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyActive, setCompanyActive] = useState(true);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [savingCompany, setSavingCompany] = useState(false);

  const [savingSuperAdmin, setSavingSuperAdmin] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUserPermissions(null).then(({ isSuperAdmin: sa }) => {
      setIsSuperAdmin(sa);
      if (!sa) {
        setLoading(false);
        return;
      }
      loadCompanies();
      loadProfiles();
    });
  }, []);

  async function loadCompanies() {
    const { data, error } = await supabase.from("companies").select("id, name, is_active").order("name");
    if (error) setError(error.message);
    else setCompanies(data ?? []);
    setLoading(false);
  }

  async function loadProfiles() {
    const { data } = await supabase.from("profiles").select("id, full_name, email, is_super_admin").order("email");
    setProfiles((data ?? []) as Profile[]);
  }

  function openAddCompany() {
    setEditingCompanyId(null);
    setCompanyName("");
    setCompanyActive(true);
    setCompanyForm(true);
  }

  function openEditCompany(c: Company) {
    setEditingCompanyId(c.id);
    setCompanyName(c.name);
    setCompanyActive(c.is_active);
    setCompanyForm(true);
  }

  async function handleSaveCompany(e: FormEvent) {
    e.preventDefault();
    setSavingCompany(true);
    if (editingCompanyId) {
      const { error } = await supabase
        .from("companies")
        .update({ name: companyName.trim(), is_active: companyActive })
        .eq("id", editingCompanyId);
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.from("companies").insert({ name: companyName.trim(), is_active: companyActive });
      if (error) setError(error.message);
    }
    setSavingCompany(false);
    setCompanyForm(false);
    loadCompanies();
  }

  async function handleDeleteCompany(id: string) {
    if (!confirm("Delete this company and all its data? This cannot be undone.")) return;
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) setError(error.message);
    else loadCompanies();
  }

  async function toggleSuperAdmin(profileId: string, current: boolean) {
    setSavingSuperAdmin(profileId);
    const { error } = await supabase.from("profiles").update({ is_super_admin: !current }).eq("id", profileId);
    if (error) setError(error.message);
    else loadProfiles();
    setSavingSuperAdmin(null);
  }

  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Super Admin</h2>
        <p className="text-slate-300">You don’t have access to this section.</p>
        <Link href="/admin" className="text-emerald-400 hover:underline">Back to Admin</Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-xs text-emerald-400 hover:underline">← Admin</Link>
        <h2 className="text-xl font-semibold text-amber-400">Super Admin</h2>
        <p className="text-sm text-slate-500">Manage companies and super admin users.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Companies</h3>
        {companyForm ? (
          <form onSubmit={handleSaveCompany} className="space-y-3 max-w-md">
            <div>
              <label className="block text-xs text-slate-500">Name</label>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={companyActive} onChange={(e) => setCompanyActive(e.target.checked)} />
              Active
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={savingCompany} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50">
                {savingCompany ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setCompanyForm(false)} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={openAddCompany} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 mb-3">
            + Add company
          </button>
        )}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-slate-400">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-b border-slate-800">
                <td className="py-2 pr-3 text-slate-200">{c.name}</td>
                <td className="py-2 pr-3 text-slate-400">{c.is_active ? "Active" : "Inactive"}</td>
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => openEditCompany(c)} className="text-xs text-emerald-400 hover:underline mr-2">Edit</button>
                  <button type="button" onClick={() => handleDeleteCompany(c.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Super admins</h3>
        <p className="text-xs text-slate-500 mb-2">Toggle super admin for a user. Super admins have full access to all companies and settings.</p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-slate-400">
              <th className="py-2 pr-3">User</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Super admin</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-slate-800">
                <td className="py-2 pr-3 text-slate-200">{p.full_name ?? "—"}</td>
                <td className="py-2 pr-3 text-slate-400">{p.email ?? "—"}</td>
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => toggleSuperAdmin(p.id, p.is_super_admin)}
                    disabled={savingSuperAdmin === p.id}
                    className={`rounded px-2 py-1 text-xs font-medium ${p.is_super_admin ? "bg-amber-600 text-black" : "border border-slate-600 text-slate-400"} disabled:opacity-50`}
                  >
                    {p.is_super_admin ? "Yes" : "Set as super admin"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}