-- Tasks: multi-assignee
-- ======================
-- Replaces the single tasks.assignee_id with a task_assignees join
-- table so a single task can be assigned to multiple people. Same
-- pattern as calendar_event_attendees.

create table task_assignees (
  task_id    uuid not null references tasks(id) on delete cascade,
  member_id  uuid not null references family_members(id) on delete cascade,
  primary key (task_id, member_id)
);

create index task_assignees_member_idx on task_assignees (member_id);

-- Backfill existing rows.
insert into task_assignees (task_id, member_id)
select id, assignee_id from tasks where assignee_id is not null
on conflict do nothing;

-- Drop the single-assignee column.
alter table tasks drop column assignee_id;

-- Drop the old indexes that referenced assignee_id.
drop index if exists tasks_assignee_idx;

create index tasks_status_due_idx on tasks (status, due_date);

-- ----------------------------------------------------------------------------
-- RLS — replace the old "Assignee reads own tasks" policy
-- ----------------------------------------------------------------------------

alter table task_assignees enable row level security;

create policy "Parents manage all task assignees"
  on task_assignees for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

create policy "Members read own task assignments"
  on task_assignees for select
  to authenticated
  using (member_id = public.current_member_id());

drop policy if exists "Assignee reads own tasks" on tasks;

create policy "Assignees read own tasks"
  on tasks for select
  to authenticated
  using (
    exists (
      select 1 from task_assignees ta
       where ta.task_id = tasks.id
         and ta.member_id = public.current_member_id()
    )
  );

-- ----------------------------------------------------------------------------
-- RPCs: re-create with the new model
-- ----------------------------------------------------------------------------

drop function if exists public.create_task(text, text, uuid, date, time, text, jsonb);
drop function if exists public.update_task(uuid, text, text, uuid, date, time, text, jsonb);

