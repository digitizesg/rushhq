import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronLeft, GripVertical, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBeadData } from "@/beads/use-bead-data";
import {
  firstOfMonth,
  formatPeriodLabel,
  formatSGD,
  type BeadChart,
  type BeadChartItem,
  type BeadColour,
} from "@/lib/beads";
import { LoadingScreen } from "@/components/loading-screen";
import { BeadDot } from "@/components/bead-dot";
import { Button } from "@/components/button";

interface DraftItem {
  id: string;            // either real uuid or "new-..."
  bead_colour_id: string;
  description: string;
  display_order: number;
  isNew?: boolean;
  toDelete?: boolean;
}

function nextNewId() {
  return `new-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ChartEditPage() {
  const { childId = "" } = useParams<{ childId: string }>();
  const data = useBeadData();
  const today = useMemo(() => new Date(), []);
  const nextMonthFirst = useMemo(() => {
    const d = new Date(today);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return firstOfMonth(d);
  }, [today]);

  const child = data.children.find((c) => c.id === childId);
  const activeChart = data.charts.find(
    (c) => c.member_id === childId && c.effective_until === null,
  );
  const pastCharts = data.charts.filter(
    (c) => c.member_id === childId && c.effective_until !== null,
  );

  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "cloning">("idle");
  const [pastOpen, setPastOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeChart) return;
    const items = data.items
      .filter((i) => i.chart_id === activeChart.id)
      .sort((a, b) => a.display_order - b.display_order);
    setDraft(
      items.map((i) => ({
        id: i.id,
        bead_colour_id: i.bead_colour_id,
        description: i.description,
        display_order: i.display_order,
      })),
    );
  }, [activeChart?.id, data.items]);

  if (data.loading) return <LoadingScreen />;
  if (!child) return <Navigate to="/beads" replace />;

  function patch(id: string, patch: Partial<DraftItem>) {
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function remove(id: string) {
    setDraft((rows) =>
      rows
        .map((r) => (r.id === id ? { ...r, toDelete: true } : r))
        .filter((r) => !(r.isNew && r.toDelete)),
    );
  }
  function addItem() {
    setDraft((rows) => {
      const order = rows.length > 0 ? Math.max(...rows.map((r) => r.display_order)) + 1 : 1;
      return [
        ...rows,
        {
          id: nextNewId(),
          bead_colour_id: "yellow",
          description: "",
          display_order: order,
          isNew: true,
        },
      ];
    });
  }

  function move(id: string, direction: -1 | 1) {
    setDraft((rows) => {
      const visible = rows.filter((r) => !r.toDelete);
      const idx = visible.findIndex((r) => r.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= visible.length) return rows;
      const reordered = [...visible];
      [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
      // Reapply linear display_order, then merge with the deleted rows.
      const renumbered = reordered.map((r, i) => ({ ...r, display_order: i + 1 }));
      const deletedRows = rows.filter((r) => r.toDelete);
      return [...renumbered, ...deletedRows];
    });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeChart) return;
    setError(null);
    setSavingState("saving");

    try {
      const live = draft.filter((r) => !r.toDelete);
      if (live.some((r) => !r.description.trim())) {
        throw new Error("Every item needs a description");
      }
      const numbered = live.map((r, idx) => ({ ...r, display_order: idx + 1 }));
      const inserts = numbered.filter((r) => r.isNew);
      const updates = numbered.filter((r) => !r.isNew);
      const deletes = draft.filter((r) => r.toDelete && !r.isNew);

      if (deletes.length > 0) {
        const { error } = await supabase
          .from("bead_chart_items")
          .delete()
          .in("id", deletes.map((d) => d.id));
        if (error) throw error;
      }
      for (const u of updates) {
        const { error } = await supabase
          .from("bead_chart_items")
          .update({
            bead_colour_id: u.bead_colour_id,
            description: u.description.trim(),
            display_order: u.display_order,
          })
          .eq("id", u.id);
        if (error) throw error;
      }
      if (inserts.length > 0) {
        const { error } = await supabase
          .from("bead_chart_items")
          .insert(
            inserts.map((i) => ({
              chart_id: activeChart.id,
              bead_colour_id: i.bead_colour_id,
              description: i.description.trim(),
              display_order: i.display_order,
            })),
          );
        if (error) throw error;
      }
      await data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingState("idle");
    }
  }

  async function handleClone() {
    setError(null);
    setSavingState("cloning");
    try {
      const { error } = await supabase.rpc("clone_bead_chart", {
        p_child_id: childId,
        p_effective_from: nextMonthFirst,
      });
      if (error) throw error;
      await data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingState("idle");
    }
  }

  const visibleDraft = draft.filter((r) => !r.toDelete).sort((a, b) => a.display_order - b.display_order);

  return (
    <section className="mx-auto max-w-[820px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          to="/beads"
          className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"
        >
          <ChevronLeft size={14} /> All children
        </Link>
        <Button
          variant="secondary"
          loading={savingState === "cloning"}
          disabled={savingState !== "idle"}
          onClick={handleClone}
        >
          Clone for {formatPeriodLabel(nextMonthFirst)}
        </Button>
      </div>

      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">
          {child.short_name}'s chart
        </p>
        <h1 className="text-[26px] font-medium text-ink">
          {activeChart
            ? formatPeriodLabel(activeChart.effective_from)
            : "No active chart"}
        </h1>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[13px] px-4 py-3">
          {error}
        </div>
      )}

      {!activeChart ? (
        <div className="bg-white border border-line rounded-lg p-6 text-[14px] text-muted">
          No active chart. Use "Clone for next month" once a previous chart exists,
          or contact your admin.
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="bg-white border border-line rounded-lg overflow-hidden">
            <header className="flex items-center justify-between px-4 sm:px-5 py-3 bg-soft border-b border-line">
              <span className="text-[14px] font-semibold text-ink">
                Tasks ({visibleDraft.length})
              </span>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
              >
                <Plus size={13} /> Add task
              </button>
            </header>
            {visibleDraft.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted text-center">
                No tasks yet. Add one above.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {visibleDraft.map((item, idx) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    colours={data.colours}
                    onPatch={patch}
                    onRemove={remove}
                    onMoveUp={idx > 0 ? () => move(item.id, -1) : undefined}
                    onMoveDown={idx < visibleDraft.length - 1 ? () => move(item.id, 1) : undefined}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Button
              type="submit"
              loading={savingState === "saving"}
              disabled={savingState !== "idle"}
            >
              Save changes
            </Button>
          </div>
        </form>
      )}

      {pastCharts.length > 0 && (
        <div className="bg-white border border-line rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setPastOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-soft transition-colors"
          >
            <span className="text-[14.5px] font-medium text-ink">
              Past charts
            </span>
            <span className="text-[12.5px] text-muted">
              {pastCharts.length} {pastCharts.length === 1 ? "chart" : "charts"}{" "}
              · {pastOpen ? "hide" : "show"}
            </span>
          </button>
          {pastOpen && (
            <ul className="divide-y divide-line">
              {pastCharts.map((c) => (
                <PastChartRow
                  key={c.id}
                  chart={c}
                  items={data.items.filter((i) => i.chart_id === c.id)}
                  colours={data.colours}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

interface ItemRowProps {
  item: DraftItem;
  colours: BeadColour[];
  onPatch: (id: string, patch: Partial<DraftItem>) => void;
  onRemove: (id: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function ItemRow({ item, colours, onPatch, onRemove, onMoveUp, onMoveDown }: ItemRowProps) {
  const colour = colours.find((c) => c.id === item.bead_colour_id) ?? colours[0];
  return (
    <li className="px-3 sm:px-5 py-3 grid gap-2 grid-cols-[auto_1fr_auto_auto] sm:grid-cols-[auto_1fr_auto_auto_auto] sm:items-center">
      <span className="hidden sm:flex flex-col text-muted -ml-1" aria-hidden>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!onMoveUp}
          aria-label="Move up"
          className="size-5 grid place-items-center rounded hover:bg-soft disabled:opacity-30"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 6l3-3 3 3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!onMoveDown}
          aria-label="Move down"
          className="size-5 grid place-items-center rounded hover:bg-soft disabled:opacity-30"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>
        </button>
      </span>
      <span className="sm:hidden text-muted" aria-hidden>
        <GripVertical size={14} />
      </span>
      <input
        type="text"
        required
        value={item.description}
        onChange={(e) => onPatch(item.id, { description: e.target.value })}
        placeholder="Task description"
        className="w-full h-9 rounded-md border border-line bg-white px-3 text-[14px] focus:outline-2 focus:outline-offset-0 focus:outline-primary"
      />
      <select
        value={item.bead_colour_id}
        onChange={(e) => onPatch(item.id, { bead_colour_id: e.target.value })}
        aria-label="Bead colour"
        className="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] focus:outline-2 focus:outline-offset-0 focus:outline-primary"
      >
        {colours.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {formatSGD(Number(c.sgd_value))}
          </option>
        ))}
      </select>
      <BeadDot
        hex={colour?.hex ?? "#cccccc"}
        sparkly={colour?.id === "sparkly_pink"}
        size={20}
        className="hidden sm:inline-block"
      />
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label="Remove task"
        className="size-9 grid place-items-center text-muted hover:text-danger rounded-md hover:bg-soft"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

interface PastChartRowProps {
  chart: BeadChart;
  items: BeadChartItem[];
  colours: BeadColour[];
}

function PastChartRow({ chart, items, colours }: PastChartRowProps) {
  const [open, setOpen] = useState(false);
  const sorted = [...items].sort((a, b) => a.display_order - b.display_order);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-soft transition-colors"
      >
        <span className="text-[13.5px] text-ink tnum">
          {formatPeriodLabel(chart.effective_from)}
          {chart.effective_until && (
            <span className="text-muted"> · ended {chart.effective_until}</span>
          )}
        </span>
        <span className="text-[12.5px] text-muted">
          {items.length} {items.length === 1 ? "task" : "tasks"}
        </span>
      </button>
      {open && (
        <ul className="px-5 pb-3 space-y-1.5">
          {sorted.map((item) => {
            const colour = colours.find((c) => c.id === item.bead_colour_id);
            return (
              <li key={item.id} className="flex items-center gap-2 text-[13px] text-ink">
                <BeadDot
                  hex={colour?.hex ?? "#ccc"}
                  sparkly={colour?.id === "sparkly_pink"}
                  size={12}
                />
                <span className="flex-1">{item.description}</span>
                <span className="text-muted text-[12px] tnum">
                  {colour ? formatSGD(Number(colour.sgd_value)) : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
