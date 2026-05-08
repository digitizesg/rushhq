// Loads everything the bead pages need in one go: the bead reference
// colours, the charts per child, items, periods, totals, counts, plus
// the kid roster.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  BeadChart,
  BeadChartItem,
  BeadColour,
  BeadCount,
  BeadPeriod,
  BeadPeriodTotal,
} from "@/lib/beads";
import type { FamilyMember } from "@/lib/types";

export interface BeadData {
  loading: boolean;
  error: string | null;
  colours: BeadColour[];
  children: FamilyMember[];
  charts: BeadChart[];
  items: BeadChartItem[];
  periods: BeadPeriod[];
  totals: BeadPeriodTotal[];
  counts: BeadCount[];
  reload: () => Promise<void>;
}

export function useBeadData(): BeadData {
  const [state, setState] = useState<Omit<BeadData, "reload">>({
    loading: true,
    error: null,
    colours: [],
    children: [],
    charts: [],
    items: [],
    periods: [],
    totals: [],
    counts: [],
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [
        coloursRes,
        childrenRes,
        chartsRes,
        itemsRes,
        periodsRes,
        totalsRes,
        countsRes,
      ] = await Promise.all([
        supabase.from("bead_colours").select("*").order("display_order"),
        supabase
          .from("family_members")
          .select("*")
          .eq("active", true)
          .eq("member_type", "child")
          .order("short_name"),
        supabase.from("bead_charts").select("*").order("effective_from", { ascending: false }),
        supabase
          .from("bead_chart_items")
          .select("*")
          .order("display_order"),
        supabase.from("bead_periods").select("*").order("period_start", { ascending: false }),
        supabase.from("bead_period_totals").select("*"),
        supabase.from("bead_counts").select("*"),
      ]);

      for (const r of [coloursRes, childrenRes, chartsRes, itemsRes, periodsRes, totalsRes, countsRes]) {
        if (r.error) throw r.error;
      }

      setState({
        loading: false,
        error: null,
        colours: (coloursRes.data ?? []) as BeadColour[],
        children: (childrenRes.data ?? []) as FamilyMember[],
        charts: (chartsRes.data ?? []) as BeadChart[],
        items: (itemsRes.data ?? []) as BeadChartItem[],
        periods: (periodsRes.data ?? []) as BeadPeriod[],
        totals: ((totalsRes.data ?? []) as BeadPeriodTotal[]).map((t) => ({
          ...t,
          total_sgd: Number(t.total_sgd),
        })),
        counts: (countsRes.data ?? []) as BeadCount[],
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
