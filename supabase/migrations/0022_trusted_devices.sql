-- Trusted devices for MFA
-- ========================
-- Lets a user check "trust this device for 30 days" after successfully
-- completing the TOTP challenge. The login flow looks up a row keyed
-- by (auth_user_id × random device_id stored in localStorage); if it
-- exists and isn't expired, the TOTP step is skipped on subsequent
-- sign-ins from the same browser.
--
-- Security note: this is "remember 2FA", not "remember login". The
-- password is still required every time. The trust window only
-- bypasses the TOTP prompt.

create table trusted_devices (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  device_id     text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '30 days'),
  unique (auth_user_id, device_id)
);

create index trusted_devices_user_idx on trusted_devices (auth_user_id);

-- ----------------------------------------------------------------------------
-- RLS — each user manages their own rows
-- ----------------------------------------------------------------------------

alter table trusted_devices enable row level security;

create policy "Users manage own trusted devices"
  on trusted_devices for all
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());
