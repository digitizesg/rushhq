-- Rush HQ — profile photos
-- =========================
-- Each family_members row gets an optional avatar_url. Files live in
-- the public "avatars" bucket at <member_id>/<filename>. Members
-- (with an auth user) can upload to their own folder; parents can
-- upload on behalf of anyone (so they can add a photo for the
-- kids before the kids have their own login).

alter table family_members add column if not exists avatar_url text;

-- ----------------------------------------------------------------------------
-- Storage bucket
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Storage policies
-- ----------------------------------------------------------------------------

drop policy if exists "Avatars: anyone can read"        on storage.objects;
drop policy if exists "Avatars: members upload own"     on storage.objects;
drop policy if exists "Avatars: members update own"     on storage.objects;
drop policy if exists "Avatars: members delete own"     on storage.objects;

create policy "Avatars: anyone can read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Avatars: members upload own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (
        select id::text from public.family_members
         where auth_user_id = auth.uid()
      )
      or public.is_parent()
    )
  );

create policy "Avatars: members update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (
        select id::text from public.family_members
         where auth_user_id = auth.uid()
      )
      or public.is_parent()
    )
  );

create policy "Avatars: members delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (
        select id::text from public.family_members
         where auth_user_id = auth.uid()
      )
      or public.is_parent()
    )
  );
