// 32 random hex chars used as the Telegram setup token. Generated
// client-side via crypto.getRandomValues.

export function generatePendingToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function botUsername(): string {
  return import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "RushFamilyBot";
}

export function deepLinkFor(token: string): string {
  return `https://t.me/${botUsername()}?start=${token}`;
}
