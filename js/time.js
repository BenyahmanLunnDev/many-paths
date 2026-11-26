// Calendar and time-zone helpers. Dates are "YYYY-MM-DD" strings; moments are epoch
// milliseconds; zones are IANA names. The browser's Intl data does the zone math.

export const DAY_MS = 86_400_000;

export const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const partsFormatters = new Map();
const validZones = new Map();

export function isValidZone(tz) {
  if (!tz) return false;
  if (!validZones.has(tz)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      validZones.set(tz, true);
    } catch {
      validZones.set(tz, false);
    }
  }
  return validZones.get(tz);
}

function partsFormatter(tz) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of [ms] in [tz], straight from Intl (slow; see offsetMinutes). */
export function partsIn(ms, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(ms)) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

const offsetCache = new Map();

/**
 * Minutes [tz] is ahead of UTC at [ms]. Zones only change offset on a quarter hour, so the
 * answer is remembered per quarter hour: lists call this thousands of times.
 */
export function offsetMinutes(ms, tz) {
  const bucket = Math.floor(ms / 900000);
  const key = tz + "|" + bucket;
  let v = offsetCache.get(key);
  if (v === undefined) {
    const at = bucket * 900000;
    const p = partsIn(at, tz);
    v = Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - at) / 60000);
    if (offsetCache.size > 50000) offsetCache.clear();
    offsetCache.set(key, v);
  }
  return v;
}

/** Wall-clock fields of [ms] in [tz]. */
export function localParts(ms, tz) {
  const t = new Date(ms + offsetMinutes(ms, tz) * 60000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

/** The moment it's [minutes] past midnight on [date] in [tz]. */
export function zonedTime(date, minutes, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = offsetMinutes(guess, tz);
  let t = guess - first * 60000;
  const second = offsetMinutes(t, tz);
  if (second !== first) t = guess - second * 60000; // near a DST change
  return t;
}

const pad = (n) => String(n).padStart(2, "0");

export function dateIn(ms, tz) {
  const p = localParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday. */
export function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return addDays(s, 0) === s;
}

// ---- Meetings on the calendar (the Android app's Schedule.kt) ----

export function zoneOf(m) {
  return isValidZone(m.tz) ? m.tz : viewerZone();
}

/**
 * The start a meeting would have had on [date] when its list says it isn't meeting that day
 * (a holiday, a cancelled week), else null. Shown as "Not meeting" rather than left out, so
 * someone who goes every week finds out before they drive there.
 */
export function skippedOn(m, date, viewZone) {
  if (!m.skip || !m.skip.length) return null;
  const mz = zoneOf(m);
  for (const offset of [-1, 0, 1]) {
    const d = addDays(date, offset);
    if (weekday(d) !== m.day) continue;
    const start = zonedTime(d, m.start, mz);
    if (dateIn(start, viewZone) === date) return m.skip.includes(d) && (!m.until || d <= m.until) ? start : null;
  }
  return null;
}

/**
 * The US holiday on [date], or a day many buildings close around one, else null. Meeting lists
 * rarely say when a church or club is closed for a holiday, so the lists warn on these days.
 */
export function holidayOn(date) {
  const [, mo, d] = date.split("-").map(Number);
  const wd = weekday(date);
  const nth = Math.ceil(d / 7);
  const last = addDays(date, 7).slice(5, 7) !== date.slice(5, 7);
  if (mo === 1 && d === 1) return "New Year's Day";
  if (mo === 1 && wd === 1 && nth === 3) return "Martin Luther King Jr. Day";
  if (mo === 2 && wd === 1 && nth === 3) return "Presidents' Day";
  if (mo === 5 && wd === 1 && last) return "Memorial Day";
  if (mo === 6 && d === 19) return "Juneteenth";
  if (mo === 7 && d === 4) return "Independence Day";
  if (mo === 9 && wd === 1 && nth === 1) return "Labor Day";
  if (mo === 10 && wd === 1 && nth === 2) return "Indigenous Peoples' Day";
  if (mo === 11 && d === 11) return "Veterans Day";
  if (mo === 11 && wd === 4 && nth === 4) return "Thanksgiving";
  if (mo === 11 && wd === 5 && holidayOn(addDays(date, -1)) === "Thanksgiving") return "the day after Thanksgiving";
  if (mo === 12 && d === 24) return "Christmas Eve";
  if (mo === 12 && d === 25) return "Christmas";
  if (mo === 12 && d === 31) return "New Year's Eve";
  return null;
}

/** Upcoming dates a meeting is listed as not meeting, soonest first: ["2026-11-26", ...]. */
export function upcomingSkips(m, today, days = 60) {
  const end = addDays(today, days);
  return (m.skip ?? []).filter((d) => d >= today && d <= end).sort();
}

/** False on a listed closure day or after a hand-entered group's last date. */
export function meetsOn(m, date) {
  return !(m.skip && m.skip.includes(date)) && (!m.until || date <= m.until);
}

/**
 * The start of this meeting's occurrence that falls on [date] as seen from [viewZone], or null
 * if it doesn't meet that day. Online meetings use the viewer's zone; in-person ones their own.
 */
export function occurrenceOn(m, date, viewZone) {
  const mz = zoneOf(m);
  for (const offset of [-1, 0, 1]) {
    const d = addDays(date, offset);
    if (weekday(d) !== m.day) continue;
    const start = zonedTime(d, m.start, mz);
    if (dateIn(start, viewZone) === date) return meetsOn(m, d) ? start : null;
  }
  return null;
}

/** The next occurrence that hasn't ended yet (a meeting in progress counts). */
export function nextOccurrence(m, now) {
  const mz = zoneOf(m);
  const local = dateIn(now, mz);
  let d = addDays(local, (m.day - weekday(local) + 7) % 7);
  let start = zonedTime(d, m.start, mz);
  if (start + m.duration * 60000 <= now) {
    d = addDays(d, 7);
    start = zonedTime(d, m.start, mz);
  }
  // Step past closure days (a holiday, a cancelled week).
  for (let weeks = 0; !meetsOn(m, d) && weeks < 8; weeks++) {
    d = addDays(d, 7);
    start = zonedTime(d, m.start, mz);
  }
  return start;
}

// ---- Formatting ----

const formatters = new Map();
function fmt(key, tz, options) {
  const id = key + "|" + tz;
  let f = formatters.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: tz });
    formatters.set(id, f);
  }
  return f;
}

