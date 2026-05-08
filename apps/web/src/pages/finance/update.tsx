import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useFinanceData } from "@/finance/use-finance-data";
import {
  formatMonthLabel,
  formatSGD,
  shiftMonth,
  ymToFirstDay,
  type Account,
} from "@/lib/finance";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";

export default function FinanceUpdatePage() {
  const { month = "" } = useParams<{ month: string }>();
  const data = useFinanceData();
  const navigate = useNavigate();

  // Validate month format (YYYY-MM) and convert to first-of-month.
  const targetMonth = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    return ymToFirstDay(month);
  }, [month]);

  const [balances, setBalances] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefillRan, setPrefillRan] = useState(false);
  const [previousMap, setPreviousMap] = useState<Record<string, number>>({});
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Bootstrap: call prefill RPC on mount, then load balances.
  useEffect(() => {
    if (!targetMonth || prefillRan) return;
    let cancelled = false;
    (async () => {
      try {
        await supabase.rpc("prefill_month_from_previous", { p_month: targetMonth });
        if (!cancelled) {
          setPrefillRan(true);
          await data.reload();
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetMonth, prefillRan, data]);

  // Once data loads, hydrate the input map.
  useEffect(() => {
    if (!targetMonth) return;
    const next: Record<string, string> = {};
    for (const a of data.accounts) {
      const snap = data.snapshots.find(
        (s) => s.account_id === a.id && s.snapshot_month === targetMonth,
      );
      next[a.id] = snap?.balance_sgd != null ? String(snap.balance_sgd) : "";
    }
    setBalances(next);

    // Previous-month map for "vs last month" deltas.
    const prevMonth = shiftMonth(targetMonth, -1);
    const prev: Record<string, number> = {};
    for (const s of data.snapshots) {
      if (s.snapshot_month === prevMonth) prev[s.account_id] = s.balance_sgd;
    }
    setPreviousMap(prev);
  }, [data.accounts, data.snapshots, targetMonth]);

  if (!targetMonth) return <Navigate to="/finance" replace />;
  if (data.loading || !prefillRan) return <LoadingScreen />;

  const activeAccounts = data.accounts.filter((a) => a.active);
  const total = activeAccounts.reduce((s, a) => s + (parseFloat(balances[a.id] || "0") || 0), 0);

  function setBalance(id: string, raw: string) {
    // Allow only digits and one decimal point. Strip thousands-separator
    // commas the user might paste in. Strip leading zeros so "0123"
    // becomes "123", but keep "0.x" intact.
    let cleaned = raw.replace(/[^0-9.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) {
      cleaned =
        cleaned.slice(0, firstDot + 1) +
        cleaned.slice(firstDot + 1).replace(/\./g, "");
    }
    cleaned = cleaned.replace(/^0+(?=\d)/, "");
    setBalances((b) => ({ ...b, [id]: cleaned }));
  }

  async function persist(): Promise<void> {
    if (!targetMonth) return;
    const rows = activeAccounts.map((a) => ({
      account_id: a.id,
      snapshot_month: targetMonth,
      balance_sgd: parseFloat(balances[a.id] || "0") || 0,
    }));
    const { error } = await supabase
      .from("account_snapshots")
      .upsert(rows, { onConflict: "account_id,snapshot_month" });
    if (error) throw error;
  }

  async function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await persist();
      await data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete() {
    setError(null);
    setSubmitting(true);
    try {
      await persist();
      navigate("/finance");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!targetMonth) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("account_snapshots")
        .delete()
        .eq("snapshot_month", targetMonth);
      if (error) throw error;
      navigate("/finance");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
      setConfirmDeleteOpen(false);
    }
  }

  // Does this month already have any persisted rows? Without that we
  // shouldn't offer a delete (nothing to delete).
  const hasPersisted = data.snapshots.some((s) => s.snapshot_month === targetMonth);

  return (
    <section className="mx-auto max-w-[760px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/finance" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Finance overview
      </Link>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[13px] uppercase tracking-wider text-muted mb-1">Finance update</p>
          <h1 className="text-[28px] font-medium text-ink">{formatMonthLabel(targetMonth)}</h1>
        </div>
        <div className="text-right">
          <p className="text-[12.5px] uppercase tracking-wider text-muted mb-1">Running total</p>
          <p className="text-[24px] font-semibold text-ink tnum">{formatSGD(total)}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[14px] px-4 py-3">
          {error}
        </div>
      )}

      <form onSubmit={handleSaveDraft} className="space-y-4">
        <div className="bg-white border border-line rounded-lg overflow-hidden">
          <ul className="divide-y divide-line">
            {activeAccounts.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                value={balances[a.id] ?? ""}
                previous={previousMap[a.id] ?? null}
                onChange={(v) => setBalance(a.id, v)}
              />
            ))}
          </ul>
          <div className="flex items-center justify-between bg-soft border-t border-line px-5 py-3">
            <p className="text-[14px] uppercase tracking-wider text-muted">Total</p>
            <p className="text-[22px] font-semibold text-ink tnum">{formatSGD(total)}</p>
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-line">
          {hasPersisted ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={submitting}
              className="text-muted hover:text-danger"
            >
              Delete this month
            </Button>
          ) : <span />}
          <div className="flex gap-2 ml-auto">
            <Button type="submit" variant="secondary" loading={submitting} disabled={submitting}>
              Save draft
            </Button>
            <Button type="button" onClick={handleComplete} loading={submitting} disabled={submitting}>
              Mark complete
            </Button>
          </div>
        </div>
      </form>

      {confirmDeleteOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/30 backdrop-blur-[2px] px-4"
          onClick={(e) => e.target === e.currentTarget && !submitting && setConfirmDeleteOpen(false)}
        >
          <div className="w-full max-w-sm bg-white rounded-lg border border-line p-5">
            <p className="text-[20px] font-semibold text-ink mb-2">
              Delete {formatMonthLabel(targetMonth!)}?
            </p>
            <p className="text-[14.5px] text-muted leading-relaxed mb-4">
              This removes all eight account balances for this month. The chart
              and totals re-compute without it. This can't be undone, but you
              can re-add the month later from the History page.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDelete} loading={submitting}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface RowProps {
  account: Account;
  value: string;
  previous: number | null;
  onChange: (v: string) => void;
}

