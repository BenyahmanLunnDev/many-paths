// node --test tests/   (Node 20+). Cases mirror the Android app's unit tests.
import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeEntities, formatPhone, parseClock, tidyName, withoutScheduleTail } from "../js/text.js";
import { bmltLanguageName, fromTsmlCodes, looksNonEnglish } from "../js/language.js";
import { fromBmlt, fromMeetingGuide } from "../js/labels.js";
import { bmltNearbyUrl, parseBmlt, parseTsml } from "../js/parse.js";
import { dateIn, nextOccurrence, occurrenceOn, timeRange, zonedTime } from "../js/time.js";
import { dedupe, matches, nearbyRows, onlineRows, resolveTimeZones } from "../js/rows.js";
import { linesNear, nearestPlace, parseHelplines, searchPlaces } from "../js/places.js";
import { listShareText, weekShareText } from "../js/share.js";
import { placeLine } from "../js/model.js";

const PT = "America/Los_Angeles";
const tsmlSource = { id: "evi", name: "Test AA", fellowship: "AA", kind: "TSML", website: "https://example.org" };
const naSource = { id: "na", name: "Narcotics Anonymous", fellowship: "NA", kind: "BMLT_NEARBY", website: "https://na.org" };

test("text helpers", () => {
  assert.equal(decodeEntities("Fish &amp; Chips &#8211; &#x2019;"), "Fish & Chips – ’");
  assert.equal(decodeEntities("&amp;#8211;"), "&#8211;");
  assert.equal(parseClock("19:00:00"), 1140);
  assert.equal(parseClock("7:5"), 425);
  assert.equal(parseClock("24:00"), 0);
  assert.equal(parseClock("25:00"), null);
  assert.equal(tidyName("MONDAY NIGHT NA NEWCOMERS"), "Monday Night NA Newcomers");
  assert.equal(tidyName("Mixed Case stays"), "Mixed Case stays");
  assert.equal(withoutScheduleTail("Refuge Recovery 'Live Grow Share' – Eugene, OR – Thursdays 1pm"), "Refuge Recovery 'Live Grow Share'");
  assert.equal(withoutScheduleTail("Refuge Recovery-Monday Night Refuge-Eugene OR-Monday's 7pm"), "Refuge Recovery – Monday Night Refuge");
  assert.equal(withoutScheduleTail("Co-Dependents Anonymous"), "Co-Dependents Anonymous");
  assert.equal(formatPhone("+1 541 953 2252"), "(541) 953-2252");
  assert.equal(formatPhone("+1 669 900 6833,,123#"), "+1 669 900 6833,,123#");
});

const notEnglish = [
  ["Эволюция*", null], ["Aramesh - آرامش", "Europe/Berlin"], ["Grupo Esperança On Line", "America/Sao_Paulo"],
  ["Caminho dos Passos", "America/Sao_Paulo"], ["Toast-Café et sérénité", "America/Toronto"],
  ["Das Kölner Zoom-Meeting am Samstag Abend", "Europe/Berlin"], ["NA Online Svanö", "Europe/Stockholm"],
  ["Vivir Limpios - 2ème réunion", "Europe/Paris"], ["EL DESEO ARDIENTE", "America/Mexico_City"],
  ["AA En Espanol", "America/Phoenix"], ["Reunión en Español de CMA “Empieza Hoy”", PT],
  ["Relacionamentos e Sobriedade", "America/Sao_Paulo"], ["Grupo El Milagro", "America/New_York"],
  ["(75 min) RD Netherlands Online (Dutch)", "Europe/Amsterdam"],
  ["DHARMA DE RECUPERACIÓN (Spanish Language) **First Sundays", PT],
  ["Aramesh Alman NA-Marathon-Meeting 24/7 گروه 24 ساعته آرامش آلمان Farsi", "Europe/Berlin"],
  ["Russian Speaking AA Meeting", PT], ["Parents en rétablissement", "America/Toronto"],
  ["Recuperação é decisão", "Europe/London"],
];
const english = [
  ["No Matter What Group", "America/New_York"], ["Monday Night Live", PT], ["Bali International Connection", "Asia/Makassar"],
  ["HIGNA Living Clean", "Europe/London"], ["El Camino Real Group", PT], ["La Jolla Step Study", PT],
  ["Sober Alps", "Europe/Zurich"], ["Women’s Secular Recovery Group", PT], ["1-2-3 Cha Cha Cha", "America/Chicago"],
  ["Berlin English Speaking NA", "Europe/Berlin"], ["Paris Pathfinders", "Europe/Paris"], ["Die Hard Group", "America/Chicago"],
  ["Do It Sober", "America/Denver"], ["Café Recovery", PT], ["RDO ⦿ Codependency", null],
  ["Misty Mountain Recovery Dharma - Inquiry Circle", "America/Denver"], ["R U 1 2 II", PT],
  ["As Dutch Sees It", PT], ["Grupo Bilingual (Spanish & English)", PT],
];

