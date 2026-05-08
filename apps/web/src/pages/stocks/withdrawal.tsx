import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useStocksData, priceOf } from "@/stocks/use-stocks-data";
import { formatSGD, formatShares, formatUSD, todayIso } from "@/lib/stocks";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { Select } from "@/components/select";

export default function WithdrawalPage() {
  const data = useStocksData();
  const navigate = useNavigate();

  const [memberId, setMemberId] = useState("");
  const [shares, setShares] = useState("");
  const [pricePerShare, setPricePerShare] = useState("");
  const [fxRate, setFxRate] = useState(() => priceOf(data.priceCache, "USDSGD").toFixed(4));
  const [txDate, setTxDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (data.loading) return <LoadingScreen />;

  const holding = data.holdings.find((h) => h.member_id === memberId);
  const sNum = parseFloat(shares) || 0;
  const pNum = parseFloat(pricePerShare) || 0;
  const fNum = parseFloat(fxRate) || 0;
  const remaining = (holding?.shares_held ?? 0) - sNum;
  const remainingValueSgd = remaining * pNum * fNum;
  const proceedsSgd = sNum * pNum * fNum;
  const tooMuch = sNum > (holding?.shares_held ?? 0);

  async function actuallyRecord() {
    setError(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("record_withdrawal", {
        p_member_id: memberId,
        p_shares_withdrawn: sNum,
        p_price_per_share_usd: pNum,
        p_usd_to_sgd_rate: fNum,
        p_transaction_date: txDate,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      navigate("/stocks");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!memberId) { setError("Pick a child"); return; }
    if (!(sNum > 0) || !(pNum > 0) || !(fNum > 0)) {
      setError("Shares, price, and FX rate must all be positive numbers."); return;
    }
    if (tooMuch) {
      setError(`Withdrawal exceeds ${memberSelected()?.short_name}'s holdings (${formatShares(holding?.shares_held ?? 0)} available).`);
      return;
    }
    setConfirmOpen(true);
  }

  function memberSelected() {
    return data.children.find((c) => c.id === memberId);
  }

  return (
    <section className="mx-auto max-w-[640px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/stocks" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Stocks overview
      </Link>

      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">Stocks</p>
        <h1 className="text-[26px] font-medium text-ink">Record a withdrawal</h1>
        <p className="mt-2 text-[13.5px] text-muted">
          For when a kid actually takes some money out. The PDF the kids have describes withdrawal as discouraged but allowed.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[13px] px-4 py-3">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="bg-white border border-line rounded-lg p-5 space-y-4">
          <Select label="Child" required value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Pick one</option>
            {data.children.map((c) => {
              const h = data.holdings.find((x) => x.member_id === c.id);
              return (
                <option key={c.id} value={c.id}>
                  {c.short_name} ({formatShares(h?.shares_held ?? 0)} shares)
                </option>
              );
            })}
          </Select>
          <div className="grid sm:grid-cols-2 gap-3">
            <TextField
              label="Shares to withdraw"
              required
              type="number"
              inputMode="decimal"
              step="0.000001"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              hint={memberId ? `Available: ${formatShares(holding?.shares_held ?? 0)}` : undefined}
              error={tooMuch ? "Exceeds holdings" : undefined}
            />
            <TextField
              label="USD price sold at"
              required
              type="number"
              inputMode="decimal"
              step="0.0001"
              value={pricePerShare}
              onChange={(e) => setPricePerShare(e.target.value)}
            />
            <TextField
              label="USD/SGD rate"
              required
              type="number"
              inputMode="decimal"
              step="0.000001"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
            />
            <TextField
              label="Date"
              required
              type="date"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
            />
          </div>
          <label className="block">
            <span className="block text-[13px] font-medium text-ink mb-1.5">Notes (optional)</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-[14px] focus:outline-2 focus:outline-offset-0 focus:outline-primary"
            />
          </label>
        </section>

        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <Link to="/stocks" className="inline-flex h-10 items-center px-4 rounded-md border border-line text-[14px]">
            Cancel
          </Link>
          <Button type="submit" variant="danger">
            Review and record
          </Button>
        </div>
      </form>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/30 backdrop-blur-[2px] px-4"
          onClick={(e) => e.target === e.currentTarget && !submitting && setConfirmOpen(false)}
        >
          <div className="w-full max-w-sm bg-white rounded-lg border border-line p-5">
            <p className="text-[18px] font-semibold text-ink mb-2">Confirm withdrawal</p>
            <p className="text-[13.5px] text-muted leading-relaxed mb-4">
              {memberSelected()?.short_name} will have <span className="text-ink font-medium tnum">{formatShares(remaining)}</span> shares left,
              worth approximately <span className="text-ink font-medium tnum">{formatSGD(remainingValueSgd)}</span>.
              Proceeds: <span className="text-ink font-medium tnum">{formatSGD(proceedsSgd)}</span> ({formatUSD(sNum * pNum)}).
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="danger" onClick={actuallyRecord} loading={submitting}>
                Record withdrawal
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
