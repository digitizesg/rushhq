import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { rrulestr } from "rrule";
import type { CalendarEvent } from "@/lib/types";

// We treat Monday as the first day of the week (UK convention).
const WEEK_OPTS = { weekStartsOn: 1 as const };

// ----------------------------------------------------------------------------
// View ranges
// ----------------------------------------------------------------------------

export type CalendarView = "agenda" | "month" | "week" | "day";

/** Days into the future the agenda view looks at. */
export const AGENDA_DAYS = 30;

export interface ViewRange {
  start: Date;
  end: Date;
  /** The start of the *visible grid*, which for month view stretches into
   *  the previous month so we always render full weeks. */
  gridStart: Date;
  gridEnd: Date;
}

export function rangeFor(view: CalendarView, anchor: Date): ViewRange {
  if (view === "agenda") {
    const start = startOfDay(anchor);
    const end = endOfDay(addDays(start, AGENDA_DAYS - 1));
    return { start, end, gridStart: start, gridEnd: end };
  }
  if (view === "month") {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    return {
      start,
      end,
      gridStart: startOfWeek(start, WEEK_OPTS),
      gridEnd: endOfWeek(end, WEEK_OPTS),
    };
  }
  if (view === "week") {
    const start = startOfWeek(anchor, WEEK_OPTS);
    const end = endOfWeek(anchor, WEEK_OPTS);
    return { start, end, gridStart: start, gridEnd: end };
  }
  // day
  return {
    start: startOfDay(anchor),
    end: endOfDay(anchor),
    gridStart: startOfDay(anchor),
    gridEnd: endOfDay(anchor),
  };
}

export function shiftAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === "agenda") return addDays(anchor, AGENDA_DAYS * direction);
  if (view === "month") return addMonths(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  return addDays(anchor, direction);
}

export function viewLabel(view: CalendarView, anchor: Date): string {
  if (view === "agenda") {
    const r = rangeFor("agenda", anchor);
    if (isSameMonth(r.start, r.end)) {
      return `${format(r.start, "d")} – ${format(r.end, "d LLL yyyy")}`;
    }
    return `${format(r.start, "d LLL")} – ${format(r.end, "d LLL yyyy")}`;
  }
  if (view === "month") return format(anchor, "LLLL yyyy");
  if (view === "week") {
    const r = rangeFor("week", anchor);
    if (isSameMonth(r.start, r.end)) {
      return `${format(r.start, "d")} – ${format(r.end, "d LLL yyyy")}`;
    }
    return `${format(r.start, "d LLL")} – ${format(r.end, "d LLL yyyy")}`;
  }
  return format(anchor, "EEE d LLL yyyy");
}

// ----------------------------------------------------------------------------
// Month grid: 6 weeks × 7 days
// ----------------------------------------------------------------------------

export function monthGrid(anchor: Date): Date[][] {
  const r = rangeFor("month", anchor);
  const days: Date[] = [];
  let cursor = r.gridStart;
  while (cursor <= r.gridEnd) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  // Group into weeks of 7.
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

export function weekDayLabels(): string[] {
  // Mon, Tue, ..., Sun. We seed with a known Monday and format.
  const monday = startOfWeek(new Date(2024, 0, 1), WEEK_OPTS);
  return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), "EEE"));
}

// ----------------------------------------------------------------------------
// Occurrences (RRULE expansion)
// ----------------------------------------------------------------------------

export interface EventOccurrence {
  event: CalendarEvent;
  start: Date;
  end: Date;
}

const durationMs = (e: CalendarEvent) =>
  new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime();

/**
 * Expand each event into occurrences that overlap the given window.
 * Non-recurring events become a single occurrence. Recurring events
 * (those with an rrule) are expanded with rrulestr — all client-side.
 */
