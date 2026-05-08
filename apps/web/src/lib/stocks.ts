// Stock module types + helpers. Mirrors supabase/migrations/0008_stocks.sql.

export type StockTransactionType =
  | "bead_purchase"
  | "gift_purchase"
  | "dividend_reinvest"
  | "withdrawal";

export type StockAllocationSource =
  | "bead_period"
  | "pending_deposit"
  | "dividend"
  | "withdrawal";

export type PendingDepositStatus = "pending" | "invested" | "cancelled";

export interface StockTransaction {
  id: string;
  transaction_type: StockTransactionType;
  transaction_date: string;
  total_shares: number;
  price_per_share_usd: number;
  usd_to_sgd_rate: number;
  total_usd: number;
  total_sgd: number;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface StockAllocation {
  id: string;
  transaction_id: string;
  member_id: string;
  shares: number;
  cost_sgd: number;
  cost_usd: number;
  source_type: StockAllocationSource;
  source_id: string | null;
  created_at: string;
}

export interface PendingDeposit {
  id: string;
  member_id: string;
  amount_sgd: number;
  source: string;
  received_date: string;
  status: PendingDepositStatus;
  invested_transaction_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PriceCache {
  symbol: string;
  price: number;
  last_updated: string;
}

export interface ChildHolding {
  member_id: string;
  short_name: string;
  shares_held: number;
  cost_basis_sgd: number;
  cost_basis_usd: number;
}

export interface PortfolioSnapshot {
  id: string;
  member_id: string;
  snapshot_date: string;
  shares_held: number;
  cost_basis_sgd: number;
  cost_basis_usd: number;
  price_usd_at_snapshot: number;
  fx_at_snapshot: number;
  value_sgd: number;
  value_usd: number;
  created_at: string;
}

export function formatUSD(n: number): string {
  return `US$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSGD(n: number): string {
  return `S$${n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatShares(n: number): string {
  return n.toLocaleString("en-SG", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

/** YYYY-MM-DD for an HTML <input type=date> default. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const TRANSACTION_TYPE_LABEL: Record<StockTransactionType, string> = {
  bead_purchase: "Monthly purchase",
  gift_purchase: "Gift purchase",
  dividend_reinvest: "Dividend reinvest",
  withdrawal: "Withdrawal",
};
