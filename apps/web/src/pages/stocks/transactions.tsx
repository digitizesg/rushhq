import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { useStocksData } from "@/stocks/use-stocks-data";
import {
  formatSGD,
  formatShares,
  formatUSD,
  TRANSACTION_TYPE_LABEL,
  type StockTransactionType,
} from "@/lib/stocks";
import { LoadingScreen } from "@/components/loading-screen";

export default function TransactionsPage() {
  const data = useStocksData();
  if (data.loading) return <LoadingScreen />;

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/stocks" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Stocks overview
      </Link>

      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">Stocks</p>
        <h1 className="text-[26px] font-medium text-ink">All transactions</h1>
      </div>

      {data.transactions.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-6 text-[14px] text-muted">
          No transactions yet.
        </div>
      ) : (
        <div className="bg-white border border-line rounded-lg overflow-hidden">
          <ul className="divide-y divide-line">
            {data.transactions.map((tx) => {
              const allocs = data.allocations.filter((a) => a.transaction_id === tx.id);
              return (
                <li key={tx.id} className="px-5 py-4 grid sm:grid-cols-[120px_1fr_auto] gap-3 sm:gap-5 items-start">
                  <p className="text-[13px] text-muted tnum">{format(new Date(tx.transaction_date), "EEE d LLL yyyy")}</p>
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-medium text-ink">
                      {TRANSACTION_TYPE_LABEL[tx.transaction_type as StockTransactionType] ?? tx.transaction_type}
                    </p>
                    <p className="text-[12.5px] text-muted tnum mt-0.5">
                      {formatShares(tx.total_shares)} shares · {formatUSD(tx.price_per_share_usd)}/share · FX {tx.usd_to_sgd_rate.toFixed(4)}
                    </p>
                    <ul className="mt-2 space-y-0.5">
                      {allocs.map((a) => {
                        const member = data.children.find((c) => c.id === a.member_id);
                        return (
                          <li key={a.id} className="text-[12.5px] text-ink tnum flex items-baseline justify-between gap-3">
                            <span>{member?.short_name ?? "?"}</span>
                            <span className="text-muted">
                              {a.shares >= 0 ? "+" : ""}{formatShares(a.shares)} · {formatSGD(a.cost_sgd)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {tx.notes && <p className="mt-2 text-[12.5px] text-muted whitespace-pre-wrap">{tx.notes}</p>}
                  </div>
                  <p className="text-[14px] text-ink tnum sm:text-right">
                    {formatSGD(tx.total_sgd)}
                    <span className="block text-[12px] text-muted">{formatUSD(tx.total_usd)}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
