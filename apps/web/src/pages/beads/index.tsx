import { Link } from "react-router-dom";
import { useMemo } from "react";
import { CalendarDays, ListChecks, Wallet } from "lucide-react";
import { useBeadData } from "@/beads/use-bead-data";
import {
  firstOfMonth,
  formatPeriodLabel,
  formatSGD,
  type BeadPeriodStatus,
  type BeadPeriodTotal,
} from "@/lib/beads";
import type { FamilyMember } from "@/lib/types";
import { LoadingScreen } from "@/components/loading-screen";

export default function BeadsIndexPage() {
  const data = useBeadData();
  const today = useMemo(() => new Date(), []);
  const thisMonthStart = firstOfMonth(today);

  if (data.loading) return <LoadingScreen />;

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[14px] uppercase tracking-wider text-muted mb-1">Beads</p>
          <h1 className="text-[30px] font-medium text-ink">
            Riley & Robin
          </h1>
        </div>
        <p className="text-[15px] text-muted tnum">
          {formatPeriodLabel(thisMonthStart)}
        </p>
      </div>

      {data.error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[15px] px-4 py-3">
          {data.error}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {data.children.map((child) => (
          <ChildCard
            key={child.id}
            child={child}
            data={data}
            thisMonthStart={thisMonthStart}
          />
        ))}
      </div>
    </section>
  );
}

interface ChildCardProps {
  child: FamilyMember;
  data: ReturnType<typeof useBeadData>;
  thisMonthStart: string;
}

function ChildCard({ child, data, thisMonthStart }: ChildCardProps) {
  const activeChart = data.charts.find(
    (c) => c.member_id === child.id && c.effective_until === null,
  );
  const itemCount = activeChart
    ? data.items.filter((i) => i.chart_id === activeChart.id).length
    : 0;

  const childTotals = data.totals
    .filter((t) => t.member_id === child.id)
    .sort((a, b) => (a.period_start < b.period_start ? -1 : 1));
  const thisMonth = childTotals.find((t) => t.period_start === thisMonthStart);
  const lastThree = childTotals.slice(-3);
  const lifetime = childTotals.reduce((s, t) => s + t.total_sgd, 0);

  return (
    <article className="bg-white border border-line rounded-lg overflow-hidden">
      <header className="flex items-center justify-between px-5 py-4 border-b border-line">
        <h2 className="text-[20px] font-semibold text-ink">{child.short_name}</h2>
        {thisMonth && <StatusPill status={thisMonth.status} />}
      </header>

      <div className="grid gap-4 px-5 py-4">
        <Stat
          icon={<ListChecks size={16} />}
          label={`Chart for ${formatPeriodLabel(thisMonthStart)}`}
          value={
            activeChart
              ? `${itemCount} ${itemCount === 1 ? "task" : "tasks"}`
              : "No active chart"
          }
        />
        <Stat
          icon={<CalendarDays size={16} />}
          label="This month so far"
          value={thisMonth ? formatSGD(thisMonth.total_sgd) : "Not started"}
        />
        <Stat
          icon={<Wallet size={16} />}
          label="Lifetime earned"
          value={formatSGD(lifetime)}
        />

        {lastThree.length > 1 && (
          <Sparkline points={lastThree} />
        )}

        <div className="grid grid-cols-2 gap-2 pt-2">
          {activeChart && (
            <Link
              to={`/beads/charts/${child.id}`}
              className="inline-flex items-center justify-center h-9 rounded-md border border-line text-[15.5px] text-ink hover:bg-soft transition-colors"
            >
              View chart
            </Link>
          )}
          <Link
            to={`/beads/count/${child.id}`}
            className="inline-flex items-center justify-center h-9 rounded-md bg-primary text-white text-[15.5px] font-medium hover:bg-primary-strong transition-colors"
          >
            {thisMonth?.status === "open" || !thisMonth ? "Count beads" : "View count"}
          </Link>
        </div>
      </div>
    </article>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="size-8 grid place-items-center rounded-md bg-soft text-muted">
        {icon}
      </span>
      <div>
        <p className="text-[14px] text-muted">{label}</p>
        <p className="text-[17px] text-ink font-medium tnum">{value}</p>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: BeadPeriodStatus }) {
  const styles: Record<BeadPeriodStatus, { bg: string; text: string; label: string }> = {
    open:     { bg: "bg-soft",         text: "text-muted",   label: "Counting open" },
    counted:  { bg: "bg-primary-soft", text: "text-primary", label: "Locked" },
    invested: { bg: "bg-emerald-soft", text: "text-emerald", label: "Invested" },
  };
  const s = styles[status];
  return (
    <span className={`inline-flex items-center px-2.5 h-6 rounded-full text-[14px] ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function Sparkline({ points }: { points: BeadPeriodTotal[] }) {
  const max = Math.max(1, ...points.map((p) => p.total_sgd));
  return (
    <div className="grid grid-cols-3 gap-2 pt-1">
      {points.map((p) => {
        const h = Math.max(4, (p.total_sgd / max) * 40);
        return (
          <div key={p.period_id} className="flex flex-col items-center gap-1">
            <div className="w-full h-10 flex items-end">
              <span
                className="w-full bg-primary-soft rounded-sm"
                style={{ height: `${h}px` }}
              />
            </div>
            <p className="text-[12.5px] uppercase tracking-wider text-muted tnum">
              {formatPeriodLabel(p.period_start).slice(0, 3)}
            </p>
            <p className="text-[14px] text-ink tnum">
              {formatSGD(p.total_sgd)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
