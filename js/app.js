// Many Paths on the web: the screens. Logic lives in the other modules; this file reads
// state, writes HTML (every piece of feed text goes through esc()), and handles taps.

import { DATA, loadCatalog, loadHelplines, loadMeetings, loadPlaces, searchOpenStreetMap } from "./data.js";
import { ATTENDANCE_LABEL, FELLOWSHIPS, HYBRID, IN_PERSON, ONLINE, isJoinable, placeLine } from "./model.js";
import { describe } from "./labels.js";
import {
  covers, distanceTo, ended, formatMiles, inProgress, miles, nearbyFellowships, nearbyRows,
  onlineFellowships, onlineRows, row, savedRows,
} from "./rows.js";
import { linesNear, nearestPlace, searchPlaces } from "./places.js";
import { directionsUrl, listShareText, meetingShareText, weekShareText } from "./share.js";
import {
  addDays, clock, clockParts, copiedDate, dateIn, dayChipLabel, dayTitle, differsFromViewer, nextOccurrence,
  relativeDay, statusText, timeRange, viewerZone, weekly, zoneOf, zoneShort,
} from "./time.js";
import { formatPhone } from "./text.js";
import { icon } from "./icons.js";

const ANDROID_URL = null; // the Google Play link, once the Android app is public
const PRIVACY_URL = "https://benyahmanlunndev.github.io/many-paths-data/privacy.html";
const SOURCE_URL = "https://github.com/BenyahmanLunnDev/many-paths";
const CONTACT_EMAIL = "manypathsdev@gmail.com";
const RADII = [5, 10, 15, 25];
const PAGE = 100; // cards drawn at once; a day of online meetings can run to hundreds

// ---- Saved settings (this browser only) ----

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("mp." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("mp." + key, JSON.stringify(value));
    } catch {
      // private browsing or storage full: settings just won't stick
    }
  },
};

const validArea = (a) => a && Number.isFinite(a.lat) && Number.isFinite(a.lng) && typeof a.label === "string" ? a : null;
const validList = (l) => (Array.isArray(l) ? l.filter((f) => FELLOWSHIPS[f]) : []);
const validFavorites = (f) => (f && typeof f === "object" && !Array.isArray(f) ? f : {});

const state = {
  area: validArea(store.get("area", null)),
  radius: RADII.includes(store.get("radius", 15)) ? store.get("radius", 15) : 15,
  fellowships: validList(store.get("fellowships", [])),
  englishOnly: store.get("englishOnly", true) !== false,
  favorites: validFavorites(store.get("favorites", {})),
  query: "",
  searchOpen: false,
  meetings: [],
  byKey: new Map(),
  statuses: [],
  sources: [],
  generatedAt: null,
  loading: false,
  loaded: false,
  onlineLoaded: false,
  error: null,
  loadedAt: 0,
  helplines: [],
  dayOffset: 0,
  onlineWhen: "soon",
  showEarlier: false,
  limit: PAGE,
};

// ---- Little helpers ----

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^(https?:|tel:|sms:|mailto:)/i.test(u ?? "") ? u : "#");
const telUrl = (n) => "tel:" + n.replace(/[^\d+,;#*]/g, "").replace(/#/g, "%23");
const ext = (url, text, cls = "") => `<a class="${cls}" href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${text}</a>`;
const fl = (f) => FELLOWSHIPS[f] ?? FELLOWSHIPS.OTHER;
const today = () => dateIn(Date.now(), viewerZone());
const sourceById = (id) => state.sources.find((s) => s.id === id);
const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

function setState(changes) {
  Object.assign(state, changes);
  for (const key of ["area", "radius", "fellowships", "englishOnly", "favorites"]) {
    if (key in changes) store.set(key, state[key]);
  }
}

// ---- Loading ----

let loadToken = 0;

async function refresh({ force = false } = {}) {
  const token = ++loadToken;
  setState({ loading: true, error: null });
  render();
  try {
    // In-person lists first so "Near me" fills in quickly; the big online NA list follows.
    apply(await loadMeetings({ area: state.area, radius: state.radius, phase: "nearby", force }), token);
    if (token === loadToken) setState({ loaded: true });
    render();
    apply(await loadMeetings({ area: state.area, radius: state.radius, phase: "all" }), token);
    if (token === loadToken) setState({ onlineLoaded: true });
  } catch (e) {
    if (token === loadToken) setState({ error: e.message, loaded: true });
  } finally {
    if (token === loadToken) {
      setState({ loading: false, loadedAt: Date.now() });
      render();
    }
  }
}

function apply(result, token) {
  if (token !== loadToken) return;
  setState({
    meetings: result.meetings,
    byKey: new Map(result.meetings.map((m) => [m.key, m])),
    statuses: result.statuses,
    sources: result.sources,
    generatedAt: result.generatedAt,
  });
}

function setArea(area) {
  setState({ area, dayOffset: 0, showEarlier: false });
  refresh();
}

// ---- Routing: #/ near me, #/online, #/saved, #/about, #/m/<key> ----

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.startsWith("m/")) return { view: "detail", key: decodeURIComponent(h.slice(2)) };
  if (["online", "saved", "about"].includes(h)) return { view: h };
  return { view: "near" };
}

const scrollMemory = {};
let currentView = route().view;
let openedDetailFromApp = false;

window.addEventListener("hashchange", () => {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close()); // the back button closes a sheet too
  scrollMemory[currentView] = window.scrollY;
  const next = route().view;
  currentView = next;
  render();
  window.scrollTo(0, next === "detail" || next === "about" ? 0 : scrollMemory[next] ?? 0);
});

