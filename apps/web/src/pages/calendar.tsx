import { useEffect, useMemo, useState } from "react";
import {
  expandOccurrences,
  rangeFor,
  shiftAnchor,
  viewLabel,
  type CalendarView,
  type EventOccurrence,
} from "@/lib/calendar";
import { useCalendarData, type FullEvent } from "@/calendar/use-calendar-data";
import { CalendarAgenda } from "@/calendar/calendar-agenda";
import { CalendarMonth } from "@/calendar/calendar-month";
import { CalendarWeek } from "@/calendar/calendar-week";
import { CalendarDay } from "@/calendar/calendar-day";
import { EventForm } from "@/calendar/event-form";
import { EventDetails } from "@/calendar/event-details";
import { Modal } from "@/components/modal";
import { Button } from "@/components/button";
import { useAuth } from "@/auth/auth-context";

interface FormState {
  open: boolean;
  event: FullEvent | null;
  occurrence: EventOccurrence | null;
  defaultDay: Date | undefined;
}

const VIEW_OPTIONS: ReadonlyArray<{ value: CalendarView; label: string }> = [
  { value: "agenda", label: "List" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

const VIEW_STORAGE_KEY = "rushhq.calendar.view";

function defaultView(): CalendarView {
  if (typeof window === "undefined") return "month";
  const saved = window.localStorage.getItem(VIEW_STORAGE_KEY) as CalendarView | null;
  if (saved && ["agenda", "month", "week", "day"].includes(saved)) return saved;
  // No prior choice — agenda is the right default on mobile, month on desktop.
  return window.matchMedia("(max-width: 640px)").matches ? "agenda" : "month";
}

export default function CalendarPage() {
  const { isParent } = useAuth();
  const { loading, events, members, error, reload } = useCalendarData();

  const [view, setView] = useState<CalendarView>(defaultView);
  const [anchor, setAnchor] = useState<Date>(() => new Date());

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    }
  }, [view]);
  const [form, setForm] = useState<FormState>({
    open: false,
    event: null,
    occurrence: null,
    defaultDay: undefined,
  });

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const occurrences = useMemo<EventOccurrence[]>(() => {
    return expandOccurrences(events, { start: range.gridStart, end: range.gridEnd });
  }, [events, range.gridStart, range.gridEnd]);

  const canEdit = isParent();

  function openCreateAt(day: Date) {
    if (!canEdit) return;
    setForm({ open: true, event: null, occurrence: null, defaultDay: day });
  }

  function openEvent(occ: EventOccurrence) {
    // Parents see the editable EventForm; helpers see a read-only
    // EventDetails. Both branches share the same modal shell below.
    setForm({
      open: true,
      event: events.find((e) => e.id === occ.event.id) ?? null,
      occurrence: occ,
      defaultDay: undefined,
    });
  }

  function closeForm() {
    setForm({ open: false, event: null, occurrence: null, defaultDay: undefined });
  }

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <p className="text-[13px] uppercase tracking-wider text-muted mb-1">Calendar</p>
          <h1 className="text-[30px] font-medium text-ink tnum">
            {viewLabel(view, anchor)}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center bg-white border border-line rounded-full p-0.5">
            {VIEW_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setView(o.value)}
                className={[
                  "px-3 h-8 rounded-full text-[14px] font-medium transition-colors",
                  view === o.value ? "bg-primary text-white" : "text-muted hover:text-ink",
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
              className="size-9 grid place-items-center rounded-md bg-white border border-line text-muted hover:text-ink"
              aria-label="Previous"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setAnchor(new Date())}
              className="h-9 px-3 rounded-md bg-white border border-line text-[14px] text-muted hover:text-ink"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setAnchor((d) => shiftAnchor(view, d, 1))}
              className="size-9 grid place-items-center rounded-md bg-white border border-line text-muted hover:text-ink"
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
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[14px] px-4 py-3">
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="bg-white border border-line rounded-lg p-10 text-center text-muted text-[15px]">
          Loading…
        </div>
      ) : view === "agenda" ? (
        <CalendarAgenda
          start={range.start}
          occurrences={occurrences}
          onSelectEvent={openEvent}
        />
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
        title={
          canEdit
            ? form.event ? "Edit event" : "New event"
            : "Event"
        }
        size="lg"
      >
        {canEdit ? (
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
        ) : form.event && form.occurrence ? (
          <EventDetails
            event={form.event}
            occurrence={form.occurrence}
            members={members}
          />
        ) : null}
      </Modal>
    </section>
  );
}
