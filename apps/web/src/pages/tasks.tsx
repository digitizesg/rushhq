import { useState } from "react";
import { Check, Clock, ListTodo, MoonStar, Pencil, Plus, Repeat } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { useTasksData } from "@/tasks/use-tasks-data";
import { LoadingScreen } from "@/components/loading-screen";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TaskForm } from "@/tasks/task-form";
import { supabase } from "@/lib/supabase";
import {
  dueLabel,
  formatDueTime,
  isOverdue,
  nextOccurrenceFor,
  type TaskRow,
} from "@/lib/tasks";
import { colourFor } from "@/lib/colours";
import { Avatar } from "@/components/avatar";
import type { FamilyMember } from "@/lib/types";

interface FormState {
  open: boolean;
  task: TaskRow | null;
  defaultAssigneeId?: string;
}

export default function TasksPage() {
  const { member, isParent } = useAuth();
  const data = useTasksData();
  const [form, setForm] = useState<FormState>({ open: false, task: null });
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  if (data.loading) return <LoadingScreen />;

  const canEdit = isParent();
  // Parents see all family tasks; helpers + children see only their own.
  const visibleTasks = canEdit
    ? data.tasks
    : data.tasks.filter((t) => member?.id && t.assignee_ids.includes(member.id));

  const pending = visibleTasks.filter((t) => t.status === "pending");
  const done = visibleTasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, 10);

  const assignableMembers = data.members.filter((m) => m.active);

  // Filter chip state: which member's tasks to show. "all" = unfiltered.
  const [filterMemberId, setFilterMemberId] = useState<string>("all");

  // Members with at least one pending task — drive the filter chip row.
  const membersWithTasks = assignableMembers.filter((m) =>
    pending.some((t) => t.assignee_ids.includes(m.id)),
  );

  const filteredPending = pending
    .filter((t) =>
      filterMemberId === "all" ? true : t.assignee_ids.includes(filterMemberId),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  async function completeTask(t: TaskRow) {
    setBusyTaskId(t.id);
    try {
      const nextDate =
        t.rrule ? nextOccurrenceFor(t.rrule, t.due_date) : null;
      const { error } = await supabase.rpc("complete_task", {
        p_task_id: t.id,
        p_next_due_date: nextDate,
      });
      if (error) throw error;
      await data.reload();
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    } finally {
      setBusyTaskId(null);
    }
  }

  async function snoozeTask(t: TaskRow, days: number) {
    setBusyTaskId(t.id);
    try {
      const { error } = await supabase.rpc("snooze_task", {
        p_task_id: t.id,
        p_days: days,
      });
      if (error) throw error;
      await data.reload();
    } catch (e) {
      console.error(e);
      alert((e as Error).message);
    } finally {
      setBusyTaskId(null);
    }
  }

  function openCreate(memberId?: string) {
    if (!canEdit) return;
    setForm({ open: true, task: null, defaultAssigneeId: memberId });
  }
  function openEdit(t: TaskRow) {
    if (!canEdit) return;
    setForm({ open: true, task: t });
  }
  function closeForm() {
    setForm({ open: false, task: null });
  }

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[14px] uppercase tracking-wider text-muted mb-1">Tasks</p>
          <h1 className="text-[30px] font-medium text-ink">
            {canEdit ? "Family tasks" : "Your tasks"}
          </h1>
          <p className="mt-2 text-[15.5px] text-muted">
            Tap a task to mark it done. Recurring tasks roll forward to the next
            occurrence automatically.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => openCreate()}>
            <Plus size={16} /> Add task
          </Button>
        )}
      </div>

      {data.error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[15px] px-4 py-3">
          {data.error}
        </div>
      )}

      {pending.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-10 text-center space-y-3">
          <ListTodo size={32} className="mx-auto text-muted" />
          <p className="text-[17px] text-ink">Nothing on the list. Nice.</p>
          {canEdit && (
            <Button variant="secondary" onClick={() => openCreate()}>
              <Plus size={14} /> Add a task
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {canEdit && membersWithTasks.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <FilterChip
                label="Everyone"
                count={pending.length}
                selected={filterMemberId === "all"}
                onClick={() => setFilterMemberId("all")}
              />
              {membersWithTasks.map((m) => {
                const c = colourFor(m.id, m.short_name);
                const count = pending.filter((t) => t.assignee_ids.includes(m.id)).length;
                return (
                  <FilterChip
                    key={m.id}
                    label={m.short_name}
                    count={count}
                    avatar={
                      <Avatar
                        size={20}
                        name={m.short_name}
                        url={m.avatar_url}
                        accent={c.accent}
                        text="#ffffff"
                        alt=""
                      />
                    }
                    selected={filterMemberId === m.id}
                    onClick={() => setFilterMemberId(m.id)}
                    selectedStyle={{
                      backgroundColor: c.soft,
                      borderColor: c.accent,
                      color: c.text,
                    }}
                  />
                );
              })}
            </div>
          )}

          <ul className="bg-white border border-line rounded-lg divide-y divide-line overflow-hidden">
            {filteredPending.map((t) => (
              <TaskListItem
                key={t.id}
                task={t}
                members={data.members}
                onComplete={() => completeTask(t)}
                onSnooze={(days) => snoozeTask(t, days)}
                onEdit={() => openEdit(t)}
                busy={busyTaskId === t.id}
                canEdit={canEdit}
              />
            ))}
            {filteredPending.length === 0 && (
              <li className="px-5 py-6 text-center text-[15px] text-muted">
                No tasks for that filter.
              </li>
            )}
          </ul>
        </div>
      )}

      {done.length > 0 && (
        <details className="bg-white border border-line rounded-lg">
          <summary className="cursor-pointer list-none px-5 py-3 text-[15.5px] text-muted hover:text-ink flex items-center gap-2">
            <Check size={14} /> Recently completed ({done.length})
          </summary>
          <ul className="divide-y divide-line">
            {done.map((t) => {
              const names = t.assignee_ids
                .map((id) => data.members.find((x) => x.id === id)?.short_name)
                .filter(Boolean)
                .join(", ");
              return (
                <li key={t.id} className="px-5 py-2.5 flex items-center gap-3 text-[15.5px]">
                  <Check size={14} className="text-emerald shrink-0" />
                  <span className="text-ink line-through">{t.title}</span>
                  <span className="text-muted text-[14px] ml-auto">
                    {names || "—"} · {t.completed_at ? formatRelativeDate(t.completed_at) : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {canEdit && (
        <Modal
          open={form.open}
          onClose={closeForm}
          title={form.task ? "Edit task" : "New task"}
          size="lg"
        >
          <TaskForm
            members={assignableMembers}
            task={form.task}
            defaultAssigneeId={form.defaultAssigneeId}
            reminders={data.reminders.filter((r) => r.task_id === form.task?.id)}
            onSaved={async () => {
              closeForm();
              await data.reload();
            }}
            onCancelled={closeForm}
            onDeleted={async () => {
              closeForm();
              await data.reload();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function FilterChip({
  label,
  count,
  avatar,
  selected,
  onClick,
  selectedStyle,
}: {
  label: string;
  count: number;
  avatar?: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  selectedStyle?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 h-9 pl-1.5 pr-3 rounded-full border text-[14.5px] transition-colors",
        selected
          ? "font-medium"
          : "bg-white text-ink border-line hover:bg-soft",
      ].join(" ")}
      style={selected ? selectedStyle : undefined}
    >
      {avatar ?? <span className="size-5" />}
      {label}
      <span className="text-[12.5px] opacity-70 tnum">{count}</span>
    </button>
  );
}

function TaskListItem({
  task,
  members,
  onComplete,
  onSnooze,
  onEdit,
  busy,
  canEdit,
}: {
  task: TaskRow;
  members: FamilyMember[];
  onComplete: () => void;
  onSnooze: (days: number) => void;
  onEdit: () => void;
  busy: boolean;
  canEdit: boolean;
}) {
  const overdue = isOverdue(task);
  const due = dueLabel(task);
  const time = formatDueTime(task.due_time);
  const assignees = task.assignee_ids
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is FamilyMember => !!m);
  // Pick a tint for the complete-circle: single assignee → their colour;
  // multi → neutral primary.
  const accent = assignees.length === 1
    ? colourFor(assignees[0].id, assignees[0].short_name).accent
    : "#2563eb";
  return (
    <li className="px-3 sm:px-5 py-3 flex items-start gap-2 sm:gap-3">
      <button
        type="button"
        onClick={onComplete}
        disabled={busy}
        aria-label="Mark done"
        className="mt-0.5 size-9 sm:size-7 shrink-0 grid place-items-center rounded-full border-2 hover:bg-soft active:bg-soft disabled:opacity-50 transition-colors"
        style={{ borderColor: accent }}
      >
        <Check size={15} className="opacity-25" style={{ color: accent }} />
      </button>

      {/* Avatar stack of all assignees */}
      {assignees.length > 0 && (
        <div className="flex items-center -space-x-1.5 shrink-0 mt-0.5">
          {assignees.map((m) => {
            const c = colourFor(m.id, m.short_name);
            return (
              <Avatar
                key={m.id}
                size={28}
                name={m.short_name}
                url={m.avatar_url}
                accent={c.accent}
                text="#ffffff"
                alt={m.short_name}
                className="ring-2 ring-white"
              />
            );
          })}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-[16.5px] font-medium text-ink break-words">{task.title}</p>
        {task.description && (
          <p className="text-[14.5px] text-muted truncate">{task.description}</p>
        )}
        <p className="text-[14px] mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          <span
            className={[
              "inline-flex items-center gap-1",
              overdue ? "text-danger font-medium" : "text-muted",
            ].join(" ")}
          >
            <Clock size={12} /> {due}
            {time && ` · ${time}`}
          </span>
          {task.rrule && (
            <span className="inline-flex items-center gap-1 text-muted">
              <Repeat size={12} /> repeats
            </span>
          )}
          {assignees.length > 1 && (
            <span className="text-muted">
              {assignees.map((a) => a.short_name).join(", ")}
            </span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => onSnooze(1)}
          disabled={busy}
          aria-label="Snooze 1 day"
          title="Snooze 1 day"
          className="size-10 sm:size-9 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-soft active:bg-soft disabled:opacity-50"
        >
          <MoonStar size={16} />
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            aria-label="Edit task"
            title="Edit"
            className="size-10 sm:size-9 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-soft active:bg-soft disabled:opacity-50"
          >
            <Pencil size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