// ---- Rendering ----

const app = document.getElementById("app");

// Lists computed for one screen update; the online tab asks for the same list several times.
let memoStore = new Map();
const memo = (key, fn) => {
  if (!memoStore.has(key)) memoStore.set(key, fn());
  return memoStore.get(key);
};
const onlineFor = (date, englishOnly) =>
  memo(`online|${date}|${englishOnly}`, () => onlineRows(state, date, Date.now(), { englishOnly }));

function render() {
  memoStore = new Map();
  const r = route();
  document.body.dataset.view = r.view;
  if (r.view === "detail") app.innerHTML = detailView(r.key);
  else if (r.view === "about") app.innerHTML = aboutView();
  else app.innerHTML = mainView(r.view);
  document.title = { near: "Many Paths", online: "Online meetings · Many Paths", saved: "Saved meetings · Many Paths",
    about: "Lists and help · Many Paths", detail: "Meeting · Many Paths" }[r.view];
}

/** Re-renders just the list, so typing in the search box keeps its focus. */
function updateList() {
  memoStore = new Map();
  const list = document.getElementById("list");
  const r = route();
  if (list && r.view !== "detail" && r.view !== "about") list.innerHTML = listFor(r.view);
  else if (r.view === "detail") render();
}

function mainView(view) {
  const title = { near: "Many Paths", online: "Online meetings", saved: "Saved meetings" }[view];
  return `
    <header class="top">
      <h1>${title}</h1>
      <div class="top-actions">
        <button class="icon-btn" data-action="toggle-search" aria-label="Search" aria-expanded="${state.searchOpen}">${icon("search")}</button>
        <button class="icon-btn" data-action="share-menu" aria-label="Share this list">${icon("share")}</button>
        <a class="icon-btn" href="#/about" aria-label="Meeting lists and help">${icon("info")}</a>
      </div>
    </header>
    ${state.searchOpen ? `<div class="search-row"><input id="q" type="search" placeholder="Search names, places, types" value="${esc(state.query)}" autocomplete="off" enterkeyhint="search" aria-label="Search meetings"></div>` : ""}
    ${view === "near" ? nearControls() : view === "online" ? onlineControls() : ""}
    <main id="list" class="list" aria-live="polite">${listFor(view)}</main>
    ${tabBar(view)}`;
}

function tabBar(view) {
  const tab = (id, href, name, label) =>
    `<a href="${href}" class="tab${view === id ? " on" : ""}"${view === id ? ' aria-current="page"' : ""}>${icon(name)}<span>${label}</span></a>`;
  return `<nav class="tabs" aria-label="Sections">${tab("near", "#/", "place", "Near me")}${tab("online", "#/online", "videocam", "Online")}${tab("saved", "#/saved", "heart", "Saved")}</nav>`;
}

function listFor(view) {
  if (view === "online") return onlineList();
  if (view === "saved") return savedList();
  return nearList();
}

// ---- Near me ----

function areaBar() {
  const lines = state.area ? linesNear(state.helplines, state.area) : [];
  return `
    <div class="area-bar">
      <button class="area-main" data-action="pick-area">
        ${icon("place", "icon brand")}
        <span class="area-text">
          <strong>${state.area ? esc(state.area.label) : "Choose where to look"}</strong>
          <small>${state.area ? `Within ${state.radius} miles · tap to change` : "Use your location or type a city"}</small>
        </span>
        ${icon("expand")}
      </button>
      ${lines.length ? `<button class="icon-btn brand" data-action="lines" aria-label="Local phone lines">${icon("phone")}</button>` : ""}
    </div>`;
}

function fellowshipChips(available) {
  if (available.length < 2) return "";
  const all = !state.fellowships.length;
  return `<div class="chips" role="group" aria-label="Fellowship">
    <button class="chip${all ? " on" : ""}" data-action="fellowship" data-value="" aria-pressed="${all}">All</button>
    ${available.map((f) => {
      const on = state.fellowships.includes(f);
      return `<button class="chip${on ? " on" : ""}" data-action="fellowship" data-value="${f}" aria-pressed="${on}" title="${esc(fl(f).full)}">${esc(fl(f).label)}</button>`;
    }).join("")}
  </div>`;
}

function nearControls() {
  if (!state.area) return areaBar();
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => i);
  return `${areaBar()}
    <div class="chips" role="group" aria-label="Day">
      ${days.map((i) => `<button class="chip${state.dayOffset === i ? " on" : ""}" data-action="day" data-value="${i}" aria-pressed="${state.dayOffset === i}">${dayChipLabel(addDays(t, i), t)}</button>`).join("")}
    </div>
    ${fellowshipChips(nearbyFellowships(state))}`;
}

