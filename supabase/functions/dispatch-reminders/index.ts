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

function mapsLink(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function renderTelegramText(c: Candidate, _scheduledFor: Date, occurrenceStart: Date): string {
  const lines: string[] = [
    `<b>${escapeHtml(c.title)}</b>`,
    `${leadLabel(c.lead_time_minutes)} · ${formatDateTime(occurrenceStart, c.all_day)}`,
  ];
  if (c.location) {
    // Telegram supports inline links; tap the pin to open Maps.
    lines.push(`📍 <a href="${mapsLink(c.location)}">${escapeHtml(c.location)}</a>`);
  }
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
  const html = richEmail({
    kicker: "Rush HQ · Reminder",
    title: c.title,
    when,
    location: c.location ?? null,
    notes: c.description ?? null,
    buttonUrl: `${APP_URL}/calendar`,
    buttonText: "Open in Rush HQ",
  });
  return { subject, html, text };
}

interface RichEmailOpts {
  kicker: string;
  title: string;
  when: string | null;
  location?: string | null;
  notes?: string | null;
  buttonUrl: string;
  buttonText: string;
}

/**
 * Single rich-email card used by calendar reminders, task reminders,
 * and the outbox event types. Table-based HTML for the broadest email
 * client support (Gmail, Apple Mail, Outlook).
 */
function richEmail(opts: RichEmailOpts): string {
  const titleSafe = escapeHtml(opts.title);
  const kickerSafe = escapeHtml(opts.kicker);
  const whenRow = opts.when
    ? `<tr><td style="padding:0 28px 6px;font-size:15px;color:#0f172a;">⏱ ${escapeHtml(opts.when)}</td></tr>`
    : "";
  const locRow = opts.location
    ? `<tr><td style="padding:0 28px 6px;font-size:15px;">📍 <a href="${mapsLink(
        opts.location,
      )}" style="color:#2563eb;text-decoration:none;">${escapeHtml(opts.location)}</a></td></tr>`
    : "";
  const notesBlock = opts.notes
    ? `<tr><td style="padding:14px 28px 0;">
         <div style="background:#f1f3f7;border-radius:8px;padding:12px 14px;font-size:14.5px;color:#0f172a;line-height:1.5;white-space:pre-wrap;">${escapeHtml(
           opts.notes,
         )}</div>
       </td></tr>`
    : "";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e6e8ee;box-shadow:0 4px 16px -4px rgba(15,23,42,0.08);">
          <tr><td style="padding:28px 28px 4px;">
            <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;">${kickerSafe}</p>
            <h2 style="margin:0 0 14px;font-size:22px;font-weight:600;color:#0f172a;line-height:1.25;">${titleSafe}</h2>
          </td></tr>
          ${whenRow}
          ${locRow}
          ${notesBlock}
          <tr><td style="padding:24px 28px 28px;">
            <a href="${opts.buttonUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:500;font-size:14.5px;padding:10px 20px;border-radius:8px;">${escapeHtml(
              opts.buttonText,
            )}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `;
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

  // ----------------------------------------------------------------------------
  // Outbox drain — bead module + future ad-hoc events
  // ----------------------------------------------------------------------------

  const { data: outboxRows, error: outboxErr } = await supabase
    .from("notification_outbox_pending")
    .select("*");

  let outboxSent = 0;
  let outboxFailed = 0;
  let outboxSkipped = 0;

  if (outboxErr) {
    console.error("[dispatch] outbox fetch failed:", outboxErr.message);
  } else {
    // Group rows by outbox_id so a single event spans multiple recipients.
    type OutboxRow = {
      outbox_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      member_id: string;
      short_name: string;
      email: string | null;
      role: string;
      telegram_chat_id: number | null;
      telegram_enabled: boolean;
      email_enabled: boolean;
    };

    const rows = (outboxRows ?? []) as OutboxRow[];
    // Ensure each outbox row gets processed once per attempt, regardless
    // of how many recipients share its outbox_id (the view returns one
    // row per (outbox_id × member_id), but here each row already has
    // a single member_id baked in — so we treat each row as its own job).
    const handledIds = new Set<string>();

    for (const row of rows) {
      const channels: Array<"telegram" | "email"> = [];
      const wantTelegram =
        row.telegram_enabled && row.telegram_chat_id != null;
      const wantEmail = row.email_enabled && !!row.email;
      if (wantTelegram) channels.push("telegram");
      if (wantEmail) channels.push("email");

      if (channels.length === 0) {
        await supabase.from("notification_dispatch_log").insert({
          event_id: null,
          member_id: row.member_id,
          channel: "telegram",
          status: "skipped",
          error_message: "No enabled channel or contact details",
          payload: { outbox_id: row.outbox_id, event_type: row.event_type },
        });
        outboxSkipped++;
        handledIds.add(row.outbox_id);
        // Mark the outbox row processed even though we didn't send
        // anything — otherwise it sits in the queue forever and the
        // dispatcher logs the same "skipped" row every 5 minutes.
        await supabase
          .from("notification_outbox")
          .update({
            processed_at: new Date().toISOString(),
            attempts:
              (row as { attempts?: number }).attempts != null
                ? Number((row as { attempts?: number }).attempts) + 1
                : 1,
            last_error: "No enabled channel or contact details",
          })
          .eq("id", row.outbox_id);
        continue;
      }

      const message = renderOutboxMessage(row.event_type, row.payload, row.short_name);
      let anyFailure = false;

      for (const ch of channels) {
        let result: { ok: true } | { ok: false; error: string };
        if (ch === "telegram") {
          result = await sendTelegram(row.telegram_chat_id!, message.telegramText);
        } else {
          result = await sendEmail(
            row.email!,
            message.emailSubject,
            message.emailHtml,
            message.emailText,
          );
        }

        await supabase.from("notification_dispatch_log").insert({
          event_id: null,
          member_id: row.member_id,
          channel: ch,
          status: result.ok ? "sent" : "failed",
          error_message: result.ok ? null : result.error,
          payload: { outbox_id: row.outbox_id, event_type: row.event_type },
        });

        if (result.ok) outboxSent++;
        else {
          outboxFailed++;
          anyFailure = true;
        }
      }

      handledIds.add(row.outbox_id);

      // Mark the outbox row processed (per recipient — but our schema
      // stores one outbox row per recipient already, so this is 1:1).
      await supabase
        .from("notification_outbox")
        .update({
          processed_at: new Date().toISOString(),
          attempts: (row as { attempts?: number }).attempts != null
            ? Number((row as { attempts?: number }).attempts) + 1
            : 1,
          last_error: anyFailure ? "One or more channels failed" : null,
        })
        .eq("id", row.outbox_id);
    }
  }

  // ----------------------------------------------------------------------------
  // Task reminders — same shape as calendar reminders, but the "due_at"
  // takes the place of "starts_at" and we send a different message.
  // ----------------------------------------------------------------------------

  const { data: taskCandidates, error: taskErr } = await supabase.rpc(
    "fetch_task_dispatch_candidates",
    {
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
    },
  );

  let taskDispatched = 0;
  let taskSkipped = 0;
  let taskFailed = 0;

  if (taskErr) {
    console.error("[dispatch] fetch_task_dispatch_candidates failed:", taskErr.message);
  } else {
    type TaskCandidate = {
      reminder_id: string;
      lead_time_minutes: number;
      channel: "telegram" | "email" | "both";
      task_id: string;
      title: string;
      description: string | null;
      assignee_id: string;
      assignee_short: string;
      assignee_email: string | null;
      assignee_role: "parent" | "helper" | "child";
      telegram_chat_id: number | null;
      telegram_enabled: boolean;
      email_enabled: boolean;
      due_at: string;
      rrule: string | null;
    };

    const taskList = (taskCandidates ?? []) as TaskCandidate[];

    for (const t of taskList) {
      const slots = resolveTaskSlots(t, windowStart, windowEnd);
      if (slots.length === 0) continue;

      const wantTelegram =
        (t.channel === "telegram" || t.channel === "both") &&
        t.telegram_enabled &&
        t.telegram_chat_id != null;
      const wantEmail =
        (t.channel === "email" || t.channel === "both") &&
        t.email_enabled &&
        !!t.assignee_email;

      const channels: Array<"telegram" | "email"> = [];
      if (wantTelegram) channels.push("telegram");
      if (wantEmail) channels.push("email");

      for (const slot of slots) {
        if (channels.length === 0) {
          await supabase.from("notification_dispatch_log").insert({
            task_reminder_id: t.reminder_id,
            task_id: t.task_id,
            member_id: t.assignee_id,
            channel: "telegram",
            status: "skipped",
            scheduled_for: slot.scheduledFor.toISOString(),
            error_message: "No enabled channel or contact details",
          });
          taskSkipped++;
          continue;
        }

        for (const ch of channels) {
          const { error: insertErr } = await supabase
            .from("notification_dispatch_log")
            .insert({
              task_reminder_id: t.reminder_id,
              task_id: t.task_id,
              member_id: t.assignee_id,
              channel: ch,
              status: "queued",
              scheduled_for: slot.scheduledFor.toISOString(),
            });

          if (insertErr) {
            const msg = insertErr.message ?? "";
            if (msg.includes("duplicate key") || (insertErr as any).code === "23505") {
              continue;
            }
            console.error("[dispatch] task log pre-claim failed:", insertErr);
            continue;
          }

          let result: { ok: true } | { ok: false; error: string };
          if (ch === "telegram") {
            const text = renderTaskTelegram(t, slot.dueAt);
            result = await sendTelegram(t.telegram_chat_id!, text);
          } else {
            const { subject, html, text } = renderTaskEmail(t, slot.dueAt);
            result = await sendEmail(t.assignee_email!, subject, html, text);
          }

          await supabase
            .from("notification_dispatch_log")
            .update({
              status: result.ok ? "sent" : "failed",
              error_message: result.ok ? null : result.error,
              dispatched_at: new Date().toISOString(),
            })
            .eq("task_reminder_id", t.reminder_id)
            .eq("member_id", t.assignee_id)
            .eq("channel", ch)
            .eq("scheduled_for", slot.scheduledFor.toISOString());

          if (result.ok) taskDispatched++;
          else taskFailed++;
        }
      }
    }
  }

  const summary = {
    ok: true,
    candidates: list.length,
    dispatched,
    skipped,
    failed,
    outbox: { sent: outboxSent, skipped: outboxSkipped, failed: outboxFailed },
    tasks: { dispatched: taskDispatched, skipped: taskSkipped, failed: taskFailed },
  };
  console.log("[dispatch] summary:", JSON.stringify(summary));
  return new Response(JSON.stringify(summary), {
    headers: { "content-type": "application/json" },
  });
});

// ----------------------------------------------------------------------------
// Task occurrence resolution + rendering
// ----------------------------------------------------------------------------

function resolveTaskSlots(
  t: {
    lead_time_minutes: number;
    rrule: string | null;
    due_at: string;
    task_id: string;
  },
  windowStart: Date,
  windowEnd: Date,
): Array<{ scheduledFor: Date; dueAt: Date }> {
  const leadMs = t.lead_time_minutes * 60 * 1000;
  const baseDue = new Date(t.due_at);

  if (!t.rrule) {
    const scheduledFor = new Date(baseDue.getTime() - leadMs);
    if (scheduledFor >= windowStart && scheduledFor <= windowEnd) {
      return [{ scheduledFor, dueAt: baseDue }];
    }
    return [];
  }

  const occurrenceWindowStart = new Date(windowStart.getTime() + leadMs);
  const occurrenceWindowEnd = new Date(windowEnd.getTime() + leadMs);

  const dtstartLine = `DTSTART:${formatDateForRrule(baseDue)}`;
  const rruleText = t.rrule.startsWith("DTSTART") ? t.rrule : `${dtstartLine}\n${t.rrule}`;

  let set: ReturnType<typeof rrulestr>;
  try {
    set = rrulestr(rruleText, { forceset: true });
  } catch (e) {
    console.error(`[dispatch] failed to parse RRULE for task ${t.task_id}:`, (e as Error).message);
    return [];
  }

  const occs = set.between(occurrenceWindowStart, occurrenceWindowEnd, true);
  return occs.map((occ: Date) => ({
    scheduledFor: new Date(occ.getTime() - leadMs),
    dueAt: occ,
  }));
}

function renderTaskTelegram(
  t: { title: string; description: string | null; lead_time_minutes: number; assignee_short: string },
  dueAt: Date,
): string {
  const lines: string[] = [
    `📝 <b>${escapeHtml(t.title)}</b>`,
    `Hey ${escapeHtml(t.assignee_short)} — due ${escapeHtml(leadLabel(t.lead_time_minutes))} (${formatDateTime(dueAt, false)})`,
  ];
  if (t.description) lines.push("", escapeHtml(t.description));
  lines.push("", `<a href="${APP_URL}/tasks">Open Rush HQ</a>`);
  return lines.join("\n");
}

function renderTaskEmail(
  t: { title: string; description: string | null; lead_time_minutes: number; assignee_short: string },
  dueAt: Date,
): { subject: string; html: string; text: string } {
  const when = formatDateTime(dueAt, false);
  const subject = `Task reminder · ${t.title} · due ${when}`;
  const lines = [
    `Hey ${t.assignee_short},`,
    `${t.title} is due ${leadLabel(t.lead_time_minutes)} (${when}).`,
  ];
  if (t.description) lines.push("", t.description);
  lines.push("", `View on Rush HQ: ${APP_URL}/tasks`);
  const text = lines.join("\n");
  const html = richEmail({
    kicker: `Rush HQ · Task for ${t.assignee_short}`,
    title: t.title,
    when: `Due ${leadLabel(t.lead_time_minutes)} · ${when}`,
    notes: t.description ?? null,
    buttonUrl: `${APP_URL}/tasks`,
    buttonText: "Open tasks",
  });
  return { subject, html, text };
}

// ----------------------------------------------------------------------------
// Outbox message rendering
// ----------------------------------------------------------------------------

function renderOutboxMessage(
  eventType: string,
  payload: Record<string, unknown>,
  recipientShortName: string,
): {
  telegramText: string;
  emailSubject: string;
  emailHtml: string;
  emailText: string;
} {
  const childName = String(payload.child_short_name ?? "");
  const totalSgd =
    typeof payload.total_sgd === "number"
      ? payload.total_sgd
      : Number(payload.total_sgd ?? 0);
  const formattedTotal = `S$${totalSgd.toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  if (eventType === "calendar_event_created") {
    const title = String(payload.title ?? "New event");
    const startsAt = payload.starts_at
      ? new Date(String(payload.starts_at))
      : null;
    const allDay = !!payload.all_day;
    const location = payload.location ? String(payload.location) : null;
    const recurring = !!payload.rrule;
    const when = startsAt ? formatDateTime(startsAt, allDay) : "";
    const link = `${APP_URL}/calendar`;

    const tgLines: string[] = [
      `📅 <b>${escapeHtml(title)}</b>`,
      `New on the calendar${when ? ` · ${escapeHtml(when)}` : ""}${recurring ? " · repeats" : ""}`,
    ];
    if (location) {
      tgLines.push(`📍 <a href="${mapsLink(location)}">${escapeHtml(location)}</a>`);
    }
    tgLines.push("", `<a href="${link}">Open Rush HQ</a>`);
    const tg = tgLines.join("\n");

    const html = richEmail({
      kicker: "Rush HQ · New event",
      title,
      when,
      location,
      notes: recurring ? "Recurring event." : null,
      buttonUrl: link,
      buttonText: "Open calendar",
    });
    const text =
      `New on the calendar: ${title}${when ? ` · ${when}` : ""}` +
      `${location ? ` at ${location}` : ""}` +
      ` ${link}`;
    return {
      telegramText: tg,
      emailSubject: `New event: ${title}${when ? ` · ${when}` : ""}`,
      emailHtml: html,
      emailText: text,
    };
  }

  if (eventType === "bead_chart_published") {
    const link = `${APP_URL}/beads`;
    const title = `${childName}'s new bead chart is live`;
    const tg =
      `📋 <b>${escapeHtml(title)}</b>\n` +
      `Hi ${escapeHtml(recipientShortName)}, the chart for the new month has just been published.\n\n` +
      `<a href="${link}">Open Rush HQ</a>`;
    const html = richEmail({
      kicker: "Rush HQ · Beads",
      title,
      when: null,
      notes: `Hi ${recipientShortName}, the chart for the new month has just been published.`,
      buttonUrl: link,
      buttonText: "View bead chart",
    });
    const text = `${title}. Open Rush HQ: ${link}`;
    return { telegramText: tg, emailSubject: title, emailHtml: html, emailText: text };
  }

  if (eventType === "bead_period_locked") {
    const link = `${APP_URL}/beads`;
    const title = `${childName} counted ${formattedTotal}`;
    const tg =
      `🎉 <b>${escapeHtml(title)}!</b>\n` +
      `The period is now locked and ready for investment.\n\n` +
      `<a href="${link}">Open Rush HQ</a>`;
    const html = richEmail({
      kicker: "Rush HQ · Beads",
      title,
      when: null,
      notes: "The period is now locked and ready for investment.",
      buttonUrl: link,
      buttonText: "Open beads",
    });
    const text = `${title}. Period locked, ready for investment. ${link}`;
    return { telegramText: tg, emailSubject: title, emailHtml: html, emailText: text };
  }

  if (eventType === "stock_purchase_recorded") {
    const txType = String(payload.transaction_type ?? "purchase");
    const totalShares = Number(payload.total_shares ?? 0);
    const link = `${APP_URL}/stocks`;
    const headline =
      txType === "withdrawal"
        ? `Withdrawal recorded: ${Math.abs(totalShares).toFixed(4)} shares`
        : txType === "dividend_reinvest"
          ? `Dividend reinvested: +${totalShares.toFixed(4)} shares`
          : txType === "gift_purchase"
            ? `Gift purchase recorded: +${totalShares.toFixed(4)} shares (${formattedTotal})`
            : `Purchase recorded: +${totalShares.toFixed(4)} shares (${formattedTotal})`;
    const emoji =
      txType === "withdrawal" ? "📤"
        : txType === "dividend_reinvest" ? "🌱"
          : txType === "gift_purchase" ? "🎁"
            : "💰";
    const tg = `${emoji} <b>${escapeHtml(headline)}</b>\n<a href="${link}">Open Rush HQ</a>`;
    const html = richEmail({
      kicker: "Rush HQ · Stocks",
      title: headline,
      when: null,
      buttonUrl: link,
      buttonText: "Open stocks",
    });
    return { telegramText: tg, emailSubject: headline, emailHtml: html, emailText: `${headline} ${link}` };
  }

  if (eventType === "finance_monthly_reminder") {
    const link = `${APP_URL}/finance`;
    const month = String(payload.month ?? "");
    const headline = `Time for the ${month} finance update`;
    const tg = `💰 <b>${escapeHtml(headline)}</b>\n<a href="${link}">Open Rush HQ</a>`;
    const html = richEmail({
      kicker: "Rush HQ · Finance",
      title: headline,
      when: null,
      notes: "Run through the eight account balances and the property snapshots for the month.",
      buttonUrl: link,
      buttonText: "Start update",
    });
    return {
      telegramText: tg,
      emailSubject: headline,
      emailHtml: html,
      emailText: `${headline}. ${link}`,
    };
  }

  if (eventType === "stock_monthly_summary") {
    const link = `${APP_URL}/stocks/me`;
    const valueSgd = Number(payload.value_sgd ?? 0);
    const changeSgd = Number(payload.change_sgd ?? 0);
    const formattedValue = `S$${valueSgd.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formattedChange = `${changeSgd >= 0 ? "+" : "−"}S$${Math.abs(changeSgd).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const isSelf = !!payload.is_self;
    const headline = isSelf
      ? `Your investment is now ${formattedValue}`
      : `${childName}'s investment is now ${formattedValue}`;
    const sub = changeSgd === 0 ? null : `${formattedChange} from last month.`;
    const tg = `🌱 <b>${escapeHtml(headline)}</b>${sub ? `\n${escapeHtml(sub)}` : ""}\n\n<a href="${link}">Open Rush HQ</a>`;
    const html = richEmail({
      kicker: "Rush HQ · Stocks",
      title: headline,
      when: sub,
      buttonUrl: link,
      buttonText: "View investment",
    });
    return {
      telegramText: tg,
      emailSubject: headline,
      emailHtml: html,
      emailText: `${headline}.${sub ? ` ${sub}` : ""} ${link}`,
    };
  }

  // Fallback for unknown event types — surface the payload so debugging
  // is possible without a code change.
  const safe = JSON.stringify(payload);
  return {
    telegramText: `<b>Notification</b>\n${escapeHtml(eventType)}\n${escapeHtml(safe)}`,
    emailSubject: `Rush HQ · ${eventType}`,
    emailHtml: `<pre>${escapeHtml(safe)}</pre>`,
    emailText: safe,
  };
}
