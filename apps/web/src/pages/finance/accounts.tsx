import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useFinanceData } from "@/finance/use-finance-data";
import type { Account, AccountType } from "@/lib/finance";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { Select } from "@/components/select";
import { Modal } from "@/components/modal";

export default function AccountsPage() {
  const data = useFinanceData();
  const [draft, setDraft] = useState<Record<string, Partial<Account>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    setDraft(Object.fromEntries(data.accounts.map((a) => [a.id, {}])));
  }, [data.accounts]);

  if (data.loading) return <LoadingScreen />;

  function patch(id: string, p: Partial<Account>) {
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? {}), ...p } }));
  }

  async function saveOne(a: Account) {
    setError(null);
    setSubmitting(true);
    try {
      const patched = draft[a.id] ?? {};
      const { error } = await supabase
        .from("accounts")
        .update({
          name:          patched.name ?? a.name,
          entity:        patched.entity ?? a.entity,
          account_type:  patched.account_type ?? a.account_type,
          display_order: patched.display_order ?? a.display_order,
          active:        patched.active ?? a.active,
        })
        .eq("id", a.id);
      if (error) throw error;
      await data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[820px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link to="/finance" className="inline-flex items-center gap-1 text-[15px] text-muted hover:text-ink">
        <ChevronLeft size={14} /> Finance overview
      </Link>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[14px] uppercase tracking-wider text-muted mb-1">Finance</p>
          <h1 className="text-[28px] font-medium text-ink">Accounts</h1>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add account
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[15px] px-4 py-3">
          {error}
        </div>
      )}

      <ul className="space-y-3">
        {data.accounts.map((a) => {
          const p = draft[a.id] ?? {};
          return (
            <li key={a.id} className="bg-white border border-line rounded-lg p-4 sm:p-5 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <TextField
                  label="Name"
                  value={p.name ?? a.name}
                  onChange={(e) => patch(a.id, { name: e.target.value })}
                />
                <TextField
                  label="Entity"
                  value={p.entity ?? a.entity}
                  onChange={(e) => patch(a.id, { entity: e.target.value })}
                />
                <Select
                  label="Type"
                  value={(p.account_type ?? a.account_type) as AccountType}
                  onChange={(e) => patch(a.id, { account_type: e.target.value as AccountType })}
                >
                  <option value="personal">Personal</option>
                  <option value="business">Business</option>
                  <option value="investment">Investment</option>
                </Select>
                <TextField
                  label="Display order"
                  type="number"
                  value={String(p.display_order ?? a.display_order)}
                  onChange={(e) => patch(a.id, { display_order: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="inline-flex items-center gap-2 text-[15.5px] text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={p.active ?? a.active}
                    onChange={(e) => patch(a.id, { active: e.target.checked })}
                  />
                  Active
                </label>
                <Button size="sm" variant="secondary" onClick={() => saveOne(a)} loading={submitting}>
                  Save
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add account">
        <AddAccountForm
          onAdded={async () => {
            setAddOpen(false);
            await data.reload();
          }}
          onCancelled={() => setAddOpen(false)}
        />
      </Modal>
    </section>
  );
}

interface AddProps {
  onAdded: () => Promise<void>;
  onCancelled: () => void;
}

function AddAccountForm({ onAdded, onCancelled }: AddProps) {
  const data = useFinanceData();
  const [name, setName] = useState("");
  const [entity, setEntity] = useState("");
  const [type, setType] = useState<AccountType>("business");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !entity.trim()) {
      setError("Both fields required");
      return;
    }
    setSubmitting(true);
    try {
      const nextOrder = (Math.max(0, ...data.accounts.map((a) => a.display_order)) || 0) + 1;
      const { error } = await supabase.from("accounts").insert({
        name: name.trim(),
        entity: entity.trim(),
        account_type: type,
        currency: "SGD",
        display_order: nextOrder,
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
      <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label="Entity" required value={entity} onChange={(e) => setEntity(e.target.value)} />
      <Select label="Type" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
        <option value="personal">Personal</option>
        <option value="business">Business</option>
        <option value="investment">Investment</option>
      </Select>
      {error && <p role="alert" className="text-danger text-[15px]">{error}</p>}
      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <Button type="button" variant="secondary" onClick={onCancelled}>Cancel</Button>
        <Button type="submit" loading={submitting}>Add</Button>
      </div>
    </form>
  );
}
