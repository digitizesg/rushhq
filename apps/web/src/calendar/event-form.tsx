import { useEffect, useMemo, useState, type FormEvent } from "react";
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

  const initialPreset = rruleToPreset(event?.rrule ?? null);
  const [preset, setPreset] = useState<RecurrencePreset>(initialPreset.preset);
  const [customRrule, setCustomRrule] = useState(initialPreset.custom);

  const [visibility, setVisibility] = useState<EventVisibility>(event?.visibility ?? "family");
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
    <form onSubmit={handleSubmit} className="space-y-5">
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
        <span className="block text-[13px] font-medium text-ink mb-1.5">Notes</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border-warm bg-white px-3 py-2 text-[14px] text-ink focus:outline-2 focus:outline-offset-0 focus:outline-sage"
        />
      </label>

      <div className="bg-white border border-border-warm rounded-md p-4 space-y-3">
        <label className="flex items-center gap-2 text-[14px] text-ink cursor-pointer">
          <input
            type="checkbox"
            className="size-4 rounded border-border-warm accent-sage"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          All day
        </label>

        {allDay ? (
          <TextField
            label="Date"
            type="date"
            value={allDayDate}
            onChange={(e) => setAllDayDate(e.target.value)}
          />
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <TextField
              label="Starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <TextField
              label="Ends"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
        )}

        <Select
          label="Repeats"
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
      </div>

      <div>
        <p className="block text-[13px] font-medium text-ink mb-1.5">Attendees</p>
        <div className="bg-white border border-border-warm rounded-md p-3 grid sm:grid-cols-2 gap-1">
          {members.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-paper cursor-pointer"
            >
              <input
                type="checkbox"
                className="size-4 rounded border-border-warm accent-sage"
                checked={attendeeIds.includes(m.id)}
                onChange={() => toggleAttendee(m.id)}
              />
              <span className="text-[14px] text-ink">{m.short_name}</span>
              <span className="text-[12px] text-muted ml-auto capitalize">
                {m.role}
              </span>
            </label>
          ))}
        </div>
      </div>

      <Select
        label="Visibility"
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

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="block text-[13px] font-medium text-ink">Reminders</span>
          <button
            type="button"
            onClick={addReminder}
            className="text-[13px] text-sage hover:underline underline-offset-2"
          >
            + Add reminder
          </button>
        </div>
        {reminders.length === 0 ? (
          <p className="text-[13px] text-muted">No reminders set.</p>
        ) : (
          <div className="space-y-2">
            {reminders.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end bg-white border border-border-warm rounded-md p-2.5"
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
                  className="size-10 grid place-items-center text-muted hover:text-coral rounded-md hover:bg-paper"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                    <path
                      d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4l1 9a1 1 0 001 1h2a1 1 0 001-1l1-9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-coral text-[13px]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border-warm">
        {isEditing && onDeleted && (
          confirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-coral">Sure?</span>
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
