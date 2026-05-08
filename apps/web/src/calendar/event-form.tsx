import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/auth-context";
import {
  RECURRENCE_OPTIONS,
  fromLocalInputValue,
  nextRoundHour,
  presetToRrule,
  rruleToPreset,
  toLocalInputValue,
  type RecurrencePreset,
} from "@/lib/calendar";
import type {
  EventVisibility,
  FamilyMember,
  ReminderChannel,
} from "@/lib/types";
import type { FullEvent } from "@/calendar/use-calendar-data";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { Select } from "@/components/select";
import { colourForRole } from "@/lib/colours";
import { Avatar } from "@/components/avatar";

interface ReminderRow {
  id: string; // local-only — for stable keys while editing
  lead_time_minutes: number;
  channel: ReminderChannel;
}

interface EventFormProps {
  members: FamilyMember[];
  /** Event being edited, or null for new event. */
  event: FullEvent | null;
  /** Date prefilled when creating from a day cell. */
  defaultDay?: Date;
  onSaved: (eventId: string) => void;
  onCancelled: () => void;
  onDeleted?: (eventId: string) => void;
}

const LEAD_PRESETS = [
  { value: 0, label: "At start" },
  { value: 10, label: "10 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 60 * 2, label: "2 hours before" },
  { value: 60 * 24, label: "1 day before" },
  { value: 60 * 24 * 2, label: "2 days before" },
];

const DURATION_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "1h" },
  { value: 90, label: "1½h" },
  { value: 120, label: "2h" },
  { value: 180, label: "3h" },
  { value: 240, label: "4h" },
];