test("language detection matches the Android app", () => {
  for (const [name, zone] of notEnglish) assert.equal(looksNonEnglish(tidyName(name), zone), true, name);
  for (const [name, zone] of english) assert.equal(looksNonEnglish(tidyName(name), zone), false, name);
  assert.equal(fromTsmlCodes(["O", "EN"]), true);
  assert.equal(fromTsmlCodes(["EN", "S"]), true);
  assert.equal(fromTsmlCodes(["S"]), false);
  assert.equal(fromTsmlCodes(["DE"]), null);
  assert.equal(fromTsmlCodes(["constructor"]), null);
  assert.equal(bmltLanguageName("en"), null);
  assert.equal(bmltLanguageName("it"), "Italian");
});

test("type labels", () => {
  assert.deepEqual(fromMeetingGuide(["D", "O", "X", "ONL", "zz", "constructor"]), ["Open", "Discussion", "Wheelchair access", "Constructor"]);
  assert.deepEqual(fromBmlt(["C", "JFT", "VM"]), ["Closed", "Just for Today"]);
});

test("TSML parsing", () => {
  const meetings = parseTsml([
    { id: 1, name: "DOWNTOWN AM GROUP", day: [1, "3"], time: "07:00", end_time: "08:00", types: ["O", "D"], location: "First Church",
      formatted_address: "1166 Oak St, Eugene, OR 97401, USA", latitude: "44.047", longitude: -123.09, timezone: PT, url: "https://x.org/m/1" },
    { id: 2, name: "Zoom only", day: 2, time: "18:30", attendance_option: "online", conference_url: "https://zoom.us/j/1",
      approximate: "yes", formatted_address: "Eugene, OR", latitude: 44, longitude: -123 },
    { id: 3, name: "Closed now", day: 2, time: "12:00", types: ["TC"] },
    { id: 4, name: "Ended group", day: 2, time: "12:00", until: "2026-01-01" },
    { id: 5, name: "Holidays off", day: 3, time: "18:00", skip: ["2026-11-11", "junk"] },
    "not a meeting",
    { name: "No time", day: 1 },
  ], tsmlSource, "2026-10-19");
  assert.equal(meetings.length, 4);
  const [mon, wed, zoom, holidays] = meetings;
  assert.equal(mon.name, "Downtown Am Group"); // same as the Android app: only known acronyms stay upper case
  assert.equal(mon.day, 1);
  assert.equal(wed.day, 3);
  assert.equal(mon.key, "evi:1:1");
  assert.equal(mon.duration, 60);
  assert.equal(mon.attendance, "IN_PERSON");
  assert.equal(mon.address, "1166 Oak St, Eugene, OR 97401");
  assert.equal(mon.lat, 44.047);
  assert.deepEqual(mon.types, ["Open", "Discussion"]);
  assert.equal(zoom.attendance, "ONLINE");
  assert.equal(zoom.lat, null);
  assert.equal(zoom.address, null);
  assert.deepEqual(holidays.skip, ["2026-11-11"]);
  assert.throws(() => parseTsml({ error: "401" }, tsmlSource, "2026-10-19"));
});

