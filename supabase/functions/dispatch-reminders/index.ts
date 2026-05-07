// Rush HQ — dispatch-reminders edge function
// =============================================
// Triggered by pg_cron every 5 minutes. Fetches calendar reminders that
// should fire in the next window, expands RRULEs client-side, and sends
// each attendee their Telegram and/or email reminder.
//
// Idempotent: the unique dedupe index on notification_dispatch_log
// (reminder_id, member_id, channel, scheduled_for) prevents double-sends
// even if pg_cron retries or the function is invoked manually.

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { rrulestr } from "https://esm.sh/rrule@2.8.1";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://rushhq.co";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "Rush HQ <hello@rushhq.co>";

// Dispatch window. We look at [now - 1min, now + 6min] each tick. The
// cron interval is 5min so the small overlap is intentional — a reminder
// scheduled exactly on a tick boundary still gets caught, and the dedupe
// constraint stops the same reminder being sent twice.
const WINDOW_START_OFFSET_MS = -60 * 1000; // 1 min in the past
const WINDOW_END_OFFSET_MS = 6 * 60 * 1000; // 6 min in the future

// ----------------------------------------------------------------------------
// Types matching fetch_dispatch_candidates output
// ----------------------------------------------------------------------------

interface Attendee {
  member_id: string;
  short_name: string;
  full_name: string;
  email: string | null;
  role: "parent" | "helper" | "child";
  telegram_chat_id: number | null;
  telegram_enabled: boolean;
  email_enabled: boolean;
}

interface Candidate {
  reminder_id: string;
  lead_time_minutes: number;
  channel: "telegram" | "email" | "both";
  event_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  rrule: string | null;
  visibility: "family" | "parents";
  attendees: Attendee[];
}

// ----------------------------------------------------------------------------
// Telegram + Resend
// ----------------------------------------------------------------------------

async function sendTelegram(chatId: number, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `telegram ${res.status} · ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `telegram fetch · ${(e as Error).message}` };
  }
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `resend ${res.status} · ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `resend fetch · ${(e as Error).message}` };
  }
}

// ----------------------------------------------------------------------------
// Message rendering
// ----------------------------------------------------------------------------

function formatDateTime(dt: Date, allDay: boolean): string {
  const d = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(dt);
  if (allDay) return d;
  const t = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(dt);
  return `${d}, ${t}`;
}