/** "7:00 PM" */
export const clock = (ms, tz) => fmt("clock", tz, { hour: "numeric", minute: "2-digit" }).format(ms);

/** ["7:00", "PM"] */
export function clockParts(ms, tz) {
  const text = clock(ms, tz);
  const i = text.lastIndexOf(" ");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 1)];
}

/** "PDT" */
export function zoneShort(ms, tz) {
  const part = fmt("zone", tz, { timeZoneName: "short", hour: "numeric" }).formatToParts(ms)
    .find((p) => p.type === "timeZoneName");
  return part ? part.value : tz;
}

export const differsFromViewer = (ms, tz) => offsetMinutes(ms, tz) !== offsetMinutes(ms, viewerZone());

export function timeRange(start, end, tz) {
  const [a, ap] = clockParts(start, tz);
  const [b, bp] = clockParts(end, tz);
  return ap === bp ? `${a}–${b} ${bp}` : `${clock(start, tz)} – ${clock(end, tz)}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const weekly = (m) => DAY_NAMES[m.day] + "s";

function dateBits(date) {
  const [, mo, d] = date.split("-").map(Number);
  const wd = weekday(date);
  return { wd, mon: MONTHS[mo - 1], d };
}

/** "Today", "Tomorrow", "Wed 21" */
export function dayChipLabel(date, today) {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  const b = dateBits(date);
  return `${DAY_NAMES[b.wd].slice(0, 3)} ${b.d}`;
}

/** "Today, Oct 19", "Tomorrow, Oct 20", "Wednesday, Oct 21" */
export function dayTitle(date, today) {
  const b = dateBits(date);
  if (date === today) return `Today, ${b.mon} ${b.d}`;
  if (date === addDays(today, 1)) return `Tomorrow, ${b.mon} ${b.d}`;
  return `${DAY_NAMES[b.wd]}, ${b.mon} ${b.d}`;
}

/** "Mon, Oct 19" */
export function shortDate(date) {
  const b = dateBits(date);
  return `${DAY_NAMES[b.wd].slice(0, 3)}, ${b.mon} ${b.d}`;
}

/** "MONDAY, OCT 19" style heading for shared week lists. */
export const longDate = (date) => {
  const b = dateBits(date);
  return `${DAY_NAMES[b.wd]}, ${b.mon} ${b.d}`;
};

export const dayAbbrev = (ms, tz) => DAY_NAMES[weekday(dateIn(ms, tz))].slice(0, 3);

/** "Tonight", "Tomorrow", "Thu, Oct 15", relative to [now] in [tz]. */
export function relativeDay(start, now, tz) {
  const today = dateIn(now, tz);
  const d = dateIn(start, tz);
  if (d === today) return localParts(start, tz).h >= 17 ? "Tonight" : "Today";
  if (d === addDays(today, 1)) return "Tomorrow";
  return shortDate(d);
}

/** "In 14 min", "Started 5 min ago"... or null when it's hours away. */
export function statusText(start, end, now) {
  if (now >= start && now < end) {
    const minutes = Math.floor((now - start) / 60000);
    return minutes < 1 ? "Starting now" : `Started ${minutes} min ago`;
  }
  const until = Math.floor((start - now) / 60000);
  if (until < 0) return null;
  if (until < 1) return "Starting now";
  if (until < 60) return `In ${until} min`;
  if (until < 180) return `In ${Math.floor(until / 60)} hr ${until % 60} min`;
  return null;
}

export function copiedDate(iso) {
  if (!isIsoDate(iso)) return null;
  return shortDate(iso);
}

/** "Mondays and Wednesdays", "Tuesdays, Thursdays and Saturdays", "Monday through Saturday", "every day". */
export function dayList(days) {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return "every day";
  if (set.length >= 3 && set[set.length - 1] - set[0] === set.length - 1) {
    return `${DAY_NAMES[set[0]]} through ${DAY_NAMES[set[set.length - 1]]}`;
  }
  const names = set.map((d) => DAY_NAMES[d] + "s");
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
