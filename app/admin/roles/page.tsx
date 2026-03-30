"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type Role = {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
};

type Permission = {
  id: string;
  code: string;
  description: string | null;
};

export default function AdminRolesPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPermIds, setFormPermIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    loadRoles(active.id);
    loadPermissions();
  }, []);

  async function loadPermissions() {
    const { data } = await supabase.from("permissions").select("id, code, description").eq("is_active", true).order("code");
    setPermissions(data ?? []);
  }

  async function loadRoles(companyId: string) {
    const { data: rolesData, error } = await supabase
      .from("roles")
      .select("id, company_id, name, description, is_system")
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order("company_id", { ascending: true, nullsFirst: false })
      .order("name");
    if (error) setError(error.message);
    else setRoles((rolesData ?? []) as Role[]);

    const ids = (rolesData ?? []).map((r) => r.id);
    if (ids.length > 0) {
      const { data: rp } = await supabase.from("role_permissions").select("role_id, permission_id").in("role_id", ids);
      const map: Record<string, string[]> = {};
      for (const r of rp ?? []) {
        if (!map[r.role_id]) map[r.role_id] = [];
        map[r.role_id].push(r.permission_id);
      }
      setRolePerms(map);
    } else setRolePerms({});
    setLoading(false);
  }

  function openNew() {
    setEditingId(null);
    setFormName("");
    setFormDesc("");
    setFormPermIds([]);
  }

  function openEdit(role: Role) {
    if (role.is_system && role.company_id === null) return;
    setEditingId(role.id);
    setFormName(role.name);
    setFormDesc(role.description ?? "");
    setFormPermIds(rolePerms[role.id] ?? []);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    if (editingId) {
      await supabase.from("roles").update({ name: formName.trim(), description: formDesc.trim() || null }).eq("id", editingId);
      await supabase.from("role_permissions").delete().eq("role_id", editingId);
      if (formPermIds.length > 0) {
        await supabase.from("role_permissions").insert(formPermIds.map((permission_id) => ({ role_id: editingId, permission_id })));
      }
    } else {
      const { data: newRole, error } = await supabase.from("roles").insert({
        company_id: activeCompanyId,
        name: formName.trim(),
        description: formDesc.trim() || null,
        is_system: false,
      }).select("id").single();
      if (error) setError(error.message);
      else if (newRole && formPermIds.length > 0) {
        await supabase.from("role_permissions").insert(formPermIds.map((permission_id) => ({ role_id: newRole.id, permission_id })));
      }
    }
    setSaving(false);
    setEditingId(null);
    if (activeCompanyId) loadRoles(activeCompanyId);
  }

  async function handleDelete(role: Role) {
    if (role.is_system && role.company_id === null) return;
    if (!confirm(`Delete role "${role.name}"?`)) return;
    await supabase.from("roles").delete().eq("id", role.id);
    if (activeCompanyId) loadRoles(activeCompanyId);
  }

  function togglePerm(permId: string) {
    setFormPermIds((prev) => (prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]));
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Roles</h2>
        <p className="text-slate-300">Select an active company first.</p>
        <Link href="/admin" className="text-emerald-400 hover:underline">Back to Admin</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-emerald-400 hover:underline">← Admin</Link>
        <h2 className="text-xl font-semibold">Roles</h2>
        {companyName && <p className="text-sm text-slate-400">Company: {companyName}</p>}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {(editingId || (!editingId && roles.filter((r) => r.company_id === activeCompanyId).length === 0)) ? (
        <form onSubmit={handleSave} className="rounded border border-slate-800 bg-slate-900/50 p-4 max-w-xl space-y-3">
          <h3 className="text-sm font-semibold text-slate-200">{editingId ? "Edit role" : "Create role"}</h3>
          <div>
            <label className="block text-xs text-slate-500">Name</label>
            <input value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-slate-500">Description</label>
            <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Permissions</label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto rounded border border-slate-700 bg-slate-950 p-2">
              {permissions.map((p) => (
                <label key={p.id} className="flex items-center gap-1 text-xs text-slate-300">
                  <input type="checkbox" checked={formPermIds.includes(p.id)} onChange={() => togglePerm(p.id)} />
                  {p.code}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-50">Save</button>
            {editingId && <button type="button" onClick={() => setEditingId(null)} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300">Cancel</button>}
          </div>
        </form>
      ) : (
        <button type="button" onClick={openNew} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">+ Create role</button>
      )}

      {!loading && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Permissions</th>
              <th className="py-2 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} className="border-b border-slate-900 hover:bg-slate-900/60">
                <td className="py-2 pr-3 font-medium text-slate-200">{role.name}</td>
                <td className="py-2 pr-3 text-slate-400">{role.company_id ? "Company" : "Template"}</td>
                <td className="py-2 pr-3 text-xs text-slate-500">{(rolePerms[role.id] ?? []).length} permissions</td>
                <td className="py-2 pr-3">
                  {role.company_id && (
                    <>
                      <button type="button" onClick={() => openEdit(role)} className="text-xs text-emerald-400 hover:underline mr-2">Edit</button>
                      {!role.is_system && <button type="button" onClick={() => handleDelete(role)} className="text-xs text-red-400 hover:underline">Delete</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