function nearList() {
  const out = [];
  if (isApple && !standalone() && !store.get("installHintDismissed", false)) {
    out.push(notice("Keep Many Paths on your Home Screen",
      "Tap the Share button in Safari, then “Add to Home Screen”. It opens like an app.",
      `<button class="text-btn" data-action="dismiss-install">Got it</button>`));
  } else if (ANDROID_URL && /Android/.test(navigator.userAgent) && !store.get("androidHintDismissed", false)) {
    out.push(notice("There's an Android app", "Many Paths for Android works offline and saves your meetings.",
      `${ext(ANDROID_URL, "Get it on Google Play", "text-btn")}<button class="text-btn" data-action="dismiss-android">No thanks</button>`));
  }
  if (!state.area) {
    out.push(`<section class="welcome">
      <h2>Find a meeting near you</h2>
      <p>Many Paths puts NA, AA, Refuge Recovery, Recovery Dharma, CMA, Wellbriety and other recovery meetings in one list.</p>
      <div class="row-btns">
        <button class="btn" data-action="locate">${icon("myLocation")} Use my location</button>
        <button class="btn tonal" data-action="pick-area">Type a city</button>
      </div>
      <p class="small">Online meetings don't need a location. They're in the Online tab.</p>
    </section>`);
    return out.join("");
  }
  out.push(...areaNotices());
  const t = today();
  const date = addDays(t, state.dayOffset);
  const rows = nearbyRows(state, date);
  const now = Date.now();
  if (!state.loaded) {
    out.push(loadingCard("Checking NA, AA, Refuge Recovery, Recovery Dharma, CMA and local groups."));
  } else if (!rows.length) {
    const filtered = state.fellowships.length || state.query.trim();
    out.push(`<section class="empty"><h2>No meetings found</h2>
      <p>Nothing within ${state.radius} miles on ${dayTitle(date, t)}${filtered ? " with these filters." : "."} Try a wider distance or another day.</p>
      <button class="btn tonal" data-action="pick-area">Change distance</button></section>`);
  } else if (date === t) {
    const current = rows.filter((r) => inProgress(r, now));
    const upcoming = rows.filter((r) => r.start > now);
    const earlier = rows.filter((r) => ended(r, now));
    if (current.length) out.push(sectionLabel("Happening now"), ...current.map((r) => card(r, now)));
    if (upcoming.length) out.push(sectionLabel("Coming up today"), ...upcoming.map((r) => card(r, now)));
    else out.push(`<p class="muted">That's everything for today. Tap Tomorrow above for more.</p>`);
    if (earlier.length) {
      out.push(`<button class="text-btn" data-action="toggle-earlier">${state.showEarlier ? "Hide earlier meetings" : `Show ${earlier.length} earlier today`}</button>`);
      if (state.showEarlier) out.push(...earlier.map((r) => card(r, now, true)));
    }
  } else {
    out.push(sectionLabel(`${dayTitle(date, t)} · ${rows.length} meetings`), ...rows.map((r) => card(r, now)));
  }
  out.push(footer());
  return out.join("");
}

function copies() {
  return state.statuses
    .filter((s) => s.source.copyOf && s.count > 0 && (s.state === "OK" || s.state === "STALE"))
    .map((s) => {
      let newest = null;
      for (const m of state.meetings) if (m.sourceId === s.source.id && m.updated && (!newest || m.updated > newest)) newest = m.updated;
      return { source: s.source, date: newest ? copiedDate(newest) : null };
    });
}

function restrictedNearby() {
  const a = state.area;
  if (!a) return [];
  const dist = (s) => (s.centerLat != null ? miles(a.lat, a.lng, s.centerLat, s.centerLng) : Infinity);
  return state.statuses.filter((s) => s.state === "RESTRICTED" && covers(s.source, a.lat, a.lng)).map((s) => s.source)
    .sort((x, y) => dist(x) - dist(y));
}

function areaNotices() {
  const out = [];
  const restricted = restrictedNearby();
  const copied = copies();
  const copy = copied.find((c) => restricted.some((r) => r.id === c.source.copyOf));
  if (copy) {
    out.push(notice(`${esc(copy.source.name)} meetings are copied from their website`,
      `Copied ${esc(copy.date ?? "recently")}. Times and places can change; check their list before a first visit.`,
      copy.source.website ? ext(copy.source.website, "Open", "text-btn") : "", true));
  }
  const missing = restricted.filter((r) => !copied.some((c) => c.source.copyOf === r.id));
  if (missing.length) {
    const others = missing.length - 1;
    out.push(notice(`${esc(missing[0].name)} isn't included yet`,
      "They only share their list with apps they approve. Their website has it." +
        (others > 0 ? ` ${others} more list${others === 1 ? "" : "s"} nearby ${others === 1 ? "is" : "are"} the same way.` : ""),
      missing[0].website ? ext(missing[0].website, "Open", "text-btn") : "", true));
  }
  const problems = state.statuses.filter((s) => s.state === "ERROR" && !s.source.copyOf);
  if (state.error && !state.meetings.length) {
    out.push(notice("Couldn't load meetings", esc(state.error), `<button class="text-btn" data-action="refresh">Try again</button>`));
  } else if (problems.length && !state.loading) {
    out.push(notice(problems.length === 1 ? `Couldn't load ${esc(problems[0].source.name)}` : `Couldn't load ${problems.length} lists`,
      esc([...new Set(problems.map((p) => p.message).filter(Boolean))].slice(0, 1).join("") || "Try again in a little while."),
      `<a class="text-btn" href="#/about">Details</a>`));
  }
  return out;
}

// ---- Online ----

