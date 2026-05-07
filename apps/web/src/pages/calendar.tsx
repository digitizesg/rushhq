import { useAuth } from "@/auth/auth-context";

export default function CalendarPage() {
  const { member } = useAuth();
  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-baseline justify-between gap-4 mb-6">
        <div>
          <p className="text-[12px] uppercase tracking-wider text-muted mb-1">
            Calendar
          </p>
          <h1 className="font-serif text-[28px] font-medium text-ink">
            Hi {member?.short_name}
          </h1>
        </div>
      </div>
      <div className="bg-white border border-border-warm rounded-lg p-6">
        <p className="text-muted text-[14px]">
          Month / week / day calendar lands in the next build chunk. The auth
          shell, layout, and route guards work — you can sign out, switch
          users, and parents will be sent to the MFA page if they haven't yet
          enrolled.
        </p>
      </div>
    </section>
  );
}
