// Human-readable labels for meeting type codes (the Android app's TypeLabels.kt).
// TSML feeds use the Meeting Guide spec codes; BMLT (NA) uses its own format codes.
// Unknown short codes are dropped because they mean different things on different servers.

export const OPEN = "Open";
export const CLOSED = "Closed";

const meetingGuide = {
  "11": "11th Step meditation", "12x12": "12 Steps & 12 Traditions", A: "Secular",
  ABSI: "As Bill Sees It", "AL-AN": "With Al-Anon", AL: "With Alateen", ASL: "ASL",
  B: "Big Book", BA: "Babysitting", BE: "Newcomer", BI: "Bisexual",
  BRK: "Breakfast", C: CLOSED, CAN: "Candlelight", CF: "Child-friendly",
  D: "Discussion", DD: "Dual diagnosis", DR: "Daily Reflections",
  EN: "English", FF: "Fragrance free", FR: "French", G: "Gay",
  GR: "Grapevine", H: "Birthday", L: "Lesbian", LGBTQ: "LGBTQ+",
  LIT: "Literature", LS: "Living Sober", M: "Men", MED: "Meditation",
  N: "Native American", NDG: "Indigenous", O: OPEN, OUT: "Outdoor",
  P: "Professionals", POC: "People of color", S: "Spanish", SEN: "Seniors",
  SM: "Smoking permitted", SP: "Speaker", ST: "Step study", T: "Transgender",
  TR: "Tradition study", W: "Women", X: "Wheelchair access",
  XB: "Wheelchair-accessible bathroom", XT: "Cross talk permitted", Y: "Young people",
  WA: "Wheelchair access", BT: "Basic Text", LO: "Literature only",
  ES: "Spanish", POL: "Polish", POR: "Portuguese", RUS: "Russian", JA: "Japanese",
  KOR: "Korean", HE: "Hebrew", PUN: "Punjabi", ITA: "Italian",
};

const bmlt = {
  O: OPEN, C: CLOSED, BT: "Basic Text", JFT: "Just for Today",
  IW: "It Works", SG: "Step Working Guide", LC: "Living Clean",
  BK: "Book study", ST: "Step study", TR: "Tradition study", TO: "Topic",
  D: "Discussion", SP: "Speaker", SD: "Speaker/discussion", QA: "Q&A",
  RF: "Rotating format", CL: "Candlelight", ME: "Meditation",
  NC: "No children", CW: "Children welcome", WC: "Wheelchair access",
  W: "Women", M: "Men", GL: "LGBTQ+", LGBT: "LGBTQ+", LGBTQ: "LGBTQ+",
  Y: "Young people", YP: "Young people", BEG: "Newcomer", NS: "Non-smoking",
  SM: "Smoking permitted", ES: "Spanish", SPAN: "Spanish", ASL: "ASL",
  VM: "Virtual", HY: "Hybrid", IP: "IP study", GP: "Guiding Principles",
  SPAD: "Spiritual Principle a Day", VAR: "Varies", CPT: "12 Concepts",
};

const hidden = new Set(["ONL", "TC", "EN", "VM", "HY", "Virtual"]);
const priority = [OPEN, CLOSED];

export const fromMeetingGuide = (codes) => labels(codes, meetingGuide);
export const fromBmlt = (codes) => labels(codes, bmlt);

// Feed codes are untrusted text: never let one reach Object.prototype ("constructor").
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : null);

function labels(codes, table) {
  const out = new Set();
  for (const raw of codes) {
    const code = raw.trim();
    if (!code || hidden.has(code) || hidden.has(code.toUpperCase())) continue;
    const label = own(table, code) ?? own(table, code.toUpperCase()) ??
      (code.length > 4 || code.includes(" ") ? wordLabel(code) : null);
    if (label && !hidden.has(label)) out.add(label);
  }
  const rank = (l) => (priority.indexOf(l) < 0 ? priority.length : priority.indexOf(l));
  return [...out].sort((a, b) => rank(a) - rank(b));
}

// Some feeds (CMA, custom sites) use words instead of codes.
function wordLabel(word) {
  const lower = word.toLowerCase();
  if (lower === "open") return OPEN;
  if (lower === "closed") return CLOSED;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function describe(label) {
  if (label === OPEN) return "Open: anyone may attend, including people who are curious, family and friends, or students.";
  if (label === CLOSED) return "Closed: for people who have, or think they may have, a problem with alcohol or drugs.";
  return null;
}
