import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronLeft, Lock, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import {
  firstOfMonth,
  formatPeriodLabel,
  formatSGD,
  totalFor,
  type BeadColour,
  type BeadPeriod,
  type BeadPeriodStatus,
} from "@/lib/beads";
import type { FamilyMember } from "@/lib/types";
import { LoadingScreen } from "@/components/loading-screen";
import { BeadDot } from "@/components/bead-dot";
import { Button } from "@/components/button";

interface PageState {
  loading: boolean;
  error: string | null;
  child: FamilyMember | null;
  period: BeadPeriod | null;
  counts: Record<string, number>;     // bead_colour_id -> count
  notes: string;
  colours: BeadColour[];
  members: FamilyMember[];
}

export default function CountPage() {
  const { childId = "" } = useParams<{ childId: string }>();
  const periodStart = useMemo(() => firstOfMonth(new Date()), []);

  const [state, setState] = useState<PageState>({
    loading: true,
    error: null,
    child: null,
    period: null,
    counts: {},
    notes: "",
    colours: [],
    members: [],
  });
  const [submitting, setSubmitting] = useState<"none" | "save" | "lock" | "reopen">(
    "none",
  );
  const [confirmingLock, setConfirmingLock] = useState(false);

  // Initial data fetch + period bootstrap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [coloursRes, childRes, membersRes] = await Promise.all([
          supabase.from("bead_colours").select("*").order("display_order"),
          supabase.from("family_members").select("*").eq("id", childId).maybeSingle(),
          supabase.from("family_members").select("*"),
        ]);
        if (coloursRes.error) throw coloursRes.error;
        if (childRes.error) throw childRes.error;
        if (membersRes.error) throw membersRes.error;
        if (!childRes.data) throw new Error("Child not found");

        // ensure_bead_period is idempotent — gets or creates.
        const { data: periodId, error: ensureErr } = await supabase.rpc(
          "ensure_bead_period",
          { p_child_id: childId, p_period_start: periodStart },
        );
        if (ensureErr) throw ensureErr;

        const [periodRes, countsRes] = await Promise.all([
          supabase.from("bead_periods").select("*").eq("id", periodId).maybeSingle(),
          supabase.from("bead_counts").select("*").eq("period_id", periodId),
        ]);
        if (periodRes.error) throw periodRes.error;
        if (countsRes.error) throw countsRes.error;

        const countsMap: Record<string, number> = {};
        for (const row of (countsRes.data ?? []) as Array<{ bead_colour_id: string; count: number }>) {
          countsMap[row.bead_colour_id] = row.count;
        }

        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          child: (childRes.data as FamilyMember) ?? null,
          period: (periodRes.data as BeadPeriod) ?? null,
          counts: countsMap,
          notes: (periodRes.data as BeadPeriod)?.notes ?? "",
          colours: (coloursRes.data as BeadColour[]) ?? [],
          members: (membersRes.data as FamilyMember[]) ?? [],
        });
      } catch (e) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childId, periodStart]);

  if (state.loading) return <LoadingScreen />;
  if (!state.child) return <Navigate to="/beads" replace />;

  const total = totalFor(state.counts, state.colours);
  const status: BeadPeriodStatus = state.period?.status ?? "open";
  const editable = status === "open";

  const lockedByMember =
    state.period?.locked_by != null
      ? state.members.find((m) => m.id === state.period?.locked_by)
      : undefined;

  function setCount(colourId: string, raw: string) {
    const n = Math.max(0, Math.floor(parseInt(raw, 10) || 0));
    setState((s) => ({ ...s, counts: { ...s.counts, [colourId]: n } }));
  }

  async function persistCounts(): Promise<void> {
    if (!state.period) return;
    const periodId = state.period.id;

    // Upsert one row per colour, even when count is zero — that lets
    // us reset values cleanly between sessions.
    const rows = state.colours.map((c) => ({
      period_id: periodId,
      bead_colour_id: c.id,
      count: state.counts[c.id] ?? 0,
    }));
    const { error } = await supabase
      .from("bead_counts")
      .upsert(rows, { onConflict: "period_id,bead_colour_id" });
    if (error) throw error;

    if ((state.notes ?? "") !== (state.period.notes ?? "")) {
      const { error: notesErr } = await supabase
        .from("bead_periods")
        .update({ notes: state.notes.trim() || null })
        .eq("id", periodId);
      if (notesErr) throw notesErr;
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSubmitting("save");
    setState((s) => ({ ...s, error: null }));
    try {
      await persistCounts();
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
    } finally {
      setSubmitting("none");
    }
  }

  async function handleLock() {
    if (!state.period) return;
    setSubmitting("lock");
    setState((s) => ({ ...s, error: null }));
    try {
      await persistCounts();
      const { error } = await supabase.rpc("lock_bead_period", {
        p_period_id: state.period.id,
      });
      if (error) throw error;
      // Refresh period to reflect new status.
      const { data: refreshed } = await supabase
        .from("bead_periods")
        .select("*")
        .eq("id", state.period.id)
        .maybeSingle();
      setState((s) => ({ ...s, period: (refreshed as BeadPeriod) ?? s.period }));
      setConfirmingLock(false);
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
    } finally {
      setSubmitting("none");
    }
  }

  async function handleReopen() {
    if (!state.period) return;
    setSubmitting("reopen");
    setState((s) => ({ ...s, error: null }));
    try {
      const { error } = await supabase.rpc("reopen_bead_period", {
        p_period_id: state.period.id,
      });
      if (error) throw error;
      const { data: refreshed } = await supabase
        .from("bead_periods")
        .select("*")
        .eq("id", state.period.id)
        .maybeSingle();
      setState((s) => ({ ...s, period: (refreshed as BeadPeriod) ?? s.period }));
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
    } finally {
      setSubmitting("none");
    }
  }

  return (
    <section className="mx-auto max-w-[640px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <Link
        to="/beads"
        className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink"
      >
        <ChevronLeft size={14} /> All children
      </Link>

      <div>
        <p className="text-[13px] uppercase tracking-wider text-muted mb-1">
          Counting beads
        </p>
        <h1 className="text-[28px] font-medium text-ink">
          {state.child.short_name} · {formatPeriodLabel(periodStart)}
        </h1>
      </div>

      {state.error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[14px] px-4 py-3">
          {state.error}
        </div>
      )}

      {!editable && (
        <div className="rounded-md border border-line bg-soft p-4 text-[14.5px] text-ink">
          {status === "counted" ? (
            <>
              Locked
              {state.period?.locked_at && (
                <span className="text-muted">
                  {" "}
                  on {format(new Date(state.period.locked_at), "EEE d LLL yyyy 'at' HH:mm")}
                </span>
              )}
              {lockedByMember && (
                <span className="text-muted"> by {lockedByMember.short_name}</span>
              )}
              .
            </>
          ) : (
            <>
              Invested
              {state.period?.invested_at && (
                <span className="text-muted">
                  {" "}
                  on {format(new Date(state.period.invested_at), "EEE d LLL yyyy")}
                </span>
              )}
              .
            </>
          )}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div className="bg-white border border-line rounded-lg overflow-hidden">
          <ul className="divide-y divide-line">
            {state.colours.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 sm:gap-4 px-4 py-3"
              >
                <BeadDot
                  hex={c.hex}
                  sparkly={c.id === "sparkly_pink"}
                  size={26}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[15.5px] font-medium text-ink">{c.name}</p>
                  <p className="text-[13.5px] text-muted tnum">
                    {formatSGD(Number(c.sgd_value))} each
                  </p>
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  disabled={!editable}
                  value={state.counts[c.id] ?? 0}
                  onChange={(e) => setCount(c.id, e.target.value)}
                  aria-label={`${c.name} count`}
                  className="w-24 h-12 rounded-md border border-line bg-white px-3 text-[22px] font-medium text-ink tnum text-right focus:outline-2 focus:outline-offset-0 focus:outline-primary disabled:opacity-60"
                />
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between bg-soft px-4 py-3 border-t border-line">
            <p className="text-[14px] uppercase tracking-wider text-muted">
              Total
            </p>
            <p className="text-[26px] font-semibold text-ink tnum">
              {formatSGD(total)}
            </p>
          </div>
        </div>

        <label className="block">
          <span className="block text-[14px] font-medium text-ink mb-1.5">
            Notes (optional)
          </span>
          <textarea
            value={state.notes}
            disabled={!editable}
            onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
            rows={2}
            placeholder="Anything worth remembering about this month's counting"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] text-ink focus:outline-2 focus:outline-offset-0 focus:outline-primary disabled:opacity-60"
          />
        </label>

        {editable && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-2">
            <Button
              type="submit"
              variant="secondary"
              loading={submitting === "save"}
              disabled={submitting !== "none"}
            >
              Save and continue
            </Button>
            <Button
              type="button"
              loading={submitting === "lock"}
              disabled={submitting !== "none"}
              onClick={() => setConfirmingLock(true)}
              className="sm:ml-auto"
            >
              <Lock size={14} /> Lock and ready for investment
            </Button>
          </div>
        )}

        {!editable && status === "counted" && (
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="secondary"
              loading={submitting === "reopen"}
              disabled={submitting !== "none"}
              onClick={handleReopen}
            >
              <RotateCcw size={14} /> Reopen for editing
            </Button>
          </div>
        )}
      </form>

      {confirmingLock && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/30 backdrop-blur-[2px] px-4"
          onClick={(e) => e.target === e.currentTarget && setConfirmingLock(false)}
        >
          <div className="w-full max-w-sm bg-white rounded-lg border border-line p-5">
            <p className="text-[20px] font-semibold text-ink mb-2">Lock this period?</p>
            <p className="text-[14.5px] text-muted leading-relaxed mb-4">
              This locks {state.child.short_name}'s beads for {formatPeriodLabel(periodStart)} at{" "}
              <span className="text-ink font-medium tnum">{formatSGD(total)}</span>.
              You can reopen later if needed, but once invested it can't be edited.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmingLock(false)}
                disabled={submitting !== "none"}
              >
                Cancel
              </Button>
              <Button onClick={handleLock} loading={submitting === "lock"}>
                Lock
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
