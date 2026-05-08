import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useStocksData, priceOf } from "@/stocks/use-stocks-data";
import { formatShares, formatUSD, todayIso } from "@/lib/stocks";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";

export default function DividendPage() {
  const data = useStocksData();
  const navigate = useNavigate();

  const [shares, setShares] = useState("");
  const [pricePerShare, setPricePerShare] = useState("");
  const [fxRate, setFxRate] = useState(() => priceOf(data.priceCache, "USDSGD").toFixed(4));
  const [txDate, setTxDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const totalShares = useMemo(
    () => data.holdings.reduce((s, h) => s + h.shares_held, 0),
    [data.holdings],
  );

  if (data.loading) return <LoadingScreen />;

  const sharesNum = parseFloat(shares) || 0;
  const allocPreview = data.holdings
    .filter((h) => h.shares_held > 0)
    .map((h) => ({
      member_id: h.member_id,
      short_name: h.short_name,
      pct: totalShares > 0 ? h.shares_held / totalShares : 0,
      sharesAdded: totalShares > 0 ? sharesNum * (h.shares_held / totalShares) : 0,
    }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const sNum = parseFloat(shares);
    const pNum = parseFloat(pricePerShare);
    const fNum = parseFloat(fxRate);
    if (!(sNum > 0) || !(pNum > 0) || !(fNum > 0)) {
      setError("Shares, price, and FX rate must all be positive numbers.");
      return;
    }
    if (totalShares <= 0) {
      setError("Cannot reinvest a dividend before any shares are held.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("record_dividend_reinvest", {
        p_total_shares: sNum,
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
    }
  }

  return (
    <section className="mx-auto max-w-[640px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/stocks" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Stocks overview
      </Link>

      <div>
        <p className="text-[13px] uppercase tracking-wider text-muted mb-1">Stocks</p>
        <h1 className="text-[28px] font-medium text-ink">Record dividend reinvest</h1>
        <p className="mt-2 text-[14.5px] text-muted">
          When VOO pays a quarterly dividend and you reinvest the cash on moomoo,
          enter what you bought. We split it pro-rata by current holdings.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[14px] px-4 py-3">
          {error}
        </div>
      )}

      <section className="bg-white border border-line rounded-lg overflow-hidden">
        <header className="px-5 py-3 bg-soft border-b border-line">
          <p className="text-[15px] font-semibold text-ink">Current holdings</p>
        </header>
        <ul className="divide-y divide-line">
          {data.holdings.map((h) => (
            <li key={h.member_id} className="px-5 py-3 flex items-center justify-between text-[15px]">
              <span className="text-ink">{h.short_name}</span>
              <span className="text-muted tnum">{formatShares(h.shares_held)} shares ({(totalShares > 0 ? (h.shares_held / totalShares) * 100 : 0).toFixed(1)}%)</span>
            </li>
          ))}
        </ul>
      </section>

      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="bg-white border border-line rounded-lg p-5 space-y-4">
          <p className="text-[15px] font-semibold text-ink">Reinvest details</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <TextField
              label="Shares purchased with dividend"
              required
              type="number"
              inputMode="decimal"
              step="0.000001"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
            />
            <TextField
              label="Price per share (USD)"
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
            <span className="block text-[14px] font-medium text-ink mb-1.5">Notes (optional)</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] focus:outline-2 focus:outline-offset-0 focus:outline-primary"
            />
          </label>
        </section>

        {sharesNum > 0 && totalShares > 0 && (
          <section className="bg-soft border border-line rounded-lg p-5 space-y-2">
            <p className="text-[15px] font-semibold text-ink">Pro-rata allocation</p>
            <ul className="space-y-1.5 text-[14.5px]">
              {allocPreview.map((a) => (
                <li key={a.member_id} className="flex items-baseline justify-between gap-3">
                  <span className="text-ink">{a.short_name}</span>
                  <span className="text-muted tnum">
                    {(a.pct * 100).toFixed(1)}% → +{formatShares(a.sharesAdded)} shares
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[13.5px] text-muted pt-2 border-t border-line">
              Approx total value: {formatUSD(sharesNum * (parseFloat(pricePerShare) || 0))}
            </p>
          </section>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-line">
          <Link to="/stocks" className="inline-flex h-10 items-center px-4 rounded-md border border-line text-[15px]">
            Cancel
          </Link>
          <Button type="submit" loading={submitting} disabled={submitting}>
            Record dividend
          </Button>
        </div>
      </form>
    </section>
  );
}
