// Many Paths on the web: the screens. Logic lives in the other modules; this file reads
// state, writes HTML (every piece of feed text goes through esc()), and handles taps.

import { DATA, loadCatalog, loadHelplines, loadMeetings, loadPlaces, searchOpenStreetMap } from "./data.js";
import { ATTENDANCE_LABEL, FELLOWSHIPS, HYBRID, IN_PERSON, ONLINE, isJoinable, placeLine } from "./model.js";
import { describe } from "./labels.js";
import {
  covers, distanceTo, ended, formatMiles, groupMeetings, inProgress, miles, nearbyFellowships, nearbyRows,
  onlineFellowships, onlineRows, row, savedRows,
} from "./rows.js";
import { icsFileName, meetingIcs } from "./calendar.js";
import { drawMap, forgetMap, resizeMap } from "./map.js";
import { linesNear, nearestPlace, searchPlaces } from "./places.js";
import { directionsUrl, listShareText, meetingShareText, weekShareText } from "./share.js";
import {
  addDays, clock, clockParts, copiedDate, dateIn, dayChipLabel, dayList, dayTitle, differsFromViewer, holidayOn,
  nextOccurrence, relativeDay, shortDate, statusText, timeRange, upcomingSkips, viewerZone, weekly, zoneOf, zoneShort,
} from "./time.js";
import { formatPhone } from "./text.js";
import { icon } from "./icons.js";

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.manypaths.meetings";
const APP_STORE_URL = "https://apps.apple.com/us/app/many-paths-recovery-meetings/id6836968521";
const SITE = "manypathsmeetings.com";
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A heads-up on holidays: most lists don't say when a church or club closes for one. */
function holidayNotice(date, t) {
  const holiday = holidayOn(date);
  return holiday ? notice(`${esc(dayTitle(date, t))}: ${esc(cap(holiday))}`,
    "Some meetings and buildings close or change times on holidays, and most lists don't say so. Check before you go.", "", true) : "";
}
const PRIVACY_URL = "https://benyahmanlunndev.github.io/many-paths-data/privacy.html";
const SOURCE_URL = "https://github.com/BenyahmanLunnDev/many-paths";
const CONTACT_EMAIL = "hello@manypathsmeetings.com";
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
  types: [], // meeting-type filter from the desktop sidebar; this visit only
  deskView: "list", // "list" or "week" on wide screens
  typesOpen: false, // the wide layout's meeting-type menu
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
const isAndroid = /Android/.test(navigator.userAgent);
/** Both store buttons, the one for this phone first. */
function storeButtons() {
  const apple = ext(APP_STORE_URL, `${icon("download")} App Store (iPhone)`, isAndroid ? "btn tonal" : "btn");
  const play = ext(PLAY_URL, `${icon("download")} Google Play (Android)`, isAndroid ? "btn" : "btn tonal");
  return `<p class="row-btns">${isAndroid ? play + apple : apple + play}</p>`;
}
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
  if (h === "test" || h === "get") return { view: "get" };
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
  document.body.dataset.layout = isDesk() ? "desk" : "phone";
  if (isDesk() && r.view !== "about" && r.view !== "get") return renderDesk(r);
  document.body.dataset.view = r.view;
  if (r.view === "detail") app.innerHTML = detailView(r.key);
  else if (r.view === "about") app.innerHTML = aboutView();
  else if (r.view === "get") app.innerHTML = getView();
  else app.innerHTML = mainView(r.view);
  document.title = { near: "Many Paths: recovery meetings near you and online", online: "Online meetings · Many Paths", saved: "Saved meetings · Many Paths",
    about: "Lists and help · Many Paths", detail: "Meeting · Many Paths", get: "Get Many Paths" }[r.view];
}

/** Re-renders just the list, so typing in the search box keeps its focus. */
function updateList() {
  memoStore = new Map();
  if (isDesk() && document.querySelector(".desk")) return updateDesk();
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
  if (isApple && !standalone() && !store.get("iosAppHintDismissed", false)) {
    out.push(notice("There's an iPhone app", "Many Paths for iPhone adds home-screen widgets and one-tap directions. It's free, with no ads.",
      `${ext(APP_STORE_URL, "Get it on the App Store", "text-btn")}<button class="text-btn" data-action="dismiss-ios">No thanks</button>`));
  } else if (isAndroid && !standalone() && !store.get("androidHintDismissed", false)) {
    out.push(notice("There's an Android app", "Many Paths for Android adds home-screen widgets and one-tap directions. It's free, with no ads.",
      `${ext(PLAY_URL, "Get it on Google Play", "text-btn")}<button class="text-btn" data-action="dismiss-android">No thanks</button>`));
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
      <p class="small">Also free for phones: ${ext(APP_STORE_URL, "iPhone app", "link")} · ${ext(PLAY_URL, "Android app", "link")}</p>
    </section>`);
    return out.join("");
  }
  out.push(...areaNotices());
  const t = today();
  const now = Date.now();
  if (state.query.trim()) {
    out.push(...weekMatches((date) => nearbyRows(state, date), `within ${state.radius} miles`), footer());
    return out.join("");
  }
  const date = addDays(t, state.dayOffset);
  const rows = nearbyRows(state, date);
  out.push(holidayNotice(date, t));
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
    out.push(notice(`${esc(copy.source.name)} meetings are copied from their website once a week`,
      `Last copied ${esc(copy.date ?? "recently")}. Times and places can change; check their list before a first visit.`,
      copy.source.website ? ext(copy.source.website, "Open", "text-btn") : "", true));
  }
  // Places whose list isn't in a form apps can read (Chicago, New Orleans...): point to it.
  const elsewhere = state.sources.filter((s) => s.kind === "LINK" && s.centerLat != null && covers(s, state.area.lat, state.area.lng));
  for (const s of elsewhere.slice(0, 2)) {
    out.push(notice(`${esc(s.name)} isn't in Many Paths yet`,
      "Their meeting list is on their own website. Meetings shown here come from the other lists that cover this area.",
      s.website ? ext(s.website, "Open their list", "text-btn") : "", true));
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

