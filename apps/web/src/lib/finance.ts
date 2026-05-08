// Finance module types + helpers. Mirrors 0009_finance.sql.

export type AccountType = "personal" | "business" | "investment";

export interface Account {
  id: string;
  name: string;
  entity: string;
  account_type: AccountType;
  currency: string;
  display_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountSnapshot {
  id: string;
  account_id: string;
  snapshot_month: string;        // YYYY-MM-DD, first of month
  balance_sgd: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TotalAssetsRow {
  snapshot_month: string;
  total_sgd: number;
}

export function formatSGD(n: number): string {
  return `S$${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSGDWhole(n: number): string {
  return `S$${n.toLocaleString("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** First day of `d`'s month, as YYYY-MM-DD. */
export function firstOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** YYYY-MM. */
export function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "May 2026". */
export function formatMonthLabel(yyyymmdd: string): string {
  const [y, m] = yyyymmdd.split("-").map((p) => parseInt(p, 10));
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** "2026-05" -> "2026-05-01" */
export function ymToFirstDay(ym: string): string {
  return `${ym}-01`;
}

/** Subtract n months from `yyyymmdd`. */
export function shiftMonth(yyyymmdd: string, deltaMonths: number): string {
  const [y, m] = yyyymmdd.split("-").map((p) => parseInt(p, 10));
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return firstOfMonth(d);
}
