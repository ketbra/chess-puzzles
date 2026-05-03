# Phase 4 Design: PWA / offline

**Date:** 2026-05-03
**Phase:** 4 of 6 (per `PROJECT.md`)
**Predecessors:**
- Phase 1 (`2026-04-30-phase1-core-puzzle-loop-design.md`) — shipped
- Phase 2 (`2026-05-03-phase2-real-puzzle-data-design.md`) — shipped
- Phase 3 (`2026-05-03-phase3-filters-stats-design.md`) — shipped

**Goal:** Make the app installable on Android and fully functional offline after the first online visit. Ship a hand-rolled service worker that caches the app shell, a web app manifest with proper icons, and an in-app install button driven by `beforeinstallprompt`.

This phase delivers the PWA infrastructure: service worker, manifest, icons, install UI. After it lands, a kid can tap "Install app" once, then play forever offline from a home-screen icon.

---

## Scope

### In scope

- **Service worker** at the served root (`/sw.js`):
  - Cache-first for the app shell.
  - Bypass for `/data/puzzles/*` (the loader handles freshness via `index.json` + sha256 + IDB).
  - `skipWaiting()` on install + `clients.claim()` on activate, so a new SW takes over on next reload.
  - Cache version bumped via a `SW_VERSION` constant; the activate handler purges old caches.
  - Opportunistic fill: any same-origin GET that wasn't precached (e.g., a future module) gets cached on first fetch, so the precache list stays minimal.
- **Web app manifest** (`/manifest.json`) with `name`, `short_name`, `start_url: "./"`, `scope: "./"`, `display: "standalone"`, `theme_color`, `background_color`, and the three icons.
- **Icons** generated programmatically:
  - Source: `icons/icon.svg` — committed, hand-written, stylized knight on warm background.
  - PNGs: `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png` — committed.
  - Build script: `scripts/generate-icons.mjs`, run via `npm run icons`. Uses `rsvg-convert` (preferred) or `magick` (fallback). The maskable variant has ~10% safe-zone padding so Android's circular masking doesn't crop the knight.
- **SW registration in `src/app.js`**: `navigator.serviceWorker.register('./sw.js', { scope: './' })`. Fire-and-forget; doesn't block startup. Logs registration result; non-fatal on failure (browser without SW support).
- **Install prompt UI** (`src/ui/install.js` + markup + CSS):
  - Captures `beforeinstallprompt`, prevents default, stashes the event.
  - Shows a small "Install app" button (top-right corner, fixed position) when the event fires.
  - Click → calls `prompt()`, awaits `userChoice`, dismisses the button after either outcome.
  - `appinstalled` event hides the button forever.
  - Hidden by default; only appears when the browser fires the event.
- **Relative-path discipline**: all SW caching, manifest, registration use `./` so the project works both at `localhost:8000/` (dev) and `https://<user>.github.io/chess-puzzles/` (GitHub Pages subpath, the chosen deployment target).
- **Tests**:
  - `tests/install.test.js` — pure-logic tests for `bindInstall` (event capture, click handling, hide on install).
  - `tests/manifest.test.js` — validates the manifest is valid JSON with required fields.
- **Manual test plan** for SW lifecycle, offline behavior, install flow, and standalone launch.

### Out of scope (deferred)

| Feature | Phase |
|---|---|
| Settings sheet (sound toggle, theme switcher, reset stats, coordinate labels) | 5 |
| Confetti, sound effects, reduced-motion handling | 5 |
| Adaptive difficulty, per-theme stats, profiles | 6 |
| iOS-specific install hint ("Tap Share → Add to Home Screen") | not planned (PROJECT.md non-goal: iOS not at parity) |
| Background data refresh / push notifications | not planned |
| Workbox or any SW framework | rejected (PROJECT.md: hand-rolled is fine) |
| Update toast / "App updated, reload?" UI | not needed — `skipWaiting` + `clients.claim` plus a normal user reload makes this implicit |

### File changes

