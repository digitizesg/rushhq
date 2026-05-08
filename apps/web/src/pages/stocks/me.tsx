import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/auth-context";
import {
  formatSGD,
  type PortfolioSnapshot,
  type StockAllocation,
} from "@/lib/stocks";
import { LoadingScreen } from "@/components/loading-screen";

interface ChildState {
  loading: boolean;
  error: string | null;
  shares: number;
  costBasisSgd: number;
  voo: number;
  fx: number;
  snapshots: PortfolioSnapshot[];
  contributions: StockAllocation[];
}

const num = (v: unknown) => Number(v ?? 0);

export default function MyStocksPage() {
  const { member } = useAuth();
  const [s, setS] = useState<ChildState>({
    loading: true,
    error: null,
    shares: 0,
    costBasisSgd: 0,
    voo: 0,
    fx: 0,
    snapshots: [],
    contributions: [],
  });
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    (async () => {
      try {
        const [holdingsRes, snapsRes, allocsRes, priceRes] = await Promise.all([
          supabase.from("child_holdings").select("*").eq("member_id", member.id).maybeSingle(),
          supabase.from("portfolio_snapshots").select("*").eq("member_id", member.id).order("snapshot_date", { ascending: true }),
          supabase.from("stock_allocations").select("*").eq("member_id", member.id).order("created_at", { ascending: false }),
          supabase.from("price_cache").select("*"),
        ]);
        for (const r of [holdingsRes, snapsRes, allocsRes, priceRes]) {
          if (r.error) throw r.error;
        }
        const prices = (priceRes.data ?? []) as Array<{ symbol: string; price: number | string }>;
        const voo = num(prices.find((p) => p.symbol === "VOO")?.price);
        const fx  = num(prices.find((p) => p.symbol === "USDSGD")?.price);

        const h = holdingsRes.data as { shares_held?: number | string; cost_basis_sgd?: number | string } | null;
        const snaps = ((snapsRes.data ?? []) as PortfolioSnapshot[]).map((row) => ({
          ...row,
          shares_held: num(row.shares_held),
          cost_basis_sgd: num(row.cost_basis_sgd),
          cost_basis_usd: num(row.cost_basis_usd),
          price_usd_at_snapshot: num(row.price_usd_at_snapshot),
          fx_at_snapshot: num(row.fx_at_snapshot),
          value_sgd: num(row.value_sgd),
          value_usd: num(row.value_usd),
        }));
        const allocs = ((allocsRes.data ?? []) as StockAllocation[]).map((a) => ({
          ...a,
          shares: num(a.shares),
          cost_sgd: num(a.cost_sgd),
          cost_usd: num(a.cost_usd),
        }));

        if (cancelled) return;
        setS({
          loading: false,
          error: null,
          shares: num(h?.shares_held),
          costBasisSgd: num(h?.cost_basis_sgd),
          voo,
          fx,
          snapshots: snaps,
          contributions: allocs.filter((a) => a.shares > 0), // hide withdrawals from the list
        });
      } catch (e) {
        if (!cancelled) {
          setS((p) => ({ ...p, loading: false, error: (e as Error).message }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member]);

  if (!member) return null;
  if (member.member_type !== "child") return <Navigate to="/" replace />;
  if (s.loading) return <LoadingScreen />;

  const valueSgd = s.shares * s.voo * s.fx;
  const gainSgd = valueSgd - s.costBasisSgd;
  const last12 = s.snapshots.slice(-12);

  return (
    <section className="mx-auto max-w-[820px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div>
        <p className="text-[14px] uppercase tracking-wider text-muted mb-1">Your investment</p>
        <h1 className="text-[30px] font-medium text-ink">Hi {member.short_name}</h1>
      </div>

      {s.error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[15px] px-4 py-3">
          {s.error}
        </div>
      )}

      <div className="bg-white border border-line rounded-lg p-6 sm:p-8 text-center space-y-2">
        <p className="text-[14.5px] uppercase tracking-wider text-muted">You have</p>
        <p className="text-[clamp(36px,7vw,52px)] font-semibold text-ink tnum leading-none">
          {formatSGD(valueSgd)}
        </p>
        <p
          className={[
            "text-[16px] tnum",
            gainSgd >= 0 ? "text-emerald" : "text-danger",
          ].join(" ")}
        >
          {gainSgd >= 0 ? "↑" : "↓"} {gainSgd >= 0 ? "+" : "−"}{formatSGD(Math.abs(gainSgd))} since you started
        </p>
      </div>

      {last12.length > 1 && <BigChart points={last12} />}

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        className="text-[15.5px] text-primary hover:underline"
      >
        {more ? "Hide details" : "Want to know more?"}
      </button>

      {more && (
        <div className="bg-white border border-line rounded-lg p-5 space-y-3">
          <p className="text-[16.5px] text-ink">
            You hold <span className="font-semibold tnum">{s.shares.toFixed(4)}</span> shares.
          </p>
          {s.contributions.length > 0 && (
            <>
              <p className="text-[14.5px] uppercase tracking-wider text-muted mt-3">Your contributions</p>
              <ul className="space-y-1">
                {s.contributions.map((c) => (
                  <li key={c.id} className="text-[15.5px] text-ink flex items-baseline justify-between gap-3">
                    <span className="text-muted tnum">{c.created_at.slice(0, 10)}</span>
                    <span className="text-muted">{c.source_type.replace("_", " ")}</span>
                    <span className="tnum">{formatSGD(c.cost_sgd)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-[15px] text-muted leading-relaxed pt-3 border-t border-line">
            The longer you keep it in, the bigger it gets. Small amounts grow into something
            really big over time.
          </p>
        </div>
      )}

      <p className="text-[14.5px] text-muted text-center pt-2">
        If you ever want to take some out, ask Mum or Dad.
      </p>
    </section>
  );
}

function BigChart({ points }: { points: PortfolioSnapshot[] }) {
  const values = points.map((p) => p.value_sgd);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const w = 100;
  const h = 40;
  const step = points.length > 1 ? w / (points.length - 1) : w;

  const linePath = points.map((p, i) => {
    const x = i * step;
    const y = h - ((p.value_sgd - min) / span) * h;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");

  const areaPath =
    `${linePath} L ${(points.length - 1) * step} ${h} L 0 ${h} Z`;

  return (
    <div className="bg-white border border-line rounded-lg p-5">
      <p className="text-[14.5px] uppercase tracking-wider text-muted mb-2">Last {points.length} months</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32 sm:h-40 text-emerald" preserveAspectRatio="none">
        <path d={areaPath} fill="currentColor" opacity="0.15" />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between mt-2 text-[13px] text-muted tnum">
        <span>{points[0]?.snapshot_date.slice(0, 7)}</span>
        <span>{points[points.length - 1]?.snapshot_date.slice(0, 7)}</span>
      </div>
    </div>
  );
}
