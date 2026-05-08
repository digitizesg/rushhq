import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useStocksData } from "@/stocks/use-stocks-data";
import { useAuth } from "@/auth/auth-context";
import { formatSGD, todayIso, type PendingDepositStatus } from "@/lib/stocks";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { Select } from "@/components/select";
import { Modal } from "@/components/modal";

export default function DepositsPage() {
  const data = useStocksData();
  const { member } = useAuth();
  const [addOpen, setAddOpen] = useState(false);

  if (data.loading) return <LoadingScreen />;

  const sorted = [...data.pendingDeposits].sort((a, b) => {
    if (a.status === b.status) {
      return a.received_date < b.received_date ? 1 : -1;
    }
    // Pending first, then invested, then cancelled.
    const order: Record<PendingDepositStatus, number> = { pending: 0, invested: 1, cancelled: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <section className="mx-auto max-w-[820px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/stocks" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Stocks overview
      </Link>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[13px] uppercase tracking-wider text-muted mb-1">Stocks</p>
          <h1 className="text-[28px] font-medium text-ink">Pending deposits</h1>
          <p className="mt-2 text-[14.5px] text-muted">
            Money waiting to be invested. Use this for gifts when you're not investing the same day.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>Add deposit</Button>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-6 text-[15px] text-muted">
          No deposits yet.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-lg overflow-hidden">
          <ul className="divide-y divide-line">
            {sorted.map((d) => {
              const child = data.children.find((c) => c.id === d.member_id);
              return (
                <li key={d.id} className="px-5 py-4 grid sm:grid-cols-[1fr_auto_auto] gap-3 items-center">
                  <div>
                    <p className="text-[15.5px] font-medium text-ink">
                      {child?.short_name ?? "?"} · {d.source}
                    </p>
                    <p className="text-[13.5px] text-muted">
                      Received {format(new Date(d.received_date), "d LLL yyyy")}
                    </p>
                  </div>
                  <StatusBadge status={d.status} />
                  <div className="flex items-center gap-3">
                    <span className="text-[15px] text-ink tnum">{formatSGD(d.amount_sgd)}</span>
                    {d.status === "pending" && (
                      <CancelButton
                        depositId={d.id}
                        onCancelled={() => data.reload()}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add deposit">
        {member && (
          <AddForm
            createdBy={member.id}
            onAdded={async () => {
              setAddOpen(false);
              await data.reload();
            }}
            onCancelled={() => setAddOpen(false)}
          />
        )}
      </Modal>
    </section>
  );
}

function StatusBadge({ status }: { status: PendingDepositStatus }) {
  const styles: Record<PendingDepositStatus, { bg: string; text: string; label: string }> = {
    pending:   { bg: "bg-amber-soft",   text: "text-amber",   label: "Pending"   },
    invested:  { bg: "bg-emerald-soft", text: "text-emerald", label: "Invested"  },
    cancelled: { bg: "bg-soft",         text: "text-muted",   label: "Cancelled" },
  };
  const s = styles[status];
  return (
    <span className={`inline-flex items-center px-2 h-6 rounded-full text-[13px] ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function CancelButton({
  depositId,
  onCancelled,
}: {
  depositId: string;
  onCancelled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Mark this deposit as cancelled?")) return;
        setBusy(true);
        await supabase.from("pending_deposits").update({ status: "cancelled" }).eq("id", depositId);
        setBusy(false);
        onCancelled();
      }}
      className="text-[13.5px] text-muted hover:text-danger disabled:opacity-50"
    >
      Cancel
    </button>
  );
}

interface AddFormProps {
  createdBy: string;
  onAdded: () => Promise<void>;
  onCancelled: () => void;
}

function AddForm({ createdBy, onAdded, onCancelled }: AddFormProps) {
  const data = useStocksData();
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("");
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!memberId) { setError("Pick a child"); return; }
    const amt = parseFloat(amount);
    if (!(amt > 0)) { setError("Amount must be positive"); return; }
    if (!source.trim()) { setError("Add a source, e.g. 'Birthday from Grandma'"); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("pending_deposits").insert({
        member_id: memberId,
        amount_sgd: amt,
        source: source.trim(),
        received_date: date,
        created_by: createdBy,
      });
      if (error) throw error;
      await onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Select label="Child" required value={memberId} onChange={(e) => setMemberId(e.target.value)}>
        <option value="">Pick one</option>
        {data.children.map((c) => (
          <option key={c.id} value={c.id}>{c.short_name}</option>
        ))}
      </Select>
      <TextField
        label="Amount (SGD)"
        required
        type="number"
        inputMode="decimal"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <TextField
        label="Source"
        required
        placeholder="Birthday from Grandma"
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <TextField
        label="Date received"
        required
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      {error && <p role="alert" className="text-danger text-[14px]">{error}</p>}
      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <Button type="button" variant="secondary" onClick={onCancelled}>Cancel</Button>
        <Button type="submit" loading={submitting}>Add</Button>
      </div>
    </form>
  );
}
