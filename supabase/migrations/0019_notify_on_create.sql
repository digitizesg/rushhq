-- Calendar events: enqueue calendar_event_created outbox rows
-- ============================================================
-- The create_calendar_event RPC gains an optional p_notify_on_create
-- boolean. When true, it inserts notification_outbox rows for every
-- attendee + (if the event has notify_extra_roles set) every active
-- parent + helper, with the calendar_event_created event type. The
-- existing dispatcher drains the outbox each tick and renders the
-- message via renderOutboxMessage.
--
-- The notification_preferences table already supports per-member
-- mute on calendar_event_created — see Settings → Notifications.

drop function if exists public.create_calendar_event(
  text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb, boolean, text
);

create or replace function public.create_calendar_event(
  p_title               text,
  p_description         text,
  p_location            text,
  p_starts_at           timestamptz,
  p_ends_at             timestamptz,
  p_all_day             boolean,
  p_rrule               text,
  p_visibility          event_visibility,
  p_attendee_ids        uuid[],
  p_reminders           jsonb,
  p_notify_extra_roles  boolean,
  p_event_type          text,
  p_notify_on_create    boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id   uuid;
  v_member_id  uuid;
  v_reminder   jsonb;
  v_notify     boolean := coalesce(p_notify_on_create, false);
  v_extra      boolean := coalesce(p_notify_extra_roles, false);
begin
  if not public.is_parent() then
    raise exception 'Only parents can create events';
  end if;
  v_member_id := public.current_member_id();
  if v_member_id is null then
    raise exception 'No family member linked to this auth user';
  end if;

  insert into calendar_events (
    title, description, location, starts_at, ends_at,
    all_day, rrule, visibility, notify_extra_roles, event_type, created_by
  )
  values (
    p_title, nullif(p_description, ''), nullif(p_location, ''),
    p_starts_at, p_ends_at, p_all_day,
    nullif(p_rrule, ''), p_visibility,
    v_extra,
    coalesce(nullif(p_event_type, ''), 'other'),
    v_member_id
  )
  returning id into v_event_id;

  if p_attendee_ids is not null and array_length(p_attendee_ids, 1) > 0 then
    insert into calendar_event_attendees (event_id, member_id)
    select v_event_id, m
      from unnest(p_attendee_ids) as m
     where exists (select 1 from family_members fm where fm.id = m and fm.active = true);
  end if;

  if p_reminders is not null and jsonb_array_length(p_reminders) > 0 then
    for v_reminder in select * from jsonb_array_elements(p_reminders)
    loop
      insert into calendar_reminders (event_id, lead_time_minutes, channel)
      values (
        v_event_id,
        (v_reminder->>'lead_time_minutes')::integer,
        (v_reminder->>'channel')::reminder_channel
      );
    end loop;
  end if;

  -- Fire-and-add: enqueue a calendar_event_created notification per
  -- recipient. Dedupe with a SELECT DISTINCT in case a member appears
  -- both as an attendee and as an extra-role recipient.
  if v_notify then
    insert into notification_outbox (event_type, member_id, payload)
    select distinct
           'calendar_event_created'::notification_event_type,
           m.id,
           jsonb_build_object(
             'event_id',     v_event_id,
             'title',        p_title,
             'starts_at',    p_starts_at,
             'ends_at',      p_ends_at,
             'all_day',      p_all_day,
             'location',     nullif(p_location, ''),
             'rrule',        nullif(p_rrule, ''),
             'event_type',   coalesce(nullif(p_event_type, ''), 'other'),
             'created_by',   v_member_id
           )
      from family_members m
     where m.active = true
       and (
         -- Attendees
         m.id = any(coalesce(p_attendee_ids, '{}'::uuid[]))
         or
         -- Extra-role recipients
         (v_extra and m.role in ('parent','helper'))
       );
  end if;

  return v_event_id;
end;
$$;

grant execute on function public.create_calendar_event(
  text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb, boolean, text, boolean
) to authenticated;
