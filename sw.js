// sw.js
// Hand-rolled service worker for the Chess Puzzles PWA.
//
// Strategy:
//   - Cache-first for the app shell (HTML, CSS, JS, vendored libs, icons).
//   - Bypass for /data/puzzles/* (loader's IDB owns puzzle freshness).
//   - Bypass cross-origin and non-GET requests.
//   - skipWaiting() + clients.claim() so a new SW activates on next reload.
//
// Bump SW_VERSION when releasing; the activate handler purges old caches.

const SW_VERSION = 'v3';
const CACHE_NAME = `chess-puzzles-${SW_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './src/app.js',
  './src/board.js',
  './src/loader.js',
  './src/store.js',
  './src/stats.js',
  './src/filters.js',
  './src/puzzle.js',
  './src/uci.js',
  './src/ui/styles.css',
  './src/ui/feedback.js',
  './src/ui/progress.js',
  './src/ui/header.js',
  './src/ui/chips.js',
  './src/ui/stars.js',
  './src/ui/install.js',
  './vendor/chess.js/dist/esm/chess.js',
  './vendor/cm-chessboard/src/Chessboard.js',
  './vendor/cm-chessboard/src/extensions/markers/Markers.js',
  './vendor/cm-chessboard/assets/chessboard.css',
  './vendor/cm-chessboard/assets/extensions/markers/markers.css',
  './vendor/cm-chessboard/assets/pieces/staunty.svg',
  './vendor/idb/build/index.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass: data files (loader handles freshness via index.json + sha256 + IDB).
  if (url.pathname.includes('/data/puzzles/')) return;

  // Bypass: non-GET requests.
  if (event.request.method !== 'GET') return;

  // Bypass: cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // Cache-first for app shell, with opportunistic fill for new resources.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    }),
  );
});
