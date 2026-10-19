// Small text helpers shared by the feed parsers. Ported from the Android app's Json.kt.

const numericEntity = /&#([xX]?[0-9a-fA-F]+);/g;

// &amp; goes last so "&amp;#8211;" becomes "&#8211;" rather than a dash.
const namedEntities = [
  ["&quot;", '"'], ["&apos;", "'"], ["&lt;", "<"], ["&gt;", ">"], ["&nbsp;", " "],
  ["&ndash;", "–"], ["&mdash;", "—"], ["&rsquo;", "’"], ["&lsquo;", "‘"],
  ["&ldquo;", "“"], ["&rdquo;", "”"], ["&hellip;", "…"], ["&amp;", "&"],
];

export function decodeEntities(s) {
  if (!s.includes("&")) return s;
  s = s.replace(numericEntity, (match, v) => {
    const code = v[0] === "x" || v[0] === "X" ? parseInt(v.slice(1), 16) : parseInt(v, 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
  for (const [entity, text] of namedEntities) s = s.split(entity).join(text);
  return s;
}

/** Plain text from a field that may contain a little HTML. */
export function stripTags(s) {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
}

/** Trimmed, entity-decoded string value, or null when missing or blank. Numbers are stringified. */
export function str(o, name) {
  const v = o?.[name];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return null;
  const s = decodeEntities(String(v).trim());
  return s.length ? s : null;
}

/** A latitude/longitude that may arrive as a number or a string; 0 and junk become null. */
export function coordinate(o, name) {
  const v = o?.[name];
  if (v === null || v === undefined || (typeof v !== "number" && typeof v !== "string")) return null;
  if (typeof v === "string" && !v.trim()) return null;
  const d = Number(typeof v === "string" ? v.trim() : v);
  return Number.isFinite(d) && d !== 0 ? d : null;
}

/** "19:00", "19:00:00" or "7:00" to minutes after midnight. */
export function parseClock(value) {
  if (!value || !value.trim()) return null;
  const parts = value.trim().split(":");
  const h = toInt(parts[0]);
  const m = parts.length > 1 ? toInt(parts[1]) : 0;
  if (h === null || m === null || h < 0 || h > 24 || m < 0 || m > 59) return null;
  return (h * 60 + m) % (24 * 60);
}

function toInt(s) {
  return /^[+-]?\d+$/.test(s ?? "") ? parseInt(s, 10) : null;
}

const keepUpper = new Set(["AA", "NA", "CA", "CMA", "II", "III", "IV", "XA", "LGBTQ", "LGBT", "BBQ", "USA"]);

/** "MONDAY NIGHT NEWCOMERS" becomes "Monday Night Newcomers"; mixed-case names are left alone. */
export function tidyName(s) {
  if (/\p{Ll}/u.test(s) || (s.match(/\p{L}/gu) || []).length < 4) return s;
  return s.split(" ").map((word) => {
    const letters = (word.match(/\p{L}/gu) || []).join("");
    if (keepUpper.has(letters)) return word;
    const lower = word.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

const spacedDash = /\s+[–—-]\s+/;
const dayAndTime = /^(mon|tue|wed|thu|fri|sat|sun)[a-z']*\b.*\d/i;
const cityState = /^[A-Z][A-Za-z. ]+,? [A-Z]{2}$/;

/**
 * Drops name tails that repeat what the app already shows, e.g.
 * "Refuge Recovery 'Live Grow Share' – Eugene, OR – Thursdays 1pm" → "Refuge Recovery 'Live Grow Share'".
 */
export function withoutScheduleTail(s) {
  // Spaced dashes first; some feeds glue segments with bare hyphens. Bare hyphens only
  // count when a segment really is a schedule or a city, so "Co-Dependents" survives.
  for (const separator of [spacedDash, /-/]) {
    const parts = s.split(separator);
    if (parts.length < 2) continue;
    const kept = parts.filter((p, i) => i === 0 || !(dayAndTime.test(p.trim()) || cityState.test(p.trim())));
    if (kept.length < parts.length) return kept.join(" – ").trim() ? kept.join(" – ") : s;
  }
  return s;
}

export function isWebUrl(s) {
  return /^https?:\/\//i.test(s ?? "");
}

/** "5419532252" or "+1 541 953 2252" becomes "(541) 953-2252"; anything else is left as written. */
export function formatPhone(raw) {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10 || /[,#]/.test(raw)) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
