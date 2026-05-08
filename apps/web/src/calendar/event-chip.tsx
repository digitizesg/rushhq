import type { MouseEvent } from "react";
import { colourFor, colourForType } from "@/lib/colours";
import { formatTime24 } from "@/lib/calendar";
import type { EventOccurrence } from "@/lib/calendar";
import type { FamilyMember } from "@/lib/types";
import { Avatar } from "@/components/avatar";

interface EventChipProps {
  occurrence: EventOccurrence;
  members: FamilyMember[];
  /** When false (default) the chip is dense for month-view cells. */
  detailed?: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

export function EventChip({ occurrence, members, detailed = false, onClick }: EventChipProps) {
  const { event, start } = occurrence;
  const attendees = event.attendee_ids
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is FamilyMember => !!m);
  // Type sets the chip colour; the avatar shows whose event it is.
  const colour = colourForType(event.event_type);
  const primaryKid =
    attendees.find((m) => m.member_type === "child" || m.role === "child") ?? null;
  const kidColour = primaryKid
    ? colourFor(primaryKid.id, primaryKid.short_name)
    : null;
  const recurring = !!event.rrule;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${event.title}${event.location ? " · " + event.location : ""}`}
      className={[
        "w-full text-left rounded transition-all hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
        "border-l-[3px]",
        detailed ? "px-3 py-2.5" : "pl-1.5 pr-1 sm:pr-2 py-0.5 sm:py-1",
      ].join(" ")}
      style={{
        background: colour.soft,
        color: colour.text,
        borderLeftColor: colour.accent,
      }}
    >
      {detailed ? (
        <div className="flex items-center gap-3">
          {primaryKid ? (
            <Avatar
              size={32}
              name={primaryKid.short_name}
              url={primaryKid.avatar_url}
              accent={kidColour?.accent ?? colour.accent}
              text="#ffffff"
              alt=""
            />
          ) : (
            <span
              className="inline-block size-2 rounded-full shrink-0"
              style={{ background: colour.accent }}
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[15.5px] font-medium truncate">{event.title}</p>
            <p className="text-[13.5px] tnum opacity-80">
              {event.all_day ? "All day" : formatTime24(start)}
              {recurring ? " · repeats" : ""}
              {event.visibility === "parents" ? " · parents" : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {primaryKid && (
            <Avatar
              size={18}
              name={primaryKid.short_name}
              url={primaryKid.avatar_url}
              accent={kidColour?.accent ?? colour.accent}
              text="#ffffff"
              alt=""
              className="hidden sm:block"
            />
          )}
          {!event.all_day && (
            <span
              className="hidden sm:inline text-[13px] font-semibold tnum shrink-0"
              style={{ color: colour.accent }}
            >
              {formatTime24(start)}
            </span>
          )}
          <span
            className="text-[12.5px] sm:text-[14.5px] truncate font-medium"
            style={{ color: colour.text }}
          >
            {event.title}
          </span>
        </div>
      )}
    </button>
  );
}
