interface AvatarProps {
  /** Pixel size — width + height + font sizing all derive from this. */
  size?: number;
  /** Used to derive initials when no avatar URL is set. */
  name?: string | null;
  /** Image URL. When falsy or fails to load, falls back to initials. */
  url?: string | null;
  /** Fallback background colour for the initials tile. */
  accent?: string;
  /** Fallback text colour for the initials tile. */
  text?: string;
  className?: string;
  /** Optional alt text. Defaults to name. */
  alt?: string;
}

export function Avatar({
  size = 32,
  name,
  url,
  accent,
  text,
  className,
  alt,
}: AvatarProps) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  const dimensionStyle = { width: size, height: size };
  const cls = ["shrink-0 rounded-full overflow-hidden block", className ?? ""].join(" ");

  if (url) {
    return (
      <img
        src={url}
        alt={alt ?? name ?? ""}
        className={[cls, "object-cover"].join(" ")}
        style={dimensionStyle}
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-hidden={alt || name ? undefined : true}
      className={[cls, "grid place-items-center font-semibold select-none"].join(" ")}
      style={{
        ...dimensionStyle,
        backgroundColor: accent ?? "#cbd5e1",
        color: text ?? "#475569",
        fontSize: Math.max(11, Math.round(size * 0.42)),
        lineHeight: 1,
      }}
    >
      {initials}
    </span>
  );
}
