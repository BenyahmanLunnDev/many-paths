// Feed parsers, ported from the Android app's TsmlParser.kt and BmltParser.kt.
// A meeting here is a plain object; see model.js for the fields' meaning.

import { coordinate, isWebUrl, parseClock, str, stripTags, tidyName, withoutScheduleTail } from "./text.js";
import { HYBRID, IN_PERSON, ONLINE, parseFellowship } from "./model.js";
import { fromBmlt, fromMeetingGuide } from "./labels.js";
import { bmltLanguageName, fromTsmlCodes, looksNonEnglish } from "./language.js";
import { isIsoDate } from "./time.js";

/** Meeting Guide JSON (12 Step Meeting List sites, and the hand-entered local list). */
export function parseTsml(data, source, today) {
  if (!Array.isArray(data)) throw new Error(`${source.name} did not return a meeting list`);
  const out = [];
  for (const o of data) {
    if (!o || typeof o !== "object") continue;
    try {
      out.push(...tsmlMeeting(o, source, today));
    } catch {
      // one odd record never sinks the list
    }
  }
  return out;
}

function tsmlMeeting(o, source, today) {
  const rawName = str(o, "name");
  if (!rawName) return [];
  const name = withoutScheduleTail(tidyName(rawName));
  const start = parseClock(str(o, "time"));
  if (start === null) return [];
  const days = tsmlDays(o.day);
  if (!days.length) return [];

  const codes = tsmlCodes(o.types);
  const attendance = tsmlAttendance(o, codes);
  if (!attendance) return [];

  const end = parseClock(str(o, "end_time"));
  let duration = 60;
  if (end !== null) duration = (end - start + 24 * 60) % (24 * 60) || 60;

  const fellowship = parseFellowship(str(o, "fellowship")) ?? source.fellowship;
  const id = str(o, "id") ?? str(o, "slug") ?? `${name}-${start}`;
  const approximate = (str(o, "approximate") ?? "").toLowerCase() === "yes";
  const address = str(o, "formatted_address")?.replace(/, USA$/, "") ?? null;
  const tz = str(o, "timezone");
  // Hand-entered groups can carry an end date and closure days (not part of the Meeting Guide spec).
  const until = isIsoDate(str(o, "until")) ? str(o, "until") : null;
  if (until && today && today > until) return [];
  const skip = Array.isArray(o.skip) ? o.skip.filter(isIsoDate) : [];
  const english = fromTsmlCodes(codes) ?? (looksNonEnglish(name, tz) ? false : null);
  const location = str(o, "location");
  const joinUrl = str(o, "conference_url");
  const listingUrl = str(o, "url");

  return days.map((day) => ({
    key: `${source.id}:${id}:${day}`,
    sourceId: source.id,
    fellowship,
    name,
    day,
    start,
    duration,
    tz,
    attendance,
    locationName: location && location.toLowerCase() !== "online" ? location : null,
    address: approximate ? null : address,
    locationNotes: nullableTags(str(o, "location_notes")),
    lat: approximate ? null : coordinate(o, "latitude"),
    lng: approximate ? null : coordinate(o, "longitude"),
    notes: nullableTags(str(o, "notes")),
    types: fromMeetingGuide(codes),
    joinUrl: isWebUrl(joinUrl) ? joinUrl : null,
    joinNotes: nullableTags(str(o, "conference_url_notes")),
    joinPhone: str(o, "conference_phone"),
    phone: str(o, "phone") ?? str(o, "contact_1_phone"),
    listingUrl: isWebUrl(listingUrl) ? listingUrl : null,
    updated: str(o, "updated")?.slice(0, 10) ?? null,
    english,
    skip,
    until,
  }));
}

const nullableTags = (s) => (s === null ? null : stripTags(s));

function tsmlAttendance(o, codes) {
  const has = (code) => codes.some((c) => c.toUpperCase() === code);
  const closedTemporarily = has("TC");
  const hasLink = str(o, "conference_url") !== null || str(o, "conference_phone") !== null;
  let base;
  switch (str(o, "attendance_option")) {
    case "inactive": return null;
    case "in_person": base = IN_PERSON; break;
    case "online": base = ONLINE; break;
    case "hybrid": base = HYBRID; break;
    default:
      if (has("ONL") && str(o, "approximate") === "yes") base = ONLINE;
      else if (has("ONL") || hasLink) base = HYBRID;
      else base = IN_PERSON;
  }
  // "Location temporarily closed" means only the online part still meets.
  if (closedTemporarily) return base === IN_PERSON ? null : ONLINE;
  return base;
}

