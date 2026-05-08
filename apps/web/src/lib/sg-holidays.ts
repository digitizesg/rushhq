// Singapore public holidays + MOE primary school holidays.
//
// Static dataset, refreshed once a year. Sources to verify against:
//   • Public holidays: https://www.mom.gov.sg/employment-practices/public-holidays
//   • Primary school terms: https://www.moe.gov.sg/news/press-releases
//
// Variable-date holidays (Chinese New Year, Hari Raya Puasa,
// Hari Raya Haji, Vesak Day, Deepavali, Good Friday) shift every
// year — verify the published gazette before relying on these.

export type HolidayType = "public" | "school";

export interface SGHoliday {
  /** YYYY-MM-DD inclusive start. */
  date: string;
  /** YYYY-MM-DD inclusive end for multi-day blocks (school breaks).
   *  Omit for single-day holidays. */
  endDate?: string;
  name: string;
  type: HolidayType;
}

export const SG_HOLIDAYS: SGHoliday[] = [
  // ---- 2026 Public holidays --------------------------------------------------
  { date: "2026-01-01", name: "New Year's Day",        type: "public" },
  { date: "2026-02-17", name: "Chinese New Year",      type: "public" },
  { date: "2026-02-18", name: "Chinese New Year",      type: "public" },
  { date: "2026-03-20", name: "Hari Raya Puasa",       type: "public" },
  { date: "2026-04-03", name: "Good Friday",           type: "public" },
  { date: "2026-05-01", name: "Labour Day",            type: "public" },
  { date: "2026-05-27", name: "Hari Raya Haji",        type: "public" },
  { date: "2026-05-31", name: "Vesak Day",             type: "public" },
  { date: "2026-06-01", name: "Vesak Day (in lieu)",   type: "public" },
  { date: "2026-08-09", name: "National Day",          type: "public" },
  { date: "2026-08-10", name: "National Day (in lieu)", type: "public" },
  { date: "2026-11-08", name: "Deepavali",             type: "public" },
  { date: "2026-11-09", name: "Deepavali (in lieu)",   type: "public" },
  { date: "2026-12-25", name: "Christmas Day",         type: "public" },

  // ---- 2026 MOE primary school holidays --------------------------------------
  { date: "2026-03-14", endDate: "2026-03-22", name: "March holiday",       type: "school" },
  { date: "2026-05-30", endDate: "2026-06-28", name: "June holiday",        type: "school" },
  { date: "2026-09-05", endDate: "2026-09-13", name: "September holiday",   type: "school" },
  { date: "2026-11-21", endDate: "2026-12-31", name: "End-of-year holiday", type: "school" },
];

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** All holidays (public + school) that overlap the given local date. */
export function holidaysOn(date: Date): SGHoliday[] {
  const iso = toIso(date);
  return SG_HOLIDAYS.filter((h) => {
    if (h.endDate) return iso >= h.date && iso <= h.endDate;
    return h.date === iso;
  });
}

export function publicHolidayOn(date: Date): SGHoliday | null {
  return holidaysOn(date).find((h) => h.type === "public") ?? null;
}

export function schoolHolidayOn(date: Date): SGHoliday | null {
  return holidaysOn(date).find((h) => h.type === "school") ?? null;
}
