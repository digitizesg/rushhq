import { addDays, format, isSameDay, isToday, isTomorrow, startOfDay } from "date-fns";
import { occurrencesOnDay, AGENDA_DAYS, type EventOccurrence } from "@/lib/calendar";
import { colourFor } from "@/lib/colours";
import { formatTime24 } from "@/lib/calendar";

interface AgendaProps {
  /** Start of the agenda window (today, by default). */
  start: Date;
  occurrences: EventOccurrence[];
  onSelectEvent: (occurrence: EventOccurrence) => void;
}

/**
 * Mobile-first agenda. Vertical scroll, a header per day, each event
 * a chunky tappable row. Empty days collapse so the list stays useful
 * for sparse weeks.
 */
export function CalendarAgenda({ start, occurrences, onSelectEvent }: AgendaProps) {
  const days = Array.from({ length: AGENDA_DAYS }, (_, i) => startOfDay(addDays(start, i)));
  const grouped = days
    .map((d) => ({ day: d, occs: occurrencesOnDay(occurrences, d) }))
    .filter((g) => g.occs.length > 0);

  if (grouped.length === 0) {
    return (
      <div className="bg-white border border-line rounded-lg p-8 text-center">
        <p className="text-[15px] text-ink font-medium mb-1">All clear.</p>
        <p className="text-[13.5px] text-muted">
          Nothing scheduled in the next {AGENDA_DAYS} days.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-line rounded-lg overflow-hidden">
      <ul className="divide-y divide-line">
        {grouped.map(({ day, occs }) => (
          <li key={day.toISOString()}>
            <DayHeader day={day} count={occs.length} />
            <ul className="divide-y divide-line/70">
              {occs.map((occ, i) => (
                <AgendaRow
                  key={`${occ.event.id}-${i}-${occ.start.toISOString()}`}
                  occurrence={occ}
                  onClick={() => onSelectEvent(occ)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function dayLabel(day: Date): string {
  if (isToday(day)) return "Today";
  if (isTomorrow(day)) return "Tomorrow";
  if (isSameDay(addDays(new Date(), -1), day)) return "Yesterday";
  return format(day, "EEEE");
}

function DayHeader({ day, count }: { day: Date; count: number }) {
  const today = isToday(day);
  return (
    <div className="flex items-baseline justify-between px-4 py-2.5 bg-soft">
      <p className="flex items-baseline gap-2">
        <span
          className={[
            "text-[13.5px] font-semibold",
            today ? "text-primary" : "text-ink",
          ].join(" ")}
        >
          {dayLabel(day)}
        </span>
        <span className="text-[12.5px] text-muted tnum">
          {format(day, "d LLL")}
        </span>
      </p>
      <span className="text-[12px] text-muted tnum">
        {count} {count === 1 ? "event" : "events"}
      </span>
    </div>
  );
}

function AgendaRow({
  occurrence,
  onClick,
}: {
  occurrence: EventOccurrence;
  onClick: () => void;
}) {
  const { event, start } = occurrence;
  const colour = colourFor(event.created_by);
  const recurring = !!event.rrule;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-start gap-3 px-4 py-3 text-left bg-white hover:bg-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
      >
        <span
          className="mt-1.5 inline-block w-1 self-stretch min-h-6 rounded-full shrink-0"
          style={{ background: colour.accent }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-medium text-ink truncate">
            {event.title}
          </p>
          <p className="text-[12.5px] text-muted tnum mt-0.5">
            {event.all_day ? "All day" : formatTime24(start)}
            {event.location ? ` · ${event.location}` : ""}
            {recurring ? " · repeats" : ""}
            {event.visibility === "parents" ? " · parents" : ""}
          </p>
        </div>
        <span
          className="text-muted shrink-0 mt-1"
          aria-hidden
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </span>
      </button>
    </li>
  );
}