function onlineControls() {
  const t = today();
  const whens = [["soon", "Starting soon"], ...Array.from({ length: 6 }, (_, i) => [i, dayChipLabel(addDays(t, i), t)])];
  const now = Date.now();
  const date = state.onlineWhen === "soon" ? null : addDays(t, state.onlineWhen);
  const shown = onlineFor(date, state.englishOnly).length;
  const hidden = state.englishOnly ? onlineFor(date, false).length - shown : 0;
  return `
    <div class="chips" role="group" aria-label="When">
      ${whens.map(([v, label]) => `<button class="chip${state.onlineWhen === v ? " on" : ""}" data-action="online-when" data-value="${v}" aria-pressed="${state.onlineWhen === v}">${label}</button>`).join("")}
    </div>
    ${fellowshipChips(onlineFellowships(state))}
    <div class="lang-row">
      <button class="chip${state.englishOnly ? " on" : ""}" data-action="english" aria-pressed="${state.englishOnly}">${state.englishOnly ? icon("check", "icon tiny") : ""}English only</button>
      ${hidden > 0 ? `<span class="muted small">${hidden} in other languages hidden</span>` : ""}
    </div>
    <p class="muted small pad">Times are shown in your time zone (${esc(zoneShort(now, viewerZone()))}).</p>`;
}

function onlineList() {
  const t = today();
  const now = Date.now();
  const date = state.onlineWhen === "soon" ? null : addDays(t, state.onlineWhen);
  const rows = onlineFor(date, state.englishOnly);
  const out = [];
  if (!state.loaded || (!state.onlineLoaded && !rows.length)) {
    out.push(loadingCard("Checking online NA, Refuge Recovery, Recovery Dharma and CMA meetings."));
  } else if (!rows.length) {
    const hidden = state.englishOnly ? onlineFor(date, false).length : 0;
    out.push(`<section class="empty"><h2>No online meetings found</h2><p>${hidden > 0
      ? `${hidden} meetings in other languages are hidden. Turn off English only to see them.`
      : "Try another day, or clear the filters and search."}</p></section>`);
  } else if (date === null) {
    const upcoming = rows.filter((r) => r.start > now);
    const current = rows.filter((r) => inProgress(r, now));
    if (upcoming.length) out.push(sectionLabel(`Starting in the next 3 hours · ${upcoming.length}`), ...paged(upcoming, (r) => card(r, now)));
    if (current.length) out.push(sectionLabel(`Already started · ${current.length}`), ...current.map((r) => card(r, now)));
  } else {
    out.push(sectionLabel(`${dayTitle(date, t)} · ${rows.length} meetings`), ...paged(rows, (r) => card(r, now, date === t && ended(r, now))));
  }
  if (state.loaded && !state.onlineLoaded) out.push(`<p class="muted small center">Still gathering online NA meetings…</p>`);
  out.push(footer());
  return out.join("");
}

/** The first [state.limit] cards, and a button for the rest. */
function paged(rows, draw) {
  const out = rows.slice(0, state.limit).map(draw);
  if (rows.length > state.limit) {
    out.push(`<button class="btn tonal more" data-action="more">Show ${Math.min(PAGE, rows.length - state.limit)} more of ${rows.length - state.limit}</button>`);
  }
  return out;
}

// ---- Saved ----

function savedList() {
  const now = Date.now();
  const rows = savedRows(state, now);
  if (!rows.length) {
    return `<section class="empty"><h2>No saved meetings yet</h2>
      <p>Tap the heart on any meeting to keep it here. Saved meetings stay in this browser.</p>
      <a class="btn tonal" href="#/">Find meetings</a></section>`;
  }
  return sectionLabel("Next up first") + rows.map((r) => card(r, now)).join("") +
    `<p class="muted small center">Saved meetings are kept in this browser only.</p>`;
}

// ---- Pieces ----

const sectionLabel = (text) => `<h2 class="section">${esc(text)}</h2>`;

function notice(title, body, actions = "", highlight = false) {
  return `<section class="notice${highlight ? " warn" : ""}"><div><h3>${title}</h3><p>${body}</p></div>${actions ? `<div class="notice-actions">${actions}</div>` : ""}</section>`;
}

const loadingCard = (text) => `<section class="empty"><div class="spinner" aria-hidden="true"></div><h2>Gathering meetings…</h2><p>${esc(text)}</p></section>`;

function badge(f) {
  return `<span class="badge f-${f.toLowerCase()}">${esc(fl(f).label)}</span>`;
}

function card(r, now, dimmed = false) {
  const m = r.m;
  const [hm, ap] = clockParts(r.start, r.tz);
  const zone = differsFromViewer(r.start, r.tz) && m.attendance !== ONLINE ? `<span class="tz">${esc(zoneShort(r.start, r.tz))}</span>` : "";
  const status = statusText(r.start, r.end, now);
  const where = m.attendance === ONLINE ? null : [m.locationName ?? m.address, r.dist != null ? formatMiles(r.dist) : null].filter(Boolean).join(" · ");
  const saved = Boolean(state.favorites[m.key]);
  const online = m.attendance === ONLINE ? `<span class="att">${icon("videocam", "icon tiny")}Online</span>`
    : m.attendance === HYBRID ? `<span class="att">${icon("videocam", "icon tiny")}Also online</span>` : "";
  return `<article class="card${dimmed ? " dim" : ""}">
    <a class="card-main" href="#/m/${encodeURIComponent(m.key)}" data-action="open">
      <div class="when"><span class="hm">${esc(hm)}</span><span class="ap">${esc(ap)}</span>${zone}</div>
      <div class="what">
        <div class="badges">${badge(m.fellowship)}${online}</div>
        <h3>${esc(m.name)}</h3>
        ${where ? `<p class="where">${esc(where)}</p>` : ""}
        ${status ? `<p class="status">${esc(status)}</p>` : ""}
        ${m.types.length ? `<p class="types">${esc(m.types.slice(0, 4).join(" · "))}</p>` : ""}
      </div>
    </a>
    ${favButton(m, saved)}
  </article>`;
}

