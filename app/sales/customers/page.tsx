"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";

type Customer = {
  id: string;
  company_id: string;
  customer_code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  notes: string | null;
};

const emptyForm = () => ({
  customer_code: "",
  name: "",
  email: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
  notes: "",
});

export default function SalesCustomersPage() {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const active = loadActiveCompany();
    if (!active) {
      setLoading(false);
      return;
    }
    setActiveCompanyId(active.id);
    setCompanyName(active.name);
    loadCustomers(active.id);
  }, []);

  async function loadCustomers(companyId: string) {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("customers")
      .select(
        "id, company_id, customer_code, name, email, phone, address_line1, address_line2, city, state, postal_code, country, notes",
      )
      .eq("company_id", companyId)
      .order("name");

    if (qErr) {
      setError(qErr.message);
      setCustomers([]);
    } else {
      setCustomers((data ?? []) as Customer[]);
    }
    setLoading(false);
  }

  function openNew() {
    setEditingId(null);
    setShowForm(true);
    setError(null);
    setForm(emptyForm());
  }

  function openEdit(c: Customer) {
    setEditingId(c.id);
    setShowForm(true);
    setError(null);
    setForm({
      customer_code: c.customer_code ?? "",
      name: c.name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      address_line1: c.address_line1 ?? "",
      address_line2: c.address_line2 ?? "",
      city: c.city ?? "",
      state: c.state ?? "",
      postal_code: c.postal_code ?? "",
      country: c.country ?? "",
      notes: c.notes ?? "",
    });
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    const name = form.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      customer_code: form.customer_code.trim() || null,
      name,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address_line1: form.address_line1.trim() || null,
      address_line2: form.address_line2.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      postal_code: form.postal_code.trim() || null,
      country: form.country.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (editingId) {
      const { error: uErr } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", editingId)
        .eq("company_id", activeCompanyId);
      if (uErr) {
        setError(uErr.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: iErr } = await supabase.from("customers").insert({
        company_id: activeCompanyId,
        ...payload,
      });
      if (iErr) {
        setError(iErr.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    closeForm();
    loadCustomers(activeCompanyId);
  }

  async function handleDelete(id: string) {
    if (!activeCompanyId) return;
    if (!confirm("Delete this customer? Sales orders will keep a copy of past links where applicable.")) return;
    setError(null);
    const { error: dErr } = await supabase
      .from("customers")
      .delete()
      .eq("id", id)
      .eq("company_id", activeCompanyId);
    if (dErr) setError(dErr.message);
    else loadCustomers(activeCompanyId);
  }

  function formatAddress(c: Customer) {
    const parts = [
      [c.address_line1, c.address_line2].filter(Boolean).join(", "),
      [c.city, c.state, c.postal_code].filter(Boolean).join(", "),
      c.country,
    ].filter((p) => p && String(p).trim());
    return parts.length ? parts.join(" · ") : "—";
  }

  if (!activeCompanyId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-emerald-300">Customers</h2>
        <p className="text-slate-300">Select an active company first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-emerald-300">Customers</h2>
          <p className="text-[11px] text-slate-500">
            Master list for {companyName ?? "this company"} only — other companies cannot see these records.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/sales"
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-900"
          >
            Sales dashboard
          </Link>
          <button
            type="button"
            onClick={openNew}
            className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-800/80"
          >
            Add customer
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading customers…</div>
      ) : (
        <div className="overflow-hidden rounded border border-slate-800 bg-black/30">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-normal">Name</th>
                <th className="px-3 py-2 font-normal">Code</th>
                <th className="px-3 py-2 font-normal">Email</th>
                <th className="px-3 py-2 font-normal">Phone</th>
                <th className="px-3 py-2 font-normal">Address</th>
                <th className="px-3 py-2 font-normal w-28"></th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-slate-500">
                    No customers yet.
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="border-t border-slate-900/70">
                    <td className="px-3 py-2 text-slate-100">{c.name}</td>
                    <td className="px-3 py-2 text-slate-400">{c.customer_code ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-400">{(c.email ?? "").trim() || "—"}</td>
                    <td className="px-3 py-2 text-slate-400">{(c.phone ?? "").trim() || "—"}</td>
                    <td className="max-w-xs px-3 py-2 text-slate-400 truncate" title={formatAddress(c)}>
                      {formatAddress(c)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="mr-2 text-emerald-400 hover:text-emerald-300"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded border border-slate-800 bg-slate-950 p-4 text-slate-200 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-emerald-200">
                {editingId ? "Edit customer" : "New customer"}
              </div>
              <button
                type="button"
                onClick={closeForm}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-900"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="block text-[11px] text-slate-400">Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400">Customer code</label>
                  <input
                    value={form.customer_code}
                    onChange={(e) => setForm((f) => ({ ...f, customer_code: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                  />
                </div>
                <div />
                <div>
                  <label className="block text-[11px] text-slate-400">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400">Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div className="rounded border border-slate-800 bg-black/20 p-3 space-y-2">
                <div className="text-[11px] font-medium text-slate-300">Address</div>
                <div>
                  <label className="block text-[11px] text-slate-500">Line 1</label>
                  <input
                    value={form.address_line1}
                    onChange={(e) => setForm((f) => ({ ...f, address_line1: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500">Line 2</label>
                  <input
                    value={form.address_line2}
                    onChange={(e) => setForm((f) => ({ ...f, address_line2: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <label className="block text-[11px] text-slate-500">City</label>
                    <input
                      value={form.city}
                      onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">State / Province</label>
                    <input
                      value={form.state}
                      onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Postal code</label>
                    <input
                      value={form.postal_code}
                      onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Country</label>
                    <input
                      value={form.country}
                      onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="mt-1 h-16 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded border border-emerald-700 bg-emerald-900/50 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-800/80 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
