import { useMemo, useState } from "react";
import {
  expandOccurrences,
  rangeFor,
  shiftAnchor,
  viewLabel,
  type CalendarView,
  type EventOccurrence,
} from "@/lib/calendar";
import { useCalendarData, type FullEvent } from "@/calendar/use-calendar-data";
import { CalendarMonth } from "@/calendar/calendar-month";
import { CalendarWeek } from "@/calendar/calendar-week";
import { CalendarDay } from "@/calendar/calendar-day";
import { EventForm } from "@/calendar/event-form";
import { Modal } from "@/components/modal";
import { Button } from "@/components/button";
import { useAuth } from "@/auth/auth-context";

interface FormState {
  open: boolean;
  event: FullEvent | null;
  defaultDay: Date | undefined;
}

const VIEW_OPTIONS: ReadonlyArray<{ value: CalendarView; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

export default function CalendarPage() {
  const { isParent } = useAuth();
  const { loading, events, members, error, reload } = useCalendarData();

  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [form, setForm] = useState<FormState>({ open: false, event: null, defaultDay: undefined });

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const occurrences = useMemo<EventOccurrence[]>(() => {
    return expandOccurrences(events, { start: range.gridStart, end: range.gridEnd });
  }, [events, range.gridStart, range.gridEnd]);

  const canEdit = isParent();

  function openCreateAt(day: Date) {
    if (!canEdit) return;
    setForm({ open: true, event: null, defaultDay: day });
  }

  function openEvent(occ: EventOccurrence) {
    // Helpers can view but only parents can edit. We still surface the form
    // for parents — for helpers we show a read-only summary modal in future.
    // For v1, helpers see no-op clicks; we'd add a view-only modal here.
    if (!canEdit) return;
    setForm({ open: true, event: events.find((e) => e.id === occ.event.id) ?? null, defaultDay: undefined });
  }

  function closeForm() {
    setForm({ open: false, event: null, defaultDay: undefined });
  }

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted mb-1">Calendar</p>
          <h1 className="font-serif text-[28px] font-medium text-ink tnum">
            {viewLabel(view, anchor)}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center bg-white border border-border-warm rounded-full p-0.5">
            {VIEW_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setView(o.value)}
                className={[
                  "px-3 h-8 rounded-full text-[13px] font-medium transition-colors",
                  view === o.value ? "bg-sage text-white" : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAnchor((d) => shiftAnchor(view, d, -1))}
              className="size-9 grid place-items-center rounded-md bg-white border border-border-warm text-muted hover:text-ink"
              aria-label="Previous"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setAnchor(new Date())}
              className="h-9 px-3 rounded-md bg-white border border-border-warm text-[13px] text-muted hover:text-ink"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setAnchor((d) => shiftAnchor(view, d, 1))}
              className="size-9 grid place-items-center rounded-md bg-white border border-border-warm text-muted hover:text-ink"
              aria-label="Next"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          </div>
          {canEdit && (
            <Button onClick={() => openCreateAt(new Date())}>+ Add event</Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-coral/40 bg-coral/[0.06] text-coral text-[13px] px-4 py-3">
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="bg-white border border-border-warm rounded-lg p-10 text-center text-muted text-[14px]">
          Loading…
        </div>
      ) : view === "month" ? (
        <CalendarMonth
          anchor={anchor}
          occurrences={occurrences}
          onSelectDay={openCreateAt}
          onSelectEvent={openEvent}
        />
      ) : view === "week" ? (
        <CalendarWeek
          weekStart={range.gridStart}
          occurrences={occurrences}
          onSelectDay={openCreateAt}
          onSelectEvent={openEvent}
        />
      ) : (
        <CalendarDay
          day={anchor}
          occurrences={occurrences}
          onAdd={() => openCreateAt(anchor)}
          onSelectEvent={openEvent}
        />
      )}

      <Modal
        open={form.open}
        onClose={closeForm}
        title={form.event ? "Edit event" : "New event"}
        size="lg"
      >
        <EventForm
          members={members}
          event={form.event}
          defaultDay={form.defaultDay}
          onSaved={async () => {
            closeForm();
            await reload();
          }}
          onCancelled={closeForm}
          onDeleted={async () => {
            closeForm();
            await reload();
          }}
        />
      </Modal>
    </section>
  );
}
