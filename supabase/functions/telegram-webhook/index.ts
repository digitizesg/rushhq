// Rush HQ — telegram-webhook edge function
// =========================================
// Set as the webhook URL on the @RushFamilyBot Telegram bot. Receives
// every message sent to the bot. We only react to /start <token>:
// look up the matching telegram_contacts row, set chat_id + linked_at
// + telegram_username, clear the pending token, and reply.
//
// Authentication: Telegram offers a bot-API "secret token" header
// (`X-Telegram-Bot-Api-Secret-Token`) that's set on `setWebhook` and
// echoed on every delivery. We verify it before doing anything.

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: {
      id: number;
      username?: string;
      first_name?: string;
    };
    text?: string;
  };
}

async function reply(chatId: number, text: string): Promise<void> {
  try {
    await fetch(
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
  } catch (e) {
    console.error("[telegram-webhook] reply failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Verify Telegram's secret-token header. This stops random POSTs from
  // fiddling with telegram_contacts rows.
  if (TELEGRAM_WEBHOOK_SECRET) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== TELEGRAM_WEBHOOK_SECRET) {
      console.warn("[telegram-webhook] secret token mismatch");
      return new Response("Forbidden", { status: 403 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const message = update.message;
  if (!message?.text || !message.chat?.id) {
    return new Response("ok", { status: 200 });
  }

  const text = message.text.trim();
  const chatId = message.chat.id;
  const username = message.from?.username ?? null;

  // Only the /start command does anything for now.
  if (!text.startsWith("/start")) {
    await reply(
      chatId,
      "Hi! This bot only sends notifications for Rush HQ. To link your account, generate a setup link from Settings inside the app.",
    );
    return new Response("ok", { status: 200 });
  }

  const parts = text.split(/\s+/);
  const token = parts[1]?.trim();

  if (!token) {
    await reply(
      chatId,
      "To link your Rush HQ account, open Settings on the web app and tap <b>Generate Telegram setup link</b>. The link will bring you back here automatically.",
    );
    return new Response("ok", { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: contact, error: lookupErr } = await supabase
    .from("telegram_contacts")
    .select("member_id, pending_token, pending_token_expires_at, chat_id")
    .eq("pending_token", token)
    .maybeSingle();

  if (lookupErr) {
    console.error("[telegram-webhook] lookup failed:", lookupErr);
    await reply(chatId, "Something went wrong on our side. Please try again in a minute.");
    return new Response("ok", { status: 200 });
  }

  if (!contact) {
    await reply(
      chatId,
      "That setup link isn't valid. It may have already been used, or you may need to generate a new one from Settings on the web app.",
    );
    return new Response("ok", { status: 200 });
  }

  if (contact.pending_token_expires_at && new Date(contact.pending_token_expires_at) < new Date()) {
    await reply(
      chatId,
      "That setup link has expired. Please generate a new one from Settings on the web app.",
    );
    return new Response("ok", { status: 200 });
  }

  // If this chat is already linked to a different member, refuse —
  // each Telegram chat is exclusive to one family member.
  const { data: existing } = await supabase
    .from("telegram_contacts")
    .select("member_id")
    .eq("chat_id", chatId)
    .neq("member_id", contact.member_id)
    .maybeSingle();
  if (existing) {
    await reply(
      chatId,
      "This Telegram account is already linked to another Rush HQ member. Disconnect that link first, or use a different Telegram account.",
    );
    return new Response("ok", { status: 200 });
  }

  const { error: updateErr } = await supabase
    .from("telegram_contacts")
    .update({
      chat_id: chatId,
      telegram_username: username,
      linked_at: new Date().toISOString(),
      pending_token: null,
      pending_token_expires_at: null,
    })
    .eq("member_id", contact.member_id);

  if (updateErr) {
    console.error("[telegram-webhook] update failed:", updateErr);
    await reply(chatId, "Something went wrong on our side. Please try again in a minute.");
    return new Response("ok", { status: 200 });
  }

  await reply(
    chatId,
    "✅ All linked. You'll now receive Rush HQ reminders in this chat. Reply STOP at any time to pause notifications (and disconnect from Settings to unlink).",
  );

  return new Response("ok", { status: 200 });
});
