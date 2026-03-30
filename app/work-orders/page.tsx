"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Database } from "@/types/supabase";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCurrentUserPermissions } from "@/lib/permissions";
import { getCostFromTransactions, type CostType } from "@/lib/cost";

type WorkOrder = Database["public"]["Tables"]["work_orders"]["Row"];
type WorkOrderAssignment =
  Database["public"]["Tables"]["work_order_assignments"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type AssignmentWithRelations = WorkOrderAssignment & {
  work_order: WorkOrder;
  assignee_profile: Pick<Profile, "id" | "full_name" | "email"> | null;
};

function WorkOrdersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [assignments, setAssignments] = useState<AssignmentWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string>("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);

  const [showAssign, setShowAssign] = useState(false);
  const [assignWorkOrders, setAssignWorkOrders] = useState<WorkOrder[]>([]);
  const [assignUsers, setAssignUsers] = useState<Profile[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignWorkOrderId, setAssignWorkOrderId] = useState<string>("");
  const [assignAssigneeId, setAssignAssigneeId] = useState<string | "open">(
    "open",
  );
  const [assignQuantity, setAssignQuantity] = useState<string>("");
  const [assignQueue, setAssignQueue] =
    useState<AssignmentWithRelations[]>([]);
  const [assignQueueLoading, setAssignQueueLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);

  const [assignInsertIndex, setAssignInsertIndex] = useState<number>(0);

  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [tableSortKey, setTableSortKey] =
    useState<"wo" | "qty" | "assignee" | "status" | "order" | "last_done">(
      "order",
    );
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("asc");
  const [assigneeFilterOpen, setAssigneeFilterOpen] = useState(false);
  const [assigneeFilterValues, setAssigneeFilterValues] = useState<string[]>(
    [],
  );

  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(
    null,
  );
  const [editingAssignment, setEditingAssignment] =
    useState<AssignmentWithRelations | null>(null);

  const [timeEvents, setTimeEvents] = useState<
    { id: string; event_type: string; occurred_at: string }[]
  >([]);
  const [timeRows, setTimeRows] = useState<
    {
      start_event_id: string | null;
      stop_event_id: string | null;
      date: string;
      start_time: string; // HH:MM:SS
      stop_time: string; // HH:MM:SS
    }[]
  >([]);
  const [savingRowIdx, setSavingRowIdx] = useState<number | null>(null);
  const [leftWidthPct, setLeftWidthPct] = useState<number>(60);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => {
      const container = document.getElementById("wo-layout-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.min(80, Math.max(30, (x / rect.width) * 100));
      setLeftWidthPct(pct);
    };
    const handleUp = () => {
      setIsResizing(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing]);

  type PickListItemRow = {
    item_id: string;
    sku: string;
    item_name: string;
    location_name: string;
    current_qty: number;
    required_qty: number;
  };

  const [pickSelectedAssignmentIds, setPickSelectedAssignmentIds] = useState<
    string[]
  >([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickItems, setPickItems] = useState<PickListItemRow[]>([]);

  const [pickSortKey, setPickSortKey] = useState<
    "sku" | "item_name" | "location_name" | "current_qty" | "required_qty"
  >("sku");
  const [pickSortDir, setPickSortDir] = useState<"asc" | "desc">("asc");

  const selected = useMemo(
    () => assignments.find((a) => a.id === selectedId) ?? null,
    [assignments, selectedId],
  );

  const assigneeLabel = (a: AssignmentWithRelations) =>
    a.is_open
      ? "Open"
      : (a.assignee_profile?.full_name ??
          a.assignee_profile?.email ??
          a.assignee_id ??
          "");

  const sortedAssignmentsForTable = useMemo(() => {
    const dir = tableSortDir === "asc" ? 1 : -1;
    let list = [...assignments];
    const nameOf = (a: AssignmentWithRelations) => {
      const wo = (a as any).work_order;
      const isOrphaned =
        wo == null || (wo && (wo.name == null || String(wo.name).trim() === ""));
      return isOrphaned ? "Unknown work order (orphaned)" : (a.work_order?.name ?? "");
    };
    const assigneeOf = assigneeLabel;
    const lastDone = (a: AssignmentWithRelations) =>
      a.last_completed_at ? new Date(a.last_completed_at as any).getTime() : 0;
    // Apply assignee filter (multi-select)
    if (assigneeFilterValues.length > 0) {
      list = list.filter((a) => {
        const label = assigneeOf(a);
        if (label === "Open") {
          return assigneeFilterValues.includes("__open__");
        }
        return assigneeFilterValues.includes(label);
      });
    }

    list.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (tableSortKey === "wo") {
        av = nameOf(a);
        bv = nameOf(b);
      } else if (tableSortKey === "qty") {
        av = Number(a.quantity_to_build ?? 0);
        bv = Number(b.quantity_to_build ?? 0);
      } else if (tableSortKey === "assignee") {
        av = assigneeOf(a);
        bv = assigneeOf(b);
      } else if (tableSortKey === "status") {
        av = a.status ?? "";
        bv = b.status ?? "";
      } else if (tableSortKey === "order") {
        av = Number(a.order_index ?? 0);
        bv = Number(b.order_index ?? 0);
      } else if (tableSortKey === "last_done") {
        av = lastDone(a);
        bv = lastDone(b);
      }
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return list;
  }, [assignments, tableSortKey, tableSortDir, assigneeFilterValues]);

  const toggleTableSort = (key: typeof tableSortKey) => {
    if (tableSortKey === key) {
      setTableSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTableSortKey(key);
      setTableSortDir("asc");
    }
  };

  const currentAssignWorkOrder = useMemo(
    () =>
      assignWorkOrders.find((wo) => wo.id === assignWorkOrderId) ?? null,
    [assignWorkOrders, assignWorkOrderId],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data: auth } = await supabase.auth.getUser();
      const activeCompany = loadActiveCompany();

      if (!auth.user || !activeCompany) {
        setAssignments([]);
        setLoading(false);
        return;
      }

      setUserId(auth.user.id);
      setActiveCompanyId(activeCompany.id);

      const perms = await getCurrentUserPermissions(activeCompany.id);
      const isAdminUser = perms.isSuperAdmin;
      setIsAdmin(isAdminUser);

      let baseQuery = supabase
        .from("work_order_assignments")
        .select(
          `
          *,
          work_order:work_orders(*),
          assignee_profile:profiles!work_order_assignments_assignee_id_fkey(id, full_name, email)
        `,
        )
        .eq("company_id", activeCompany.id)
        .order("order_index", { ascending: true });

      // Apply status filter
      if (statusFilter === "active") {
        baseQuery = baseQuery.in("status", ["open", "in_progress", "paused"]);
      } else if (statusFilter === "all") {
        // no extra filter
      } else if (statusFilter === "closed") {
        baseQuery = baseQuery.in("status", ["completed", "cancelled"]);
      } else {
        baseQuery = baseQuery.eq("status", statusFilter);
      }

      const { data, error: qError } = isAdminUser
        ? await baseQuery
        : await baseQuery.or(
            `assignee_id.eq.${auth.user.id},is_open.eq.true`,
          );

      if (qError) {
        console.error(qError);
        setError("Failed to load work orders.");
        setAssignments([]);
      } else {
        const rows =
          (data as unknown as AssignmentWithRelations[] | null) ?? [];
        setAssignments(rows);
        if (rows.length && !selectedId) {
          setSelectedId(rows[0].id);
          setNotesDraft(rows[0].notes ?? "");
        }
      }

      setLoading(false);
    };

    load();
  }, [statusFilter]);

  useEffect(() => {
    if (selected) {
      setNotesDraft(selected.notes ?? "");
    }
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setTimeEvents([]);
      setTimeRows([]);
      return;
    }
    loadTimeEvents(selected);
  }, [selected]);

  // Open assign modal when navigating from tree with ?assign=work_order_id
  useEffect(() => {
    const woId = searchParams.get("assign");
    if (!woId || !activeCompanyId || !isAdmin) return;
    openAssignModal(undefined, woId).then(() => {
      router.replace("/work-orders", { scroll: false });
    });
  }, [searchParams.get("assign"), activeCompanyId, isAdmin]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
  };

  const saveNotes = async () => {
    if (!selected) return;
    setSavingNotes(true);
    const { error: uError } = await supabase
      .from("work_order_assignments")
      .update({ notes: notesDraft })
      .eq("id", selected.id);
    if (uError) {
      console.error(uError);
      setError("Failed to save notes.");
    } else {
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === selected.id ? { ...a, notes: notesDraft } : a,
        ),
      );
    }
    setSavingNotes(false);
  };

  const createEvent = async (
    nextStatus: WorkOrderAssignment["status"],
    eventType: "start" | "pause" | "resume" | "complete" | "cancel",
  ) => {
    if (!selected || !userId) return;
    setCreatingEvent(true);
    setError(null);

    const { error: evError } = await supabase
      .from("work_order_events")
      .insert({
        assignment_id: selected.id,
        user_id: userId,
        event_type: eventType,
      });

    if (evError) {
      console.error(evError);
      setError("Failed to record work order event.");
      setCreatingEvent(false);
      return;
    }

    const patch: Partial<WorkOrderAssignment> = {
      status: nextStatus,
    };
    if (eventType === "complete") {
      patch.last_completed_at = new Date().toISOString() as unknown as any;
    }

    const { error: updError } = await supabase
      .from("work_order_assignments")
      .update(patch)
      .eq("id", selected.id);

    if (updError) {
      console.error(updError);
      setError("Failed to update work order status.");
    } else {
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === selected.id ? { ...a, ...patch } : a,
        ) as AssignmentWithRelations[],
      );

      if (eventType === "complete") {
        const updated =
          (assignments.find((a) => a.id === selected.id) as
            | AssignmentWithRelations
            | undefined) ?? selected;
        await recordCompletionInventory(updated);
      }
      // refresh time log for this assignment
      await loadTimeEvents(selected);
    }

    setCreatingEvent(false);
  };

  const completeAssignment = async () => {
    if (!selected || !userId) return;
    setCreatingEvent(true);
    setError(null);

    // Determine if there's an open start/resume with no pause/complete
    const evs = timeEvents ?? [];
    let openStart: { id: string; occurred_at: string } | null = null;
    for (const e of evs) {
      if (e.event_type === "start" || e.event_type === "resume") {
        openStart = { id: e.id, occurred_at: e.occurred_at };
      } else if (e.event_type === "pause" || e.event_type === "complete") {
        openStart = null;
      }
    }
    const hasAnyTiming = evs.some(
      (e) => e.event_type === "start" || e.event_type === "resume",
    );

    if (!hasAnyTiming) {
      const ok = confirm(
        "No time entries exist for this work order. It will be marked completed and inventory will be accounted for, but no time will be recorded. Continue?",
      );
      if (!ok) {
        setCreatingEvent(false);
        return;
      }
    }

    // If there is an open start, close it with a complete event now.
    if (openStart) {
      const { error: evError } = await supabase.from("work_order_events").insert({
        assignment_id: selected.id,
        user_id: userId,
        event_type: "complete",
        occurred_at: new Date().toISOString(),
      });
      if (evError) {
        console.error(evError);
        setError("Failed to record completion time.");
        setCreatingEvent(false);
        return;
      }
    }

    const patch: Partial<WorkOrderAssignment> = {
      status: "completed",
      last_completed_at: new Date().toISOString() as unknown as any,
    };

    const { error: updError } = await supabase
      .from("work_order_assignments")
      .update(patch)
      .eq("id", selected.id);

    if (updError) {
      console.error(updError);
      setError("Failed to update work order status.");
      setCreatingEvent(false);
      return;
    }

    setAssignments((prev) =>
      prev.map((a) => (a.id === selected.id ? { ...a, ...patch } : a)) as AssignmentWithRelations[],
    );

    const updated =
      (assignments.find((a) => a.id === selected.id) as
        | AssignmentWithRelations
        | undefined) ?? selected;
    await recordCompletionInventory(updated);

    await loadTimeEvents(selected);
    setCreatingEvent(false);
  };

  const loadTimeEvents = async (assignment: AssignmentWithRelations) => {
    const { data, error } = await supabase
      .from("work_order_events")
      .select("id, event_type, occurred_at")
      .eq("assignment_id", assignment.id)
      .order("occurred_at", { ascending: true });
    if (error) {
      console.error(error);
      setError("Failed to load time events for this assignment.");
      setTimeEvents([]);
      return;
    }
    const events =
      ((data ?? []) as { id: string; event_type: string; occurred_at: string }[]) ??
      [];
    setTimeEvents(events);

    // Build excel-like rows: each row is a start/resume → pause/complete segment
    const rows: {
      start_event_id: string | null;
      stop_event_id: string | null;
      date: string;
      start_time: string;
      stop_time: string;
    }[] = [];

    const toLocalDate = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);
    const toLocalTime = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(11, 19);

    let currentStart: { id: string; ts: Date } | null = null;
    for (const e of events) {
      const ts = new Date(e.occurred_at);
      if (e.event_type === "start" || e.event_type === "resume") {
        currentStart = { id: e.id, ts };
      } else if (
        (e.event_type === "pause" || e.event_type === "complete") &&
        currentStart
      ) {
        rows.push({
          start_event_id: currentStart.id,
          stop_event_id: e.id,
          date: toLocalDate(currentStart.ts),
          start_time: toLocalTime(currentStart.ts),
          stop_time: toLocalTime(ts),
        });
        currentStart = null;
      }
    }

    // Always keep one empty row ready for manual entry
    const now = new Date();
    const today = toLocalDate(now);
    rows.push({
      start_event_id: null,
      stop_event_id: null,
      date: today,
      start_time: "",
      stop_time: "",
    });
    setTimeRows(rows);
  };

  const persistTimeRow = async (idx: number) => {
    if (!selected || !userId) return;
    const row = timeRows[idx];
    if (!row) return;
    const allEmpty = !row.date && !row.start_time && !row.stop_time;
    const hasIds = Boolean(row.start_event_id && row.stop_event_id);
    // If user cleared an existing row, delete its underlying events
    if (allEmpty && hasIds) {
      setSavingRowIdx(idx);
      setError(null);
      try {
        const { error: d1 } = await supabase
          .from("work_order_events")
          .delete()
          .eq("id", row.start_event_id as string);
        const { error: d2 } = await supabase
          .from("work_order_events")
          .delete()
          .eq("id", row.stop_event_id as string);
        if (d1 || d2) {
          console.error(d1 ?? d2);
          setError("Failed to delete time row.");
        } else {
          await loadTimeEvents(selected);
        }
      } finally {
        setSavingRowIdx(null);
      }
      return;
    }

    // only save when row is complete
    if (!row.date || !row.start_time || !row.stop_time) return;

    const start = new Date(`${row.date}T${row.start_time}`);
    const stop = new Date(`${row.date}T${row.stop_time}`);
    if (isNaN(start.getTime()) || isNaN(stop.getTime()) || stop <= start) {
      setError("Invalid start/stop times.");
      return;
    }

    setSavingRowIdx(idx);
    setError(null);
    try {
      if (row.start_event_id && row.stop_event_id) {
        // update existing events
        const { error: e1 } = await supabase
          .from("work_order_events")
          .update({ occurred_at: start.toISOString() })
          .eq("id", row.start_event_id);
        const { error: e2 } = await supabase
          .from("work_order_events")
          .update({ occurred_at: stop.toISOString() })
          .eq("id", row.stop_event_id);
        if (e1 || e2) {
          console.error(e1 ?? e2);
          setError("Failed to update time row.");
        } else {
          await loadTimeEvents(selected);
        }
      } else {
        // insert new segment as start + pause (so it doesn't force assignment completed)
        const { error } = await supabase.from("work_order_events").insert([
          {
            assignment_id: selected.id,
            user_id: userId,
            event_type: "start",
            occurred_at: start.toISOString(),
          },
          {
            assignment_id: selected.id,
            user_id: userId,
            event_type: "pause",
            occurred_at: stop.toISOString(),
          },
        ]);
        if (error) {
          console.error(error);
          setError("Failed to add time row.");
        } else {
          await loadTimeEvents(selected);
        }
      }
    } finally {
      setSavingRowIdx(null);
    }
  };

  const clearTimeRow = async (idx: number) => {
    if (!selected || !userId) return;
    const row = timeRows[idx];
    if (!row || !row.start_event_id || !row.stop_event_id) return;
    setSavingRowIdx(idx);
    setError(null);
    try {
      const { error: d1 } = await supabase
        .from("work_order_events")
        .delete()
        .eq("id", row.start_event_id as string);
      const { error: d2 } = await supabase
        .from("work_order_events")
        .delete()
        .eq("id", row.stop_event_id as string);
      if (d1 || d2) {
        console.error(d1 ?? d2);
        setError("Failed to delete time row.");
      } else {
        await loadTimeEvents(selected);
      }
    } finally {
      setSavingRowIdx(null);
    }
  };

  const updateTimeRow = (idx: number, patch: Partial<(typeof timeRows)[number]>) => {
    setTimeRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // Excel-like: if last row becomes "touched", ensure there's always one blank row at the bottom
      const last = next[next.length - 1];
      const hasBlank =
        last &&
        last.start_event_id == null &&
        last.stop_event_id == null &&
        !last.start_time &&
        !last.stop_time;
      if (!hasBlank) {
        const now = new Date();
        const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 10);
        next.push({
          start_event_id: null,
          stop_event_id: null,
          date: today,
          start_time: "",
          stop_time: "",
        });
      }
      return next;
    });
  };

  const loadAssignQueue = async (
    companyId: string,
    assignee: string | "open",
    focusAssignment?: AssignmentWithRelations | null,
  ) => {
    setAssignQueueLoading(true);
    setAssignError(null);

    let query = supabase
      .from("work_order_assignments")
      .select(
        `
        *,
        work_order:work_orders(id, name, work_order_number)
      `,
      )
      .eq("company_id", companyId)
      .in("status", ["open", "in_progress", "paused"])
      .order("order_index", { ascending: true });

    if (assignee === "open") {
      query = query.eq("is_open", true).is("assignee_id", null);
    } else {
      query = query.eq("assignee_id", assignee);
    }

    const { data, error: qErr } = await query;
    if (qErr) {
      console.error(qErr);
      setAssignError("Failed to load queue for selected user.");
      setAssignQueue([]);
    } else {
      let rows =
        ((data ?? []) as unknown as AssignmentWithRelations[]) ?? [];
      // Only include rows with valid id and a real work_order (has id + non-empty name) so we never show a "ghost" placeholder
      rows = rows.filter((r) => {
        const wo = (r as any).work_order;
        return (
          r.id &&
          typeof r.id === "string" &&
          r.work_order_id &&
          wo != null &&
          typeof wo === "object" &&
          wo.id != null &&
          wo.name != null &&
          String(wo.name).trim() !== ""
        );
      });

      if (focusAssignment) {
        const exists = rows.some((r) => r.id === focusAssignment.id);
        const desiredIsOpen = assignee === "open";
        const desiredAssigneeId =
          assignee === "open" ? (null as any) : (assignee as string);

        if (!exists) {
          rows = [
            ...rows,
            {
              ...focusAssignment,
              is_open: desiredIsOpen as any,
              assignee_id: desiredAssigneeId,
            },
          ];
        } else {
          rows = rows.map((r) =>
            r.id === focusAssignment.id
              ? {
                  ...r,
                  is_open: desiredIsOpen as any,
                  assignee_id: desiredAssigneeId,
                }
              : r,
          );
        }
      }

      rows.sort(
        (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
      );

      setAssignQueue(rows);
      setAssignInsertIndex(rows.length);
    }
    setAssignQueueLoading(false);
  };

  const openAssignModal = async (
    assignment?: AssignmentWithRelations | null,
    presetWorkOrderId?: string | null,
  ) => {
    if (!activeCompanyId) {
      const active = loadActiveCompany();
      if (!active) {
        setError("Select an active company first.");
        return;
      }
      setActiveCompanyId(active.id);
    }
    const companyId = activeCompanyId ?? loadActiveCompany()?.id;
    if (!companyId) return;

    const source = assignment ?? selected ?? null;
    setEditingAssignmentId(assignment ? assignment.id : null);
    setEditingAssignment(assignment ?? null);

    setShowAssign(true);
    setAssignError(null);
    setAssignLoading(true);

    const defaultWorkOrderId =
      presetWorkOrderId ?? source?.work_order_id ?? "";
    const defaultAssignee: string | "open" =
      source?.is_open === true
        ? "open"
        : (source?.assignee_id as string | null) ?? "open";

    const defaultQty =
      source?.quantity_to_build ??
      source?.work_order?.standard_quantity ??
      null;

    setAssignWorkOrderId(defaultWorkOrderId);
    setAssignAssigneeId(defaultAssignee);
    setAssignQuantity(defaultQty ? String(defaultQty) : "");

    const [{ data: woData, error: woErr }, { data: memData, error: memErr }] =
      await Promise.all([
        supabase
          .from("work_orders")
          .select("id, name, standard_quantity, standard_time_minutes")
          .eq("company_id", companyId)
          .order("name", { ascending: true }),
        supabase
          .from("company_memberships")
          .select("id, company_id, is_active, profiles(id, full_name, email)")
          .eq("company_id", companyId)
          .eq("is_active", true),
      ]);

    if (woErr || memErr) {
      console.error(woErr ?? memErr);
      setAssignError("Failed to load data for assignment.");
      setAssignLoading(false);
      return;
    }

    const workOrders = (woData ?? []) as unknown as WorkOrder[];
    const users: Profile[] =
      (memData ?? [])
        .map((m: any) => m.profiles)
        .filter(Boolean) ?? [];

    setAssignWorkOrders(workOrders);
    setAssignUsers(users);

    await loadAssignQueue(companyId, defaultAssignee, assignment ?? null);

    setAssignLoading(false);
  };

  const closeAssignModal = () => {
    setShowAssign(false);
    setAssignError(null);
    setAssignWorkOrderId("");
    setAssignAssigneeId("open");
    setAssignQuantity("");
    setAssignQueue([]);
    setAssignInsertIndex(0);
    setEditingAssignmentId(null);
    setEditingAssignment(null);
  };

  const handleChangeAssignee = async (value: string) => {
    const next: string | "open" = value === "open" ? "open" : value;
    setAssignAssigneeId(next);
    if (!activeCompanyId) return;
    await loadAssignQueue(
      activeCompanyId,
      next,
      editingAssignment ?? null,
    );
  };

  const handleAssignSave = async () => {
    if (!activeCompanyId) {
      setAssignError("Select an active company first.");
      return;
    }
    if (editingAssignmentId) {
      // Editing an existing assignment: update queue order, quantity, and assignee/open
      const existing = [...assignQueue];
      if (existing.length === 0) {
        setAssignError("Nothing to update.");
        return;
      }

      const assignment = existing.find((a) => a.id === editingAssignmentId);
      if (!assignment) {
        setAssignError("Assignment not found in queue.");
        return;
      }

      const baseWorkOrder = assignWorkOrders.find(
        (w) => w.id === assignment.work_order_id,
      );

      const qty =
        parseFloat(assignQuantity || "") ||
        Number(
          assignment.quantity_to_build ??
            baseWorkOrder?.standard_quantity ??
            0,
        ) ||
        0;
      if (!qty || qty <= 0) {
        setAssignError("Quantity must be greater than zero.");
        return;
      }

      setAssignSaving(true);
      setAssignError(null);

      const updates: {
        id: string;
        order_index: number;
        quantity_to_build?: any;
        is_open?: boolean;
        assignee_id?: string | null;
      }[] = [];

      existing.forEach((item, idx) => {
        const newOrderIndex = idx + 1;
        const rowUpdate: {
          id: string;
          order_index: number;
          quantity_to_build?: any;
          is_open?: boolean;
          assignee_id?: string | null;
        } = { id: item.id, order_index: newOrderIndex };
        if (item.id === editingAssignmentId) {
          rowUpdate.quantity_to_build = qty as any;
          rowUpdate.is_open = assignAssigneeId === "open";
          rowUpdate.assignee_id =
            assignAssigneeId === "open" ? null : assignAssigneeId;
        }
        updates.push(rowUpdate);
      });

      for (const u of updates) {
        if (!u.id || typeof u.id !== "string") continue; // skip placeholder/ghost
        const payload: Partial<WorkOrderAssignment> = {
          order_index: u.order_index as any,
        };
        if (u.quantity_to_build !== undefined) {
          payload.quantity_to_build = u.quantity_to_build;
        }
        if (u.is_open !== undefined) {
          payload.is_open = u.is_open as any;
        }
        if (u.assignee_id !== undefined) {
          payload.assignee_id = u.assignee_id as any;
        }
        const { error: updateErr } = await supabase
          .from("work_order_assignments")
          .update(payload)
          .eq("id", u.id);
        if (updateErr) {
          console.error(updateErr);
          setAssignError(
            updateErr.message
              ? `Failed to update assignment: ${updateErr.message}`
              : "Failed to update assignment.",
          );
          setAssignSaving(false);
          return;
        }
      }

      // Update local state
      setAssignments((prev) =>
        prev.map((a) => {
          const u = updates.find((x) => x.id === a.id);
          if (!u) return a;
          return {
            ...a,
            order_index: u.order_index as any,
            quantity_to_build:
              u.quantity_to_build !== undefined
                ? (u.quantity_to_build as any)
                : a.quantity_to_build,
            is_open:
              u.is_open !== undefined ? (u.is_open as any) : a.is_open,
            assignee_id:
              u.assignee_id !== undefined ? u.assignee_id : a.assignee_id,
          };
        }) as AssignmentWithRelations[],
      );

      closeAssignModal();
      setAssignSaving(false);
      return;
    }

    // Creating a new assignment
    if (!assignWorkOrderId) {
      setAssignError("Select a work order.");
      return;
    }

    const workOrder = assignWorkOrders.find((w) => w.id === assignWorkOrderId);
    if (!workOrder) {
      setAssignError("Selected work order not found.");
      return;
    }

    const qty =
      parseFloat(assignQuantity || "") ||
      Number(workOrder.standard_quantity ?? 0) ||
      0;
    if (!qty || qty <= 0) {
      setAssignError("Quantity must be greater than zero.");
      return;
    }

    setAssignSaving(true);
    setAssignError(null);

    const orderedExisting = [...assignQueue];

    const combined: (AssignmentWithRelations | "NEW")[] = [];
    for (let i = 0; i < orderedExisting.length; i += 1) {
      if (assignInsertIndex === i) {
        combined.push("NEW");
      }
      combined.push(orderedExisting[i]);
    }
    if (assignInsertIndex >= orderedExisting.length) {
      combined.push("NEW");
    }

    const newIndexForNew =
      combined.findIndex((item) => item === "NEW") + 1 || combined.length + 1;

    // Update existing assignments to new order_index values (sequential to avoid unique constraint issues)
    for (let idx = 0; idx < combined.length; idx += 1) {
      const item = combined[idx];
      if (item === "NEW") continue;
      if (!item.id || typeof item.id !== "string") continue; // skip any placeholder/ghost row
      const newOrderIndex = idx + 1;
      if (item.order_index === newOrderIndex) continue;
      const { error: updateErr } = await supabase
        .from("work_order_assignments")
        .update({ order_index: newOrderIndex })
        .eq("id", item.id);
      if (updateErr) {
        console.error(updateErr);
        setAssignError(
          updateErr.message
            ? `Failed to update queue order: ${updateErr.message}`
            : "Failed to update existing queue order.",
        );
        setAssignSaving(false);
        return;
      }
    }

    const payload: Partial<WorkOrderAssignment> & {
      company_id: string;
      work_order_id: string;
    } = {
      company_id: activeCompanyId,
      work_order_id: workOrder.id,
      quantity_to_build: qty as any,
      standard_time_minutes:
        (workOrder.standard_time_minutes as any) ?? undefined,
      status: "open" as WorkOrderAssignment["status"],
      order_index: newIndexForNew,
      is_open: assignAssigneeId === "open",
      assignee_id: assignAssigneeId === "open" ? (null as any) : assignAssigneeId,
    };

    const { data, error: insertErr } = await supabase
      .from("work_order_assignments")
      .insert(payload)
      .select(
        `
        *,
        work_order:work_orders(*),
        assignee_profile:profiles!work_order_assignments_assignee_id_fkey(id, full_name, email)
      `,
      )
      .single();

    if (insertErr) {
      console.error(insertErr);
      setAssignError("Failed to create assignment.");
      setAssignSaving(false);
      return;
    }

    const inserted = data as unknown as AssignmentWithRelations;
    setAssignments((prev) => [...prev, inserted]);
    setSelectedId(inserted.id);
    closeAssignModal();
    setAssignSaving(false);
  };

  const handleChangeWorkOrder = (value: string) => {
    setAssignWorkOrderId(value);
    const wo = assignWorkOrders.find((w) => w.id === value);
    if (wo && wo.standard_quantity != null) {
      setAssignQuantity(String(wo.standard_quantity));
    } else {
      setAssignQuantity("");
    }
  };

  const movePlaceholder = (direction: "up" | "down") => {
    setAssignInsertIndex((prev) => {
      const maxIndex = assignQueue.length;
      if (direction === "up") {
        return prev > 0 ? prev - 1 : 0;
      }
      // down
      return prev < maxIndex ? prev + 1 : maxIndex;
    });
  };

  const moveExisting = (id: string, direction: "up" | "down") => {
    setAssignQueue((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      if (idx === -1) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const recordCompletionInventory = async (
    assignment: AssignmentWithRelations,
  ) => {
    if (!activeCompanyId) return;
    const qtyToBuild =
      (assignment.quantity_to_build as number | null) ??
      (assignment.work_order?.standard_quantity as number | null) ??
      0;
    if (!qtyToBuild || qtyToBuild <= 0) return;

    // Load cost type
    const { data: settings } = await supabase
      .from("company_settings")
      .select("cost_type, use_landed_cost")
      .eq("company_id", activeCompanyId)
      .single();
    const costType: CostType =
      (settings?.cost_type as CostType | undefined) ?? "average";
    const useLanded =
      ((settings as any)?.use_landed_cost as boolean | undefined) ?? false;

    // Default location for consuming inputs
    const { data: locs } = await supabase
      .from("locations")
      .select("id")
      .eq("company_id", activeCompanyId)
      .limit(1);
    const locationId = locs?.[0]?.id as string | undefined;
    if (!locationId) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Pre-calc expected arrival for this work order
    const stdMinutes =
      (assignment.work_order as any)?.standard_time_minutes ??
      (assignment.work_order as any)?.standard_time ??
      0;
    const expectedArrival = new Date(
      Date.now() + (Number(stdMinutes) > 0 ? Number(stdMinutes) * 60_000 : 0),
    )
      .toISOString()
      .slice(0, 10);

    // Ensure a receiving order header for this completion
    let receivingOrderId: string | null = null;

    // Load procedures attached to this work order
    const { data: links } = await supabase
      .from("work_order_procedures")
      .select(
        `
        id,
        sequence,
        procedures:procedures(id, output_item_id, output_quantity)
      `,
      )
      .eq("work_order_id", assignment.work_order_id)
      .order("sequence", { ascending: true });

    const workProcs =
      (links as any[] | null)?.map((row) => row.procedures).filter(Boolean) ??
      [];

    for (const proc of workProcs as {
      id: string;
      output_item_id: string | null;
      output_quantity: number | null;
    }[]) {
      if (!proc.output_item_id || !proc.output_quantity) continue;

      const totalOutput = proc.output_quantity * qtyToBuild;
      if (!totalOutput || totalOutput <= 0) continue;

      // Load input items for this procedure
      const { data: inputs } = await supabase
        .from("procedure_items")
        .select("item_id, quantity_required")
        .eq("procedure_id", proc.id);

      const inputRows =
        (inputs as { item_id: string; quantity_required: number }[] | null) ??
        [];

      let totalCost = 0;

      for (const input of inputRows) {
        const { data: txs } = await supabase
          .from("inventory_transactions")
          .select("qty_change, unit_cost, landed_unit_cost")
          .eq("item_id", input.item_id)
          .eq("transaction_type", "purchase_receipt")
          .order("created_at", { ascending: true });

        const txList =
          (txs as
            | { qty_change: number; unit_cost: number | null; landed_unit_cost?: number | null }[]
            | null) ?? [];
        const mapped = txList.map((t) => ({
          unit_cost:
            useLanded && t.landed_unit_cost != null
              ? t.landed_unit_cost
              : t.unit_cost,
          qty_change: t.qty_change,
        }));
        const unitCost = getCostFromTransactions(mapped, costType) ?? 0;

        const qtyConsumed = (input.quantity_required ?? 0) * qtyToBuild;
        if (qtyConsumed > 0 && unitCost > 0) {
          totalCost += qtyConsumed * unitCost;

          // Consume input inventory for this work order
          await supabase.from("inventory_transactions").insert({
            company_id: activeCompanyId,
            item_id: input.item_id,
            location_id: locationId,
            qty_change: -qtyConsumed,
            transaction_type: "work_order_completion",
            unit_cost: unitCost,
            landed_unit_cost: useLanded ? unitCost : null,
            reference_table: "work_order_assignments",
            reference_id: assignment.id,
            created_by: user?.id ?? null,
          });
        }
      }

      const unitOutputCost =
        totalOutput > 0 && totalCost > 0 ? totalCost / totalOutput : null;

      // Lazily create/open a receiving order for this work order completion
      if (!receivingOrderId) {
        const notesParts: string[] = [];
        if (assignment.work_order?.name) notesParts.push(assignment.work_order.name);
        if (assignment.id) notesParts.push(`Assignment ${assignment.id.slice(0, 8)}`);
        const { data: orderRow, error: orderErr } = await supabase
          .from("receiving_orders")
          .insert({
            company_id: activeCompanyId,
            status: "open",
            notes: notesParts.join(" - ") || null,
          })
          .select("id")
          .single();
        if (orderErr || !orderRow) return;
        receivingOrderId = orderRow.id as string;
      }

      const vendorLabel = `Workorder - ${
        (assignment.assignee_profile as any)?.email ?? "unassigned"
      }`;

      await supabase.from("receiving_order_lines").insert({
        receiving_order_id: receivingOrderId,
        item_id: proc.output_item_id,
        quantity_ordered: totalOutput,
        quantity_received: 0,
        unit_cost: unitOutputCost,
        pieces_per_pack: 1,
        order_date: new Date().toISOString().slice(0, 10),
        expected_ship_date: null,
        expected_arrival_date: expectedArrival,
        vendor_company_name: vendorLabel,
        vendor_url: null,
        notes: "workorder",
      });
    }
  };

  const getAssignmentQtyToBuild = (assignment: AssignmentWithRelations) => {
    const n =
      (assignment.quantity_to_build as number | null | undefined) ??
      (assignment.work_order?.standard_quantity as number | null | undefined) ??
      0;
    const qty = Number(n ?? 0);
    return Number.isFinite(qty) ? qty : 0;
  };

  const loadPickList = async () => {
    if (!activeCompanyId) return;
    if (pickSelectedAssignmentIds.length === 0) {
      setPickItems([]);
      return;
    }

    setPickLoading(true);
    setPickError(null);

    try {
      const selectedAssignments = assignments.filter((a) =>
        pickSelectedAssignmentIds.includes(a.id),
      );
      if (!selectedAssignments.length) {
        setPickItems([]);
        return;
      }

      // Aggregate required qty per item
      const requiredByItemId = new Map<string, number>();
      const itemMeta = new Map<string, { sku: string; item_name: string }>();

      const workOrderProceduresCache = new Map<
        string,
        { procedureIds: string[] } | null
      >();
      const procedureItemsCache = new Map<
        string,
        { item_id: string; quantity_required: number; sku: string; item_name: string }[]
      >();

      for (const a of selectedAssignments) {
        const qtyToBuild = getAssignmentQtyToBuild(a);
        if (!qtyToBuild || qtyToBuild <= 0) continue;

        const workOrderId = a.work_order_id;
        if (!workOrderId) continue;

        let cached = workOrderProceduresCache.get(workOrderId);
        if (!cached) {
          const { data: links, error: linksErr } = await supabase
            .from("work_order_procedures")
            .select(
              `
              procedures:procedures(id)
            `,
            )
            .eq("work_order_id", workOrderId)
            .order("sequence", { ascending: true });

          if (linksErr) {
            console.error(linksErr);
            cached = null;
          } else {
            const procedureIds =
              (links as any[] | null)?.map((row) => row.procedures?.id).filter(Boolean) ??
              [];
            cached = { procedureIds };
          }
          workOrderProceduresCache.set(workOrderId, cached);
        }

        const procedureIds = cached?.procedureIds ?? [];
        for (const procId of procedureIds) {
          let pCached = procedureItemsCache.get(procId);
          if (!pCached) {
            const { data: inputs, error: inputsErr } = await supabase
              .from("procedure_items")
              .select(
                `
                item_id,
                quantity_required,
                items ( sku, name )
              `,
              )
              .eq("procedure_id", procId);

            if (inputsErr) {
              console.error(inputsErr);
              pCached = [];
            } else {
              pCached = (inputs as any[] | null)?.map((row) => ({
                item_id: row.item_id as string,
                quantity_required: Number(row.quantity_required ?? 0),
                sku: row.items?.sku ?? "",
                item_name: row.items?.name ?? "",
              })) ?? [];
            }
            procedureItemsCache.set(procId, pCached);
          }

          for (const inp of pCached) {
            if (!inp.item_id) continue;
            const reqQty = (inp.quantity_required ?? 0) * qtyToBuild;
            if (!reqQty || reqQty <= 0) continue;

            requiredByItemId.set(
              inp.item_id,
              (requiredByItemId.get(inp.item_id) ?? 0) + reqQty,
            );
            if (!itemMeta.has(inp.item_id)) {
              itemMeta.set(inp.item_id, {
                sku: inp.sku,
                item_name: inp.item_name,
              });
            }
          }
        }
      }

      const itemIds = Array.from(requiredByItemId.keys());
      if (itemIds.length === 0) {
        setPickItems([]);
        return;
      }

      // Choose a default location per item
      const { data: ilRows, error: ilErr } = await supabase
        .from("item_locations")
        .select("item_id, location_id, is_default")
        .in("item_id", itemIds);
      if (ilErr) console.error(ilErr);

      const defaultLocByItemId = new Map<string, string | null>();
      const ilList = (ilRows ?? []) as {
        item_id: string;
        location_id: string | null;
        is_default: boolean | null;
      }[];

      for (const id of itemIds) {
        const forItem = ilList.filter((r) => r.item_id === id);
        const def = forItem.find((r) => r.is_default);
        defaultLocByItemId.set(id, def?.location_id ?? forItem[0]?.location_id ?? null);
      }

      const chosenLocationIds = Array.from(
        new Set(
          itemIds
            .map((id) => defaultLocByItemId.get(id))
            .filter(Boolean),
        ),
      ) as string[];

      const locNameById = new Map<string, string>();
      const qtyByItemLoc = new Map<string, number>();

      if (chosenLocationIds.length > 0) {
        const { data: locRows, error: locErr } = await supabase
          .from("locations")
          .select("id, name")
          .in("id", chosenLocationIds);
        if (locErr) console.error(locErr);

        (locRows ?? []).forEach((l: any) => {
          if (l?.id) locNameById.set(l.id as string, l.name ?? "");
        });

        const { data: balRows, error: balErr } = await supabase
          .from("inventory_balances")
          .select("item_id, location_id, on_hand_qty")
          .in("item_id", itemIds)
          .in("location_id", chosenLocationIds);
        if (balErr) console.error(balErr);

        (balRows ?? []).forEach((b: any) => {
          if (!b?.item_id || !b?.location_id) return;
          qtyByItemLoc.set(
            `${b.item_id}:${b.location_id}`,
            Number(b.on_hand_qty ?? 0),
          );
        });
      }

      const rows: PickListItemRow[] = itemIds.map((itemId) => {
        const meta = itemMeta.get(itemId);
        const locId = defaultLocByItemId.get(itemId) ?? null;
        const location_name =
          (locId && locNameById.get(locId)) ?? (locId ? "—" : "—");
        const current_qty =
          locId != null ? qtyByItemLoc.get(`${itemId}:${locId}`) ?? 0 : 0;
        return {
          item_id: itemId,
          sku: meta?.sku ?? "",
          item_name: meta?.item_name ?? "",
          location_name,
          current_qty,
          required_qty: requiredByItemId.get(itemId) ?? 0,
        };
      });

      setPickItems(rows);
    } catch (e) {
      console.error(e);
      setPickError("Failed to build pick list.");
      setPickItems([]);
    } finally {
      setPickLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      if (!activeCompanyId) return;
      if (pickSelectedAssignmentIds.length === 0) {
        setPickItems([]);
        return;
      }
      // loadPickList already manages setPickLoading
      await loadPickList();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickSelectedAssignmentIds, activeCompanyId, assignments]);

  const sortedPickItems = useMemo(() => {
    const dir = pickSortDir === "asc" ? 1 : -1;
    const list = [...pickItems];
    list.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";

      if (pickSortKey === "sku") {
        av = a.sku ?? "";
        bv = b.sku ?? "";
      } else if (pickSortKey === "item_name") {
        av = a.item_name ?? "";
        bv = b.item_name ?? "";
      } else if (pickSortKey === "location_name") {
        av = a.location_name ?? "";
        bv = b.location_name ?? "";
      } else if (pickSortKey === "current_qty") {
        av = Number(a.current_qty ?? 0);
        bv = Number(b.current_qty ?? 0);
      } else if (pickSortKey === "required_qty") {
        av = Number(a.required_qty ?? 0);
        bv = Number(b.required_qty ?? 0);
      }

      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return list;
  }, [pickItems, pickSortKey, pickSortDir]);

  const pickTotals = useMemo(() => {
    const totalRequired = sortedPickItems.reduce(
      (s, r) => s + (Number(r.required_qty ?? 0) || 0),
      0,
    );
    return {
      totalRequired,
      distinctItems: sortedPickItems.length,
    };
  }, [sortedPickItems]);

  const togglePickSort = (
    key: typeof pickSortKey,
  ) => {
    if (pickSortKey === key) {
      setPickSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPickSortKey(key);
      setPickSortDir("asc");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-emerald-300">
            Work orders
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-slate-500">Status:</span>
              {[
                { key: "active", label: "Active" },
                { key: "all", label: "All" },
                { key: "open", label: "Open" },
                { key: "in_progress", label: "In progress" },
                { key: "paused", label: "Paused" },
                { key: "completed", label: "Completed" },
                { key: "closed", label: "Closed" },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  className={`rounded-full border px-2 py-0.5 ${
                    statusFilter === f.key
                      ? "border-emerald-600 bg-emerald-900/60 text-emerald-100"
                      : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-emerald-700 hover:text-emerald-100"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setAssigneeFilterOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800"
              >
                Assignees
                {assigneeFilterValues.length > 0 && (
                  <span className="text-[10px] text-emerald-300">
                    ({assigneeFilterValues.length})
                  </span>
                )}
              </button>
              {assigneeFilterOpen && (
                <div className="absolute z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded border border-slate-700 bg-slate-950 p-2 text-[11px] shadow-lg">
                  <div className="mb-1 text-slate-400">Show assignments for:</div>
                  <label className="mb-1 flex cursor-pointer items-center gap-2 text-slate-200">
                    <input
                      type="checkbox"
                      checked={assigneeFilterValues.length === 0}
                      onChange={(e) => {
                        if (e.target.checked) setAssigneeFilterValues([]);
                      }}
                    />
                    <span>All</span>
                  </label>
                  <label className="mb-1 flex cursor-pointer items-center gap-2 text-slate-200">
                    <input
                      type="checkbox"
                      checked={assigneeFilterValues.includes("__open__")}
                      onChange={(e) =>
                        setAssigneeFilterValues((prev) => {
                          const set = new Set(prev);
                          if (e.target.checked) set.add("__open__");
                          else set.delete("__open__");
                          return Array.from(set);
                        })
                      }
                    />
                    <span>Open (unassigned)</span>
                  </label>
                  {Array.from(
                    new Set(
                      assignments
                        .map((a) => assigneeLabel(a))
                        .filter((name) => name && name !== "Open"),
                    ),
                  )
                    .sort((a, b) => a.localeCompare(b))
                    .map((name) => (
                      <label
                        key={name}
                        className="mb-1 flex cursor-pointer items-center gap-2 text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={assigneeFilterValues.includes(name)}
                          onChange={(e) =>
                            setAssigneeFilterValues((prev) => {
                              const set = new Set(prev);
                              if (e.target.checked) set.add(name);
                              else set.delete(name);
                              // If we end up with no filters, treat as "All"
                              return Array.from(set);
                            })
                          }
                        />
                        <span>{name}</span>
                      </label>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openAssignModal}
            className="inline-flex items-center rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-800/80"
          >
            Assign work order
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading work orders…</div>
      ) : assignments.length === 0 ? (
        <div className="rounded border border-slate-800 bg-slate-950/50 px-3 py-4 text-sm text-slate-400">
          No work orders are currently assigned or open.
        </div>
      ) : (
        <div
          id="wo-layout-container"
          className="mt-2 flex gap-3"
        >
          <div
            className="space-y-2"
            style={{ width: `${leftWidthPct}%`, minWidth: 0 }}
          >
            <h2 className="text-sm font-medium text-slate-200">
              {isAdmin ? "All active assignments" : "My work orders"}
            </h2>
            <div className="overflow-hidden rounded border border-slate-800 bg-black/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-normal">
                      <button type="button" onClick={() => toggleTableSort("wo")} className="inline-flex items-center gap-1">
                        WO {tableSortKey === "wo" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-normal">
                      <button type="button" onClick={() => toggleTableSort("qty")} className="inline-flex items-center gap-1">
                        Qty {tableSortKey === "qty" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-normal">
                      <button type="button" onClick={() => toggleTableSort("assignee")} className="inline-flex items-center gap-1">
                        Assigned to {tableSortKey === "assignee" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-normal">
                      <button type="button" onClick={() => toggleTableSort("status")} className="inline-flex items-center gap-1">
                        Status {tableSortKey === "status" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-normal">
                      <button type="button" onClick={() => toggleTableSort("order")} className="inline-flex items-center gap-1">
                        Order {tableSortKey === "order" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-normal">
                      <button type="button" onClick={() => toggleTableSort("last_done")} className="inline-flex items-center gap-1">
                        Last done {tableSortKey === "last_done" ? (tableSortDir === "asc" ? "▲" : "▼") : ""}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAssignmentsForTable.map((a) => {
                    const wo = (a as any).work_order;
                    const isOrphaned =
                      wo == null ||
                      (wo && (wo.name == null || String(wo.name).trim() === ""));
                    const workOrderLabel = isOrphaned
                      ? "Unknown work order (orphaned)"
                      : (a.work_order?.name ?? "Work order");

                    // Compute per-queue display order (per assignee or for open queue),
                    // matching how the Assign modal shows order numbers.
                    const sameQueue = assignments.filter((b) => {
                      const bothOpen =
                        a.is_open && b.is_open && !a.assignee_id && !b.assignee_id;
                      const sameAssignee =
                        !a.is_open &&
                        !b.is_open &&
                        a.assignee_id &&
                        b.assignee_id &&
                        a.assignee_id === b.assignee_id;
                      return bothOpen || sameAssignee;
                    });
                    const sortedInQueue = [...sameQueue].sort(
                      (b1, b2) =>
                        (b1.order_index ?? 0) - (b2.order_index ?? 0),
                    );
                    const displayOrder =
                      sortedInQueue.findIndex((b) => b.id === a.id) + 1;

                    return (
                    <tr
                      key={a.id}
                      className={`cursor-pointer border-t border-slate-900/80 text-[11px] hover:bg-slate-900/60 ${
                        a.id === selectedId ? "bg-slate-900/80" : ""
                      }`}
                      onClick={() => handleSelect(a.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span className={`font-medium ${isOrphaned ? "text-amber-400" : "text-slate-100"}`}>
                            {workOrderLabel}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {a.work_order?.work_order_number ??
                              a.work_order_id.slice(0, 8)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {a.quantity_to_build ?? a.work_order?.standard_quantity}
                      </td>
                      <td className="px-3 py-2">
                        {a.is_open
                          ? "Open"
                          : a.assignee_profile?.full_name ??
                            a.assignee_profile?.email ??
                            "Unassigned"}
                      </td>
                      <td className="px-3 py-2 capitalize">{a.status}</td>
                      <td className="px-3 py-2">
                        {displayOrder > 0 ? displayOrder : "—"}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-400">
                        {a.last_completed_at
                          ? new Date(a.last_completed_at as unknown as string)
                              .toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pick list moved to its own page */}
          </div>

          {/* Vertical slider handle */}
          <div
            onMouseDown={handleResizeMouseDown}
            className={`relative flex w-1 cursor-col-resize items-stretch justify-center ${
              isResizing ? "bg-emerald-700/60" : "bg-slate-800/70 hover:bg-slate-700/80"
            }`}
          >
            <div className="pointer-events-none my-4 h-24 w-px bg-slate-400" />
          </div>

          <div
            className="space-y-3"
            style={{ width: `${100 - leftWidthPct}%`, minWidth: 0 }}
          >
            <h2 className="text-sm font-medium text-slate-200">
              Details
            </h2>
            {selected ? (
              <div className="space-y-3 rounded border border-slate-800 bg-black/40 p-3 text-xs text-slate-200">
                {(() => {
                  const wo = (selected as any).work_order;
                  const isOrphaned =
                    wo == null ||
                    (wo && (wo.name == null || String(wo.name).trim() === ""));
                  return (
                <>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Work order
                  </div>
                  <div className="font-medium">
                    {isOrphaned
                      ? "Unknown work order (orphaned)"
                      : (selected.work_order?.name ?? "Work order")}
                  </div>
                  {isOrphaned && (
                    <p className="mt-1 text-amber-400/90 text-[11px]">
                      This assignment’s work order is missing. Cancel it to remove it from the list.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Quantity
                    </div>
                    <div>
                      {selected.quantity_to_build ??
                        selected.work_order?.standard_quantity}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Std time (min)
                    </div>
                    <div>
                      {selected.standard_time_minutes ??
                        selected.work_order?.standard_time_minutes}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Status
                    </div>
                    <div className="capitalize">{selected.status}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Order in queue
                    </div>
                    <div>{selected.order_index}</div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wide text-slate-500">
                    Notes
                  </label>
                  <textarea
                    className="h-24 w-full rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={saveNotes}
                    disabled={savingNotes}
                    className="mt-1 inline-flex items-center rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                  >
                    {savingNotes ? "Saving…" : "Save notes"}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openAssignModal(selected)}
                      className="inline-flex items-center rounded border border-slate-600 bg-slate-900 px-3 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-800"
                    >
                      Edit assignment
                    </button>
                  )}
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Controls
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => createEvent("in_progress", "start")}
                        disabled={
                          creatingEvent ||
                          selected.status === "in_progress" ||
                          selected.status === "completed"
                        }
                        className="inline-flex items-center rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800/80 disabled:opacity-50"
                      >
                        Start
                      </button>
                      <button
                        type="button"
                        onClick={() => createEvent("paused", "pause")}
                        disabled={
                          creatingEvent || selected.status !== "in_progress"
                        }
                        className="inline-flex items-center rounded border border-amber-700 bg-amber-900/40 px-3 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-800/80 disabled:opacity-50"
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        onClick={() => createEvent("in_progress", "resume")}
                        disabled={
                          creatingEvent || selected.status !== "paused"
                        }
                        className="inline-flex items-center rounded border border-sky-700 bg-sky-900/40 px-3 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-800/80 disabled:opacity-50"
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={completeAssignment}
                        disabled={
                          creatingEvent ||
                          selected.status === "completed" ||
                          selected.status === "cancelled"
                        }
                        className="inline-flex items-center rounded border border-emerald-700 bg-emerald-900/60 px-3 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800 disabled:opacity-50"
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        onClick={() => createEvent("cancelled", "cancel")}
                        disabled={
                          creatingEvent ||
                          selected.status === "completed" ||
                          selected.status === "cancelled"
                        }
                        className="inline-flex items-center rounded border border-red-700 bg-red-900/40 px-3 py-1 text-[11px] font-medium text-red-100 hover:bg-red-800/80 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>

                {/* Time grid: excel-like editable rows (date / start / stop) */}
                <div className="mt-3 rounded border border-slate-800 bg-slate-950/40 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Time log (per assignment)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Times support seconds
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded border border-slate-900 bg-black/30">
                    <table className="w-full border-collapse text-[11px]">
                      <thead className="bg-slate-900/80">
                        <tr className="border-b border-slate-800 text-left text-slate-400">
                          <th className="px-2 py-1 w-[9.5rem]">Date</th>
                          <th className="px-2 py-1 w-[7.5rem]">Start</th>
                          <th className="px-2 py-1 w-[7.5rem]">Stop</th>
                          <th className="px-2 py-1 w-[4.5rem]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {timeRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-2 py-2 text-slate-500">
                              No rows yet.
                            </td>
                          </tr>
                        ) : (
                          timeRows.map((r, idx) => {
                            const isBlank =
                              !r.start_event_id &&
                              !r.stop_event_id &&
                              !r.start_time &&
                              !r.stop_time;
                            const canSave = Boolean(r.date && r.start_time && r.stop_time);
                            return (
                              <tr key={`${r.start_event_id ?? "new"}-${idx}`} className="border-b border-slate-900">
                                <td className="px-2 py-1">
                                  <input
                                    type="date"
                                    value={r.date}
                                    onChange={(e) => updateTimeRow(idx, { date: e.target.value })}
                                    onBlur={() => persistTimeRow(idx)}
                                    className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px]"
                                  />
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    type="time"
                                    step={1}
                                    value={r.start_time}
                                    onChange={(e) => updateTimeRow(idx, { start_time: e.target.value })}
                                    onBlur={() => persistTimeRow(idx)}
                                    className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px]"
                                  />
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    type="time"
                                    step={1}
                                    value={r.stop_time}
                                    onChange={(e) => updateTimeRow(idx, { stop_time: e.target.value })}
                                    onBlur={() => persistTimeRow(idx)}
                                    className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px]"
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    {!isBlank && (
                                      <button
                                        type="button"
                                        disabled={!canSave || savingRowIdx === idx}
                                        onClick={() => persistTimeRow(idx)}
                                        className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500 disabled:opacity-50"
                                      >
                                        {savingRowIdx === idx ? "Saving…" : "Save"}
                                      </button>
                                    )}
                                    {Boolean(r.start_event_id && r.stop_event_id) && (
                                      <button
                                        type="button"
                                        disabled={savingRowIdx === idx}
                                        onClick={() => clearTimeRow(idx)}
                                        className="rounded border border-red-600 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/40 disabled:opacity-50"
                                      >
                                        Clear
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Edit any cell like a spreadsheet. Rows auto-save when complete.
                  </p>
                </div>

                </>
                  );
                })()}
              </div>
            ) : (
              <div className="rounded border border-slate-800 bg-black/40 p-3 text-xs text-slate-400">
                Select a work order on the left to see details and controls.
              </div>
            )}
          {/* old controls block replaced */}
                {/* <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Controls
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => createEvent("in_progress", "start")}
                      disabled={
                        creatingEvent ||
                        selected.status === "in_progress" ||
                        selected.status === "completed"
                      }
                      className="inline-flex items-center rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800/80 disabled:opacity-50"
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      onClick={() => createEvent("paused", "pause")}
                      disabled={
                        creatingEvent ||
                        selected.status !== "in_progress"
                      }
                      className="inline-flex items-center rounded border border-amber-700 bg-amber-900/40 px-3 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-800/80 disabled:opacity-50"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      onClick={() => createEvent("in_progress", "resume")}
                      disabled={
                        creatingEvent || selected.status !== "paused"
                      }
                      className="inline-flex items-center rounded border border-sky-700 bg-sky-900/40 px-3 py-1 text-[11px] font-medium text-sky-100 hover:bg-sky-800/80 disabled:opacity-50"
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => createEvent("completed", "complete")}
                      disabled={
                        creatingEvent ||
                        selected.status === "completed" ||
                        selected.status === "cancelled"
                      }
                      className="inline-flex items-center rounded border border-emerald-700 bg-emerald-900/60 px-3 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      onClick={() => createEvent("cancelled", "cancel")}
                      disabled={
                        creatingEvent ||
                        selected.status === "completed" ||
                        selected.status === "cancelled"
                      }
                      className="inline-flex items-center rounded border border-red-700 bg-red-900/40 px-3 py-1 text-[11px] font-medium text-red-100 hover:bg-red-800/80 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div> */}
          </div>
        </div>
      )}

      {isAdmin && showAssign && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-100 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-emerald-300">
                Assign work order
              </h2>
              <button
                type="button"
                onClick={closeAssignModal}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {assignError && (
              <div className="mb-3 rounded border border-red-800 bg-red-950/60 px-2 py-1 text-[11px] text-red-200">
                {assignError}
              </div>
            )}

            {assignLoading ? (
              <div className="text-[13px] text-slate-400">
                Loading data…
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wide text-slate-500">
                    Work order
                  </label>
                  <select
                    className="w-full rounded border border-slate-800 bg-black/60 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                    value={assignWorkOrderId}
                    onChange={(e) => handleChangeWorkOrder(e.target.value)}
                    disabled={!!editingAssignmentId}
                  >
                    <option value="">Select work order…</option>
                    {assignWorkOrders.map((wo) => (
                      <option key={wo.id} value={wo.id}>
                        {wo.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] uppercase tracking-wide text-slate-500">
                      Quantity to build
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={assignQuantity}
                      onChange={(e) => setAssignQuantity(e.target.value)}
                      className="w-full rounded border border-slate-800 bg-black/60 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                    />
                    {currentAssignWorkOrder && (
                      <p className="mt-1 text-[10px] text-slate-500">
                        Std qty:{" "}
                        {currentAssignWorkOrder.standard_quantity ?? "—"} • Std
                        time:{" "}
                        {currentAssignWorkOrder.standard_time_minutes ?? "—"}{" "}
                        min
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] uppercase tracking-wide text-slate-500">
                      Assign to
                    </label>
                    <select
                      className="w-full rounded border border-slate-800 bg-black/60 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                      value={assignAssigneeId}
                      onChange={(e) => handleChangeAssignee(e.target.value)}
                    >
                      <option value="open">Open (unassigned)</option>
                      {assignUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email || u.id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Existing queue
                  </div>
                  {assignQueueLoading ? (
                    <div className="text-[11px] text-slate-400">
                      Loading queue…
                    </div>
                  ) : (
                    <div className="max-h-40 overflow-auto rounded border border-slate-800 bg-black/40">
                      <table className="min-w-full text-left text-[11px]">
                        <thead className="bg-slate-950/80 text-slate-400">
                          <tr>
                            <th className="px-2 py-1 font-normal">Order</th>
                            <th className="px-2 py-1 font-normal">Work order</th>
                            <th className="px-2 py-1 font-normal">Qty</th>
                            <th className="px-2 py-1 font-normal">Status</th>
                            {/* Debug column to help track phantom rows */}
                            <th className="px-2 py-1 font-normal text-[10px]">
                              Debug
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Filter out any phantom/placeholder rows that don't have a real work order
                            const ordered = assignQueue.filter((a) => {
                              if (!a) return false;
                              const wo = (a as any).work_order;
                              return (
                                typeof a.id === "string" &&
                                a.id &&
                                typeof a.work_order_id === "string" &&
                                a.work_order_id &&
                                wo &&
                                wo.name &&
                                String(wo.name).trim() !== ""
                              );
                            });
                            const rows = [];
                            let displayIndex = 1;

                            const pushPlaceholder = () => {
                              rows.push(
                                <tr
                                  key="new-assignment"
                                  className="border-t border-emerald-900/70 bg-emerald-950/40 text-[11px]"
                                >
                                  <td className="px-2 py-1">
                                    <div className="flex items-center gap-1">
                                      <span>{displayIndex}</span>
                                      <div className="ml-1 flex flex-col gap-0.5">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            movePlaceholder("up")
                                          }
                                          disabled={assignInsertIndex === 0}
                                          className="h-3 w-3 rounded border border-slate-700 bg-slate-900 text-[9px] leading-none text-slate-200 disabled:opacity-40"
                                        >
                                          ↑
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            movePlaceholder("down")
                                          }
                                          disabled={
                                            assignInsertIndex ===
                                            assignQueue.length
                                          }
                                          className="h-3 w-3 rounded border border-slate-700 bg-slate-900 text-[9px] leading-none text-slate-200 disabled:opacity-40"
                                        >
                                          ↓
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-2 py-1">
                                    {currentAssignWorkOrder
                                      ? currentAssignWorkOrder.name
                                      : "(New assignment – select work order above)"}
                                  </td>
                                  <td className="px-2 py-1">
                                    {assignQuantity ||
                                      currentAssignWorkOrder?.standard_quantity ||
                                      "—"}
                                  </td>
                                  <td className="px-2 py-1 italic text-emerald-300">
                                    New
                                  </td>
                                </tr>,
                              );
                              displayIndex += 1;
                            };

                            if (ordered.length === 0) {
                              if (!editingAssignmentId) {
                                // Only placeholder in create mode
                                pushPlaceholder();
                              }
                            } else {
                              for (let i = 0; i < ordered.length; i += 1) {
                                if (!editingAssignmentId && assignInsertIndex === i) {
                                  pushPlaceholder();
                                }
                                const a = ordered[i];
                                rows.push(
                                  <tr
                                    key={a.id}
                                    className="group border-t border-slate-900/70 text-[11px]"
                                  >
                                    <td className="px-2 py-1">
                                      <div className="flex items-center gap-1">
                                        <span>{displayIndex}</span>
                                        <div className="ml-1 flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              moveExisting(a.id, "up")
                                            }
                                            className="h-3 w-3 rounded border border-slate-700 bg-slate-900 text-[9px] leading-none text-slate-200"
                                          >
                                            ↑
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              moveExisting(a.id, "down")
                                            }
                                            className="h-3 w-3 rounded border border-slate-700 bg-slate-900 text-[9px] leading-none text-slate-200"
                                          >
                                            ↓
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-2 py-1">
                                      {a.work_order?.name ?? "Work order"}
                                    </td>
                                    <td className="px-2 py-1">
                                      {a.quantity_to_build ??
                                        a.work_order?.standard_quantity}
                                    </td>
                                    <td className="px-2 py-1 capitalize">
                                      {a.status}
                                    </td>
                                    <td className="px-2 py-1 text-[9px] text-slate-500 font-mono">
                                      {/* Debug info: assignment id + work order id prefix */}
                                      {String(a.id ?? "").slice(0, 8)} /{" "}
                                      {String(a.work_order_id ?? "").slice(0, 8)}
                                    </td>
                                  </tr>,
                                );
                                displayIndex += 1;
                              }
                              if (!editingAssignmentId && assignInsertIndex >= ordered.length) {
                                pushPlaceholder();
                              }
                            }

                            return rows;
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeAssignModal}
                    className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAssignSave}
                    disabled={assignSaving}
                    className="rounded border border-emerald-700 bg-emerald-900/70 px-3 py-1.5 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {assignSaving ? "Saving…" : "Save assignment"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-slate-400">Loading work orders…</div>
      }
    >
      <WorkOrdersPageContent />
    </Suspense>
  );
}

