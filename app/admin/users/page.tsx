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

type InviteMode = "invite_email" | "set_password";

export default function AdminUsersPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<(Membership & { roles: UserRole[] })[]>([]);
  const [companyRoles, setCompanyRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMode, setInviteMode] = useState<InviteMode>("invite_email");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [skipEmailVerification, setSkipEmailVerification] = useState(true);
  const [inviteRoleIds, setInviteRoleIds] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);

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

  function toggleInviteRole(roleId: string) {
    setInviteRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]
    );
  }

  async function handleInviteOrCreate(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || !inviteEmail.trim()) return;
    setError(null);
    setSuccess(null);

    if (inviteMode === "set_password") {
      if (newPassword.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setInviting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("You are not logged in.");
        setInviting(false);
        return;
      }

      const res = await fetch("/api/admin/company-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          companyId: activeCompanyId,
          email: inviteEmail.trim().toLowerCase(),
          mode: inviteMode,
          password: inviteMode === "set_password" ? newPassword : undefined,
          skipEmailVerification: inviteMode === "set_password" ? skipEmailVerification : undefined,
          roleIds: inviteRoleIds.length ? inviteRoleIds : undefined,
        }),
      });

      const payload = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(payload.error ?? "Request failed");
        setInviting(false);
        return;
      }

      setSuccess(payload.message ?? "Done.");
      setInviteEmail("");
      setNewPassword("");
      setConfirmPassword("");
      setInviteRoleIds([]);
      loadMemberships(activeCompanyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
    setInviting(false);
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

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Company users</h2>
        <p className="text-slate-300">Select an active company first.</p>
        <Link href="/admin" className="text-emerald-400 hover:underline">
          Back to Admin
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-emerald-400 hover:underline">
          ← Admin
        </Link>
        <h2 className="text-xl font-semibold">Company users</h2>
        {companyName && <p className="text-sm text-slate-400">Company: {companyName}</p>}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}

      <div className="max-w-xl space-y-4 rounded border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Add user to company</h3>
        <p className="text-xs text-slate-500">
          Send an email invite (they choose a password from the link) or create the account here with a
          password. Server features require{" "}
          <code className="text-slate-400">SUPABASE_SERVICE_ROLE_KEY</code> in your deployment env (never
          in the browser).
        </p>

        <form onSubmit={handleInviteOrCreate} className="space-y-3">
          <div className="space-y-2">
            <label className="block text-xs text-slate-500">How to add</label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={inviteMode === "invite_email"}
                  onChange={() => setInviteMode("invite_email")}
                />
                Email invite (link to sign up)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={inviteMode === "set_password"}
                  onChange={() => setInviteMode("set_password")}
                />
                Set password now (admin-created)
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500">Email</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
              className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
              required
            />
          </div>

          {inviteMode === "set_password" && (
            <>
              <div>
                <label className="block text-xs text-slate-500">Temporary password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                  required
                  minLength={6}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={skipEmailVerification}
                  onChange={(e) => setSkipEmailVerification(e.target.checked)}
                />
                Mark email as confirmed (they can log in immediately without verifying email)
              </label>
            </>
          )}

          {companyRoles.length > 0 && (
            <div>
              <span className="block text-xs text-slate-500 mb-1">Initial roles (optional)</span>
              <div className="flex flex-wrap gap-2">
                {companyRoles.map((r) => (
                  <label key={r.id} className="flex items-center gap-1 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={inviteRoleIds.includes(r.id)}
                      onChange={() => toggleInviteRole(r.id)}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={inviting}
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {inviting
              ? "Working…"
              : inviteMode === "invite_email"
                ? "Send invite"
                : "Create user & add to company"}
          </button>
        </form>

        <p className="text-xs text-slate-500 border-t border-slate-800 pt-3">
          For email invites: add your site URL to Supabase Auth → URL configuration → Redirect URLs (e.g.{" "}
          <code className="text-slate-400">https://your-domain.com/auth/callback</code>
          ). Optionally set <code className="text-slate-400">NEXT_PUBLIC_SITE_URL</code> so redirects match
          production.
        </p>
      </div>

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
                          <input
                            type="checkbox"
                            checked={editRoleIds.includes(r.id)}
                            onChange={() => toggleEditRole(r.id)}
                          />
                          {r.name}
                        </label>
                      ))}
                      <button
                        type="submit"
                        disabled={savingRoles}
                        className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingMembershipId(null)}
                        className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      {((m.roles ?? []) as { roles: Role | null }[])
                        .map((r) => r.roles?.name)
                        .filter(Boolean)
                        .join(", ") || "—"}
                      <button
                        type="button"
                        onClick={() => openEditRoles(m)}
                        className="ml-2 text-xs text-emerald-400 hover:underline"
                      >
                        Edit roles
                      </button>
                    </>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => removeMember(m.id)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