const favButton = (m, saved) =>
  `<button class="icon-btn fav${saved ? " on" : ""}" data-action="fav" data-key="${esc(m.key)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from saved" : "Save this meeting"}">${icon(saved ? "heart" : "heartOutline")}</button>`;

function footer() {
  return `<footer class="foot">
    <a href="#/about">Where these come from · SMART, LifeRing and more</a>
    <p>Not affiliated with any fellowship. Listings change; check before a first visit. In crisis, call or text <a href="tel:988">988</a>.</p>
  </footer>`;
}

// ---- Meeting detail ----

function detailView(key) {
  const m = state.byKey.get(key) ?? state.favorites[key];
  const back = `<header class="top detail-top">
      <button class="icon-btn" data-action="back" aria-label="Back">${icon("back")}</button>
      ${m ? `<div class="top-actions"><button class="icon-btn" data-action="share-meeting" data-key="${esc(key)}" aria-label="Share this meeting">${icon("share")}</button>${favButton(m, Boolean(state.favorites[m.key]))}</div>` : ""}
    </header>`;
  if (!m) {
    return back + `<main class="detail">${state.loaded && !state.loading
      ? `<section class="empty"><h2>This meeting isn't in the lists right now</h2><p>It may have moved or ended, or it belongs to another area.</p><a class="btn tonal" href="#/">Back to meetings</a></section>`
      : loadingCard("Loading this meeting…")}</main>`;
  }
  const now = Date.now();
  const tz = m.attendance === ONLINE ? viewerZone() : zoneOf(m);
  const r = row(m, nextOccurrence(m, now), tz, distanceTo(state.area, m));
  const zone = differsFromViewer(r.start, tz) || m.attendance === ONLINE ? " " + zoneShort(r.start, tz) : "";
  const source = sourceById(m.sourceId);
  const sections = [];

  sections.push(section("clock", "When", `
    <p class="big">${esc(weekly(m))}, ${esc(timeRange(r.start, r.end, tz))}${esc(zone)}</p>
    <p class="accent">${esc(statusText(r.start, r.end, now) ?? `Next: ${relativeDay(r.start, now, tz)} at ${clock(r.start, tz)}`)}</p>
    ${differsFromViewer(r.start, tz) && m.attendance !== ONLINE
      ? `<p class="muted">That's ${esc(clock(r.start, viewerZone()))} ${esc(zoneShort(r.start, viewerZone()))} where you are.</p>` : ""}`));

  if (m.attendance !== ONLINE) {
    const directions = directionsUrl(m);
    sections.push(section("place", "Where", `
      ${m.locationName ? `<p class="big strong">${esc(m.locationName)}</p>` : ""}
      ${m.address ? `<p class="big">${esc(m.address)}</p>` : ""}
      ${m.locationNotes ? `<p class="muted pre">${esc(m.locationNotes)}</p>` : ""}
      ${r.dist != null && state.area ? `<p class="muted">${esc(formatMiles(r.dist))} from ${esc(state.area.label)}</p>` : ""}
      ${directions ? `<p>${ext(directions, `${icon("directions")} Directions`, "btn")}</p>` : ""}`));
  }

  if (isJoinable(m)) {
    sections.push(section("videocam", m.attendance === HYBRID ? "Join online (also meets in person)" : "Join online", `
      ${m.joinUrl ? `<p>${ext(m.joinUrl, esc(joinLabel(m.joinUrl)), "btn")}</p>` : ""}
      ${m.joinNotes ? `<p class="pre">${esc(m.joinNotes)}</p>` : ""}
      ${m.joinPhone ? `<p><a class="btn tonal" href="${esc(telUrl(m.joinPhone))}">${icon("phone")} Dial in</a></p>` : ""}
      <p class="muted small">Others in the meeting may see your display name. You can change it before you join.</p>`));
  }

  if (m.types.length) {
    const explained = m.types.map(describe).filter(Boolean);
    sections.push(section("info", "About this meeting", `
      <div class="tags">${m.types.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      ${explained.map((d) => `<p class="muted">${esc(d)}</p>`).join("")}`));
  }
  if (m.notes) sections.push(section("notes", "Notes", `<p class="pre">${esc(m.notes)}</p>`));
  if (m.phone) sections.push(section("phone", "Contact", `<p><a class="btn tonal" href="${esc(telUrl(m.phone))}">Call ${esc(formatPhone(m.phone))}</a></p>`));

  const copiedOn = source?.copyOf ? copiedDate(m.updated) : null;
  sections.push(section("info", "Listing", `
    <p>${source?.copyOf
      ? `Copied from ${esc(source.name)}'s public website${copiedOn ? ` on ${esc(copiedOn)}` : ""}. It may have changed since.`
      : `From ${esc(source?.name ?? fl(m.fellowship).full)}`}</p>
    ${m.listingUrl ? `<p>${ext(m.listingUrl, `Open the live listing ${icon("openInNew", "icon tiny")}`, "link")}</p>` : ""}
    <p class="muted small">Schedules change, especially around holidays. Check the live listing or call before a first visit.</p>`));

  return back + `<main class="detail">
    <div class="badges">${`<span class="badge f-${m.fellowship.toLowerCase()} wide">${esc(fl(m.fellowship).full)}</span>`}<span class="att">${esc(ATTENDANCE_LABEL[m.attendance])}</span></div>
    <h1 class="detail-name">${esc(m.name)}</h1>
    ${sections.join("")}
  </main>`;
}

function joinLabel(url) {
  if (url.includes("zoom.us")) return "Join on Zoom";
  if (url.includes("meet.google")) return "Join on Google Meet";
  if (url.includes("teams.microsoft") || url.includes("teams.live")) return "Join on Teams";
  return "Join online";
}

function section(iconName, title, body) {
  return `<section class="d-section">${icon(iconName, "icon brand")}<div><h2>${esc(title)}</h2>${body}</div></section>`;
}

// ---- Lists and help ----

function aboutView() {
  const a = state.area;
  const relevant = state.statuses.filter((s) => !s.source.copyOf || s.count > 0);
  const order = { OK: 0, STALE: 1, RESTRICTED: 2, ERROR: 3 };
  const rows = [...relevant].sort((x, y) => (order[x.state] ?? 4) - (order[y.state] ?? 4) || x.source.name.localeCompare(y.source.name))
    .map((s) => {
      const text = s.state === "OK" ? `${s.count} meetings` + (s.source.copyOf ? " · copied from their public page" : "")
        : s.state === "STALE" ? `${s.count} meetings · kept from an earlier day`
          : s.state === "RESTRICTED" ? "Only shared with apps they approve. See their website."
            : `Couldn't load${s.message ? `: ${s.message}` : ""}`;
      return `<li><div><strong>${esc(s.source.name)}</strong><small>${esc(s.source.area ?? "")}</small><small class="${s.state === "OK" ? "" : "warn-text"}">${esc(text)}</small></div>
        ${s.source.website ? ext(s.source.website, icon("openInNew"), "icon-btn") : ""}</li>`;
    }).join("");
  const links = state.sources.filter((s) => s.kind === "LINK").map((s) =>
    `<li><div><strong>${esc(s.name)}</strong><small>${esc(s.area ?? "")}${s.note ? ` · ${esc(s.note)}` : ""}</small></div>${ext(s.website, icon("openInNew"), "icon-btn")}</li>`).join("");
  const built = state.generatedAt ? new Date(state.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  return `<header class="top detail-top">
      <button class="icon-btn" data-action="back" aria-label="Back">${icon("back")}</button>
      <h1>Lists and help</h1>
    </header>
    <main class="about">
      <section class="card-block crisis">
        <h2>Help right now</h2>
        <p>988 Suicide &amp; Crisis Lifeline, any time:</p>
        <p class="row-btns"><a class="btn" href="tel:988">Call 988</a><a class="btn tonal" href="sms:988">Text 988</a></p>
        <p>SAMHSA National Helpline, treatment referrals and information in English and Spanish:</p>
        <p><a class="btn tonal" href="tel:18006624357">Call 1-800-662-4357</a></p>
      </section>
      <section class="card-block">
        <h2>Lists ${a ? `for ${esc(a.label)}` : "everywhere"}</h2>
        <p class="muted small">${built ? `Copied from each group's public list on ${esc(built)}. ` : ""}Every meeting links back to its live listing.</p>
        <ul class="source-list">${rows || `<li><div><small>${state.loading ? "Loading…" : "Nothing loaded yet."}</small></div></li>`}</ul>
        <p><button class="btn tonal" data-action="refresh">${icon("refresh")} Check for changes</button></p>
      </section>
      <section class="card-block">
        <h2>More places to look</h2>
        <ul class="source-list">${links}</ul>
      </section>
      <section class="card-block">
        <h2>Privacy</h2>
        <p>No account, no ads, no tracking. Your place, distance and saved meetings stay in this browser. To find NA meetings, NA's meeting database is sent a point rounded to about 7 miles. Town names you type are looked up in a list that comes with the meeting data; only a place it doesn't know is looked up on OpenStreetMap.</p>
        <p>${ext(PRIVACY_URL, "Read the full privacy policy", "link")}</p>
      </section>
      <section class="card-block">
        <h2>About</h2>
        <p>Many Paths is an independent, free project. It isn't affiliated with or endorsed by Alcoholics Anonymous, Narcotics Anonymous, Refuge Recovery, Recovery Dharma, Crystal Meth Anonymous, White Bison or any other organization. Meeting details come from their public lists and can change without notice.</p>
        ${ANDROID_URL ? `<p>${ext(ANDROID_URL, "Get the Android app on Google Play", "link")}</p>` : `<p class="muted">An Android app is coming to Google Play.</p>`}
        <p>Questions, or a listing that's wrong? <a class="link" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
        <p>${ext(SOURCE_URL, "Free and open source (GPL-3.0)", "link")} · ${ext(DATA.replace(/v1\/$/, ""), "Today's data report", "link")}</p>
      </section>
    </main>`;
}

// ---- Dialogs ----

function openDialog(html, label) {
  const dialog = document.createElement("dialog");
  dialog.className = "sheet";
  dialog.setAttribute("aria-label", label);
  dialog.innerHTML = html;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close(); // a tap on the backdrop
  });
  dialog.showModal();
  return dialog;
}

function areaDialog() {
  const dialog = openDialog(`
    <form method="dialog" class="sheet-body">
      <div class="sheet-head"><h2>Where should we look?</h2><button class="icon-btn" value="close" aria-label="Close">${icon("close")}</button></div>
      <button type="button" class="btn wide" data-action="locate">${icon("myLocation")} Use my current location</button>
      <p class="error" id="place-error" role="alert" hidden></p>
      <label class="field">
        <span class="sr-only">City, town or ZIP code</span>
        ${icon("search")}
        <input id="place-q" type="search" placeholder="City, town or ZIP code" autocomplete="off" enterkeyhint="search">
      </label>
      <ul class="suggestions" id="place-results" role="listbox" aria-label="Places"></ul>
      <h3>How far</h3>
      <div class="chips wrap" role="group" aria-label="Distance">
        ${RADII.map((r) => `<button type="button" class="chip${state.radius === r ? " on" : ""}" data-action="radius" data-value="${r}" aria-pressed="${state.radius === r}">${r} mi</button>`).join("")}
      </div>
      <div class="sheet-actions"><button class="btn" value="done">Done</button></div>
    </form>`, "Choose a place");
  const input = dialog.querySelector("#place-q");
  const results = dialog.querySelector("#place-results");
  let timer = 0;
  let found = [];
  const show = (places, emptyText) => {
    found = places;
    results.innerHTML = places.map((p, i) => `<li><button type="button" class="suggestion" data-action="choose-place" data-index="${i}">${icon("place")} ${esc(p.label)}</button></li>`).join("") ||
      (emptyText ? `<li class="muted small">${emptyText}</li>` : "");
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) return show([]);
    timer = setTimeout(async () => {
      try {
        const index = await loadPlaces();
        const hits = searchPlaces(index, q);
        show(hits, q.length >= 3 ? `No town with meetings matches. <button type="button" class="text-btn" data-action="osm-search">Look it up on the map</button>` : "");
      } catch {
        show([], "Couldn't load the town list. Check your connection.");
      }
    }, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (found[0]) choose(found[0]);
    }
  });
  dialog.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (el.dataset.action === "choose-place") choose(found[+el.dataset.index]);
    if (el.dataset.action === "osm-search") {
      results.innerHTML = `<li class="muted small">Looking it up on OpenStreetMap…</li>`;
      try {
        const hits = await searchOpenStreetMap(input.value.trim());
        show(hits, "OpenStreetMap doesn't know that place either. Try a nearby town or a ZIP code.");
      } catch {
        show([], "Couldn't reach OpenStreetMap. Try a nearby town or a ZIP code.");
      }
    }
  });
  function choose(place) {
    if (!place) return;
    dialog.close();
    setArea({ lat: place.lat, lng: place.lng, label: place.label });
  }
  setTimeout(() => !isApple && input.focus(), 50);
}

function locate(button) {
  const error = document.getElementById("place-error");
  const say = (text) => {
    if (error) {
      error.textContent = text;
      error.hidden = false;
    } else {
      toast(text);
    }
  };
  if (!navigator.geolocation) return say("This browser can't share a location. Type a city instead.");
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    let name = null;
    try {
      name = nearestPlace(await loadPlaces(), lat, lng);
    } catch {
      // the label is a nicety
    }
    button.closest("dialog")?.close();
    setArea({ lat, lng, label: name ?? "Your location" });
  }, (err) => {
    button.disabled = false;
    button.innerHTML = label;
    say(err.code === err.PERMISSION_DENIED
      ? "Location is turned off for this site. Type a city instead, or allow location in your browser's settings."
      : "Couldn't get your location. Type a city instead.");
  }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 10 * 60000 });
}

function linesDialog() {
  const lines = linesNear(state.helplines, state.area);
  openDialog(`
    <form method="dialog" class="sheet-body">
      <div class="sheet-head"><h2>Phone lines near ${esc(state.area.label)}</h2><button class="icon-btn" value="close" aria-label="Close">${icon("close")}</button></div>
      <p class="muted">Volunteers can tell you which meetings are on, where the door is, or just talk.</p>
      ${lines.map(({ line, d }) => `<div class="line">
        <div class="line-head">${badge(line.fellowship)}<strong>${esc(line.name)}</strong></div>
        <p class="muted small">${esc([line.area, d < 0.1 ? "nearby" : formatMiles(d) + " away"].filter(Boolean).join(" · "))}</p>
        ${line.phones.slice(0, 2).map((p) => `<a class="call" href="${esc(telUrl(p.number))}">${icon("phone", "icon tiny")} Call ${esc(p.number)} · ${esc(p.label)}</a>`).join("")}
      </div>`).join("")}
      <hr>
      <p>In crisis? Call or text 988, any time.</p>
      <p class="row-btns"><a class="btn" href="tel:988">Call 988</a><a class="btn tonal" href="sms:988">Text 988</a></p>
    </form>`, "Local phone lines");
}

function shareMenu() {
  const view = route().view;
  const t = today();
  const options = [];
  if (view === "near" && state.area) {
    options.push(["share-day", `Share ${dayChipLabel(addDays(t, state.dayOffset), t).toLowerCase()}'s meetings`]);
    options.push(["share-week", "Share the next 7 days"]);
  } else if (view === "online") {
    options.push(["share-online", "Share this list"]);
  } else if (view === "saved") {
    options.push(["share-saved", "Share my saved meetings"]);
  }
  if (!options.length) return toast("Choose a place first.");
  if (options.length === 1) return doShareAction(options[0][0]);
  const dialog = openDialog(`<form method="dialog" class="sheet-body">
      <div class="sheet-head"><h2>Share as a text</h2><button class="icon-btn" value="close" aria-label="Close">${icon("close")}</button></div>
      ${options.map(([a, label]) => `<button type="button" class="menu-item" data-share="${a}">${icon("share")} ${esc(label)}</button>`).join("")}
    </form>`, "Share");
  dialog.addEventListener("click", (e) => {
    const el = e.target.closest("[data-share]");
    if (!el) return;
    dialog.close();
    doShareAction(el.dataset.share);
  });
}

