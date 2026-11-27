// Turning meetings into the lists on screen (the Android app's Listing.kt and Meetings).

import { FELLOWSHIPS, FELLOWSHIP_ORDER, IN_PERSON, ONLINE, isJoinable } from "./model.js";
import { nextOccurrence, occurrenceOn, skippedOn, viewerZone, zoneOf } from "./time.js";
import { STATE_NAMES } from "./text.js";

const EARTH_RADIUS_MILES = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

export function miles(lat1, lng1, lat2, lng2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(Math.min(1, a)));
}

export const hasCoordinates = (m) => m.lat !== null && m.lat !== undefined && m.lng !== null && m.lng !== undefined;

export function distanceTo(area, m) {
  return area && hasCoordinates(m) ? miles(area.lat, area.lng, m.lat, m.lng) : null;
}

export function covers(source, lat, lng) {
  const regional = source.centerLat != null && source.centerLng != null && source.radiusMiles != null;
  return !regional || miles(lat, lng, source.centerLat, source.centerLng) <= source.radiusMiles;
}

export function formatMiles(d) {
  if (d < 0.1) return "nearby";
  if (d < 10) return `${d.toFixed(1)} mi`;
  return `${Math.round(d)} mi`;
}

/** Drops listings that two sources both publish (same fellowship, day, time and name). */
export function dedupe(meetings) {
  const seen = new Set();
  return meetings.filter((m) => {
    const name = m.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const key = `${m.fellowship}|${m.day}|${m.start}|${name}|${m.attendance === ONLINE}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fills in a time zone for meetings whose feed left it out (common in NA listings),
 * borrowing it from the nearest meeting that has one, else the viewer's zone.
 */
export function resolveTimeZones(meetings, fallback = viewerZone()) {
  const anchors = meetings.filter((m) => m.tz && hasCoordinates(m));
  return meetings.map((m) => {
    if (m.tz) return m;
    let tz = null;
    if (hasCoordinates(m) && anchors.length) {
      let best = null;
      let bestD = Infinity;
      for (const a of anchors) {
        const d = miles(m.lat, m.lng, a.lat, a.lng);
        if (d < bestD) { bestD = d; best = a; }
      }
      if (best && bestD < 150) tz = best.tz;
    }
    return { ...m, tz: tz ?? fallback };
  });
}

// ", OR 97212" or ", OR" at the end of an address part.
const STATE_IN_ADDRESS = /,\s*([A-Z]{2})(?=\s+\d|\s*,|\s*$)/g;

export function matches(m, query) {
  if (!query || !query.trim()) return true;
  // Addresses say "OR"; people type "Oregon". Spell the state out so both match.
  const states = m.address ? [...m.address.matchAll(STATE_IN_ADDRESS)].map((x) => STATE_NAMES[x[1]]) : [];
  const hay = [m.name, m.locationName, m.address, ...states, FELLOWSHIPS[m.fellowship]?.full, FELLOWSHIPS[m.fellowship]?.label, ...m.types]
    .filter(Boolean).join(" ").toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

const passes = (state, m) =>
  (!state.fellowships.length || state.fellowships.includes(m.fellowship)) && matches(m, state.query) &&
  (!state.types?.length || state.types.every((t) => m.types.includes(t)));

function nearby(state, m) {
  if (!state.area || m.attendance === ONLINE) return null;
  const d = distanceTo(state.area, m);
  return d !== null && d <= state.radius ? d : null;
}

/** A meeting on the calendar: [start] is shown in zone [tz]. */
export function row(m, start, tz, dist) {
  return { m, start, end: start + m.duration * 60000, tz, dist, id: `${m.key}@${start}` };
}

export const inProgress = (r, now) => now >= r.start && now < r.end;
export const ended = (r, now) => now >= r.end;

/**
 * In-person and hybrid meetings within the radius on [date], in their local time. A meeting its
 * list says isn't happening that day stays in, marked closed, so regulars see it's off.
 */
export function nearbyRows(state, date) {
  const out = [];
  for (const m of state.meetings) {
    if (!passes(state, m)) continue;
    const d = nearby(state, m);
    if (d === null) continue;
    const tz = zoneOf(m);
    const start = occurrenceOn(m, date, tz);
    if (start !== null) out.push(row(m, start, tz, d));
    else {
      const skipped = skippedOn(m, date, tz);
      if (skipped !== null) out.push({ ...row(m, skipped, tz, d), closed: true });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.dist - b.dist);
}

const groupName = (s) => (s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Every listed time for the group [m] belongs to: same fellowship and name, and the same place
 * (or the same online room), soonest weekday first. "Is Try God only Monday and Wednesday?"
 */
export function groupMeetings(meetings, m) {
  const name = groupName(m.name);
  const samePlace = (o) => {
    if (m.attendance === ONLINE || o.attendance === ONLINE) return Boolean(m.joinUrl) && o.joinUrl === m.joinUrl;
    if (m.address && o.address && m.address === o.address) return true;
    return hasCoordinates(m) && hasCoordinates(o) && miles(m.lat, m.lng, o.lat, o.lng) < 0.1;
  };
  const seen = new Set();
  return meetings
    .filter((o) => o.fellowship === m.fellowship && groupName(o.name) === name && (o === m || samePlace(o)))
    .filter((o) => {
      const k = `${o.day}@${o.start}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.day - b.day || a.start - b.start);
}

/** Online meetings in the viewer's time. With no [date]: in progress or starting within [hoursAhead]. */
export function onlineRows(state, date, now, { hoursAhead = 3, englishOnly = state.englishOnly } = {}) {
  const tz = viewerZone();
  const horizon = now + hoursAhead * 3600000;
  const out = [];
  for (const m of state.meetings) {
    if (m.attendance === IN_PERSON || !isJoinable(m) || !passes(state, m)) continue;
    if (englishOnly && m.english === false) continue;
    let start;
    if (date === null) {
      start = nextOccurrence(m, now);
      if (start > horizon) continue;
    } else {
      start = occurrenceOn(m, date, tz);
      if (start === null) continue;
    }
    out.push(row(m, start, tz, null));
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Saved meetings by when they next happen. Online ones are shown in the viewer's time. */
export function savedRows(state, now) {
  return Object.values(state.favorites)
    .map((m) => row(m, nextOccurrence(m, now), m.attendance === ONLINE ? viewerZone() : zoneOf(m), distanceTo(state.area, m)))
    .sort((a, b) => a.start - b.start);
}

const order = (list) => [...new Set(list)].sort((a, b) => FELLOWSHIP_ORDER.indexOf(a) - FELLOWSHIP_ORDER.indexOf(b));

export const nearbyFellowships = (state) => order(state.meetings.filter((m) => nearby(state, m) !== null).map((m) => m.fellowship));

export const onlineFellowships = (state) =>
  order(state.meetings.filter((m) => m.attendance !== IN_PERSON && isJoinable(m)).map((m) => m.fellowship));
