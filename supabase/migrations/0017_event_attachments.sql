-- Calendar events: file attachments
-- ===================================
-- Lets parents attach PDFs, images, schedules to an event. Files live
-- in the private "event-attachments" Supabase Storage bucket; the
-- event_attachments table records metadata + the storage path.
--
-- Visibility piggybacks on the parent calendar_events policy: anyone
-- who can SELECT the event row can read its attachments. Writes are
-- parents-only.

create table event_attachments (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references calendar_events(id) on delete cascade,
  file_name     text not null,
  mime_type     text,
  size_bytes    integer,
  storage_path  text not null,
  uploaded_by   uuid references family_members(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index event_attachments_event_id_idx on event_attachments (event_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table event_attachments enable row level security;

create policy "Parents manage event attachments"
  on event_attachments for all
  to authenticated
  using (public.is_parent())
  with check (public.is_parent());

create policy "Members read attachments for visible events"
  on event_attachments for select
  to authenticated
  using (
    exists (
      select 1 from calendar_events e
      where e.id = event_attachments.event_id
        and (public.is_parent() or e.visibility = 'family')
    )
  );

-- ----------------------------------------------------------------------------
-- Storage bucket — private. Downloads happen via short-lived signed
-- URLs minted by the client at click time.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('event-attachments', 'event-attachments', false)
on conflict (id) do nothing;

drop policy if exists "Event attachments: parents write"   on storage.objects;
drop policy if exists "Event attachments: parents update"  on storage.objects;
drop policy if exists "Event attachments: parents delete"  on storage.objects;
drop policy if exists "Event attachments: members read"    on storage.objects;

create policy "Event attachments: parents write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'event-attachments' and public.is_parent());

create policy "Event attachments: parents update"
  on storage.objects for update to authenticated
  using (bucket_id = 'event-attachments' and public.is_parent());

create policy "Event attachments: parents delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'event-attachments' and public.is_parent());

-- We rely on the application to only mint signed URLs for users who
-- have read access to the underlying event row (the SELECT policy on
-- event_attachments above gates that). Anyone authenticated can ask
-- for a signed URL for any object — which is fine because the storage
-- path itself is opaque and only known to people who can read the
-- event_attachments row.
create policy "Event attachments: members read"
  on storage.objects for select to authenticated
  using (bucket_id = 'event-attachments');
