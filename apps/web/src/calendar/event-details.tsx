import { format } from "date-fns";
import { rruleToPreset, RECURRENCE_OPTIONS, formatTime24 } from "@/lib/calendar";
import { colourFor } from "@/lib/colours";
import type { FamilyMember } from "@/lib/types";
import type { FullEvent } from "@/calendar/use-calendar-data";
import type { EventOccurrence } from "@/lib/calendar";

interface EventDetailsProps {
  event: FullEvent;
  occurrence: EventOccurrence;
  members: FamilyMember[];
}

/**
 * Read-only summary of an event. Used for helpers (and any future role
 * without edit rights). Same data shape as the EventForm sees, just
 * presented as plain text.
 */
export function EventDetails({ event, occurrence, members }: EventDetailsProps) {
  const colour = colourFor(event.created_by);
  const presetLabel =
    RECURRENCE_OPTIONS.find((o) => o.value === rruleToPreset(event.rrule).preset)?.label ?? "Custom";

  const attendees = event.attendee_ids
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is FamilyMember => !!m);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span
          className="mt-2 inline-block size-3 rounded-full shrink-0"
          style={{ background: colour.accent }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[20px] font-semibold text-ink leading-tight">
            {event.title}
          </p>
          {event.location && (
            <p className="mt-1 text-[14px] text-muted">📍 {event.location}</p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-line bg-soft px-4 py-3">
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">
          When
        </p>
        <p className="text-[14px] text-ink tnum">
          {event.all_day
            ? format(occurrence.start, "EEEE d LLLL yyyy") + " · all day"
            : `${format(occurrence.start, "EEEE d LLLL yyyy")} · ${formatTime24(
                occurrence.start,
              )} – ${formatTime24(occurrence.end)}`}
        </p>
        {event.rrule && (
          <p className="mt-1 text-[12.5px] text-muted">{presetLabel}</p>
        )}
      </div>

      {event.description && (
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted mb-1.5">
            Notes
          </p>
          <p className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed">
            {event.description}
          </p>
        </div>
      )}

      {attendees.length > 0 && (
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted mb-1.5">
            Attendees
          </p>
          <div className="flex flex-wrap gap-1.5">
            {attendees.map((m) => {
              const c = colourFor(m.id);
              return (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[13px]"
                  style={{ background: c.soft, color: c.text }}
                >
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: c.accent }}
                    aria-hidden
                  />
                  {m.short_name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[12px] text-subtle pt-2 border-t border-line">
        You're viewing as a helper. Ask Ben or Alice if you need this changed.
      </p>
    </div>
  );
}
