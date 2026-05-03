# Phase 2 Design: Real puzzle data

**Date:** 2026-05-03
**Phase:** 2 of 6 (per `PROJECT.md`)
**Predecessor:** `docs/superpowers/specs/2026-04-30-phase1-core-puzzle-loop-design.md` (Phase 1 shipped)

**Goal:** Replace the five hand-built mate-in-1 puzzles with ~2000 verified mate-in-1 puzzles drawn from the published Lichess puzzle database, persisted in IndexedDB, fetched once and cached forever (until the data set is deliberately refreshed). After this phase, the app needs network exactly once — the first time it runs.

This phase delivers two artifacts: a Node-based build pipeline (run by a developer to refresh the data set) and a runtime loader/store layer that fetches the published data on first launch, caches it locally, and on subsequent launches reads exclusively from the cache while opportunistically checking for newer data when online.

---

## Scope

### In scope

- `scripts/build-puzzles.mjs` — single Node ESM script. On `npm run build-puzzles`:
  - Downloads `https://database.lichess.org/lichess_db_puzzle.csv.zst` to `.cache/lichess_puzzles.csv.zst` if absent or `--refresh` is passed.
  - Decompresses via shell `zstd -d --keep` (skipped if the `.csv` is newer than the `.zst`).
  - Streams the CSV line-by-line, filters to mate-in-1 puzzles with rating ≤ 1200 and exactly two moves.
  - Verifies each candidate by replaying the move sequence through `chess.js` and asserting `isCheckmate()` after the user's move.
  - Sorts verified candidates by `Popularity` descending, takes the top 2000.
  - Transforms each into the runtime puzzle schema (id, fen, moves, rating, themes, stars).
  - Writes `data/puzzles/mateIn1.json` and `data/puzzles/index.json`.
  - Writes `data/puzzles/rejected.log` listing every dropped row with the drop reason.
  - Prints a summary report (rows scanned, dropped per reason, final count).
  - Exits non-zero with an error if fewer than 500 puzzles survive — a regression guard against Lichess schema changes.
- `data/puzzles/index.json` — committed manifest with version + theme metadata + sha256.
- `data/puzzles/mateIn1.json` — committed data file with the puzzles.
- `src/store.js` — thin promise-based wrapper over the vendored `idb` library. Two object stores: `meta` (versioning) and `puzzles` (id → puzzle).
- `src/loader.js` — orchestrates fetch + IDB. Single async function `loadPuzzles(theme, opts)`.
  - First launch: fetch index.json + theme JSON, sha256-verify, store in IDB.
  - Subsequent launches: read IDB; if online, version-check via index.json and refetch the theme file if newer.
  - Subsequent launches offline: fall back silently to cached data.
  - Reports download progress via an `onProgress(bytesLoaded, bytesTotal)` callback so the UI can render a progress bar.
- `src/app.js` — switches to `await loadPuzzles()`. Shows "Loading puzzles…" + a progress bar during first-launch fetch. Shows an error message if the fetch fails on a true cold start.
- A simple `<progress>` element in `index.html` styled to match the warm theme.
- Promotion puzzles are kept in the data set; the runtime auto-defaults to queen via cm-chessboard's standard input pipeline (no promotion dialog wired). Knight-underpromotion puzzles where the queen does not also mate will appear unsolvable to the user — accepted trade-off until a later phase adds a promotion dialog.
- Vendored `idb` library, added to `/vendor/` via the existing `scripts/vendor.mjs`.
- `fake-indexeddb` as a devDependency for unit-testing the store and loader in Node.

### Out of scope

| Feature | Phase |
|---|---|
| Theme chips, difficulty stars, multi-theme data | 3 |
| Service worker for app-shell offline + fetch caching | 4 |
| Settings, sounds, confetti, reduced-motion | 5 |
| Promotion-piece-choice dialog UI | future, on demand |
| Automatic refresh from Lichess (e.g., every quarter) | not planned; manual when desired |

### Phase 1 fallback removal

`src/puzzles-phase1.js` and `tests/puzzles-phase1.test.js` are deleted. After Phase 2, no puzzle data is hardcoded into the source. First-launch offline shows an error and instructs the user to retry online — Phase 4's service worker will eliminate that case.

