# Chess Puzzles

Static, offline-first PWA serving filtered Lichess mate-in-1 puzzles to a child user. See `PROJECT.md` for the full charter and `docs/superpowers/specs/` for phase-level designs.

This repository is the Phase 1 deliverable: a working puzzle-solving loop over five hardcoded mate-in-1s, with a tilted "3D-styled" 2D board.

## Quick start

```sh
npm install            # install dev dependencies
npm run vendor         # populate /vendor/ from node_modules
npm run dev            # serve on http://localhost:8000
```

In another terminal:

```sh
npm test               # run vitest suite
npm run test:watch     # vitest in watch mode
```

## Project layout

- `index.html` — page shell, declares the import map
- `src/app.js` — entry point; orchestrates the puzzle queue and UI
- `src/puzzle.js` — pure-logic state machine for the solve flow (TDD'd)
- `src/board.js` — cm-chessboard wrapper
- `src/uci.js` — UCI ↔ {from,to,promotion} helpers
- `src/puzzles-phase1.js` — the 5 hardcoded mate-in-1 puzzles
- `src/ui/` — stylesheet and DOM-feedback helpers
- `vendor/` — committed copies of `chess.js` and `cm-chessboard`
- `tests/` — Vitest unit tests
- `scripts/vendor.mjs` — copies `node_modules/{chess.js,cm-chessboard}` into `vendor/`

## Updating vendored libraries

```sh
npm update
npm run vendor
git add vendor/ package.json package-lock.json
git commit -m "Update vendored libraries"
```

## Phase plan

This is **Phase 1 of 6**. See `PROJECT.md` for the full phase plan and `docs/superpowers/specs/` for individual phase designs.