export function expandOccurrences(
  events: CalendarEvent[],
  window: { start: Date; end: Date },
): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const event of events) {
    const baseStart = new Date(event.starts_at);
    const dur = durationMs(event);

    if (!event.rrule) {
      // Single instance — include if it overlaps the window.
      const start = baseStart;
      const end = new Date(baseStart.getTime() + dur);
      if (end >= window.start && start <= window.end) {
        out.push({ event, start, end });
      }
      continue;
    }

    // RRULE: expand within the window. rrulestr requires DTSTART; if
    // the stored rrule is a bare RRULE: line, prepend it.
    const dtstart = formatDtstart(baseStart);
    const text = event.rrule.startsWith("DTSTART")
      ? event.rrule
      : `DTSTART:${dtstart}\n${event.rrule}`;
    let set;
    try {
      set = rrulestr(text, { forceset: true });
    } catch (e) {
      console.error(`[calendar] failed to parse rrule for event ${event.id}:`, e);
      continue;
    }

    // Pad the rule window by one event-duration so an occurrence that
    // starts before the window but ends inside it still gets included.
    const padded = new Date(window.start.getTime() - dur);
    const occs = set.between(padded, window.end, true);
    for (const occ of occs) {
      const end = new Date(occ.getTime() + dur);
      if (end < window.start || occ > window.end) continue;
      out.push({ event, start: occ, end });
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

function formatDtstart(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function occurrencesOnDay(occs: EventOccurrence[], day: Date): EventOccurrence[] {
  return occs.filter((o) => isSameDay(o.start, day) || (o.start <= day && o.end >= day));
}

// ----------------------------------------------------------------------------
// Recurrence presets — friendly options that map to RRULE strings
// ----------------------------------------------------------------------------

export type RecurrencePreset =
  | "none"
  | "daily"
  | "weekly"
  | "weekdays"
  | "monthly"
  | "yearly"
  | "custom";

export const RECURRENCE_OPTIONS: ReadonlyArray<{ value: RecurrencePreset; label: string }> = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "weekdays", label: "Weekly on weekdays" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
];

export function presetToRrule(
  preset: RecurrencePreset,
  customText: string,
  untilIsoDate?: string | null,
): string {
  const base = (() => {
    switch (preset) {
      case "none":
        return "";
      case "daily":
        return "RRULE:FREQ=DAILY";
      case "weekly":
        return "RRULE:FREQ=WEEKLY";
      case "weekdays":
        return "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
      case "monthly":
        return "RRULE:FREQ=MONTHLY";
      case "yearly":
        return "RRULE:FREQ=YEARLY";
      case "custom":
        return customText.trim();
    }
  })();
  if (!base) return "";
  // For "custom" the user owns the full RRULE string (including any
  // UNTIL they want), so we don't append.
  if (preset === "custom") return base;
  if (!untilIsoDate) return base;
  // iCal UNTIL is a UTC timestamp. Pick end-of-day local on the chosen
  // date and render in UTC.
  const [y, m, d] = untilIsoDate.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return base;
  const dt = new Date(y, m - 1, d, 23, 59, 59);
  const pad = (n: number) => String(n).padStart(2, "0");
  const until =
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;
  return `${base};UNTIL=${until}`;
}

export function rruleToPreset(
  rrule: string | null,
): { preset: RecurrencePreset; custom: string; until: string | null } {
  if (!rrule) return { preset: "none", custom: "", until: null };
  // Extract any UNTIL clause so the rest can match a preset.
  const untilMatch = rrule.match(/UNTIL=([0-9TZ]+)/i);
  let until: string | null = null;
  if (untilMatch) {
    const raw = untilMatch[1];
    if (raw.length >= 8) {
      until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
  }
  const stripped = rrule
    .replace(/(;|^)UNTIL=[0-9TZ]+/i, "$1")
    .replace(/;;+/g, ";")
    .replace(/;$/, "")
    .replace(/^;/, "");
  const normalised = stripped.replace(/\s+/g, "");
  if (normalised === "RRULE:FREQ=DAILY") return { preset: "daily", custom: "", until };
  if (normalised === "RRULE:FREQ=WEEKLY") return { preset: "weekly", custom: "", until };
  if (normalised === "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
    return { preset: "weekdays", custom: "", until };
  if (normalised === "RRULE:FREQ=MONTHLY") return { preset: "monthly", custom: "", until };
  if (normalised === "RRULE:FREQ=YEARLY") return { preset: "yearly", custom: "", until };
  // Custom rules keep their UNTIL inline; we don't surface a separate
  // date input for them.
  return { preset: "custom", custom: rrule, until: null };
}

// ----------------------------------------------------------------------------
// Local datetime <-> ISO helpers for <input type=datetime-local>
// ----------------------------------------------------------------------------

/** ISO "YYYY-MM-DDTHH:mm" expected by datetime-local. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function fromLocalInputValue(v: string): Date {
  // datetime-local has no timezone; treat as local time.
  const [date, time] = v.split("T");
  const [y, m, day] = date.split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = (time ?? "00:00").split(":").map((n) => parseInt(n, 10));
  return new Date(y, (m ?? 1) - 1, day ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}

/** Default starting point for a new event: next round hour. */
export function nextRoundHour(now = new Date()): Date {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Format "Mon 5 May 2026" (UK date convention). */
export function formatBritishDate(d: Date): string {
  return format(d, "EEE d LLL yyyy");
}

/** Format "19:30" (24-hour). */
export function formatTime24(d: Date): string {
  return format(d, "HH:mm");
}
