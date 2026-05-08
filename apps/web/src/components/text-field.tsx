import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, className, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ink mb-1.5">{label}</span>
      <input
        ref={ref}
        id={inputId}
        className={[
          "w-full h-11 rounded-md border bg-white px-3 text-[14px] text-ink placeholder:text-muted/70",
          "focus:outline-2 focus:outline-offset-0 focus:outline-primary",
          error ? "border-danger" : "border-line hover:border-ink/20",
          className ?? "",
        ].join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${inputId}-hint` : undefined}
        {...rest}
      />
      {(error || hint) && (
        <span
          id={`${inputId}-hint`}
          className={["block mt-1.5 text-[12.5px]", error ? "text-danger" : "text-muted"].join(" ")}
        >
          {error || hint}
        </span>
      )}
    </label>
  );
});
