import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/auth-context";
import {
  firstOfMonth,
  formatPeriodLabel,
  formatSGD,
  type BeadCategory,
  type BeadChart,
  type BeadChartItem,
  type BeadColour,
  type BeadPeriodTotal,
} from "@/lib/beads";
import { LoadingScreen } from "@/components/loading-screen";
import { BeadDot } from "@/components/bead-dot";
import { CategoryIcon } from "@/components/category-icon";

interface ChildState {
  loading: boolean;
  error: string | null;
  chart: BeadChart | null;
  items: BeadChartItem[];
  colours: BeadColour[];
  categories: BeadCategory[];
  totals: BeadPeriodTotal[];
}

export default function MyBeadsPage() {
  const { member } = useAuth();
  const today = useMemo(() => new Date(), []);
  const thisMonthStart = firstOfMonth(today);

  const [state, setState] = useState<ChildState>({
    loading: true,
    error: null,
    chart: null,
    items: [],
    colours: [],
    categories: [],
    totals: [],
  });

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    (async () => {
      try {
        const [coloursRes, catsRes, chartRes, totalsRes] = await Promise.all([
          supabase.from("bead_colours").select("*").order("display_order"),
          supabase.from("bead_categories").select("*").order("display_order"),
          supabase
            .from("bead_charts")
            .select("*")
            .eq("member_id", member.id)
            .is("effective_until", null)
            .maybeSingle(),
          supabase
            .from("bead_period_totals")
            .select("*")
            .eq("member_id", member.id)
            .order("period_start", { ascending: true }),
        ]);
        for (const r of [coloursRes, catsRes, chartRes, totalsRes]) {
          if (r.error) throw r.error;
        }

        let items: BeadChartItem[] = [];
        if (chartRes.data) {
          const itemsRes = await supabase
            .from("bead_chart_items")
            .select("*")
            .eq("chart_id", (chartRes.data as BeadChart).id)
            .order("display_order");
          if (itemsRes.error) throw itemsRes.error;
          items = (itemsRes.data ?? []) as BeadChartItem[];
        }

        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          chart: (chartRes.data as BeadChart) ?? null,
          items,
          colours: (coloursRes.data ?? []) as BeadColour[],
          categories: (catsRes.data ?? []) as BeadCategory[],
          totals: ((totalsRes.data ?? []) as BeadPeriodTotal[]).map((t) => ({
            ...t,
            total_sgd: Number(t.total_sgd),
          })),
        });
      } catch (e) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member]);

  if (!member) return null;
  if (member.member_type !== "child") return <Navigate to="/" replace />;
  if (state.loading) return <LoadingScreen />;

  const potentialThisMonth = state.items.reduce((sum, item) => {
    const c = state.colours.find((x) => x.id === item.bead_colour_id);
    return sum + (c ? Number(c.sgd_value) : 0);
  }, 0);
  const last6 = state.totals.slice(-6);
  const thisMonthTotal = state.totals.find((t) => t.period_start === thisMonthStart)?.total_sgd ?? 0;

  return (
    <section className="mx-auto max-w-[820px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">
          {formatPeriodLabel(thisMonthStart)}
        </p>
        <h1 className="text-[28px] font-medium text-ink">
          Hi {member.short_name}
        </h1>
      </div>

      {state.error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[13px] px-4 py-3">
          {state.error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="So far this month" value={formatSGD(thisMonthTotal)} />
        <Stat
          label="If you do everything"
          value={`up to ${formatSGD(potentialThisMonth)}`}
        />
      </div>

      {!state.chart ? (
        <div className="bg-white border border-line rounded-lg p-6 text-[14px] text-muted">
          No chart yet. Ask Mum or Dad.
        </div>
      ) : (
        <div className="space-y-5">
          {state.categories.map((cat) => {
            const catItems = state.items
              .filter((i) => i.category_id === cat.id)
              .sort((a, b) => a.display_order - b.display_order);
            if (catItems.length === 0) return null;
            return (
              <div key={cat.id} className="bg-white border border-line rounded-lg overflow-hidden">
                <header className="flex items-center gap-2 px-5 py-3 bg-soft border-b border-line">
                  <CategoryIcon name={cat.icon} size={16} className="text-muted" />
                  <span className="text-[14px] font-semibold text-ink">{cat.name}</span>
                </header>
                <ul className="divide-y divide-line">
                  {catItems.map((item) => {
                    const c = state.colours.find((x) => x.id === item.bead_colour_id);
                    return (
                      <li
                        key={item.id}
                        className="flex items-center gap-3 px-5 py-3 text-[14.5px] text-ink"
                      >
                        <BeadDot
                          hex={c?.hex ?? "#cccccc"}
                          sparkly={c?.id === "sparkly_pink"}
                          size={18}
                        />
                        <span className="flex-1">{item.description}</span>
                        <span className="text-muted text-[13px] tnum">
                          {c ? formatSGD(Number(c.sgd_value)) : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {last6.length > 1 && <GrowthChart points={last6} />}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-line rounded-lg p-5">
      <p className="text-[12px] uppercase tracking-wider text-muted mb-1">{label}</p>
      <p className="text-[24px] font-semibold text-ink tnum">{value}</p>
    </div>
  );
}

function GrowthChart({ points }: { points: BeadPeriodTotal[] }) {
  const max = Math.max(1, ...points.map((p) => p.total_sgd));
  return (
    <div className="bg-white border border-line rounded-lg p-5">
      <p className="text-[12px] uppercase tracking-wider text-muted mb-3">
        Last {points.length} months
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${points.length}, 1fr)` }}>
        {points.map((p) => {
          const h = Math.max(6, (p.total_sgd / max) * 80);
          return (
            <div key={p.period_id} className="flex flex-col items-center gap-1.5">
              <div className="w-full h-20 flex items-end">
                <span
                  className="w-full bg-primary-soft rounded-sm"
                  style={{ height: `${h}px` }}
                />
              </div>
              <p className="text-[11px] text-muted tnum">
                {formatPeriodLabel(p.period_start).slice(0, 3)}
              </p>
              <p className="text-[12px] text-ink tnum">{formatSGD(p.total_sgd)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
