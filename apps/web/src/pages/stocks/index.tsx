import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Coins,
  History,
  Plus,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useStocksData, priceOf, lastUpdatedOf } from "@/stocks/use-stocks-data";
import {
  formatSGD,
  formatShares,
  formatUSD,
  type ChildHolding,
  type PortfolioSnapshot,
} from "@/lib/stocks";
import { LoadingScreen } from "@/components/loading-screen";
import { supabase } from "@/lib/supabase";
import { colourFor } from "@/lib/colours";

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
  const gainPct = totalCostSgd > 0 ? (gainSgd / totalCostSgd) * 100 : 0;

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
        <GainStat label="Unrealised gain" amount={gainSgd} pct={gainPct} />
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

      {/* Portfolio chart */}
      <PortfolioChart
        childList={data.children}
        snapshots={data.snapshots}
        holdings={data.holdings}
        voo={voo}
        fx={fx}
      />

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
              memberId={c.id}
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

      {/* Actions */}
      <section className="bg-white border border-line rounded-lg p-5 sm:p-6 space-y-4">
        <p className="text-[12.5px] uppercase tracking-wider text-muted">Quick actions</p>
        <div className="flex flex-wrap gap-2.5">
          <Link
            to="/stocks/buy"
            className="inline-flex items-center gap-2 h-11 px-4 rounded-md bg-primary text-white text-[14px] font-medium hover:bg-primary-strong transition-colors shadow-sm"
          >
            <Plus size={16} /> Record purchase
          </Link>
          <ActionButton to="/stocks/dividend" icon={<Coins size={16} />}>
            Record dividend
          </ActionButton>
          <ActionButton to="/stocks/withdrawal" icon={<Banknote size={16} />}>
            Record withdrawal
          </ActionButton>
          <ActionButton to="/stocks/deposits" icon={<Wallet size={16} />}>
            Manage deposits
          </ActionButton>
          <ActionButton to="/stocks/transactions" icon={<History size={16} />}>
            All transactions
          </ActionButton>
        </div>
      </section>
    </section>
  );
}

function ActionButton({
  to,
  icon,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 h-11 px-4 rounded-md bg-white border border-line text-ink text-[14px] font-medium hover:bg-soft hover:border-ink/15 transition-colors"
    >
      <span className="text-muted">{icon}</span> {children}
    </Link>
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

function GainStat({ label, amount, pct }: { label: string; amount: number; pct?: number }) {
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
      {pct !== undefined && pct !== 0 && (
        <p className={["text-[12px] mt-0.5 tnum", positive ? "text-emerald" : "text-danger"].join(" ")}>
          {positive ? "+" : ""}{pct.toFixed(2)}%
        </p>
      )}
    </div>
  );
}

interface ChildCardProps {
  memberId: string;
  name: string;
  holding: ChildHolding | undefined;
  snaps: Array<{ snapshot_date: string; value_sgd: number }>;
  voo: number;
  fx: number;
  pendingCount: number;
}

function ChildCard({ memberId, name, holding, snaps, voo, fx, pendingCount }: ChildCardProps) {
  const colour = colourFor(memberId);
  const shares = holding?.shares_held ?? 0;
  const costSgd = holding?.cost_basis_sgd ?? 0;
  const valueUsd = shares * voo;
  const valueSgd = valueUsd * fx;
  const gainSgd = valueSgd - costSgd;
  const gainPct = costSgd > 0 ? (gainSgd / costSgd) * 100 : 0;

  // Append a synthetic "now" point so even one snapshot still gives a line.
  const todayPoint = { snapshot_date: "today", value_sgd: valueSgd };
  const points = [...snaps, todayPoint];

  return (
    <article className="bg-white border border-line rounded-lg overflow-hidden">
      <header
        className="flex items-center justify-between px-5 py-3 border-b border-line"
        style={{ backgroundColor: colour.soft }}
      >
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: colour.accent }} />
          <h2 className="text-[16px] font-semibold" style={{ color: colour.text }}>
            {name}
          </h2>
        </div>
        {pendingCount > 0 && (
          <span className="inline-flex items-center px-2 h-6 rounded-full text-[12px] bg-amber-soft text-amber">
            {pendingCount} pending
          </span>
        )}
      </header>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Shares" value={formatShares(shares)} />
          <Stat label="Value (SGD)" value={formatSGD(valueSgd)} sub={formatUSD(valueUsd)} />
          <Stat label="Cost (SGD)" value={formatSGD(costSgd)} />
          <GainStat label="Gain" amount={gainSgd} pct={gainPct} />
        </div>
        {points.length > 1 && (
          <Sparkline points={points} accent={colour.accent} soft={colour.soft} />
        )}
      </div>
    </article>
  );
}

