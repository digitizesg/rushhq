import { colourFor } from "@/lib/colours";
import { formatTime24 } from "@/lib/calendar";
import type { EventOccurrence } from "@/lib/calendar";

interface EventChipProps {
  occurrence: EventOccurrence;
  /** When false (default) the chip is dense for month-view cells. */
  detailed?: boolean;
  onClick: () => void;
}

export function EventChip({ occurrence, detailed = false, onClick }: EventChipProps) {
  const { event, start } = occurrence;
  // Colour by primary attendee for stable per-person accents. If the
  // event has no attendees, fall back to a neutral palette slot.
  const colour = colourFor(occurrence.event.created_by);
  const recurring = !!event.rrule;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${event.title}${event.location ? " · " + event.location : ""}`}
      className={[
        "w-full text-left rounded-md transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage",
        detailed ? "px-3 py-2" : "px-2 py-1",
      ].join(" ")}
      style={{
        background: colour.chipBg,
        color: colour.text,
        boxShadow: `inset 3px 0 0 ${colour.bg}`,
      }}
    >
      {detailed ? (
        <div className="space-y-0.5">
          <p className="text-[13px] font-medium truncate">{event.title}</p>
          <p className="text-[11.5px] opacity-80 tnum">
            {event.all_day ? "All day" : formatTime24(start)}
            {recurring ? " · repeats" : ""}
            {event.visibility === "parents" ? " · parents" : ""}
          </p>
        </div>
      ) : (
        <div className="flex items-baseline gap-1.5">
          {!event.all_day && (
            <span className="text-[10.5px] opacity-80 tnum shrink-0">
              {formatTime24(start)}
            </span>
          )}
          <span className="text-[12px] truncate">{event.title}</span>
        </div>
      )}
    </button>
  );
}
