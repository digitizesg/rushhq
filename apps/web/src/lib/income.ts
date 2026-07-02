export const OTHER_GROUP = "(other)";

export interface IncomeDeposit {
  id: string;
  txn_date: string; // yyyy-mm-dd
  amount: number;
  counterparty: string;
  income_group: string; // a company, or OTHER_GROUP
  is_large: boolean;
  statement_month: string | null;
  source_file: string | null;
}

// Distinct hues for the named income groups, assigned by descending total.
export const GROUP_COLOURS = [
  "#2563eb", // blue
  "#059669", // emerald
  "#7c3aed", // violet
  "#d97706", // amber
  "#0891b2", // cyan
  "#db2777", // rose
  "#4f46e5", // indigo
  "#0d9488", // teal
];

/** Period key for a deposit: "2026" (year) or "2026-05" (month). */
export function periodOf(dateIso: string, freq: "year" | "month"): string {
  return freq === "year" ? dateIso.slice(0, 4) : dateIso.slice(0, 7);
}

/** Normalise a raw payer so the same source groups together (mirrors the
 *  analyser's _norm_source): upper-case, collapse spaces, drop long codes. */
export function normSource(s: string): string {
  return (s || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\b\d{4,}\b/g, "")
    .trim();
}