function AccountRow({ account, value, previous, onChange }: RowProps) {
  const [focused, setFocused] = useState(false);
  const current = parseFloat(value || "0") || 0;
  const delta = previous != null ? current - previous : 0;

  // Show raw digits while editing for easy keyboard entry; format with
  // thousands separators (and up to two decimals) when blurred so big
  // numbers read naturally.
  const display = focused
    ? value
    : value === ""
      ? ""
      : current.toLocaleString("en-SG", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });

  return (
    <li className="grid grid-cols-[1fr_auto] gap-3 sm:gap-5 items-center px-4 sm:px-5 py-3">
      <div>
        <p className="text-[15.5px] font-medium text-ink">{account.name}</p>
        <p className="text-[13px] text-muted">{account.entity}</p>
        {previous != null && (
          <p className={[
            "text-[12.5px] tnum mt-0.5",
            delta === 0 ? "text-muted" : delta > 0 ? "text-emerald" : "text-danger",
          ].join(" ")}>
            {delta === 0 ? "no change" : `${delta > 0 ? "+" : "−"}${formatSGD(Math.abs(delta))}`}{" "}
            <span className="text-muted">vs last month</span>
          </p>
        )}
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="0"
        aria-label={`${account.name} balance in SGD`}
        className="w-32 sm:w-48 h-12 rounded-md border border-line bg-white px-3 text-right text-[20px] font-medium text-ink tnum focus:outline-2 focus:outline-offset-0 focus:outline-primary"
      />
    </li>
  );
}
