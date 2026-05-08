import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Pencil, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useFinanceData } from "@/finance/use-finance-data";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { Select } from "@/components/select";
import { Modal } from "@/components/modal";
import {
  estimateOutstanding,
  formatLoanRate,
  formatTenure,
  isRefiSoon,
  type Property,
  type PropertyCategory,
} from "@/lib/properties";
import { formatSGD } from "@/lib/finance";

export default function PropertiesPage() {
  const data = useFinanceData();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);

  if (data.loading) return <LoadingScreen />;

  const today = new Date();
  const targetMonth =
    today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-01";

  return (
    <section className="mx-auto max-w-[820px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link
        to="/finance"
        className="inline-flex items-center gap-1 text-[15px] text-muted hover:text-ink"
      >
        <ChevronLeft size={14} /> Finance overview
      </Link>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[14px] uppercase tracking-wider text-muted mb-1">Finance</p>
          <h1 className="text-[30px] font-medium text-ink">Properties</h1>
          <p className="mt-2 text-[15.5px] text-muted">
            Setup info per property — purchase price, loan, tenure, interest
            rate. Monthly outstanding loan and market value are entered on
            the finance update page.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/finance/update/${targetMonth.slice(0, 7)}`}
            className="inline-flex items-center justify-center h-10 px-4 rounded-md bg-primary text-white text-[15.5px] font-medium hover:bg-primary-strong"
          >
            Update this month
          </Link>
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add property
          </Button>
        </div>
      </div>

      <ul className="space-y-3">
        {data.properties.map((p) => {
          const lastSnap = data.propertySnapshots.find((s) => s.property_id === p.id);
          const estimate = estimateOutstanding(p, targetMonth);
          const refiSoon = isRefiSoon(p.rate_end_date);
          return (
            <li
              key={p.id}
              className="bg-white border border-line rounded-lg p-5 grid sm:grid-cols-[1fr_auto] gap-3"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[18px] font-semibold text-ink">{p.name}</h2>
                  <span
                    className={[
                      "inline-flex items-center px-2 h-6 rounded-full text-[13.5px] capitalize",
                      p.category === "personal"
                        ? "bg-primary-soft text-primary"
                        : "bg-emerald-soft text-emerald",
                    ].join(" ")}
                  >
                    {p.category}
                  </span>
                  {!p.active && (
                    <span className="inline-flex items-center px-2 h-6 rounded-full text-[13.5px] bg-soft text-muted">
                      inactive
                    </span>
                  )}
                  {refiSoon && (
                    <span className="inline-flex items-center px-2 h-6 rounded-full text-[13.5px] bg-amber-soft text-amber">
                      refi due
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[14.5px]">
                  <Field label="Purchase">
                    {p.purchase_price != null ? formatSGD(p.purchase_price) : "—"}
                  </Field>
                  <Field label="Loan">
                    {p.total_loan != null ? formatSGD(p.total_loan) : "—"}
                  </Field>
                  <Field label="Tenure">{formatTenure(p.tenure_months)}</Field>
                  <Field label="Rate">{formatLoanRate(p.interest_rate)}</Field>
                  <Field label="Rate ends">{p.rate_end_date ?? "—"}</Field>
                  <Field label="Last outstanding">
                    {lastSnap
                      ? formatSGD(lastSnap.amount_outstanding_sgd)
                      : estimate != null
                        ? `${formatSGD(estimate)} (est.)`
                        : "—"}
                  </Field>
                </dl>
              </div>
              <div className="flex items-start gap-2 sm:flex-col sm:items-end">
                <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                  <Pencil size={14} /> Edit
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add property"
        size="lg"
      >
        <PropertyForm
          property={null}
          onSaved={async () => {
            setAddOpen(false);
            await data.reload();
          }}
          onCancelled={() => setAddOpen(false)}
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit property"
        size="lg"
      >
        {editing && (
          <PropertyForm
            property={editing}
            onSaved={async () => {
              setEditing(null);
              await data.reload();
            }}
            onCancelled={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-ink tnum">{children}</dd>
    </div>
  );
}

interface FormProps {
  property: Property | null;
  onSaved: () => Promise<void>;
  onCancelled: () => void;
}

function PropertyForm({ property, onSaved, onCancelled }: FormProps) {
  const isEdit = !!property;
  const [name, setName] = useState(property?.name ?? "");
  const [shortName, setShortName] = useState(property?.short_name ?? "");
  const [category, setCategory] = useState<PropertyCategory>(property?.category ?? "personal");
  const [purchasePrice, setPurchasePrice] = useState(
    property?.purchase_price != null ? String(property.purchase_price) : "",
  );
  const [purchaseDate, setPurchaseDate] = useState(property?.purchase_date ?? "");
  const [totalLoan, setTotalLoan] = useState(
    property?.total_loan != null ? String(property.total_loan) : "",
  );
  const [tenureMonths, setTenureMonths] = useState(
    property?.tenure_months != null ? String(property.tenure_months) : "",
  );
  const [interestRate, setInterestRate] = useState(
    property?.interest_rate != null ? String(property.interest_rate) : "",
  );
  const [rateEndDate, setRateEndDate] = useState(property?.rate_end_date ?? "");
  const [active, setActive] = useState(property?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !shortName.trim()) {
      setError("Name and short name are required.");
      return;
    }

    setSubmitting(true);
    try {
      const row = {
        name: name.trim(),
        short_name: shortName.trim(),
        category,
        purchase_price: parseNumOrNull(purchasePrice),
        purchase_date: purchaseDate || null,
        total_loan: parseNumOrNull(totalLoan),
        tenure_months: parseIntOrNull(tenureMonths),
        interest_rate: parseNumOrNull(interestRate),
        rate_end_date: rateEndDate || null,
        active,
      };
      if (isEdit) {
        const { error: e } = await supabase
          .from("properties")
          .update(row)
          .eq("id", property!.id);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from("properties").insert({
          ...row,
          display_order: 99,
        });
        if (e) throw e;
      }
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <TextField
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="HDB / Home"
        />
        <TextField
          label="Short name"
          required
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          placeholder="HDB"
        />
        <Select
          label="Category"
          containerClassName="max-w-xs"
          value={category}
          onChange={(e) => setCategory(e.target.value as PropertyCategory)}
        >
          <option value="personal">Personal</option>
          <option value="commercial">Commercial</option>
        </Select>
      </div>

      <h3 className="text-[14px] font-semibold uppercase tracking-wider text-muted">
        Purchase + loan
      </h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <TextField
          label="Purchase price (SGD)"
          type="number"
          step="0.01"
          value={purchasePrice}
          onChange={(e) => setPurchasePrice(e.target.value)}
        />
        <TextField
          label="Purchase date"
          type="date"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
        />
        <TextField
          label="Original loan (SGD)"
          type="number"
          step="0.01"
          value={totalLoan}
          onChange={(e) => setTotalLoan(e.target.value)}
        />
        <TextField
          label="Tenure (months)"
          type="number"
          value={tenureMonths}
          onChange={(e) => setTenureMonths(e.target.value)}
          hint="240 = 20 years, 300 = 25 years, 360 = 30 years"
        />
        <TextField
          label="Interest rate (% APR)"
          type="number"
          step="0.0001"
          value={interestRate}
          onChange={(e) => setInterestRate(e.target.value)}
        />
        <TextField
          label="Rate ends"
          type="date"
          value={rateEndDate}
          onChange={(e) => setRateEndDate(e.target.value)}
          hint="Used for the refi-due reminder."
        />
      </div>

      <label className="inline-flex items-center gap-2 text-[15.5px] text-ink cursor-pointer">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Active
      </label>

      {error && <p role="alert" className="text-danger text-[15px]">{error}</p>}

      <div className="flex justify-end gap-2 pt-3 border-t border-line">
        <Button type="button" variant="secondary" onClick={onCancelled}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {isEdit ? "Save changes" : "Add property"}
        </Button>
      </div>
    </form>
  );
}

function parseNumOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function parseIntOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}
