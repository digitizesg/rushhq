import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";

// "verifying" while we turn the email link into a recovery session,
// "ready" once that session exists and the form can be shown, "invalid"
// if the link was expired, already used, or opened without a token.
type Status = "verifying" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [status, setStatus] = useState<Status>("verifying");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Turn whatever the reset link carried into a session. Different senders
  // use different link shapes:
  //   - Dashboard + the recommended email template: ?token_hash=..&type=recovery
  //     (works cross-device, so we verify it ourselves here).
  //   - App-sent PKCE links (?code=..) and implicit #access_token=.. links are
  //     picked up automatically by the client's detectSessionInUrl, which then
  //     surfaces as a session on the auth context — handled by the effect below.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    // An expired or already-used link comes back with an error description.
    if (params.get("error_description") || hash.get("error_description")) {
      setStatus("invalid");
      return;
    }

    const tokenHash = params.get("token_hash");
    if (tokenHash && params.get("type") === "recovery") {
      void supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: "recovery" })
        .then(({ error }) => {
          if (!cancelled) setStatus(error ? "invalid" : "ready");
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Once a session appears (either the token_hash verify above, or the
  // client's automatic handling of a ?code= / #access_token link), we're
  // ready. If nothing shows up within a few seconds the link was no good.
  useEffect(() => {
    if (status !== "verifying") return;
    if (session) {
      setStatus("ready");
      return;
    }
    const timer = setTimeout(() => {
      setStatus((s) => (s === "verifying" ? "invalid" : s));
    }, 6000);
    return () => clearTimeout(timer);
  }, [session, status]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 10) {
      setError("Password must be at least 10 characters");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setError(error.message);
      else navigate("/", { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="text-3xl text-ink mb-1">Rush HQ</p>
        <p className="text-muted text-[16px] mb-8">Choose a new password</p>

        {status === "verifying" && (
          <p className="text-[16px] text-muted" role="status">
            Checking your reset link.
          </p>
        )}

        {status === "invalid" && (
          <div className="space-y-4">
            <p className="text-[16px] text-ink">
              This reset link is invalid or has expired. Reset links are good for
              an hour and can only be used once.
            </p>
            <Link
              to="/forgot-password"
              className="text-[15px] text-primary underline-offset-2 hover:underline"
            >
              Request a new link
            </Link>
          </div>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="At least 10 characters."
            />
            <TextField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {error && (
              <p className="text-danger text-[15px]" role="alert">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={submitting}>
              Set new password
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
