// Finding a town or ZIP code in the index the daily data job builds from meeting addresses
// (v1/places.json), and phone lines near a place. Nothing typed here leaves the device.

import { miles } from "./rows.js";
import { coordinate, str } from "./text.js";
import { parseFellowship, FELLOWSHIP_ORDER } from "./model.js";

const STATES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR", alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
  "newfoundland and labrador": "NL", "nova scotia": "NS", ontario: "ON", "prince edward island": "PE",
  quebec: "QC", saskatchewan: "SK",
};

const fold = (s) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();

/** Places matching what someone typed, best first: [{label, lat, lng}]. */
export function searchPlaces(index, query, limit = 8) {
  const q = fold(query);
  if (!q || !index) return [];
  const zip = q.match(/^(\d{5})(?:-\d{4})?$/);
  if (zip) {
    const hit = index.zips[zip[1]];
    return hit ? [{ label: zip[1], lat: hit[0], lng: hit[1] }] : [];
  }
  // "eugene, or", "eugene or", "eugene, oregon". A trailing state is only a guess
  // ("Port Washington" is a town in New York), so the whole text is tried as a town too.
  const whole = rankPlaces(index, q, null);
  const [town, state] = splitState(q);
  const parsed = state ? rankPlaces(index, town, STATES[state] ?? state.toUpperCase()) : [];
  const merged = [...whole.filter((x) => x[0] === 0), ...parsed, ...whole.filter((x) => x[0] !== 0)];
  const seen = new Set();
  const out = [];
  for (const [, p] of merged) {
    const label = `${p[0]}, ${p[1]}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, lat: p[2], lng: p[3] });
    if (out.length === limit) break;
  }
  return out;
}

function splitState(q) {
  const comma = q.lastIndexOf(",");
  if (comma > 0) return [q.slice(0, comma).trim(), q.slice(comma + 1).trim() || null];
  const m = q.match(/^(.*\S)\s+([a-z]{2})$/);
  if (m && Object.values(STATES).includes(m[2].toUpperCase())) return [m[1], m[2]];
  for (const name of Object.keys(STATES)) {
    if (q.endsWith(" " + name)) return [q.slice(0, -name.length - 1).trim(), name];
  }
  return [q, null];
}

/** [rank, place] pairs: 0 exact name, 1 starts with, 2 a later word starts with; busiest first. */
function rankPlaces(index, town, stateCode) {
  const scored = [];
  for (const p of index.places) {
    // A one-letter state is someone still typing ("Eugene, O").
    if (stateCode && !(stateCode.length < 2 ? p[1].startsWith(stateCode) : p[1] === stateCode)) continue;
    const name = fold(p[0]);
    const rank = name === town ? 0 : name.startsWith(town) ? 1 : name.includes(" " + town) ? 2 : -1;
    if (rank >= 0) scored.push([rank, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || b[1][4] - a[1][4]);
}

/** "Eugene, OR" for a spot, from the nearest town with meetings, or null when none is close. */
export function nearestPlace(index, lat, lng) {
  let best = null;
  let bestD = Infinity;
  for (const p of index?.places ?? []) {
    const d = miles(lat, lng, p[2], p[3]);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best && bestD < 15 ? `${best[0]}, ${best[1]}` : null;
}

// ---- Phone lines (the Android app's Helplines.kt) ----

export function parseHelplines(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const phones = (Array.isArray(o.phones) ? o.phones : [])
      .map((p) => (str(p, "number") ? { label: str(p, "label") ?? "Phone", number: str(p, "number") } : null))
      .filter(Boolean);
    const lat = coordinate(o, "lat");
    const lng = coordinate(o, "lng");
    const name = str(o, "name");
    if (lat === null || lng === null || !phones.length || !name) continue;
    const website = str(o, "website");
    out.push({
      name,
      fellowship: parseFellowship(str(o, "fellowship")) ?? "OTHER",
      area: str(o, "area"),
      lat,
      lng,
      radiusMiles: typeof o.radiusMiles === "number" ? o.radiusMiles : 60,
      phones,
      website: website && /^https?:\/\//i.test(website) ? website : null,
    });
  }
  return out;
}

/** The closest couple of AA offices and the closest line for each other fellowship. */
export function linesNear(all, area, max = 4) {
  const inRange = all.map((line) => ({ line, d: miles(area.lat, area.lng, line.lat, line.lng) }))
    .filter(({ line, d }) => d <= line.radiusMiles)
    .sort((a, b) => a.d - b.d);
  const picked = [];
  const numbers = new Set();
  for (const item of inRange) {
    const same = picked.filter((p) => p.line.fellowship === item.line.fellowship).length;
    if (same >= (item.line.fellowship === "AA" ? 2 : 1)) continue;
    if (numbers.has(item.line.phones[0].number)) continue;
    picked.push(item);
    numbers.add(item.line.phones[0].number);
    if (picked.length === max) break;
  }
  const rank = (f) => FELLOWSHIP_ORDER.indexOf(f);
  return picked.sort((a, b) => rank(a.line.fellowship) - rank(b.line.fellowship) || a.d - b.d);
}
