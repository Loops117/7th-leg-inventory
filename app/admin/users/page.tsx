"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type Membership = {
  id: string;
  user_id: string;
  company_id: string;
  is_active: boolean;
  default_company: boolean;
  profiles: Profile | null;
};

type Role = {
  id: string;
  name: string;
};

type UserRole = {
  role_id: string;
  roles: Role | null;
};

export default function AdminUsersPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<(Membership & { roles: UserRole[] })[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [companyRoles, setCompanyRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addEmail, setAddEmail] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    loadMemberships(active.id);
    loadCompanyRoles(active.id);
    loadAllProfiles();
  }, []);

  async function loadMemberships(companyId: string) {
    const { data: memData, error } = await supabase
      .from("company_memberships")
      .select("id, user_id, company_id, is_active, default_company, profiles(id, full_name, email)")
      .eq("company_id", companyId)
      .eq("is_active", true);
    if (error) setError(error.message);
    const mems = (memData ?? []) as (Membership & { roles?: UserRole[] })[];
    const ids = mems.map((m) => m.id);
    if (ids.length > 0) {
      const { data: urData } = await supabase
        .from("user_company_roles")
        .select("membership_id, role_id, roles(id, name)")
        .in("membership_id", ids);
      const byMem = new Map<string, UserRole[]>();
      for (const ur of urData ?? []) {
        const u = ur as UserRole & { membership_id: string };
        if (!byMem.has(u.membership_id)) byMem.set(u.membership_id, []);
        byMem.get(u.membership_id)!.push({ role_id: u.role_id, roles: u.roles });
      }
      setMemberships(mems.map((m) => ({ ...m, roles: byMem.get(m.id) ?? [] })));
    } else setMemberships(mems as (Membership & { roles: UserRole[] })[]);
    setLoading(false);
  }

  async function loadCompanyRoles(companyId: string) {
    const { data } = await supabase
      .from("roles")
      .select("id, name")
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .eq("is_active", true)
      .order("name");
    setCompanyRoles((data ?? []) as Role[]);
  }

  async function loadAllProfiles() {
    const { data } = await supabase.from("profiles").select("id, full_name, email").order("email");
    setAllProfiles((data ?? []) as Profile[]);
  }

  async function handleAddByEmail(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || !addEmail.trim()) return;
    setAdding(true);
    const email = addEmail.trim().toLowerCase();
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .single();
    if (!profile) {
      setError("No user found with that email. They must sign up first.");
      setAdding(false);
      return;
    }
    const { error } = await supabase.from("company_memberships").insert({
      user_id: profile.id,
      company_id: activeCompanyId,
      is_active: true,
      default_company: false,
    });
    if (error) setError(error.message);
    else {
      setAddEmail("");
      setError(null);
      loadMemberships(activeCompanyId);
    }
    setAdding(false);
  }

  function openEditRoles(m: Membership & { roles: UserRole[] }) {
    setEditingMembershipId(m.id);
    setEditRoleIds(m.roles.map((r) => r.role_id));
  }

  async function saveRoles(e: FormEvent) {
    e.preventDefault();
    if (!editingMembershipId) return;
    setSavingRoles(true);
    await supabase.from("user_company_roles").delete().eq("membership_id", editingMembershipId);
    if (editRoleIds.length > 0) {
      await supabase.from("user_company_roles").insert(
        editRoleIds.map((role_id) => ({ membership_id: editingMembershipId, role_id }))
      );
    }
    setSavingRoles(false);
    setEditingMembershipId(null);
    if (activeCompanyId) loadMemberships(activeCompanyId);
  }

  function toggleEditRole(roleId: string) {
    setEditRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));
  }

  async function removeMember(membershipId: string) {
    if (!confirm("Remove this user from the company?")) return;
    await supabase.from("company_memberships").update({ is_active: false }).eq("id", membershipId);
    if (activeCompanyId) loadMemberships(activeCompanyId);
  }

  const searchProfiles = addSearch.trim()
    ? allProfiles.filter(
        (p) =>
          !memberships.some((m) => m.user_id === p.id) &&
          (p.email?.toLowerCase().includes(addSearch.toLowerCase()) ||
            p.full_name?.toLowerCase().includes(addSearch.toLowerCase()))
      )
    : [];

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Company users</h2>
        <p className="text-slate-300">Select an active company first.</p>
        <Link href="/admin" className="text-emerald-400 hover:underline">Back to Admin</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-emerald-400 hover:underline">← Admin</Link>
        <h2 className="text-xl font-semibold">Company users</h2>
        {companyName && <p className="text-sm text-slate-400">Company: {companyName}</p>}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <form onSubmit={handleAddByEmail} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-slate-500">Add member by email</label>
          <input
            type="email"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            placeholder="user@example.com"
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm w-56"
          />
        </div>
        <button type="submit" disabled={adding} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50">
          Add
        </button>
      </form>
      <p className="text-xs text-slate-500">User must have signed up already. Add by email to look up their account.</p>

      {loading && <p className="text-slate-400">Loading…</p>}
      {!loading && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2 pr-3">User</th>
              <th className="py-2 pr-3">Roles</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.id} className="border-b border-slate-900 hover:bg-slate-900/60">
                <td className="py-2 pr-3">
                  <span className="text-slate-200">{(m.profiles as Profile)?.full_name ?? "—"}</span>
                  <span className="text-slate-500 text-xs block">{(m.profiles as Profile)?.email}</span>
                </td>
                <td className="py-2 pr-3 text-slate-400">
                  {editingMembershipId === m.id ? (
                    <form onSubmit={saveRoles} className="flex flex-wrap gap-2 items-center">
                      {companyRoles.map((r) => (
                        <label key={r.id} className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={editRoleIds.includes(r.id)} onChange={() => toggleEditRole(r.id)} />
                          {r.name}
                        </label>
                      ))}
                      <button type="submit" disabled={savingRoles} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white">Save</button>
                      <button type="button" onClick={() => setEditingMembershipId(null)} className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300">Cancel</button>
                    </form>
                  ) : (
                    <>
                      {((m.roles ?? []) as { roles: Role | null }[]).map((r) => r.roles?.name).filter(Boolean).join(", ") || "—"}
                      <button type="button" onClick={() => openEditRoles(m)} className="ml-2 text-xs text-emerald-400 hover:underline">Edit roles</button>
                    </>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => removeMember(m.id)} className="text-xs text-red-400 hover:underline">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
