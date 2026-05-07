export default function AdminPage() {
  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-wider text-muted mb-1">
          Admin
        </p>
        <h1 className="font-serif text-[28px] font-medium text-ink">
          Family members and dispatch
        </h1>
      </div>
      <div className="bg-white border border-border-warm rounded-lg p-6">
        <p className="text-muted text-[14px]">
          Member roster, add-member flow, Telegram link generation, and the
          dispatch log land in the next build chunk.
        </p>
      </div>
    </section>
  );
}
