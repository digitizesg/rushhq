-- Rush HQ — schedule the dispatcher
-- ==================================
-- Wires pg_cron + pg_net so Postgres calls the dispatch-reminders edge
-- function every 5 minutes.
--
-- The function URL is hardcoded — it's not secret. The service role
-- key is read from Supabase Vault, which is the recommended pattern
-- on modern Supabase projects (ALTER DATABASE SET is locked down for
-- security, so the older "GUC" approach no longer works).
--
-- Setup before running this migration:
--
--   In the SQL editor of the project:
--     select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'rushhq_service_role_key');
--
-- Then re-run `supabase db push` so the cron job here can find the secret.
-- The migration is idempotent — re-running drops and reschedules.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare existing_jobid bigint;
begin
  select jobid into existing_jobid from cron.job where jobname = 'rushhq-dispatch-reminders';
  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;
end $$;

-- The function URL is derived from the project ref; embed it in the
-- migration so different environments need only change this one line.
-- The service role key is read from Vault on every fire.
select cron.schedule(
  'rushhq-dispatch-reminders',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://kkwslqdqwnzcpsunhdsj.supabase.co/functions/v1/dispatch-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization',
          'Bearer ' || (
            select decrypted_secret
              from vault.decrypted_secrets
             where name = 'rushhq_service_role_key'
             limit 1
          )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

comment on extension pg_cron is
  'Schedules the dispatch-reminders edge function every 5 minutes. Reads the service role key from Vault (vault.create_secret(...)).';
