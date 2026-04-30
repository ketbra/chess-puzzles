# Chess Puzzles PWA

A static, offline-first Progressive Web App that serves filtered Lichess puzzles to a child learner. Hosted on GitHub Pages, installable to Android home screen, fully functional offline after first load.

## Goals

- Serve curated chess puzzles (mate-in-1 emphasis, expanding by theme/difficulty) to a child user.
- Tilted, "3D-styled" 2D board that feels tactile and modern without the weight of a real 3D engine.
- Fully offline after first visit. No backend. No login. No telemetry.
- Hostable as static files on GitHub Pages.
- Filterable by puzzle theme and difficulty with kid-friendly UI (icons, big tap targets, no raw rating numbers).

## Non-goals

- Not building a chess engine or playing full games. Puzzle solving only.
- Not implementing Lichess sync, accounts, or social features.
- Not shipping the full 5M-puzzle Lichess database. Pre-filtered curated subset only.
- Not targeting iOS PWA install at parity (Android is primary).

## Target user

A child (mate-in-1 reading level — assume early grade school). UX must:

- Use icons over text where possible.
- Make taps forgiving (large hit targets, snap-to-square).
- Provide immediate, satisfying feedback (visual + optional sound) on correct/incorrect moves.
- Avoid surfacing raw Glicko ratings — translate to a 1–5 star difficulty scale.
- Avoid any external links, ads, or anything that could navigate away from the app.

## Tech stack

### Runtime

- **No build step required.** Plain HTML + ES modules + vanilla JS. Optional: Vite if module hot-reload becomes useful during dev — but the deployed artifact must be static files servable by GitHub Pages without server-side processing.
- **`chess.js`** (loaded as ES module from a CDN-pinned version, vendored into `/vendor/` for offline use) for move validation, legal-move generation, FEN parsing, checkmate detection.
- **`cm-chessboard`** for the board UI. Vendored into `/vendor/`. Apply CSS `transform: perspective(1000px) rotateX(15deg)` to its container for the tilted look. Use the `staunty` or `wikipedia` piece set bundled with the library.
- **No framework.** Vanilla JS with a small module structure. If state management gets gnarly, bring in `nanostores` or hand-roll a simple pub/sub. No React/Vue/Svelte.

### Data

