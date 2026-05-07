import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { generatePendingToken, deepLinkFor } from "@/lib/token";
import type { TelegramContact } from "@/lib/types";
import { Button } from "@/components/button";

interface TelegramCardProps {
  /** Member to manage. Defaults to the current user. */
  memberId: string;
  /** Headline to show inside the card. Helps when this is rendered for
   *  another family member from the Admin page. */
  heading: string;
}

type CardState =
  | { kind: "loading" }
  | { kind: "not-setup" }
  | { kind: "pending"; token: string; expiresAt: Date }
  | { kind: "expired" }
  | { kind: "linked"; username: string | null; linkedAt: Date };

const TOKEN_TTL_HOURS = 24;

function classify(contact: TelegramContact | null): CardState {
  if (!contact) return { kind: "not-setup" };
  if (contact.chat_id != null) {
    return {
      kind: "linked",
      username: contact.telegram_username,
      linkedAt: contact.linked_at ? new Date(contact.linked_at) : new Date(),
    };
  }
  if (contact.pending_token && contact.pending_token_expires_at) {
    const expiresAt = new Date(contact.pending_token_expires_at);
    if (expiresAt > new Date()) {
      return { kind: "pending", token: contact.pending_token, expiresAt };
    }
    return { kind: "expired" };
  }
  return { kind: "not-setup" };
}

function useCountdown(target: Date | null): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return "";
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "expired";
  const totalMin = Math.floor(diff / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 1) return `expires in ${h}h ${m}m`;
  return `expires in ${m}m`;
}

export function TelegramCard({ memberId, heading }: TelegramCardProps) {
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setError(null);
    const { data, error } = await supabase
      .from("telegram_contacts")
      .select("*")
      .eq("member_id", memberId)
      .maybeSingle();
    if (error) {
      setError(error.message);
      setState({ kind: "not-setup" });
      return;
    }
    setState(classify((data as TelegramContact | null) ?? null));
  }

  useEffect(() => {
    void load();
    // Re-load every 30s so a freshly completed link reflects without a manual refresh.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  async function generateLink() {
    setBusy(true);
    setError(null);
    try {
      const token = generatePendingToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
      const { error } = await supabase
        .from("telegram_contacts")
        .upsert(
          {
            member_id: memberId,
            pending_token: token,
            pending_token_expires_at: expiresAt.toISOString(),
            chat_id: null,
            telegram_username: null,
            linked_at: null,
          },
          { onConflict: "member_id" },
        );
      if (error) throw error;
      setState({ kind: "pending", token, expiresAt });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase
        .from("telegram_contacts")
        .update({
          chat_id: null,
          telegram_username: null,
          linked_at: null,
          pending_token: null,
          pending_token_expires_at: null,
        })
        .eq("member_id", memberId);
      if (error) throw error;
      setState({ kind: "not-setup" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(deepLinkFor(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  const countdown = useCountdown(state.kind === "pending" ? state.expiresAt : null);

  return (
    <div className="bg-white border border-border-warm rounded-lg p-6">
      <p className="font-serif text-[18px] font-medium text-ink mb-1">{heading}</p>
      <p className="text-muted text-[13.5px] mb-4">
        Reminders go to Telegram. Linking is one-tap on a phone.
      </p>

      {state.kind === "loading" && (
        <p className="text-muted text-[13.5px]">Loading…</p>
      )}

      {state.kind === "not-setup" && (
        <Button onClick={generateLink} loading={busy}>
          Generate setup link
        </Button>
      )}

      {state.kind === "pending" && (
        <div className="space-y-3">
          <p className="text-[13.5px] text-ink">
            Open this link on a phone with Telegram installed, then tap Start.
            <span className="text-muted"> · {countdown}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={deepLinkFor(state.token)}
              target="_blank"
              rel="noopener"
              className="inline-flex h-10 items-center px-4 rounded-md bg-sage text-white text-[14px] font-medium hover:bg-[#4f7741]"
            >
              Open in Telegram
            </a>
            <Button variant="secondary" onClick={() => copyLink(state.token)}>
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button variant="ghost" onClick={generateLink} loading={busy}>
              Regenerate
            </Button>
          </div>
          <code className="block text-[12px] bg-paper border border-border-warm rounded-md p-2 text-ink break-all">
            {deepLinkFor(state.token)}
          </code>
        </div>
      )}

      {state.kind === "expired" && (
        <div className="space-y-3">
          <p className="text-coral text-[13.5px]">
            That setup link has expired. Generate a new one.
          </p>
          <Button onClick={generateLink} loading={busy}>
            Regenerate setup link
          </Button>
        </div>
      )}

      {state.kind === "linked" && (
        <div className="space-y-3">
          <p className="text-[14px] text-ink">
            <span className="text-sage font-medium">✓ Telegram linked</span>
            {state.username ? (
              <span className="text-muted"> · @{state.username}</span>
            ) : null}
          </p>
          <Button variant="secondary" onClick={disconnect} loading={busy}>
            Disconnect
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-3 text-coral text-[13px]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
