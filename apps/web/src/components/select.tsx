import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Tailwind classes for the outer label wrapper — use to constrain width. */
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, id, children, className, containerClassName, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label className={["block", containerClassName ?? ""].join(" ")}>
      <span className="block text-[15px] font-medium text-ink mb-1.5">{label}</span>
      <div className="relative">
        <select
          ref={ref}
          id={inputId}
          className={[
            "w-full h-11 rounded-md border bg-white pl-3 pr-10 text-[16px] text-ink",
            "appearance-none cursor-pointer",
            "focus:outline-2 focus:outline-offset-0 focus:outline-primary",
            error ? "border-danger" : "border-line hover:border-ink/20",
            className ?? "",
          ].join(" ")}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={16}
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
      {(error || hint) && (
        <span
          className={["block mt-1.5 text-[14.5px]", error ? "text-danger" : "text-muted"].join(" ")}
        >
          {error || hint}
        </span>
      )}
    </label>
  );
});
