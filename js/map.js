// The map on wide screens: MapLibre drawing OpenFreeMap's vector maps (OpenStreetMap data), so
// streets and labels stay sharp on any screen, in light or dark to match. Free, with no account
// or key, and no tracking. Loaded only when a computer-sized window needs it. Meetings at the
// same place share one pin.

const LIB = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/";
const SRI_JS = "sha512-UYgyVPlwHX0hwNIQk1W9mgdRepPxiOBEYqCcrIk85RKL6lh3YHujSSG2hf4RnCbRpPXfmJN5TtyauQWTV/wFEA==";
const SRI_CSS = "sha512-ThCFU5nYVz8ubpOnjGHNGrTjZimTQ63X6t4een1DAWfKP8t39iSw2x3WlUr8EkePjBj48HeNkrAg9t9GRu+s2w==";
const STYLE = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

let lib = null;
function loadLib() {
  lib ??= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    Object.assign(css, { rel: "stylesheet", href: LIB + "maplibre-gl.min.css", integrity: SRI_CSS, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
    const js = document.createElement("script");
    Object.assign(js, { src: LIB + "maplibre-gl.min.js", integrity: SRI_JS, crossOrigin: "anonymous", referrerPolicy: "no-referrer" });
    js.onload = () => resolve(window.maplibregl);
    js.onerror = () => { lib = null; reject(new Error("map unavailable")); };
    document.head.append(css, js);
  });
  return lib;
}

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

let gl = null;
let map = null;
let host = null;
let theme = null;
let pending = null;
let onPick = null;
let lastFit = "";
let popup = null;

const empty = { type: "FeatureCollection", features: [] };

/** One feature per place: a church with five meetings is one pin that says so. */
function features(points, selected) {
  const places = new Map();
  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    const id = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (!places.has(id)) places.set(id, []);
    places.get(id).push(p);
  }
  return {
    type: "FeatureCollection",
    features: [...places.values()].map((group) => {
      const pick = group.find((p) => p.key === selected) ?? group[0];
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [pick.lng, pick.lat] },
        properties: {
          key: pick.key,
          color: pick.color,
          count: group.length,
          on: group.some((p) => p.key === selected) ? 1 : 0,
          label: group.length > 1 ? `${pick.place} · ${group.length} meetings` : `${pick.time} · ${pick.title}`,
        },
      };
    }),
  };
}

function addLayers() {
  if (map.getSource("meetings")) return;
  const css = getComputedStyle(document.documentElement);
  const ring = css.getPropertyValue("--surface").trim() || "#ffffff";
  const ringOn = css.getPropertyValue("--text").trim() || "#13262b";
  map.addSource("meetings", { type: "geojson", data: empty });
  map.addLayer({
    id: "meetings",
    type: "circle",
    source: "meetings",
    layout: { "circle-sort-key": ["get", "on"] },
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["case", ["==", ["get", "on"], 1], 11, [">", ["get", "count"], 1], 8.5, 7],
      "circle-stroke-width": ["case", ["==", ["get", "on"], 1], 3.5, 2],
      "circle-stroke-color": ["case", ["==", ["get", "on"], 1], ringOn, ring],
    },
  });
}

function flush() {
  if (!pending || !map?.getSource("meetings")) return;
  const { center, radiusMiles, points, selected } = pending;
  map.getSource("meetings").setData(features(points, selected));
  const fitId = `${center.lat},${center.lng},${radiusMiles}`;
  if (fitId !== lastFit) {
    lastFit = fitId;
    const dLat = radiusMiles / 69;
    const dLng = radiusMiles / (69 * Math.cos((center.lat * Math.PI) / 180));
    map.fitBounds([[center.lng - dLng, center.lat - dLat], [center.lng + dLng, center.lat + dLat]], { padding: 24, duration: 0 });
  }
  const pick = selected && points.find((p) => p.key === selected && p.lat != null);
  if (pick) {
    const at = map.project([pick.lng, pick.lat]);
    const { width, height } = map.getContainer().getBoundingClientRect();
    if (at.x < 40 || at.y < 40 || at.x > width - 40 || at.y > height - 40) map.easeTo({ center: [pick.lng, pick.lat], duration: 400 });
  }
}

/**
 * Draws [points] ({key, lat, lng, color, title, time, place}) in [el], fitted to [center] and
 * [radiusMiles]; [selected] gets the big pin, and clicking a pin calls [pick] with its key.
 */
export async function drawMap(el, { center, radiusMiles, points, selected, pick }) {
  try {
    gl = await loadLib();
  } catch {
    el.innerHTML = `<p class="map-off">The map couldn't load. The list still works.</p>`;
    return;
  }
  if (!el.isConnected) return;
  onPick = pick;
  pending = { center, radiusMiles, points, selected };
  const want = dark() ? "dark" : "light";
  if (!map || host !== el) {
    map?.remove();
    host = el;
    theme = want;
    lastFit = "";
    map = new gl.Map({
      container: el,
      style: STYLE[want],
      center: [center.lng, center.lat],
      zoom: 10,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
    popup = new gl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "pin-tip" });
    map.on("load", () => { addLayers(); flush(); });
    map.on("click", "meetings", (e) => onPick?.(e.features[0].properties.key));
    map.on("mouseenter", "meetings", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features[0];
      popup.setLngLat(f.geometry.coordinates).setText(f.properties.label).addTo(map);
    });
    map.on("mouseleave", "meetings", () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
    return;
  }
  if (theme !== want) {
    theme = want;
    map.setStyle(STYLE[want]);
    map.once("style.load", () => { addLayers(); flush(); });
    return;
  }
  map.resize();
  if (map.isStyleLoaded()) {
    addLayers();
    flush();
  }
}

/** After a panel is dragged to a new size. */
export function resizeMap() {
  map?.resize();
}

/** For when the page goes back to the phone layout. */
export function forgetMap() {
  map?.remove();
  map = null;
  host = null;
  lastFit = "";
}
