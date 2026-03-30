"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Database } from "@/types/supabase";
import { supabase } from "@/lib/supabaseClient";
import { loadActiveCompany } from "@/lib/activeCompany";
import { getCurrentUserPermissions } from "@/lib/permissions";

type WorkOrder = Database["public"]["Tables"]["work_orders"]["Row"];
type WorkOrderTree = Database["public"]["Tables"]["work_order_trees"]["Row"];
type WorkOrderTreeNodeTable =
  Database["public"]["Tables"]["work_order_tree_nodes"]["Row"];
type WorkOrderAssignment =
  Database["public"]["Tables"]["work_order_assignments"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type AssignmentWithRelations = WorkOrderAssignment & {
  work_order: WorkOrder | null;
  assignee_profile: Pick<Profile, "id" | "full_name" | "email"> | null;
};

type TreeNodeWithRelations = WorkOrderTreeNodeTable & {
  work_order: WorkOrder;
};

type TreeConnectorOptions = {
  connector_stroke_width?: number | null;
  connector_curve?: number | null;
  connector_color?: string | null;
  connector_brightness?: number | null;
};

type TreeWithNodes = WorkOrderTree & TreeConnectorOptions & {
  nodes: TreeNodeWithRelations[];
};

type AssignmentSummary = {
  work_order_id: string;
  has_active: boolean;
  last_completed_at: string | null;
  assignee_names: string[];
};

export default function WorkOrderTreePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [trees, setTrees] = useState<TreeWithNodes[]>([]);
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);

  const [newTreeName, setNewTreeName] = useState("");
  const [savingTree, setSavingTree] = useState(false);

  const [nodeFormTreeId, setNodeFormTreeId] = useState<string | null>(null);
  const [nodeFormParentId, setNodeFormParentId] = useState<string | null>(null);
  const [nodeFormSide, setNodeFormSide] = useState<"left" | "right">("right");
  const [editingNode, setEditingNode] = useState<TreeNodeWithRelations | null>(
    null,
  );
  const [nodeWorkOrders, setNodeWorkOrders] = useState<WorkOrder[]>([]);
  const [nodeSaving, setNodeSaving] = useState(false);
  const [nodeFormError, setNodeFormError] = useState<string | null>(null);

  // Node form fields
  const [nodeWorkOrderId, setNodeWorkOrderId] = useState<string>("");
  const [nodeAlertMode, setNodeAlertMode] = useState<"days" | "inventory">(
    "days",
  );
  const [nodeAlertDays, setNodeAlertDays] = useState<string>("60");
  const [nodeAlertInventoryThreshold, setNodeAlertInventoryThreshold] =
    useState<string>("");

  const [customizeMode, setCustomizeMode] = useState(false);
  const [savingPositions, setSavingPositions] = useState(false);

  const [savingConnector, setSavingConnector] = useState(false);
  const [connectorDraft, setConnectorDraft] = useState<{
    treeId: string;
    strokeWidth: number;
    curve: number;
    color: string;
    brightness: number;
  } | null>(null);

  const [showAssign, setShowAssign] = useState(false);
  const [assignWorkOrders, setAssignWorkOrders] = useState<WorkOrder[]>([]);
  const [assignUsers, setAssignUsers] = useState<Profile[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignWorkOrderId, setAssignWorkOrderId] = useState<string>("");
  const [assignAssigneeId, setAssignAssigneeId] = useState<string | "open">("open");
  const [assignQuantity, setAssignQuantity] = useState<string>("");
  const [assignQueue, setAssignQueue] = useState<AssignmentWithRelations[]>([]);
  const [assignQueueLoading, setAssignQueueLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignInsertIndex, setAssignInsertIndex] = useState<number>(0);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<AssignmentWithRelations | null>(null);

  const showNodeModal = nodeFormTreeId != null;
  const currentAssignWorkOrder = useMemo(
    () => assignWorkOrders.find((wo) => wo.id === assignWorkOrderId) ?? null,
    [assignWorkOrders, assignWorkOrderId],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const active = loadActiveCompany();
      if (!active) {
        setError("Select an active company.");
        setLoading(false);
        return;
      }
      setCompanyId(active.id);

      const perms = await getCurrentUserPermissions(active.id);
      setIsAdmin(perms.isSuperAdmin);

      let treeData: any[] | null = null;
      let treeErr: any = null;
      const treeRes = await supabase
        .from("work_order_trees")
        .select("id, company_id, name, created_at, connector_stroke_width, connector_curve, connector_color, connector_brightness")
        .eq("company_id", active.id)
        .order("created_at", { ascending: true });
      treeData = treeRes.data;
      treeErr = treeRes.error;
      if (treeErr?.code === "42703" || (treeErr && treeRes.data == null)) {
        const fallback = await supabase
          .from("work_order_trees")
          .select("id, company_id, name, created_at")
          .eq("company_id", active.id)
          .order("created_at", { ascending: true });
        treeData = fallback.data;
        treeErr = fallback.error;
      }
      const [
        { data: nodeData, error: nodeErr },
        { data: assignData, error: assignErr },
      ] = await Promise.all([
        supabase
          .from("work_order_tree_nodes")
          .select(`*, work_order:work_orders(*)`)
          .order("position", { ascending: true }),
        supabase
          .from("work_order_assignments")
          .select(
            `work_order_id, status, last_completed_at, assignee_id,
            assignee_profile:profiles!work_order_assignments_assignee_id_fkey(full_name, email)`
          )
          .eq("company_id", active.id),
      ]);

      if (treeErr || nodeErr || assignErr) {
        console.error(treeErr ?? nodeErr ?? assignErr);
        setError("Failed to load work order trees.");
        setLoading(false);
        return;
      }

      const rawTrees = (treeData ?? []) as WorkOrderTree[];
      const rawNodes = (nodeData ?? []) as TreeNodeWithRelations[];
      const grouped: TreeWithNodes[] = rawTrees.map((t) => ({
        ...t,
        nodes: rawNodes.filter((n) => n.tree_id === t.id),
      }));
      setTrees(grouped);

      type AssignRow = {
        work_order_id: string;
        status: string;
        last_completed_at: string | null;
        assignee_id: string | null;
        assignee_profile?: { full_name: string | null; email: string | null } | null;
      };
      const assignRows = (assignData ?? []) as AssignRow[];
      const summaryMap = new Map<string, AssignmentSummary>();
      for (const row of assignRows) {
        if (!row.work_order_id) continue;
        const existing = summaryMap.get(row.work_order_id) ?? {
          work_order_id: row.work_order_id,
          has_active: false,
          last_completed_at: null as string | null,
          assignee_names: [] as string[],
        };
        if (
          row.status === "open" ||
          row.status === "in_progress" ||
          row.status === "paused"
        ) {
          existing.has_active = true;
        }
        if (row.last_completed_at) {
          if (
            !existing.last_completed_at ||
            new Date(row.last_completed_at) > new Date(existing.last_completed_at)
          ) {
            existing.last_completed_at = row.last_completed_at;
          }
        }
        const name = row.assignee_profile?.full_name?.trim() || row.assignee_profile?.email || null;
        if (name && !existing.assignee_names.includes(name)) {
          existing.assignee_names.push(name);
        }
        summaryMap.set(row.work_order_id, existing);
      }
      setAssignments([...summaryMap.values()]);

      setLoading(false);
    };

    load();
  }, []);

  const assignmentByWorkOrderId = useMemo(() => {
    const map = new Map<string, AssignmentSummary>();
    for (const a of assignments) {
      map.set(a.work_order_id, a);
    }
    return map;
  }, [assignments]);

  const refetchAssignments = useCallback(async () => {
    if (!companyId) return;
    const { data: assignData } = await supabase
      .from("work_order_assignments")
      .select(
        `work_order_id, status, last_completed_at, assignee_id,
        assignee_profile:profiles!work_order_assignments_assignee_id_fkey(full_name, email)`
      )
      .eq("company_id", companyId);
    type AssignRow = {
      work_order_id: string;
      status: string;
      last_completed_at: string | null;
      assignee_profile?: { full_name: string | null; email: string | null } | null;
    };
    const assignRows = (assignData ?? []) as AssignRow[];
    const summaryMap = new Map<string, AssignmentSummary>();
    for (const row of assignRows) {
      if (!row.work_order_id) continue;
      const existing = summaryMap.get(row.work_order_id) ?? {
        work_order_id: row.work_order_id,
        has_active: false,
        last_completed_at: null as string | null,
        assignee_names: [] as string[],
      };
      if (row.status === "open" || row.status === "in_progress" || row.status === "paused") {
        existing.has_active = true;
      }
      if (row.last_completed_at) {
        if (!existing.last_completed_at || new Date(row.last_completed_at) > new Date(existing.last_completed_at)) {
          existing.last_completed_at = row.last_completed_at;
        }
      }
      const name = row.assignee_profile?.full_name?.trim() || row.assignee_profile?.email || null;
      if (name && !existing.assignee_names.includes(name)) {
        existing.assignee_names.push(name);
      }
      summaryMap.set(row.work_order_id, existing);
    }
    setAssignments([...summaryMap.values()]);
  }, [companyId]);

  const loadAssignQueue = useCallback(
    async (companyId: string, assignee: string | "open", focusAssignment?: AssignmentWithRelations | null) => {
      setAssignQueueLoading(true);
      setAssignError(null);
      let query = supabase
        .from("work_order_assignments")
        .select(`*, work_order:work_orders(id, name, work_order_number)`)
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
        setAssignError("Failed to load queue.");
        setAssignQueue([]);
      } else {
        let rows = ((data ?? []) as unknown as AssignmentWithRelations[]) ?? [];
        rows = rows.filter((r) => {
          const wo = (r as any).work_order;
          return r.id && r.work_order_id && wo?.name;
        });
        if (focusAssignment) {
          const exists = rows.some((r) => r.id === focusAssignment.id);
          if (!exists) {
            rows = [...rows, { ...focusAssignment, is_open: assignee === "open" as any, assignee_id: assignee === "open" ? null : assignee as any }];
          }
        }
        rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        setAssignQueue(rows);
        setAssignInsertIndex(rows.length);
      }
      setAssignQueueLoading(false);
    },
    [],
  );

  const openAssignModal = useCallback(
    async (presetWorkOrderId?: string | null) => {
      if (!companyId) return;
      setShowAssign(true);
      setAssignError(null);
      setAssignLoading(true);
      setEditingAssignmentId(null);
      setEditingAssignment(null);
      setAssignWorkOrderId(presetWorkOrderId ?? "");
      setAssignAssigneeId("open");
      setAssignQuantity("");
      const [{ data: woData, error: woErr }, { data: memData, error: memErr }] = await Promise.all([
        supabase.from("work_orders").select("id, name, standard_quantity, standard_time_minutes").eq("company_id", companyId).order("name", { ascending: true }),
        supabase.from("company_memberships").select("id, company_id, is_active, profiles(id, full_name, email)").eq("company_id", companyId).eq("is_active", true),
      ]);
      if (woErr || memErr) {
        setAssignError("Failed to load data.");
        setAssignLoading(false);
        return;
      }
      const workOrders = (woData ?? []) as unknown as WorkOrder[];
      const users: Profile[] = ((memData ?? []).map((m: any) => m.profiles).filter(Boolean) ?? []) as Profile[];
      setAssignWorkOrders(workOrders);
      setAssignUsers(users);
      const wo = workOrders.find((w) => w.id === presetWorkOrderId);
      if (wo?.standard_quantity != null) setAssignQuantity(String(wo.standard_quantity));
      await loadAssignQueue(companyId, "open", null);
      setAssignLoading(false);
    },
    [companyId, loadAssignQueue],
  );

  const closeAssignModal = useCallback(() => {
    setShowAssign(false);
    setAssignError(null);
    setAssignWorkOrderId("");
    setAssignAssigneeId("open");
    setAssignQuantity("");
    setAssignQueue([]);
    setAssignInsertIndex(0);
    setEditingAssignmentId(null);
    setEditingAssignment(null);
  }, []);

  const handleChangeAssignee = useCallback(
    (value: string) => {
      const next: string | "open" = value === "open" ? "open" : value;
      setAssignAssigneeId(next);
      if (companyId) loadAssignQueue(companyId, next, null);
    },
    [companyId, loadAssignQueue],
  );

  const handleChangeWorkOrder = useCallback((value: string) => {
    setAssignWorkOrderId(value);
    const wo = assignWorkOrders.find((w) => w.id === value);
    setAssignQuantity(wo?.standard_quantity != null ? String(wo.standard_quantity) : "");
  }, [assignWorkOrders]);

  const movePlaceholder = useCallback((direction: "up" | "down") => {
    setAssignInsertIndex((prev) => {
      const maxIndex = assignQueue.length;
      return direction === "up" ? Math.max(0, prev - 1) : Math.min(maxIndex, prev + 1);
    });
  }, [assignQueue.length]);

  const moveExisting = useCallback((id: string, direction: "up" | "down") => {
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
  }, []);

  const handleAssignSave = useCallback(async () => {
    if (!companyId) return;
    if (!assignWorkOrderId) {
      setAssignError("Select a work order.");
      return;
    }
    const workOrder = assignWorkOrders.find((w) => w.id === assignWorkOrderId);
    if (!workOrder) return;
    const qty = parseFloat(assignQuantity || "") || Number(workOrder.standard_quantity ?? 0) || 0;
    if (!qty || qty <= 0) {
      setAssignError("Quantity must be greater than zero.");
      return;
    }
    setAssignSaving(true);
    setAssignError(null);
    const orderedExisting = [...assignQueue];
    const combined: (AssignmentWithRelations | "NEW")[] = [];
    for (let i = 0; i <= orderedExisting.length; i++) {
      if (assignInsertIndex === i) combined.push("NEW");
      if (i < orderedExisting.length) combined.push(orderedExisting[i]);
    }
    const newIndexForNew = combined.findIndex((x) => x === "NEW") + 1 || combined.length + 1;
    for (let idx = 0; idx < combined.length; idx++) {
      const item = combined[idx];
      if (item === "NEW" || !item.id) continue;
      const newOrderIndex = idx + 1;
      if (item.order_index === newOrderIndex) continue;
      const { error: updateErr } = await supabase.from("work_order_assignments").update({ order_index: newOrderIndex }).eq("id", item.id);
      if (updateErr) {
        setAssignError(updateErr.message || "Failed to update queue order.");
        setAssignSaving(false);
        return;
      }
    }
    const payload = {
      company_id: companyId,
      work_order_id: workOrder.id,
      quantity_to_build: qty,
      standard_time_minutes: workOrder.standard_time_minutes ?? undefined,
      status: "open",
      order_index: newIndexForNew,
      is_open: assignAssigneeId === "open",
      assignee_id: assignAssigneeId === "open" ? null : assignAssigneeId,
    };
    const { error: insertErr } = await supabase.from("work_order_assignments").insert(payload);
    if (insertErr) {
      setAssignError(insertErr.message || "Failed to create assignment.");
      setAssignSaving(false);
      return;
    }
    await refetchAssignments();
    closeAssignModal();
    setAssignSaving(false);
  }, [companyId, assignWorkOrderId, assignWorkOrders, assignQuantity, assignQueue, assignInsertIndex, assignAssigneeId, closeAssignModal, refetchAssignments]);

  const nodeChildrenByParent = useMemo(() => {
    const map = new Map<
      string | null,
      { left: TreeNodeWithRelations[]; right: TreeNodeWithRelations[] }
    >();
    for (const tree of trees) {
      for (const node of tree.nodes) {
        const key = node.parent_id ?? `root:${tree.id}`;
        const entry =
          map.get(key) ?? { left: [] as TreeNodeWithRelations[], right: [] as TreeNodeWithRelations[] };
        if (node.side === "left") entry.left.push(node);
        else entry.right.push(node);
        map.set(key, entry);
      }
    }
    // sort siblings by position
    for (const entry of map.values()) {
      entry.left.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      entry.right.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }
    return map;
  }, [trees]);

  /** Absolute pixel positions for each node (per tree). Root at origin; children = parent + offset. */
  const nodePositions = useMemo(() => {
    const out = new Map<string, Map<string, { x: number; y: number }>>();
    const defaultOffset = { left: { x: -120, y: 60 }, right: { x: 120, y: 60 } };
    for (const tree of trees) {
      const pos = new Map<string, { x: number; y: number }>();
      const rootKey = `root:${tree.id}`;
      const entry = nodeChildrenByParent.get(rootKey);
      const roots = [
        ...(entry?.left ?? []),
        ...(entry?.right ?? []),
      ].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      let rootY = 0;
      for (const r of roots) {
        const ox = (r as any).offset_x ?? 0;
        const oy = (r as any).offset_y ?? 0;
        pos.set(r.id, { x: ox, y: rootY + oy });
        rootY += 100;
      }
      const visit = (parentX: number, parentY: number, children: TreeNodeWithRelations[]) => {
        for (const c of children) {
          const dx = (c as any).offset_x ?? defaultOffset[c.side as "left" | "right"].x;
          const dy = (c as any).offset_y ?? defaultOffset[c.side as "left" | "right"].y;
          const x = parentX + dx;
          const y = parentY + dy;
          pos.set(c.id, { x, y });
          const key = c.id;
          const e = nodeChildrenByParent.get(key);
          if (e) {
            visit(x, y, [...(e.left ?? []), ...(e.right ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
          }
        }
      };
      for (const r of roots) {
        const p = pos.get(r.id)!;
        const e = nodeChildrenByParent.get(r.id);
        if (e) visit(p.x, p.y, [...(e.left ?? []), ...(e.right ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
      }
      out.set(tree.id, pos);
    }
    return out;
  }, [trees, nodeChildrenByParent]);

  /** Edges for drawing connectors: parent -> child with coords (only non-root nodes). */
  const treeEdges = useMemo(() => {
    const out = new Map<string, { px: number; py: number; cx: number; cy: number }[]>();
    for (const tree of trees) {
      const pos = nodePositions.get(tree.id);
      if (!pos) continue;
      const edges: { px: number; py: number; cx: number; cy: number }[] = [];
      for (const node of tree.nodes) {
        if (!node.parent_id) continue;
        const childPos = pos.get(node.id);
        const parentPos = pos.get(node.parent_id);
        if (!childPos || !parentPos) continue;
        edges.push({
          px: parentPos.x,
          py: parentPos.y,
          cx: childPos.x,
          cy: childPos.y,
        });
      }
      out.set(tree.id, edges);
    }
    return out;
  }, [trees, nodePositions]);

  const openNodeModal = async (opts: {
    treeId: string;
    parentId: string | null;
    side: "left" | "right";
    node?: TreeNodeWithRelations | null;
  }) => {
    if (!companyId) return;
    setNodeFormError(null);
    setNodeFormTreeId(opts.treeId);
    setNodeFormParentId(opts.parentId);
    setNodeFormSide(opts.side);
    setEditingNode(opts.node ?? null);

    if (opts.node) {
      setNodeWorkOrderId(opts.node.work_order_id);
      setNodeAlertMode(opts.node.alert_mode as "days" | "inventory");
      setNodeAlertDays(String(opts.node.alert_days ?? 60));
      setNodeAlertInventoryThreshold(
        opts.node.alert_inventory_threshold != null
          ? String(opts.node.alert_inventory_threshold)
          : "",
      );
    } else {
      setNodeWorkOrderId("");
      setNodeAlertMode("days");
      setNodeAlertDays("60");
      setNodeAlertInventoryThreshold("");
    }

    const { data: woData, error: woErr } = await supabase
      .from("work_orders")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (woErr) {
      console.error(woErr);
      setNodeFormError("Failed to load work orders.");
      return;
    }
    setNodeWorkOrders((woData ?? []) as WorkOrder[]);
  };

  const closeNodeModal = () => {
    setNodeFormTreeId(null);
    setNodeFormParentId(null);
    setNodeFormSide("right");
    setEditingNode(null);
    setNodeFormError(null);
  };

  const handleSaveTree = async () => {
    if (!companyId) return;
    const name = newTreeName.trim();
    if (!name) return;
    setSavingTree(true);
    setError(null);
    const { data, error: insErr } = await supabase
      .from("work_order_trees")
      .insert({ company_id: companyId, name })
      .select("id, company_id, name, created_at")
      .single();
    if (insErr) {
      console.error(insErr);
      setError("Failed to create tree.");
      setSavingTree(false);
      return;
    }
    const tree = data as WorkOrderTree;
    setTrees((prev) => [...prev, {
      ...tree,
      connector_stroke_width: 1.5,
      connector_curve: 0.5,
      connector_color: "#64748b",
      connector_brightness: 100,
      nodes: [],
    }]);
    setNewTreeName("");
    setSavingTree(false);
  };

  const handleSaveNode = async () => {
    if (!nodeFormTreeId || !companyId) return;
    if (!nodeWorkOrderId) {
      setNodeFormError("Select a work order.");
      return;
    }
    setNodeSaving(true);
    setNodeFormError(null);

    const alertDays =
      nodeAlertMode === "days"
        ? parseInt(nodeAlertDays || "60", 10) || 60
        : 60;
    const alertInventory =
      nodeAlertMode === "inventory"
        ? parseFloat(nodeAlertInventoryThreshold || "0") || 0
        : null;

    if (editingNode) {
      const { data, error: updErr } = await supabase
        .from("work_order_tree_nodes")
        .update({
          work_order_id: nodeWorkOrderId,
          alert_mode: nodeAlertMode,
          alert_days: alertDays,
          alert_inventory_threshold: alertInventory,
        })
        .eq("id", editingNode.id)
        .select(
          `
          *,
          work_order:work_orders(*)
        `,
        )
        .single();
      if (updErr) {
        console.error(updErr);
        setNodeFormError("Failed to update node.");
        setNodeSaving(false);
        return;
      }
      const updated = data as TreeNodeWithRelations;
      setTrees((prev) =>
        prev.map((t) =>
          t.id === nodeFormTreeId
            ? {
                ...t,
                nodes: t.nodes.map((n) =>
                  n.id === updated.id ? updated : n,
                ),
              }
            : t,
        ),
      );
    } else {
      // position: append as last among siblings on this side
      const key = nodeFormParentId ?? `root:${nodeFormTreeId}`;
      const siblings =
        nodeChildrenByParent.get(key)?.[
          nodeFormSide === "left" ? "left" : "right"
        ] ?? [];
      const nextPos = siblings.length
        ? Math.max(...siblings.map((s) => s.position ?? 0)) + 1
        : 1;
      const { data, error: insErr } = await supabase
        .from("work_order_tree_nodes")
        .insert({
          tree_id: nodeFormTreeId,
          parent_id: nodeFormParentId,
          side: nodeFormSide,
          work_order_id: nodeWorkOrderId,
          position: nextPos,
          offset_x: nodeFormSide === "left" ? -120 : 120,
          offset_y: 60 * nextPos,
          alert_mode: nodeAlertMode,
          alert_days: alertDays,
          alert_inventory_threshold: alertInventory,
        })
        .select(
          `
          *,
          work_order:work_orders(*)
        `,
        )
        .single();
      if (insErr) {
        console.error(insErr);
        setNodeFormError("Failed to create node.");
        setNodeSaving(false);
        return;
      }
      const inserted = data as TreeNodeWithRelations;
      setTrees((prev) =>
        prev.map((t) =>
          t.id === nodeFormTreeId
            ? { ...t, nodes: [...t.nodes, inserted] }
            : t,
        ),
      );
    }

    setNodeSaving(false);
    closeNodeModal();
  };

  const handleDeleteNode = async (node: TreeNodeWithRelations) => {
    if (!window.confirm("Delete this node and all of its children?")) return;
    await supabase.from("work_order_tree_nodes").delete().eq("id", node.id);
    setTrees((prev) =>
      prev.map((t) =>
        t.id === node.tree_id
          ? { ...t, nodes: t.nodes.filter((n) => n.id !== node.id) }
          : t,
      ),
    );
  };

  const saveConnectorOptions = async (treeId: string, opts: {
    connector_stroke_width: number;
    connector_curve: number;
    connector_color: string;
    connector_brightness: number;
  }) => {
    setSavingConnector(true);
    setError(null);
    const { error } = await supabase
      .from("work_order_trees")
      .update({
        connector_stroke_width: opts.connector_stroke_width,
        connector_curve: opts.connector_curve,
        connector_color: opts.connector_color,
        connector_brightness: opts.connector_brightness,
      })
      .eq("id", treeId);
    if (error) {
      setError(error.message || "Failed to save connector options. Run migration 030 if you haven’t.");
    } else {
      setTrees((prev) =>
        prev.map((t) =>
          t.id === treeId ? { ...t, ...opts } : t,
        ),
      );
      setConnectorDraft(null);
    }
    setSavingConnector(false);
  };

  const saveAllPositions = async () => {
    setSavingPositions(true);
    setError(null);
    let hadError = false;
    for (const tree of trees) {
      for (const node of tree.nodes) {
        const ox = (node as any).offset_x ?? 0;
        const oy = (node as any).offset_y ?? 0;
        const { error: updateErr } = await supabase
          .from("work_order_tree_nodes")
          .update({ offset_x: ox, offset_y: oy })
          .eq("id", node.id);
        if (updateErr) {
          console.error(updateErr);
          setError(updateErr.message || "Could not save some positions. Run migration 030 if you haven’t.");
          hadError = true;
          break;
        }
      }
      if (hadError) break;
    }
    if (!hadError && trees.some((t) => t.nodes.length > 0)) {
      setError(null);
    }
    setSavingPositions(false);
  };

  const handleDoneCustomizing = () => {
    saveAllPositions().finally(() => setCustomizeMode(false));
  };

  const handleNodePositionChange = async (
    treeId: string,
    nodeId: string,
    deltaX: number,
    deltaY: number,
  ) => {
    const tree = trees.find((t) => t.id === treeId);
    const node = tree?.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const ox = ((node as any).offset_x ?? 0) + Math.round(deltaX);
    const oy = ((node as any).offset_y ?? 0) + Math.round(deltaY);

    // Optimistic update: move node in UI immediately so it doesn’t snap back
    setTrees((prev) =>
      prev.map((t) => {
        if (t.id !== treeId) return t;
        return {
          ...t,
          nodes: t.nodes.map((n) =>
            n.id === nodeId ? { ...n, offset_x: ox, offset_y: oy } : n,
          ),
        };
      }),
    );
    setError(null);

    const { error: updateErr } = await supabase
      .from("work_order_tree_nodes")
      .update({ offset_x: ox, offset_y: oy })
      .eq("id", nodeId);

    if (updateErr) {
      console.error(updateErr);
      setError(updateErr.message || "Position not saved to server. Run migration 030 (tree position and connector options) so positions persist.");
    }
  };

  const handleReorderNode = async (
    treeId: string,
    draggedNodeId: string,
    targetParentId: string | null,
    targetSide: "left" | "right",
    dropIndex: number,
  ) => {
    const tree = trees.find((t) => t.id === treeId);
    if (!tree) return;
    const draggedNode = tree.nodes.find((n) => n.id === draggedNodeId);
    if (!draggedNode) return;

    // Prevent making a node its own descendant (cycle)
    if (targetParentId) {
      let cur: string | null = targetParentId;
      while (cur) {
        if (cur === draggedNodeId) return;
        const parent = tree.nodes.find((n) => n.id === cur);
        cur = parent?.parent_id ?? null;
      }
    }

    const targetKey = targetParentId ?? `root:${treeId}`;
    const sourceKey = draggedNode.parent_id ?? `root:${treeId}`;
    const entry = nodeChildrenByParent.get(targetKey);
    if (!entry) return;
    const targetSiblings = targetSide === "left" ? [...entry.left] : [...entry.right];

    // Remove dragged from target list if it's already there (reorder); otherwise we're moving from elsewhere
    const targetWithoutDragged = targetSiblings.filter((n) => n.id !== draggedNodeId);
    const newOrder = [...targetWithoutDragged];
    newOrder.splice(Math.min(dropIndex, newOrder.length), 0, draggedNode);

    // Assign positions 1-based
    const updates: { id: string; parent_id: string | null; side: "left" | "right"; position: number }[] = [];
    newOrder.forEach((n, i) => {
      updates.push({
        id: n.id,
        parent_id: targetParentId,
        side: targetSide,
        position: i + 1,
      });
    });

    // If moved from another list, renumber the source list
    if (sourceKey !== targetKey || draggedNode.side !== targetSide) {
      const sourceEntry = nodeChildrenByParent.get(sourceKey);
      if (sourceEntry) {
        const sourceSiblings = (draggedNode.side === "left" ? sourceEntry.left : sourceEntry.right).filter(
          (n) => n.id !== draggedNodeId,
        );
        sourceSiblings.forEach((n, i) => {
          updates.push({
            id: n.id,
            parent_id: draggedNode.parent_id,
            side: draggedNode.side,
            position: i + 1,
          });
        });
      }
    }

    // Persist to DB
    for (const u of updates) {
      await supabase
        .from("work_order_tree_nodes")
        .update({ parent_id: u.parent_id, side: u.side, position: u.position })
        .eq("id", u.id);
    }

    // Update local state: mutate node props in the flat list
    setTrees((prev) =>
      prev.map((t) => {
        if (t.id !== treeId) return t;
        return {
          ...t,
          nodes: t.nodes.map((n) => {
            const u = updates.find((u) => u.id === n.id);
            if (!u) return n;
            return { ...n, parent_id: u.parent_id, side: u.side, position: u.position };
          }),
        };
      }),
    );
  };

  const renderNodeCard = (
    tree: TreeWithNodes,
    node: TreeNodeWithRelations,
  ) => {
    const assignment = assignmentByWorkOrderId.get(node.work_order_id);
    const lastCompleted = assignment?.last_completed_at
      ? new Date(assignment.last_completed_at)
      : null;
    const now = new Date();

    let needsAttention = false;
    if (node.alert_mode === "days") {
      if (lastCompleted) {
        const diffDays =
          (now.getTime() - lastCompleted.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays >= (node.alert_days ?? 60)) needsAttention = true;
      } else {
        // never completed -> treat as needs attention
        needsAttention = true;
      }
    } else if (node.alert_mode === "inventory") {
      // TODO: hook into real inventory for this work order's output item.
      // For now we only mark based on having no recent completion info.
      if (!lastCompleted) needsAttention = true;
    }

    const glowClass = needsAttention
      ? "ring-2 ring-amber-500/70 shadow-[0_0_15px_rgba(245,158,11,0.4)]"
      : "ring-1 ring-slate-700/60";

    const card = (
      <div
        key={node.id}
        className={`min-w-0 rounded border border-slate-800 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-100 ${glowClass}`}
      >
        <div className="font-semibold text-emerald-300 truncate max-w-[8rem]" title={node.work_order?.name ?? "Work order"}>
          {node.work_order?.name ?? "Work order"}
        </div>
        <div className="text-[9px] text-slate-400">
          {node.work_order?.work_order_number ?? node.work_order_id.slice(0, 8)}
          {lastCompleted != null && (
            <span className="ml-1">· {lastCompleted.toLocaleDateString()}</span>
          )}
        </div>
        {(assignment?.assignee_names ?? []).length > 0 ? (
          <div className="text-[9px] text-slate-500">
            Assigned to: {(assignment?.assignee_names ?? []).join(", ")}
          </div>
        ) : (
          <div className="text-[9px] text-slate-500 italic">Open (unassigned)</div>
        )}
        {isAdmin && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => openAssignModal(node.work_order_id)}
              className="rounded border border-emerald-700 bg-emerald-900/50 px-1.5 py-0.5 text-[9px] text-emerald-200 hover:bg-emerald-800"
            >
              Assign
            </button>
            {customizeMode && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    openNodeModal({
                      treeId: tree.id,
                      parentId: node.parent_id,
                      side: node.side,
                      node,
                    })
                  }
                  className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[9px] text-slate-200 hover:bg-slate-800"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteNode(node)}
                  className="rounded border border-red-700 bg-red-950 px-1 py-0.5 text-[9px] text-red-200 hover:bg-red-900"
                >
                  Del
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );

    return (
      <div className="flex items-center gap-0">
        {isAdmin && customizeMode && (
          <button
            type="button"
            onClick={() =>
              openNodeModal({
                treeId: tree.id,
                parentId: node.id,
                side: "left",
              })
            }
            className="flex h-8 w-6 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-emerald-300"
            title="Add node on left"
            aria-label="Add node on left"
          >
            +
          </button>
        )}
        {card}
        {isAdmin && customizeMode && (
          <button
            type="button"
            onClick={() =>
              openNodeModal({
                treeId: tree.id,
                parentId: node.id,
                side: "right",
              })
            }
            className="flex h-8 w-6 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-emerald-300"
            title="Add node on right"
            aria-label="Add node on right"
          >
            +
          </button>
        )}
      </div>
    );
  };

  const renderTree = (tree: TreeWithNodes) => {
    const rootKey = `root:${tree.id}`;
    const rootEntry = nodeChildrenByParent.get(rootKey);
    const roots = [
      ...(rootEntry?.left ?? []),
      ...(rootEntry?.right ?? []),
    ];

    return (
      <section
        key={tree.id}
        className="flex flex-col gap-3 rounded border border-slate-800 bg-black/40 p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-100">
            {tree.name}
          </h3>
          {isAdmin && customizeMode && (
            <button
              type="button"
              onClick={() =>
                openNodeModal({
                  treeId: tree.id,
                  parentId: null,
                  side: "right",
                })
              }
              className="rounded border border-emerald-700 bg-emerald-900/60 px-2 py-0.5 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800"
            >
              + Root node
            </button>
          )}
        </div>

        {roots.length === 0 ? (
          <p className="text-xs text-slate-400">
            No nodes yet. Use &ldquo;+ Root node&rdquo; to start this tree.
          </p>
        ) : (
          <>
            {isAdmin && customizeMode && (
              <ConnectorOptionsPanel
                tree={tree}
                connectorDraft={connectorDraft}
                setConnectorDraft={setConnectorDraft}
                savingConnector={savingConnector}
                saveConnectorOptions={saveConnectorOptions}
              />
            )}
            <TreeCanvas
              tree={tree}
              positions={nodePositions.get(tree.id)!}
              edges={treeEdges.get(tree.id) ?? []}
              renderNodeCard={renderNodeCard}
              isAdmin={isAdmin}
              customizeMode={customizeMode}
              openNodeModal={openNodeModal}
              onNodePositionChange={handleNodePositionChange}
            />
          </>
        )}
      </section>
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Link
            href="/work-orders"
            className="text-slate-400 hover:text-emerald-400 text-sm"
          >
            ← Back to work orders
          </Link>
        </div>
        <p className="text-slate-400 text-sm">Loading work order trees…</p>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="space-y-4">
        <p className="text-slate-300 text-sm">Select an active company.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link
            href="/work-orders"
            className="text-slate-400 hover:text-emerald-400 text-sm"
          >
            ← Back to work orders
          </Link>
          <h1 className="text-lg font-semibold text-slate-100">
            Work order tree
          </h1>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {customizeMode && (
              <>
                <button
                  type="button"
                  onClick={saveAllPositions}
                  disabled={savingPositions}
                  className="rounded border border-emerald-600 bg-emerald-900/50 px-3 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-800 disabled:opacity-50"
                >
                  {savingPositions ? "Saving…" : "Save positions"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={customizeMode ? handleDoneCustomizing : () => setCustomizeMode(true)}
              className={`rounded border px-3 py-1.5 text-sm font-medium ${
                customizeMode
                  ? "border-amber-600 bg-amber-900/60 text-amber-200 hover:bg-amber-800"
                  : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {customizeMode ? "Done customizing" : "Customize"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-400">
          {error}
        </p>
      )}

      {isAdmin && customizeMode && (
        <div className="rounded border border-slate-800 bg-black/40 p-3 text-xs text-slate-200">
          <h2 className="text-sm font-medium text-slate-100">
            Create tree
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Tree name"
              value={newTreeName}
              onChange={(e) => setNewTreeName(e.target.value)}
              className="min-w-[12rem] flex-1 rounded border border-slate-800 bg-slate-950/70 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
            />
            <button
              type="button"
              onClick={handleSaveTree}
              disabled={savingTree || !newTreeName.trim()}
              className="rounded border border-emerald-700 bg-emerald-900/60 px-3 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800 disabled:opacity-50"
            >
              {savingTree ? "Saving…" : "Add tree"}
            </button>
          </div>
        </div>
      )}

      {trees.length === 0 ? (
        <p className="text-xs text-slate-400">
          No trees yet. {isAdmin ? "Create one above to get started." : ""}
        </p>
      ) : (
        <div className="space-y-4">
          {trees.map((tree) => renderTree(tree))}
        </div>
      )}

      {showNodeModal && nodeFormTreeId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-100 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-emerald-300">
                {editingNode ? "Edit node" : "Add node"}
              </h2>
              <button
                type="button"
                onClick={closeNodeModal}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>
            {nodeFormError && (
              <p className="mb-2 text-xs text-red-400">{nodeFormError}</p>
            )}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-slate-500">
                  Work order
                </label>
                <select
                  className="w-full rounded border border-slate-800 bg-black/60 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                  value={nodeWorkOrderId}
                  onChange={(e) => setNodeWorkOrderId(e.target.value)}
                >
                  <option value="">Select work order…</option>
                  {nodeWorkOrders.map((wo) => (
                    <option key={wo.id} value={wo.id}>
                      {wo.name ?? "(Unnamed work order)"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-slate-500">
                  Alert mode
                </label>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setNodeAlertMode("days")}
                    className={`rounded border px-2 py-0.5 ${
                      nodeAlertMode === "days"
                        ? "border-emerald-700 bg-emerald-900/60 text-emerald-100"
                        : "border-slate-700 bg-slate-900 text-slate-200"
                    }`}
                  >
                    Days since completion
                  </button>
                  <button
                    type="button"
                    onClick={() => setNodeAlertMode("inventory")}
                    className={`rounded border px-2 py-0.5 ${
                      nodeAlertMode === "inventory"
                        ? "border-emerald-700 bg-emerald-900/60 text-emerald-100"
                        : "border-slate-700 bg-slate-900 text-slate-200"
                    }`}
                  >
                    Inventory below
                  </button>
                </div>
              </div>

              {nodeAlertMode === "days" ? (
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wide text-slate-500">
                    Alert if not completed in (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={nodeAlertDays}
                    onChange={(e) => setNodeAlertDays(e.target.value)}
                    className="w-32 rounded border border-slate-800 bg-black/60 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wide text-slate-500">
                    Alert if inventory below
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={nodeAlertInventoryThreshold}
                    onChange={(e) =>
                      setNodeAlertInventoryThreshold(e.target.value)
                    }
                    className="w-32 rounded border border-slate-800 bg-black/60 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                  />
                </div>
              )}

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeNodeModal}
                  className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveNode}
                  disabled={nodeSaving}
                  className="rounded border border-emerald-700 bg-emerald-900/70 px-3 py-1.5 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800 disabled:opacity-50"
                >
                  {nodeSaving ? "Saving…" : "Save node"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAdmin && showAssign && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-100 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-emerald-300">Assign work order</h2>
              <button type="button" onClick={closeAssignModal} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>
            {assignError && (
              <div className="mb-3 rounded border border-red-800 bg-red-950/60 px-2 py-1 text-[11px] text-red-200">{assignError}</div>
            )}
            {assignLoading ? (
              <div className="text-[13px] text-slate-400">Loading data…</div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wide text-slate-500">Work order</label>
                  <select
                    className="w-full rounded border border-slate-800 bg-black/60 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                    value={assignWorkOrderId}
                    onChange={(e) => handleChangeWorkOrder(e.target.value)}
                  >
                    <option value="">Select work order…</option>
                    {assignWorkOrders.map((wo) => (
                      <option key={wo.id} value={wo.id}>{wo.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] uppercase tracking-wide text-slate-500">Quantity to build</label>
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
                        Std qty: {currentAssignWorkOrder.standard_quantity ?? "—"} • Std time: {currentAssignWorkOrder.standard_time_minutes ?? "—"} min
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] uppercase tracking-wide text-slate-500">Assign to</label>
                    <select
                      className="w-full rounded border border-slate-800 bg-black/60 px-2 py-1 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-700/60"
                      value={assignAssigneeId}
                      onChange={(e) => handleChangeAssignee(e.target.value)}
                    >
                      <option value="open">Open (unassigned)</option>
                      {assignUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.full_name || u.email || u.id}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Existing queue</div>
                  {assignQueueLoading ? (
                    <div className="text-[11px] text-slate-400">Loading queue…</div>
                  ) : (
                    <div className="max-h-40 overflow-auto rounded border border-slate-800 bg-black/40">
                      <table className="min-w-full text-left text-[11px]">
                        <thead className="bg-slate-950/80 text-slate-400">
                          <tr>
                            <th className="px-2 py-1 font-normal">Order</th>
                            <th className="px-2 py-1 font-normal">Work order</th>
                            <th className="px-2 py-1 font-normal">Qty</th>
                            <th className="px-2 py-1 font-normal">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assignQueue.filter((a) => (a as any).work_order?.name).map((a, i) => (
                            <tr key={a.id} className="border-t border-slate-900/70 text-[11px]">
                              <td className="px-2 py-1">{i + 1}</td>
                              <td className="px-2 py-1">{(a as any).work_order?.name ?? "—"}</td>
                              <td className="px-2 py-1">{a.quantity_to_build ?? "—"}</td>
                              <td className="px-2 py-1 capitalize">{a.status}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-emerald-900/70 bg-emerald-950/40 text-[11px]">
                            <td className="px-2 py-1">{assignQueue.length + 1}</td>
                            <td className="px-2 py-1">{currentAssignWorkOrder?.name ?? "(New)"}</td>
                            <td className="px-2 py-1">{assignQuantity || currentAssignWorkOrder?.standard_quantity ?? "—"}</td>
                            <td className="px-2 py-1 italic text-emerald-300">New</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={closeAssignModal} className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-800">Cancel</button>
                  <button type="button" onClick={handleAssignSave} disabled={assignSaving} className="rounded border border-emerald-700 bg-emerald-900/70 px-3 py-1.5 text-[11px] font-medium text-emerald-100 hover:bg-emerald-800 disabled:opacity-50">
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

function ConnectorOptionsPanel({
  tree,
  connectorDraft,
  setConnectorDraft,
  savingConnector,
  saveConnectorOptions,
}: {
  tree: TreeWithNodes;
  connectorDraft: { treeId: string; strokeWidth: number; curve: number; color: string; brightness: number } | null;
  setConnectorDraft: (d: typeof connectorDraft) => void;
  savingConnector: boolean;
  saveConnectorOptions: (treeId: string, opts: { connector_stroke_width: number; connector_curve: number; connector_color: string; connector_brightness: number }) => Promise<void>;
}) {
  const strokeWidth = connectorDraft?.treeId === tree.id ? connectorDraft.strokeWidth : (tree.connector_stroke_width ?? 1.5);
  const curve = connectorDraft?.treeId === tree.id ? connectorDraft.curve : (tree.connector_curve ?? 0.5);
  const color = connectorDraft?.treeId === tree.id ? connectorDraft.color : (tree.connector_color ?? "#64748b");
  const brightness = connectorDraft?.treeId === tree.id ? connectorDraft.brightness : (tree.connector_brightness ?? 100);
  return (
    <div className="rounded border border-slate-700 bg-slate-900/50 p-2 text-[11px]">
      <div className="mb-1 font-medium text-slate-300">Connector style</div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <span className="text-slate-500">Weight</span>
          <input
            type="number"
            min={0.5}
            max={8}
            step={0.5}
            value={strokeWidth}
            onChange={(e) => setConnectorDraft({ treeId: tree.id, strokeWidth: Number(e.target.value), curve, color, brightness })}
            className="w-14 rounded border border-slate-700 bg-black/60 px-1 py-0.5"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-slate-500">Curve</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={curve}
            onChange={(e) => setConnectorDraft({ treeId: tree.id, strokeWidth, curve: Number(e.target.value), color, brightness })}
            className="w-14 rounded border border-slate-700 bg-black/60 px-1 py-0.5"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-slate-500">Color</span>
          <input
            type="text"
            value={color}
            onChange={(e) => setConnectorDraft({ treeId: tree.id, strokeWidth, curve, color: e.target.value, brightness })}
            className="w-24 rounded border border-slate-700 bg-black/60 px-1 py-0.5 font-mono"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-slate-500">Brightness %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={brightness}
            onChange={(e) => setConnectorDraft({ treeId: tree.id, strokeWidth, curve, color, brightness: Number(e.target.value) })}
            className="w-14 rounded border border-slate-700 bg-black/60 px-1 py-0.5"
          />
        </label>
        <button
          type="button"
          disabled={savingConnector}
          onClick={() => saveConnectorOptions(tree.id, { connector_stroke_width: strokeWidth, connector_curve: curve, connector_color: color, connector_brightness: brightness })}
          className="rounded border border-emerald-700 bg-emerald-900/50 px-2 py-0.5 text-emerald-200 hover:bg-emerald-800 disabled:opacity-50"
        >
          {savingConnector ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function TreeCanvas({
  tree,
  positions,
  edges,
  renderNodeCard,
  isAdmin,
  customizeMode,
  openNodeModal,
  onNodePositionChange,
}: {
  tree: TreeWithNodes;
  positions: Map<string, { x: number; y: number }>;
  edges: { px: number; py: number; cx: number; cy: number }[];
  renderNodeCard: (t: TreeWithNodes, n: TreeNodeWithRelations) => JSX.Element;
  isAdmin: boolean;
  customizeMode: boolean;
  openNodeModal: (opts: { treeId: string; parentId: string | null; side: "left" | "right"; node?: TreeNodeWithRelations | null }) => void;
  onNodePositionChange: (treeId: string, nodeId: string, deltaX: number, deltaY: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ nodeId: string; startScreenX: number; startScreenY: number } | null>(null);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const onNodePositionChangeRef = useRef(onNodePositionChange);
  const treeIdRef = useRef(tree.id);
  const zoomRef = useRef(zoom);
  onNodePositionChangeRef.current = onNodePositionChange;
  treeIdRef.current = tree.id;
  zoomRef.current = zoom;

  const strokeWidth = tree.connector_stroke_width ?? 1.5;
  const curve = tree.connector_curve ?? 0.5;
  const color = tree.connector_color ?? "#64748b";
  const brightness = Math.min(100, Math.max(0, tree.connector_brightness ?? 100));
  const strokeOpacity = brightness / 100;

  const NODE_WIDTH = 140;
  const NODE_HEIGHT = 64;
  const PADDING = 80;

  const bbox = useMemo(() => {
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    positions.forEach(({ x, y }) => {
      minX = Math.min(minX, x - NODE_WIDTH / 2);
      minY = Math.min(minY, y - NODE_HEIGHT / 2);
      maxX = Math.max(maxX, x + NODE_WIDTH / 2);
      maxY = Math.max(maxY, y + NODE_HEIGHT / 2);
    });
    return { minX: minX - PADDING, minY: minY - PADDING, maxX: maxX + PADDING, maxY: maxY + PADDING };
  }, [positions]);

  const fitToView = useCallback(() => {
    if (!containerRef.current || positions.size === 0) return;
    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;
    const bw = bbox.maxX - bbox.minX || 400;
    const bh = bbox.maxY - bbox.minY || 300;
    const scale = Math.min(w / bw, h / bh, 1) * 0.85;
    setZoom(scale);
    // Center the content (width bw, height bh) in the viewport after scale
    setPan({
      x: w / 2 - (bw / 2) * scale,
      y: h / 2 - (bh / 2) * scale,
    });
  }, [positions.size, bbox]);

  const fittedTreeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (positions.size === 0 || !containerRef.current) return;
    if (fittedTreeIdRef.current === tree.id) return;
    fittedTreeIdRef.current = tree.id;
    fitToView();
  }, [tree.id, positions.size, fitToView]);

  // Non-passive wheel listener so we can preventDefault and stop page scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((z) => Math.min(3, Math.max(0.2, z + delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      if ((e.target as HTMLElement).closest?.("[data-tree-node]")) return;
      setPanning(true);
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    e.preventDefault();
    setPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  // Global move/up so node drag and pan work when cursor leaves the container
  useEffect(() => {
    if (!dragging && !panning) return;
    const onMove = (e: MouseEvent) => {
      if (panning) {
        setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
      } else if (dragging) {
        const z = zoomRef.current;
        setDragOffset({
          dx: (e.clientX - dragging.startScreenX) / z,
          dy: (e.clientY - dragging.startScreenY) / z,
        });
      }
    };
    const onUp = (e: MouseEvent) => {
      const d = dragging;
      if (d) {
        const z = zoomRef.current;
        const dx = (e.clientX - d.startScreenX) / z;
        const dy = (e.clientY - d.startScreenY) / z;
        onNodePositionChangeRef.current(treeIdRef.current, d.nodeId, dx, dy);
        setDragging(null);
        setDragOffset({ dx: 0, dy: 0 });
      }
      setPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, panning]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (panning) {
      setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
    }
  };
  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragging) {
      const dx = (e.clientX - dragging.startScreenX) / zoom;
      const dy = (e.clientY - dragging.startScreenY) / zoom;
      onNodePositionChange(tree.id, dragging.nodeId, dx, dy);
      setDragging(null);
    }
    setPanning(false);
  };

  const width = Math.max(400, bbox.maxX - bbox.minX);
  const height = Math.max(300, bbox.maxY - bbox.minY);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={fitToView} className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">Fit to view</button>
        <span className="text-[11px] text-slate-500">Zoom: {Math.round(zoom * 100)}% · Scroll to zoom, drag background to pan</span>
      </div>
      <div
        ref={containerRef}
        className="relative h-[480px] w-full overflow-hidden rounded border border-slate-800 bg-slate-950/50"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: panning ? "grabbing" : "grab" }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <svg width={width} height={height} className="absolute left-0 top-0" style={{ overflow: "visible" }}>
            <g transform={`translate(${-bbox.minX}, ${-bbox.minY})`}>
              {edges.map((edge, i) => {
                const midX = (edge.px + edge.cx) / 2;
                const midY = (edge.py + edge.cy) / 2;
                const perpX = (edge.cy - edge.py) * curve * 0.5;
                const perpY = -(edge.cx - edge.px) * curve * 0.5;
                const ctrlX = midX + perpX;
                const ctrlY = midY + perpY;
                return (
                  <path
                    key={i}
                    d={`M ${edge.px} ${edge.py} Q ${ctrlX} ${ctrlY} ${edge.cx} ${edge.cy}`}
                    fill="none"
                    stroke={color}
                    strokeOpacity={strokeOpacity}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          </svg>
          <div className="absolute left-0 top-0" style={{ width, height, transform: `translate(${-bbox.minX}px, ${-bbox.minY}px)` }}>
            {tree.nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const isDragging = dragging?.nodeId === node.id;
              const drawX = pos.x + (isDragging ? dragOffset.dx : 0);
              const drawY = pos.y + (isDragging ? dragOffset.dy : 0);
              const halfW = NODE_WIDTH / 2;
              return (
                <div
                  key={node.id}
                  data-tree-node
                  className="absolute flex items-center gap-0"
                  style={{
                    left: drawX - halfW,
                    top: drawY - NODE_HEIGHT / 2,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div
                    className={isAdmin ? "cursor-grab active:cursor-grabbing" : ""}
                    onMouseDown={(e) => {
                      if (!isAdmin || e.button !== 0) return;
                      e.stopPropagation();
                      setDragging({ nodeId: node.id, startScreenX: e.clientX, startScreenY: e.clientY });
                      setDragOffset({ dx: 0, dy: 0 });
                    }}
                  >
                    {renderNodeCard(tree, node)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

type TreeBranchProps = {
  tree: TreeWithNodes;
  node: TreeNodeWithRelations;
  nodeChildrenByParent: Map<
    string | null,
    { left: TreeNodeWithRelations[]; right: TreeNodeWithRelations[] }
  >;
  renderNodeCard: (
    tree: TreeWithNodes,
    node: TreeNodeWithRelations,
  ) => JSX.Element;
  customizeMode?: boolean;
  onReorderNode?: (
    treeId: string,
    draggedNodeId: string,
    targetParentId: string | null,
    targetSide: "left" | "right",
    dropIndex: number,
  ) => void;
};

function TreeBranch(props: TreeBranchProps) {
  const {
    tree,
    node,
    nodeChildrenByParent,
    renderNodeCard,
    customizeMode = false,
    onReorderNode,
  } = props;
  const key = node.id;
  const entry = nodeChildrenByParent.get(key) || {
    left: [],
    right: [],
  };

  const hasLeft = entry.left.length > 0;
  const hasRight = entry.right.length > 0;

  const parentId = node.id;

  const renderSiblingList = (
    siblings: TreeNodeWithRelations[],
    side: "left" | "right",
  ) => {
    if (siblings.length === 0) return null;
    if (!customizeMode || !onReorderNode) {
      return (
        <div
          className={`flex flex-col gap-2 ${side === "left" ? "items-end" : "items-start"}`}
        >
          {siblings.map((child) => (
            <TreeBranch
              key={child.id}
              tree={tree}
              node={child}
              nodeChildrenByParent={nodeChildrenByParent}
              renderNodeCard={renderNodeCard}
              customizeMode={customizeMode}
              onReorderNode={onReorderNode}
            />
          ))}
        </div>
      );
    }
    return (
      <div
        className={`flex flex-col gap-0 ${side === "left" ? "items-end" : "items-start"}`}
      >
        {siblings.map((child, index) => (
          <div key={child.id} className="flex flex-col items-stretch gap-0">
            {/* Drop zone above this sibling */}
            <div
              className="min-h-[12px] min-w-[24px] rounded border border-dashed border-slate-600 border-transparent bg-transparent transition-colors hover:border-slate-500 hover:bg-slate-800/40"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                e.currentTarget.classList.add("!border-emerald-500", "!bg-emerald-900/20");
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove("!border-emerald-500", "!bg-emerald-900/20");
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("!border-emerald-500", "!bg-emerald-900/20");
                const id = e.dataTransfer.getData("application/x-tree-node-id");
                if (id && id !== child.id) onReorderNode(tree.id, id, parentId, side, index);
              }}
            />
            <div
              draggable
              className="cursor-grab active:cursor-grabbing"
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-tree-node-id", child.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", child.work_order?.name ?? "");
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              <TreeBranch
                tree={tree}
                node={child}
                nodeChildrenByParent={nodeChildrenByParent}
                renderNodeCard={renderNodeCard}
                customizeMode={customizeMode}
                onReorderNode={onReorderNode}
              />
            </div>
          </div>
        ))}
        {/* Drop zone at end of list */}
        <div
          className="min-h-[12px] min-w-[24px] rounded border border-dashed border-slate-600 border-transparent bg-transparent transition-colors hover:border-slate-500 hover:bg-slate-800/40"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            e.currentTarget.classList.add("!border-emerald-500", "!bg-emerald-900/20");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("!border-emerald-500", "!bg-emerald-900/20");
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("!border-emerald-500", "!bg-emerald-900/20");
            const id = e.dataTransfer.getData("application/x-tree-node-id");
            if (id) onReorderNode(tree.id, id, parentId, side, siblings.length);
          }}
        />
      </div>
    );
  };

  return (
    <div className="flex items-center gap-0">
      {/* Left branch + connector line */}
      <div className="flex items-center gap-0">
        {renderSiblingList(entry.left, "left")}
        {hasLeft && (
          <div
            className="h-px w-4 shrink-0 bg-slate-500"
            style={{ minWidth: 16 }}
            aria-hidden
          />
        )}
      </div>

      {/* Center node */}
      <div className="shrink-0 px-0.5">{renderNodeCard(tree, node)}</div>

      {/* Connector line + right branch */}
      <div className="flex items-center gap-0">
        {hasRight && (
          <div
            className="h-px w-4 shrink-0 bg-slate-500"
            style={{ minWidth: 16 }}
            aria-hidden
          />
        )}
        {renderSiblingList(entry.right, "right")}
      </div>
    </div>
  );
}

