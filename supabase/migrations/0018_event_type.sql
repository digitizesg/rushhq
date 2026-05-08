-- Calendar events: event_type
-- =============================
-- Adds a coarse activity-type tag (school, activity, family, personal,
-- travel, other) so the calendar can colour-code events by what they
-- are rather than just who's involved. Stored as text — no enum
-- constraint — so future categories can be added without a migration.

alter table calendar_events
  add column if not exists event_type text not null default 'other';

-- ----------------------------------------------------------------------------
-- Re-create the create + update RPCs with the new param.
-- ----------------------------------------------------------------------------

drop function if exists public.create_calendar_event(
  text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb, boolean
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
  p_event_type          text
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
    all_day, rrule, visibility, notify_extra_roles, event_type, created_by
  )
  values (
    p_title, nullif(p_description, ''), nullif(p_location, ''),
    p_starts_at, p_ends_at, p_all_day,
    nullif(p_rrule, ''), p_visibility,
    coalesce(p_notify_extra_roles, false),
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

  return v_event_id;
end;
$$;

grant execute on function public.create_calendar_event(
  text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb, boolean, text
) to authenticated;


drop function if exists public.update_calendar_event(
  uuid, text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb, boolean
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
  p_notify_extra_roles  boolean,
  p_event_type          text
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
         notify_extra_roles = coalesce(p_notify_extra_roles, false),
         event_type         = coalesce(nullif(p_event_type, ''), 'other')
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
  uuid, text, text, text, timestamptz, timestamptz, boolean, text, event_visibility, uuid[], jsonb, boolean, text
) to authenticated;
