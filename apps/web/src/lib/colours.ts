// Per-member colour assignment. Keys are family_members.id; the palette
// is small and warm-toned to match the rest of the app. New members
// cycle through PALETTE deterministically based on their id hash, so
// colours stay stable across page loads without us having to store
// them in the database.

const PALETTE: ReadonlyArray<{ bg: string; ring: string; text: string; chipBg: string }> = [
  // sage primary
  { bg: "#5d8a4e", ring: "#5d8a4e", text: "#1f2f17", chipBg: "#e7f0e1" },
  // honey
  { bg: "#d4a574", ring: "#b8884f", text: "#3a280f", chipBg: "#f5e3c8" },
  // forest
  { bg: "#3f5e36", ring: "#3f5e36", text: "#172012", chipBg: "#dde7d6" },
  // ochre
  { bg: "#a87c34", ring: "#a87c34", text: "#3a2a10", chipBg: "#efddb8" },
  // plum
  { bg: "#7a4a5f", ring: "#7a4a5f", text: "#2a161e", chipBg: "#ead5dc" },
  // slate
  { bg: "#5d6b78", ring: "#5d6b78", text: "#1d2429", chipBg: "#dde2e6" },
];

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colourFor(memberId: string | null | undefined): typeof PALETTE[number] {
  if (!memberId) return PALETTE[5]; // grey-ish fallback
  return PALETTE[hash(memberId) % PALETTE.length];
}

export type MemberColour = ReturnType<typeof colourFor>;
