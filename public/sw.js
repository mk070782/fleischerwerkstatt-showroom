// Offline-Modus: App-Dateien zwischenspeichern. Bei jeder neuen Version VERSION erhöhen.
const VERSION = 'fw-showroom-6';
const FILES = [
  './', './index.html', './style.css', './app.mjs', './logic.mjs', './db.mjs', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png',
  './produkte/start-01.jpg', './produkte/start-02-v2.jpg', './produkte/start-03.jpg', './produkte/start-04.jpg', './produkte/start-05.jpg', './produkte/start-06.jpg', './produkte/start-07.jpg', './produkte/start-08.jpg', './produkte/start-09-v2.jpg', './produkte/start-10.jpg', './produkte/start-11.jpg', './produkte/start-12.jpg', './produkte/start-13.jpg', './produkte/start-14.jpg', './produkte/start-15.jpg', './produkte/start-16.jpg', './produkte/start-17.jpg', './produkte/start-18.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Netz zuerst (damit Änderungen sofort ankommen), ohne Netz aus dem Zwischenspeicher.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.endsWith('/version.json')) return; // Versionsprüfung immer direkt beim Server
  event.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
