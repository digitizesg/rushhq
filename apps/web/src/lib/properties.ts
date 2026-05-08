import { differenceInCalendarMonths } from "date-fns";

export type PropertyCategory = "personal" | "commercial";

export interface Property {
  id: string;
  name: string;
  short_name: string;
  category: PropertyCategory;
  purchase_price: number | null;
  purchase_date: string | null;
  total_loan: number | null;
  tenure_months: number | null;
  interest_rate: number | null;     // % APR (e.g. 4.0125 for 4.0125%)
  rate_end_date: string | null;
  notes: string | null;
  display_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PropertySnapshot {
  id: string;
  property_id: string;
  snapshot_month: string;            // YYYY-MM-DD (first of month)
  amount_outstanding_sgd: number;
  market_value_sgd: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Standard amortising-loan outstanding-balance formula.
 *
 *     B(n) = L × [(1+r)^N − (1+r)^n] / [(1+r)^N − 1]
 *
 * where L = original loan, r = monthly rate, N = total months,
 * n = months elapsed. Used to estimate outstanding for HDB and
 * Toh Guan when we don't have a statement to copy from.
 */
export function estimateOutstanding(
  property: Property,
  asOfMonthIso: string,            // YYYY-MM-DD (1st of target month)
): number | null {
  const loan = property.total_loan;
  const rateAnnual = property.interest_rate;
  const tenureMonths = property.tenure_months;
  const purchaseDate = property.purchase_date;
  if (
    loan == null || loan <= 0 ||
    rateAnnual == null || rateAnnual < 0 ||
    tenureMonths == null || tenureMonths <= 0 ||
    !purchaseDate
  ) {
    return null;
  }

  const start = new Date(purchaseDate + "T00:00:00");
  const target = new Date(asOfMonthIso + "T00:00:00");
  const elapsed = Math.max(0, differenceInCalendarMonths(target, start));
  if (elapsed >= tenureMonths) return 0;

  const r = rateAnnual / 100 / 12;
  if (r === 0) {
    // Zero-interest case: linear amortisation.
    return Math.max(0, loan * (1 - elapsed / tenureMonths));
  }
  const factor = Math.pow(1 + r, tenureMonths);
  const accrued = Math.pow(1 + r, elapsed);
  const outstanding = (loan * (factor - accrued)) / (factor - 1);
  return Math.max(0, outstanding);
}

/** Equity = market value − outstanding loan. Falls back to 0 if no
 *  market estimate is set yet. */
export function equityFor(snap: PropertySnapshot | undefined): number {
  if (!snap) return 0;
  return (snap.market_value_sgd ?? 0) - snap.amount_outstanding_sgd;
}

/** Loan-to-value as a percent. Returns null if either side missing. */
export function ltvFor(snap: PropertySnapshot | undefined): number | null {
  if (!snap || !snap.market_value_sgd || snap.market_value_sgd <= 0) return null;
  return (snap.amount_outstanding_sgd / snap.market_value_sgd) * 100;
}

/** Returns days until the rate package ends. Negative = already past. */
export function daysUntilRateEnd(rateEndIso: string | null): number | null {
  if (!rateEndIso) return null;
  const end = new Date(rateEndIso + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Refi window — true if rate ends within 90 days (or already past). */
export function isRefiSoon(rateEndIso: string | null): boolean {
  const d = daysUntilRateEnd(rateEndIso);
  if (d == null) return false;
  return d <= 90;
}

export function formatLoanRate(pct: number | null): string {
  if (pct == null) return "—";
  return `${pct.toFixed(pct % 1 === 0 ? 1 : 4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function formatTenure(months: number | null): string {
  if (months == null) return "—";
  if (months % 12 === 0) return `${months / 12} years`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}y ${m}m` : `${m} months`;
}
