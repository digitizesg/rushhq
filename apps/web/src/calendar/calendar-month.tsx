import { format, isSameMonth, isToday, isWeekend } from "date-fns";
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
  const totalCells = weeks.flat().length;

  return (
    <div className="bg-white border border-line rounded-lg overflow-hidden shadow-sm">
      <div className="grid grid-cols-7 bg-soft border-b border-line">
        {labels.map((l, i) => (
          <div
            key={l}
            className={[
              "px-3 py-2.5 text-[13px] font-semibold uppercase tracking-wider text-center",
              i >= 5 ? "text-muted" : "text-ink",
            ].join(" ")}
          >
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day, idx) => {
          const onDay = occurrencesOnDay(occurrences, day);
          const inMonth = isSameMonth(day, anchor);
          const today = isToday(day);
          const weekend = isWeekend(day);
          const visible = onDay.slice(0, 3);
          const overflow = onDay.length - visible.length;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectDay(day)}
              className={[
                "group relative text-left border-b border-r border-line/70 min-h-[140px] p-2 flex flex-col gap-1.5 transition-colors",
                idx % 7 === 6 ? "border-r-0" : "",
                idx >= totalCells - 7 ? "border-b-0" : "",
                inMonth ? "bg-white hover:bg-soft/60" : "bg-page/60 hover:bg-page",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
              ].join(" ")}
              title={format(day, "EEEE d LLLL")}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={[
                    "inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded-full text-[15px] font-medium tnum",
                    today
                      ? "bg-primary text-white"
                      : inMonth
                        ? weekend
                          ? "text-muted"
                          : "text-ink"
                        : "text-muted/60",
                  ].join(" ")}
                >
                  {format(day, "d")}
                </span>
                {onDay.length > 0 && (
                  <span className="text-[11.5px] text-muted tnum opacity-0 group-hover:opacity-100 transition-opacity">
                    {onDay.length} {onDay.length === 1 ? "event" : "events"}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1 min-h-0">
                {visible.map((occ, i) => (
                  <EventChip
                    key={`${occ.event.id}-${i}-${occ.start.toISOString()}`}
                    occurrence={occ}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEvent(occ);
                    }}
                  />
                ))}
                {overflow > 0 && (
                  <span className="text-[12.5px] font-medium text-muted px-1.5">
                    + {overflow} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
