import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        <p className="text-muted text-[14px] mb-8">Choose a new password</p>
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
            <p className="text-danger text-[13px]" role="alert">{error}</p>
          )}
          <Button type="submit" className="w-full" loading={submitting}>
            Set new password
          </Button>
        </form>
      </div>
    </main>
  );
}
