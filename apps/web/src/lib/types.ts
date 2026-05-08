// Shared types that mirror the Postgres schema. We don't auto-generate
// from Supabase types here — the schema is small enough that the
// duplication is worth it for clarity.

export type MemberRole = "parent" | "helper" | "child";
export type MemberType = "parent" | "helper" | "child";
export type EventVisibility = "family" | "parents";
export type ReminderChannel = "telegram" | "email" | "both";

export type NotificationEventType =
  | "calendar_reminder"
  | "calendar_event_created"
  | "calendar_event_updated"
  | "calendar_event_cancelled"
  | "task_reminder";

export type PreferredChannel = "both" | "telegram" | "email";

export interface FamilyMember {
  id: string;
  auth_user_id: string | null;
  short_name: string;
  full_name: string;
  role: MemberRole;
  member_type: MemberType;
  email: string | null;
  avatar_url: string | null;
  preferred_channel: PreferredChannel;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type EventType =
  | "school"
  | "activity"
  | "family"
  | "personal"
  | "travel"
  | "other";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  rrule: string | null;
  visibility: EventVisibility;
  notify_extra_roles: boolean;
  event_type: EventType;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const EVENT_TYPE_OPTIONS: ReadonlyArray<{ value: EventType; label: string }> = [
  { value: "school",   label: "School" },
  { value: "activity", label: "Activity" },
  { value: "family",   label: "Family" },
  { value: "personal", label: "Personal" },
  { value: "travel",   label: "Travel" },
  { value: "other",    label: "Other" },
];

export interface CalendarReminder {
  id: string;
  event_id: string;
  lead_time_minutes: number;
  channel: ReminderChannel;
  created_at: string;
}

export interface EventAttachment {
  id: string;
  event_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface TelegramContact {
  member_id: string;
  pending_token: string | null;
  pending_token_expires_at: string | null;
  chat_id: number | null;
  telegram_username: string | null;
  linked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreference {
  member_id: string;
  event_type: NotificationEventType;
  telegram_enabled: boolean;
  email_enabled: boolean;
  updated_at: string;
}

export interface DispatchLogEntry {
  id: string;
  reminder_id: string | null;
  event_id: string | null;
  member_id: string | null;
  channel: "telegram" | "email";
  status: "queued" | "sent" | "failed" | "skipped";
  scheduled_for: string | null;
  dispatched_at: string;
  payload: Record<string, unknown> | null;
  error_message: string | null;
}

export const NOTIFICATION_EVENT_TYPES: ReadonlyArray<{
  value: NotificationEventType;
  label: string;
}> = [
  { value: "calendar_reminder", label: "Calendar reminders" },
  { value: "calendar_event_created", label: "New events" },
  { value: "calendar_event_updated", label: "Event updates" },
  { value: "calendar_event_cancelled", label: "Cancellations" },
  { value: "task_reminder", label: "Task reminders" },
];