/**
 * While someone searches, every day of the coming week that matches, so "Try God" shows each
 * day the group meets instead of only the day picked above.
 */
function weekMatches(rowsOn, where) {
  const t = today();
  const now = Date.now();
  const q = state.query.trim();
  if (!state.loaded) return [loadingCard("Checking the lists…")];
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((date) => [date, rowsOn(date)]);
  const total = days.reduce((n, [, rows]) => n + rows.length, 0);
  if (!total) {
    return [`<section class="empty"><h2>Nothing this week matches “${esc(q)}”</h2>
      <p>Searched every day this week ${esc(where)}${state.fellowships.length ? " with these filters" : ""}. Try fewer words or a wider distance.</p></section>`];
  }
  const out = [`<p class="muted small">Every day this week matching “${esc(q)}” · ${total} ${total === 1 ? "meeting" : "meetings"}</p>`];
  for (const [date, rows] of days) {
    if (!rows.length) continue;
    out.push(sectionLabel(`${dayTitle(date, t)} · ${rows.length}`), holidayNotice(date, t),
      ...rows.map((r) => card(r, now, r.closed || (date === t && ended(r, now)))));
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
  const out = [];
  if (state.query.trim() && state.loaded) {
    out.push(...weekMatches((d) => onlineFor(d, state.englishOnly), "online"), footer());
    return out.join("");
  }
  const rows = onlineFor(date, state.englishOnly);
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
  const status = r.closed ? (dateIn(r.start, r.tz) === dateIn(now, r.tz) ? "Not meeting today" : "Not meeting this day")
    : statusText(r.start, r.end, now);
  const where = m.attendance === ONLINE ? null : [m.locationName ?? m.address, r.dist != null ? formatMiles(r.dist) : null].filter(Boolean).join(" · ");
  const saved = Boolean(state.favorites[m.key]);
  const online = m.attendance === ONLINE ? `<span class="att">${icon("videocam", "icon tiny")}Online</span>`
    : m.attendance === HYBRID ? `<span class="att">${icon("videocam", "icon tiny")}Also online</span>` : "";
  const actions = isDesk() ? cardActions(m) : "";
  return `<article class="card${dimmed ? " dim" : ""}" data-key="${esc(m.key)}">
    <a class="card-main" href="#/m/${encodeURIComponent(m.key)}" data-action="open">
      <div class="when"><span class="hm">${esc(hm)}</span><span class="ap">${esc(ap)}</span>${zone}</div>
      <div class="what">
        <div class="badges">${badge(m.fellowship)}${online}</div>
        <h3>${esc(m.name)}</h3>
        ${where ? `<p class="where">${esc(where)}</p>` : ""}
        ${isDesk() && m.attendance !== ONLINE && m.locationName && m.address ? `<p class="addr">${esc(m.address)}</p>` : ""}
        ${status ? `<p class="status${r.closed ? " closed" : ""}">${esc(status)}</p>` : ""}
        ${m.types.length ? `<p class="types">${esc(m.types.slice(0, isDesk() ? 8 : 4).join(" · "))}</p>` : ""}
      </div>
    </a>
    ${actions}
    ${favButton(m, saved)}
  </article>`;
}

const favButton = (m, saved) =>
  `<button class="icon-btn fav${saved ? " on" : ""}" data-action="fav" data-key="${esc(m.key)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from saved" : "Save this meeting"}">${icon(saved ? "heart" : "heartOutline")}</button>`;

/**
 * Celebrate Recovery's own group finder, opened with the place typed in. Its search runs a bot
 * check, so CR groups can't be copied into the list; the person taps Search there.
 */
function crUrl(area) {
  return "https://crlocator.com/?s=" + encodeURIComponent(area.label).replace(/%20/g, "+") +
    `&latitude=${Math.round(area.lat * 10) / 10}&longitude=${Math.round(area.lng * 10) / 10}&filter=groups&radius=25`;
}

function footer() {
  return `<footer class="foot">
    ${route().view === "near" && state.area ? ext(crUrl(state.area), `Celebrate Recovery groups near ${esc(state.area.label)}`) : ""}
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

  const skips = upcomingSkips(m, dateIn(now, zoneOf(m)));
  const nextHoliday = holidayOn(dateIn(r.start, tz));
  sections.push(section("clock", "When", `
    <p class="big">${esc(weekly(m))}, ${esc(timeRange(r.start, r.end, tz))}${esc(zone)}</p>
    <p class="accent">${esc(statusText(r.start, r.end, now) ?? `Next: ${relativeDay(r.start, now, tz)} at ${clock(r.start, tz)}`)}</p>
    ${differsFromViewer(r.start, tz) && m.attendance !== ONLINE
      ? `<p class="muted">That's ${esc(clock(r.start, viewerZone()))} ${esc(zoneShort(r.start, viewerZone()))} where you are.</p>` : ""}
    ${skips.length ? `<p class="warn-text strong">Not meeting ${esc(skips.slice(0, 4).map(shortDate).join(", "))}${skips.length > 4 ? " and more" : ""}, according to the group.</p>` : ""}
    ${nextHoliday ? `<p class="muted">The next one falls on ${esc(nextHoliday)}. Some groups don't meet on holidays; check before you go.</p>` : ""}
    ${groupLine(m, now)}
    <p class="row-btns"><button class="btn tonal" data-action="add-calendar" data-key="${esc(m.key)}">${icon("event")} Add to calendar</button></p>`));

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
    <p class="muted small">Schedules change, especially around holidays. Check the live listing or call before a first visit.</p>
    <p>${ext(problemMail(m, r), `${icon("flag", "icon tiny")} Report a problem with this listing`, "link")}</p>`));

  return back + `<main class="detail">${detailHead(m)}${sections.join("")}</main>`;
}

