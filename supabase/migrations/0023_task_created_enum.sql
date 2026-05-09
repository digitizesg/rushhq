-- Adds 'task_created' to notification_event_type so the dispatcher
-- can route a "newly assigned to you" ping. Lives in its own
-- migration because Postgres won't let a freshly added enum value
-- be referenced in the same transaction that creates it.

alter type notification_event_type add value if not exists 'task_created';