test("BMLT parsing", () => {
  const meetings = parseBmlt([
    { id_bigint: "7", meeting_name: "OUT TO LUNCH BUNCH", weekday_tinyint: "2", start_time: "12:00:00", duration_time: "01:00:00",
      formats: "O,CW", venue_type: "1", location_text: "1st Christian Church", location_street: "1166 Oak St.",
      location_municipality: "Eugene", location_province: "OR", location_postal_code_1: "97401", latitude: "44.047", longitude: "-123.09",
      root_server_uri: "https://example.org/main_server" },
    { id_bigint: "8", meeting_name: "Virtual", weekday_tinyint: "1", start_time: "09:00", venue_type: "2" }, // no link: dropped
    { id_bigint: "9", meeting_name: "Gruppo", weekday_tinyint: "7", start_time: "21:00", venue_type: "2",
      virtual_meeting_link: "https://zoom.us/j/9", lang_enum: "it" },
  ], naSource);
  assert.equal(meetings.length, 2);
  assert.equal(meetings[0].name, "Out To Lunch Bunch");
  assert.equal(meetings[0].day, 1);
  assert.equal(meetings[0].address, "1166 Oak St., Eugene, OR 97401");
  assert.deepEqual(meetings[0].types, ["Open", "Children welcome"]);
  assert.match(meetings[0].key, /^na:[0-9a-z]+:7$/);
  assert.equal(meetings[1].english, false);
  assert.equal(meetings[1].types[0], "Italian");
  assert.equal(meetings[1].day, 6);
  const url = bmltNearbyUrl("https://aggregator.bmltenabled.org/main_server/", 44.0521, -123.0868, 15);
  assert.match(url, /lat_val=44.1&long_val=-123.1&geo_width=60/);
});

const base = { key: "k", sourceId: "s", fellowship: "AA", name: "Test", duration: 60, attendance: "IN_PERSON", types: [],
  locationName: null, address: null, lat: 44.05, lng: -123.09, skip: [], until: null, english: null };

test("time zones and occurrences", () => {
  // 2026-10-20 is a Tuesday; Pacific daylight time is UTC-7.
  assert.equal(zonedTime("2026-10-20", 19 * 60, PT), Date.UTC(2026, 9, 21, 2, 0));
  // The night clocks fall back (2026-11-01), 1:30 AM happens twice; either is fine, 3 AM is UTC-8.
  assert.equal(zonedTime("2026-11-01", 3 * 60, PT), Date.UTC(2026, 10, 1, 11, 0));
  const tuesday = { ...base, day: 2, start: 19 * 60, tz: PT };
  const start = occurrenceOn(tuesday, "2026-10-20", PT);
  assert.equal(dateIn(start, PT), "2026-10-20");
  assert.equal(occurrenceOn(tuesday, "2026-10-21", PT), null);
  // Seen from New York, a 11 PM Pacific Tuesday meeting is on Wednesday.
  const late = { ...tuesday, start: 23 * 60, attendance: "ONLINE" };
  assert.notEqual(occurrenceOn(late, "2026-10-21", "America/New_York"), null);
  assert.equal(occurrenceOn(late, "2026-10-20", "America/New_York"), null);
  // In progress counts; afterwards it's next week.
  const during = Date.UTC(2026, 9, 21, 2, 30);
  assert.equal(dateIn(nextOccurrence(tuesday, during), PT), "2026-10-20");
  assert.equal(dateIn(nextOccurrence(tuesday, during + 3600000), PT), "2026-10-27");
  // Closure days are stepped over.
  const closed = { ...tuesday, skip: ["2026-10-27"] };
  assert.equal(dateIn(nextOccurrence(closed, during + 3600000), PT), "2026-11-03");
  assert.equal(timeRange(start, start + 3600000, PT), "7:00–8:00 PM");
});

