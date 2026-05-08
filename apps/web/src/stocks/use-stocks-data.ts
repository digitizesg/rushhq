// Loads everything the stock pages need: holdings (view), transactions
// + allocations, pending deposits, price cache, recent snapshots, kid
// roster, and the bead periods + totals that feed the buy flow.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  ChildHolding,
  PendingDeposit,
  PortfolioSnapshot,
  PriceCache,
  StockAllocation,
  StockTransaction,
} from "@/lib/stocks";
import type { FamilyMember } from "@/lib/types";
import type { BeadPeriod, BeadPeriodTotal } from "@/lib/beads";

export interface StocksData {
  loading: boolean;
  error: string | null;
  children: FamilyMember[];
  holdings: ChildHolding[];
  transactions: StockTransaction[];
  allocations: StockAllocation[];
  pendingDeposits: PendingDeposit[];
  priceCache: PriceCache[];
  snapshots: PortfolioSnapshot[];
  beadPeriods: BeadPeriod[];
  beadTotals: BeadPeriodTotal[];
  reload: () => Promise<void>;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

export function useStocksData(): StocksData {
  const [state, setState] = useState<Omit<StocksData, "reload">>({
    loading: true,
    error: null,
    children: [],
    holdings: [],
    transactions: [],
    allocations: [],
    pendingDeposits: [],
    priceCache: [],
    snapshots: [],
    beadPeriods: [],
    beadTotals: [],
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [
        childrenRes,
        holdingsRes,
        txRes,
        allocRes,
        pendingRes,
        priceRes,
        snapsRes,
        periodsRes,
        totalsRes,
      ] = await Promise.all([
        supabase.from("family_members").select("*").eq("active", true).eq("member_type", "child").order("short_name"),
        supabase.from("child_holdings").select("*"),
        supabase.from("stock_transactions").select("*").order("transaction_date", { ascending: false }),
        supabase.from("stock_allocations").select("*"),
        supabase.from("pending_deposits").select("*").order("received_date", { ascending: false }),
        supabase.from("price_cache").select("*"),
        supabase.from("portfolio_snapshots").select("*").order("snapshot_date", { ascending: true }),
        supabase.from("bead_periods").select("*").order("period_start", { ascending: false }),
        supabase.from("bead_period_totals").select("*"),
      ]);

      for (const r of [childrenRes, holdingsRes, txRes, allocRes, pendingRes, priceRes, snapsRes, periodsRes, totalsRes]) {
        if (r.error) throw r.error;
      }

      setState({
        loading: false,
        error: null,
        children: (childrenRes.data ?? []) as FamilyMember[],
        holdings: ((holdingsRes.data ?? []) as ChildHolding[]).map((h) => ({
          ...h,
          shares_held: num(h.shares_held),
          cost_basis_sgd: num(h.cost_basis_sgd),
          cost_basis_usd: num(h.cost_basis_usd),
        })),
        transactions: ((txRes.data ?? []) as StockTransaction[]).map((t) => ({
          ...t,
          total_shares: num(t.total_shares),
          price_per_share_usd: num(t.price_per_share_usd),
          usd_to_sgd_rate: num(t.usd_to_sgd_rate),
          total_usd: num(t.total_usd),
          total_sgd: num(t.total_sgd),
        })),
        allocations: ((allocRes.data ?? []) as StockAllocation[]).map((a) => ({
          ...a,
          shares: num(a.shares),
          cost_sgd: num(a.cost_sgd),
          cost_usd: num(a.cost_usd),
        })),
        pendingDeposits: ((pendingRes.data ?? []) as PendingDeposit[]).map((d) => ({
          ...d,
          amount_sgd: num(d.amount_sgd),
        })),
        priceCache: ((priceRes.data ?? []) as PriceCache[]).map((p) => ({
          ...p,
          price: num(p.price),
        })),
        snapshots: ((snapsRes.data ?? []) as PortfolioSnapshot[]).map((s) => ({
          ...s,
          shares_held: num(s.shares_held),
          cost_basis_sgd: num(s.cost_basis_sgd),
          cost_basis_usd: num(s.cost_basis_usd),
          price_usd_at_snapshot: num(s.price_usd_at_snapshot),
          fx_at_snapshot: num(s.fx_at_snapshot),
          value_sgd: num(s.value_sgd),
          value_usd: num(s.value_usd),
        })),
        beadPeriods: (periodsRes.data ?? []) as BeadPeriod[],
        beadTotals: ((totalsRes.data ?? []) as BeadPeriodTotal[]).map((t) => ({
          ...t,
          total_sgd: num(t.total_sgd),
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

export function priceOf(cache: PriceCache[], symbol: string): number {
  return num(cache.find((p) => p.symbol === symbol)?.price);
}

export function lastUpdatedOf(cache: PriceCache[]): string | null {
  if (cache.length === 0) return null;
  const latest = cache.reduce((a, b) =>
    new Date(a.last_updated) > new Date(b.last_updated) ? a : b,
  );
  return latest.last_updated;
}
