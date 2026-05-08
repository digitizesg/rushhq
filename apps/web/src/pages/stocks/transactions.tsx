import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { useStocksData } from "@/stocks/use-stocks-data";
import {
  formatSGD,
  formatShares,
  formatUSD,
  TRANSACTION_TYPE_LABEL,
  type StockAllocation,
  type StockTransaction,
  type StockTransactionType,
} from "@/lib/stocks";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";

export default function TransactionsPage() {
  const data = useStocksData();
  const [openTxId, setOpenTxId] = useState<string | null>(null);

  if (data.loading) return <LoadingScreen />;

  const openTx = data.transactions.find((t) => t.id === openTxId) ?? null;
  const openAllocs = openTx
    ? data.allocations.filter((a) => a.transaction_id === openTx.id)
    : [];

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/stocks" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Stocks overview
      </Link>

      <div>
        <p className="text-[13px] uppercase tracking-wider text-muted mb-1">Stocks</p>
        <h1 className="text-[28px] font-medium text-ink">All transactions</h1>
        <p className="mt-2 text-[14.5px] text-muted">
          Tap a row to edit notes or delete the transaction. Numbers are
          locked once recorded; correct mistakes by deleting and re-entering.
        </p>
      </div>

      {data.transactions.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-6 text-[15px] text-muted">
          No transactions yet.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-lg overflow-hidden">
          <ul className="divide-y divide-line">
            {data.transactions.map((tx) => {
              const allocs = data.allocations.filter((a) => a.transaction_id === tx.id);
              return (
                <li key={tx.id}>
                  <button
                    type="button"
                    onClick={() => setOpenTxId(tx.id)}
                    className="w-full text-left px-5 py-4 grid sm:grid-cols-[120px_1fr_auto] gap-3 sm:gap-5 items-start hover:bg-soft focus:bg-soft focus:outline-none"
                  >
                    <p className="text-[14px] text-muted tnum">{format(new Date(tx.transaction_date), "EEE d LLL yyyy")}</p>
                    <div className="min-w-0">
                      <p className="text-[15.5px] font-medium text-ink">
                        {TRANSACTION_TYPE_LABEL[tx.transaction_type as StockTransactionType] ?? tx.transaction_type}
                      </p>
                      <p className="text-[13.5px] text-muted tnum mt-0.5">
                        {formatShares(tx.total_shares)} shares · {formatUSD(tx.price_per_share_usd)}/share · FX {tx.usd_to_sgd_rate.toFixed(4)}
                      </p>
                      <ul className="mt-2 space-y-0.5">
                        {allocs.map((a) => {
                          const member = data.children.find((c) => c.id === a.member_id);
                          return (
                            <li key={a.id} className="text-[13.5px] text-ink tnum flex items-baseline justify-between gap-3">
                              <span>{member?.short_name ?? "?"}</span>
                              <span className="text-muted">
                                {a.shares >= 0 ? "+" : ""}{formatShares(a.shares)} · {formatSGD(a.cost_sgd)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {tx.notes && <p className="mt-2 text-[13.5px] text-muted whitespace-pre-wrap">{tx.notes}</p>}
                    </div>
                    <p className="text-[15px] text-ink tnum sm:text-right">
                      {formatSGD(tx.total_sgd)}
                      <span className="block text-[13px] text-muted">{formatUSD(tx.total_usd)}</span>
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {openTx && (
        <TransactionModal
          tx={openTx}
          allocations={openAllocs}
          childList={data.children}
          onClose={() => setOpenTxId(null)}
          onSaved={async () => {
            await data.reload();
            setOpenTxId(null);
          }}
        />
      )}
    </section>
  );
}

interface ModalProps {
  tx: StockTransaction;
  allocations: StockAllocation[];
  childList: Array<{ id: string; short_name: string }>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function TransactionModal({ tx, allocations, childList, onClose, onSaved }: ModalProps) {
  const [notes, setNotes] = useState(tx.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = useMemo(() => (notes ?? "") !== (tx.notes ?? ""), [notes, tx.notes]);

  async function saveNotes() {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase
        .from("stock_transactions")
        .update({ notes: notes.trim() ? notes.trim() : null })
        .eq("id", tx.id);
      if (e) throw e;
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.rpc("delete_stock_transaction", { p_tx_id: tx.id });
      if (e) throw e;
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/30 backdrop-blur-[2px] px-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-lg bg-white rounded-lg border border-line p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <p className="text-[13px] uppercase tracking-wider text-muted mb-1">
            {format(new Date(tx.transaction_date), "EEE d LLL yyyy")}
          </p>
          <p className="text-[20px] font-semibold text-ink">
            {TRANSACTION_TYPE_LABEL[tx.transaction_type as StockTransactionType] ?? tx.transaction_type}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-muted">Shares</dt>
          <dd className="text-ink tnum text-right">{formatShares(tx.total_shares)}</dd>
          <dt className="text-muted">USD per share</dt>
          <dd className="text-ink tnum text-right">{formatUSD(tx.price_per_share_usd)}</dd>
          <dt className="text-muted">FX (USD→SGD)</dt>
          <dd className="text-ink tnum text-right">{tx.usd_to_sgd_rate.toFixed(4)}</dd>
          <dt className="text-muted">Total USD</dt>
          <dd className="text-ink tnum text-right">{formatUSD(tx.total_usd)}</dd>
          <dt className="text-muted">Total SGD</dt>
          <dd className="text-ink tnum text-right">{formatSGD(tx.total_sgd)}</dd>
        </dl>

        <div className="border border-line rounded-md overflow-hidden">
          <p className="text-[13px] uppercase tracking-wider text-muted bg-soft px-3 py-2 border-b border-line">
            Allocations
          </p>
          <ul className="divide-y divide-line">
            {allocations.map((a) => {
              const m = childList.find((c) => c.id === a.member_id);
              return (
                <li key={a.id} className="flex items-baseline justify-between px-3 py-2 text-[14px]">
                  <span className="text-ink">{m?.short_name ?? "?"}</span>
                  <span className="text-muted tnum">
                    {a.shares >= 0 ? "+" : ""}{formatShares(a.shares)} · {formatSGD(a.cost_sgd)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <label className="block">
          <span className="block text-[14px] font-medium text-ink mb-1.5">Notes</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] focus:outline-2 focus:outline-offset-0 focus:outline-primary"
          />
          <span className="block text-[13px] text-muted mt-1">
            Numbers are locked. To correct a mistake, delete this row and re-enter.
          </span>
        </label>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[14px] px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className="text-muted hover:text-danger"
          >
            Delete transaction
          </Button>
          <div className="flex gap-2 ml-auto">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button
              type="button"
              onClick={saveNotes}
              loading={busy && !confirmDelete}
              disabled={busy || !dirty}
            >
              Save notes
            </Button>
          </div>
        </div>

        {confirmDelete && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-white/85 rounded-lg p-5">
            <div className="w-full max-w-sm bg-white rounded-lg border border-line p-5 shadow-lg">
              <p className="text-[20px] font-semibold text-ink mb-2">Delete this transaction?</p>
              <p className="text-[14.5px] text-muted leading-relaxed mb-4">
                Allocations get removed too. Any bead periods or pending
                deposits linked to this purchase return to their previous
                state, so they can be re-used.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={doDelete} loading={busy}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
