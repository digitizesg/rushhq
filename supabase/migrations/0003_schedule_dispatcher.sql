-- Rush HQ — schedule the dispatcher
-- ==================================
-- Wires pg_cron + pg_net so Postgres calls the dispatch-reminders edge
-- function every 5 minutes. Run this AFTER deploying the edge function
-- and after you've set the project URL + service role key as
-- database settings (see runbook in README.md, step 9).
--
-- Required GUCs (set via the Supabase SQL editor, one-time):
--   alter database postgres set "app.settings.supabase_url" = 'https://YOUR_PROJECT_REF.supabase.co';
--   alter database postgres set "app.settings.service_role_key" = 'YOUR_SERVICE_ROLE_KEY';

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any existing schedule with the same name before
-- creating it, so this migration is safe to re-run.
do $$
declare existing_jobid bigint;
begin
  select jobid into existing_jobid from cron.job where jobname = 'rushhq-dispatch-reminders';
  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;
end $$;

select cron.schedule(
  'rushhq-dispatch-reminders',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/dispatch-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

comment on extension pg_cron is
  'Schedules the dispatch-reminders edge function every 5 minutes. See README.md step 9 for the one-time GUCs.';
