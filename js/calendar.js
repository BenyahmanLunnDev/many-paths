// A weekly calendar event (.ics) for one meeting, with its listed closure days left out and a
// reminder before it starts. Calendars on phones and computers remind people without Many
// Paths running anything, which a website can't do on its own once the page is closed.

import { addDays, dateIn, weekday, zoneOf } from "./time.js";

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const pad = (n) => String(n).padStart(2, "0");
const text = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const local = (date, minutes) => `${date.replace(/-/g, "")}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;

/** Lines longer than 75 characters continue on the next line after a space (RFC 5545). */
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

/**
 * The .ics text for [m]: every week on its day, in the meeting's own time zone, from its next
 * occurrence on. [label] goes after the name ("Try God (AA)"), [alarmMinutes] sets the reminder.
 */
export function meetingIcs(m, { now = Date.now(), label = null, alarmMinutes = 30, site = "https://manypathsmeetings.com" } = {}) {
  const tz = zoneOf(m);
  const today = dateIn(now, tz);
  const first = addDays(today, (m.day - weekday(today) + 7) % 7);
  const endMinutes = m.start + m.duration;
  const endDate = endMinutes >= 1440 ? addDays(first, 1) : first;
  const where = m.attendance === "ONLINE" ? m.joinUrl : [m.locationName, m.address].filter(Boolean).join(", ");
  const about = [
    m.joinUrl ? `Join: ${m.joinUrl}` : null,
    m.joinNotes ? m.joinNotes : null,
    m.listingUrl ? `Listing: ${m.listingUrl}` : null,
    "Schedules change, especially around holidays. Check the listing before a first visit.",
    `From Many Paths: ${site}`,
  ].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Many Paths//Recovery meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.key.replace(/[^A-Za-z0-9._-]/g, "-")}@manypathsmeetings.com`,
    `DTSTAMP:${new Date(now).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;TZID=${tz}:${local(first, m.start)}`,
    `DTEND;TZID=${tz}:${local(endDate, endMinutes % 1440)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[m.day]}${m.until ? `;UNTIL=${m.until.replace(/-/g, "")}T235959Z` : ""}`,
    ...(m.skip ?? []).filter((d) => d >= first).sort().map((d) => `EXDATE;TZID=${tz}:${local(d, m.start)}`),
    `SUMMARY:${text(label ? `${m.name} (${label})` : m.name)}`,
    where ? `LOCATION:${text(where)}` : null,
    `DESCRIPTION:${text(about)}`,
    m.listingUrl ? `URL:${m.listingUrl}` : null,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${text(m.name)}`,
    `TRIGGER:-PT${alarmMinutes}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A safe file name for the download: "Try God.ics". */
export const icsFileName = (name) => (name.replace(/[^\p{L}\p{N} ._-]+/gu, "").trim().slice(0, 60) || "meeting") + ".ics";
