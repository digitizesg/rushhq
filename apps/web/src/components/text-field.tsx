import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Eye, EyeOff } from "lucide-react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Tailwind classes for the outer label wrapper — use to constrain width. */
  containerClassName?: string;
  /** Show an eye button that reveals the value. Only meaningful for password fields. */
  revealToggle?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, className, containerClassName, revealToggle, type, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const [revealed, setRevealed] = useState(false);
  const canReveal = revealToggle && type === "password";
  const effectiveType = canReveal && revealed ? "text" : type;
  return (
    <label className={["block", containerClassName ?? ""].join(" ")}>
      <span className="block text-[15px] font-medium text-ink mb-1.5">{label}</span>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={effectiveType}
          className={[
            "w-full h-11 rounded-md border bg-white px-3 text-[16px] text-ink placeholder:text-muted/70",
            "focus:outline-2 focus:outline-offset-0 focus:outline-primary",
            canReveal ? "pr-11" : "",
            error ? "border-danger" : "border-line hover:border-ink/20",
            className ?? "",
          ].join(" ")}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${inputId}-hint` : undefined}
          {...rest}
        />
        {canReveal && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink"
          >
            {revealed ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        )}
      </div>
      {(error || hint) && (
        <span
          id={`${inputId}-hint`}
          className={["block mt-1.5 text-[14.5px]", error ? "text-danger" : "text-muted"].join(" ")}
        >
          {error || hint}
        </span>
      )}
    </label>
  );
});
