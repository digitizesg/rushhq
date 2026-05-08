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

type Mode = "bead" | "gift" | "direct";

export default function BuyPage() {
  const data = useStocksData();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("bead");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Direct allocation state — shares per child id.
  const [directShares, setDirectShares] = useState<Record<string, string>>({});

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

  // Shared transaction state. The FX rate is *derived* from the
  // SGD amount the user enters (or that the bead/gift sources
  // determine), divided by shares × USD price. The user never types
  // an FX rate — they just say what they actually spent in SGD.
  const [shares, setShares] = useState("");
  const [pricePerShare, setPricePerShare] = useState("");
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
  const giftAmountNum = parseFloat(giftAmount) || 0;
  const totalUsd = sharesNum * priceNum;
  // Bead and gift modes have a natural SGD anchor (pool / gift amount),
  // so FX is implied. Direct mode has no anchor — fall back to the
  // cached USD/SGD price (refreshed every 15 min by the cron).
  const cachedFx = priceOf(data.priceCache, "USDSGD");
  const fxNum =
    mode === "bead"
      ? totalUsd > 0 && beadGrandTotalSgd > 0 ? beadGrandTotalSgd / totalUsd : 0
      : mode === "gift"
        ? totalUsd > 0 && giftAmountNum > 0 ? giftAmountNum / totalUsd : 0
        : cachedFx;
  const totalSgdForMode =
    mode === "bead" ? beadGrandTotalSgd
      : mode === "gift" ? giftAmountNum
      : totalUsd * cachedFx;

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
      setError("Shares, price, and the SGD spent must all be positive numbers.");
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

  async function handleDirectSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (sharesNum <= 0 || priceNum <= 0) {
      setError("Shares and USD price must both be positive numbers.");
      return;
    }
    if (fxNum <= 0) {
      setError("USD/SGD rate isn't loaded yet — wait a moment and try again.");
      return;
    }
    const allocs = data.children
      .map((c) => ({
        member_id: c.id,
        shares: parseFloat(directShares[c.id] || "0") || 0,
      }))
      .filter((a) => a.shares > 0);
    if (allocs.length === 0) {
      setError("Allocate at least one child's shares.");
      return;
    }
    const allocSum = allocs.reduce((s, a) => s + a.shares, 0);
    if (Math.abs(allocSum - sharesNum) > 0.000001) {
      setError(
        `Allocations sum to ${allocSum.toFixed(6)} but total shares is ${sharesNum.toFixed(6)}. Make them match.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("record_direct_purchase", {
        p_total_shares: sharesNum,
        p_price_per_share_usd: priceNum,
        p_usd_to_sgd_rate: fxNum,
        p_transaction_date: txDate,
        p_allocations: allocs,
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

  function setDirectShare(memberId: string, raw: string) {
    let cleaned = raw.replace(/[^0-9.]/g, "");
    const dot = cleaned.indexOf(".");
    if (dot !== -1) {
      cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
    }
    setDirectShares((s) => ({ ...s, [memberId]: cleaned }));
  }
  function splitEvenly() {
    if (sharesNum <= 0 || data.children.length === 0) return;
    const each = sharesNum / data.children.length;
    const next: Record<string, string> = {};
    for (const c of data.children) next[c.id] = each.toFixed(6);
    setDirectShares(next);
  }

  async function handleGiftSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!giftMember) { setError("Pick a child"); return; }
    if (sharesNum <= 0 || priceNum <= 0 || fxNum <= 0) {
      setError("Shares, price, and the SGD spent must all be positive numbers.");
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
      <Link to="/stocks" className="inline-flex items-center gap-1 text-[15px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Stocks overview
      </Link>

      <div>
        <p className="text-[14px] uppercase tracking-wider text-muted mb-1">Stocks</p>
        <h1 className="text-[28px] font-medium text-ink">Record a purchase</h1>
        <p className="mt-2 text-[15.5px] text-muted">
          This records what you already bought on moomoo. Enter the actual numbers from the trade confirmation.
        </p>
      </div>

      <div className="inline-flex bg-white border border-line rounded-full p-0.5 flex-wrap">
        {(["bead", "gift", "direct"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={[
              "px-3 h-8 rounded-full text-[15px] font-medium transition-colors",
              mode === m ? "bg-primary text-white" : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {m === "bead" ? "Monthly (bead-funded)" : m === "gift" ? "Quick gift" : "Direct allocation"}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[15px] px-4 py-3">
          {error}
        </div>
      )}

      {mode === "bead" ? (
        <form onSubmit={handleBeadSubmit} className="space-y-5">
          <section className="bg-white border border-line rounded-lg overflow-hidden">
            <header className="px-5 py-3 bg-soft border-b border-line">
              <p className="text-[16px] font-semibold text-ink">Bead periods</p>
            </header>
            {counted.length === 0 ? (
              <p className="px-5 py-4 text-[15.5px] text-muted">
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
                        <p className="text-[16px] text-ink">
                          {member?.short_name ?? "?"} · {formatPeriodLabel(p.period_start)}
                        </p>
                      </div>
                      <p className="text-[16px] text-ink tnum">{formatSGD(t?.total_sgd ?? 0)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="bg-white border border-line rounded-lg overflow-hidden">
            <header className="px-5 py-3 bg-soft border-b border-line">
              <p className="text-[16px] font-semibold text-ink">Pending deposits (optional)</p>
            </header>
            {pending.length === 0 ? (
              <p className="px-5 py-4 text-[15.5px] text-muted">No pending deposits.</p>
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
                        <p className="text-[16px] text-ink">{member?.short_name} · {d.source}</p>
                        <p className="text-[14.5px] text-muted">{d.received_date}</p>
                      </div>
                      <p className="text-[16px] text-ink tnum">{formatSGD(d.amount_sgd)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <TransactionFields
            shares={shares} setShares={setShares}
            pricePerShare={pricePerShare} setPricePerShare={setPricePerShare}
            derivedFx={fxNum} totalSgd={totalSgdForMode}
            txDate={txDate} setTxDate={setTxDate}
            notes={notes} setNotes={setNotes}
          />

          <Preview
            beadGrandTotalSgd={beadGrandTotalSgd}
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
            <Link to="/stocks" className="inline-flex h-10 items-center px-4 rounded-md border border-line text-[16px]">
              Cancel
            </Link>
            <Button type="submit" loading={submitting} disabled={submitting}>
              Record purchase
            </Button>
          </div>
        </form>
      ) : mode === "gift" ? (
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
            derivedFx={fxNum} totalSgd={totalSgdForMode}
            txDate={txDate} setTxDate={setTxDate}
            notes={notes} setNotes={setNotes}
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Link to="/stocks" className="inline-flex h-10 items-center px-4 rounded-md border border-line text-[16px]">
              Cancel
            </Link>
            <Button type="submit" loading={submitting} disabled={submitting}>
              Record gift purchase
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleDirectSubmit} className="space-y-5">
          <p className="text-[15.5px] text-muted">
            For purchases that aren't tied to bead periods or earmarked deposits.
            Useful for backfilling history or when you've decided the split yourself.
            Enter the USD trade details from moomoo, then split the shares per child below.
          </p>

          <TransactionFields
            shares={shares} setShares={setShares}
            pricePerShare={pricePerShare} setPricePerShare={setPricePerShare}
            derivedFx={fxNum} totalSgd={totalSgdForMode}
            txDate={txDate} setTxDate={setTxDate}
            notes={notes} setNotes={setNotes}
          />

          <DirectAllocation
            childList={data.children}
            sharesNum={sharesNum}
            totalSgd={totalSgdForMode}
            allocations={directShares}
            onChange={setDirectShare}
            onSplitEvenly={splitEvenly}
          />

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Link to="/stocks" className="inline-flex h-10 items-center px-4 rounded-md border border-line text-[16px]">
              Cancel
            </Link>
            <Button type="submit" loading={submitting} disabled={submitting}>
              Record purchase
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

interface DirectAllocationProps {
  childList: Array<{ id: string; short_name: string }>;
  sharesNum: number;
  totalSgd: number;
  allocations: Record<string, string>;
  onChange: (memberId: string, raw: string) => void;
  onSplitEvenly: () => void;
}

function DirectAllocation({
  childList,
  sharesNum,
  totalSgd,
  allocations,
  onChange,
  onSplitEvenly,
}: DirectAllocationProps) {
  const allocSum = childList.reduce(
    (s, c) => s + (parseFloat(allocations[c.id] || "0") || 0),
    0,
  );
  const remaining = sharesNum - allocSum;
  const matches = Math.abs(remaining) <= 0.000001 && sharesNum > 0;
  // Per-share SGD comes from total spend / total shares.
  const sgdPerShare = sharesNum > 0 && totalSgd > 0 ? totalSgd / sharesNum : 0;

  return (
    <section className="bg-white border border-line rounded-lg overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 bg-soft border-b border-line">
        <p className="text-[16px] font-semibold text-ink">Allocate shares per child</p>
        {sharesNum > 0 && childList.length > 0 && (
          <button
            type="button"
            onClick={onSplitEvenly}
            className="text-[14.5px] font-medium text-primary hover:underline"
          >
            Split evenly
          </button>
        )}
      </header>
      <ul className="divide-y divide-line">
        {childList.map((c) => {
          const raw = allocations[c.id] ?? "";
          const n = parseFloat(raw || "0") || 0;
          const sgd = n * sgdPerShare;
          return (
            <li key={c.id} className="px-5 py-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center">
              <p className="text-[16px] text-ink">{c.short_name}</p>
              <input
                type="text"
                inputMode="decimal"
                value={raw}
                onChange={(e) => onChange(c.id, e.target.value)}
                placeholder="0.000000"
                aria-label={`${c.short_name} share allocation`}
                className="w-32 h-10 rounded-md border border-line bg-white px-3 text-right text-[17px] tnum focus:outline-2 focus:outline-offset-0 focus:outline-primary"
              />
              <p className="text-[14.5px] text-muted tnum w-24 text-right">
                {n > 0 && sgdPerShare > 0 ? `≈ ${formatSGD(sgd)}` : "—"}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between bg-soft border-t border-line px-5 py-3 text-[15px]">
        <span className="text-muted">
          Allocated {formatShares(allocSum)} of {formatShares(sharesNum || 0)} shares
        </span>
        <span
          className={
            sharesNum <= 0
              ? "text-muted"
              : matches
                ? "text-emerald font-medium"
                : "text-amber font-medium"
          }
        >
          {sharesNum <= 0
            ? "Enter total shares above"
            : matches
              ? "✓ matches"
              : `${remaining > 0 ? "+" : "−"}${formatShares(Math.abs(remaining))} remaining`}
        </span>
      </div>
    </section>
  );
}

interface TransactionFieldsProps {
  shares: string; setShares: (v: string) => void;
  pricePerShare: string; setPricePerShare: (v: string) => void;
  txDate: string; setTxDate: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  /** Read-only — shown as a small info line so the user can sanity-check. */
  derivedFx: number;
  /** SGD source for the trade — bead total, gift amount, or direct field. */
  totalSgd: number;
}

function TransactionFields(p: TransactionFieldsProps) {
  return (
    <section className="bg-white border border-line rounded-lg p-5 space-y-4">
      <p className="text-[16px] font-semibold text-ink">Trade details (from moomoo)</p>
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
          label="Transaction date"
          required
          type="date"
          value={p.txDate}
          onChange={(e) => p.setTxDate(e.target.value)}
        />
      </div>
      {p.totalSgd > 0 && p.derivedFx > 0 && (
        <p className="text-[14.5px] text-muted">
          Recorded at USD/SGD <span className="text-ink tnum">{p.derivedFx.toFixed(4)}</span>{" "}
          ≈ <span className="text-ink tnum">{formatSGD(p.totalSgd)}</span>
        </p>
      )}
      <label className="block">
        <span className="block text-[15px] font-medium text-ink mb-1.5">Notes (optional)</span>
        <textarea
          rows={2}
          value={p.notes}
          onChange={(e) => p.setNotes(e.target.value)}
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-[16px] focus:outline-2 focus:outline-offset-0 focus:outline-primary"
        />
      </label>
    </section>
  );
}

interface PreviewProps {
  beadGrandTotalSgd: number;
  sharesNum: number;
  allocations: Array<{ label: string; amount_sgd: number }>;
}

function Preview({ beadGrandTotalSgd, sharesNum, allocations }: PreviewProps) {
  if (sharesNum <= 0 || beadGrandTotalSgd <= 0) return null;
  const factor = sharesNum / beadGrandTotalSgd;
  return (
    <section className="bg-soft border border-line rounded-lg p-5 space-y-3">
      <p className="text-[16px] font-semibold text-ink">Allocation preview</p>
      <ul className="space-y-1.5 text-[15.5px]">
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
      <div className="text-[14.5px] text-muted pt-2 border-t border-line">
        Pool total: {formatSGD(beadGrandTotalSgd)}
      </div>
    </section>
  );
}