function shareExtras() {
  const restricted = restrictedNearby();
  const copied = copies();
  return {
    lines: state.area ? linesNear(state.helplines, state.area) : [],
    copied,
    missing: restricted.filter((r) => !copied.some((c) => c.source.copyOf === r.id)),
  };
}

function doShareAction(action) {
  const t = today();
  const now = Date.now();
  if (action === "share-day") {
    const date = addDays(t, state.dayOffset);
    share("Recovery meetings", listShareText(`Recovery meetings near ${state.area.label}: ${dayTitle(date, t)}`, nearbyRows(state, date), { extras: shareExtras() }));
  } else if (action === "share-week") {
    const days = Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((d) => [d, nearbyRows(state, d)]);
    share("Recovery meetings this week", weekShareText(state.area.label, state.radius, days, t, shareExtras()));
  } else if (action === "share-online") {
    const date = state.onlineWhen === "soon" ? null : addDays(t, state.onlineWhen);
    const title = date === null ? "Online recovery meetings starting soon" : `Online recovery meetings: ${dayTitle(date, t)}`;
    share("Online recovery meetings", listShareText(title, onlineRows(state, date, now)));
  } else if (action === "share-saved") {
    share("My meetings", listShareText("My recovery meetings", savedRows(state, now), { withDay: true }));
  }
}

