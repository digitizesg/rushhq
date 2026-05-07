import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";

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
        <p className="font-serif text-3xl text-ink mb-1">Rush HQ</p>
        <p className="text-muted text-[14px] mb-8">
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
              <p className="text-coral text-[13px]" role="alert">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={submitting}>
              Sign in
            </Button>
            <p className="text-[13px] text-muted text-center">
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
            {error && (
              <p className="text-coral text-[13px]" role="alert">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={submitting}>
              Verify
            </Button>
            <button
              type="button"
              className="block mx-auto text-[13px] text-muted hover:text-ink underline-offset-2 hover:underline"
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
