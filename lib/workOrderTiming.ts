/** Active segments between start/resume and pause/complete. */

export function assignmentDurationMinutes(
  events: { event_type: string; occurred_at: string }[],
): number | null {
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  let open: number | null = null;
  let totalMs = 0;
  for (const e of sorted) {
    const t = new Date(e.occurred_at).getTime();
    if (e.event_type === "start" || e.event_type === "resume") {
      open = t;
    } else if (e.event_type === "pause" || e.event_type === "complete") {
      if (open != null) {
        totalMs += t - open;
        open = null;
      }
    }
  }
  if (totalMs <= 0) return null;
  return totalMs / 60_000;
}

/**
 * Uses recorded start/pause/resume/complete segments when present; otherwise
 * wall time from assignment creation to last completion (covers “complete
 * without timer” flows that still set last_completed_at).
 */
export function assignmentDurationMinutesWithFallback(
  events: { event_type: string; occurred_at: string }[],
  assignmentCreatedAt: string | null | undefined,
  lastCompletedAt: string | null | undefined,
): number | null {
  const tracked = assignmentDurationMinutes(events);
  if (tracked != null && tracked > 0) return tracked;

  const start = assignmentCreatedAt?.trim();
  const end = lastCompletedAt?.trim();
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / 60_000;
}

/** Ignore null, non-finite, and ~zero durations when computing work-order averages. */
export const MIN_MINUTES_FOR_WORK_ORDER_AVG = 1 / 60; // 1 second

export function durationCountsForWorkOrderAverage(
  minutes: number | null | undefined,
): minutes is number {
  return (
    typeof minutes === "number" &&
    Number.isFinite(minutes) &&
    minutes >= MIN_MINUTES_FOR_WORK_ORDER_AVG
  );
}

export function formatDurationMinutes(m: number | null): string {
  if (m == null || !Number.isFinite(m) || m <= 0) return "—";
  if (m < 60) return `${m.toFixed(1)} min`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min.toFixed(0)}m`;
}
