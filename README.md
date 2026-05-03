# Chess Puzzles

Static, offline-first PWA serving filtered Lichess puzzles to a child user. See `PROJECT.md` for the full charter and `docs/superpowers/specs/` for phase-level designs.

This repository ships Phases 1–4: tilted-free board, real Lichess data across five themes, IndexedDB persistence, theme + difficulty filters, lifetime + daily stats, service worker for offline use, and an Android-installable PWA.

## Quick start

```sh
npm install            # install dev dependencies
npm run vendor         # populate /vendor/ from node_modules
npm run icons          # rasterize icon SVGs to PNGs (one-time)
npm run dev            # serve on http://localhost:8000
```

In another terminal:

```sh
npm test               # run vitest suite
npm run test:watch     # vitest in watch mode
```

## Project layout

- `index.html` — page shell with manifest link + theme-color meta
- `manifest.json` — web app manifest
- `sw.js` — service worker (cache-first app shell, bypass for /data/puzzles)
- `icons/` — source SVGs + committed PNGs (192/512/maskable-512)
- `src/app.js` — entry: SW registration, install button, puzzle queue, UI wiring
- `src/puzzle.js` — pure-logic state machine for the solve flow (TDD'd)
- `src/board.js` — cm-chessboard wrapper
- `src/uci.js` — UCI ↔ {from,to,promotion} helpers
- `src/loader.js` — fetch + sha256-verify + atomic IDB replace, all 5 themes
- `src/store.js` — IndexedDB wrapper
- `src/stats.js` — solved/streak/best/today with midnight rollover
- `src/filters.js` — theme + maxStars + shuffle/cycle pool
- `src/ui/` — render helpers (header, chips, stars, feedback, progress, install) + CSS
- `vendor/` — committed copies of `chess.js`, `cm-chessboard`, `idb`
- `data/puzzles/` — generated puzzle JSON files + index.json manifest
- `tests/` — Vitest unit tests
- `scripts/` — vendor.mjs, build-puzzles.mjs, generate-icons.mjs

## Updating vendored libraries

```sh
npm update
npm run vendor
git add vendor/ package.json package-lock.json
git commit -m "Update vendored libraries"
```

## Regenerating puzzle data

```sh
npm run build-puzzles            # uses cached CSV if present
npm run build-puzzles -- --refresh   # forces re-download from Lichess
```

Output: `data/puzzles/{index,mateIn1,mateIn2,fork,pin,hangingPiece}.json` plus a (gitignored) `rejected.log` for auditing.

## Regenerating icons

After editing `icons/icon.svg` or `icons/icon-maskable.svg`:

```sh
npm run icons
git add icons/
git commit -m "Regenerate icons"
```

Requires `rsvg-convert` (`dnf install -y librsvg2-tools` on Fedora) or ImageMagick.

## Offline test

After running `npm run dev` and visiting `http://localhost:8000` once:

1. Chrome DevTools → Application → Service Workers — confirm `sw.js` is "activated and is running".
2. Network tab → check "Offline".
3. Reload. The app loads from cache; puzzles play normally (data comes from IndexedDB).

## Installing the PWA

When you visit the app on Chrome (desktop or Android), wait a few seconds for the browser to register it as installable. An "Install app" button appears in the top-right. Click → native install prompt → app installs to home screen / app drawer with the chess-knight icon.

## Deploy to GitHub Pages

The project uses relative paths (`./`) throughout, so it works at any subpath. To deploy:

1. Push to a public GitHub repo.
2. Settings → Pages → source = `main` branch, path = `/` (root).
3. Visit `https://<username>.github.io/<repo>/`.

The first visit is online (fetches puzzle data + populates SW cache). Every subsequent visit works offline.

## Phase plan

This repository ships **Phases 1–4 of 6**. See `PROJECT.md` for the full plan and `docs/superpowers/specs/` for individual phase designs.
