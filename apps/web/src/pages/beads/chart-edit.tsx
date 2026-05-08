import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronLeft, GripVertical, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useBeadData } from "@/beads/use-bead-data";
import {
  firstOfMonth,
  formatPeriodLabel,
  formatSGD,
  type BeadCategory,
  type BeadChart,
  type BeadChartItem,
  type BeadColour,
} from "@/lib/beads";
import { LoadingScreen } from "@/components/loading-screen";
import { BeadDot } from "@/components/bead-dot";
import { CategoryIcon } from "@/components/category-icon";
import { Button } from "@/components/button";

interface DraftItem {
  id: string;            // either real uuid or "new-..."
  category_id: string;
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

  // Initialise the draft from the active chart's items whenever the
  // server data arrives.
  useEffect(() => {
    if (!activeChart) return;
    const items = data.items
      .filter((i) => i.chart_id === activeChart.id)
      .sort((a, b) => a.display_order - b.display_order);
    setDraft(
      items.map((i) => ({
        id: i.id,
        category_id: i.category_id,
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
        // Newly added rows that haven't been persisted can be dropped outright.
        .filter((r) => !(r.isNew && r.toDelete)),
    );
  }
  function addItem(categoryId: string) {
    setDraft((rows) => {
      const sameCat = rows.filter((r) => r.category_id === categoryId);
      const order = sameCat.length > 0
        ? Math.max(...rows.map((r) => r.display_order)) + 1
        : rows.length + 1;
      return [
        ...rows,
        {
          id: nextNewId(),
          category_id: categoryId,
          bead_colour_id: "yellow",
          description: "",
          display_order: order,
          isNew: true,
        },
      ];
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

      // Re-number display_order linearly so adds/removes don't leave gaps.
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
            category_id: u.category_id,
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
              category_id: i.category_id,
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
        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-5">
            {data.categories.map((cat) => (
              <CategoryBlock
                key={cat.id}
                category={cat}
                items={draft.filter((d) => d.category_id === cat.id && !d.toDelete)}
                colours={data.colours}
                allCategories={data.categories}
                onPatch={patch}
                onRemove={remove}
                onAdd={() => addItem(cat.id)}
              />
            ))}
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
                  categories={data.categories}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

interface CategoryBlockProps {
  category: BeadCategory;
  items: DraftItem[];
  colours: BeadColour[];
  allCategories: BeadCategory[];
  onPatch: (id: string, patch: Partial<DraftItem>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

function CategoryBlock({
  category,
  items,
  colours,
  allCategories,
  onPatch,
  onRemove,
  onAdd,
}: CategoryBlockProps) {
  return (
    <fieldset className="bg-white border border-line rounded-lg overflow-hidden">
      <legend className="sr-only">{category.name}</legend>
      <header className="flex items-center justify-between px-5 py-3 bg-soft border-b border-line">
        <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-ink">
          <CategoryIcon name={category.icon} size={16} className="text-muted" />
          {category.name}
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
        >
          <Plus size={13} /> Add task
        </button>
      </header>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">No tasks yet. Add one above.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              colours={colours}
              categories={allCategories}
              onPatch={onPatch}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </fieldset>
  );
}

interface ItemRowProps {
  item: DraftItem;
  colours: BeadColour[];
  categories: BeadCategory[];
  onPatch: (id: string, patch: Partial<DraftItem>) => void;
  onRemove: (id: string) => void;
}

function ItemRow({ item, colours, categories, onPatch, onRemove }: ItemRowProps) {
  const colour = colours.find((c) => c.id === item.bead_colour_id) ?? colours[0];
  return (
    <li className="px-3 sm:px-5 py-3 grid gap-2.5 sm:grid-cols-[auto_1fr_auto_auto_auto] sm:items-center">
      <span className="hidden sm:inline-flex text-muted" aria-hidden>
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
            {c.name} · {formatSGD(c.sgd_value)}
          </option>
        ))}
      </select>
      <BeadDot
        hex={colour?.hex ?? "#cccccc"}
        sparkly={colour?.id === "sparkly_pink"}
        size={20}
        className="hidden sm:inline-block"
      />
      <select
        value={item.category_id}
        onChange={(e) => onPatch(item.id, { category_id: e.target.value })}
        aria-label="Category"
        className="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] focus:outline-2 focus:outline-offset-0 focus:outline-primary sm:hidden"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
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
  categories: BeadCategory[];
}

function PastChartRow({ chart, items, colours, categories }: PastChartRowProps) {
  const [open, setOpen] = useState(false);
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
            <span className="text-muted">
              {" "}
              · ended {chart.effective_until}
            </span>
          )}
        </span>
        <span className="text-[12.5px] text-muted">
          {items.length} {items.length === 1 ? "task" : "tasks"}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-3 space-y-1.5">
          {categories.map((cat) => {
            const catItems = items
              .filter((i) => i.category_id === cat.id)
              .sort((a, b) => a.display_order - b.display_order);
            if (catItems.length === 0) return null;
            return (
              <div key={cat.id} className="pt-1">
                <p className="text-[11.5px] uppercase tracking-wider text-muted mb-1 inline-flex items-center gap-1.5">
                  <CategoryIcon name={cat.icon} size={12} />
                  {cat.name}
                </p>
                <ul className="space-y-1">
                  {catItems.map((item) => {
                    const colour = colours.find((c) => c.id === item.bead_colour_id);
                    return (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 text-[13px] text-ink"
                      >
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
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}