---

## File changes

| Action | Path |
|---|---|
| Create | `scripts/build-puzzles.mjs` |
| Create | `data/puzzles/index.json`, `data/puzzles/mateIn1.json` |
| Create | `src/store.js`, `src/loader.js` |
| Create | `src/ui/progress.js` (small helper for the loading-bar element) |
| Create | `tests/store.test.js`, `tests/loader.test.js`, `tests/build-puzzles.test.js` |
| Modify | `package.json` (add `idb` dep, `fake-indexeddb` devDep, `build-puzzles` script) |
| Modify | `scripts/vendor.mjs` (vendor `idb` too) |
| Modify | `index.html` (import map gets `idb`; loading-bar markup) |
| Modify | `src/app.js` (use loader, render progress) |
| Modify | `.gitignore` (ignore `.cache/`) |
| Delete | `src/puzzles-phase1.js` |
| Delete | `tests/puzzles-phase1.test.js` |

---

## Build pipeline: `scripts/build-puzzles.mjs`

### Source data

Lichess publishes the puzzle database at `https://database.lichess.org/lichess_db_puzzle.csv.zst`. Columns:

`PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags`

`Moves` is a space-separated UCI string (e.g., `"e2e4 e7e5 g1f3"`). `Themes` is a space-separated tag list. The first move is the opponent's setup; the user starts at index 1 (Lichess convention).

### Flow

1. **Resolve cache.** If `.cache/lichess_puzzles.csv.zst` is missing or `--refresh` is passed, download it via streamed HTTPS GET.
2. **Decompress.** Spawn `zstd -d --keep .cache/lichess_puzzles.csv.zst -o .cache/lichess_puzzles.csv`. Skip if the `.csv` is newer than the `.zst`. Fails fast if `zstd` is not on PATH (a developer with the project should have it; document in README).
3. **Parse + filter (streaming).** Read line-by-line via `node:readline`. Skip header. For each row:
   - Split by `,`.
   - Reject if `Themes` doesn't include `mateIn1`.
   - Reject if `Rating > 1200`.
   - Reject if `Moves` split-by-space length ≠ 2.
   - Otherwise emit a candidate row object.
4. **Verify.** For each candidate:
   - `new Chess(row.fen)` — catch and reject on throw.
   - Apply `moves[0]` via `chess.move({from, to, promotion?})`. Reject on throw.
   - Apply `moves[1]`. Reject on throw.
   - Reject if `chess.isCheckmate()` is `false`.
5. **Sort + cap.** Sort verified candidates by `row.popularity` descending. Take the top 2000.
6. **Transform.** For each kept candidate, produce:
   ```json
   {
     "id": "00sHx",
     "fen": "...",
     "moves": ["...", "..."],
     "rating": 854,
     "themes": ["mateIn1", "short"],
     "stars": 1
   }
   ```
   Star rule (per `PROJECT.md`): `<800 → 1`, `800–1099 → 2`, `1100–1399 → 3`, `1400–1699 → 4`, `≥1700 → 5`. Themes are split on space.
7. **Write outputs.**
   - `data/puzzles/mateIn1.json` — `{ "version": "2026-05-03", "theme": "mateIn1", "puzzles": [...] }`.
   - `data/puzzles/index.json`:
     ```json
     {
       "version": "2026-05-03",
       "generatedAt": "2026-05-03T...Z",
       "themes": [
         { "name": "mateIn1", "file": "mateIn1.json", "count": 2000, "sha256": "<hex>" }
       ]
     }
     ```
     `version` is the `YYYY-MM-DD` of the build day. `sha256` is the SHA-256 of the full theme-file bytes.
   - `data/puzzles/rejected.log` — one line per dropped row, format `<puzzleId>\t<reason>\t<details>`. Reasons: `non-mateIn1-theme`, `rating-too-high`, `wrong-move-count`, `bad-fen`, `illegal-setup`, `illegal-user-move`, `not-mate`, `over-cap`. Used for auditing data set health.
8. **Report.** Print to stdout: rows scanned, kept after filter, kept after verify, kept after cap, plus a histogram of rejection reasons. Exits non-zero with `Error: only N verified puzzles, expected ≥ 500` if the verified count drops below the floor.

