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
  const colour = colourFor(event.created_by);
  const recurring = !!event.rrule;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${event.title}${event.location ? " · " + event.location : ""}`}
      className={[
        "w-full text-left rounded-md transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
        detailed ? "px-3 py-2.5" : "px-2 py-1",
      ].join(" ")}
      style={{
        background: colour.soft,
        color: colour.text,
      }}
    >
      {detailed ? (
        <div className="flex items-start gap-3">
          <span
            className="mt-1 inline-block size-2 rounded-full shrink-0"
            style={{ background: colour.accent }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium truncate">{event.title}</p>
            <p className="text-[11.5px] tnum opacity-80">
              {event.all_day ? "All day" : formatTime24(start)}
              {recurring ? " · repeats" : ""}
              {event.visibility === "parents" ? " · parents" : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-baseline gap-1.5">
          {!event.all_day && (
            <span
              className="text-[10.5px] tnum shrink-0 opacity-80"
              style={{ color: colour.text }}
            >
              {formatTime24(start)}
            </span>
          )}
          <span
            className="text-[12px] truncate font-medium"
            style={{ color: colour.text }}
          >
            {event.title}
          </span>
        </div>
      )}
    </button>
  );
}
