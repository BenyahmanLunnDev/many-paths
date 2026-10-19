// Plain-text lists to send by text message (the Android app's Actions.kt).

import { FELLOWSHIPS, HYBRID, ONLINE, placeLine } from "./model.js";
import { clock, dayAbbrev, differsFromViewer, longDate, shortDate, timeRange, weekly, zoneShort } from "./time.js";

const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(globalThis.navigator?.userAgent ?? "") &&
  (globalThis.navigator?.maxTouchPoints ?? 0) > 0;

/** Directions in Apple Maps on iPhones and iPads, Google Maps everywhere else (and in shared text). */
export function directionsUrl(m, { forSharing = false } = {}) {
  const destination = m.address ?? (m.lat != null ? `${m.lat},${m.lng}` : null);
  if (!destination) return null;
  if (!forSharing && isApple()) return "https://maps.apple.com/?daddr=" + encodeURIComponent(destination);
  return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
}

const label = (m) => FELLOWSHIPS[m.fellowship]?.label ?? "Other";

export function meetingShareText(r) {
  const m = r.m;
  const zone = m.attendance === ONLINE || differsFromViewer(r.start, r.tz) ? " " + zoneShort(r.start, r.tz) : "";
  const lines = [`${label(m)}: ${m.name}`, `${weekly(m)}, ${timeRange(r.start, r.end, r.tz)}${zone}`];
  if (m.attendance !== ONLINE) {
    if (m.locationName) lines.push(m.locationName);
    if (m.address) lines.push(m.address);
    const directions = directionsUrl(m, { forSharing: true });
    if (directions) lines.push(`Directions: ${directions}`);
  }
  if (m.joinUrl) lines.push(`Join online: ${m.joinUrl}`);
  if (m.joinNotes) lines.push(m.joinNotes);
  if (m.listingUrl) lines.push(`Details: ${m.listingUrl}`);
  return lines.join("\n").trim();
}

function phoneLines(lines) {
  if (!lines?.length) return [];
  return ["Local phone lines", ...lines.map(({ line }) => `   ${FELLOWSHIPS[line.fellowship]?.label ?? "Other"} · ${line.name}: ${line.phones[0].number}`), ""];
}

function rowLines(r, withDay) {
  const m = r.m;
  const day = withDay ? dayAbbrev(r.start, r.tz) + " " : "";
  const zone = m.attendance === ONLINE || differsFromViewer(r.start, r.tz) ? " " + zoneShort(r.start, r.tz) : "";
  const online = m.attendance === HYBRID ? " (also online)" : "";
  const out = [`${day}${clock(r.start, r.tz)}${zone} · ${label(m)} · ${m.name}${online}`];
  if (m.attendance === ONLINE) {
    if (m.joinUrl) out.push(`   Join: ${m.joinUrl}`);
  } else {
    const place = placeLine(m);
    if (place) out.push(`   ${place}`);
  }
  return out;
}

function footer({ missing = [], copied = [] } = {}) {
  const out = [];
  if (copied.length) {
    out.push("");
    for (const { source, date } of copied) {
      out.push(`${source.name} meetings were copied from their website${date ? ` on ${date}` : ""} and may have changed` +
        (source.website ? `: ${source.website}` : "."));
    }
  }
  if (missing.length) {
    out.push("");
    for (const s of missing) {
      const fl = FELLOWSHIPS[s.fellowship]?.label ?? "";
      const name = s.name.includes(fl) ? s.name : `${s.name} (${fl})`;
      out.push(`Not included: ${name} only shares its list on its website` + (s.website ? `: ${s.website}` : "."));
    }
  }
  out.push("", "Listings change, especially around holidays. Check the group's own listing or call before a first visit.",
    "Shared from Many Paths");
  return out;
}

export function listShareText(title, rows, { withDay = false, limit = 60, extras = {} } = {}) {
  const out = [title, "", ...phoneLines(extras.lines)];
  for (const r of rows.slice(0, limit)) out.push(...rowLines(r, withDay));
  if (rows.length > limit) out.push(`…and ${rows.length - limit} more`);
  out.push(...footer(extras));
  return out.join("\n");
}

/** A week of in-person meetings for one place, day by day, like a printed meeting guide. */
export function weekShareText(placeLabel, radius, days, today, extras = {}, perDayLimit = 40) {
  const first = days.find(([, rows]) => rows.length)?.[1][0];
  const zone = first ? zoneShort(first.start, first.tz) : null;
  const out = [`Recovery meetings near ${placeLabel}`,
    `${shortDate(today)} – ${shortDate(days[days.length - 1][0])} · within ${radius} miles` + (zone ? ` · times are local (${zone})` : ""),
    "", ...phoneLines(extras.lines)];
  for (const [date, rows] of days) {
    out.push(longDate(date).toUpperCase());
    if (!rows.length) out.push("   No meetings listed");
    for (const r of rows.slice(0, perDayLimit)) out.push(...rowLines(r, false));
    if (rows.length > perDayLimit) out.push(`   …and ${rows.length - perDayLimit} more`);
    out.push("");
  }
  out.push(...footer(extras));
  return out.join("\n");
}
