import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Account,
  AccountSnapshot,
  TotalAssetsRow,
} from "@/lib/finance";
import type { Property, PropertySnapshot } from "@/lib/properties";

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
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [accRes, snapRes, totalRes, propRes, propSnapRes, propEquityRes] = await Promise.all([
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
      ]);
      for (const r of [accRes, snapRes, totalRes, propRes, propSnapRes, propEquityRes]) {
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
