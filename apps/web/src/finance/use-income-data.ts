import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { IncomeDeposit } from "@/lib/income";

export interface IncomeData {
  loading: boolean;
  error: string | null;
  deposits: IncomeDeposit[];
  reload: () => Promise<void>;
}

export function useIncomeData(): IncomeData {
  const [state, setState] = useState<Omit<IncomeData, "reload">>({
    loading: true,
    error: null,
    deposits: [],
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const { data, error } = await supabase
      .from("income_deposits")
      .select("*")
      .order("txn_date", { ascending: false });
    if (error) {
      setState({ loading: false, error: error.message, deposits: [] });
      return;
    }
    setState({
      loading: false,
      error: null,
      deposits: ((data ?? []) as IncomeDeposit[]).map((d) => ({
        ...d,
        amount: Number(d.amount),
      })),
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
