import { format, isSameMonth, isToday } from "date-fns";
import {
  monthGrid,
  occurrencesOnDay,
  weekDayLabels,
  type EventOccurrence,
} from "@/lib/calendar";
import { EventChip } from "@/calendar/event-chip";

interface MonthGridProps {
  anchor: Date;
  occurrences: EventOccurrence[];
  onSelectDay: (day: Date) => void;
  onSelectEvent: (occurrence: EventOccurrence) => void;
}

export function CalendarMonth({
  anchor,
  occurrences,
  onSelectDay,
  onSelectEvent,
}: MonthGridProps) {
  const weeks = monthGrid(anchor);
  const labels = weekDayLabels();

  return (
    <div className="bg-white border border-line rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-soft border-b border-line">
        {labels.map((l) => (
          <div
            key={l}
            className="px-2 py-2 text-[11.5px] font-medium uppercase tracking-wider text-muted text-center"
          >
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {weeks.flat().map((day, idx) => {
          const onDay = occurrencesOnDay(occurrences, day);
          const inMonth = isSameMonth(day, anchor);
          const today = isToday(day);
          const visible = onDay.slice(0, 3);
          const overflow = onDay.length - visible.length;
          return (
            <div
              key={idx}
              className={[
                "border-b border-r border-line/70 min-h-[110px] p-1.5 flex flex-col gap-1",
                idx % 7 === 6 ? "border-r-0" : "",
                idx >= weeks.flat().length - 7 ? "border-b-0" : "",
                inMonth ? "bg-white" : "bg-page/40",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => onSelectDay(day)}
                className={[
                  "self-start text-[12.5px] tnum px-1.5 rounded-full transition-colors",
                  inMonth ? "text-ink hover:bg-soft" : "text-muted hover:text-ink",
                  today
                    ? "bg-primary text-white hover:bg-primary hover:text-white"
                    : "",
                ].join(" ")}
                title={format(day, "EEEE d LLLL")}
              >
                {format(day, "d")}
              </button>
              <div className="flex flex-col gap-1 min-h-0">
                {visible.map((occ, i) => (
                  <EventChip
                    key={`${occ.event.id}-${i}-${occ.start.toISOString()}`}
                    occurrence={occ}
                    onClick={() => onSelectEvent(occ)}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectDay(day)}
                    className="text-left text-[11.5px] text-muted hover:text-ink px-2"
                  >
                    + {overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
