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
  const isChild = member?.member_type === "child";

  // Children only see their own; parents see all.
  const visibleTasks = isChild
    ? data.tasks.filter((t) => t.assignee_id === member?.id)
    : data.tasks;

  const pending = visibleTasks.filter((t) => t.status === "pending");
  const done = visibleTasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, 10);

  // For parents: group pending tasks by assignee. For kids: a single
  // flat list since they're all theirs.
  const childMembers = data.members.filter((m) => m.member_type === "child");
  const groups = canEdit
    ? childMembers
        .map((c) => ({
          member: c,
          tasks: pending
            .filter((t) => t.assignee_id === c.id)
            .sort((a, b) => a.due_date.localeCompare(b.due_date)),
        }))
        .filter((g) => g.tasks.length > 0 || canEdit)
    : [
        {
          member: member!,
          tasks: pending.sort((a, b) => a.due_date.localeCompare(b.due_date)),
        },
      ];

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
          <p className="text-[13px] uppercase tracking-wider text-muted mb-1">Tasks</p>
          <h1 className="text-[30px] font-medium text-ink">
            {canEdit ? "What's on the kids' lists" : "Your tasks"}
          </h1>
          <p className="mt-2 text-[14.5px] text-muted">
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
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[14px] px-4 py-3">
          {data.error}
        </div>
      )}

      {pending.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-10 text-center space-y-3">
          <ListTodo size={32} className="mx-auto text-muted" />
          <p className="text-[16px] text-ink">Nothing on the list. Nice.</p>
          {canEdit && (
            <Button variant="secondary" onClick={() => openCreate()}>
              <Plus size={14} /> Add a task
            </Button>
          )}
        </div>
      ) : (
        <div className={canEdit ? "grid gap-5 md:grid-cols-2" : "space-y-5"}>
          {groups.map((g) => (
            <KidColumn
              key={g.member.id}
              memberId={g.member.id}
              memberName={g.member.short_name}
              showHeader={canEdit}
              tasks={g.tasks}
              onComplete={completeTask}
              onSnooze={snoozeTask}
              onEdit={openEdit}
              onAdd={canEdit ? () => openCreate(g.member.id) : undefined}
              busyTaskId={busyTaskId}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <details className="bg-white border border-line rounded-lg">
          <summary className="cursor-pointer list-none px-5 py-3 text-[14.5px] text-muted hover:text-ink flex items-center gap-2">
            <Check size={14} /> Recently completed ({done.length})
          </summary>
          <ul className="divide-y divide-line">
            {done.map((t) => {
              const m = data.members.find((x) => x.id === t.assignee_id);
              return (
                <li key={t.id} className="px-5 py-2.5 flex items-center gap-3 text-[14.5px]">
                  <Check size={14} className="text-emerald shrink-0" />
                  <span className="text-ink line-through">{t.title}</span>
                  <span className="text-muted text-[13px] ml-auto">
                    {m?.short_name ?? "?"} · {t.completed_at ? formatRelativeDate(t.completed_at) : ""}
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
            members={childMembers}
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

interface KidColumnProps {
  memberId: string;
  memberName: string;
  showHeader: boolean;
  tasks: TaskRow[];
  onComplete: (t: TaskRow) => void;
  onSnooze: (t: TaskRow, days: number) => void;
  onEdit: (t: TaskRow) => void;
  onAdd?: () => void;
  busyTaskId: string | null;
  canEdit: boolean;
}

function KidColumn({
  memberId,
  memberName,
  showHeader,
  tasks,
  onComplete,
  onSnooze,
  onEdit,
  onAdd,
  busyTaskId,
  canEdit,
}: KidColumnProps) {
  const colour = colourFor(memberId, memberName);
  return (
    <div className="bg-white border border-line rounded-lg overflow-hidden">
      {showHeader && (
        <header
          className="flex items-center justify-between px-5 py-3 border-b border-line"
          style={{ backgroundColor: colour.soft }}
        >
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: colour.accent }} />
            <h2 className="text-[18px] font-semibold" style={{ color: colour.text }}>
              {memberName}
            </h2>
            <span className="text-[13px] opacity-70" style={{ color: colour.text }}>
              {tasks.length} pending
            </span>
          </div>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="text-[13.5px] font-medium hover:underline"
              style={{ color: colour.text }}
            >
              + Add
            </button>
          )}
        </header>
      )}
      {tasks.length === 0 ? (
        <div className="px-5 py-6 text-center text-[14.5px] text-muted">
          No tasks. Nice and clear.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((t) => (
            <TaskListItem
              key={t.id}
              task={t}
              accent={colour.accent}
              onComplete={() => onComplete(t)}
              onSnooze={(days) => onSnooze(t, days)}
              onEdit={() => onEdit(t)}
              busy={busyTaskId === t.id}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskListItem({
  task,
  accent,
  onComplete,
  onSnooze,
  onEdit,
  busy,
  canEdit,
}: {
  task: TaskRow;
  accent: string;
  onComplete: () => void;
  onSnooze: (days: number) => void;
  onEdit: () => void;
  busy: boolean;
  canEdit: boolean;
}) {
  const overdue = isOverdue(task);
  const due = dueLabel(task);
  const time = formatDueTime(task.due_time);
  return (
    <li className="px-4 sm:px-5 py-3 flex items-start gap-3">
      <button
        type="button"
        onClick={onComplete}
        disabled={busy}
        aria-label="Mark done"
        className="mt-0.5 size-6 grid place-items-center rounded-full border-2 hover:bg-soft disabled:opacity-50 transition-colors"
        style={{ borderColor: accent }}
      >
        <Check size={13} className="opacity-0 hover:opacity-100" style={{ color: accent }} />
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-[15.5px] font-medium text-ink truncate">{task.title}</p>
        {task.description && (
          <p className="text-[13.5px] text-muted truncate">{task.description}</p>
        )}
        <p className="text-[13px] mt-1 flex items-center gap-2 flex-wrap">
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
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onSnooze(1)}
          disabled={busy}
          aria-label="Snooze 1 day"
          title="Snooze 1 day"
          className="size-8 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-soft disabled:opacity-50"
        >
          <MoonStar size={14} />
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            aria-label="Edit task"
            title="Edit"
            className="size-8 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-soft disabled:opacity-50"
          >
            <Pencil size={14} />
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
