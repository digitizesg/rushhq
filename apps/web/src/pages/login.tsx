import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { getDeviceId } from "@/lib/device-id";

interface MfaPending {
  factorId: string;
}

export default function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState<MfaPending | null>(null);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) {
        setError(signInErr.message);
        return;
      }
      // Was MFA required? Inspect any verified TOTP factors and ask
      // for the code if so.
      const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
      if (factorsErr) {
        setError(factorsErr.message);
        return;
      }
      const verified = factors.totp.find((f) => f.status === "verified");
      if (!verified) {
        await refresh();
        navigate(from, { replace: true });
        return;
      }

      // Trusted device? If we have a non-expired row keyed by this
      // browser's device id + the freshly authenticated user, we can
      // skip the TOTP step entirely. Failures here are non-fatal —
      // we just fall through to the prompt.
      try {
        const deviceId = getDeviceId();
        const { data: trusted } = await supabase
          .from("trusted_devices")
          .select("id")
          .eq("device_id", deviceId)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (trusted) {
          await refresh();
          navigate(from, { replace: true });
          return;
        }
      } catch (e) {
        console.warn("[login] trusted device lookup failed:", e);
      }

      const { data: challenge, error: challErr } = await supabase.auth.mfa.challenge({
        factorId: verified.id,
      });
      if (challErr || !challenge) {
        setError(challErr?.message ?? "Could not start MFA challenge");
        return;
      }
      setMfa({ factorId: verified.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfa) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data: challenge, error: challErr } = await supabase.auth.mfa.challenge({
        factorId: mfa.factorId,
      });
      if (challErr || !challenge) {
        setError(challErr?.message ?? "Could not start MFA challenge");
        return;
      }
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: mfa.factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyErr) {
        setError(verifyErr.message);
        return;
      }

      // Persist the device as trusted for 30 days if the user opted in.
      // Failures here are non-fatal — if the upsert fails the user just
      // gets prompted for TOTP again next time.
      if (trustDevice) {
        try {
          const deviceId = getDeviceId();
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            await supabase
              .from("trusted_devices")
              .upsert(
                {
                  auth_user_id: user.id,
                  device_id: deviceId,
                  user_agent: navigator.userAgent.slice(0, 500),
                  expires_at: expiresAt,
                },
                { onConflict: "auth_user_id,device_id" },
              );
          }
        } catch (e) {
          console.warn("[login] trusted device upsert failed:", e);
        }
      }

      await refresh();
      navigate(from, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="text-3xl text-ink mb-1">Rush HQ</p>
        <p className="text-muted text-[16px] mb-8">
          {mfa ? "Two-factor verification" : "Sign in to your account"}
        </p>

        {!mfa && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p className="text-danger text-[15px]" role="alert">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={submitting}>
              Sign in
            </Button>
            <p className="text-[15px] text-muted text-center">
              <Link to="/forgot-password" className="underline-offset-2 hover:underline">
                Forgot your password?
              </Link>
            </p>
          </form>
        )}

        {mfa && (
          <form onSubmit={handleMfa} className="space-y-4">
            <TextField
              label="Six-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              hint="Open your authenticator app and enter the current code."
            />
            <label className="flex items-center gap-2 text-[15px] text-ink cursor-pointer select-none">
              <input
                type="checkbox"
                className="size-5 rounded border-line accent-primary"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
              />
              Trust this device for 30 days
            </label>
            {error && (
              <p className="text-danger text-[15px]" role="alert">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={submitting}>
              Verify
            </Button>
            <button
              type="button"
              className="block mx-auto text-[15px] text-muted hover:text-ink underline-offset-2 hover:underline"
              onClick={() => {
                setMfa(null);
                setCode("");
                setError(null);
                void supabase.auth.signOut();
              }}
            >
              Sign in as a different user
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
