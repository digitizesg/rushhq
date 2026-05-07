// Per-member colour assignment. Every event chip + avatar reads as a
// distinct hue, matching the modern "tinted-chip" look (white card,
// soft pastel background, saturated accent text). Colours are stable
// per member id — no DB column, just a hash.

export interface MemberColour {
  /** Saturated accent for left-rail / dot / time-pill / icon. */
  accent: string;
  /** Soft tinted background for the chip body. */
  soft: string;
  /** Readable text colour against the soft background. */
  text: string;
}

const PALETTE: ReadonlyArray<MemberColour> = [
  { accent: "#2563eb", soft: "#eff6ff", text: "#1d4ed8" }, // blue
  { accent: "#7c3aed", soft: "#f5f3ff", text: "#6d28d9" }, // violet
  { accent: "#059669", soft: "#ecfdf5", text: "#047857" }, // emerald
  { accent: "#d97706", soft: "#fffbeb", text: "#b45309" }, // amber
  { accent: "#e11d48", soft: "#fff1f2", text: "#be123c" }, // rose
  { accent: "#4f46e5", soft: "#eef2ff", text: "#4338ca" }, // indigo
  { accent: "#0891b2", soft: "#ecfeff", text: "#0e7490" }, // cyan
];

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colourFor(memberId: string | null | undefined): MemberColour {
  if (!memberId) return { accent: "#64748b", soft: "#f1f5f9", text: "#475569" };
  return PALETTE[hash(memberId) % PALETTE.length];
}