function leadLabel(min: number): string {
  if (min === 0) return "now";
  if (min < 60) return `in ${min} minute${min === 1 ? "" : "s"}`;
  if (min === 60) return "in 1 hour";
  if (min < 24 * 60) {
    const h = min / 60;
    return Number.isInteger(h) ? `in ${h} hours` : `in ${h.toFixed(1)} hours`;
  }
  const d = Math.round(min / (24 * 60));
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

function renderTelegramText(c: Candidate, scheduledFor: Date, occurrenceStart: Date): string {
  const lines: string[] = [
    `<b>${escapeHtml(c.title)}</b>`,
    `${leadLabel(c.lead_time_minutes)} · ${formatDateTime(occurrenceStart, c.all_day)}`,
  ];
  if (c.location) lines.push(`📍 ${escapeHtml(c.location)}`);
  if (c.description) lines.push("", escapeHtml(c.description));
  return lines.join("\n");
}

function renderEmail(c: Candidate, occurrenceStart: Date): { subject: string; html: string; text: string } {
  const when = formatDateTime(occurrenceStart, c.all_day);
  const subject = `Reminder · ${c.title} · ${when}`;
  const lines = [
    `Reminder: ${c.title}`,
    `When: ${when}`,
  ];
  if (c.location) lines.push(`Where: ${c.location}`);
  if (c.description) lines.push("", c.description);
  lines.push("", `View on Rush HQ: ${APP_URL}/calendar`);
  const text = lines.join("\n");
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #2a2118; line-height: 1.5;">
      <h2 style="font-family: 'Fraunces', Georgia, serif; font-weight: 500; color: #2a2118; margin: 0 0 8px;">${escapeHtml(c.title)}</h2>
      <p style="margin: 0 0 4px; color: #6b5d4c;">${escapeHtml(when)}</p>
      ${c.location ? `<p style="margin: 0 0 4px; color: #6b5d4c;">📍 ${escapeHtml(c.location)}</p>` : ""}
      ${c.description ? `<p style="margin: 16px 0 0;">${escapeHtml(c.description).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="margin: 24px 0 0; font-size: 13px;"><a href="${APP_URL}/calendar" style="color: #5d8a4e;">View on Rush HQ</a></p>
    </div>
  `;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ----------------------------------------------------------------------------
// Occurrence resolution
// ----------------------------------------------------------------------------

/**
 * Returns the occurrence starts (for the event) for which a reminder
 * should fire inside the dispatch window. A reminder fires at
 * (occurrence_start - lead_time_minutes), so we look for occurrences
 * whose firing time falls in [windowStart, windowEnd].
 */
function resolveScheduledTimes(
  c: Candidate,
  windowStart: Date,
  windowEnd: Date,
): Array<{ scheduledFor: Date; occurrenceStart: Date }> {
  const leadMs = c.lead_time_minutes * 60 * 1000;
  const baseStart = new Date(c.starts_at);

  if (!c.rrule) {
    const scheduledFor = new Date(baseStart.getTime() - leadMs);
    if (scheduledFor >= windowStart && scheduledFor <= windowEnd) {
      return [{ scheduledFor, occurrenceStart: baseStart }];
    }
    return [];
  }

  // Expand RRULE between (windowStart + lead) and (windowEnd + lead) so
  // any occurrence whose firing time falls in [windowStart, windowEnd]
  // is included.
  const occurrenceWindowStart = new Date(windowStart.getTime() + leadMs);
  const occurrenceWindowEnd = new Date(windowEnd.getTime() + leadMs);

  // rrulestr accepts either a bare RRULE or DTSTART:...\nRRULE:... blob.
  // The DTSTART comes from the event's starts_at column — without it the
  // library errors.
  const dtstartLine = `DTSTART:${formatDateForRrule(baseStart)}`;
  const rruleText = c.rrule.startsWith("DTSTART") ? c.rrule : `${dtstartLine}\n${c.rrule}`;

  let set: ReturnType<typeof rrulestr>;
  try {
    set = rrulestr(rruleText, { forceset: true });
  } catch (e) {
    console.error(`[dispatch] failed to parse RRULE for event ${c.event_id}:`, (e as Error).message);
    return [];
  }

  const occurrences = set.between(occurrenceWindowStart, occurrenceWindowEnd, true);
  return occurrences.map((occ: Date) => ({
    scheduledFor: new Date(occ.getTime() - leadMs),
    occurrenceStart: occ,
  }));
}

function formatDateForRrule(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------

Deno.serve(async (_req) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Not configured", { status: 503 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_START_OFFSET_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_END_OFFSET_MS);

  const { data: candidates, error } = await supabase.rpc(
    "fetch_dispatch_candidates",
    {
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
    },
  );

  if (error) {
    console.error("[dispatch] fetch_dispatch_candidates failed:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const list = (candidates ?? []) as Candidate[];

  let dispatched = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of list) {
    const slots = resolveScheduledTimes(c, windowStart, windowEnd);
    if (slots.length === 0) continue;

    for (const slot of slots) {
      for (const attendee of c.attendees ?? []) {
        const wantTelegram =
          (c.channel === "telegram" || c.channel === "both") &&
          attendee.telegram_enabled &&
          attendee.telegram_chat_id != null;
        const wantEmail =
          (c.channel === "email" || c.channel === "both") &&
          attendee.email_enabled &&
          !!attendee.email;

        const channels: Array<"telegram" | "email"> = [];
        if (wantTelegram) channels.push("telegram");
        if (wantEmail) channels.push("email");

        if (channels.length === 0) {
          // Nothing to send — log a single skipped row so it's visible in
          // the audit log without spamming one row per "channel".
          await supabase.from("notification_dispatch_log").insert({
            reminder_id: c.reminder_id,
            event_id: c.event_id,
            member_id: attendee.member_id,
            channel: "telegram",
            status: "skipped",
            scheduled_for: slot.scheduledFor.toISOString(),
            error_message: "No enabled channel or contact details",
          });
          skipped++;
          continue;
        }

        for (const ch of channels) {
          // Pre-claim the dispatch row to honour the unique dedupe index
          // before we actually send. If insert fails with 23505, another
          // run already handled this slot — skip silently.
          const { error: insertErr } = await supabase
            .from("notification_dispatch_log")
            .insert({
              reminder_id: c.reminder_id,
              event_id: c.event_id,
              member_id: attendee.member_id,
              channel: ch,
              status: "queued",
              scheduled_for: slot.scheduledFor.toISOString(),
            });

          if (insertErr) {
            const msg = insertErr.message ?? "";
            if (msg.includes("duplicate key") || (insertErr as any).code === "23505") {
              continue;
            }
            console.error("[dispatch] log pre-claim failed:", insertErr);
            continue;
          }

          let result: { ok: true } | { ok: false; error: string };
          if (ch === "telegram") {
            const text = renderTelegramText(c, slot.scheduledFor, slot.occurrenceStart);
            result = await sendTelegram(attendee.telegram_chat_id!, text);
          } else {
            const { subject, html, text } = renderEmail(c, slot.occurrenceStart);
            result = await sendEmail(attendee.email!, subject, html, text);
          }

          // Update the row we just inserted to reflect the outcome.
          // Using the dedupe index ensures we update exactly one row.
          await supabase
            .from("notification_dispatch_log")
            .update({
              status: result.ok ? "sent" : "failed",
              error_message: result.ok ? null : result.error,
              dispatched_at: new Date().toISOString(),
            })
            .eq("reminder_id", c.reminder_id)
            .eq("member_id", attendee.member_id)
            .eq("channel", ch)
            .eq("scheduled_for", slot.scheduledFor.toISOString());

          if (result.ok) dispatched++;
          else failed++;
        }
      }
    }
  }

  const summary = { ok: true, candidates: list.length, dispatched, skipped, failed };
  console.log("[dispatch] summary:", JSON.stringify(summary));
  return new Response(JSON.stringify(summary), {
    headers: { "content-type": "application/json" },
  });
});