async function share(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      if (e.name === "AbortError") return; // they changed their mind
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it into a text or an email.");
  } catch {
    toast("Couldn't share from this browser.");
  }
}

let toastTimer = 0;
function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

// ---- Taps ----

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.closest("dialog") && !["locate", "radius"].includes(el.dataset.action)) return;
  const action = el.dataset.action;
  const value = el.dataset.value;
  switch (action) {
    case "open":
      openedDetailFromApp = true;
      return; // the link changes the hash
    case "back":
      if (openedDetailFromApp && history.length > 1) history.back();
      else location.hash = "#/";
      openedDetailFromApp = false;
      return;
    case "pick-area": return areaDialog();
    case "locate": return locate(el);
    case "lines": return linesDialog();
    case "share-menu": return shareMenu();
    case "share-meeting": {
      const m = state.byKey.get(el.dataset.key) ?? state.favorites[el.dataset.key];
      if (!m) return;
      const tz = m.attendance === ONLINE ? viewerZone() : zoneOf(m);
      return share(m.name, meetingShareText(row(m, nextOccurrence(m, Date.now()), tz, null)));
    }
    case "radius":
      setState({ radius: +value });
      el.parentElement.querySelectorAll(".chip").forEach((c) => {
        c.classList.toggle("on", c === el);
        c.setAttribute("aria-pressed", String(c === el));
      });
      return render();
    case "day":
      setState({ dayOffset: +value, showEarlier: false });
      render();
      return window.scrollTo(0, 0);
    case "more":
      setState({ limit: state.limit + PAGE });
      return updateList();
    case "online-when":
      setState({ onlineWhen: value === "soon" ? "soon" : +value, limit: PAGE });
      render();
      return window.scrollTo(0, 0);
    case "fellowship": {
      let list = value ? (state.fellowships.includes(value) ? state.fellowships.filter((f) => f !== value) : [...state.fellowships, value]) : [];
      if (list.length === Object.keys(FELLOWSHIPS).length) list = [];
      setState({ fellowships: list, limit: PAGE });
      return render();
    }
    case "english":
      setState({ englishOnly: !state.englishOnly, limit: PAGE });
      return render();
    case "toggle-earlier":
      setState({ showEarlier: !state.showEarlier });
      return updateList();
    case "toggle-search":
      setState({ searchOpen: !state.searchOpen, query: state.searchOpen ? "" : state.query });
      render();
      if (state.searchOpen) document.getElementById("q")?.focus();
      return;
    case "fav": {
      const key = el.dataset.key;
      const m = state.byKey.get(key) ?? state.favorites[key];
      if (!m) return;
      const favorites = { ...state.favorites };
      if (favorites[key]) delete favorites[key];
      else favorites[key] = m;
      setState({ favorites });
      toast(favorites[key] ? "Saved. Find it in the Saved tab." : "Removed from saved");
      if (route().view === "saved") return updateList();
      document.querySelectorAll(`[data-action="fav"][data-key="${CSS.escape(key)}"]`).forEach((b) => { b.outerHTML = favButton(m, Boolean(favorites[key])); });
      return;
    }
    case "refresh": return refresh({ force: true });
    case "dismiss-install":
      store.set("installHintDismissed", true);
      return updateList();
    case "dismiss-android":
      store.set("androidHintDismissed", true);
      return updateList();
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "q") {
    setState({ query: e.target.value, limit: PAGE });
    updateList();
  }
});

// Keep "In 14 min" honest, and pick up the next day's lists after a night away.
setInterval(() => {
  if (!document.hidden && !document.querySelector("dialog[open]")) updateList();
}, 60000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden || state.loading) return;
  const age = Date.now() - state.loadedAt;
  const failed = state.statuses.some((s) => s.state === "ERROR");
  if (age > 3600000 || (failed && age > 30000) || state.error) refresh();
  else updateList();
});

// ---- Start ----

render();
refresh();
loadHelplines().then((lines) => {
  setState({ helplines: lines });
  if (route().view === "near") render();
});
loadCatalog().catch(() => {});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