### Pure functions to test in `tests/build-puzzles.test.js`

| Function | Tests |
|---|---|
| `parseLichessRow(line)` | column extraction, `Themes` space-split, numeric coercion, well-known fixed example |
| `passesFilter(row)` | accept mateIn1 ≤1200 with 2 moves; reject other themes; reject rating>1200; reject move-count!=2 |
| `verifyPuzzle(candidate)` | accept hand-built valid mate-in-1 (reuse the synthetic fixture from Phase 1); reject broken FEN; reject when `moves[1]` doesn't mate |
| `ratingToStars(rating)` | exact mapping for boundary values 700, 799, 800, 1099, 1100, 1399, 1400, 1699, 1700, 2000 |
| `transformPuzzle(row)` | round-trip from CSV row to runtime schema |

Download / decompress / file I/O are integration concerns. Not unit-tested. The build script is itself driven manually by a developer; if it fails, the next thing the developer sees is the error.

---

## Runtime: `src/store.js`

### IDB schema

Database `chess-puzzles`, version 1.

| Object store | Key path | Notes |
|---|---|---|
| `meta` | `key` (string) | rows shaped `{ key, value }`. Holds `{key:'version', value:<string>}` and `{key:'lastFetch', value:<msSinceEpoch>}`. |
| `puzzles` | `id` | the full puzzle object as the value. |

### Public API

```js
new Store({ idb? } = {})       // idb defaults to globalThis.indexedDB; tests inject fake-indexeddb
await store.open()             // opens or creates DB; returns this
await store.close()
await store.getVersion()       // → string | undefined
await store.setVersion(v)
await store.getLastFetch()     // → number | undefined
await store.setLastFetch(ms)
await store.getAllPuzzles()    // → Puzzle[]
await store.replacePuzzles(theme, puzzles)
  // Single transaction: clear puzzles store, insert all entries from `puzzles`.
  // For Phase 2 (single theme), `theme` parameter is ignored beyond logging;
  // it exists for forward-compat with multi-theme storage in Phase 3.
```

### Why not abstract individual transactions

The store layer's job is to give the loader two clean operations: "give me everything" and "replace everything atomically." Anything finer-grained would couple consumers to IDB semantics. We can refactor when Phase 3 needs partial updates (per-theme).

---

## Runtime: `src/loader.js`

### Public API

```js
import { loadPuzzles } from './loader.js';

const puzzles = await loadPuzzles('mateIn1', {
  fetch:           globalThis.fetch,         // DI for tests
  store:           someOpenedStore,          // DI for tests; defaults to a freshly opened Store inside loader
  fetchTimeoutMs:  5000,                     // default 5000
  onProgress:      (loaded, total) => { ... }, // optional UI callback
});
```

The defaults are resolved inside the function body (not in the parameter list, since `await new Store().open()` cannot live as a default expression). Production callers pass only `onProgress`; tests pass `fetch` and `store`.

Returns the active puzzle array. Throws `LoaderError('first launch requires network')` on a true cold-start failure (no IDB data + no working fetch). Other failures degrade gracefully to cached data.

### Flow

```
       ┌──────────────────────────┐
       │  Read IDB:               │
       │   • cachedPuzzles[]      │
       │   • localVersion         │
       └────────────┬─────────────┘
                    │
       ┌────────────▼────────────────────────────┐
       │  Fetch /data/puzzles/index.json         │
       │   (AbortController timeout)             │
       └────────────┬────────────────────────────┘
                    │
        ┌───────────┴───────────────┐
        │                           │
        │ success                   │ failure (network / non-2xx / timeout)
        ▼                           ▼
 ┌──────────────────────┐   ┌──────────────────────────┐
 │ remote.version ===   │   │  cachedPuzzles.length>0? │
 │   localVersion?      │   ├──────────┬───────────────┤
 ├──────┬───────────────┤   │ yes      │ no            │
 │ yes  │ no            │   │ return   │ throw         │
 │      │               │   │ cached   │ LoaderError   │
 ▼      ▼               │   └──────────┴───────────────┘
 use    fetch theme JSON│
 cached + sha256-verify │
        + replace IDB   │
        + return new    │
                        │
        on fetch/verify │
        failure → keep  │
        cached, log warn│
        └───────────────┘
```

