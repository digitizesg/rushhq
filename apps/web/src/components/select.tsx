import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, id, children, className, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ink mb-1.5">{label}</span>
      <select
        ref={ref}
        id={inputId}
        className={[
          "w-full h-10 rounded-md border bg-white px-3 text-[14px] text-ink",
          "focus:outline-2 focus:outline-offset-0 focus:outline-primary",
          error ? "border-danger" : "border-line",
          className ?? "",
        ].join(" ")}
        {...rest}
      >
        {children}
      </select>
      {(error || hint) && (
        <span
          className={["block mt-1.5 text-[12.5px]", error ? "text-danger" : "text-muted"].join(" ")}
        >
          {error || hint}
        </span>
      )}
    </label>
  );
});
