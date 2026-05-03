# Phase 3 Design: Filters and stats

**Date:** 2026-05-03
**Phase:** 3 of 6 (per `PROJECT.md`)
**Predecessors:**
- `docs/superpowers/specs/2026-04-30-phase1-core-puzzle-loop-design.md` (Phase 1 shipped)
- `docs/superpowers/specs/2026-05-03-phase2-real-puzzle-data-design.md` (Phase 2 shipped)

**Goal:** Move from a single-theme demo (mate-in-1 only) to a feature-complete kid-side puzzle app with five themes, a difficulty cap, real-time stats, and persistence. After this phase, the kid sees their progress (lifetime solved, current streak, best streak, today's count), can choose what kind of puzzle to focus on, and can dial difficulty up or down.

This phase delivers three things in one cohesive package: an extended build pipeline that produces five theme files, runtime modules for stats and filters with IndexedDB persistence, and the layout/UI components needed to expose them.

---

## Scope

### In scope

**Data pipeline extension.**

- `scripts/build-puzzles.mjs` produces five theme files instead of one: `mateIn1` (≤1200), `mateIn2` (≤1400), `fork` (≤1300), `pin` (≤1300), `hangingPiece` (≤1200).
- 2000 verified puzzles per theme, ~10K total, ~2 MB combined. Per-theme floor for the regression guard: 250 (lower than mateIn1's 500 since tactical themes are rarer at low ratings).
- Verification is theme-aware:
  - **Mate themes** (`mateIn1`, `mateIn2`): assert `chess.isCheckmate()` after the last move.
  - **Tactical themes** (`fork`, `pin`, `hangingPiece`): assert all moves are legal. Lichess's classifier is the source of truth for "this is a fork/pin/hanging-piece tactic"; we don't re-derive that.
- Move count rules:
  - `mateIn1`: exactly 2 (opp setup + user mate).
  - `mateIn2`: exactly 4 (opp + user + opp + user mate).
  - `fork`/`pin`/`hangingPiece`: ≥ 2.
- A single Lichess row may qualify for multiple themes (e.g., a row tagged `["mateIn1","short"]` qualifies for `mateIn1`). Each theme's output is sorted and capped independently, so the same puzzle can appear in multiple theme files. The runtime de-dupes the union by puzzle id at load time.
- `index.json` lists all five themes with per-file `sha256`.

**Runtime — multi-theme loader.**

- `loadPuzzles()` (no theme arg) eagerly fetches all five theme files on first launch (~2 MB total, one-time) and caches the union in IndexedDB. Filter changes happen in-memory; no further network.
- Returns the de-duplicated union of all puzzles. The app layer filters.
- **Atomic multi-theme replace.** All five theme JSONs are buffered in memory and sha256-verified before any write to IDB. If any single fetch or sha256 check fails, no IDB content is replaced. Cached state from a previous launch is preserved.

**Stats module.**

- Tracks: lifetime `solved`, current `streak`, `bestStreak`, `todayCount` (resets at local midnight via stored `todayDate`).
- Streak semantics:
  - Increments only on a clean solve (no wrong moves on this puzzle).
  - Resets on the **first** wrong move per puzzle. Subsequent wrong moves on the same puzzle do not change anything (the taint flag is sticky until the next puzzle).
  - Skip and Show leave streak unchanged.
- Lifetime `solved` and `todayCount` increment on any successful solve, including ones with prior wrong moves. Skip/Show do NOT increment.
- Persisted to IDB `meta` store on every change.
- `todayDate` stored as `'YYYY-MM-DD'` in **local time**. On a stat update, if `todayDate !== todayKey()`, `todayCount` resets to 0 before incrementing.

**Filter module.**

- Owns `theme` (`'all' | 'mateIn1' | 'mateIn2' | 'fork' | 'pin' | 'hangingPiece'`) and `maxStars` (1–5, default 2).
- Filter changes trigger pool rebuild + new puzzle. Persisted to IDB `meta`.
- Pool building: filter the union by theme (or all), then by `stars ≤ maxStars`, then shuffle once. Cycle through; re-shuffle on cycle wrap.
- `counts()` returns per-theme puzzle counts under the current `maxStars` cap, used by chip labels (so chip text updates when difficulty changes).
- Empty pool: `next()` returns null; the app shows "No puzzles match — try a higher difficulty" and disables Hint/Show/Skip until the filter changes.

**UI components.**

- Stats header: `✓ <solved>   ⚡ <streak>   ★ <bestStreak>   Today <todayCount>`. Plain text, small, single line.
- Theme chips: horizontally scrollable bar above the board. Chips: `[All] [Mate 1] [Mate 2] [Fork] [Pin] [Hanging]`. Each chip shows the count of matching puzzles under the current difficulty cap. Active chip is highlighted.
- Difficulty stars: 5 stars below the board. The first `cap` are filled (★); the rest are hollow (☆). Tapping star N sets the cap to N.
- Status text moves below the stars (was above the board in Phase 1).
- Action buttons (Hint / Show / Skip) stay at the bottom.

**Visual cleanup.**

- Remove the board's CSS perspective tilt entirely. The `rotateX(15deg)` doesn't read as 3D and feels like a skewed plane.
  - Delete `perspective` and `perspective-origin` from `.board-stage`.
  - Delete `transform: rotateX(15deg)` from `.board-stage > *`.
  - Update the `shake-incorrect` keyframes to use plain `translateX` (no rotateX).
  - Keep `filter: drop-shadow(...)` for some sense of depth.

**Persistence keys** (added to IDB `meta` store):

| Key | Type | Purpose |
|---|---|---|
| `solved` | number | Lifetime puzzles solved |
| `streak` | number | Current streak |
| `bestStreak` | number | Best streak ever |
| `todayCount` | number | Solved today |
| `todayDate` | string `YYYY-MM-DD` | Local date last `todayCount` was bumped |
| `filterTheme` | string | One of `'all'`, `'mateIn1'`, `'mateIn2'`, `'fork'`, `'pin'`, `'hangingPiece'` |
| `filterMaxStars` | number | 1–5 |

The existing `version` and `lastFetch` keys are preserved.

### Out of scope (deferred)

| Feature | Phase |
|---|---|
| Service worker / offline app shell / install prompt | 4 |
| Settings sheet (sound toggle, theme switcher, reset stats, coordinate labels toggle) | 5 |
| Confetti, sound effects, reduced-motion handling | 5 |
| Adaptive difficulty (auto-bump stars when 80%+ correct over last 20) | 6 |
| Per-theme stats breakdown view | 6 |
| Multi-profile (per kid) | 6 |
| Promotion-piece-choice dialog | future, on demand |

---

## File changes

| Action | Path | Notes |
|---|---|---|
| Modify | `scripts/build-puzzles.mjs` | Per-theme rules table; theme-aware filter and verify; loop over 5 themes; emit 5 JSON files |
| Modify | `tests/build-puzzles.test.js` | Multi-theme tests; mate-vs-tactical verify branches; cross-theme dedup |
| Regenerate | `data/puzzles/index.json` | 5 theme entries with sha256 |
| Generate | `data/puzzles/{mateIn2,fork,pin,hangingPiece}.json` | New theme files (added to git) |
| Modify | `src/loader.js` | Eager multi-theme fetch + sha256 + atomic IDB replace |
| Modify | `tests/loader.test.js` | Multi-theme manifest tests; partial-failure atomicity |
| Create | `src/stats.js` | `Stats` class with state machine + IDB sync |
| Create | `tests/stats.test.js` | All 5 stats edge cases |
| Create | `src/filters.js` | `Filters` class with pool building + persistence |
| Create | `tests/filters.test.js` | Filter rebuild, counts, shuffle/cycle, empty pool |
| Create | `src/ui/header.js` | Stats header renderer |
| Create | `src/ui/chips.js` | Theme chips renderer + click delegation |
| Create | `src/ui/stars.js` | Difficulty stars renderer |
| Modify | `src/app.js` | Wire stats + filters; new `loadNextPuzzle` over `filters.next()`; integrate handlers |
| Modify | `index.html` | Stats header div, theme-chips bar, difficulty-stars bar, layout reorder |
| Modify | `src/ui/styles.css` | Add chip/star styles; remove tilt; relayout to new order; add stats header styling |
| Modify | `src/store.js` | (Verify the existing `setMeta`/`getMeta` API handles the new keys; no schema changes needed since `meta` store is key-value) |

---

## Build pipeline extension

### Theme rules

```js
// Defined as a constant in scripts/build-puzzles.mjs.
const THEME_RULES = {
  mateIn1:      { maxRating: 1200, exactMoves: 2, requiresMate: true,  cap: 2000, floor: 500 },
  mateIn2:      { maxRating: 1400, exactMoves: 4, requiresMate: true,  cap: 2000, floor: 250 },
  fork:         { maxRating: 1300, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
  pin:          { maxRating: 1300, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
  hangingPiece: { maxRating: 1200, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
};
```

### Refactored helpers

```js
export function passesFilter(row, themeName, rules) {
  const rule = rules[themeName];
  if (!rule) return false;
  if (!row.themes.includes(themeName)) return false;
  if (row.rating > rule.maxRating) return false;
  if (rule.exactMoves != null && row.movesArr.length !== rule.exactMoves) return false;
  if (rule.minMoves != null && row.movesArr.length < rule.minMoves) return false;
  return true;
}

export function verifyPuzzle(row, themeName, rules) {
  const rule = rules[themeName];
  let chess;
  try { chess = new Chess(row.fen); }
  catch (e) { return { ok: false, reason: 'bad-fen', detail: e.message }; }

  for (let i = 0; i < row.movesArr.length; i++) {
    try {
      const m = parseUci(row.movesArr[i]);
      const result = chess.move(m);
      if (!result) {
        return { ok: false, reason: i === 0 ? 'illegal-setup' : 'illegal-move',
                 detail: `at move ${i}: ${row.movesArr[i]}` };
      }
    } catch (e) {
      return { ok: false, reason: i === 0 ? 'illegal-setup' : 'illegal-move',
               detail: `at move ${i}: ${e.message}` };
    }
  }

  if (rule.requiresMate && !chess.isCheckmate()) {
    return { ok: false, reason: 'not-mate' };
  }
  return { ok: true };
}
```

### Orchestration

The single-pass scan classifies each row against all five rules. A row that qualifies for two themes is added to both candidate buckets (it appears once per theme). Per-theme buckets are sorted by `popularity` desc, capped, and emitted as separate JSON files. The build report prints a per-theme histogram. The floor guard runs per theme; if any falls below, the script exits non-zero.

### Updated `index.json` shape

```json
{
  "version": "2026-05-XX",
  "generatedAt": "2026-05-XXTxx:xx:xxZ",
  "themes": [
    {"name": "mateIn1",      "file": "mateIn1.json",      "count": 2000, "sha256": "..."},
    {"name": "mateIn2",      "file": "mateIn2.json",      "count": 2000, "sha256": "..."},
    {"name": "fork",         "file": "fork.json",         "count": 2000, "sha256": "..."},
    {"name": "pin",          "file": "pin.json",          "count": 2000, "sha256": "..."},
    {"name": "hangingPiece", "file": "hangingPiece.json", "count": 2000, "sha256": "..."}
  ]
}
```

---

## Runtime: multi-theme loader

### Public API

`loadPuzzles()` (no theme arg) returns the de-duplicated union of all themes' puzzles.

```js
const puzzles = await loadPuzzles({
  fetch: globalThis.fetch,
  store: someOpenedStore,
  fetchTimeoutMs: 5000,
  onProgress: (loaded, total) => { ... },
});
// puzzles: Puzzle[] — union of all themes, deduped by id
```

### Flow

1. Read cached union and `version` from store.
2. Fetch `/data/puzzles/index.json` (with timeout). If it fails:
   - If cache non-empty, return cache.
   - Else throw `LoaderError`.
3. If `index.version === localVersion` and cache non-empty → return cache.
4. **Fetch all theme JSONs in parallel.** Each fetch is independently timed-out and progress-tracked. Total bytes for the progress callback = sum of `Content-Length` headers; the callback fires with the cumulative loaded across all in-flight downloads.
5. **For each theme**: sha256-verify the bytes against `index.themes[].sha256`. If any sha256 fails, log a warning, abort the replace, return the cache (or throw on cold start).
6. **For each theme**: parse JSON. If any parse fails, abort the replace.
7. **Atomic replace**: open a single transaction, clear the puzzles store, insert all puzzles from all themes. Update `version` and `lastFetch`. Commit.
8. Return the de-duplicated union (some puzzles may appear in multiple theme files; the IDB store de-dupes by id automatically since it's keyed on id and `put` is upsert).

### Atomicity guarantee

If step 4 fails for any theme, no IDB write happens. The previous (consistent) state is preserved. The next launch can retry. This avoids the "we have 4 themes' new data and 1 theme's old data" hybrid state.

---

## Stats module: `src/stats.js`

```js
export class Stats {
  constructor(store) {
    this.store = store;
    this.solved = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.todayCount = 0;
    this.todayDate = todayKey();
    this.puzzleHadError = false;
  }

  async load() {
    this.solved      = (await this.store.getMeta('solved'))      ?? 0;
    this.streak      = (await this.store.getMeta('streak'))      ?? 0;
    this.bestStreak  = (await this.store.getMeta('bestStreak'))  ?? 0;
    const storedDate  = await this.store.getMeta('todayDate');
    const storedCount = (await this.store.getMeta('todayCount')) ?? 0;
    if (storedDate === todayKey()) {
      this.todayDate = storedDate;
      this.todayCount = storedCount;
    } else {
      this.todayDate = todayKey();
      this.todayCount = 0;
    }
    return this;
  }

  startPuzzle()  { this.puzzleHadError = false; }

  async onCorrectSolve() {
    this.solved += 1;
    this.bumpToday();
    if (!this.puzzleHadError) {
      this.streak += 1;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    }
    this.puzzleHadError = false;
    await this.persist();
  }

  async onWrongMove() {
    if (!this.puzzleHadError) {
      this.streak = 0;
      this.puzzleHadError = true;
      await this.persist();
    }
  }

  async onSkipOrShow() { this.puzzleHadError = false; }

  bumpToday() {
    if (this.todayDate !== todayKey()) {
      this.todayDate = todayKey();
      this.todayCount = 0;
    }
    this.todayCount += 1;
  }

  async persist() {
    await Promise.all([
      this.store.setMeta('solved',      this.solved),
      this.store.setMeta('streak',      this.streak),
      this.store.setMeta('bestStreak',  this.bestStreak),
      this.store.setMeta('todayDate',   this.todayDate),
      this.store.setMeta('todayCount',  this.todayCount),
    ]);
  }

  snapshot() {
    return { solved: this.solved, streak: this.streak, bestStreak: this.bestStreak, today: this.todayCount };
  }
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

---

## Filter module: `src/filters.js`

```js
const THEME_IDS = ['all', 'mateIn1', 'mateIn2', 'fork', 'pin', 'hangingPiece'];

export class Filters {
  constructor(store, allPuzzles) {
    this.store = store;
    this.allPuzzles = allPuzzles;
    this.theme = 'all';
    this.maxStars = 2;
    this.pool = [];
    this.poolIndex = 0;
  }

  async load() {
    this.theme    = (await this.store.getMeta('filterTheme'))    ?? 'all';
    this.maxStars = (await this.store.getMeta('filterMaxStars')) ?? 2;
    this.rebuildPool();
    return this;
  }

  rebuildPool() {
    let pool = this.theme === 'all'
      ? this.allPuzzles
      : this.allPuzzles.filter((p) => p.themes.includes(this.theme));
    pool = pool.filter((p) => p.stars <= this.maxStars);
    this.pool = shuffle(pool);
    this.poolIndex = 0;
  }

  counts() {
    const out = {};
    for (const id of THEME_IDS) {
      const themed = id === 'all' ? this.allPuzzles : this.allPuzzles.filter((p) => p.themes.includes(id));
      out[id] = themed.filter((p) => p.stars <= this.maxStars).length;
    }
    return out;
  }

  async setTheme(t)    { this.theme = t;    this.rebuildPool(); await this.persist(); }
  async setMaxStars(n) { this.maxStars = n; this.rebuildPool(); await this.persist(); }

  next() {
    if (this.pool.length === 0) return null;
    if (this.poolIndex >= this.pool.length) {
      this.pool = shuffle(this.pool);
      this.poolIndex = 0;
    }
    return this.pool[this.poolIndex++];
  }

  async persist() {
    await Promise.all([
      this.store.setMeta('filterTheme',    this.theme),
      this.store.setMeta('filterMaxStars', this.maxStars),
    ]);
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

---

## UI components

### Layout (`index.html`)

```html
<main>
  <div id="stats-header" class="stats-header"></div>
  <div id="theme-chips" class="theme-chips"></div>
  <div id="board" class="board-stage"></div>
  <div id="difficulty-stars" class="difficulty-stars"></div>
  <p id="status" class="status" aria-live="polite">Loading...</p>
  <progress id="loading-progress" class="loading-progress" max="100" value="0" hidden></progress>
  <div class="actions">
    <button id="hint" type="button" aria-label="Hint">Hint</button>
    <button id="show" type="button" aria-label="Show solution">Show</button>
    <button id="skip" type="button" aria-label="Skip puzzle">Skip</button>
  </div>
</main>
```

### Renderers

Three small modules in `src/ui/`:

- `header.js`: `renderStats({ solved, streak, bestStreak, today })` — sets `#stats-header` text.
- `chips.js`: `renderChips({ active, counts, onSelect })` — replaces children of `#theme-chips` with one button per theme.
- `stars.js`: `renderStars({ cap, onSelect })` — replaces children of `#difficulty-stars` with 5 buttons.

All three are stateless and re-rendered on change. Click handlers are attached directly to each button at render time (simpler than event delegation; the bars are tiny).

### Styles (`src/ui/styles.css`)

Add:

```css
.stats-header {
  font-size: 14px;
  color: #efe6dc;
  text-align: center;
  letter-spacing: 0.5px;
}

.theme-chips {
  display: flex;
  gap: 8px;
  width: 100%;
  overflow-x: auto;
  padding-bottom: 4px;
}

.chip {
  flex: 0 0 auto;
  min-height: 48px;
  padding: 8px 16px;
  font-size: 16px;
  border-radius: 999px;
  border: 2px solid #5a3a22;
  background: #2a201a;
  color: #efe6dc;
  cursor: pointer;
  white-space: nowrap;
}

.chip-active {
  background: #f0d9b5;
  color: #2a201a;
}

.difficulty-stars {
  display: flex;
  gap: 4px;
  justify-content: center;
}

.star {
  background: transparent;
  border: none;
  font-size: 28px;
  cursor: pointer;
  padding: 8px 4px;
  min-width: 44px;
  min-height: 44px;
  color: #5a3a22;
}

.star-on  { color: #f0d9b5; }
.star-off { color: #5a3a22; opacity: 0.4; }
```

Remove from `.board-stage`:

```css
perspective: 1000px;
perspective-origin: center 60%;
```

Remove from `.board-stage > *`:

```css
transform: rotateX(15deg);
```

Update `@keyframes shake-incorrect`:

```css
@keyframes shake-incorrect {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
```

---

## App wiring

```js
// src/app.js (post-Phase-3, key sections)

import { Stats } from './stats.js';
import { Filters } from './filters.js';
import { renderStats } from './ui/header.js';
import { renderChips } from './ui/chips.js';
import { renderStars } from './ui/stars.js';

let stats, filters;

async function main() {
  setStatus('Loading puzzles…');
  board = new Board('#board', { onUserMove: handleUserMove });
  bindActions();

  let puzzles;
  try {
    puzzles = await loadPuzzles({
      onProgress: (loaded, total) => setProgress(loaded, total),
    });
  } catch (err) {
    console.error(err);
    setStatus('Need internet on first run. Reload when online.');
    hideProgress();
    return;
  }
  hideProgress();

  const store = await new Store().open();
  stats   = await new Stats(store).load();
  filters = await new Filters(store, puzzles).load();

  renderStats(stats.snapshot());
  renderChips({ active: filters.theme, counts: filters.counts(), onSelect: handleThemeChange });
  renderStars({ cap: filters.maxStars, onSelect: handleStarChange });

  await loadNextPuzzle();
}

async function loadNextPuzzle() {
  stats.startPuzzle();
  const puzzle = filters.next();
  if (!puzzle) {
    setStatus('No puzzles match — try a higher difficulty.');
    session = null;
    return;
  }
  session = new PuzzleSession(puzzle);
  await board.setPosition(session.fen(), session.orientation());
  setStatus(`Find the best move for ${session.orientation()}.`);
  await wait(SETUP_DELAY_MS);
  const setup = session.applyOpponentSetup();
  await board.animateMove({ from: setup.from, to: setup.to });
}

async function handleThemeChange(theme) {
  await filters.setTheme(theme);
  renderChips({ active: filters.theme, counts: filters.counts(), onSelect: handleThemeChange });
  await loadNextPuzzle();
}

async function handleStarChange(n) {
  await filters.setMaxStars(n);
  renderStars({ cap: filters.maxStars, onSelect: handleStarChange });
  renderChips({ active: filters.theme, counts: filters.counts(), onSelect: handleThemeChange });
  await loadNextPuzzle();
}
```

The user-move handler integrates stats:

```js
if (r.result === 'incorrect') {
  await stats.onWrongMove();
  renderStats(stats.snapshot());
  // existing shake + revert
  return;
}
// correct
if (r.solved) {
  await stats.onCorrectSolve();
  renderStats(stats.snapshot());
  // existing pause + next
}
```

Skip and Show handlers:

```js
document.querySelector('#skip').addEventListener('click', async () => {
  await stats.onSkipOrShow();
  await loadNextPuzzle();
});

document.querySelector('#show').addEventListener('click', async () => {
  if (!session || session.status !== 'awaiting-user') return;
  // existing show animation logic, then:
  await stats.onSkipOrShow();
  await loadNextPuzzle();
});
```

When `session === null` (empty pool), the action buttons are no-ops because the early return at the top of each handler covers it.

---

## Test plan

| File | Group | Tests |
|---|---|---|
| `tests/build-puzzles.test.js` | per-theme filter | mateIn2: cap=1400, exactly 4 moves; fork: cap=1300, ≥2 moves; pin/hangingPiece similar |
| `tests/build-puzzles.test.js` | per-theme verify | mateIn2 last-move-mate; fork accepts any all-legal sequence; tactical themes don't check mate |
| `tests/build-puzzles.test.js` | cross-theme | a single row tagged `["mateIn1","short"]` qualifies for mateIn1 once and isn't duplicated within mateIn1 |
| `tests/loader.test.js` | multi-theme manifest | 5-theme index → 5 fetches → all stored in IDB; sha256 verified per file |
| `tests/loader.test.js` | partial-fetch failure | one of five theme files 500s → cached union still returned (or LoaderError on cold start); other 4 theme files NOT written to IDB |
| `tests/loader.test.js` | sha256 mismatch on one theme | similar atomicity: nothing replaced |
| `tests/loader.test.js` | dedup union | two theme files containing the same puzzle id → IDB has 1 row (because keyPath:'id', `put` is upsert) |
| `tests/stats.test.js` | clean solve | streak +=1, bestStreak max'd, today +=1, solved +=1 |
| `tests/stats.test.js` | wrong then solve | first wrong move resets streak to 0; eventual solve increments solved + today but NOT streak |
| `tests/stats.test.js` | second wrong move on same puzzle | no double-reset; streak stays 0 |
| `tests/stats.test.js` | skip / show | streak unchanged, solved unchanged, today unchanged |
| `tests/stats.test.js` | midnight rollover | with todayDate=yesterday, next solve resets todayCount to 1 |
| `tests/stats.test.js` | persistence | values round-trip through Store |
| `tests/filters.test.js` | rebuildPool | theme=mateIn1 + maxStars=2 → only puzzles with mateIn1 in themes AND stars ≤ 2 |
| `tests/filters.test.js` | counts | counts['fork'] = number of fork puzzles with stars ≤ maxStars |
| `tests/filters.test.js` | shuffle + cycle | calling next() repeatedly returns each puzzle exactly once before any repeat |
| `tests/filters.test.js` | empty pool | next() returns null; persistence still works |
| `tests/filters.test.js` | persistence | setTheme + setMaxStars round-trip through store |

Approximate new test count: 25–28 across the four files.

---

## Manual test plan

After all unit tests pass:

1. **Fresh first launch (online).** Clear site data. Reload. Progress bar visible briefly during the larger fetch (~5x Phase 2). Puzzle appears. Stats header shows all zeros + Today 0.
2. **Theme chip swap.** Tap "Fork" — pool changes, new puzzle appears. "Fork" chip highlighted. Counts on every chip reflect the current difficulty.
3. **Difficulty stars (down).** Tap star 1. Chip counts drop. Pool restricts to 1-star puzzles. New puzzle appears.
4. **Difficulty stars (up).** Tap star 5. Chip counts rise. Pool widens.
5. **Stats — clean solve.** Solve a puzzle without errors. Streak 0→1, bestStreak follows, today increments, solved increments.
6. **Stats — wrong then right.** Make a wrong move (board shakes). Streak goes to 0. Solve correctly. Solved + today increment; streak stays at 0.
7. **Stats — skip.** Streak unchanged. Solved unchanged. Today unchanged.
8. **Stats — show.** Same semantics as skip.
9. **Persistence.** Reload. Stats and filter restored.
10. **Midnight rollover.** Edit `todayDate` in DevTools → Application → IDB → meta to a past date. Reload. Today goes to 0; next solve increments to 1.
11. **Empty pool.** Combine "Hanging" theme + 1 star. If zero puzzles: status shows "No puzzles match — try a higher difficulty." Hint/Show/Skip become no-ops.
12. **Empty-pool recovery.** Bump stars up. Pool recovers; puzzle appears.
13. **Visual.** Confirm the board no longer tilts. Drop-shadow + warm cream/walnut squares still feel polished.
14. **Promotion regression.** Confirm a promotion puzzle still works (Phase 2 fix).
15. **Build pipeline regen.** `rm data/puzzles/*.json && npm run build-puzzles`. All five theme files regenerate. `index.json` lists 5 themes with sha256. App reload still works.

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from clean clone.
- [ ] All unit tests pass. Approximate count: 65 prior + ~25 new = ~90 total.
- [ ] `data/puzzles/{index,mateIn1,mateIn2,fork,pin,hangingPiece}.json` are committed and consistent (sha256 matches per theme).
- [ ] Stats track correctly across all five edge cases (clean solve, wrong-then-right, skip, show, midnight rollover).
- [ ] Filter persistence works across reloads.
- [ ] Empty-pool case shows the right message and disables actions.
- [ ] Multi-theme partial-failure case: cached state is preserved (atomic replace).
- [ ] Board tilt is gone.
- [ ] No console errors during normal operation.

---

## Architecture trade-offs explicitly considered

- **Multi-theme atomic replace vs. per-theme partial replace.** Atomic chosen. Hybrid state (some themes new, some old) is hard to reason about and the data is small enough that atomicity is cheap.
- **Eager vs. lazy theme fetch.** Eager. Total payload is ~2 MB. One round-trip is simpler and gets the kid playing faster across filter changes. Lazy would save bytes only on filter swaps that don't happen until later sessions, which doesn't help on cellular.
- **Store schema migration vs. flat meta.** Flat meta. Schema is unchanged from Phase 2 (still one `meta` store with `key`/`value` rows). New keys are just new entries. No DB version bump needed.
- **Streak semantics on wrong-then-right.** Lichess Storm-style: wrong move taints the puzzle, eventual solve doesn't recover the streak. Matches what users expect from chess puzzle apps.
- **Skip/Show: same stat treatment.** Show is a "softer skip" that lets the kid see the answer without the streak penalty. Treating both identically in stats is consistent with PROJECT.md's stated Skip behavior.
- **Filter persistence on launch could yield empty pool.** Accepted. The user explicitly chose this combination and re-launching shouldn't silently change their settings. The "No puzzles match" message tells them to nudge.
- **Tactical-theme verification scope.** Just legal moves, not semantic claim. Lichess's classifier is the source of truth; re-deriving "is this actually a fork?" would require a separate engine.
- **Per-theme floor of 250 for tactical themes.** Lower than mateIn1's 500 because lower-rated tactical puzzles are scarcer in the Lichess data. The floor is a regression guard against schema changes, not a quality target.
