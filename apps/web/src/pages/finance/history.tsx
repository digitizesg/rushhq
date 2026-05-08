import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, Plus } from "lucide-react";
import { useFinanceData } from "@/finance/use-finance-data";
import { firstOfMonth, formatMonthLabel, formatSGDWhole, ym } from "@/lib/finance";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TextField } from "@/components/text-field";

export default function FinanceHistoryPage() {
  const data = useFinanceData();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);

  const months = useMemo(() => {
    const set = new Set(data.snapshots.map((s) => s.snapshot_month));
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [data.snapshots]);

  const activeAccounts = data.accounts.filter((a) => a.active);

  if (data.loading) return <LoadingScreen />;

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/finance" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Finance overview
      </Link>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[13px] uppercase tracking-wider text-muted mb-1">Finance</p>
          <h1 className="text-[28px] font-medium text-ink">History</h1>
          <p className="mt-2 text-[14.5px] text-muted">
            Click any month to edit, or add a past month to backfill earlier data.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add past month
        </Button>
      </div>

      {months.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-6 text-[15px] text-muted">
          No snapshots yet.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-lg overflow-x-auto">
          <table className="w-full text-[14.5px] min-w-[640px]">
            <thead className="bg-soft text-muted text-left text-[13px]">
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
                      <Link to={`/finance/update/${m.slice(0, 7)}`} className="hover:underline">
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add past month">
        <PastMonthPicker
          existingMonths={months}
          onPick={(targetYm) => {
            setAddOpen(false);
            navigate(`/finance/update/${targetYm}`);
          }}
          onCancelled={() => setAddOpen(false)}
        />
      </Modal>
    </section>
  );
}

interface PastMonthPickerProps {
  existingMonths: string[];           // YYYY-MM-DD list
  onPick: (yyyymm: string) => void;
  onCancelled: () => void;
}

function PastMonthPicker({ existingMonths, onPick, onCancelled }: PastMonthPickerProps) {
  // Default to the month before today's month so the user lands on the
  // most likely target.
  const now = new Date();
  const defaultYm = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const [chosen, setChosen] = useState(defaultYm);

  const targetFirstDay = `${chosen}-01`;
  const exists = existingMonths.includes(targetFirstDay);

  // Common quick-picks: previous 6 months that don't yet exist.
  const quickPicks: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const candidate = ym(d);
    if (!existingMonths.includes(`${candidate}-01`)) quickPicks.push(candidate);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(chosen)) return;
    onPick(chosen);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-[14.5px] text-muted">
        Pick a past month to backfill. We'll create empty rows for each
        active account and prefill from whatever month is closest before
        it. You can adjust on the next screen.
      </p>

      <TextField
        label="Month"
        type="month"
        required
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
        max={defaultYm}
        hint={
          exists
            ? "This month already exists; you'll be editing it."
            : `Will create ${formatMonthLabel(`${chosen}-01` || firstOfMonth(new Date()))}.`
        }
      />

      {quickPicks.length > 0 && (
        <div>
          <p className="text-[13px] uppercase tracking-wider text-muted mb-2">Quick pick</p>
          <div className="flex flex-wrap gap-1.5">
            {quickPicks.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setChosen(q)}
                className={[
                  "px-2.5 h-7 rounded-full border text-[13.5px] tnum",
                  chosen === q
                    ? "bg-primary text-white border-primary"
                    : "border-line text-muted hover:text-ink hover:bg-soft",
                ].join(" ")}
              >
                {formatMonthLabel(`${q}-01`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <Button type="button" variant="secondary" onClick={onCancelled}>
          Cancel
        </Button>
        <Button type="submit">{exists ? "Edit" : "Create"}</Button>
      </div>
    </form>
  );
}
