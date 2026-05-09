import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";

interface PendingFactor {
  factorId: string;
  qr: string;
  secret: string;
}

/**
 * Mandatory MFA enrolment page for parents who don't yet have a verified
 * TOTP factor. Lifted via the route guard in route-guards.tsx.
 */
export default function MfaEnrolPage() {
  const { member, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingFactor | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: factors } = await supabase.auth.mfa.listFactors();

      // If there's already a verified factor, we shouldn't be on this
      // page at all — escape to the calendar instead of trying to enrol
      // a duplicate. Guards against a route-guard race that occasionally
      // sends already-verified parents here on a fresh sign-in.
      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (verified) {
        await refresh();
        if (!cancelled) navigate("/", { replace: true });
        return;
      }

      // Clean up any unverified TOTP factors left over from a previous
      // attempt — the API allows multiple but they get noisy.
      const stale = factors?.totp?.filter((f) => f.status !== "verified") ?? [];
      for (const f of stale) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Rush HQ · ${member?.short_name ?? "user"}`,
      });
      if (cancelled) return;
      if (error || !data) {
        setError(error?.message ?? "Could not start enrolment");
        return;
      }
      setPending({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, [member?.short_name, navigate, refresh]);

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data: challenge, error: challErr } = await supabase.auth.mfa.challenge({
        factorId: pending.factorId,
      });
      if (challErr || !challenge) {
        setError(challErr?.message ?? "Could not start MFA challenge");
        return;
      }
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: pending.factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyErr) {
        setError(verifyErr.message);
        return;
      }
      await refresh();
      navigate("/", { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-12">
      <div className="w-full max-w-md bg-white border border-line rounded-lg p-7">
        <p className="text-2xl text-ink mb-1">Set up two-factor</p>
        <p className="text-muted text-[16px] mb-6">
          Two-factor sign-in is required for parent accounts. Scan this QR code
          with an authenticator app (1Password, Authy, Google Authenticator),
          then enter the six-digit code it shows.
        </p>
        {pending ? (
          <div className="space-y-5">
            <div className="bg-soft border border-line rounded-md p-4 grid place-items-center">
              <img
                src={pending.qr}
                alt="QR code for two-factor enrolment"
                className="size-44"
              />
            </div>
            <details className="text-[15px] text-muted">
              <summary className="cursor-pointer hover:text-ink">
                Can't scan? Show the secret key
              </summary>
              <p className="mt-2 font-mono text-[14.5px] text-ink break-all bg-soft border border-line rounded-md p-3">
                {pending.secret}
              </p>
            </details>
            <form onSubmit={handleVerify} className="space-y-4">
              <TextField
                label="Six-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              {error && (
                <p className="text-danger text-[15px]" role="alert">{error}</p>
              )}
              <Button type="submit" className="w-full" loading={submitting}>
                Verify and continue
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-muted text-[16px]">{error ?? "Loading enrolment…"}</p>
        )}
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          className="block mx-auto mt-6 text-[15px] text-muted hover:text-ink underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