### sha256 verification

After the theme-JSON body is fully read (streaming, with progress reporting), compute its SHA-256 via `crypto.subtle.digest('SHA-256', bytes)` and compare to `index.themes[].sha256` (hex-equality, case-insensitive). On mismatch, log a console warning, **do not** mutate IDB, and fall back to cached data if available. This guards against truncated downloads and indirectly against tampered or stale CDN entries; the audit trail is good even if the threat model is mild.

### Streaming + progress

The theme-JSON fetch reads the response body as a `ReadableStream` rather than via `response.json()`. Implementation:

```js
const response = await fetch(themeUrl, { signal });
const total = Number(response.headers.get('Content-Length')) || 0;
const reader = response.body.getReader();
const chunks = [];
let loaded = 0;
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  chunks.push(value);
  loaded += value.byteLength;
  if (onProgress) onProgress(loaded, total);
}
const bytes = new Uint8Array(loaded);
let offset = 0;
for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }

const hash = await crypto.subtle.digest('SHA-256', bytes);
const sha256Hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');

const text = new TextDecoder().decode(bytes);
const parsed = JSON.parse(text);
```

This gives both the bytes (for sha256) and the text (for parsing) without re-fetching.

### Test plan: `tests/loader.test.js`

Loader is tested with `fake-indexeddb` (real IDB-compatible) and a mocked `fetch`. Each test instantiates a fresh `Store` over a fresh `fake-indexeddb` factory.

| Scenario | Mock fetch behavior | Expected |
|---|---|---|
| Empty IDB, fetch returns valid index + theme | both 200, valid sha256 | puzzles loaded, IDB populated, `version` set |
| IDB has v1, fetch returns v1 | index.json 200 with same version | no theme-JSON fetch; cached puzzles returned |
| IDB has v1, fetch returns v2 | index v2, theme 200 with matching sha256 | theme fetched, IDB replaced, new version stored |
| IDB has v1, fetch fails (network) | both reject | cached puzzles returned, no error |
| Empty IDB, fetch fails | both reject | throws LoaderError |
| IDB has v1, fetch returns v2 with bad sha256 | theme bytes don't match sha256 | warning logged, IDB unchanged, cached returned |
| Fetch times out | reject after timeoutMs | treated as offline (cached return or LoaderError per state) |
| Progress callback fires during fetch | streamed body | onProgress called with monotonic loaded values |

### Test plan: `tests/store.test.js`

| Test | Verifies |
|---|---|
| open creates expected stores | DB has `meta` and `puzzles` after `open()` |
| version round-trip | `setVersion` then `getVersion` returns the same string |
| `getAllPuzzles` empty | returns `[]` on a fresh DB |
| `replacePuzzles` writes all entries | inserting 3 puzzles, `getAllPuzzles` returns 3 |
| `replacePuzzles` is replacing, not appending | second call wipes the first batch |
| close + re-open preserves data | persistence sanity |
| concurrent open of two Store instances | both succeed without deadlock or schema drift |

---

## App wiring: `src/app.js` changes

```js
import { loadPuzzles } from './loader.js';
import { setProgress, hideProgress } from './ui/progress.js';

let puzzles = [];

async function main() {
  setStatus('Loading puzzles…');
  board = new Board('#board', { onUserMove: handleUserMove });
  bindActions();
  try {
    puzzles = await loadPuzzles('mateIn1', {
      onProgress: (loaded, total) => setProgress(loaded, total),
    });
  } catch (e) {
    console.error(e);
    setStatus('Need internet on first run. Reload when online.');
    hideProgress();
    return;
  }
  hideProgress();
  await loadNextPuzzle();
}
```

`loadNextPuzzle()` uses `puzzles[queueIndex % puzzles.length]` instead of the static import. Everything else in `app.js` is unchanged.

### Progress UI: `src/ui/progress.js` + index.html

Markup:

```html
<progress id="loading-progress" class="loading-progress" max="100" value="0"></progress>
```

Hidden by default (`display: none`). Revealed when `setProgress` is first called.

