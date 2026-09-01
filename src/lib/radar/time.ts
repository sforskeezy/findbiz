import type { DatePrecision } from "@/lib/radar/types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function daysBetween(fromIso: string, toIso = new Date().toISOString()) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, (to - from) / (24 * 60 * 60 * 1000));
}

export function formatMonthDay(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso.slice(0, 10);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export function recencyLabel(input: {
  occurredAt: string | null;
  detectedAt: string;
  precision: DatePrecision;
  sincePreviousScanDays?: number | null;
}) {
  if (input.occurredAt && (input.precision === "exact" || input.precision === "approximate")) {
    const days = daysBetween(input.occurredAt);
    if (days == null) return `First observed ${formatMonthDay(input.detectedAt)}`;
    const prefix = input.precision === "approximate" ? "Approximately " : "";
    if (days < 1) return input.precision === "exact" ? "Detected today" : "Detected today";
    if (days < 2) return `${prefix}1 day ago`.replace(/^Approximately 1 /, "Approximately 1 ");
    if (days < 7) return `${prefix}${Math.round(days)} days ago`;
    if (days < 11) return `${prefix}1 week ago`.replace(/^Approximately 1 week/, "Approximately 1 week");
    if (days < 25) return `${prefix}${Math.max(1, Math.round(days / 7))} weeks ago`;
    if (days < 45) return `${prefix}1 month ago`;
    if (days < 300) return `${prefix}${Math.max(2, Math.round(days / 30))} months ago`;
    return `First observed ${formatMonthDay(input.occurredAt)}`;
  }

  if (input.sincePreviousScanDays != null) {
    const days = input.sincePreviousScanDays;
    if (days < 1.5) return "Detected today";
    if (days < 3) return "Appeared since the last scan";
    if (days < 8) return `Appeared since last scan, within ${Math.round(days)} days`;
    if (days < 25) return `Appeared since last scan, within about ${Math.max(1, Math.round(days / 7))} weeks`;
    return `First observed ${formatMonthDay(input.detectedAt)}`;
  }

  return `Detected ${daysBetween(input.detectedAt) != null && (daysBetween(input.detectedAt) ?? 0) < 1.2 ? "today" : formatMonthDay(input.detectedAt)}`;
}

const MONTH_PATTERN =
  "(january|february|march|april|may|june|july|august|september|october|november|december)";

export function extractDateFromText(text: string, now = new Date()): { iso: string; precision: DatePrecision } | null {
  const lower = text.toLowerCase();
  const daysAgo = lower.match(/\b(\d{1,2})\s+days?\s+ago\b/);
  if (daysAgo) {
    const days = Number(daysAgo[1]);
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - days);
    return { iso: date.toISOString(), precision: "approximate" };
  }
  const weeksAgo = lower.match(/\b(\d{1,2})\s+weeks?\s+ago\b/);
  if (weeksAgo) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - Number(weeksAgo[1]) * 7);
    return { iso: date.toISOString(), precision: "approximate" };
  }
  const monthDayYear = lower.match(new RegExp(`${MONTH_PATTERN}\\s+(\\d{1,2})(?:,)?\\s*(\\d{4})?`));
  if (monthDayYear) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === monthDayYear[1]);
    const day = Number(monthDayYear[2]);
    const year = monthDayYear[3] ? Number(monthDayYear[3]) : now.getUTCFullYear();
    if (month >= 0 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month, day));
      if (date.getTime() > now.getTime() + 2 * 24 * 60 * 60 * 1000) {
        date.setUTCFullYear(year - 1);
      }
      return { iso: date.toISOString(), precision: monthDayYear[3] ? "exact" : "approximate" };
    }
  }
  return null;
}
