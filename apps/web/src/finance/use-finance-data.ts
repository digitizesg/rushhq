import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Account,
  AccountSnapshot,
  TotalAssetsRow,
} from "@/lib/finance";

export interface FinanceData {
  loading: boolean;
  error: string | null;
  accounts: Account[];
  snapshots: AccountSnapshot[];
  totalsOverTime: TotalAssetsRow[];
  reload: () => Promise<void>;
}

const num = (v: unknown) => Number(v ?? 0);

export function useFinanceData(): FinanceData {
  const [state, setState] = useState<Omit<FinanceData, "reload">>({
    loading: true,
    error: null,
    accounts: [],
    snapshots: [],
    totalsOverTime: [],
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [accRes, snapRes, totalRes] = await Promise.all([
        supabase.from("accounts").select("*").order("display_order"),
        supabase.from("account_snapshots").select("*").order("snapshot_month", { ascending: false }),
        supabase.from("total_assets_over_time").select("*"),
      ]);
      for (const r of [accRes, snapRes, totalRes]) if (r.error) throw r.error;
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
