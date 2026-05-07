import { format } from "date-fns";
import { occurrencesOnDay, type EventOccurrence } from "@/lib/calendar";
import { EventChip } from "@/calendar/event-chip";
import { Button } from "@/components/button";

interface DayViewProps {
  day: Date;
  occurrences: EventOccurrence[];
  onAdd: () => void;
  onSelectEvent: (occurrence: EventOccurrence) => void;
}

export function CalendarDay({ day, occurrences, onAdd, onSelectEvent }: DayViewProps) {
  const onDay = occurrencesOnDay(occurrences, day);
  return (
    <div className="bg-white border border-border-warm rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted">
            {format(day, "EEEE")}
          </p>
          <p className="font-serif text-[24px] font-medium text-ink tnum">
            {format(day, "d LLLL yyyy")}
          </p>
        </div>
        <Button size="sm" onClick={onAdd}>
          Add event
        </Button>
      </div>
      {onDay.length === 0 ? (
        <p className="text-muted text-[14px]">Nothing scheduled.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {onDay.map((occ, i) => (
            <li key={`${occ.event.id}-${i}`}>
              <EventChip occurrence={occ} detailed onClick={() => onSelectEvent(occ)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
