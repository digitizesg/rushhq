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

const BLUE: MemberColour =   { accent: "#2563eb", soft: "#eff6ff", text: "#1d4ed8" };
const VIOLET: MemberColour = { accent: "#7c3aed", soft: "#f5f3ff", text: "#6d28d9" };
const EMERALD: MemberColour = { accent: "#059669", soft: "#ecfdf5", text: "#047857" };
const AMBER: MemberColour =  { accent: "#d97706", soft: "#fffbeb", text: "#b45309" };
const ROSE: MemberColour =   { accent: "#ec4899", soft: "#fdf2f8", text: "#be185d" };
const INDIGO: MemberColour = { accent: "#4f46e5", soft: "#eef2ff", text: "#4338ca" };
const CYAN: MemberColour =   { accent: "#0891b2", soft: "#ecfeff", text: "#0e7490" };

const PALETTE: ReadonlyArray<MemberColour> = [BLUE, VIOLET, EMERALD, AMBER, ROSE, INDIGO, CYAN];

// Per-name overrides take priority over the hash. Lets the kids own
// "their" colour even if the auth/member ids change.
const NAME_OVERRIDES: Record<string, MemberColour> = {
  Robin: BLUE,
  Riley: ROSE,
};

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colourFor(
  memberId: string | null | undefined,
  shortName?: string | null,
): MemberColour {
  if (shortName && NAME_OVERRIDES[shortName]) return NAME_OVERRIDES[shortName];
  if (!memberId) return { accent: "#64748b", soft: "#f1f5f9", text: "#475569" };
  return PALETTE[hash(memberId) % PALETTE.length];
}

/** Role-based colour. Parents + helpers all wear emerald so they read as
 *  "grown-ups" at a glance; kids fall through to their pinned colour. */
export function colourForRole(
  memberId: string | null | undefined,
  shortName: string | null | undefined,
  role: "parent" | "helper" | "child" | null | undefined,
): MemberColour {
  if (role === "parent" || role === "helper") return EMERALD;
  return colourFor(memberId, shortName);
}

/** Fixed hue per event type so the calendar reads at a glance —
 *  "school" blocks blue, "activity" amber, family events emerald,
 *  travel cyan, etc. */
export function colourForType(
  type: string | null | undefined,
): MemberColour {
  switch (type) {
    case "school":   return INDIGO;
    case "activity": return AMBER;
    case "family":   return EMERALD;
    case "personal": return VIOLET;
    case "travel":   return CYAN;
    case "other":    return BLUE;
    default:         return BLUE;
  }
}

/** Picks an event's colour by who it's for, not who created it. */
export function colourForEvent(
  attendees: ReadonlyArray<{
    id: string;
    short_name: string;
    role: "parent" | "helper" | "child";
    member_type?: "parent" | "helper" | "child";
  }>,
  createdBy: string | null | undefined,
): MemberColour {
  const children = attendees.filter(
    (a) => a.member_type === "child" || a.role === "child",
  );
  // 1 kid attending → that kid's colour
  if (children.length === 1) {
    return colourFor(children[0].id, children[0].short_name);
  }
  // Several kids attending → emerald, treat as a family event
  if (children.length > 1) return EMERALD;
  // No kids: solo grown-up → that person's role colour. Multi-grown-up → emerald.
  if (attendees.length === 1) {
    return colourForRole(attendees[0].id, attendees[0].short_name, attendees[0].role);
  }
  if (attendees.length > 1) return EMERALD;
  return colourFor(createdBy);
}