const CHANNEL_OPTIONS: ReadonlyArray<{ value: ReminderChannel; label: string }> = [
  { value: "both", label: "Telegram and email" },
  { value: "telegram", label: "Telegram only" },
  { value: "email", label: "Email only" },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function EventForm({
  members,
  event,
  defaultDay,
  onSaved,
  onCancelled,
  onDeleted,
}: EventFormProps) {
  const { member: currentMember } = useAuth();
  const isEditing = !!event;

  const initialStart = useMemo(() => {
    if (event) return new Date(event.starts_at);
    const seed = defaultDay ?? new Date();
    const round = nextRoundHour(seed);
    // If defaultDay is in the past or doesn't include time, anchor to
    // today's "next round hour" but use the chosen day's date.
    if (defaultDay) {
      const d = new Date(defaultDay);
      d.setHours(round.getHours(), 0, 0, 0);
      return d;
    }
    return round;
  }, [event, defaultDay]);

  const initialEnd = useMemo(() => {
    if (event) return new Date(event.ends_at);
    const e = new Date(initialStart);
    e.setHours(e.getHours() + 1);
    return e;
  }, [event, initialStart]);

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [startsAt, setStartsAt] = useState(toLocalInputValue(initialStart));
  const [endsAt, setEndsAt] = useState(toLocalInputValue(initialEnd));
  const [allDayDate, setAllDayDate] = useState(toLocalInputValue(initialStart).slice(0, 10));

  // Duration model: most events are a known length (1h, 2h…). Default
  // to 60 min for new events, or compute from existing start/end.
  const initialDurationMin = useMemo(() => {
    const ms = initialEnd.getTime() - initialStart.getTime();
    return Math.max(15, Math.round(ms / 60000));
  }, [initialStart, initialEnd]);
  const [durationMin, setDurationMin] = useState<number>(initialDurationMin);
  const [customDuration, setCustomDuration] = useState<boolean>(
    !DURATION_PRESETS.some((p) => p.value === initialDurationMin),
  );

  const initialPreset = rruleToPreset(event?.rrule ?? null);
  const [preset, setPreset] = useState<RecurrencePreset>(initialPreset.preset);
  const [customRrule, setCustomRrule] = useState(initialPreset.custom);

  const [visibility, setVisibility] = useState<EventVisibility>(event?.visibility ?? "family");
  const [notifyExtraRoles, setNotifyExtraRoles] = useState<boolean>(
    event?.notify_extra_roles ?? false,
  );
  const [attendeeIds, setAttendeeIds] = useState<string[]>(
    event?.attendee_ids ?? (currentMember ? [currentMember.id] : []),
  );

  const [reminders, setReminders] = useState<ReminderRow[]>(() => {
    if (event && event.reminders.length > 0) {
      return event.reminders.map((r) => ({
        id: r.id,
        lead_time_minutes: r.lead_time_minutes,
        channel: r.channel,
      }));
    }
    return [{ id: uid(), lead_time_minutes: 60, channel: "both" }];
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    // Keep the all-day date in sync with the first start when toggling.
    if (allDay) setAllDayDate(startsAt.slice(0, 10));
  }, [allDay, startsAt]);

  function toggleAttendee(id: string) {
    setAttendeeIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
  }

  function updateReminder(id: string, patch: Partial<ReminderRow>) {
    setReminders((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeReminder(id: string) {
    setReminders((rows) => rows.filter((r) => r.id !== id));
  }
  function addReminder() {
    setReminders((rows) => [
      ...rows,
      { id: uid(), lead_time_minutes: 60, channel: "both" },
    ]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Please give the event a title.");
      return;
    }

    let startDate: Date;
    let endDate: Date;
    if (allDay) {
      const [y, m, d] = allDayDate.split("-").map((n) => parseInt(n, 10));
      startDate = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
      endDate = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 0, 0);
    } else {
      startDate = fromLocalInputValue(startsAt);
      endDate = fromLocalInputValue(endsAt);
      if (endDate < startDate) {
        setError("End time can't be before start time.");
        return;
      }
    }

    const rrule = presetToRrule(preset, customRrule);
    if (preset === "custom" && rrule && !rrule.toUpperCase().includes("FREQ=")) {
      setError("Custom recurrence must be a valid RRULE (e.g. RRULE:FREQ=WEEKLY;INTERVAL=2).");
      return;
    }

    if (attendeeIds.length === 0) {
      setError("Please pick at least one attendee.");
      return;
    }

    const payload = {
      p_title: title.trim(),
      p_description: description.trim(),
      p_location: location.trim(),
      p_starts_at: startDate.toISOString(),
      p_ends_at: endDate.toISOString(),
      p_all_day: allDay,
      p_rrule: rrule,
      p_visibility: visibility,
      p_attendee_ids: attendeeIds,
      p_notify_extra_roles: notifyExtraRoles,
      p_reminders: reminders.map(({ lead_time_minutes, channel }) => ({
        lead_time_minutes,
        channel,
      })),
    };

    setSubmitting(true);
    try {
      if (isEditing) {
        const { error: rpcErr } = await supabase.rpc("update_calendar_event", {
          p_event_id: event!.id,
          ...payload,
        });
        if (rpcErr) throw rpcErr;
        onSaved(event!.id);
      } else {
        const { data, error: rpcErr } = await supabase.rpc("create_calendar_event", payload);
        if (rpcErr) throw rpcErr;
        const id = (data as string | null) ?? "";
        onSaved(id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!event) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: delErr } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", event.id);
      if (delErr) throw delErr;
      onDeleted?.(event.id);
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
          placeholder="Riley's swim class"
        />
        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Singapore Sports Hub"
        />
        <label className="block">
          <span className="block text-[15px] font-medium text-ink mb-1.5">Notes</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Anything to remember…"
            className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-[16px] text-ink placeholder:text-muted/70 hover:border-ink/20 focus:outline-2 focus:outline-offset-0 focus:outline-primary"
          />
        </label>
      </Section>

      <Section title="When">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-[16px] text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              className="size-4 rounded border-line accent-primary"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            All day
          </label>
        </div>

        {allDay ? (
          <TextField
            label="Date"
            type="date"
            containerClassName="max-w-xs"
            value={allDayDate}
            onChange={(e) => setAllDayDate(e.target.value)}
          />
        ) : (
          <div className="space-y-3">
            <TextField
              label="Starts"
              type="datetime-local"
              containerClassName="max-w-md"
              value={startsAt}
              onChange={(e) => {
                const next = e.target.value;
                setStartsAt(next);
                if (!customDuration) setEndsAt(addMinutes(next, durationMin));
              }}
            />
            <div>
              <span className="block text-[15px] font-medium text-ink mb-2">Duration</span>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_PRESETS.map((d) => {
                  const selected = !customDuration && d.value === durationMin;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        setDurationMin(d.value);
                        setCustomDuration(false);
                        setEndsAt(addMinutes(startsAt, d.value));
                      }}
                      className={[
                        "h-9 px-3 rounded-full text-[14px] font-medium border transition-colors",
                        selected
                          ? "bg-primary text-white border-primary"
                          : "bg-white text-ink border-line hover:bg-soft",
                      ].join(" ")}
                    >
                      {d.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setCustomDuration(true)}
                  className={[
                    "h-9 px-3 rounded-full text-[14px] font-medium border transition-colors",
                    customDuration
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-ink border-line hover:bg-soft",
                  ].join(" ")}
                >
                  Custom
                </button>
              </div>
            </div>
            {customDuration && (
              <TextField
                label="Ends"
                type="datetime-local"
                containerClassName="max-w-md"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            )}
          </div>
        )}

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

      <Section title="Who">
        <div>
          <span className="block text-[15px] font-medium text-ink mb-2">Attendees</span>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const selected = attendeeIds.includes(m.id);
              const colour = colourForRole(m.id, m.short_name, m.role);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleAttendee(m.id)}
                  aria-pressed={selected}
                  className={[
                    "inline-flex items-center gap-2 h-10 pl-1 pr-3.5 rounded-full border text-[15.5px] transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
                  ].join(" ")}
                  style={
                    selected
                      ? {
                          backgroundColor: colour.soft,
                          borderColor: colour.accent,
                          color: colour.text,
                        }
                      : undefined
                  }
                >
                  <Avatar
                    size={28}
                    name={m.short_name}
                    url={m.avatar_url}
                    accent={selected ? colour.accent : "#cbd5e1"}
                    text="#ffffff"
                    alt=""
                  />
                  <span className={selected ? "font-medium" : "text-ink"}>
                    {m.short_name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-start gap-2.5 rounded-md border border-line bg-soft px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-line accent-primary"
            checked={notifyExtraRoles}
            onChange={(e) => setNotifyExtraRoles(e.target.checked)}
          />
          <span className="text-[15px] text-ink">
            Also notify all parents and the helper
            <span className="block text-[13.5px] text-muted mt-0.5">
              Useful for kid-only events (e.g. Riley's tap class) where the
              grown-ups still want the reminder ping without being listed
              as attendees.
            </span>
          </span>
        </label>

        <Select
          label="Visibility"
          containerClassName="max-w-xs"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as EventVisibility)}
          hint={
            visibility === "family"
              ? "Family members and helpers can see this."
              : "Only parents can see this."
          }
        >
          <option value="family">Family (everyone)</option>
          <option value="parents">Parents only</option>
        </Select>
      </Section>

      <Section
        title="Reminders"
        action={
          <button
            type="button"
            onClick={addReminder}
            className="text-[15px] font-medium text-primary hover:underline underline-offset-2"
          >
            + Add reminder
          </button>
        }
      >
        {reminders.length === 0 ? (
          <p className="text-[15px] text-muted">No reminders set.</p>
        ) : (
          <div className="space-y-2.5">
            {reminders.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_1fr_auto] gap-2.5 items-end"
              >
                <Select
                  label="When"
                  value={String(r.lead_time_minutes)}
                  onChange={(e) =>
                    updateReminder(r.id, { lead_time_minutes: parseInt(e.target.value, 10) })
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
        <p role="alert" className="text-danger text-[15px]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-line">
        {isEditing && onDeleted && (
          confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[15px] text-danger">Sure?</span>
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
              Delete event
            </Button>
          )
        )}
        <div className="flex gap-2 ml-auto">
          <Button type="button" variant="secondary" onClick={onCancelled}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEditing ? "Save changes" : "Create event"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function addMinutes(localIso: string, minutes: number): string {
  const start = fromLocalInputValue(localIso);
  const end = new Date(start.getTime() + minutes * 60_000);
  return toLocalInputValue(end);
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
            <h3 className="text-[14px] font-semibold uppercase tracking-wider text-muted">
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
