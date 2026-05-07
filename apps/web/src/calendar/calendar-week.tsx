import { format, isSameDay, isToday } from "date-fns";
import { occurrencesOnDay, type EventOccurrence } from "@/lib/calendar";
import { EventChip } from "@/calendar/event-chip";
import { addDays } from "date-fns";

interface WeekViewProps {
  weekStart: Date;
  occurrences: EventOccurrence[];
  onSelectDay: (day: Date) => void;
  onSelectEvent: (occurrence: EventOccurrence) => void;
}

export function CalendarWeek({
  weekStart,
  occurrences,
  onSelectDay,
  onSelectEvent,
}: WeekViewProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="bg-white border border-line rounded-lg overflow-hidden divide-y divide-line/70">
      {days.map((day) => {
        const onDay = occurrencesOnDay(occurrences, day);
        const today = isToday(day);
        return (
          <div key={day.toISOString()} className="grid grid-cols-[88px_1fr] gap-3 px-3 py-3">
            <button
              type="button"
              onClick={() => onSelectDay(day)}
              className="text-left"
            >
              <p
                className={[
                  "text-[11px] font-medium uppercase tracking-wider mb-1",
                  today ? "text-primary" : "text-muted",
                ].join(" ")}
              >
                {format(day, "EEE")}
              </p>
              <p
                className={[
                  "text-[24px] font-medium tnum",
                  today ? "text-primary" : "text-ink",
                ].join(" ")}
              >
                {format(day, "d")}
              </p>
            </button>
            <div className="flex flex-col gap-1.5 min-w-0">
              {onDay.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className="text-[13px] text-muted hover:text-ink text-left py-2"
                >
                  Nothing scheduled. Click to add.
                </button>
              ) : (
                onDay.map((occ, i) => (
                  <EventChip
                    key={`${occ.event.id}-${i}`}
                    occurrence={occ}
                    detailed
                    onClick={() => onSelectEvent(occ)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Re-export so the import surface in CalendarPage stays compact.
export { isSameDay };
