// Offline support. The app's own files are served from the cache and refreshed in the
// background; meeting lists come from the network when it answers, else the last copy.
const VERSION = "2026-10-19.1";
const SHELL = `shell-${VERSION}`;
const DATA = "data-v1";
const SHELL_FILES = [
  "./", "index.html", "app.css", "manifest.webmanifest",
  "js/app.js", "js/data.js", "js/icons.js", "js/labels.js", "js/language.js", "js/model.js",
  "js/parse.js", "js/places.js", "js/rows.js", "js/share.js", "js/text.js", "js/time.js",
  "icons/favicon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isMeetingData = (url) =>
  url.pathname.startsWith("/many-paths-data/v1/") || url.hostname === "aggregator.bmltenabled.org";

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (isMeetingData(url)) {
    // Network first; the saved copy keeps the app working with no signal.
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(DATA).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request, { cacheName: DATA }).then((hit) => hit ?? Response.error())));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
    // The app itself: answer from the cache at once, fetch the latest for next time.
    event.respondWith(caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(request, { ignoreSearch: true });
      const fresh = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
      if (hit) {
        event.waitUntil(fresh.catch(() => {}));
        return hit;
      }
      return fresh;
    }));
  }
});
