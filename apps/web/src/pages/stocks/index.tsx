import { Link } from "react-router-dom";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw, Sparkles } from "lucide-react";
import { useStocksData, priceOf, lastUpdatedOf } from "@/stocks/use-stocks-data";
import {
  formatSGD,
  formatShares,
  formatUSD,
  type ChildHolding,
} from "@/lib/stocks";
import { LoadingScreen } from "@/components/loading-screen";
import { supabase } from "@/lib/supabase";

export default function StocksOverviewPage() {
  const data = useStocksData();
  const [refreshing, setRefreshing] = useState(false);

  if (data.loading) return <LoadingScreen />;

  const voo = priceOf(data.priceCache, "VOO");
  const fx = priceOf(data.priceCache, "USDSGD");
  const lastUpdated = lastUpdatedOf(data.priceCache);

  // Family-level totals
  const totalShares = data.holdings.reduce((s, h) => s + h.shares_held, 0);
  const totalCostSgd = data.holdings.reduce((s, h) => s + h.cost_basis_sgd, 0);
  const totalCostUsd = data.holdings.reduce((s, h) => s + h.cost_basis_usd, 0);
  const totalValueUsd = totalShares * voo;
  const totalValueSgd = totalValueUsd * fx;
  const gainSgd = totalValueSgd - totalCostSgd;

  // Ready-to-invest: counted bead periods + pending deposits
  const countedPeriods = data.beadPeriods.filter((p) => p.status === "counted");
  const readyBeadSgd = countedPeriods.reduce((s, p) => {
    const t = data.beadTotals.find((bt) => bt.period_id === p.id);
    return s + (t?.total_sgd ?? 0);
  }, 0);
  const pendingDepositsActive = data.pendingDeposits.filter(
    (d) => d.status === "pending",
  );
  const readyDepositSgd = pendingDepositsActive.reduce(
    (s, d) => s + d.amount_sgd,
    0,
  );
  const readyTotal = readyBeadSgd + readyDepositSgd;

  async function refreshPrices() {
    setRefreshing(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) return;
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-prices`,
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
      );
      await data.reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted mb-1">Stocks</p>
          <h1 className="text-[28px] font-medium text-ink">VOO holdings</h1>
        </div>
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          {lastUpdated ? (
            <>
              <span>VOO {formatUSD(voo)} · USD/SGD {fx.toFixed(4)}</span>
              <span>· {timeSince(lastUpdated)}</span>
            </>
          ) : (
            <span>Prices not yet fetched</span>
          )}
          <button
            type="button"
            onClick={refreshPrices}
            disabled={refreshing}
            aria-label="Refresh prices"
            className="size-7 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-soft disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {data.error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[13px] px-4 py-3">
          {data.error}
        </div>
      )}

      {/* Family summary */}
      <div className="bg-white border border-line rounded-lg p-5 sm:p-6 grid gap-5 sm:grid-cols-4">
        <Stat label="Total shares" value={formatShares(totalShares)} />
        <Stat label="Cost basis (SGD)" value={formatSGD(totalCostSgd)} sub={formatUSD(totalCostUsd)} />
        <Stat label="Current value (SGD)" value={formatSGD(totalValueSgd)} sub={formatUSD(totalValueUsd)} />
        <GainStat label="Unrealised gain" amount={gainSgd} />
      </div>

      {/* Ready to invest */}
      {readyTotal > 0 && (
        <div className="bg-emerald-soft/40 border border-emerald/30 rounded-lg p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Sparkles size={18} className="text-emerald mt-0.5" />
            <div>
              <p className="text-[15px] font-semibold text-ink">
                {formatSGD(readyTotal)} ready to invest
              </p>
              <p className="text-[13px] text-muted mt-0.5">
                {countedPeriods.length} bead {countedPeriods.length === 1 ? "period" : "periods"}{" "}
                · {pendingDepositsActive.length} pending{" "}
                {pendingDepositsActive.length === 1 ? "deposit" : "deposits"}
              </p>
            </div>
          </div>
          <Link
            to="/stocks/buy"
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white text-[14px] font-medium hover:bg-primary-strong transition-colors"
          >
            Record monthly purchase
          </Link>
        </div>
      )}

      {/* Per-child cards */}
      <div className="grid gap-5 md:grid-cols-2">
        {data.children.map((c) => {
          const h = data.holdings.find((x) => x.member_id === c.id);
          const childSnaps = data.snapshots
            .filter((s) => s.member_id === c.id)
            .slice(-12);
          const pendingForChild = pendingDepositsActive.filter((d) => d.member_id === c.id).length;
          return (
            <ChildCard
              key={c.id}
              name={c.short_name}
              holding={h}
              snaps={childSnaps}
              voo={voo}
              fx={fx}
              pendingCount={pendingForChild}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/stocks/buy" className="inline-flex items-center h-9 px-3 rounded-md border border-line text-[13.5px] hover:bg-soft">
          Record purchase
        </Link>
        <Link to="/stocks/dividend" className="inline-flex items-center h-9 px-3 rounded-md border border-line text-[13.5px] hover:bg-soft">
          Record dividend
        </Link>
        <Link to="/stocks/withdrawal" className="inline-flex items-center h-9 px-3 rounded-md border border-line text-[13.5px] hover:bg-soft">
          Record withdrawal
        </Link>
        <Link to="/stocks/deposits" className="inline-flex items-center h-9 px-3 rounded-md border border-line text-[13.5px] hover:bg-soft">
          Manage deposits
        </Link>
        <Link to="/stocks/transactions" className="inline-flex items-center h-9 px-3 rounded-md border border-line text-[13.5px] hover:bg-soft">
          All transactions
        </Link>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11.5px] uppercase tracking-wider text-muted mb-1">{label}</p>
      <p className="text-[20px] font-semibold text-ink tnum">{value}</p>
      {sub && <p className="text-[12px] text-muted mt-0.5 tnum">{sub}</p>}
    </div>
  );
}

function GainStat({ label, amount }: { label: string; amount: number }) {
  const positive = amount >= 0;
  return (
    <div>
      <p className="text-[11.5px] uppercase tracking-wider text-muted mb-1">{label}</p>
      <p
        className={[
          "text-[20px] font-semibold tnum inline-flex items-center gap-1",
          positive ? "text-emerald" : "text-danger",
        ].join(" ")}
      >
        {positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
        {positive ? "+" : "−"}{formatSGD(Math.abs(amount))}
      </p>
    </div>
  );
}

interface ChildCardProps {
  name: string;
  holding: ChildHolding | undefined;
  snaps: Array<{ snapshot_date: string; value_sgd: number }>;
  voo: number;
  fx: number;
  pendingCount: number;
}

function ChildCard({ name, holding, snaps, voo, fx, pendingCount }: ChildCardProps) {
  const shares = holding?.shares_held ?? 0;
  const costSgd = holding?.cost_basis_sgd ?? 0;
  const valueUsd = shares * voo;
  const valueSgd = valueUsd * fx;
  const gainSgd = valueSgd - costSgd;
  return (
    <article className="bg-white border border-line rounded-lg p-5 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-[18px] font-semibold text-ink">{name}</h2>
        {pendingCount > 0 && (
          <span className="inline-flex items-center px-2 h-6 rounded-full text-[12px] bg-amber-soft text-amber">
            {pendingCount} pending
          </span>
        )}
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Shares" value={formatShares(shares)} />
        <Stat label="Value (SGD)" value={formatSGD(valueSgd)} sub={formatUSD(valueUsd)} />
        <Stat label="Cost (SGD)" value={formatSGD(costSgd)} />
        <GainStat label="Gain" amount={gainSgd} />
      </div>
      {snaps.length > 1 && <Sparkline points={snaps} />}
    </article>
  );
}

function Sparkline({ points }: { points: Array<{ snapshot_date: string; value_sgd: number }> }) {
  const values = points.map((p) => p.value_sgd);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const w = 100;
  const h = 30;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p.value_sgd - min) / span) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8 text-emerald" aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function timeSince(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