| Action | Path | Notes |
|---|---|---|
| Create | `sw.js` | Service worker at served root |
| Create | `manifest.json` | Web app manifest at served root |
| Create | `icons/icon.svg` | Source SVG (committed) |
| Create | `icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Rasterized PNGs (committed) |
| Create | `scripts/generate-icons.mjs` | rsvg-convert/magick driver to build PNGs from SVG |
| Create | `src/ui/install.js` | beforeinstallprompt capture + button management |
| Create | `tests/install.test.js`, `tests/manifest.test.js` | Tests |
| Modify | `index.html` | `<link rel="manifest">`, `<meta name="theme-color">`, install-button markup |
| Modify | `src/ui/styles.css` | Style the install button |
| Modify | `src/app.js` | Register SW; call `bindInstall()` |
| Modify | `package.json` | Add `icons` script |
| Modify | `README.md` | Document deploy + offline-test flow |

### Dependencies (dev-time only)

- `rsvg-convert` (preferred) or ImageMagick (`magick`) for icon generation. Install via `dnf install librsvg2-tools` (Fedora) or `dnf install ImageMagick`.
- Production needs neither — the PNGs are committed.

---

## Service worker

### Caching strategy

| Resource | Strategy |
|---|---|
| App shell (HTML, CSS, JS, vendored libs, icons, manifest) | Cache-first with opportunistic fill |
| `/data/puzzles/*` (manifest, theme JSONs) | **Bypass entirely** — let the loader's IDB-backed flow handle freshness |
| Cross-origin requests | **Bypass entirely** |
| Non-GET requests | **Bypass entirely** |

Bypassing `/data/puzzles/*` in the SW prevents a dual-cache pitfall: if the SW served a stale `index.json` from its cache, the loader's `cache: 'no-cache'` would be defeated, and users would see stale puzzle data after a redeploy. The loader's IDB is the authoritative puzzle cache.

### Service worker source (target shape)

```js
// sw.js
const SW_VERSION = 'v1';
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
  if (url.pathname.includes('/data/puzzles/')) return;
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

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
```

### Update flow

1. User opens the app → browser fetches `/sw.js` and notices the file's bytes changed.
2. New SW enters `installing`. Its `install` handler precaches the new app shell, then `skipWaiting()`.
3. `activate` fires, old caches deleted, `clients.claim()` makes the new SW the controller.
4. Current page is still running old code; next reload (or new tab) gets the new bundle.

### Registration in `src/app.js`

```js
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[sw] registered, scope:', reg.scope);
  } catch (err) {
    console.warn('[sw] registration failed:', err);
  }
}

// Inside main(), before loadPuzzles:
registerServiceWorker();
```

Fire-and-forget: SW registration runs in parallel with the loader's first fetch. We don't await it; the SW only matters from the second visit onward (since the first visit can't intercept itself).

---

## Manifest, icons, install button

### Manifest

```json
{
  "name": "Chess Puzzles",
  "short_name": "Puzzles",
  "description": "Mate-in-1 chess puzzles for kids",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#1a1614",
  "theme_color": "#7a4a2b",
  "icons": [
    { "src": "icons/icon-192.png",          "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png",          "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Linked in `<head>` of `index.html`:

```html
<link rel="manifest" href="manifest.json" />
<meta name="theme-color" content="#7a4a2b" />
```

### Icons

A single source SVG (`icons/icon.svg`), 512×512 viewBox, painted with the warm palette. Design: stylized knight silhouette in cream (`#f0d9b5`) on a walnut (`#7a4a2b`) rounded-square background.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="80" fill="#7a4a2b" />
  <path d="..." fill="#f0d9b5" />  <!-- knight silhouette path -->
</svg>
```

The exact knight path is written during implementation. A simple, readable knight that holds up at 192×192 is the goal — not pixel-perfect chess art.

`scripts/generate-icons.mjs`:
- Read `icons/icon.svg`.
- Use `rsvg-convert -w 192 -h 192` → `icons/icon-192.png`.
- Use `rsvg-convert -w 512 -h 512` → `icons/icon-512.png`.
- For the maskable variant, wrap the SVG with extra ~10% margin (re-emit a new SVG with viewBox `-51 -51 614 614` or similar) and rasterize at 512 → `icons/icon-maskable-512.png`. This keeps the knight inside the safe zone after Android applies the circular mask.
- If `rsvg-convert` is missing, fall back to `magick convert -background none -resize NxN icons/icon.svg icons/icon-NNN.png`.
- Idempotent. Re-runnable.

Add to `package.json`:
```json
"scripts": {
  "icons": "node scripts/generate-icons.mjs"
}
```

### Install button (`src/ui/install.js`)

```js
let deferredPrompt = null;

export function bindInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideButton();
  });

  document.querySelector('#install-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    hideButton();
    console.log('[install]', outcome);
  });
}

function showButton() {
  const el = document.querySelector('#install-btn');
  if (el) el.hidden = false;
}

function hideButton() {
  const el = document.querySelector('#install-btn');
  if (el) el.hidden = true;
}
```

Markup added to `index.html` (inside `<body>`, before `<main>`):
```html
<button id="install-btn" type="button" class="install-btn" hidden>Install app</button>
```

CSS appended to `src/ui/styles.css`:
```css
.install-btn {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 100;
  min-height: 36px;
  padding: 6px 14px;
  font-size: 14px;
  border-radius: 999px;
  border: 2px solid #5a3a22;
  background: #f0d9b5;
  color: #2a201a;
  cursor: pointer;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.install-btn:hover {
  background: #ecdab9;
}
```

App.js wiring (after `bindActions()`):
```js
import { bindInstall } from './ui/install.js';

// inside main():
bindInstall();
```

---

## Tests

### `tests/install.test.js`

Three small tests using a JSDOM-like minimal DOM stub and `vi.fn()` for events. Verifies pure logic without needing a real `BeforeInstallPromptEvent`:

| Test | Verifies |
|---|---|
| Shows button when `beforeinstallprompt` fires | `#install-btn`'s `hidden` becomes `false` |
| Calls `prompt()` on click | Mock event's `prompt` fn was called once; `hidden` becomes `true` after `userChoice` resolves |
| Hides forever on `appinstalled` | `hidden` becomes `true` |

Run by Vitest in the existing Node test suite. Vitest's `happy-dom` or `jsdom` environment isn't currently configured; we'll use a minimal mock DOM via `vi.stubGlobal('document', { querySelector: ... })` and `vi.stubGlobal('window', new EventTarget())`. If that's awkward, switch the test environment to `jsdom` for this file via a `// @vitest-environment jsdom` directive at the top.

### `tests/manifest.test.js`

| Test | Verifies |
|---|---|
| `manifest.json` is valid JSON | `JSON.parse` succeeds |
| Required keys present | `name`, `short_name`, `start_url`, `scope`, `display`, `theme_color`, `background_color`, `icons` are all set |
| Icons array | Three entries, sizes 192/512/512, the maskable one has `purpose: "maskable"` |

### Service worker

The SW is **not unit-tested**. Rationale: it runs in a separate global where `self === ServiceWorkerGlobalScope`, not `window`. Running it under Vitest requires a custom test environment that stubs all of `caches`, `clients`, `self.skipWaiting`, etc. The leverage isn't there for ~70 LoC of straightforward logic. Manual exercise via DevTools is the correct method.

---

## Manual test plan

After unit tests pass:

1. **Fresh first visit (online).** `npm run dev`, open Chrome, DevTools → Application → Service Workers. Confirm `sw.js` is registered, status "activated and is running."
2. **Cache populated.** Application → Cache Storage → `chess-puzzles-v1` exists with all app-shell entries listed.
3. **Offline reload.** DevTools → Network → "Offline" → reload. App still loads; puzzles play normally (loader uses IDB).
4. **Skip waiting / new SW.** Edit `sw.js`, bump `SW_VERSION` to `'v2'`. Reload twice. First reload installs the new SW; second reload runs the new code. Old `chess-puzzles-v1` cache deleted.
5. **Install button (Chrome desktop).** Visit the app on Chrome. Wait a few seconds (Chrome decides when the site is "installable"). Install button appears top-right. Click it. Native install prompt appears. Accept → button disappears, app installs.
6. **Install button (Android Chrome).** Same as 5 on a real Android device or DevTools mobile emulation. The install creates a home-screen icon with our 192px image.
7. **Standalone mode.** Launch the installed app from home screen / app drawer. App opens without browser chrome. Stats / filters persist.
8. **Manifest validation.** DevTools → Application → Manifest. All fields populated. Icons preview correctly. No errors/warnings.
9. **Build pipeline regen still works.** `npm run build-puzzles` regenerates the data files; reload still serves the new data through the SW bypass.
10. **Icon regeneration.** `npm run icons` produces fresh PNGs from `icons/icon.svg`. The committed PNGs match what the script produces (no diff after re-run).

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run icons`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from clean clone.
- [ ] All unit tests pass. Approximate count: 94 prior + ~3 install + 2 manifest = ~99 total.
- [ ] `sw.js`, `manifest.json`, `icons/icon.svg`, all three `icons/icon-*.png` committed.
- [ ] First visit populates the SW cache with all app-shell entries.
- [ ] Offline reload after first visit serves the full app from cache; puzzles play.
- [ ] Bumping `SW_VERSION` and reloading purges old cache and runs new code.
- [ ] Install button appears on Chrome desktop / Android, prompts on click, hides after install.
- [ ] Manifest passes Chrome's Application → Manifest validation (no errors).
- [ ] No console errors in normal operation.

---

## Architecture trade-offs explicitly considered

- **`skipWaiting` + `clients.claim`**: prefer immediate update over the safer "wait for all tabs closed" default. For a kid app with no in-app navigation, the risk of mid-session inconsistency is essentially zero, and the upside (kids actually get bug fixes) is high.
- **Bypass `/data/puzzles/*` in SW**: avoids the dual-cache pitfall where SW serves stale JSON and IDB never gets refreshed. Loader's IDB layer is the authoritative offline cache for puzzles.
- **Hand-rolled SW vs. Workbox**: per PROJECT.md. The cache logic is simple enough that Workbox would be overkill (~70 LoC of `sw.js` versus ~500 KB of Workbox).
- **Relative paths everywhere** (`./` in manifest, scope, registration): so the project deploys to GitHub Pages subpath without a build-time path injection, while still working at `localhost:8000/`.
- **Programmatic icons via SVG + rsvg-convert**: keeps the source vector-pure and editable; PNG generation is reproducible. PNGs committed so deploy doesn't need rsvg.
- **Install button only when `beforeinstallprompt` fires**: cleaner than always-visible, and matches the spec's note that iOS install isn't a target (iOS users wouldn't see a non-functional button).
- **No SW unit tests**: leverage isn't there for ~70 LoC of straightforward cache logic; manual DevTools exercise is the established method.
- **No update toast**: `skipWaiting` plus normal user reload makes "App updated, reload?" UI unnecessary. The reload IS the update.
