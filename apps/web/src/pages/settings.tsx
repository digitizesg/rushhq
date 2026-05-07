import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/auth-context";
import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
  type NotificationPreference,
} from "@/lib/types";
import { TelegramCard } from "@/components/telegram-card";
import { Button } from "@/components/button";

export default function SettingsPage() {
  const { user, member } = useAuth();
  const [prefs, setPrefs] = useState<Record<NotificationEventType, { telegram: boolean; email: boolean }>>(() =>
    Object.fromEntries(
      NOTIFICATION_EVENT_TYPES.map((t) => [t.value, { telegram: true, email: true }]),
    ) as Record<NotificationEventType, { telegram: boolean; email: boolean }>,
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("member_id", member.id);
      if (cancelled || error) return;
      const next = Object.fromEntries(
        NOTIFICATION_EVENT_TYPES.map((t) => [t.value, { telegram: true, email: true }]),
      ) as Record<NotificationEventType, { telegram: boolean; email: boolean }>;
      for (const row of (data as NotificationPreference[]) ?? []) {
        next[row.event_type] = {
          telegram: row.telegram_enabled,
          email: row.email_enabled,
        };
      }
      setPrefs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [member]);

  async function toggle(
    eventType: NotificationEventType,
    channel: "telegram" | "email",
    next: boolean,
  ) {
    if (!member) return;
    const key = `${eventType}:${channel}`;
    setSavingKey(key);
    const previous = prefs[eventType];
    const updated = { ...previous, [channel]: next };
    setPrefs((p) => ({ ...p, [eventType]: updated }));
    const { error } = await supabase.from("notification_preferences").upsert(
      {
        member_id: member.id,
        event_type: eventType,
        telegram_enabled: updated.telegram,
        email_enabled: updated.email,
      },
      { onConflict: "member_id,event_type" },
    );
    if (error) {
      console.error("[settings] preference save failed:", error);
      setPrefs((p) => ({ ...p, [eventType]: previous })); // revert
    }
    setSavingKey(null);
  }

  async function sendReset() {
    if (!user?.email) return;
    setResetError(null);
    setResetSent(false);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) setResetError(error.message);
    else setResetSent(true);
  }

  return (
    <section className="mx-auto max-w-[760px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">Settings</p>
        <h1 className="text-[28px] font-medium text-ink">Your account</h1>
      </div>

      <section className="bg-white border border-line rounded-lg p-6">
        <p className="text-[18px] font-medium text-ink mb-3">Profile</p>
        <dl className="grid grid-cols-3 gap-y-2 text-[14px]">
          <dt className="text-muted">Short name</dt>
          <dd className="col-span-2 text-ink">{member?.short_name}</dd>
          <dt className="text-muted">Full name</dt>
          <dd className="col-span-2 text-ink">{member?.full_name}</dd>
          <dt className="text-muted">Role</dt>
          <dd className="col-span-2 text-ink capitalize">{member?.role}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="col-span-2 text-ink">{user?.email}</dd>
        </dl>
      </section>

      <section className="bg-white border border-line rounded-lg p-6">
        <p className="text-[18px] font-medium text-ink mb-1">
          Notifications
        </p>
        <p className="text-muted text-[13.5px] mb-4">
          Pick how you'd like each kind of message to reach you.
        </p>
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-[14px]">
            <thead className="bg-soft">
              <tr className="text-left text-muted text-[12.5px]">
                <th className="font-medium px-4 py-2.5">Event</th>
                <th className="font-medium px-4 py-2.5 w-28">Telegram</th>
                <th className="font-medium px-4 py-2.5 w-28">Email</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENT_TYPES.map((t, idx) => {
                const row = prefs[t.value];
                const isLast = idx === NOTIFICATION_EVENT_TYPES.length - 1;
                return (
                  <tr key={t.value} className={isLast ? "" : "border-b border-line"}>
                    <td className="px-4 py-3 text-ink">{t.label}</td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={row.telegram}
                        disabled={savingKey === `${t.value}:telegram`}
                        onChange={(v) => toggle(t.value, "telegram", v)}
                        ariaLabel={`Telegram ${t.label}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={row.email}
                        disabled={savingKey === `${t.value}:email`}
                        onChange={(v) => toggle(t.value, "email", v)}
                        ariaLabel={`Email ${t.label}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {member && (
        <TelegramCard memberId={member.id} heading="Telegram" />
      )}

      <section className="bg-white border border-line rounded-lg p-6">
        <p className="text-[18px] font-medium text-ink mb-1">Password</p>
        <p className="text-muted text-[13.5px] mb-4">
          We'll email you a link to set a new one.
        </p>
        <Button variant="secondary" onClick={sendReset}>
          Send reset email
        </Button>
        {resetSent && (
          <p className="mt-3 text-primary text-[13px]">Reset link sent. Check your inbox.</p>
        )}
        {resetError && (
          <p className="mt-3 text-danger text-[13px]">{resetError}</p>
        )}
      </section>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-border-warm",
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
      />
    </button>
  );
}
