import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage";

const variants: Record<Variant, string> = {
  primary: "bg-sage text-white hover:bg-[#4f7741]",
  secondary:
    "bg-white text-ink border border-border-warm hover:bg-paper",
  ghost: "text-muted hover:text-ink hover:bg-paper",
  danger: "bg-coral text-white hover:bg-[#a84a37]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-[14px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[base, variants[variant], sizes[size], className ?? ""].join(" ")}
      {...rest}
    >
      {loading && (
        <span
          className="size-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
});
