import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (error) setError(error.message);
      else setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="text-3xl text-ink mb-1">Rush HQ</p>
        <p className="text-muted text-[14px] mb-8">Reset your password</p>
        {sent ? (
          <div className="space-y-4">
            <p className="text-[14px] text-ink">
              If that email is on file, we've sent a reset link. It's good for an
              hour. Check your inbox (and your spam folder, just in case).
            </p>
            <Link
              to="/login"
              className="text-[13px] text-primary underline-offset-2 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && (
              <p className="text-danger text-[13px]" role="alert">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={submitting}>
              Send reset link
            </Button>
            <p className="text-[13px] text-muted text-center">
              <Link to="/login" className="underline-offset-2 hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