create or replace function public.create_task(
  p_title         text,
  p_description   text,
  p_assignee_ids  uuid[],
  p_due_date      date,
  p_due_time      time,
  p_rrule         text,
  p_reminders     jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_task_id   uuid;
begin
  if not public.is_parent() then
    raise exception 'Only parents can create tasks';
  end if;
  v_caller_id := public.current_member_id();

  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Title is required';
  end if;
  if p_due_date is null then
    raise exception 'Due date is required';
  end if;
  if p_assignee_ids is null or array_length(p_assignee_ids, 1) is null then
    raise exception 'At least one assignee is required';
  end if;

  insert into tasks (title, description, due_date, due_time, rrule, created_by)
  values (
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    p_due_date,
    p_due_time,
    nullif(trim(coalesce(p_rrule, '')), ''),
    v_caller_id
  )
  returning id into v_task_id;

  insert into task_assignees (task_id, member_id)
  select v_task_id, m
    from unnest(p_assignee_ids) as m
   where exists (select 1 from family_members fm where fm.id = m and fm.active = true)
  on conflict do nothing;

  if p_reminders is not null then
    insert into task_reminders (task_id, lead_time_minutes, channel)
    select
      v_task_id,
      (r->>'lead_time_minutes')::integer,
      (r->>'channel')::reminder_channel
    from jsonb_array_elements(p_reminders) as r;
  end if;

  return v_task_id;
end;
$$;

grant execute on function public.create_task(text, text, uuid[], date, time, text, jsonb) to authenticated;


create or replace function public.update_task(
  p_task_id       uuid,
  p_title         text,
  p_description   text,
  p_assignee_ids  uuid[],
  p_due_date      date,
  p_due_time      time,
  p_rrule         text,
  p_reminders     jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Only parents can edit tasks';
  end if;
  if p_assignee_ids is null or array_length(p_assignee_ids, 1) is null then
    raise exception 'At least one assignee is required';
  end if;

  update tasks
     set title       = trim(p_title),
         description = nullif(trim(coalesce(p_description, '')), ''),
         due_date    = p_due_date,
         due_time    = p_due_time,
         rrule       = nullif(trim(coalesce(p_rrule, '')), '')
   where id = p_task_id;
  if not found then raise exception 'Task % not found', p_task_id; end if;

  delete from task_assignees where task_id = p_task_id;
  insert into task_assignees (task_id, member_id)
  select p_task_id, m
    from unnest(p_assignee_ids) as m
   where exists (select 1 from family_members fm where fm.id = m and fm.active = true)
  on conflict do nothing;

  delete from task_reminders where task_id = p_task_id;
  if p_reminders is not null then
    insert into task_reminders (task_id, lead_time_minutes, channel)
    select p_task_id,
           (r->>'lead_time_minutes')::integer,
           (r->>'channel')::reminder_channel
    from jsonb_array_elements(p_reminders) as r;
  end if;
end;
$$;

grant execute on function public.update_task(uuid, text, text, uuid[], date, time, text, jsonb) to authenticated;

-- complete_task + snooze_task: any assignee or parent can act.
create or replace function public.complete_task(
  p_task_id        uuid,
  p_next_due_date  date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member uuid;
  v_has_rrule     boolean;
  v_is_assignee   boolean;
begin
  v_caller_member := public.current_member_id();

  select rrule is not null into v_has_rrule from tasks where id = p_task_id;
  if not found then raise exception 'Task % not found', p_task_id; end if;

  select exists (
    select 1 from task_assignees
     where task_id = p_task_id and member_id = v_caller_member
  ) into v_is_assignee;

  if not public.is_parent() and not v_is_assignee then
    raise exception 'Only an assignee or a parent can complete this task';
  end if;

  if v_has_rrule and p_next_due_date is not null then
    update tasks
       set due_date          = p_next_due_date,
           last_completed_at = now()
     where id = p_task_id;
  else
    update tasks
       set status            = 'done',
           completed_at      = now(),
           last_completed_at = now()
     where id = p_task_id;
  end if;
end;
$$;

grant execute on function public.complete_task(uuid, date) to authenticated;


create or replace function public.snooze_task(
  p_task_id  uuid,
  p_days     integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member uuid;
  v_is_assignee   boolean;
begin
  if p_days is null or p_days <= 0 or p_days > 30 then
    raise exception 'Snooze must be between 1 and 30 days';
  end if;

  v_caller_member := public.current_member_id();

  select exists (
    select 1 from task_assignees
     where task_id = p_task_id and member_id = v_caller_member
  ) into v_is_assignee;

  if not exists (select 1 from tasks where id = p_task_id) then
    raise exception 'Task % not found', p_task_id;
  end if;

  if not public.is_parent() and not v_is_assignee then
    raise exception 'Only an assignee or a parent can snooze this task';
  end if;

  update tasks
     set due_date = due_date + p_days
   where id = p_task_id;
end;
$$;

grant execute on function public.snooze_task(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Dispatch helper — fan out one row per (task × reminder × assignee)
-- ----------------------------------------------------------------------------

create or replace function public.fetch_task_dispatch_candidates(
  window_start timestamptz,
  window_end   timestamptz
)
returns table (
  reminder_id        uuid,
  lead_time_minutes  integer,
  channel            reminder_channel,
  task_id            uuid,
  title              text,
  description        text,
  assignee_id        uuid,
  assignee_short     text,
  assignee_email     text,
  assignee_role      member_role,
  telegram_chat_id   bigint,
  telegram_enabled   boolean,
  email_enabled      boolean,
  due_at             timestamptz,
  rrule              text
)
language sql
stable
security definer
set search_path = public
as $$
  with task_due as (
    select t.id, t.title, t.description, t.rrule,
           ((t.due_date::timestamp + coalesce(t.due_time, time '09:00')) at time zone 'Asia/Singapore') as due_at
      from tasks t
     where t.status = 'pending'
  )
  select
    r.id                 as reminder_id,
    r.lead_time_minutes,
    r.channel,
    td.id                as task_id,
    td.title,
    td.description,
    m.id                 as assignee_id,
    m.short_name         as assignee_short,
    m.email              as assignee_email,
    m.role               as assignee_role,
    tc.chat_id           as telegram_chat_id,
    (coalesce(np.telegram_enabled, true) and m.preferred_channel in ('both','telegram')) as telegram_enabled,
    (coalesce(np.email_enabled,    true) and m.preferred_channel in ('both','email'))    as email_enabled,
    td.due_at,
    td.rrule
  from task_reminders r
  join task_due td      on td.id = r.task_id
  join task_assignees ta on ta.task_id = td.id
  join family_members m on m.id = ta.member_id and m.active = true
  left join telegram_contacts tc on tc.member_id = m.id
  left join notification_preferences np
    on np.member_id = m.id
   and np.event_type = 'task_reminder'::notification_event_type
  where
    (td.rrule is null
       and td.due_at - make_interval(mins => r.lead_time_minutes)
           between window_start and window_end)
    or
    td.rrule is not null;
$$;

revoke all on function public.fetch_task_dispatch_candidates(timestamptz, timestamptz) from public;
grant execute on function public.fetch_task_dispatch_candidates(timestamptz, timestamptz) to service_role;

-- The dispatcher's dedupe key on notification_dispatch_log is
-- (task_reminder_id, member_id, channel, scheduled_for) — already keyed
-- per assignee, so no further changes needed there.
