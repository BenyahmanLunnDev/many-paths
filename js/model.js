// Fellowships and attendance, as in the Android app's Meeting.kt.

export const FELLOWSHIPS = {
  AA: { label: "AA", full: "Alcoholics Anonymous" },
  NA: { label: "NA", full: "Narcotics Anonymous" },
  REFUGE: { label: "Refuge", full: "Refuge Recovery" },
  DHARMA: { label: "Dharma", full: "Recovery Dharma" },
  CMA: { label: "CMA", full: "Crystal Meth Anonymous" },
  SMART: { label: "SMART", full: "SMART Recovery" },
  WELLBRIETY: { label: "Wellbriety", full: "Wellbriety and Native-led recovery" },
  OTHER: { label: "Other", full: "Other recovery groups" },
};

export const FELLOWSHIP_ORDER = Object.keys(FELLOWSHIPS);

export function parseFellowship(value) {
  const key = String(value ?? "").trim().toUpperCase();
  return FELLOWSHIPS[key] ? key : null;
}

export const IN_PERSON = "IN_PERSON";
export const HYBRID = "HYBRID";
export const ONLINE = "ONLINE";

export const ATTENDANCE_LABEL = { IN_PERSON: "In person", HYBRID: "In person + online", ONLINE: "Online" };

/** "Place name, address", without repeating the address when a group typed it as the place name. */
export function placeLine(m) {
  const street = m.address ? m.address.split(",")[0].trim() : null;
  let name = m.locationName;
  if (name && street) {
    const n = name.toLowerCase();
    if (n.includes(street.toLowerCase()) || m.address.toLowerCase().includes(n)) name = null;
  }
  return [name, m.address].filter(Boolean).join(", ") || null;
}

export function isJoinable(m) {
  return Boolean(m.joinUrl || m.joinPhone);
}