const detailHead = (m) => `
    <div class="badges">${`<span class="badge f-${m.fellowship.toLowerCase()} wide">${esc(fl(m.fellowship).full)}</span>`}<span class="att">${esc(ATTENDANCE_LABEL[m.attendance])}</span></div>
    <h1 class="detail-name">${esc(m.name)}</h1>`;

/** "This group meets Mondays and Wednesdays at 7:00 PM", with a link to each other time. */
function groupLine(m, now) {
  const group = groupMeetings(state.meetings, m);
  if (group.length < 2) return "";
  const when = (g) => clock(nextOccurrence(g, now), g.attendance === ONLINE ? viewerZone() : zoneOf(g));
  const times = new Set(group.map(when));
  const summary = times.size === 1
    ? `This group meets ${dayList(group.map((g) => g.day))} at ${[...times][0]}.`
    : "This group meets:";
  const items = times.size === 1 ? "" : `<ul>${group.map((g) => g.key === m.key
    ? `<li><strong>${esc(weekly(g))} ${esc(when(g))}</strong> (this one)</li>`
    : `<li><a class="link" href="#/m/${encodeURIComponent(g.key)}">${esc(weekly(g))} ${esc(when(g))}</a></li>`).join("")}</ul>`;
  return `<div class="group-times"><p class="strong">${esc(summary)}</p>${items}</div>`;
}