- **SQLite via `sql.js`** OR **gzipped JSON**. Default to gzipped JSON for the pre-filtered subset — simpler, smaller wire size for ~10–20k puzzles, no sql.js wasm overhead. Reconsider SQLite only if puzzle count exceeds ~50k or if complex runtime queries become necessary.
- **IndexedDB** for persistent storage of puzzles + user progress (solved set, streak, current filter state, ratings if implementing adaptive difficulty).
- Use **`idb`** (Jake Archibald's promise wrapper) vendored into `/vendor/` for IndexedDB ergonomics.

### PWA infrastructure

- **Service worker** with cache-first strategy for app shell, stale-while-revalidate for puzzle data updates. Hand-rolled is fine — avoid Workbox unless the cache logic gets complex.
- **Web app manifest** with proper icons (192, 512, maskable) for Android install.
- **`beforeinstallprompt`** handling for an in-app install button on supported browsers.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     index.html                          │
│  Loads app.js as module, registers service worker       │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌─────────┐      ┌──────────┐      ┌──────────┐
   │  app.js │      │  sw.js   │      │ puzzles/ │
   │  (UI)   │      │ (cache)  │      │  *.json  │
   └─────────┘      └──────────┘      └──────────┘
        │
        ├── board.js       (cm-chessboard wrapper, tilt CSS)
        ├── puzzle.js      (puzzle loader, solve flow, validation)
        ├── store.js       (IndexedDB: progress + cached puzzles)
        ├── filters.js     (theme/difficulty filter state + UI)
        └── stats.js       (streak, solved count, session metrics)
```

### Data flow

1. **First visit (online):** Service worker installs and caches app shell. App fetches `puzzles/index.json` (manifest of available chunks), then fetches the chunks the user's filter requires. Puzzles are stored in IndexedDB.
2. **Subsequent visits:** Service worker serves app shell from cache. App reads puzzles from IndexedDB. Network not required.
3. **Updates:** App checks `puzzles/index.json` version field on launch when online; if newer, fetches deltas in background.

## Data pipeline

### Source

Lichess publishes their full puzzle database as a CSV at `https://database.lichess.org/lichess_db_puzzle.csv.zst` (Zstandard-compressed). Columns: `PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags`.

### Filtering

A Python script (`scripts/build_puzzles.py`) does a one-time prep:

1. Decompress CSV.
2. Filter to a curated theme/difficulty subset:
   - **Tier 1 (must include):** `mateIn1` rating ≤ 1200.
   - **Tier 2:** `mateIn2` rating ≤ 1400, `fork` rating ≤ 1300, `pin` rating ≤ 1300, `hangingPiece` rating ≤ 1200.
   - **Tier 3 (later):** `mateIn3`, `skewer`, `discoveredAttack`, `doubleCheck`, all rating ≤ 1500.
3. Sort by popularity within each theme, take top N (e.g., 2000 per theme as starting target).
4. Output one JSON file per theme: `data/puzzles/mateIn1.json`, `data/puzzles/fork.json`, etc.
5. Output `data/puzzles/index.json` listing themes, file paths, file sizes, puzzle counts, and a content hash for cache-busting.
6. Gzip the JSON files (GitHub Pages serves `.gz` with proper headers if configured, or use `.json` and rely on Pages' built-in gzip).

### Puzzle JSON schema

```json
{
  "version": "2026-04-30",
  "theme": "mateIn1",
  "puzzles": [
    {
      "id": "00sHx",
      "fen": "...",
      "moves": ["e2e4", "e7e5"],
      "rating": 854,
      "themes": ["mateIn1", "short"],
      "stars": 1
    }
  ]
}
```

`stars` is a 1–5 derivation from `rating` for kid-friendly difficulty UI:

- 1 star: rating < 800
- 2 stars: 800 ≤ rating < 1100
- 3 stars: 1100 ≤ rating < 1400
- 4 stars: 1400 ≤ rating < 1700
- 5 stars: rating ≥ 1700

### Lichess puzzle convention (important)

The first move in `Moves` is the **opponent's setup move**, played automatically when the puzzle loads. The user's first move is `Moves[1]`. For multi-move puzzles, opponent responses are at even indices and user moves at odd indices.

The puzzle solving loop must handle this: load FEN → animate opponent move at index 0 → wait for user move matching index 1 → if correct, animate opponent response at index 2 → continue until all user moves are made.

## Feature spec

### Puzzle solving flow

1. Board renders position from FEN with player's color at bottom.
2. After a 600ms delay, opponent's setup move animates.
3. Status bar shows "Your turn — find the best move" with player color indicator.
4. User taps source square (highlights it + shows legal-move dots), then destination square.
   - Tap-to-move primary; drag-to-move also supported via cm-chessboard defaults.
   - If user taps a different friendly piece while one is selected, switch selection.
5. On move attempt:
   - **Correct:** Brief green flash on destination square. If more moves remain, opponent's response animates after 400ms. If all user moves complete, success animation (confetti/star burst), increment solved counter and streak, after 1.5s load next puzzle.
   - **Incorrect:** Red shake animation on the board, move undoes. Show "Try again" message. Streak resets.
6. Hint button: highlights the source square of the next correct move (does not give the destination).
7. Skip button: marks puzzle as skipped (does not break streak negatively but does not advance solved count), loads next puzzle.

### Filter UI

- **Theme chips** (horizontal scrollable row): "All," "Mate in 1" (♔ icon), "Mate in 2," "Fork," "Pin," "Trap." Each chip shows count of puzzles matching current difficulty filter.
- **Difficulty stars** (1–5 stars, tappable): Sets max difficulty. Default to 2 stars on first launch. Visually grays out stars above the cap.
- Filter changes immediately reload puzzle pool and queue a new puzzle.

### Stats / progress

- **Solved count** (lifetime).
- **Current streak** (consecutive correct).
- **Best streak** (lifetime max).
- **Today's solved** (resets at local midnight).
- All persisted to IndexedDB.
- Optional: per-theme breakdowns on a "Stats" view (later phase).

### Settings (minimal)

- Sound on/off toggle.
- Reset stats button (with confirmation).
- Light/dark board theme.
- Show coordinate labels on/off.

## UI/UX requirements

### Visual

- **Board:** cm-chessboard with `staunty` piece set. Container has `transform: perspective(1000px) rotateX(15deg)` and a subtle `box-shadow` to suggest depth. Light/dark squares: warm cream and walnut by default. Optional cooler theme.
- **Pieces:** Use cm-chessboard's SVG sets — do not write custom SVGs unless the bundled options look wrong. Pieces should appear to float slightly above the tilted board (handled by the perspective transform).
- **Highlights:** Selected square has a soft yellow glow. Legal-move targets show small dots; capture targets show ring around the piece.
- **Animations:** cm-chessboard handles move animations. Add CSS transitions for filter chips, stars, and feedback states. Keep all animations under 400ms.
- **No emoji in production UI** — use SVG icons (Lucide, Phosphor, or hand-rolled).

### Layout

- Board fills width on mobile, max 480px on larger screens.
- Theme chips above board, difficulty stars below.
- Stats in a compact header.
- Hint and Skip buttons below board, equally sized, with thumb-friendly hit targets (≥48px).
- Settings via a gear icon in the corner opening a sheet from the bottom.

### Accessibility

- All interactive elements keyboard-navigable.
- Color is never the sole indicator of state (correct/incorrect have icons + text + color).
- Sufficient contrast in both board themes.
- Respect `prefers-reduced-motion` — disable shake and confetti, keep functional move animations.

## File structure

```
chess-puzzles/
├── PROJECT.md                  (this file)
├── README.md                   (user-facing project description)
├── index.html
├── manifest.json
├── sw.js
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
├── src/
│   ├── app.js                  (entry, wires modules together)
│   ├── board.js                (cm-chessboard wrapper)
│   ├── puzzle.js               (puzzle solve flow)
│   ├── store.js                (IndexedDB wrapper)
│   ├── filters.js              (filter state + UI)
│   ├── stats.js                (stats tracking)
│   └── ui/
│       ├── styles.css
│       ├── chips.js
│       ├── stars.js
│       └── feedback.js         (confetti, shake, sounds)
├── vendor/
│   ├── chess.js
│   ├── cm-chessboard/
│   └── idb.js
├── data/
│   └── puzzles/
│       ├── index.json
│       ├── mateIn1.json.gz
│       ├── mateIn2.json.gz
│       ├── fork.json.gz
│       └── pin.json.gz
├── scripts/
│   ├── build_puzzles.py        (filter Lichess CSV → JSON chunks)
│   └── verify_puzzles.py       (sanity check: each puzzle's solution actually mates / is legal)
└── tests/
    └── puzzle.test.js          (unit tests for solve flow logic)
```

## Implementation phases

### Phase 1: Core puzzle loop (online-only)

- [ ] Set up repo, basic `index.html`, vendored `chess.js` and `cm-chessboard`.
- [ ] Render a tilted board with a hardcoded FEN.
- [ ] Implement click-to-move with chess.js validation.
- [ ] Implement single-puzzle solve loop using a hardcoded array of 5 mate-in-1 puzzles.
- [ ] Wire correct/incorrect feedback (shake on wrong, advance on right).
- [ ] Add Hint and Skip buttons.

### Phase 2: Real puzzle data

- [ ] Write `scripts/build_puzzles.py` to filter Lichess CSV.
- [ ] Generate `data/puzzles/*.json` for mate-in-1 (target ~2000 puzzles, rating ≤ 1200).
- [ ] Implement IndexedDB store + initial fetch + cache.
- [ ] Wire puzzle loader to pull from store.

### Phase 3: Filters and stats

- [ ] Theme chips UI + filter state.
- [ ] Difficulty stars UI + filter state.
- [ ] Stats tracking (solved, streak, best streak, today).
- [ ] Persist filter preference and stats to IndexedDB.

### Phase 4: PWA / offline

- [ ] Write service worker (cache-first for shell, cache-first for puzzles).
- [ ] Web app manifest + icons.
- [ ] `beforeinstallprompt` handling for in-app install button.
- [ ] Test full offline flow (DevTools → offline mode after first load).

### Phase 5: Polish

- [ ] Settings sheet (sound, theme, reset, coords).
- [ ] Confetti / success animation on solve.
- [ ] Sound effects (optional, off by default).
- [ ] Reduced-motion support.
- [ ] Expand puzzle set: mate-in-2, fork, pin themes.

### Phase 6: Stretch

- [ ] Adaptive difficulty (track per-theme accuracy, auto-bump stars when 80%+ correct over last 20).
- [ ] Per-theme stats view.
- [ ] Daily streak tracking with calendar view.
- [ ] Multiple user profiles (one per kid).

## Testing

- **Unit tests** (Vitest or plain `node:test`) for `puzzle.js` solve-flow logic, filter logic, stats math.
- **Puzzle data validation** in `scripts/verify_puzzles.py`: load each puzzle into `python-chess`, confirm the FEN is legal, confirm `Moves[0]` is legal, confirm the final move in the sequence delivers checkmate (for mate-in-N themes), confirm intermediate moves are legal.
- **Manual test checklist** before each release: install on Android, full offline test (airplane mode after first load), all filters reload puzzle pool, stats persist across reloads, service worker updates correctly when new version deploys.

## Deployment

- GitHub repo with main branch.
- GitHub Pages enabled, source = main branch root (or `/docs`).
- Custom domain optional.
- Service worker scoped to repo root path (e.g., `/chess-puzzles/`) — make sure manifest `start_url` and `scope` reflect this. Hardcoding the path is fine; if it bothers you, generate `manifest.json` and `sw.js` from templates with the path injected at build time.
- Cache-bust puzzle JSON via the version field in `index.json`. App compares stored version to fetched version on launch and refreshes IndexedDB if changed.

## Open questions

- **Audio:** Bundle short sound effects (move, success, fail) or rely on synthesized Web Audio? Bundled is simpler; ~30KB total.
- **Piece set licensing:** Confirm the cm-chessboard piece sets being used are licensed compatibly with the project's license. Most are CC-BY or public domain but verify.
- **Multi-profile:** Worth doing in v1 if you have three kids? Possibly. Could be as simple as a profile picker on launch with name + emoji avatar, each with its own IndexedDB key namespace.

## Constraints / decisions log

- **Why no build step:** Static files are simpler to deploy, debug, and reason about. The app is small enough that ES modules + vanilla JS suffice. Reconsider only if module count exceeds ~30 or if a real framework becomes necessary.
- **Why not React Native or Flutter:** GitHub Pages hosting and zero-install browser access were preferred over native app distribution. PWA install on Android is a one-tap experience and the kid won't notice the difference.
- **Why pre-filtered JSON over the full SQLite database:** 10–20k curated puzzles is more than a child can solve in years and ships in a few MB. The full database is overkill and would take significantly longer to download on first visit.
- **Why cm-chessboard over a real 3D engine:** The CSS-tilted 2D board reads as "3D" to the target user, ships in <100KB, and avoids the runtime cost and code volume of Three.js.
