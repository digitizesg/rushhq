import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Account,
  AccountSnapshot,
  TotalAssetsRow,
} from "@/lib/finance";
import type { Property, PropertySnapshot } from "@/lib/properties";
import type {
  ChildHolding,
  PortfolioSnapshot,
  PriceCache,
} from "@/lib/stocks";

export interface PropertyEquityRow {
  snapshot_month: string;
  total_equity_sgd: number;
  total_outstanding_sgd: number;
  total_value_sgd: number;
}

export interface FinanceData {
  loading: boolean;
  error: string | null;
  accounts: Account[];
  snapshots: AccountSnapshot[];
  totalsOverTime: TotalAssetsRow[];
  properties: Property[];
  propertySnapshots: PropertySnapshot[];
  propertyEquityOverTime: PropertyEquityRow[];
  // Pulled in for the net-worth dashboard so we don't have to mount the
  // full stocks hook on the finance page just to sum a few values.
  portfolioSnapshots: PortfolioSnapshot[];
  childHoldings: ChildHolding[];
  priceCache: PriceCache[];
  reload: () => Promise<void>;
}

const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export function useFinanceData(): FinanceData {
  const [state, setState] = useState<Omit<FinanceData, "reload">>({
    loading: true,
    error: null,
    accounts: [],
    snapshots: [],
    totalsOverTime: [],
    properties: [],
    propertySnapshots: [],
    propertyEquityOverTime: [],
    portfolioSnapshots: [],
    childHoldings: [],
    priceCache: [],
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [
        accRes,
        snapRes,
        totalRes,
        propRes,
        propSnapRes,
        propEquityRes,
        portSnapRes,
        holdingsRes,
        priceRes,
      ] = await Promise.all([
        supabase.from("accounts").select("*").order("display_order"),
        supabase
          .from("account_snapshots")
          .select("*")
          .order("snapshot_month", { ascending: false }),
        supabase.from("total_assets_over_time").select("*"),
        supabase.from("properties").select("*").order("display_order"),
        supabase
          .from("property_snapshots")
          .select("*")
          .order("snapshot_month", { ascending: false }),
        supabase.from("total_property_equity_over_time").select("*"),
        supabase
          .from("portfolio_snapshots")
          .select("*")
          .order("snapshot_date", { ascending: true }),
        supabase.from("child_holdings").select("*"),
        supabase.from("price_cache").select("*"),
      ]);
      for (const r of [
        accRes,
        snapRes,
        totalRes,
        propRes,
        propSnapRes,
        propEquityRes,
        portSnapRes,
        holdingsRes,
        priceRes,
      ]) {
        if (r.error) throw r.error;
      }
      setState({
        loading: false,
        error: null,
        accounts: (accRes.data ?? []) as Account[],
        snapshots: ((snapRes.data ?? []) as AccountSnapshot[]).map((s) => ({
          ...s,
          balance_sgd: num(s.balance_sgd),
        })),
        totalsOverTime: ((totalRes.data ?? []) as TotalAssetsRow[]).map((r) => ({
          snapshot_month: r.snapshot_month,
          total_sgd: num(r.total_sgd),
        })),
        properties: ((propRes.data ?? []) as Property[]).map((p) => ({
          ...p,
          purchase_price: numOrNull(p.purchase_price),
          total_loan: numOrNull(p.total_loan),
          tenure_months: numOrNull(p.tenure_months),
          interest_rate: numOrNull(p.interest_rate),
        })),
        propertySnapshots: ((propSnapRes.data ?? []) as PropertySnapshot[]).map((s) => ({
          ...s,
          amount_outstanding_sgd: num(s.amount_outstanding_sgd),
          market_value_sgd: numOrNull(s.market_value_sgd),
        })),
        propertyEquityOverTime: ((propEquityRes.data ?? []) as PropertyEquityRow[]).map((r) => ({
          snapshot_month: r.snapshot_month,
          total_equity_sgd: num(r.total_equity_sgd),
          total_outstanding_sgd: num(r.total_outstanding_sgd),
          total_value_sgd: num(r.total_value_sgd),
        })),
        portfolioSnapshots: ((portSnapRes.data ?? []) as PortfolioSnapshot[]).map((s) => ({
          ...s,
          shares_held: num(s.shares_held),
          cost_basis_sgd: num(s.cost_basis_sgd),
          cost_basis_usd: num(s.cost_basis_usd),
          price_usd_at_snapshot: num(s.price_usd_at_snapshot),
          fx_at_snapshot: num(s.fx_at_snapshot),
          value_sgd: num(s.value_sgd),
          value_usd: num(s.value_usd),
        })),
        childHoldings: ((holdingsRes.data ?? []) as ChildHolding[]).map((h) => ({
          ...h,
          shares_held: num(h.shares_held),
          cost_basis_sgd: num(h.cost_basis_sgd),
          cost_basis_usd: num(h.cost_basis_usd),
        })),
        priceCache: ((priceRes.data ?? []) as PriceCache[]).map((p) => ({
          ...p,
          price: num(p.price),
        })),
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
