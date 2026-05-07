-- Rush HQ — dispatch helpers
-- ===========================
-- The dispatch-reminders edge function runs every 5 minutes via pg_cron.
-- It calls fetch_dispatch_candidates(window_start, window_end) to get
-- everything that *might* need sending in the window, then expands any
-- RRULEs in TypeScript and decides per-attendee whether to dispatch.
--
-- We do NOT materialise recurring occurrences here — only single-instance
-- events are filtered by start time. Recurring events with an rrule are
-- always returned (the dispatcher filters them after expansion). At family
-- scale this is fine; if the family ever has thousands of recurring
-- events we'd add a `next_occurrence_after` cache column.

create or replace function public.fetch_dispatch_candidates(
  window_start timestamptz,
  window_end   timestamptz
)
returns table (
  reminder_id        uuid,
  lead_time_minutes  integer,
  channel            reminder_channel,
  event_id           uuid,
  title              text,
  description        text,
  location           text,
  starts_at          timestamptz,
  ends_at            timestamptz,
  all_day            boolean,
  rrule              text,
  visibility         event_visibility,
  attendees          jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select
      e.id,
      e.title,
      e.description,
      e.location,
      e.starts_at,
      e.ends_at,
      e.all_day,
      e.rrule,
      e.visibility
    from calendar_events e
  ),
  resolved_attendees as (
    select
      a.event_id,
      jsonb_agg(
        jsonb_build_object(
          'member_id', m.id,
          'short_name', m.short_name,
          'full_name', m.full_name,
          'email', m.email,
          'role', m.role,
          'telegram_chat_id', tc.chat_id,
          'telegram_enabled',
            coalesce(np.telegram_enabled, true),
          'email_enabled',
            coalesce(np.email_enabled, true)
        )
        order by m.short_name
      ) as attendees
    from calendar_event_attendees a
    join family_members m on m.id = a.member_id and m.active = true
    left join telegram_contacts tc on tc.member_id = m.id
    left join notification_preferences np
      on np.member_id = m.id
     and np.event_type = 'calendar_reminder'::notification_event_type
    group by a.event_id
  )
  select
    r.id            as reminder_id,
    r.lead_time_minutes,
    r.channel,
    ev.id           as event_id,
    ev.title,
    ev.description,
    ev.location,
    ev.starts_at,
    ev.ends_at,
    ev.all_day,
    ev.rrule,
    ev.visibility,
    coalesce(ra.attendees, '[]'::jsonb) as attendees
  from calendar_reminders r
  join ev on ev.id = r.event_id
  left join resolved_attendees ra on ra.event_id = ev.id
  where
    -- Non-recurring events: only return if the reminder fires inside
    -- the dispatch window.
    (ev.rrule is null
       and ev.starts_at - make_interval(mins => r.lead_time_minutes)
           between window_start and window_end)
    or
    -- Recurring events: always return; the edge function expands the
    -- RRULE and filters per occurrence.
    ev.rrule is not null;
$$;

comment on function public.fetch_dispatch_candidates(timestamptz, timestamptz) is
  'Returns reminders the dispatcher should evaluate. Single-instance events are pre-filtered to the window; recurring events are always returned for client-side RRULE expansion.';

revoke all on function public.fetch_dispatch_candidates(timestamptz, timestamptz) from public;
grant execute on function public.fetch_dispatch_candidates(timestamptz, timestamptz) to service_role;