function toDay(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : Math.trunc(v);
  if (typeof v === "string" && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return -1;
}

function tsmlDays(value) {
  const list = Array.isArray(value) ? value.map(toDay) : value === null || value === undefined ? [] : [toDay(value)];
  return [...new Set(list.filter((d) => d >= 0 && d <= 6))];
}

function tsmlCodes(value) {
  const list = Array.isArray(value) ? value.map((c) => (c === null || c === undefined ? "" : String(c)))
    : typeof value === "string" ? value.split(",") : [];
  return list.map((c) => c.trim()).filter(Boolean);
}

// ---- NA (BMLT) ----

export const BMLT_FIELDS = "id_bigint,meeting_name,weekday_tinyint,start_time,duration_time," +
  "time_zone,formats,venue_type,location_text,location_info,location_street," +
  "location_municipality,location_province,location_postal_code_1,latitude,longitude," +
  "comments,virtual_meeting_link,virtual_meeting_additional_info,phone_meeting_number,lang_enum";

/** Rounds to one decimal place (about 7 miles) before a location leaves the device. */
export const coarse = (v) => Math.round(v * 10) / 10;

export function bmltNearbyUrl(base, lat, lng, radiusMiles) {
  // A wide fixed circle around a coarse point, filtered on the device: the exact location
  // stays private and the radius can change without asking again.
  const width = radiusMiles <= 50 ? 60 : 110;
  const root = base.endsWith("/") ? base : base + "/";
  return `${root}client_interface/json/?switcher=GetSearchResults&lat_val=${coarse(lat)}&long_val=${coarse(lng)}` +
    `&geo_width=${width}&data_field_key=` + encodeURIComponent(BMLT_FIELDS + ",root_server_uri");
}

export function parseBmlt(data, source) {
  if (!Array.isArray(data)) throw new Error(`${source.name} did not return a meeting list`);
  const out = [];
  for (const o of data) {
    if (!o || typeof o !== "object") continue;
    try {
      const m = bmltMeeting(o, source);
      if (m) out.push(m);
    } catch {
      // skip it
    }
  }
  return out;
}

/** Java's String.hashCode, so keys match the Android app's. */
function javaHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function bmltMeeting(o, source) {
  const rawName = str(o, "meeting_name");
  if (!rawName) return null;
  const name = tidyName(rawName);
  const weekdayText = str(o, "weekday_tinyint");
  const weekday = weekdayText && /^\d+$/.test(weekdayText) ? parseInt(weekdayText, 10) : null;
  if (weekday === null || weekday < 1 || weekday > 7) return null;
  const start = parseClock(str(o, "start_time"));
  if (start === null) return null;
  const durationClock = parseClock(str(o, "duration_time"));
  const duration = durationClock && durationClock > 0 ? durationClock : 60;
  const codes = (str(o, "formats") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const has = (code) => codes.some((c) => c.toUpperCase() === code);

  const linkText = str(o, "virtual_meeting_link");
  const link = isWebUrl(linkText) ? linkText : null;
  const phone = str(o, "phone_meeting_number");
  let attendance;
  switch (str(o, "venue_type")) {
    case "1": attendance = IN_PERSON; break;
    case "2": attendance = ONLINE; break;
    case "3": attendance = HYBRID; break;
    default: attendance = has("VM") ? ONLINE : has("HY") ? HYBRID : IN_PERSON;
  }
  if (has("TC")) {
    if (attendance === IN_PERSON) return null;
    attendance = ONLINE;
  }
  if (attendance === ONLINE && !link && !phone) return null;

  const street = str(o, "location_street");
  const town = str(o, "location_municipality");
  const state = [str(o, "location_province"), str(o, "location_postal_code_1")].filter(Boolean).join(" ");
  const address = street ? [street, town, state || null].filter(Boolean).join(", ") : null;

  const id = str(o, "id_bigint") ?? `${name}-${weekday}-${start}`;
  const serverUri = str(o, "root_server_uri");
  const server = serverUri ? javaHash(serverUri).toString(36) : null;
  const notes = [str(o, "comments"), str(o, "virtual_meeting_additional_info")].filter(Boolean).join("\n\n");

  const online = attendance === ONLINE;
  const tz = str(o, "time_zone");
  const languageName = bmltLanguageName(str(o, "lang_enum"));
  const english = looksNonEnglish(name, tz) || languageName ? false : null;
  return {
    key: [source.id, server, id].filter(Boolean).join(":"),
    sourceId: source.id,
    fellowship: source.fellowship,
    name,
    day: weekday - 1,
    start,
    duration,
    tz,
    attendance,
    locationName: online ? null : str(o, "location_text"),
    address: online ? null : address,
    locationNotes: online ? null : str(o, "location_info"),
    lat: online ? null : coordinate(o, "latitude"),
    lng: online ? null : coordinate(o, "longitude"),
    notes: notes ? stripTags(notes) : null,
    types: [...(languageName ? [languageName] : []), ...fromBmlt(codes)],
    joinUrl: link,
    joinNotes: null,
    joinPhone: phone,
    phone: null,
    listingUrl: source.website ?? null,
    updated: null,
    english,
    skip: [],
    until: null,
  };
}
