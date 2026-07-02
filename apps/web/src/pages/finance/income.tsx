import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useIncomeData } from "@/finance/use-income-data";
import { formatMonthLabel, formatSGD } from "@/lib/finance";
import { GROUP_COLOURS, OTHER_GROUP, normSource, periodOf } from "@/lib/income";
import { LoadingScreen } from "@/components/loading-screen";

type Freq = "year" | "month";

export default function FinanceIncomePage() {
  const { loading, error, deposits } = useIncomeData();
  const [freq, setFreq] = useState<Freq>("year");

  const named = useMemo(
    () => deposits.filter((d) => d.income_group !== OTHER_GROUP),
    [deposits],
  );

  // Per-company totals (named groups only), biggest first, each with a colour.
  const companies = useMemo(() => {
    const map = new Map<
      string,
      { total: number; times: number; first: string; last: string }
    >();
    for (const d of named) {
      const cur = map.get(d.income_group);
      if (!cur) {
        map.set(d.income_group, {
          total: d.amount,
          times: 1,
          first: d.txn_date,
          last: d.txn_date,
        });
      } else {
        cur.total += d.amount;
        cur.times += 1;
        if (d.txn_date < cur.first) cur.first = d.txn_date;
        if (d.txn_date > cur.last) cur.last = d.txn_date;
      }
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)
      .map((c, i) => ({ ...c, colour: GROUP_COLOURS[i % GROUP_COLOURS.length] }));
  }, [named]);

  const colourFor = useMemo(() => {
    const m = new Map(companies.map((c) => [c.name, c.colour]));
    return (name: string) => m.get(name) ?? "#94a3b8";
  }, [companies]);

  const grandTotal = companies.reduce((s, c) => s + c.total, 0);

  // Period × company matrix, newest period first.
  const overTime = useMemo(() => {
    const periods = new Set<string>();
    const cell = new Map<string, number>(); // `${period}|${company}`
    for (const d of named) {
      const p = periodOf(d.txn_date, freq);
      periods.add(p);
      const key = `${p}|${d.income_group}`;
      cell.set(key, (cell.get(key) ?? 0) + d.amount);
    }
    const rows = Array.from(periods)
      .sort((a, b) => b.localeCompare(a))
      .map((p) => {
        const cells = companies.map((c) => cell.get(`${p}|${c.name}`) ?? 0);
        return { period: p, cells, total: cells.reduce((s, v) => s + v, 0) };
      });
    return rows;
  }, [named, companies, freq]);

  const largest = useMemo(
    () => deposits.filter((d) => d.is_large).sort((a, b) => b.amount - a.amount),
    [deposits],
  );

  // Top unclassified payers, so new sources can be spotted and named.
  const unclassified = useMemo(() => {
    const map = new Map<string, { label: string; total: number; times: number }>();
    for (const d of deposits) {
      if (d.income_group !== OTHER_GROUP) continue;
      const key = normSource(d.counterparty) || "(no payer name)";
      const cur = map.get(key);
      if (!cur) map.set(key, { label: key, total: d.amount, times: 1 });
      else {
        cur.total += d.amount;
        cur.times += 1;
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [deposits]);

  if (loading) return <LoadingScreen />;

  const periodLabel = (p: string) => (freq === "year" ? p : formatMonthLabel(`${p}-01`));

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/finance"
            className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink mb-1"
          >
            <ArrowLeft size={14} /> Finance
          </Link>
          <h1 className="text-[30px] font-medium text-ink">Income sources</h1>
          <p className="text-[15px] text-muted mt-1">
            Where money came in from, by company, across your statements.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[15px] px-4 py-3">
          {error}
        </div>
      )}

      {deposits.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-8 text-center">
          <p className="text-[17px] text-ink mb-1">No income data yet.</p>
          <p className="text-[15.5px] text-muted">
            Run the local export (bank-analysis/export_to_rushhq.py --push) to
            load your classified deposits.
          </p>
        </div>
      ) : (
        <>
          {/* By company */}
          <div className="bg-white border border-line rounded-lg p-5 sm:p-6 space-y-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-[18px] font-semibold text-ink">By company</p>
              <p className="text-[14px] text-muted">
                Total received{" "}
                <span className="text-ink tnum font-medium">{formatSGD(grandTotal)}</span>
              </p>
            </div>
            <ul className="space-y-3.5">
              {companies.map((c) => (
                <li key={c.name} className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                  <p className="text-[17px] font-medium text-ink inline-flex items-center gap-2">
                    <span
                      className="size-3 rounded-sm shrink-0"
                      style={{ backgroundColor: c.colour }}
                    />
                    {c.name}
                  </p>
                  <div className="text-right">
                    <p className="text-[17px] font-semibold text-ink tnum">{formatSGD(c.total)}</p>
                    <p className="text-[13px] text-muted tnum">
                      {c.times} deposit{c.times === 1 ? "" : "s"} · {c.first} to {c.last}
                    </p>
                  </div>
                  <div className="col-span-2 h-2 rounded-full bg-soft overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${grandTotal > 0 ? (c.total / grandTotal) * 100 : 0}%`,
                        backgroundColor: c.colour,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Over time */}
          <div className="bg-white border border-line rounded-lg p-5 sm:p-6 space-y-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-[18px] font-semibold text-ink">Over time</p>
              <div className="inline-flex rounded-md border border-line overflow-hidden text-[14px]">
                {(["year", "month"] as Freq[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFreq(f)}
                    className={[
                      "h-8 px-3 capitalize",
                      freq === f ? "bg-primary text-white" : "text-muted hover:bg-soft",
                    ].join(" ")}
                  >
                    {f === "year" ? "Yearly" : "Monthly"}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14.5px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 pr-3 font-medium">{freq === "year" ? "Year" : "Month"}</th>
                    {companies.map((c) => (
                      <th key={c.name} className="py-2 px-3 font-medium text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="size-2.5 rounded-sm"
                            style={{ backgroundColor: c.colour }}
                          />
                          {c.name}
                        </span>
                      </th>
                    ))}
                    <th className="py-2 pl-3 font-semibold text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {overTime.map((row) => (
                    <tr key={row.period} className="border-t border-line">
                      <td className="py-2 pr-3 text-ink whitespace-nowrap">{periodLabel(row.period)}</td>
                      {row.cells.map((v, i) => (
                        <td key={i} className="py-2 px-3 text-right tnum text-ink">
                          {v > 0 ? formatSGD(v) : <span className="text-muted/50">—</span>}
                        </td>
                      ))}
                      <td className="py-2 pl-3 text-right tnum font-semibold text-ink">
                        {formatSGD(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Large / unusual */}
          <div className="bg-white border border-line rounded-lg p-5 sm:p-6 space-y-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-[18px] font-semibold text-ink">Large or unusual deposits</p>
              <p className="text-[14px] text-muted">{largest.length} flagged</p>
            </div>
            {largest.length === 0 ? (
              <p className="text-[15px] text-muted">None flagged.</p>
            ) : (
              <ul className="divide-y divide-line">
                {largest.map((d) => (
                  <li key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15.5px] text-ink truncate">
                        {d.income_group !== OTHER_GROUP ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="size-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: colourFor(d.income_group) }}
                            />
                            {d.income_group}
                          </span>
                        ) : (
                          <span className="text-muted">{d.counterparty || "Unknown source"}</span>
                        )}
                      </p>
                      <p className="text-[13px] text-muted tnum">{d.txn_date}</p>
                    </div>
                    <p className="text-[16px] font-semibold text-ink tnum shrink-0">
                      {formatSGD(d.amount)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Unclassified — spot new sources to name */}
          {unclassified.length > 0 && (
            <div className="bg-white border border-line rounded-lg p-5 sm:p-6 space-y-3">
              <div>
                <p className="text-[18px] font-semibold text-ink">Unclassified deposits</p>
                <p className="text-[14px] text-muted mt-0.5">
                  Biggest payers not yet mapped to a company. Spot a new income
                  source here and it can be added to the rules.
                </p>
              </div>
              <ul className="divide-y divide-line">
                {unclassified.map((u) => (
                  <li key={u.label} className="py-2 flex items-center justify-between gap-3">
                    <p className="text-[14.5px] text-ink truncate">{u.label}</p>
                    <p className="text-[13px] text-muted tnum shrink-0">
                      {u.times}× · <span className="text-ink">{formatSGD(u.total)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