/** An email to hello@ with the meeting filled in, for a closed door, a move or a new time. */
function problemMail(m, r) {
  const tz = m.attendance === ONLINE ? viewerZone() : zoneOf(m);
  const where = m.attendance === ONLINE ? "Online" : [m.locationName, m.address].filter(Boolean).join(", ");
  const body = [
    `Meeting: ${m.name} (${fl(m.fellowship).full})`,
    `When: ${weekly(m)}, ${timeRange(r.start, r.end, tz)}`,
    `Where: ${where}`,
    `Listed by: ${sourceById(m.sourceId)?.name ?? "unknown"}`,
    `Listing ID: ${m.key}`,
    "",
    "What's wrong? (For example: not meeting on a date, moved, new time, ended)",
    "",
  ].join("\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Listing problem: ${m.name}`)}&body=${encodeURIComponent(body)}`;
}

function downloadCalendar(m) {
  const blob = new Blob([meetingIcs(m, { label: fl(m.fellowship).label })], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = icsFileName(m.name);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast("Calendar file ready. Open it to add this meeting every week, with a reminder 30 minutes before.");
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
  // Area links only show for a place they cover; the rest are for anywhere.
  const links = state.sources.filter((s) => s.kind === "LINK" && (s.centerLat == null || (a && covers(s, a.lat, a.lng)))).map((s) => {
    const url = s.id === "link-celebrate" && a ? crUrl(a) : s.website;
    return `<li><div><strong>${esc(s.name)}</strong><small>${esc(s.area ?? "")}${s.note ? ` · ${esc(s.note)}` : ""}</small></div>${ext(url, icon("openInNew"), "icon-btn")}</li>`;
  }).join("");
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
        <p>No account, no ads, no tracking. Your place, distance and saved meetings stay in this browser. To find NA meetings, NA's meeting database is sent a point rounded to about 7 miles. Town names you type are looked up in a list that comes with the meeting data; only a place it doesn't know is looked up on OpenStreetMap. On a computer, the map comes from OpenFreeMap (made from OpenStreetMap), which sees the map area your browser asks for, as any website would.</p>
        <p>${ext(PRIVACY_URL, "Read the full privacy policy", "link")}</p>
      </section>
      <section class="card-block">
        <h2>About</h2>
        <p>Many Paths is an independent, free project. It isn't affiliated with or endorsed by Alcoholics Anonymous, Narcotics Anonymous, Refuge Recovery, Recovery Dharma, Crystal Meth Anonymous, White Bison or any other organization. Meeting details come from their public lists and can change without notice.</p>
        <p>Made by Benyahman Lunn, an independent developer who works in the recovery field.</p>
        <h3>Get the app</h3>
        <p>The same meetings, plus home-screen widgets. Free, with no ads and no account.</p>
        ${storeButtons()}
        <p>Questions, or a listing that's wrong? <a class="link" href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
        <p>${ext(SOURCE_URL, "Free and open source (GPL-3.0)", "link")} · ${ext(DATA.replace(/v1\/$/, ""), "Today's data report", "link")}</p>
      </section>
    </main>`;
}

// ---- Get the app: where the flyer's QR code and shared links land (#/get; old #/test links too) ----

function getView() {
  return `<header class="top detail-top">
      <a class="icon-btn" href="#/" aria-label="Back">${icon("back")}</a>
      <h1>Get Many Paths</h1>
    </header>
    <main class="about">
      <section class="card-block">
        <h2>Recovery meetings, all in one place</h2>
        <p>AA, NA, Refuge Recovery, Recovery Dharma, CMA, Wellbriety and more: meetings near you and online, in one list.</p>
        <ul class="plain-list">
          <li>Meetings near you today or any day this week, with one-tap directions</li>
          <li>Online meetings starting soon, in your time zone, with one-tap join</li>
          <li>Save the meetings you go to; home-screen widgets show what's next</li>
          <li>Free. No ads, no account, no tracking.</li>
        </ul>
        ${storeButtons()}
        <p><a class="btn tonal" href="#/">Or use it here in your browser</a></p>
      </section>
      <section class="card-block">
        <h2>Pass it on</h2>
        <p>Send this page to anyone who might need it: <strong>${SITE}</strong></p>
        <p class="muted small">Made by Benyahman Lunn, an independent developer who works in the recovery field. Many Paths isn't affiliated with any fellowship.</p>
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
  // Done goes to the town that was typed, like Enter does. With nothing typed it just closes;
  // when no town matches, the sheet stays open with the "look it up on the map" choice.
  dialog.querySelector('button[value="done"]').addEventListener("click", async (e) => {
    const q = input.value.trim();
    if (!q) return;
    e.preventDefault();
    clearTimeout(timer);
    try {
      const hits = searchPlaces(await loadPlaces(), q);
      if (hits[0]) return choose(hits[0]);
    } catch {
      // falls through to the message below
    }
    input.dispatchEvent(new Event("input"));
  });
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
    share("Recovery meetings", listShareText(`Recovery meetings near ${state.area.label}: ${dayTitle(date, t)}`, nearbyRows(state, date).filter((r) => !r.closed), { extras: shareExtras() }));
  } else if (action === "share-week") {
    const days = Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((d) => [d, nearbyRows(state, d).filter((r) => !r.closed)]);
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
      if (isDesk() && document.querySelector(".desk")) {
        e.preventDefault();
        const key = decodeURIComponent(el.getAttribute("href").replace(/^#\/m\//, ""));
        if (route().view !== "detail") deskReturn = route().view;
        history.pushState(null, "", `#/m/${encodeURIComponent(key)}`);
        return selectDesk(key);
      }
      return; // the link changes the hash
    case "close-detail":
      openedDetailFromApp = false;
      history.pushState(null, "", deskReturn === "near" ? "#/" : `#/${deskReturn}`);
      return selectDesk(null);
    case "desk-view":
      setState({ deskView: value });
      return render();
    case "desk-radius":
      setState({ radius: +value });
      return refresh();
    case "type": {
      const types = state.types.includes(value) ? state.types.filter((t) => t !== value) : [...state.types, value];
      setState({ types, limit: PAGE, typesOpen: Boolean(el.closest(".bmore")) });
      return render();
    }
    case "clear-types":
      setState({ types: [], limit: PAGE, typesOpen: false });
      return render();
    case "desk-layout":
      store.set("deskLayout", deskLayout() === "top" ? "side" : "top");
      render();
      return resizeMap();
    case "back":
      if (openedDetailFromApp && history.length > 1) history.back();
      else location.hash = "#/";
      openedDetailFromApp = false;
      return;
    case "pick-area": return areaDialog();
    case "locate": return locate(el);
    case "lines": return linesDialog();
    case "share-menu": return shareMenu();
    case "add-calendar": {
      const m = state.byKey.get(el.dataset.key) ?? state.favorites[el.dataset.key];
      if (m) downloadCalendar(m);
      return;
    }
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
    case "dismiss-ios":
      store.set("iosAppHintDismissed", true);
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

// ---- Wide screens ----
// Two layouts, picked with the Layout button and remembered: "top" (filters in a bar above a
// full-width list, the default) and "side" (filters in a column). In both, the map fills the right
// side and a meeting's details open under it; every divider can be dragged and remembers its size.

const DESK = matchMedia("(min-width: 1100px)");
const isDesk = () => DESK.matches;
let deskReturn = "near"; // the list a meeting was opened from
DESK.addEventListener("change", () => {
  if (!isDesk()) forgetMap();
  render();
});

const LOGO = `<svg class="dlogo" viewBox="18 18 72 72" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"><path d="M54,52 L54,78"/><path d="M54,52 C54,63 38,64 35,78"/><path d="M54,52 C54,63 70,64 73,78"/></g><circle cx="54" cy="39" r="8.5" fill="currentColor"/></svg>`;

// Pin colors: the badge colors, deepened so a dot reads on a map.
const PIN = { AA: "#2f55c8", NA: "#2e7d32", REFUGE: "#c76a00", DHARMA: "#8e44a0", CMA: "#c0392b", SMART: "#1b7f99", WELLBRIETY: "#8a6420", ALANON: "#be185d", OTHER: "#5f6f73" };
const pinColor = (f) => PIN[f] ?? PIN.OTHER;

const deskLayout = () => (store.get("deskLayout", "top") === "side" ? "side" : "top");
const SIZE_LIMITS = { filters: [210, 420], side: [300, 1100], map: [140, 2000] };

function applySizes(desk) {
  const s = store.get("deskSizes", {});
  if (s.filters) desk.style.setProperty("--w-filters", s.filters + "px");
  if (s.side) desk.style.setProperty("--w-side", s.side + "px");
  if (s.map) desk.style.setProperty("--h-map", s.map + "px");
}

function renderDesk(r) {
  const view = r.view === "detail" ? deskReturn : r.view;
  if (r.view !== "detail") deskReturn = r.view;
  document.body.dataset.view = view;
  let desk = document.querySelector(".desk");
  if (!desk) {
    app.innerHTML = `<div class="desk">
      <header class="dtop" id="dtop"></header>
      <div class="dbar" id="dbar"></div>
      <aside class="dfilters" id="dfilters" aria-label="Filters"></aside>
      <div class="dsplit v" data-split="filters" role="separator" aria-orientation="vertical" aria-label="Resize the filters" tabindex="0"></div>
      <main class="dlist" id="list" aria-live="polite"></main>
      <div class="dsplit v" data-split="side" role="separator" aria-orientation="vertical" aria-label="Resize the map" tabindex="0"></div>
      <section class="dside" aria-label="Map and meeting details">
        <div class="dmap" id="dmap"></div>
        <div class="dsplit h" data-split="map" role="separator" aria-orientation="horizontal" aria-label="Resize the map and details" tabindex="0"></div>
        <div class="ddetail" id="ddetail"></div>
      </section>
    </div>`;
    desk = document.querySelector(".desk");
    applySizes(desk);
  }
  desk.dataset.mode = deskLayout();
  desk.dataset.view = view;
  const search = document.getElementById("q");
  const hadFocus = search && document.activeElement === search;
  document.getElementById("dtop").innerHTML = deskTop(view);
  if (hadFocus) {
    const q = document.getElementById("q");
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
  const top = deskLayout() === "top";
  document.getElementById("dbar").innerHTML = top ? deskBar(view) : "";
  document.getElementById("dfilters").innerHTML = top ? "" : deskFilters(view);
  updateDesk();
  document.title = { near: "Many Paths: recovery meetings near you and online", online: "Online meetings · Many Paths", saved: "Saved meetings · Many Paths" }[view];
}

function updateDesk() {
  const r = route();
  const view = r.view === "detail" ? deskReturn : r.view;
  const week = view === "near" && state.deskView === "week" && !state.query.trim() && state.area;
  document.getElementById("list").innerHTML = week ? weekGrid() : listFor(view);
  document.querySelector(".desk").dataset.week = String(Boolean(week));
  selectDesk(r.view === "detail" ? r.key : null);
}

/** Shows [key] under the map (or nothing), marks its card, and moves the map's pin. */
function selectDesk(key) {
  const detail = document.getElementById("ddetail");
  if (!detail) return;
  const m = key ? state.byKey.get(key) ?? state.favorites[key] : null;
  detail.innerHTML = m ? deskDetail(m)
    : key ? `<section class="dempty">${state.loaded ? "<h2>This meeting isn't in the lists right now</h2><p>It may have moved or ended.</p>" : "<p>Loading…</p>"}</section>` : "";
  detail.scrollTop = 0;
  document.querySelector(".desk").dataset.detail = String(Boolean(key));
  document.querySelectorAll(".card.sel, .witem.sel").forEach((c) => c.classList.remove("sel"));
  if (key) {
    const sel = `[data-key="${CSS.escape(key)}"]`;
    document.querySelectorAll(`.card${sel}, .witem${sel}`).forEach((c) => c.classList.add("sel"));
  }
  deskMap(key);
}

function deskTop(view) {
  const tab = (id, href, name, label) =>
    `<a href="${href}" class="dtab${view === id ? " on" : ""}"${view === id ? ' aria-current="page"' : ""}>${icon(name)}<span>${label}</span></a>`;
  const top = deskLayout() === "top";
  return `
    <a class="dbrand" href="#/" aria-label="Many Paths, meetings near you">${LOGO}<span>Many Paths</span></a>
    <nav class="dtabs" aria-label="Sections">${tab("near", "#/", "place", "Near me")}${tab("online", "#/online", "videocam", "Online")}${tab("saved", "#/saved", "heart", "Saved")}</nav>
    <label class="dsearch">${icon("search")}<input id="q" type="search" placeholder="Search names, places and types across the week" value="${esc(state.query)}" autocomplete="off" aria-label="Search meetings"></label>
    <div class="dtop-actions">
      <button class="icon-btn" data-action="desk-layout" aria-label="${top ? "Show filters in a column" : "Show filters above the list"}" title="${top ? "Filters in a column" : "Filters above the list"}">${icon(top ? "viewSidebar" : "viewAgenda")}</button>
      <a class="btn tonal" href="#/get">${icon("download")}<span>Get the app</span></a>
      <button class="icon-btn" data-action="share-menu" aria-label="Share this list">${icon("share")}</button>
      <a class="icon-btn" href="#/about" aria-label="Meeting lists and help">${icon("info")}</a>
    </div>`;
}

// ---- The filter bar (top layout) ----

const chip = ({ action, value = "", on, label, count = null, dot = null, title = "" }) =>
  `<button class="bchip${on ? " on" : ""}" data-action="${action}" data-value="${esc(value)}" aria-pressed="${on}"${title ? ` title="${esc(title)}"` : ""}>${dot ? `<span class="fdot" style="background:${dot}"></span>` : ""}<span>${esc(label)}</span>${count !== null ? `<small>${count}</small>` : ""}</button>`;

function typeMenu(base) {
  const rows = typeCounts(base);
  const n = state.types.length;
  return `<details class="bmore"${state.typesOpen ? " open" : ""}>
    <summary class="bchip${n ? " on" : ""}">${icon("tune", "icon tiny")}<span>Meeting type${n ? ` · ${n}` : ""}</span>${icon("expand", "icon tiny")}</summary>
    <div class="bmenu">${rows.map(([label, c]) => optionRow({ action: "type", value: label, on: state.types.includes(label), label, count: c, title: describe(label) ?? "" })).join("") || `<p class="muted small">No types listed.</p>`}
      ${n ? `<button class="text-btn" data-action="clear-types">Clear</button>` : ""}</div>
  </details>`;
}

function fellowshipChips2(available, countOf) {
  const all = !state.fellowships.length;
  return chip({ action: "fellowship", on: all, label: "All" }) + available.map((f) =>
    chip({ action: "fellowship", value: f, on: state.fellowships.includes(f), label: fl(f).label, count: countOf(f), dot: pinColor(f), title: fl(f).full })).join("");
}

function deskBar(view) {
  const t = today();
  const withoutTypes = { ...state, types: [] };
  if (view === "saved") {
    const n = Object.keys(state.favorites).length;
    return `<div class="brow"><p class="muted">${n ? `${n} saved ${n === 1 ? "meeting" : "meetings"}, soonest first.` : "Tap the heart on any meeting to keep it here."} Saved meetings stay in this browser.</p></div>`;
  }
  if (view === "online") {
    const date = state.onlineWhen === "soon" ? null : addDays(t, state.onlineWhen);
    const whens = [["soon", "Starting soon"], ...Array.from({ length: 7 }, (_, i) => [i, dayChipLabel(addDays(t, i), t)])];
    const rows = onlineFor(date, state.englishOnly);
    const hidden = state.englishOnly ? onlineFor(date, false).length - rows.length : 0;
    return `<div class="brow">
        <div class="bchips" role="group" aria-label="When">${whens.map(([v, label]) => chip({ action: "online-when", value: String(v), on: state.onlineWhen === v, label })).join("")}</div>
        ${chip({ action: "english", on: state.englishOnly, label: "English only", count: hidden > 0 ? `${hidden} hidden` : null })}
        <span class="muted small">Times in ${esc(zoneShort(Date.now(), viewerZone()))}</span>
      </div>
      <div class="brow">
        <div class="bchips" role="group" aria-label="Fellowship">${fellowshipChips2(onlineFellowships(state), (f) => rows.filter((r) => r.m.fellowship === f).length)}</div>
        ${typeMenu(onlineRows(withoutTypes, date, Date.now(), { englishOnly: state.englishOnly }))}
      </div>`;
  }
  if (!state.area) {
    return `<div class="brow"><strong>Where should we look?</strong>
      <button class="btn" data-action="locate">${icon("myLocation")} Use my location</button>
      <button class="btn tonal" data-action="pick-area">Type a city</button>
      <span class="muted small">Online meetings don't need a place. They're in the Online tab.</span></div>`;
  }
  const date = addDays(t, state.dayOffset);
  const rows = nearbyRows(state, date);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(t, i);
    const holiday = holidayOn(d);
    const n = nearbyRows(state, d).filter((x) => !x.closed).length;
    return chip({ action: "day", value: String(i), on: state.dayOffset === i, label: dayChipLabel(d, t), title: `${n} ${n === 1 ? "meeting" : "meetings"}${holiday ? ` · ${cap(holiday)}` : ""}` });
  }).join("");
  const lines = linesNear(state.helplines, state.area);
  return `<div class="brow">
      <button class="bplace" data-action="pick-area" title="Change place or distance">${icon("place", "icon brand")}<strong>${esc(state.area.label)}</strong><span>${state.radius} mi</span>${icon("expand", "icon tiny")}</button>
      <div class="bchips" role="group" aria-label="Day">${days}</div>
      <div class="fseg" role="group" aria-label="Layout"><button class="${state.deskView === "list" ? "on" : ""}" data-action="desk-view" data-value="list" aria-pressed="${state.deskView === "list"}">List</button><button class="${state.deskView === "week" ? "on" : ""}" data-action="desk-view" data-value="week" aria-pressed="${state.deskView === "week"}">Week</button></div>
    </div>
    <div class="brow">
      <div class="bchips" role="group" aria-label="Fellowship">${fellowshipChips2(nearbyFellowships(state), (f) => rows.filter((r) => r.m.fellowship === f && !r.closed).length)}</div>
      ${typeMenu(nearbyRows(withoutTypes, date))}
      ${lines.length ? `<button class="bchip" data-action="lines">${icon("phone", "icon tiny")}<span>Phone lines</span></button>` : ""}
      <a class="bchip crisis-chip" href="tel:988">Crisis? Call or text 988</a>
    </div>`;
}

// ---- The filter column (side layout) ----

const fbox = (title, body, extra = "") => `<section class="fbox"><div class="fbox-h"><h2>${title}</h2>${extra}</div>${body}</section>`;

function optionRow({ action, value = "", on, label, count = null, dot = null, title = "", single = false }) {
  const mark = dot ? `<span class="fdot" style="background:${dot}"></span>`
    : single ? `<span class="fradio"></span>` : `<span class="fcheck">${on ? icon("check", "icon tiny") : ""}</span>`;
  return `<button class="frow${on ? " on" : ""}" data-action="${action}" data-value="${esc(value)}" aria-pressed="${on}"${title ? ` title="${esc(title)}"` : ""}>
    ${mark}<span class="flabel">${esc(label)}</span>${count !== null ? `<span class="fcount">${count}</span>` : ""}
  </button>`;
}

/** Type labels across [rows], most common first, with the ones already picked kept. */
function typeCounts(rows) {
  const counts = new Map();
  for (const r of rows) for (const t of r.m.types) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const t of state.types) if (!top.some(([x]) => x === t)) top.push([t, counts.get(t) ?? 0]);
  return top;
}

function fellowshipRows(available, countOf) {
  const all = !state.fellowships.length;
  return optionRow({ action: "fellowship", on: all, label: "All fellowships" }) + available.map((f) =>
    optionRow({ action: "fellowship", value: f, on: state.fellowships.includes(f), label: fl(f).full, count: countOf(f), dot: pinColor(f) })).join("");
}

function deskFilters(view) {
  if (view === "saved") {
    const n = Object.keys(state.favorites).length;
    return fbox("Saved", `<p class="muted small">${n ? `${n} saved ${n === 1 ? "meeting" : "meetings"}, soonest first.` : "Tap the heart on any meeting to keep it here."} Saved meetings stay in this browser.</p>`);
  }
  const t = today();
  const withoutTypes = { ...state, types: [] };
  if (view === "online") {
    const date = state.onlineWhen === "soon" ? null : addDays(t, state.onlineWhen);
    const whens = [["soon", "Starting soon"], ...Array.from({ length: 7 }, (_, i) => [i, dayTitle(addDays(t, i), t)])];
    const rows = onlineFor(date, state.englishOnly);
    const hidden = state.englishOnly ? onlineFor(date, false).length - rows.length : 0;
    const base = onlineRows(withoutTypes, date, Date.now(), { englishOnly: state.englishOnly });
    return fbox("When", whens.map(([v, label]) => optionRow({ action: "online-when", value: String(v), on: state.onlineWhen === v, label, single: true })).join("") +
        `<p class="muted small fnote">Times are in your time zone (${esc(zoneShort(Date.now(), viewerZone()))}).</p>`) +
      fbox("Language", optionRow({ action: "english", on: state.englishOnly, label: "English only", count: hidden > 0 ? `${hidden} hidden` : null })) +
      fbox("Fellowship", fellowshipRows(onlineFellowships(state), (f) => rows.filter((r) => r.m.fellowship === f).length)) +
      fbox("Meeting type", typeCounts(base).map(([label, n]) => optionRow({ action: "type", value: label, on: state.types.includes(label), label, count: n, title: describe(label) ?? "" })).join("") || `<p class="muted small">No types listed.</p>`);
  }
  if (!state.area) {
    return fbox("Where", `<p class="muted small">Choose a place to see meetings near it.</p>
      <div class="fbtns"><button class="btn" data-action="locate">${icon("myLocation")} Use my location</button><button class="btn tonal" data-action="pick-area">Type a city</button></div>`);
  }
  const date = addDays(t, state.dayOffset);
  const lines = linesNear(state.helplines, state.area);
  const days = Array.from({ length: 7 }, (_, i) => i).map((i) => {
    const d = addDays(t, i);
    const n = nearbyRows(state, d).filter((r) => !r.closed).length;
    const holiday = holidayOn(d);
    return optionRow({ action: "day", value: String(i), on: state.dayOffset === i, label: dayTitle(d, t) + (holiday ? " · holiday" : ""), count: n, title: holiday ? cap(holiday) : "", single: true });
  }).join("");
  const rows = nearbyRows(state, date);
  return fbox("Where", `
      <button class="farea" data-action="pick-area">${icon("place", "icon brand")}<span><strong>${esc(state.area.label)}</strong><small>Change place</small></span></button>
      <div class="fseg" role="group" aria-label="Distance">${RADII.map((d) => `<button class="${state.radius === d ? "on" : ""}" data-action="desk-radius" data-value="${d}" aria-pressed="${state.radius === d}">${d} mi</button>`).join("")}</div>`) +
    fbox("Day", days, `<div class="fseg small" role="group" aria-label="Layout"><button class="${state.deskView === "list" ? "on" : ""}" data-action="desk-view" data-value="list" aria-pressed="${state.deskView === "list"}">List</button><button class="${state.deskView === "week" ? "on" : ""}" data-action="desk-view" data-value="week" aria-pressed="${state.deskView === "week"}">Week</button></div>`) +
    fbox("Fellowship", fellowshipRows(nearbyFellowships(state), (f) => rows.filter((r) => r.m.fellowship === f && !r.closed).length)) +
    fbox("Meeting type", typeCounts(nearbyRows(withoutTypes, date)).map(([label, n]) => optionRow({ action: "type", value: label, on: state.types.includes(label), label, count: n, title: describe(label) ?? "" })).join("") || `<p class="muted small">No types listed for this day.</p>`) +
    fbox("Phone lines", `<ul class="flines">${lines.map(({ line }) => `<li><span>${esc(line.name)}</span>${line.phones.slice(0, 2).map((p) => `<a href="${esc(telUrl(p.number))}">${esc(p.number)} · ${esc(p.label)}</a>`).join("")}</li>`).join("")}<li><span>Crisis, any time</span><a href="tel:988">Call or text 988</a></li></ul>`);
}

function cardActions(m) {
  const out = [];
  if (m.attendance !== ONLINE) {
    const d = directionsUrl(m);
    if (d) out.push(ext(d, `${icon("directions", "icon tiny")} Directions`, "mini"));
  }
  if (isJoinable(m) && m.joinUrl) out.push(ext(m.joinUrl, `${icon("videocam", "icon tiny")} ${esc(joinLabel(m.joinUrl))}`, "mini"));
  return out.length ? `<div class="card-actions">${out.join("")}</div>` : "";
}

function weekGrid() {
  const t = today();
  const cols = Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((d) => [d, nearbyRows(state, d)]);
  return `<div class="week">${cols.map(([d, rows]) => {
    const holiday = holidayOn(d);
    return `<section class="wcol${d === addDays(t, state.dayOffset) ? " on" : ""}">
      <h3><span>${esc(dayChipLabel(d, t))}</span><small>${rows.filter((r) => !r.closed).length} meetings</small></h3>
      ${holiday ? `<p class="wholiday" title="Some places close on holidays">${esc(cap(holiday))}</p>` : ""}
      ${rows.map((r) => `<a class="witem${r.closed ? " closed" : ""}" href="#/m/${encodeURIComponent(r.m.key)}" data-action="open" data-key="${esc(r.m.key)}">
        <span class="wtime">${esc(clock(r.start, r.tz))}</span><span class="wdot" style="background:${pinColor(r.m.fellowship)}"></span><span class="wname">${esc(r.m.name)}${r.closed ? " (not meeting)" : ""}</span></a>`).join("") || `<p class="muted small">No meetings</p>`}
    </section>`;
  }).join("")}</div>`;
}

function deskDetail(m) {
  const page = detailView(m.key);
  const body = page.slice(page.indexOf('<main class="detail">') + '<main class="detail">'.length, page.lastIndexOf("</main>"));
  return `<div class="dd-bar">
      <button class="icon-btn" data-action="close-detail" aria-label="Close details">${icon("close")}</button>
      <div class="top-actions"><button class="icon-btn" data-action="share-meeting" data-key="${esc(m.key)}" aria-label="Share this meeting">${icon("share")}</button>${favButton(m, Boolean(state.favorites[m.key]))}</div>
    </div>
    <div class="detail">${body}</div>`;
}

/** The pins for what's in the list: the day's meetings, or every match while searching. */
function deskMap(selected) {
  const el = document.getElementById("dmap");
  if (!el) return;
  const view = route().view === "detail" ? deskReturn : route().view;
  const desk = document.querySelector(".desk");
  let rows = [];
  if (view === "near" && state.area) {
    const t = today();
    rows = state.query.trim() || state.deskView === "week"
      ? Array.from({ length: 7 }, (_, i) => nearbyRows(state, addDays(t, i))).flat()
      : nearbyRows(state, addDays(t, state.dayOffset));
  } else if (view === "saved" && state.area) {
    rows = savedRows(state, Date.now()).filter((r) => r.m.attendance !== ONLINE);
  }
  const open = selected ? state.byKey.get(selected) ?? state.favorites[selected] : null;
  if (open && open.attendance !== ONLINE && !rows.some((r) => r.m.key === open.key)) rows.push(row(open, nextOccurrence(open, Date.now()), zoneOf(open), null));
  const hasMap = Boolean(state.area) && (view === "near" || rows.length > 0);
  desk.dataset.map = String(hasMap);
  if (!hasMap) return;
  const seen = new Set();
  const points = rows.filter((r) => !seen.has(r.m.key) && seen.add(r.m.key)).map((r) => ({
    key: r.m.key,
    lat: r.m.lat,
    lng: r.m.lng,
    color: pinColor(r.m.fellowship),
    title: r.m.name,
    time: clock(r.start, r.tz),
    place: r.m.locationName ?? r.m.address ?? r.m.name,
  }));
  drawMap(el, {
    center: state.area,
    radiusMiles: state.radius,
    points,
    selected,
    pick: (key) => {
      if (route().view !== "detail") deskReturn = route().view;
      history.pushState(null, "", `#/m/${encodeURIComponent(key)}`);
      selectDesk(key);
      document.querySelector(`.card[data-key="${CSS.escape(key)}"], .witem[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
  });
}

// ---- Dragging the dividers ----

function saveSizes(desk) {
  const read = (v) => parseInt(desk.style.getPropertyValue(v), 10) || undefined;
  store.set("deskSizes", { filters: read("--w-filters"), side: read("--w-side"), map: read("--h-map") });
}

function nudge(handle, delta) {
  const desk = handle.closest(".desk");
  const kind = handle.dataset.split;
  const box = (sel) => desk.querySelector(sel).getBoundingClientRect();
  const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
  if (kind === "filters") desk.style.setProperty("--w-filters", clamp(box(".dfilters").width + delta, SIZE_LIMITS.filters) + "px");
  else if (kind === "side") desk.style.setProperty("--w-side", clamp(box(".dside").width - delta, [SIZE_LIMITS.side[0], Math.min(SIZE_LIMITS.side[1], window.innerWidth - 480)]) + "px");
  else desk.style.setProperty("--h-map", clamp(box(".dmap").height + delta, [SIZE_LIMITS.map[0], box(".dside").height - 160]) + "px");
  resizeMap();
}

document.addEventListener("pointerdown", (e) => {
  const handle = e.target.closest?.(".dsplit");
  if (!handle || e.button !== 0) return;
  e.preventDefault();
  const horizontal = handle.dataset.split === "map";
  let last = horizontal ? e.clientY : e.clientX;
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("dragging");
  const move = (ev) => {
    const now = horizontal ? ev.clientY : ev.clientX;
    nudge(handle, now - last);
    last = now;
  };
  const up = () => {
    handle.removeEventListener("pointermove", move);
    document.body.classList.remove("dragging");
    saveSizes(handle.closest(".desk"));
    resizeMap();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up, { once: true });
  handle.addEventListener("pointercancel", up, { once: true });
});

// Arrow keys move a focused divider; a double click puts it back.
document.addEventListener("keydown", (e) => {
  const handle = e.target.closest?.(".dsplit");
  if (!handle) return;
  const step = e.shiftKey ? 60 : 20;
  const delta = { ArrowLeft: -step, ArrowUp: -step, ArrowRight: step, ArrowDown: step }[e.key];
  if (delta === undefined) return;
  e.preventDefault();
  nudge(handle, delta);
  saveSizes(handle.closest(".desk"));
});

document.addEventListener("dblclick", (e) => {
  const handle = e.target.closest?.(".dsplit");
  if (!handle) return;
  const desk = handle.closest(".desk");
  desk.style.removeProperty({ filters: "--w-filters", side: "--w-side", map: "--h-map" }[handle.dataset.split]);
  saveSizes(desk);
  resizeMap();
});

// The meeting-type menu stays open while choosing several, and closes on a click elsewhere.
document.addEventListener("toggle", (e) => {
  if (e.target.matches?.("details.bmore")) state.typesOpen = e.target.open;
}, true);
document.addEventListener("click", (e) => {
  if (state.typesOpen && !e.target.closest(".bmore")) {
    state.typesOpen = false;
    document.querySelectorAll("details.bmore[open]").forEach((d) => d.removeAttribute("open"));
  }
}, true);

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
