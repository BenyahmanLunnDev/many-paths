// Fetching meeting lists in the browser. Everything comes from the daily copy on GitHub
// Pages (many-paths-data), except NA near a place, which is asked live from NA's own
// meeting database with a rounded point. Group websites are never contacted from here.

import { bmltNearbyUrl, parseBmlt, parseTsml } from "./parse.js";
import { covers, dedupe, resolveTimeZones } from "./rows.js";
import { parseHelplines } from "./places.js";
import { dateIn, viewerZone } from "./time.js";

export const DATA = "https://benyahmanlunndev.github.io/many-paths-data/v1/";

async function getJson(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The list took too long to arrive");
    if (e instanceof TypeError) throw new Error("No internet connection");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

let catalogPromise = null;

/** Every list the apps know about, and today's build report (which lists have a copy). */
export function loadCatalog(force = false) {
  if (!catalogPromise || force) {
    catalogPromise = Promise.all([getJson(DATA + "sources.json"), getJson(DATA + "manifest.json")])
      .then(([sources, manifest]) => ({ sources, manifest }))
      .catch((e) => {
        catalogPromise = null;
        throw e;
      });
  }
  return catalogPromise;
}

const isRegional = (s) => s.centerLat != null && s.centerLng != null && s.radiusMiles != null;

/** Lists worth reading for [area] (null: no place chosen yet). */
export function relevantSources(sources, area) {
  return sources.filter((s) => {
    if (s.kind === "LINK" || s.kind === "PERSONAL") return false;
    if (s.kind === "BMLT_NEARBY") return Boolean(area);
    if (isRegional(s)) return Boolean(area) && covers(s, area.lat, area.lng);
    return true;
  });
}

const parsedFeeds = new Map(); // id → { stamp, meetings }

async function loadSource(source, manifest, area, radius, today) {
  if (source.kind === "BMLT_NEARBY") {
    const url = bmltNearbyUrl(source.url, area.lat, area.lng, radius);
    const memo = parsedFeeds.get(source.id);
    if (memo && memo.stamp === url && Date.now() - memo.at < 6 * 3600000) return ok(source, memo.meetings);
    const meetings = parseBmlt(await getJson(url), source);
    parsedFeeds.set(source.id, { stamp: url, at: Date.now(), meetings });
    return ok(source, meetings);
  }
  const report = manifest.sources?.[source.id];
  if (!report || !["ok", "previous"].includes(report.status)) {
    if (source.restricted) return { source, state: "RESTRICTED", count: 0, meetings: [] };
    return { source, state: "ERROR", count: 0, meetings: [], message: "No copy of this list today" };
  }
  const stamp = `${report.fetchedAt}|${today}`;
  const memo = parsedFeeds.get(source.id);
  let meetings = memo?.stamp === stamp ? memo.meetings : null;
  if (!meetings) {
    const data = await getJson(`${DATA}feeds/${encodeURIComponent(source.id)}.json`);
    meetings = source.kind === "BMLT_ONLINE" ? parseBmlt(data, source) : parseTsml(data, source, today);
    parsedFeeds.set(source.id, { stamp, meetings });
  }
  return { ...ok(source, meetings), state: report.status === "previous" ? "STALE" : "OK", fetchedAt: report.fetchedAt };
}

const ok = (source, meetings) => ({ source, state: "OK", count: meetings.length, meetings });

/**
 * Loads every relevant list. [phase] "nearby" skips the big online NA list so the first
 * screen fills quickly; "all" includes it.
 */
export async function loadMeetings({ area, radius, phase = "all", force = false }) {
  const { sources, manifest } = await loadCatalog(force);
  const today = dateIn(Date.now(), viewerZone());
  const wanted = relevantSources(sources, area).filter((s) => phase === "all" || s.kind !== "BMLT_ONLINE");
  const results = await Promise.all(wanted.map((s) =>
    loadSource(s, manifest, area, radius, today).catch((e) => ({ source: s, state: "ERROR", count: 0, meetings: [], message: e.message }))));
  const meetings = resolveTimeZones(dedupe(results.flatMap((r) => r.meetings)));
  const statuses = results.map(({ meetings: _, ...status }) => status);
  return { meetings, statuses, sources, generatedAt: manifest.generatedAt };
}

let helplinesPromise = null;
export function loadHelplines() {
  helplinesPromise ??= Promise.all(["helplines.json", "aa_helplines.json"].map((name) =>
    getJson(DATA + name).then(parseHelplines).catch(() => [])))
    .then((lists) => lists.flat());
  return helplinesPromise;
}

let placesPromise = null;
export function loadPlaces() {
  placesPromise ??= getJson(DATA + "places.json").catch((e) => {
    placesPromise = null;
    throw e;
  });
  return placesPromise;
}

/** OpenStreetMap's search, only for places the meeting index doesn't know. */
export async function searchOpenStreetMap(query) {
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=us,ca&q=" +
    encodeURIComponent(query);
  const results = await getJson(url, 15000);
  return (Array.isArray(results) ? results : []).map((r) => {
    const a = r.address ?? {};
    const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.county ?? r.name;
    const state = (a["ISO3166-2-lvl4"] ?? "").split("-")[1] ?? a.state;
    const label = [town, state].filter(Boolean).join(", ") || r.display_name;
    return { label, lat: Number(r.lat), lng: Number(r.lon) };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}
