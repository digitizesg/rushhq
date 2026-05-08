-- Calendar events: opt-in "also notify parents + helpers" flag
-- ==============================================================
-- Lets the event creator say "this event is just for Riley but I want
-- everyone responsible (parents, helper) to get the reminder ping".
-- Avoids polluting the attendee list with people who aren't actually
-- "going" but need to be aware of it.
--
-- Implementation: a boolean on calendar_events plus a UNION in
-- fetch_dispatch_candidates that pulls in active parents + helpers
-- alongside attendees when the flag is true.

alter table calendar_events
  add column if not exists notify_extra_roles boolean not null default false;

-- ----------------------------------------------------------------------------
-- Re-create the create + update RPCs with the new param.
-- ----------------------------------------------------------------------------

drop function if exists public.create_calendar_event(
  text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb
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
  p_notify_extra_roles  boolean
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
    all_day, rrule, visibility, notify_extra_roles, created_by
  )
  values (
    p_title, nullif(p_description, ''), nullif(p_location, ''),
    p_starts_at, p_ends_at, p_all_day,
    nullif(p_rrule, ''), p_visibility,
    coalesce(p_notify_extra_roles, false),
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

  return v_event_id;
end;
$$;

grant execute on function public.create_calendar_event(
  text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb, boolean
) to authenticated;


drop function if exists public.update_calendar_event(
  uuid, text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb
);

create or replace function public.update_calendar_event(
  p_event_id            uuid,
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
  p_notify_extra_roles  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reminder jsonb;
begin
  if not public.is_parent() then
    raise exception 'Only parents can update events';
  end if;

  update calendar_events
     set title              = p_title,
         description        = nullif(p_description, ''),
         location           = nullif(p_location, ''),
         starts_at          = p_starts_at,
         ends_at            = p_ends_at,
         all_day            = p_all_day,
         rrule              = nullif(p_rrule, ''),
         visibility         = p_visibility,
         notify_extra_roles = coalesce(p_notify_extra_roles, false)
   where id = p_event_id;

  if not found then
    raise exception 'Event % not found', p_event_id;
  end if;

  delete from calendar_event_attendees where event_id = p_event_id;
  if p_attendee_ids is not null and array_length(p_attendee_ids, 1) > 0 then
    insert into calendar_event_attendees (event_id, member_id)
    select p_event_id, m
      from unnest(p_attendee_ids) as m
     where exists (select 1 from family_members fm where fm.id = m and fm.active = true);
  end if;

  delete from calendar_reminders where event_id = p_event_id;
  if p_reminders is not null and jsonb_array_length(p_reminders) > 0 then
    for v_reminder in select * from jsonb_array_elements(p_reminders)
    loop
      insert into calendar_reminders (event_id, lead_time_minutes, channel)
      values (
        p_event_id,
        (v_reminder->>'lead_time_minutes')::integer,
        (v_reminder->>'channel')::reminder_channel
      );
    end loop;
  end if;
end;
$$;

grant execute on function public.update_calendar_event(
  uuid, text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb, boolean
) to authenticated;

-- ----------------------------------------------------------------------------
-- Replace the dispatch candidates helper to UNION extra roles in
-- when the flag is true. The aggregation is done in a CTE so a member
-- only appears once even if they're both an attendee and an extra-role
-- recipient.
-- ----------------------------------------------------------------------------

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
      e.visibility,
      e.notify_extra_roles
    from calendar_events e
  ),
  recipients as (
    -- Attendees listed on the event.
    select a.event_id, m.id as member_id
      from calendar_event_attendees a
      join family_members m on m.id = a.member_id and m.active = true
    union
    -- All active parents + helpers, only when the event opts in.
    select e.id as event_id, m.id as member_id
      from ev e
      join family_members m on m.active = true and m.role in ('parent','helper')
     where e.notify_extra_roles = true
  ),
  resolved as (
    select
      r.event_id,
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
    from recipients r
    join family_members m on m.id = r.member_id
    left join telegram_contacts tc on tc.member_id = m.id
    left join notification_preferences np
      on np.member_id = m.id
     and np.event_type = 'calendar_reminder'::notification_event_type
    group by r.event_id
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
  left join resolved ra on ra.event_id = ev.id
  where
    (ev.rrule is null
       and ev.starts_at - make_interval(mins => r.lead_time_minutes)
           between window_start and window_end)
    or
    ev.rrule is not null;
$$;

revoke all on function public.fetch_dispatch_candidates(timestamptz, timestamptz) from public;
grant execute on function public.fetch_dispatch_candidates(timestamptz, timestamptz) to service_role;
