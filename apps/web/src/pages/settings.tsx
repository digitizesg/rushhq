import { useAuth } from "@/auth/auth-context";

export default function SettingsPage() {
  const { member } = useAuth();
  return (
    <section className="mx-auto max-w-[760px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">
          Settings
        </p>
        <h1 className="font-serif text-[28px] font-medium text-ink">
          Your account
        </h1>
      </div>
      <div className="bg-white border border-border-warm rounded-lg p-6">
        <p className="font-serif text-[18px] font-medium text-ink mb-3">Profile</p>
        <dl className="grid grid-cols-3 gap-y-2 text-[14px]">
          <dt className="text-muted">Short name</dt>
          <dd className="col-span-2 text-ink">{member?.short_name}</dd>
          <dt className="text-muted">Full name</dt>
          <dd className="col-span-2 text-ink">{member?.full_name}</dd>
          <dt className="text-muted">Role</dt>
          <dd className="col-span-2 text-ink capitalize">{member?.role}</dd>
        </dl>
      </div>
      <div className="bg-white border border-border-warm rounded-lg p-6">
        <p className="text-muted text-[14px]">
          Notification preferences, Telegram setup, and password reset land in
          the next build chunk.
        </p>
      </div>
    </section>
  );
}
