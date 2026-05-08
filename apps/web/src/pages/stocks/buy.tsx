import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useStocksData, priceOf } from "@/stocks/use-stocks-data";
import {
  formatSGD,
  formatShares,
  todayIso,
} from "@/lib/stocks";
import { formatPeriodLabel } from "@/lib/beads";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { Select } from "@/components/select";

type Mode = "bead" | "gift";

export default function BuyPage() {
  const data = useStocksData();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("bead");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Bead flow state
  const counted = useMemo(
    () => data.beadPeriods.filter((p) => p.status === "counted"),
    [data.beadPeriods],
  );
  const pending = useMemo(
    () => data.pendingDeposits.filter((d) => d.status === "pending"),
    [data.pendingDeposits],
  );
  const [periodIds, setPeriodIds] = useState<Set<string>>(new Set(counted.map((p) => p.id)));
  const [depositIds, setDepositIds] = useState<Set<string>>(new Set());

  // Shared transaction state
  const [shares, setShares] = useState("");
  const [pricePerShare, setPricePerShare] = useState("");
  const [fxRate, setFxRate] = useState(() => priceOf(data.priceCache, "USDSGD").toFixed(4));
  const [txDate, setTxDate] = useState(todayIso());
  const [notes, setNotes] = useState("");

  // Gift flow extras
  const [giftMember, setGiftMember] = useState<string>("");
  const [giftAmount, setGiftAmount] = useState("");
  const [giftSource, setGiftSource] = useState("");

  if (data.loading) return <LoadingScreen />;

  // ---- bead-mode allocation preview ----
  const selectedPeriodTotals = counted
    .filter((p) => periodIds.has(p.id))
    .map((p) => {
      const t = data.beadTotals.find((bt) => bt.period_id === p.id);
      return {
        period: p,
        total_sgd: t?.total_sgd ?? 0,
        member: data.children.find((c) => c.id === p.member_id),
      };
    });
  const selectedDeposits = pending.filter((d) => depositIds.has(d.id)).map((d) => ({
    deposit: d,
    member: data.children.find((c) => c.id === d.member_id),
  }));

  const beadGrandTotalSgd =
    selectedPeriodTotals.reduce((s, p) => s + p.total_sgd, 0) +
    selectedDeposits.reduce((s, d) => s + d.deposit.amount_sgd, 0);

  const sharesNum = parseFloat(shares) || 0;
  const priceNum = parseFloat(pricePerShare) || 0;
  const fxNum = parseFloat(fxRate) || 0;
  const expectedSgd = sharesNum * priceNum * fxNum;

  function togglePeriod(id: string, checked: boolean) {
    setPeriodIds((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleDeposit(id: string, checked: boolean) {
    setDepositIds((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleBeadSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (sharesNum <= 0 || priceNum <= 0 || fxNum <= 0) {
      setError("Shares, price, and FX rate must all be positive numbers.");
      return;
    }
    if (periodIds.size === 0 && depositIds.size === 0) {
      setError("Pick at least one bead period or pending deposit.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("record_bead_purchase", {
        p_total_shares: sharesNum,
        p_price_per_share_usd: priceNum,
        p_usd_to_sgd_rate: fxNum,
        p_transaction_date: txDate,
        p_bead_period_ids: Array.from(periodIds),
        p_pending_deposit_ids: Array.from(depositIds),
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

  async function handleGiftSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!giftMember) { setError("Pick a child"); return; }
    if (sharesNum <= 0 || priceNum <= 0 || fxNum <= 0) {
      setError("Shares, price, and FX rate must all be positive numbers.");
      return;
    }
    const amount = parseFloat(giftAmount);
    if (!(amount > 0)) { setError("Enter the SGD amount of the gift"); return; }
    if (!giftSource.trim()) { setError("What was the source of the gift? e.g. 'Birthday from Grandma'"); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("record_gift_purchase", {
        p_member_id: giftMember,
        p_total_shares: sharesNum,
        p_price_per_share_usd: priceNum,
        p_usd_to_sgd_rate: fxNum,
        p_transaction_date: txDate,
        p_amount_sgd: amount,
        p_source: giftSource.trim(),
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
    <section className="mx-auto max-w-[820px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/stocks" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Stocks overview
      </Link>

      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">Stocks</p>
        <h1 className="text-[26px] font-medium text-ink">Record a purchase</h1>
        <p className="mt-2 text-[13.5px] text-muted">
          This records what you already bought on moomoo. Enter the actual numbers from the trade confirmation.
        </p>
      </div>

      <div className="inline-flex bg-white border border-line rounded-full p-0.5">
        {(["bead", "gift"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={[
              "px-3 h-8 rounded-full text-[13px] font-medium transition-colors",
              mode === m ? "bg-primary text-white" : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {m === "bead" ? "Monthly (bead-funded)" : "Quick gift"}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[13px] px-4 py-3">
          {error}
        </div>
      )}

      {mode === "bead" ? (
        <form onSubmit={handleBeadSubmit} className="space-y-5">
          <section className="bg-white border border-line rounded-lg overflow-hidden">
            <header className="px-5 py-3 bg-soft border-b border-line">
              <p className="text-[14px] font-semibold text-ink">Bead periods</p>
            </header>
            {counted.length === 0 ? (
              <p className="px-5 py-4 text-[13.5px] text-muted">
                No counted bead periods yet. Lock a period from the beads page first.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {counted.map((p) => {
                  const t = data.beadTotals.find((bt) => bt.period_id === p.id);
                  const member = data.children.find((c) => c.id === p.member_id);
                  return (
                    <li key={p.id} className="px-5 py-3 flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={periodIds.has(p.id)}
                        onChange={(e) => togglePeriod(p.id, e.target.checked)}
                        className="size-4 accent-primary"
                      />
                      <div className="flex-1">
                        <p className="text-[14px] text-ink">
                          {member?.short_name ?? "?"} · {formatPeriodLabel(p.period_start)}
                        </p>
                      </div>
                      <p className="text-[14px] text-ink tnum">{formatSGD(t?.total_sgd ?? 0)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="bg-white border border-line rounded-lg overflow-hidden">
            <header className="px-5 py-3 bg-soft border-b border-line">
              <p className="text-[14px] font-semibold text-ink">Pending deposits (optional)</p>
            </header>
            {pending.length === 0 ? (
              <p className="px-5 py-4 text-[13.5px] text-muted">No pending deposits.</p>
            ) : (
              <ul className="divide-y divide-line">
                {pending.map((d) => {
                  const member = data.children.find((c) => c.id === d.member_id);
                  return (
                    <li key={d.id} className="px-5 py-3 flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={depositIds.has(d.id)}
                        onChange={(e) => toggleDeposit(d.id, e.target.checked)}
                        className="size-4 accent-primary"
                      />
                      <div className="flex-1">
                        <p className="text-[14px] text-ink">{member?.short_name} · {d.source}</p>
                        <p className="text-[12.5px] text-muted">{d.received_date}</p>
                      </div>
                      <p className="text-[14px] text-ink tnum">{formatSGD(d.amount_sgd)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <TransactionFields
            shares={shares} setShares={setShares}
            pricePerShare={pricePerShare} setPricePerShare={setPricePerShare}
            fxRate={fxRate} setFxRate={setFxRate}
            txDate={txDate} setTxDate={setTxDate}
            notes={notes} setNotes={setNotes}
          />

          <Preview
            beadGrandTotalSgd={beadGrandTotalSgd}
            expectedSgd={expectedSgd}
            sharesNum={sharesNum}
            allocations={[
              ...selectedPeriodTotals.map((p) => ({
                label: `${p.member?.short_name ?? "?"} · ${formatPeriodLabel(p.period.period_start)}`,
                amount_sgd: p.total_sgd,
              })),
              ...selectedDeposits.map((d) => ({
                label: `${d.member?.short_name ?? "?"} · ${d.deposit.source}`,
                amount_sgd: d.deposit.amount_sgd,
              })),
            ]}
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Link to="/stocks" className="inline-flex h-10 items-center px-4 rounded-md border border-line text-[14px]">
              Cancel
            </Link>
            <Button type="submit" loading={submitting} disabled={submitting}>
              Record purchase
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleGiftSubmit} className="space-y-5">
          <section className="bg-white border border-line rounded-lg p-5 space-y-3">
            <Select label="Child" required value={giftMember} onChange={(e) => setGiftMember(e.target.value)}>
              <option value="">Pick one</option>
              {data.children.map((c) => (
                <option key={c.id} value={c.id}>{c.short_name}</option>
              ))}
            </Select>
            <div className="grid sm:grid-cols-2 gap-3">
              <TextField
                label="SGD amount of the gift"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={giftAmount}
                onChange={(e) => setGiftAmount(e.target.value)}
              />
              <TextField
                label="Source"
                placeholder="Birthday from Grandma"
                value={giftSource}
                onChange={(e) => setGiftSource(e.target.value)}
              />
            </div>
          </section>

          <TransactionFields
            shares={shares} setShares={setShares}
            pricePerShare={pricePerShare} setPricePerShare={setPricePerShare}
            fxRate={fxRate} setFxRate={setFxRate}
            txDate={txDate} setTxDate={setTxDate}
            notes={notes} setNotes={setNotes}
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Link to="/stocks" className="inline-flex h-10 items-center px-4 rounded-md border border-line text-[14px]">
              Cancel
            </Link>
            <Button type="submit" loading={submitting} disabled={submitting}>
              Record gift purchase
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

interface TransactionFieldsProps {
  shares: string; setShares: (v: string) => void;
  pricePerShare: string; setPricePerShare: (v: string) => void;
  fxRate: string; setFxRate: (v: string) => void;
  txDate: string; setTxDate: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
}

function TransactionFields(p: TransactionFieldsProps) {
  return (
    <section className="bg-white border border-line rounded-lg p-5 space-y-4">
      <p className="text-[14px] font-semibold text-ink">Trade details (from moomoo)</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <TextField
          label="Total shares purchased"
          required
          type="number"
          inputMode="decimal"
          step="0.000001"
          value={p.shares}
          onChange={(e) => p.setShares(e.target.value)}
        />
        <TextField
          label="Price per share (USD)"
          required
          type="number"
          inputMode="decimal"
          step="0.0001"
          value={p.pricePerShare}
          onChange={(e) => p.setPricePerShare(e.target.value)}
        />
        <TextField
          label="USD/SGD rate at purchase"
          required
          type="number"
          inputMode="decimal"
          step="0.000001"
          value={p.fxRate}
          onChange={(e) => p.setFxRate(e.target.value)}
          hint="Defaults to the latest cached rate. Adjust to match what moomoo showed."
        />
        <TextField
          label="Transaction date"
          required
          type="date"
          value={p.txDate}
          onChange={(e) => p.setTxDate(e.target.value)}
        />
      </div>
      <label className="block">
        <span className="block text-[13px] font-medium text-ink mb-1.5">Notes (optional)</span>
        <textarea
          rows={2}
          value={p.notes}
          onChange={(e) => p.setNotes(e.target.value)}
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-[14px] focus:outline-2 focus:outline-offset-0 focus:outline-primary"
        />
      </label>
    </section>
  );
}

interface PreviewProps {
  beadGrandTotalSgd: number;
  expectedSgd: number;
  sharesNum: number;
  allocations: Array<{ label: string; amount_sgd: number }>;
}

function Preview({ beadGrandTotalSgd, expectedSgd, sharesNum, allocations }: PreviewProps) {
  if (sharesNum <= 0 || beadGrandTotalSgd <= 0) return null;
  const factor = sharesNum / beadGrandTotalSgd;
  const mismatch = Math.abs(expectedSgd - beadGrandTotalSgd);
  return (
    <section className="bg-soft border border-line rounded-lg p-5 space-y-3">
      <p className="text-[14px] font-semibold text-ink">Allocation preview</p>
      <ul className="space-y-1.5 text-[13.5px]">
        {allocations.map((a, i) => {
          const sharesAlloc = a.amount_sgd * factor;
          return (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className="text-ink">{a.label}</span>
              <span className="text-muted tnum">
                {formatSGD(a.amount_sgd)} → {formatShares(sharesAlloc)} shares
              </span>
            </li>
          );
        })}
      </ul>
      <div className="text-[12.5px] text-muted pt-2 border-t border-line">
        Pool total: {formatSGD(beadGrandTotalSgd)} · Expected SGD spend: {formatSGD(expectedSgd)}
        {mismatch > 0.5 && (
          <span className="text-amber"> · ⚠ off by {formatSGD(mismatch)} — double-check shares or FX</span>
        )}
      </div>
    </section>
  );
}
