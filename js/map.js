// The map on wide screens: Leaflet, loaded only when a computer-sized window needs it, with
// OpenStreetMap's tiles. Meetings at the same place share a pin.

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
const SRI_JS = "sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==";
const SRI_CSS = "sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==";
// OpenStreetMap's own tiles (free, with credit). Dark mode darkens them in CSS (.dark-tiles).
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

let leaflet = null;
function loadLeaflet() {
  leaflet ??= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    Object.assign(css, { rel: "stylesheet", href: LEAFLET + "leaflet.min.css", integrity: SRI_CSS, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
    const js = document.createElement("script");
    Object.assign(js, { src: LEAFLET + "leaflet.min.js", integrity: SRI_JS, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
    js.onload = () => resolve(window.L);
    js.onerror = () => { leaflet = null; reject(new Error("map unavailable")); };
    document.head.append(css, js);
  });
  return leaflet;
}

let map = null;
let host = null;
let tiles = null;
let pins = null;
let byKey = new Map();
let lastFit = "";

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Draws [points] ({key, lat, lng, color, title, html}) on the map in [el], around [center] and
 * [radiusMiles]. [selected] gets a larger pin; tapping a pin calls [onPick] with its first key.
 */
export async function drawMap(el, { center, radiusMiles, points, selected, onPick }) {
  let L;
  try {
    L = await loadLeaflet();
  } catch {
    el.innerHTML = `<p class="map-off">The map couldn't load. The list still works.</p>`;
    return;
  }
  if (!el.isConnected) return;
  if (!map || host !== el) {
    map?.remove();
    host = el;
    map = L.map(el, { zoomControl: true, scrollWheelZoom: true, attributionControl: true });
    map.attributionControl.setPrefix(false);
    tiles = L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, className: "map-tiles" }).addTo(map);
    pins = L.layerGroup().addTo(map);
    lastFit = "";
  }
  el.classList.toggle("dark-tiles", dark());
  pins.clearLayers();
  byKey = new Map();

  const css = getComputedStyle(document.documentElement);
  const ring = { off: css.getPropertyValue("--surface").trim() || "#fff", on: css.getPropertyValue("--text").trim() || "#000" };

  // One pin per place; a church with five meetings is one pin listing all five.
  const places = new Map();
  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    const id = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (!places.has(id)) places.set(id, []);
    places.get(id).push(p);
  }
  for (const group of places.values()) {
    const first = group[0];
    const on = group.some((p) => p.key === selected);
    const marker = L.circleMarker([first.lat, first.lng], {
      radius: on ? 11 : group.length > 1 ? 8 : 7,
      weight: on ? 3 : 2,
      color: on ? ring.on : ring.off,
      fillColor: first.color,
      fillOpacity: 0.95,
      className: on ? "pin on" : "pin",
    }).addTo(pins);
    marker.bindTooltip(group.length > 1 ? `${first.place} · ${group.length} meetings` : `${first.time} ${first.title}`, { direction: "top", offset: [0, -8] });
    marker.on("click", () => onPick(first.key, group));
    for (const p of group) byKey.set(p.key, marker);
    if (on) marker.bringToFront();
  }

  const fitId = `${center.lat},${center.lng},${radiusMiles}`;
  if (fitId !== lastFit) {
    lastFit = fitId;
    const dLat = radiusMiles / 69;
    const dLng = radiusMiles / (69 * Math.cos((center.lat * Math.PI) / 180));
    map.fitBounds([[center.lat - dLat, center.lng - dLng], [center.lat + dLat, center.lng + dLng]], { padding: [8, 8] });
  }
  const pick = selected && byKey.get(selected);
  if (pick && !map.getBounds().pad(-0.1).contains(pick.getLatLng())) map.panTo(pick.getLatLng());
  setTimeout(() => map?.invalidateSize(), 0);
}

/** Leaves the map alone but forgets it, for when the page goes back to the phone layout. */
export function forgetMap() {
  map?.remove();
  map = null;
  host = null;
  lastFit = "";
}
