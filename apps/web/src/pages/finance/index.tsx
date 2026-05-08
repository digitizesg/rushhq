import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Calendar as CalendarIcon,
  History,
  Settings as SettingsIcon,
} from "lucide-react";
import { useFinanceData } from "@/finance/use-finance-data";
import {
  firstOfMonth,
  formatMonthLabel,
  formatSGD,
  shiftMonth,
} from "@/lib/finance";
import {
  daysUntilRateEnd,
  isRefiSoon,
  ltvFor,
} from "@/lib/properties";
import { LoadingScreen } from "@/components/loading-screen";

export default function FinanceOverviewPage() {
  const data = useFinanceData();
  const today = useMemo(() => new Date(), []);
  const thisMonth = useMemo(() => firstOfMonth(today), [today]);

  if (data.loading) return <LoadingScreen />;

  const totals = data.totalsOverTime;
  const latest = totals[totals.length - 1];
  const prevMonthRow = totals[totals.length - 2];
  const yearAgoRow = totals.find((t) => t.snapshot_month === shiftMonth(latest?.snapshot_month ?? thisMonth, -12));

  const total = latest?.total_sgd ?? 0;
  const monthChange = latest && prevMonthRow ? total - prevMonthRow.total_sgd : 0;
  const monthPct = latest && prevMonthRow && prevMonthRow.total_sgd > 0
    ? ((total - prevMonthRow.total_sgd) / prevMonthRow.total_sgd) * 100
    : 0;
  const yearChange = latest && yearAgoRow ? total - yearAgoRow.total_sgd : 0;

  // Single short label regardless of whether the month exists yet —
  // the form itself handles the create-vs-edit distinction.
  const ctaLabel = "Add update";

  // Latest-month breakdown with per-account delta vs the previous
  // snapshot month. We compare to the immediately-previous month for
  // each account independently — if an account was added more recently,
  // its delta is null and we render "new this month" instead.
  const latestMonth = latest?.snapshot_month ?? thisMonth;
  const previousMonth = prevMonthRow?.snapshot_month ?? null;
  const latestSnaps = data.snapshots.filter((s) => s.snapshot_month === latestMonth);
  const previousSnaps = previousMonth
    ? data.snapshots.filter((s) => s.snapshot_month === previousMonth)
    : [];

  const breakdown = latestSnaps
    .map((s) => {
      const acc = data.accounts.find((a) => a.id === s.account_id);
      const prev = previousSnaps.find((p) => p.account_id === s.account_id);
      const previous = prev?.balance_sgd ?? null;
      const delta = previous != null ? s.balance_sgd - previous : null;
      return {
        name: acc?.name ?? "?",
        entity: acc?.entity ?? "",
        balance: s.balance_sgd,
        previous,
        delta,
      };
    })
    .sort((a, b) => b.balance - a.balance);
  const breakdownMax = Math.max(1, ...breakdown.map((b) => b.balance));

  // Chart series
  const series = totals.slice(-24);

  // Property snapshot for the same month as the latest accounts row.
  const latestPropertySnaps = data.propertySnapshots.filter(
    (s) => s.snapshot_month === latestMonth,
  );
  const previousPropertySnaps = previousMonth
    ? data.propertySnapshots.filter((s) => s.snapshot_month === previousMonth)
    : [];
  const activeProps = data.properties.filter((p) => p.active);
  const propertyEquityNow = latestPropertySnaps.reduce(
    (s, snap) => s + ((snap.market_value_sgd ?? 0) - snap.amount_outstanding_sgd),
    0,
  );
  const propertyEquityPrev = previousPropertySnaps.reduce(
    (s, snap) => s + ((snap.market_value_sgd ?? 0) - snap.amount_outstanding_sgd),
    0,
  );
  const propertyEquityDelta =
    previousPropertySnaps.length > 0 ? propertyEquityNow - propertyEquityPrev : null;
  const refiAlerts = activeProps.filter((p) => isRefiSoon(p.rate_end_date));

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[14px] uppercase tracking-wider text-muted mb-1">Finance</p>
          <h1 className="text-[30px] font-medium text-ink">Total assets</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/finance/history" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line text-[15.5px] hover:bg-soft">
            <History size={14} /> History
          </Link>
          <Link to="/finance/properties" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line text-[15.5px] hover:bg-soft">
            <Building2 size={14} /> Properties
          </Link>
          <Link to="/finance/accounts" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line text-[15.5px] hover:bg-soft">
            <SettingsIcon size={14} /> Accounts
          </Link>
          <Link
            to={`/finance/update/${thisMonth.slice(0, 7)}`}
            className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-primary text-white text-[15.5px] font-medium hover:bg-primary-strong"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>

      {data.error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[15px] px-4 py-3">
          {data.error}
        </div>
      )}

      {/* Hero */}
      <div className="bg-white border border-line rounded-lg p-6 sm:p-8">
        {totals.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[17px] text-ink mb-1">No data yet.</p>
            <p className="text-[15.5px] text-muted">
              Use the button above to enter this month's balances.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-6 items-center">
            <div className="sm:col-span-2">
              <p className="text-[14.5px] uppercase tracking-wider text-muted">
                {formatMonthLabel(latest!.snapshot_month)}
              </p>
              <p className="text-[clamp(34px,5vw,52px)] font-semibold text-ink tnum leading-tight mt-1">
                {formatSGD(total)}
              </p>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-1 gap-4">
              <div>
                <dt className="text-[13.5px] uppercase tracking-wider text-muted mb-1">vs last month</dt>
                <dd className={[
                  "text-[18px] font-semibold tnum inline-flex items-center gap-1",
                  monthChange >= 0 ? "text-emerald" : "text-danger",
                ].join(" ")}>
                  {monthChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  {monthChange >= 0 ? "+" : "−"}{formatSGD(Math.abs(monthChange))}
                  <span className="text-[14.5px] text-muted ml-1 font-normal">
                    ({monthPct >= 0 ? "+" : ""}{monthPct.toFixed(1)}%)
                  </span>
                </dd>
              </div>
              {yearAgoRow && (
                <div>
                  <dt className="text-[13.5px] uppercase tracking-wider text-muted mb-1">vs 12 months ago</dt>
                  <dd className={[
                    "text-[18px] font-semibold tnum inline-flex items-center gap-1",
                    yearChange >= 0 ? "text-emerald" : "text-danger",
                  ].join(" ")}>
                    {yearChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {yearChange >= 0 ? "+" : "−"}{formatSGD(Math.abs(yearChange))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>

      {/* Chart */}
      {series.length > 0 && <Chart points={series} />}

      {/* Refi banner */}
      {refiAlerts.length > 0 && (
        <div className="rounded-lg border border-amber/30 bg-amber-soft/40 px-5 py-4 flex items-start gap-3">
          <CalendarIcon size={18} className="text-amber mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-[16px] font-semibold text-ink">Refinance window opening</p>
            <ul className="text-[14.5px] text-muted">
              {refiAlerts.map((p) => {
                const days = daysUntilRateEnd(p.rate_end_date);
                return (
                  <li key={p.id} className="tnum">
                    {p.name}: rate ends {p.rate_end_date}
                    {days != null && (
                      <span className="text-muted">
                        {" "}({days < 0 ? `${-days}d ago` : days === 0 ? "today" : `in ${days}d`})
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Properties */}
      {activeProps.length > 0 && (
        <div className="bg-white border border-line rounded-lg p-5 sm:p-6 space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-[16px] font-semibold text-ink inline-flex items-center gap-2">
              <Building2 size={16} className="text-muted" /> Properties
            </p>
            {latestPropertySnaps.length > 0 && (
              <p className="text-[14px] text-muted">
                Total equity{" "}
                <span className="text-ink tnum font-medium">{formatSGD(propertyEquityNow)}</span>
                {propertyEquityDelta != null && propertyEquityDelta !== 0 && (
                  <span className={[
                    "ml-2 tnum",
                    propertyEquityDelta > 0 ? "text-emerald" : "text-danger",
                  ].join(" ")}>
                    {propertyEquityDelta > 0 ? "↑ +" : "↓ −"}{formatSGD(Math.abs(propertyEquityDelta))}
                  </span>
                )}
              </p>
            )}
          </div>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeProps.map((p) => {
              const snap = latestPropertySnaps.find((s) => s.property_id === p.id);
              const ltv = ltvFor(snap);
              const equity =
                snap && snap.market_value_sgd
                  ? snap.market_value_sgd - snap.amount_outstanding_sgd
                  : 0;
              return (
                <li key={p.id} className="border border-line rounded-md p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[16px] font-semibold text-ink">{p.name}</p>
                    <span
                      className={[
                        "inline-flex items-center px-2 h-6 rounded-full text-[13px] capitalize",
                        p.category === "personal"
                          ? "bg-primary-soft text-primary"
                          : "bg-soft text-muted",
                      ].join(" ")}
                    >
                      {p.category}
                    </span>
                  </div>
                  <dl className="space-y-1 text-[14.5px] tnum">
                    <Row label="Outstanding">
                      {snap ? formatSGD(snap.amount_outstanding_sgd) : "—"}
                    </Row>
                    <Row label="Market value">
                      {snap?.market_value_sgd != null ? formatSGD(snap.market_value_sgd) : "—"}
                    </Row>
                    <Row label="Equity">
                      <span className="text-ink font-semibold">
                        {snap?.market_value_sgd != null ? formatSGD(equity) : "—"}
                      </span>
                    </Row>
                    {ltv != null && (
                      <Row label="LTV">{ltv.toFixed(1)}%</Row>
                    )}
                  </dl>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Breakdown */}
      {breakdown.length > 0 && (
        <div className="bg-white border border-line rounded-lg p-5 sm:p-6">
          <p className="text-[16px] font-semibold text-ink mb-4">
            Breakdown · {formatMonthLabel(latest!.snapshot_month)}
          </p>
          <ul className="space-y-3">
            {breakdown.map((b) => (
              <li key={b.name} className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                <p className="text-[16px] text-ink">{b.name}</p>
                <div className="text-right">
                  <p className="text-[16px] text-ink tnum">{formatSGD(b.balance)}</p>
                  <DeltaBadge delta={b.delta} />
                </div>
                <div className="col-span-2 h-2 rounded-full bg-soft overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${(Math.max(0, b.balance) / breakdownMax) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted text-[13.5px] uppercase tracking-wider">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) {
    return (
      <p className="text-[13.5px] text-muted tnum mt-0.5">new this month</p>
    );
  }
  if (delta === 0) {
    return (
      <p className="text-[13.5px] text-muted tnum mt-0.5">no change</p>
    );
  }
  const positive = delta > 0;
  return (
    <p
      className={[
        "text-[13.5px] tnum mt-0.5",
        positive ? "text-emerald" : "text-danger",
      ].join(" ")}
    >
      {positive ? "↑" : "↓"} {positive ? "+" : "−"}{formatSGD(Math.abs(delta))}
    </p>
  );
}

function Chart({ points }: { points: Array<{ snapshot_month: string; total_sgd: number }> }) {
  const values = points.map((p) => p.total_sgd);
  const dataMax = Math.max(...values, 0);
  const dataMin = Math.min(...values, 0);

  // Pad y-axis 5% above the max + 5% below the min (or to zero if all
  // values are positive), so the line never sits flush with the edges.
  const pad = (dataMax - dataMin) * 0.08;
  const yMax = dataMax + Math.max(pad, dataMax * 0.05, 1);
  const yMin = Math.max(0, dataMin - pad);
  const ySpan = Math.max(yMax - yMin, 1);

  // Pick four nice gridline values: yMin, ~33%, ~66%, yMax.
  const gridValues = [yMax, yMax - ySpan / 3, yMin + ySpan / 3, yMin];

  // SVG geometry — left gutter for y labels, bottom gutter for months.
  const W = 600;
  const H = 220;
  const left = 60;
  const right = 16;
  const top = 16;
  const bottom = 30;
  const plotW = W - left - right;
  const plotH = H - top - bottom;

  const xFor = (i: number) =>
    points.length > 1
      ? left + (i / (points.length - 1)) * plotW
      : left + plotW / 2;
  const yFor = (v: number) => top + plotH - ((v - yMin) / ySpan) * plotH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.total_sgd).toFixed(2)}`)
    .join(" ");
  const areaPath = points.length > 1
    ? `${linePath} L ${xFor(points.length - 1).toFixed(2)} ${(top + plotH).toFixed(2)} L ${xFor(0).toFixed(2)} ${(top + plotH).toFixed(2)} Z`
    : "";

  // X-axis labels — first, middle, last (or just first when there's one).
  const xLabelIndices: number[] =
    points.length === 1 ? [0]
      : points.length <= 3 ? points.map((_, i) => i)
        : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  const formatTick = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return Math.round(n).toString();
  };

  return (
    <div className="bg-white border border-line rounded-lg p-5">
      <p className="text-[14.5px] uppercase tracking-wider text-muted mb-3">Total assets over time</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block text-emerald" style={{ aspectRatio: `${W} / ${H}` }}>
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

        {/* Area fill */}
        {areaPath && (
          <path d={areaPath} fill="currentColor" opacity="0.12" />
        )}

        {/* Line */}
        {points.length > 1 && (
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data point dots */}
        {points.map((p, i) => (
          <g key={p.snapshot_month}>
            <circle
              cx={xFor(i)}
              cy={yFor(p.total_sgd)}
              r={4}
              fill="white"
              stroke="currentColor"
              strokeWidth={2}
            />
          </g>
        ))}

        {/* X-axis labels */}
        {xLabelIndices.map((i) => {
          const p = points[i];
          if (!p) return null;
          return (
            <text
              key={p.snapshot_month}
              x={xFor(i)}
              y={H - 10}
              textAnchor="middle"
              fontSize="11"
              fill="#94a3b8"
            >
              {formatMonthLabel(p.snapshot_month)}
            </text>
          );
        })}
      </svg>
      {points.length === 1 && (
        <p className="text-[14px] text-muted text-center mt-1">
          One month so far. The chart fills out as you save subsequent months.
        </p>
      )}
    </div>
  );
}
