export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="min-h-dvh grid place-items-center px-6">
      <div className="flex flex-col items-center gap-3 text-muted">
        <span
          className="size-6 rounded-full border-2 border-line border-t-primary animate-spin"
          aria-hidden
        />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  );
}
