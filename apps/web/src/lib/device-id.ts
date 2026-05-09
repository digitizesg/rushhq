// Stable per-browser device identifier used for the
// "trust this device for 30 days" MFA bypass. The id itself is
// meaningless — it's just paired with the user's auth_user_id in the
// trusted_devices table so we can recognise the same browser
// returning later.

const KEY = "rushhq.device_id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = window.localStorage.getItem(KEY);
  if (id && id.length > 0) return id;
  id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  window.localStorage.setItem(KEY, id);
  return id;
}

/** Wipe the device id (useful when revoking trust on the current device). */
export function resetDeviceId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