test("lists", () => {
  const near = { ...base, key: "a", day: 2, start: 19 * 60, tz: PT };
  const far = { ...base, key: "b", day: 2, start: 18 * 60, tz: PT, lat: 45.5, lng: -122.6 };
  const online = { ...base, key: "c", day: 2, start: 12 * 60, tz: PT, attendance: "ONLINE", lat: null, lng: null, joinUrl: "https://zoom.us/j/1" };
  const spanish = { ...online, key: "d", english: false };
  const state = { meetings: [near, far, online, spanish], area: { lat: 44.05, lng: -123.09, label: "Eugene, OR" },
    radius: 15, fellowships: [], query: "", englishOnly: true, favorites: {} };
  assert.deepEqual(nearbyRows(state, "2026-10-20").map((r) => r.m.key), ["a"]);
  assert.deepEqual(onlineRows(state, "2026-10-20", Date.now()).map((r) => r.m.key), ["c"]);
  assert.equal(onlineRows(state, "2026-10-20", Date.now(), { englishOnly: false }).length, 2);
  const noTz = { ...base, key: "e", day: 1, start: 600, tz: null, lat: 44.06, lng: -123.1 };
  assert.equal(resolveTimeZones([near, noTz])[1].tz, PT);
  assert.equal(dedupe([near, { ...near, key: "z", name: "TEST!" }]).length, 1);
  assert.equal(matches({ ...near, name: "Friendship Group", types: ["Open"] }, "friendship open"), true);
  assert.equal(matches({ ...near, name: "Friendship Group", types: [] }, "friendship tuesday"), false);
  assert.equal(placeLine({ locationName: "1166 Oak St", address: "1166 Oak St, Eugene, OR" }), "1166 Oak St, Eugene, OR");
});

test("places and phone lines", () => {
  const index = { places: [["Springfield", "IL", 39.8, -89.6, 100], ["Springfield", "OR", 44.05, -123.0, 29],
    ["Eugene", "OR", 44.05, -123.09, 156], ["Port Washington", "NY", 40.8, -73.7, 9], ["Port Orchard", "WA", 47.5, -122.6, 5]],
  zips: { "97401": [44.046, -123.088] } };
  assert.equal(searchPlaces(index, "eugene")[0].label, "Eugene, OR");
  assert.equal(searchPlaces(index, "Springfield, Oregon")[0].label, "Springfield, OR");
  assert.equal(searchPlaces(index, "springfield or")[0].label, "Springfield, OR");
  assert.equal(searchPlaces(index, "Springfield")[0].label, "Springfield, IL");
  assert.equal(searchPlaces(index, "port washington")[0].label, "Port Washington, NY");
  assert.equal(searchPlaces(index, "Eugene, O")[0].label, "Eugene, OR");
  assert.deepEqual(searchPlaces(index, "97401"), [{ label: "Eugene, OR 97401", lat: 44.046, lng: -123.088 }]);
  assert.equal(nearestPlace(index, 44.06, -123.1), "Eugene, OR");
  assert.equal(nearestPlace(index, 0, 0), null);
  const lines = parseHelplines([
    { name: "Lane NA", fellowship: "NA", lat: 44.05, lng: -123.09, radiusMiles: 50, phones: [{ label: "Helpline", number: "(541) 729-0080" }] },
    { name: "EVI", fellowship: "AA", lat: 44.04, lng: -123.02, phones: [{ number: "(541) 342-4113" }] },
    { name: "No phone", fellowship: "AA", lat: 44, lng: -123, phones: [] },
  ]);
  assert.equal(lines.length, 2);
  assert.deepEqual(linesNear(lines, { lat: 44.05, lng: -123.09 }).map((x) => x.line.name), ["EVI", "Lane NA"]);
});

test("shared text", () => {
  const m = { ...base, key: "a", day: 2, start: 19 * 60, tz: PT, name: "Downtown", locationName: "First Church", address: "1166 Oak St, Eugene, OR" };
  const start = zonedTime("2026-10-20", 19 * 60, PT);
  const r = { m, start, end: start + 3600000, tz: PT, dist: 0.4 };
  const text = listShareText("Meetings", [r], { extras: { copied: [{ source: { name: "EVI", website: "https://e.org" }, date: "Oct 17" }] } });
  assert.match(text, /^Meetings\n\n7:00 PM( PDT)? · AA · Downtown\n {3}First Church, 1166 Oak St, Eugene, OR/);
  assert.match(text, /EVI meetings were copied from their website on Oct 17 and may have changed: https:\/\/e.org/);
  const week = weekShareText("Eugene, OR", 15, [["2026-10-20", [r]], ["2026-10-21", []]], "2026-10-20");
  assert.match(week, /TUESDAY, OCT 20/);
  assert.match(week, /No meetings listed/);
});
