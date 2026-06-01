// Bead module types + helpers. Mirrors the Postgres schema in
// supabase/migrations/0005_beads.sql.

export type BeadPeriodStatus = "open" | "counted" | "invested";

export interface BeadColour {
  id: string;          // 'white' | 'yellow' | 'green' | 'pink' | 'blue' | 'sparkly_pink'
  name: string;
  hex: string;
  sgd_value: number;
  display_order: number;
}

export interface BeadChart {
  id: string;
  member_id: string;
  effective_from: string;
  effective_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface BeadChartItem {
  id: string;
  chart_id: string;
  bead_colour_id: string;
  description: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface BeadPeriod {
  id: string;
  member_id: string;
  period_start: string;        // YYYY-MM-DD, always first of month
  status: BeadPeriodStatus;
  notes: string | null;
  locked_at: string | null;
  locked_by: string | null;
  invested_at: string | null;
  invested_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BeadPeriodTotal {
  period_id: string;
  member_id: string;
  period_start: string;
  status: BeadPeriodStatus;
  total_sgd: number;
}

export interface BeadCount {
  period_id: string;
  bead_colour_id: string;
  count: number;
}

/** First day of the month containing `d`, as YYYY-MM-DD. */
export function firstOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Shift a YYYY-MM-DD first-of-month by `delta` months. Returns YYYY-MM-DD. */
export function addMonths(periodStart: string, delta: number): string {
  const [y, m] = periodStart.split("-").map((p) => parseInt(p, 10));
  return firstOfMonth(new Date(y, m - 1 + delta, 1));
}

/** Normalise a YYYY-MM or YYYY-MM-DD string to first-of-month YYYY-MM-DD.
 *  Returns null if it isn't a valid year-month. */
export function normalisePeriodStart(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** Format S$ with two decimals, e.g. S$32.80. */
export function formatSGD(n: number): string {
  return `S$${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format a YYYY-MM-DD as "May 2026". */
export function formatPeriodLabel(periodStart: string): string {
  const [y, m] = periodStart.split("-").map((p) => parseInt(p, 10));
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Sum of (count * sgd_value) for a counts dictionary. Same formula
 *  the bead_period_totals view uses. */
export function totalFor(
  counts: Record<string, number>,
  colours: BeadColour[],
): number {
  return colours.reduce(
    (s, c) => s + (counts[c.id] ?? 0) * Number(c.sgd_value),
    0,
  );
}
