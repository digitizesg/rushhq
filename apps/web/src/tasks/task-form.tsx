import { useState, type FormEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  RECURRENCE_OPTIONS,
  presetToRrule,
  rruleToPreset,
  type RecurrencePreset,
} from "@/lib/calendar";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { Select } from "@/components/select";
import type { FamilyMember, ReminderChannel } from "@/lib/types";
import type { TaskReminderRow, TaskRow } from "@/lib/tasks";

interface ReminderInput {
  id: string;
  lead_time_minutes: number;
  channel: ReminderChannel;
}

interface TaskFormProps {
  members: FamilyMember[];
  task: TaskRow | null;
  reminders: TaskReminderRow[];
  defaultAssigneeId?: string;
  onSaved: () => void | Promise<void>;
  onCancelled: () => void;
  onDeleted: () => void | Promise<void>;
}

const LEAD_PRESETS = [
  { value: 0, label: "At start" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 60 * 2, label: "2 hours before" },
  { value: 60 * 24, label: "1 day before" },
  { value: 60 * 24 * 2, label: "2 days before" },
];

const CHANNEL_OPTIONS: ReadonlyArray<{ value: ReminderChannel; label: string }> = [
  { value: "both", label: "Telegram and email" },
  { value: "telegram", label: "Telegram only" },
  { value: "email", label: "Email only" },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function TaskForm({
  members,
  task,
  reminders,
  defaultAssigneeId,
  onSaved,
  onCancelled,
  onDeleted,
}: TaskFormProps) {
  const isEditing = !!task;

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assigneeId, setAssigneeId] = useState<string>(
    task?.assignee_id ?? defaultAssigneeId ?? members[0]?.id ?? "",
  );
  const [dueDate, setDueDate] = useState<string>(
    task?.due_date ?? defaultDueDate(),
  );
  const [hasTime, setHasTime] = useState(!!task?.due_time);
  const [dueTime, setDueTime] = useState<string>(
    task?.due_time ? task.due_time.slice(0, 5) : "18:00",
  );

  const initialPreset = rruleToPreset(task?.rrule ?? null);
  const [preset, setPreset] = useState<RecurrencePreset>(initialPreset.preset);
  const [customRrule, setCustomRrule] = useState(initialPreset.custom);

  const [reminderRows, setReminderRows] = useState<ReminderInput[]>(() => {
    if (reminders.length > 0) {
      return reminders.map((r) => ({
        id: r.id,
        lead_time_minutes: r.lead_time_minutes,
        channel: r.channel,
      }));
    }
    return [];
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function updateReminder(id: string, patch: Partial<ReminderInput>) {
    setReminderRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeReminder(id: string) {
    setReminderRows((rows) => rows.filter((r) => r.id !== id));
  }
  function addReminder() {
    setReminderRows((rows) => [
      ...rows,
      { id: uid(), lead_time_minutes: 60, channel: "both" },
    ]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Please give the task a title.");
      return;
    }
    if (!assigneeId) {
      setError("Pick who this is for.");
      return;
    }
    if (!dueDate) {
      setError("Pick a due date.");
      return;
    }

    const rrule = presetToRrule(preset, customRrule);
    if (preset === "custom" && rrule && !rrule.toUpperCase().includes("FREQ=")) {
      setError("Custom recurrence must be a valid RRULE (e.g. RRULE:FREQ=WEEKLY;INTERVAL=2).");
      return;
    }

    const remindersPayload = reminderRows.map(({ lead_time_minutes, channel }) => ({
      lead_time_minutes,
      channel,
    }));

    const payload = {
      p_title: title.trim(),
      p_description: description.trim(),
      p_assignee_id: assigneeId,
      p_due_date: dueDate,
      p_due_time: hasTime ? `${dueTime}:00` : null,
      p_rrule: rrule || null,
      p_reminders: remindersPayload,
    };

    setSubmitting(true);
    try {
      if (isEditing) {
        const { error: rpcErr } = await supabase.rpc("update_task", {
          p_task_id: task!.id,
          ...payload,
        });
        if (rpcErr) throw rpcErr;
      } else {
        const { error: rpcErr } = await supabase.rpc("create_task", payload);
        if (rpcErr) throw rpcErr;
      }
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: delErr } = await supabase.rpc("delete_task", {
        p_task_id: task.id,
      });
      if (delErr) throw delErr;
      await onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Section>
        <TextField
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Practice exam paper"
        />
        <label className="block">
          <span className="block text-[14px] font-medium text-ink mb-1.5">Notes</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Anything to remember…"
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 hover:border-ink/20 focus:outline-2 focus:outline-offset-0 focus:outline-primary"
          />
        </label>
      </Section>

      <Section title="Who and when">
        <Select
          label="Assigned to"
          containerClassName="max-w-sm"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.short_name}
            </option>
          ))}
        </Select>

        <div className="grid sm:grid-cols-2 gap-3">
          <TextField
            label="Due date"
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <div>
            <label className="inline-flex items-center gap-2 text-[15px] text-ink cursor-pointer select-none mb-1.5">
              <input
                type="checkbox"
                className="size-4 rounded border-line accent-primary"
                checked={hasTime}
                onChange={(e) => setHasTime(e.target.checked)}
              />
              Specific time
            </label>
            {hasTime && (
              <TextField
                label="Due time"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
              />
            )}
            {!hasTime && (
              <p className="text-[13.5px] text-muted">
                Reminders fire at 09:00 SGT on the due date by default.
              </p>
            )}
          </div>
        </div>

        <Select
          label="Repeats"
          containerClassName="max-w-sm"
          value={preset}
          onChange={(e) => setPreset(e.target.value as RecurrencePreset)}
        >
          {RECURRENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {preset === "custom" && (
          <TextField
            label="Custom RRULE"
            value={customRrule}
            onChange={(e) => setCustomRrule(e.target.value)}
            hint="iCal RRULE syntax. Example: RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU"
          />
        )}
      </Section>

      <Section
        title="Reminders"
        action={
          <button
            type="button"
            onClick={addReminder}
            className="text-[14px] font-medium text-primary hover:underline underline-offset-2"
          >
            + Add reminder
          </button>
        }
      >
        {reminderRows.length === 0 ? (
          <p className="text-[14px] text-muted">
            No reminders. Add one if you want a Telegram or email nudge.
          </p>
        ) : (
          <div className="space-y-2.5">
            {reminderRows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_1fr_auto] gap-2.5 items-end"
              >
                <Select
                  label="When"
                  value={String(r.lead_time_minutes)}
                  onChange={(e) =>
                    updateReminder(r.id, {
                      lead_time_minutes: parseInt(e.target.value, 10),
                    })
                  }
                >
                  {LEAD_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Channel"
                  value={r.channel}
                  onChange={(e) =>
                    updateReminder(r.id, { channel: e.target.value as ReminderChannel })
                  }
                >
                  {CHANNEL_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={() => removeReminder(r.id)}
                  aria-label="Remove reminder"
                  className="size-11 grid place-items-center text-muted hover:text-danger rounded-md hover:bg-soft"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {error && (
        <p role="alert" className="text-danger text-[14px]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-line">
        {isEditing && (
          confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[14px] text-danger">Sure?</span>
              <Button
                type="button"
                size="sm"
                variant="danger"
                loading={submitting}
                onClick={handleDelete}
              >
                Delete
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete task
            </Button>
          )
        )}
        <div className="flex gap-2 ml-auto">
          <Button type="button" variant="secondary" onClick={onCancelled}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEditing ? "Save changes" : "Create task"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function defaultDueDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3.5">
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-3">
          {title && (
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted">
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
