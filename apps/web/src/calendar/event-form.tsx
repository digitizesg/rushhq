import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Download, Trash2 } from "lucide-react";
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
import {
  EVENT_TYPE_OPTIONS,
  type EventAttachment,
  type EventType,
  type EventVisibility,
  type FamilyMember,
  type ReminderChannel,
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
  const [untilDate, setUntilDate] = useState<string>(initialPreset.until ?? "");

  const [visibility, setVisibility] = useState<EventVisibility>(event?.visibility ?? "family");
  const [eventType, setEventType] = useState<EventType>(event?.event_type ?? "other");
  const [notifyExtraRoles, setNotifyExtraRoles] = useState<boolean>(
    event?.notify_extra_roles ?? false,
  );
  // For new events only: ping attendees right after save. Existing
  // events skip this so editing doesn't accidentally re-blast.
  const [notifyOnCreate, setNotifyOnCreate] = useState<boolean>(true);
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

  // Attachments — kept in three buckets while the form is open:
  //  • existing rows that came down with the event (rendered with × to remove)
  //  • IDs the user has marked for removal (deleted on save)
  //  • new File objects the user picked (uploaded on save once we know
  //    the event id)
  const [existingAttachments, setExistingAttachments] = useState<EventAttachment[]>(
    event?.attachments ?? [],
  );
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

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

    const rrule = presetToRrule(preset, customRrule, untilDate || null);
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
      p_event_type: eventType,
      p_reminders: reminders.map(({ lead_time_minutes, channel }) => ({
        lead_time_minutes,
        channel,
      })),
    };

    setSubmitting(true);
    try {
      let eventId: string;
      if (isEditing) {
        const { error: rpcErr } = await supabase.rpc("update_calendar_event", {
          p_event_id: event!.id,
          ...payload,
        });
        if (rpcErr) throw rpcErr;
        eventId = event!.id;
      } else {
        const { data, error: rpcErr } = await supabase.rpc("create_calendar_event", {
          ...payload,
          p_notify_on_create: notifyOnCreate,
        });
        if (rpcErr) throw rpcErr;
        eventId = (data as string | null) ?? "";
      }

      await syncAttachments(eventId);
      onSaved(eventId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  /** Uploads any new files + deletes any removed attachments. Best-effort:
   *  if storage fails for a single file we surface the error but don't roll
   *  back the event itself. */
  async function syncAttachments(eventId: string) {
    // Remove first so freshly-uploaded files aren't accidentally collected.
    if (removedAttachmentIds.length > 0) {
      const toDelete = existingAttachments.filter((a) =>
        removedAttachmentIds.includes(a.id),
      );
      if (toDelete.length > 0) {
        await supabase.storage
          .from("event-attachments")
          .remove(toDelete.map((a) => a.storage_path));
        await supabase
          .from("event_attachments")
          .delete()
          .in("id", removedAttachmentIds);
      }
    }
    if (pendingFiles.length === 0) return;

    for (const file of pendingFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${eventId}/${uid()}-${safeName}`;
      const up = await supabase.storage
        .from("event-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
      const ins = await supabase.from("event_attachments").insert({
        event_id: eventId,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        storage_path: path,
        uploaded_by: currentMember?.id ?? null,
      });
      if (ins.error) throw ins.error;
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

        <AttachmentsField
          existing={existingAttachments}
          removedIds={removedAttachmentIds}
          onRemoveExisting={(id) => {
            setRemovedAttachmentIds((prev) =>
              prev.includes(id) ? prev : [...prev, id],
            );
            setExistingAttachments((prev) => prev.filter((a) => a.id !== id));
          }}
          pending={pendingFiles}
          onAddPending={(files) =>
            setPendingFiles((prev) => [...prev, ...files])
          }
          onRemovePending={(idx) =>
            setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
          }
        />
      </Section>

      <Section title="When">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-[16px] text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              className="size-5 rounded border-line accent-primary"
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
        {preset !== "none" && preset !== "custom" && (
          <TextField
            label="Until (optional)"
            type="date"
            containerClassName="max-w-xs"
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
            hint="Last date the event repeats. Leave blank to repeat forever."
          />
        )}
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
            className="mt-0.5 size-5 rounded border-line accent-primary"
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

        {!isEditing && (
          <label className="flex items-start gap-2.5 rounded-md border border-line bg-soft px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 size-5 rounded border-line accent-primary"
              checked={notifyOnCreate}
              onChange={(e) => setNotifyOnCreate(e.target.checked)}
            />
            <span className="text-[15px] text-ink">
              Notify attendees on save
              <span className="block text-[13.5px] text-muted mt-0.5">
                Sends a Telegram + email ping right away so people know
                it's on the calendar (separate from the lead-time
                reminders below).
              </span>
            </span>
          </label>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <Select
            label="Type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as EventType)}
            hint="Sets the chip colour on the calendar."
          >
            {EVENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
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
        </div>
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

function AttachmentsField({
  existing,
  removedIds,
  onRemoveExisting,
  pending,
  onAddPending,
  onRemovePending,
}: {
  existing: EventAttachment[];
  removedIds: string[];
  onRemoveExisting: (id: string) => void;
  pending: File[];
  onAddPending: (files: File[]) => void;
  onRemovePending: (index: number) => void;
}) {
  const visibleExisting = existing.filter((a) => !removedIds.includes(a.id));

  async function openAttachment(storagePath: string) {
    try {
      const { data, error } = await supabase.storage
        .from("event-attachments")
        .createSignedUrl(storagePath, 60 * 5);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div>
      <span className="block text-[15px] font-medium text-ink mb-1.5">
        Attachments
      </span>
      {(visibleExisting.length > 0 || pending.length > 0) && (
        <ul className="space-y-1.5 mb-2.5">
          {visibleExisting.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 pl-3 pr-1.5 py-1.5 rounded-md bg-soft border border-line text-[14.5px] min-w-0"
            >
              <button
                type="button"
                onClick={() => openAttachment(a.storage_path)}
                className="flex-1 min-w-0 flex items-center gap-2 text-left text-ink hover:text-primary"
                title="Open"
              >
                <span className="truncate min-w-0 break-all">{a.file_name}</span>
                <span className="text-[12.5px] text-muted shrink-0">
                  {a.size_bytes ? humanSize(a.size_bytes) : ""}
                </span>
              </button>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => openAttachment(a.storage_path)}
                  aria-label={`Download ${a.file_name}`}
                  title="Download"
                  className="size-8 grid place-items-center text-muted hover:text-primary rounded-md hover:bg-white"
                >
                  <Download size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveExisting(a.id)}
                  aria-label={`Remove ${a.file_name}`}
                  title="Remove"
                  className="size-8 grid place-items-center text-muted hover:text-danger rounded-md hover:bg-white"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
          {pending.map((f, i) => (
            <li
              key={`p-${i}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-primary-soft border border-primary/30 text-[14.5px] min-w-0"
            >
              <span className="truncate flex items-center gap-2 text-primary min-w-0 break-all">
                <Trash2 size={14} className="opacity-0" aria-hidden />
                {f.name}
                <span className="text-[12.5px] opacity-80 shrink-0">
                  {humanSize(f.size)} · ready
                </span>
              </span>
              <button
                type="button"
                onClick={() => onRemovePending(i)}
                aria-label={`Remove ${f.name}`}
                className="size-7 grid place-items-center text-primary/70 hover:text-danger rounded-md hover:bg-white"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="file"
        multiple
        onChange={(e) => {
          const list = e.target.files;
          if (!list || list.length === 0) return;
          onAddPending(Array.from(list));
          e.target.value = "";
        }}
        className="block text-[14.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-white file:border file:border-line file:text-ink file:px-3 file:py-2 file:text-[14px] file:font-medium file:cursor-pointer hover:file:bg-soft"
      />
      <p className="text-[13px] text-muted mt-1.5">
        PDFs, images, schedules — anything useful for the event.
      </p>
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
