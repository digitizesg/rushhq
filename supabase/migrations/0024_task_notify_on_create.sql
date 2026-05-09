-- Tasks: notify-on-create
-- ========================
-- create_task gains an optional p_notify_on_create boolean. When true,
-- it enqueues task_created outbox rows for every assignee, alongside
-- the lead-time reminder rows that already fire later.

drop function if exists public.create_task(text, text, uuid[], date, time, text, jsonb);

create or replace function public.create_task(
  p_title              text,
  p_description        text,
  p_assignee_ids       uuid[],
  p_due_date           date,
  p_due_time           time,
  p_rrule              text,
  p_reminders          jsonb,
  p_notify_on_create   boolean
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

  if coalesce(p_notify_on_create, false) then
    insert into notification_outbox (event_type, member_id, payload)
    select 'task_created'::notification_event_type, m.id,
           jsonb_build_object(
             'task_id',     v_task_id,
             'title',       trim(p_title),
             'due_date',    p_due_date,
             'due_time',    p_due_time,
             'rrule',       nullif(trim(coalesce(p_rrule, '')), ''),
             'description', nullif(trim(coalesce(p_description, '')), '')
           )
      from family_members m
     where m.active = true
       and m.id = any(coalesce(p_assignee_ids, '{}'::uuid[]));
  end if;

  return v_task_id;
end;
$$;

grant execute on function public.create_task(
  text, text, uuid[], date, time, text, jsonb, boolean
) to authenticated;