function Sparkline({
  points,
  accent,
  soft,
}: {
  points: Array<{ snapshot_date: string; value_sgd: number }>;
  accent: string;
  soft: string;
}) {
  const values = points.map((p) => p.value_sgd);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const w = 100;
  const h = 32;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const linePath = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p.value_sgd - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const areaPath =
    points.length > 1
      ? `${linePath} L ${(w).toFixed(2)} ${h} L 0 ${h} Z`
      : "";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9" aria-hidden preserveAspectRatio="none">
      {areaPath && <path d={areaPath} fill={soft} />}
      <path
        d={linePath}
        fill="none"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface PortfolioChartProps {
  childList: Array<{ id: string; short_name: string }>;
  snapshots: PortfolioSnapshot[];
  holdings: ChildHolding[];
  voo: number;
  fx: number;
}

function PortfolioChart({ childList, snapshots, holdings, voo, fx }: PortfolioChartProps) {
  // Build a sorted unique list of dates from snapshots, plus "today".
  const dateSet = new Set(snapshots.map((s) => s.snapshot_date));
  const sortedDates = Array.from(dateSet).sort();
  const todayKey = "today";
  const allDates: string[] = [...sortedDates, todayKey];

  // For each date × kid, look up value_sgd and cost_basis_sgd.
  type Row = { date: string; perKid: Record<string, number>; cost: number; total: number };
  const rows: Row[] = useMemo(() => {
    return allDates.map((d) => {
      const perKid: Record<string, number> = {};
      let cost = 0;
      let total = 0;
      for (const c of childList) {
        if (d === todayKey) {
          const h = holdings.find((x) => x.member_id === c.id);
          const v = (h?.shares_held ?? 0) * voo * fx;
          perKid[c.id] = v;
          total += v;
          cost += h?.cost_basis_sgd ?? 0;
        } else {
          const snap = snapshots.find((s) => s.snapshot_date === d && s.member_id === c.id);
          const v = snap?.value_sgd ?? 0;
          perKid[c.id] = v;
          total += v;
          cost += snap?.cost_basis_sgd ?? 0;
        }
      }
      return { date: d, perKid, cost, total };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDates.join("|"), childList, holdings, snapshots, voo, fx]);

  // If we have no real data at all, hide the chart.
  const hasAnyValue = rows.some((r) => r.total > 0 || r.cost > 0);
  if (!hasAnyValue) return null;

  // Y-axis: 0 to max(top of stack, cost basis), padded.
  const dataMax = Math.max(...rows.map((r) => Math.max(r.total, r.cost)), 1);
  const yMax = dataMax * 1.1;
  const yMin = 0;
  const ySpan = yMax - yMin;

  const W = 600;
  const H = 240;
  const left = 60;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const plotW = W - left - right;
  const plotH = H - top - bottom;

  const xFor = (i: number) =>
    rows.length > 1 ? left + (i / (rows.length - 1)) * plotW : left + plotW / 2;
  const yFor = (v: number) => top + plotH - ((v - yMin) / ySpan) * plotH;

  const formatTick = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return Math.round(n).toString();
  };

  const gridValues = [yMax, yMax * 0.66, yMax * 0.33, 0];

  // Build cumulative stacks per kid, in stable child order.
  function stackFor(rowIdx: number) {
    let cum = 0;
    const layers: Array<{ id: string; from: number; to: number }> = [];
    for (const c of childList) {
      const v = rows[rowIdx].perKid[c.id] ?? 0;
      layers.push({ id: c.id, from: cum, to: cum + v });
      cum += v;
    }
    return layers;
  }

  // For each kid, build an area path: top edge across all rows, then
  // bottom edge back, closed.
  function areaPathFor(memberId: string) {
    if (rows.length < 2) return "";
    const tops = rows.map((_, i) => {
      const layers = stackFor(i);
      const layer = layers.find((l) => l.id === memberId);
      return { x: xFor(i), y: yFor(layer?.to ?? 0) };
    });
    const bottoms = rows.map((_, i) => {
      const layers = stackFor(i);
      const layer = layers.find((l) => l.id === memberId);
      return { x: xFor(i), y: yFor(layer?.from ?? 0) };
    });
    const topEdge = tops.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
    const bottomEdge = bottoms
      .slice()
      .reverse()
      .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
    return `${topEdge} ${bottomEdge} Z`;
  }

  // Cost basis line.
  const costPath = rows
    .map((r, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(r.cost).toFixed(2)}`)
    .join(" ");

  // X-axis labels — just first, last (and middle if many).
  const xLabelIndices: number[] =
    rows.length === 1 ? [0]
      : rows.length <= 3 ? rows.map((_, i) => i)
        : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];

  const formatDateLabel = (d: string) => {
    if (d === todayKey) return "Today";
    // YYYY-MM-DD → "MMM YY"
    const dt = new Date(d);
    return dt.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  };

  // Final-row totals for the side panel.
  const last = rows[rows.length - 1];
  const lastGain = last.total - last.cost;
  const lastGainPositive = lastGain >= 0;

  return (
    <div className="bg-white border border-line rounded-lg p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[12.5px] uppercase tracking-wider text-muted">Portfolio over time</p>
        <p className="text-[12.5px] text-muted">
          Today: <span className="text-ink tnum">{formatSGD(last.total)}</span>{" "}
          ·{" "}
          <span className={lastGainPositive ? "text-emerald" : "text-danger"}>
            {lastGainPositive ? "+" : "−"}{formatSGD(Math.abs(lastGain))}
          </span>{" "}
          vs cost
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" style={{ aspectRatio: `${W} / ${H}` }}>
        {/* Grid lines + y labels */}
        {gridValues.map((v, i) => {
          const y = yFor(v);
          return (
            <g key={i}>
              <line
                x1={left}
                x2={W - right}
                y1={y}
                y2={y}
                stroke="#e6e8ee"
                strokeWidth={1}
                strokeDasharray={i === gridValues.length - 1 ? "" : "3 3"}
              />
              <text
                x={left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#94a3b8"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                S${formatTick(v)}
              </text>
            </g>
          );
        })}

        {/* Stacked area per kid */}
        {rows.length > 1 &&
          childList.map((c) => {
            const colour = colourFor(c.id);
            return (
              <path
                key={c.id}
                d={areaPathFor(c.id)}
                fill={colour.accent}
                opacity="0.65"
              />
            );
          })}

        {/* Cost basis dashed line */}
        {rows.length > 1 && (
          <path
            d={costPath}
            fill="none"
            stroke="#0f172a"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            strokeLinecap="round"
          />
        )}

        {/* Dots on the cost basis line */}
        {rows.map((r, i) => (
          <circle
            key={`cost-${i}`}
            cx={xFor(i)}
            cy={yFor(r.cost)}
            r={2.5}
            fill="white"
            stroke="#0f172a"
            strokeWidth={1.2}
          />
        ))}

        {/* If only one data point, draw per-kid dots so it isn't blank */}
        {rows.length === 1 &&
          childList.map((c) => {
            const colour = colourFor(c.id);
            const v = rows[0].perKid[c.id] ?? 0;
            if (v <= 0) return null;
            return (
              <circle
                key={`only-${c.id}`}
                cx={xFor(0)}
                cy={yFor(v)}
                r={5}
                fill={colour.accent}
              />
            );
          })}

        {/* X-axis labels */}
        {xLabelIndices.map((i) => {
          const r = rows[i];
          if (!r) return null;
          return (
            <text
              key={r.date}
              x={xFor(i)}
              y={H - 10}
              textAnchor="middle"
              fontSize="11"
              fill="#94a3b8"
            >
              {formatDateLabel(r.date)}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
        {childList.map((c) => {
          const colour = colourFor(c.id);
          const v = last.perKid[c.id] ?? 0;
          return (
            <span key={c.id} className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ backgroundColor: colour.accent, opacity: 0.8 }} />
              <span className="text-ink">{c.short_name}</span>
              <span className="text-muted tnum">{formatSGD(v)}</span>
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5 ml-auto">
          <svg width="16" height="6" aria-hidden>
            <line x1="0" y1="3" x2="16" y2="3" stroke="#0f172a" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
          <span className="text-ink">Cost basis</span>
          <span className="text-muted tnum">{formatSGD(last.cost)}</span>
        </span>
      </div>

      {rows.length === 1 && (
        <p className="text-[12px] text-muted text-center">
          The chart fills out as monthly snapshots accumulate (1st of each month).
        </p>
      )}
    </div>
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
