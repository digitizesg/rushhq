import { rrulestr } from "rrule";
import type { ReminderChannel } from "@/lib/types";

export type TaskStatus = "pending" | "done";

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  due_date: string;            // YYYY-MM-DD
  due_time: string | null;     // HH:MM:SS
  rrule: string | null;
  status: TaskStatus;
  last_completed_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskReminderRow {
  id: string;
  task_id: string;
  lead_time_minutes: number;
  channel: ReminderChannel;
  created_at: string;
}

/**
 * Given a recurring task that's just been completed for the day on
 * `currentDue`, return the next occurrence date (YYYY-MM-DD) — or null
 * if the series has ended.
 */
export function nextOccurrenceFor(rrule: string, currentDue: string): string | null {
  // Anchor DTSTART at the *current* due date so the rrule walks forward
  // from where the task actually is, not from when it was first created.
  const [y, m, d] = currentDue.split("-").map((n) => parseInt(n, 10));
  const anchor = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const dtstart = formatDtstart(anchor);
  const text = rrule.startsWith("DTSTART") ? rrule : `${dtstart}\n${rrule}`;
  try {
    const set = rrulestr(text, { forceset: true });
    // First occurrence strictly after `anchor`.
    const next = set.after(anchor, false);
    if (!next) return null;
    return toDateString(next);
  } catch {
    return null;
  }
}

function formatDtstart(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `DTSTART:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T000000`
  );
}

function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIsoDate(): string {
  return toDateString(new Date());
}

export function isOverdue(task: TaskRow): boolean {
  if (task.status === "done") return false;
  return task.due_date < todayIsoDate();
}

export function dueLabel(task: TaskRow): string {
  if (task.status === "done") return "Done";
  const today = todayIsoDate();
  if (task.due_date === today) return "Today";
  const t = new Date(today);
  const tom = new Date(t);
  tom.setDate(t.getDate() + 1);
  const tomStr = toDateString(tom);
  if (task.due_date === tomStr) return "Tomorrow";
  if (task.due_date < today) {
    const days = daysBetween(task.due_date, today);
    return `Overdue by ${days} day${days === 1 ? "" : "s"}`;
  }
  // Future
  const days = daysBetween(today, task.due_date);
  if (days < 7) {
    const dt = new Date(task.due_date);
    return dt.toLocaleDateString("en-GB", { weekday: "long" });
  }
  const dt = new Date(task.due_date);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export function formatDueTime(time: string | null): string {
  if (!time) return "";
  const [hh, mm] = time.split(":");
  return `${hh}:${mm}`;
}
