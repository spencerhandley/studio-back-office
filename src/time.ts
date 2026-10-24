// Time zone math with Intl only, so there are no date library dependencies.

export const DEFAULT_TZ = "America/Los_Angeles";

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: string };

export function localParts(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: p.weekday,
  };
}

function offsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

// "2026-10-25T14:00" in a time zone, to a UTC Date.
export function zonedToUtc(local: string, tz: string): Date | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let result = guess - offsetMs(new Date(guess), tz);
  // Second pass corrects guesses that land on the other side of a DST change.
  result = guess - offsetMs(new Date(result), tz);
  return new Date(result);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatLocalIso(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatFriendly(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatClock(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${pad(m)}${suffix}` : `${h12}${suffix}`;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function inRange(minute: number, start: number, end: number) {
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

// Night hours when proactive texts never go out, in the creator's local time.
export const NIGHT_START = "21:00";
export const NIGHT_END = "09:00";

// Proactive messages (nudges) stay out of the night and out of the creator's best working hours.
export function isQuiet(user: { tz: string | null; work_start: string | null; work_end: string | null }, now: Date): boolean {
  const p = localParts(now, user.tz ?? DEFAULT_TZ);
  const minute = p.hour * 60 + p.minute;
  if (inRange(minute, toMinutes(NIGHT_START), toMinutes(NIGHT_END))) return true;
  if (user.work_start && user.work_end && inRange(minute, toMinutes(user.work_start), toMinutes(user.work_end))) return true;
  return false;
}

// ---------- Parsing what creators type ----------

const TZ_WORDS: [RegExp, string][] = [
  [/\b(pacific|pst|pdt|pt|california|los angeles|la|san francisco|sf|seattle|portland|oregon|washington state|vegas|nevada)\b/i, "America/Los_Angeles"],
  [/\b(arizona|phoenix|tucson)\b/i, "America/Phoenix"],
  [/\b(mountain|mst|mdt|mt|denver|colorado|utah|salt lake|boise|montana|new mexico|albuquerque)\b/i, "America/Denver"],
  [/\b(central|cst|cdt|ct|chicago|texas|austin|dallas|houston|nashville|minneapolis|new orleans|st\.? louis|kansas city|oklahoma)\b/i, "America/Chicago"],
  [/\b(eastern|est|edt|et|new york|nyc|ny|brooklyn|boston|miami|florida|atlanta|philadelphia|philly|dc|washington dc|detroit|ohio|north carolina|charlotte|pittsburgh)\b/i, "America/New_York"],
  [/\b(toronto|montreal|ottawa)\b/i, "America/Toronto"],
  [/\b(vancouver)\b/i, "America/Vancouver"],
  [/\b(alaska|anchorage)\b/i, "America/Anchorage"],
  [/\b(hawaii|honolulu)\b/i, "Pacific/Honolulu"],
  [/\b(london|uk|england|gmt|bst|scotland|ireland|dublin)\b/i, "Europe/London"],
  [/\b(berlin|paris|madrid|rome|amsterdam|cet|cest|germany|france|spain|italy)\b/i, "Europe/Berlin"],
  [/\b(sydney|melbourne)\b/i, "Australia/Sydney"],
  [/\b(mexico city|cdmx)\b/i, "America/Mexico_City"],
];

export function parseTz(text: string): string | null {
  const iana = text.match(/\b([A-Z][a-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/);
  if (iana && isValidTz(iana[1])) return iana[1];
  for (const [re, tz] of TZ_WORDS) if (re.test(text)) return tz;
  return null;
}

export type Hours = { start: string; end: string } | "none" | null;

function to24(h: number, mer: string | undefined): number {
  if (!mer) return h;
  const pm = mer.toLowerCase().startsWith("p");
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}

export function parseHours(text: string): Hours {
  const t = text.toLowerCase();
  if (/\b(no (set|fixed|real)|varies|it varies|whenever|all over|random|depends|no idea|not sure|any ?time)\b/.test(t)) return "none";

  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|to|until|till|thru|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/);
  if (m) {
    let sh = Number(m[1]);
    const sm = Number(m[2] ?? 0);
    let eh = Number(m[4]);
    const em = Number(m[5] ?? 0);
    let smer = m[3];
    let emer = m[6];
    if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
    if (!smer && !emer) {
      // No am/pm given. Read "9-1" as 9am to 1pm and "1-5" as afternoon.
      if (sh >= 7 && sh <= 11) {
        smer = "am";
        emer = eh > sh && eh < 12 ? "am" : "pm";
      } else if (sh === 12) {
        smer = "pm";
        emer = "pm";
      } else if (sh <= 6) {
        smer = "pm";
        emer = "pm";
      }
    } else if (!smer && emer) {
      // "9-1pm": the start is morning when it is bigger than the end.
      smer = sh > eh && sh !== 12 ? (emer.startsWith("p") ? "am" : "pm") : emer;
    } else if (smer && !emer) {
      emer = eh < sh ? (smer.startsWith("a") ? "pm" : "am") : smer;
    }
    sh = to24(sh, smer);
    eh = to24(eh, emer);
    const fmt = (h: number, mi: number) => `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
    if (sh === eh && sm === em) return null;
    return { start: fmt(sh, sm), end: fmt(eh, em) };
  }

  if (/early morning/.test(t)) return { start: "06:00", end: "09:00" };
  if (/morning/.test(t)) return { start: "08:00", end: "12:00" };
  if (/afternoon/.test(t)) return { start: "13:00", end: "17:00" };
  if (/evening/.test(t)) return { start: "18:00", end: "21:00" };
  if (/\b(night|late)\b/.test(t)) return { start: "21:00", end: "01:00" };
  return null;
}
