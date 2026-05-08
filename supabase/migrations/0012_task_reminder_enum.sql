-- Adds the 'task_reminder' value to notification_event_type.
--
-- Lives in its own migration on purpose: Postgres won't let a freshly
-- added enum value be referenced in the same transaction that creates
-- it (error 55P04, "unsafe use of new value"). Splitting the ADD VALUE
-- into a separate migration commits the enum change before the next
-- migration tries to cast a string to it.

alter type notification_event_type add value if not exists 'task_reminder';
