import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, History, Settings as SettingsIcon } from "lucide-react";
import { useFinanceData } from "@/finance/use-finance-data";
import {
  firstOfMonth,
  formatMonthLabel,
  formatSGD,
  shiftMonth,
} from "@/lib/finance";
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

  // CTA label
  const currentMonthSnapshots = data.snapshots.filter((s) => s.snapshot_month === thisMonth);
  const allActive = data.accounts.filter((a) => a.active);
  const allFilled =
    currentMonthSnapshots.length === allActive.length &&
    currentMonthSnapshots.every((s) => s.balance_sgd > 0);
  const ctaLabel =
    currentMonthSnapshots.length === 0
      ? `Start ${formatMonthLabel(thisMonth)} update`
      : allFilled
        ? `Edit ${formatMonthLabel(thisMonth)}`
        : `Continue ${formatMonthLabel(thisMonth)} update`;

  // Latest-month breakdown
  const latestSnaps = data.snapshots.filter((s) => s.snapshot_month === (latest?.snapshot_month ?? thisMonth));
  const breakdown = latestSnaps
    .map((s) => {
      const acc = data.accounts.find((a) => a.id === s.account_id);
      return { name: acc?.name ?? "?", entity: acc?.entity ?? "", balance: s.balance_sgd };
    })
    .sort((a, b) => b.balance - a.balance);
  const breakdownMax = Math.max(1, ...breakdown.map((b) => b.balance));

  // Chart series
  const series = totals.slice(-24);

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted mb-1">Finance</p>
          <h1 className="text-[28px] font-medium text-ink">Total assets</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/finance/history" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line text-[13.5px] hover:bg-soft">
            <History size={14} /> History
          </Link>
          <Link to="/finance/accounts" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line text-[13.5px] hover:bg-soft">
            <SettingsIcon size={14} /> Accounts
          </Link>
          <Link
            to={`/finance/update/${thisMonth.slice(0, 7)}`}
            className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-primary text-white text-[13.5px] font-medium hover:bg-primary-strong"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>

      {data.error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[13px] px-4 py-3">
          {data.error}
        </div>
      )}

      {/* Hero */}
      <div className="bg-white border border-line rounded-lg p-6 sm:p-8">
        {totals.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[15px] text-ink mb-1">No data yet.</p>
            <p className="text-[13.5px] text-muted">
              Use the button above to enter this month's balances.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-6 items-center">
            <div className="sm:col-span-2">
              <p className="text-[12.5px] uppercase tracking-wider text-muted">
                {formatMonthLabel(latest!.snapshot_month)}
              </p>
              <p className="text-[clamp(34px,5vw,52px)] font-semibold text-ink tnum leading-tight mt-1">
                {formatSGD(total)}
              </p>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-1 gap-4">
              <div>
                <dt className="text-[11.5px] uppercase tracking-wider text-muted mb-1">vs last month</dt>
                <dd className={[
                  "text-[16px] font-semibold tnum inline-flex items-center gap-1",
                  monthChange >= 0 ? "text-emerald" : "text-danger",
                ].join(" ")}>
                  {monthChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  {monthChange >= 0 ? "+" : "−"}{formatSGD(Math.abs(monthChange))}
                  <span className="text-[12.5px] text-muted ml-1 font-normal">
                    ({monthPct >= 0 ? "+" : ""}{monthPct.toFixed(1)}%)
                  </span>
                </dd>
              </div>
              {yearAgoRow && (
                <div>
                  <dt className="text-[11.5px] uppercase tracking-wider text-muted mb-1">vs 12 months ago</dt>
                  <dd className={[
                    "text-[16px] font-semibold tnum inline-flex items-center gap-1",
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
      {series.length > 1 && <Chart points={series} />}

      {/* Breakdown */}
      {breakdown.length > 0 && (
        <div className="bg-white border border-line rounded-lg p-5 sm:p-6">
          <p className="text-[14px] font-semibold text-ink mb-4">
            Breakdown · {formatMonthLabel(latest!.snapshot_month)}
          </p>
          <ul className="space-y-3">
            {breakdown.map((b) => (
              <li key={b.name} className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                <div>
                  <p className="text-[14px] text-ink">{b.name}</p>
                  <p className="text-[12px] text-muted">{b.entity}</p>
                </div>
                <p className="text-[14px] text-ink tnum">{formatSGD(b.balance)}</p>
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

function Chart({ points }: { points: Array<{ snapshot_month: string; total_sgd: number }> }) {
  const values = points.map((p) => p.total_sgd);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const w = 100;
  const h = 36;
  const step = points.length > 1 ? w / (points.length - 1) : w;

  // Smooth-ish path with monotone-cubic feel via a Catmull-Rom approximation.
  const pathPoints = points.map((p, i) => {
    const x = i * step;
    const y = h - ((p.total_sgd - min) / span) * h;
    return [x, y] as [number, number];
  });
  const linePath = pathPoints
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${(points.length - 1) * step} ${h} L 0 ${h} Z`;

  return (
    <div className="bg-white border border-line rounded-lg p-5">
      <p className="text-[12.5px] uppercase tracking-wider text-muted mb-2">Total assets over time</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32 sm:h-44 text-emerald" preserveAspectRatio="none">
        <path d={areaPath} fill="currentColor" opacity="0.15" />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between mt-2 text-[11px] text-muted tnum">
        <span>{points[0] ? formatMonthLabel(points[0].snapshot_month) : ""}</span>
        <span>{points[points.length - 1] ? formatMonthLabel(points[points.length - 1].snapshot_month) : ""}</span>
      </div>
    </div>
  );
}