```js
// src/ui/progress.js
export function setProgress(loaded, total) {
  const el = document.querySelector('#loading-progress');
  if (!el) return;
  el.style.display = '';
  if (total > 0) {
    el.value = Math.round((loaded / total) * 100);
  } else {
    el.removeAttribute('value'); // indeterminate state
  }
}
export function hideProgress() {
  const el = document.querySelector('#loading-progress');
  if (el) el.style.display = 'none';
}
```

The `loading-progress` element is styled in `styles.css` to match the warm palette (cream fill, walnut frame). Visual nicety, not load-bearing.

---

## Manual test plan

After all unit tests pass, run end-to-end:

1. `rm -rf .cache && npm run build-puzzles` — downloads CSV, decompresses, builds. Inspect `data/puzzles/mateIn1.json` (expect ~2000 entries) and `data/puzzles/rejected.log` (expect mostly `non-mateIn1-theme` and `rating-too-high`).
2. `git status` — confirm only `data/puzzles/*.json` changed (not the cache).
3. `npm test` — all unit tests pass.
4. `npm run dev` — open `http://localhost:8000`. First launch flow:
   a. "Loading puzzles…" status appears.
   b. Progress bar visible and advancing.
   c. After fetch, status changes to "Find the best move for white." (or black) and a real Lichess puzzle appears.
   d. Solve a few puzzles; confirm cycling works.
5. Reload the page. Second launch flow:
   a. Brief "Loading puzzles…" then immediately the first puzzle (no progress bar visible because index.json is small and version matches).
6. Disable network in DevTools. Reload.
   a. Same as step 5 — cached data, no error.
7. Clear IDB via DevTools → Application → Storage. Disable network. Reload.
   a. Status changes to "Need internet on first run. Reload when online."
8. Re-enable network. Reload.
   a. Recovers — fetches fresh, puzzles load.
9. Manually edit `data/puzzles/mateIn1.json` (e.g., truncate it) without updating sha256 in `index.json`. Bump `index.json` version to force a refetch. Reload.
   a. Console warning about sha256 mismatch; cached puzzles continue to be used (no crash). Verify by inspecting IDB — the bad data did not replace the good.

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from a clean clone (modulo `.cache/` being recreated).
- [ ] All unit tests pass (current suite + ~15-20 new tests across store/loader/build).
- [ ] `data/puzzles/mateIn1.json` and `data/puzzles/index.json` are committed and have the current build's content + sha256.
- [ ] Manual test plan checklist passes on desktop Chrome.
- [ ] First-launch online produces a working puzzle session.
- [ ] First-launch offline produces a clear, non-scary error.
- [ ] Subsequent launches work without network.
- [ ] No console errors during normal operation.

---

## Architecture trade-offs explicitly considered

- **Node vs. Python build script.** Node chosen because `chess.js` is already vendored and reusable for verification, and the rest of the dev stack is Node. Python would have been smaller in terms of CSV/zstd ergonomics but introduces a second dependency stack.
- **Auto-default to queen vs. promotion dialog.** Auto-queen chosen. Most mate-in-1 promotions resolve as queen; rare knight-underpromotion cases will simply appear unsolvable. Adding a dialog is real UI work that doesn't belong in a data-pipeline phase.
- **First-launch offline: error vs. fallback.** Error chosen. Phase 4's service worker eliminates this case entirely once it ships. A baked-in fallback would be code that exists only to be removed in three weeks.
- **Sha256 vs. no sha256.** Kept. Costs 20 LoC and ~1ms per refresh. Truncated downloads silently corrupt a kid's app — the engineering cost of detection is rounding-error.
- **Streaming progress vs. blocking fetch.** Streaming. The data file is small enough that it doesn't matter on a fast connection, but visible progress matters on phone tethering.
- **DI in store/loader vs. global mocking.** DI. `fake-indexeddb` is happy with a constructor-injected factory and the test code is straightforward. Global mocking with `vi.mock` works but is more fragile.
- **Per-theme storage vs. single-blob storage.** Per-theme via the `puzzles` object store, prepared for Phase 3's multi-theme world even though we only have one theme today. The `replacePuzzles(theme, ...)` API has the right shape; the implementation can ignore the parameter for Phase 2.
