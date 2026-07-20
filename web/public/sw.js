const CACHE_PREFIX = "dogmedia-static-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SHELL = [
  "/site.webmanifest",
  "/favicon.ico",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/apple-touch-icon.png",
];

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const indexResponse = await fetch("/index.html", { cache: "reload" });
  if (!indexResponse.ok) throw new Error("Could not cache the app shell");

  const html = await indexResponse.clone().text();
  const assetUrls = Array.from(
    html.matchAll(/(?:src|href)="(\/assets\/[^"?]+(?:\?[^" ]*)?)"/g),
    (match) => match[1]
  );

  await cache.put("/index.html", indexResponse);
  await cache.addAll([...APP_SHELL, ...new Set(assetUrls)]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheAppShell()
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
});
