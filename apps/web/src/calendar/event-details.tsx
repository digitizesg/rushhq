import { format } from "date-fns";
import { Clock, Lock, MapPin, Repeat, StickyNote, Users } from "lucide-react";
import { rruleToPreset, RECURRENCE_OPTIONS, formatTime24 } from "@/lib/calendar";
import { colourFor, colourForRole } from "@/lib/colours";
import { Avatar } from "@/components/avatar";
import type { FamilyMember } from "@/lib/types";
import type { FullEvent } from "@/calendar/use-calendar-data";
import type { EventOccurrence, RecurrencePreset } from "@/lib/calendar";
import type { ReactNode } from "react";

interface EventDetailsProps {
  event: FullEvent;
  occurrence: EventOccurrence;
  members: FamilyMember[];
}

/**
 * Read-only summary of an event. Used for helpers (and any future role
 * without edit rights).
 */
export function EventDetails({ event, occurrence, members }: EventDetailsProps) {
  const colour = colourFor(event.created_by);
  const preset = rruleToPreset(event.rrule).preset;
  const presetLabel =
    RECURRENCE_OPTIONS.find((o) => o.value === preset)?.label ?? "Custom";
  const isOneShot = preset === ("none" as RecurrencePreset);

  const attendees = event.attendee_ids
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is FamilyMember => !!m);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <span
          className="mt-2 inline-block size-3 rounded-full shrink-0"
          style={{ background: colour.accent }}
          aria-hidden
        />
        <div className="min-w-0">
          <h2 className="text-[24px] font-semibold text-ink leading-tight">
            {event.title}
          </h2>
          {event.location && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                event.location,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 text-[16px] text-primary hover:underline underline-offset-2 inline-flex items-center gap-1.5"
            >
              <MapPin size={14} aria-hidden /> {event.location}
            </a>
          )}
        </div>
      </header>

      <Section title="When" icon={<Clock size={14} />}>
        <p className="text-[17px] text-ink tnum">
          {event.all_day
            ? `${format(occurrence.start, "EEEE d LLLL yyyy")} · all day`
            : `${format(occurrence.start, "EEEE d LLLL yyyy")} · ${formatTime24(
                occurrence.start,
              )} – ${formatTime24(occurrence.end)}`}
        </p>
        {!isOneShot && (
          <p className="mt-1 text-[15px] text-muted inline-flex items-center gap-1.5">
            <Repeat size={13} aria-hidden /> {presetLabel}
          </p>
        )}
      </Section>

      {event.description && (
        <Section title="Notes" icon={<StickyNote size={14} />}>
          <p className="text-[16px] text-ink whitespace-pre-wrap leading-relaxed">
            {event.description}
          </p>
        </Section>
      )}

      {attendees.length > 0 && (
        <Section title="Attendees" icon={<Users size={14} />}>
          <div className="flex flex-wrap gap-2">
            {attendees.map((m) => {
              const c = colourForRole(m.id, m.short_name, m.role);
              return (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-2 pl-1 pr-3.5 h-10 rounded-full text-[15px] font-medium border"
                  style={{
                    background: c.soft,
                    color: c.text,
                    borderColor: c.accent,
                  }}
                >
                  <Avatar
                    size={28}
                    name={m.short_name}
                    url={m.avatar_url}
                    accent={c.accent}
                    text="#ffffff"
                    alt=""
                  />
                  {m.short_name}
                </span>
              );
            })}
          </div>
        </Section>
      )}

      {event.visibility === "parents" && (
        <p className="inline-flex items-center gap-1.5 text-[14px] text-muted">
          <Lock size={12} /> Parents only
        </p>
      )}

      <p className="text-[14px] text-muted pt-3 border-t border-line">
        You're viewing as a helper. Ask Ben or Alice if you need this changed.
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <p className="text-[14px] font-semibold uppercase tracking-wider text-muted inline-flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      {children}
    </section>
  );
}
