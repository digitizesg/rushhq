import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  CalendarEvent,
  CalendarReminder,
  EventAttachment,
  FamilyMember,
} from "@/lib/types";

export interface FullEvent extends CalendarEvent {
  attendee_ids: string[];
  reminders: CalendarReminder[];
  attachments: EventAttachment[];
}

interface CalendarData {
  loading: boolean;
  events: FullEvent[];
  members: FamilyMember[];
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Loads all events with their attendees + reminders, plus the active
 * family roster. Recurring events are stored as a single row so we can
 * load them all once and expand client-side per visible window.
 */
export function useCalendarData(): CalendarData {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<FullEvent[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memberRes, eventRes] = await Promise.all([
        supabase
          .from("family_members")
          .select("*")
          .eq("active", true)
          .order("short_name"),
        supabase
          .from("calendar_events")
          .select(
            `
            *,
            attendees:calendar_event_attendees(member_id),
            reminders:calendar_reminders(*),
            attachments:event_attachments(*)
          `,
          ),
      ]);

      if (memberRes.error) throw memberRes.error;
      if (eventRes.error) throw eventRes.error;

      setMembers((memberRes.data as FamilyMember[]) ?? []);
      const rows = (eventRes.data ?? []) as Array<
        CalendarEvent & {
          attendees: Array<{ member_id: string }>;
          reminders: CalendarReminder[];
          attachments: EventAttachment[];
        }
      >;
      setEvents(
        rows.map((r) => ({
          ...r,
          attendee_ids: r.attendees.map((a) => a.member_id),
          reminders: r.reminders.sort((a, b) => a.lead_time_minutes - b.lead_time_minutes),
          attachments: (r.attachments ?? []).sort((a, b) =>
            a.file_name.localeCompare(b.file_name),
          ),
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { loading, events, members, error, reload };
}
