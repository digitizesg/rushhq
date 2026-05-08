import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useFinanceData } from "@/finance/use-finance-data";
import { formatMonthLabel, formatSGDWhole } from "@/lib/finance";
import { LoadingScreen } from "@/components/loading-screen";

export default function FinanceHistoryPage() {
  const data = useFinanceData();

  const months = useMemo(() => {
    const set = new Set(data.snapshots.map((s) => s.snapshot_month));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [data.snapshots]);

  const activeAccounts = data.accounts.filter((a) => a.active);

  if (data.loading) return <LoadingScreen />;

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/finance" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Finance overview
      </Link>

      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">Finance</p>
        <h1 className="text-[26px] font-medium text-ink">History</h1>
      </div>

      {months.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-6 text-[14px] text-muted">
          No snapshots yet.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-lg overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[640px]">
            <thead className="bg-soft text-muted text-left text-[12px]">
              <tr>
                <th className="font-medium px-4 py-2.5">Month</th>
                {activeAccounts.map((a) => (
                  <th key={a.id} className="font-medium px-3 py-2.5 text-right">{a.name}</th>
                ))}
                <th className="font-medium px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const rowSnaps = data.snapshots.filter((s) => s.snapshot_month === m);
                const total = rowSnaps.reduce((s, r) => s + r.balance_sgd, 0);
                return (
                  <tr key={m} className="border-t border-line hover:bg-soft transition-colors">
                    <td className="px-4 py-3 text-ink">
                      <Link
                        to={`/finance/update/${m.slice(0, 7)}`}
                        className="hover:underline"
                      >
                        {formatMonthLabel(m)}
                      </Link>
                    </td>
                    {activeAccounts.map((a) => {
                      const snap = rowSnaps.find((s) => s.account_id === a.id);
                      return (
                        <td key={a.id} className="px-3 py-3 text-right tnum text-ink">
                          {snap ? formatSGDWhole(snap.balance_sgd) : "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right tnum font-semibold text-ink">
                      {formatSGDWhole(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
