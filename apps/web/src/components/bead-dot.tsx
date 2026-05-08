interface BeadDotProps {
  hex: string;
  /** "Sparkly Pink" gets a subtle gradient + sparkle. Detected by
   *  passing the colour id; defaults to plain. */
  sparkly?: boolean;
  size?: number;
  className?: string;
}

export function BeadDot({ hex, sparkly = false, size = 16, className }: BeadDotProps) {
  // Slight outline for white so it's visible on a white card.
  const borderColour =
    hex.toLowerCase() === "#ffffff" ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.08)";
  return (
    <span
      aria-hidden
      className={["inline-block rounded-full shrink-0", className ?? ""].join(" ")}
      style={{
        width: size,
        height: size,
        background: sparkly
          ? `radial-gradient(circle at 30% 30%, #ffffff 0%, ${hex} 38%, #b0144f 100%)`
          : hex,
        boxShadow: `inset 0 0 0 1px ${borderColour}, 0 1px 2px rgba(0,0,0,0.08)`,
      }}
    />
  );
}
