# Phase 3 Implementation Plan: Filters and Stats

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase 3 per `docs/superpowers/specs/2026-05-03-phase3-filters-stats-design.md` — five-theme data pipeline, theme chips + difficulty stars filter UI, persistent stats (solved / streak / best / today), atomic multi-theme loader, plus visual cleanup (remove board tilt).

**Architecture:** Build pipeline gains a per-theme rules table; the existing single-pass scan now classifies each row against all five rules (one row may qualify for multiple themes). Loader switches from single-theme to eager-multi-theme with all-or-nothing IDB replacement. Two new runtime modules (`stats.js`, `filters.js`) own the dynamic state and persist via the existing `Store` meta key/value API. UI gains three small render helpers (`header`, `chips`, `stars`) that re-render on every state change. App.js wires these together with new event handlers for theme/star changes and updated stat triggers.

**Tech Stack:** Same as Phase 2 — Node ≥18 ESM, `chess.js`, `idb` (vendored), `fake-indexeddb` (test-only), Vitest. No new dependencies.

---

## Background and conventions

- **Theme rules table** is the single source of truth; defined as a constant in `scripts/build-puzzles.mjs` and (separately) in `src/filters.js` for the runtime UI list. They must stay in sync, but the build script's table is richer (rating cap, move count, mate requirement, cap, floor) while the runtime list only needs ids and labels.
- **Per-theme floor**: 500 for `mateIn1`; 250 for `mateIn2`/`fork`/`pin`/`hangingPiece`. The build script exits non-zero if any theme drops below.
- **Lichess move convention** (unchanged): `Moves[0]` is the opponent's setup; user starts at index 1. mateIn1 has 2 moves; mateIn2 has 4; tactical themes have ≥ 2.
- **Dedup at runtime**: a single Lichess puzzle can be tagged for multiple themes, so it appears in multiple per-theme JSON files. The IDB `puzzles` store is keyed on `id`, so `put` is upsert; storing the union of all five files naturally dedupes to one row per id.
- **Atomic loader**: all five themes' fetches + sha256 verifications must succeed before any IDB write. On any failure, cached state is preserved.
- **Streak semantics** (Lichess Storm-style): wrong move taints the puzzle; subsequent solve doesn't recover the streak. Skip and Show leave streak unchanged.

---

## Task 1: Refactor build-puzzles helpers to multi-theme (TDD)

**Files:**
- Modify: `tests/build-puzzles.test.js`
- Modify: `scripts/build-puzzles.mjs` (helpers section)

This task changes the signatures of `passesFilter` and `verifyPuzzle` to accept a theme name + rules table, and adds new tests for `mateIn2` / `fork` behavior. The orchestration is updated in Task 2.

- [ ] **Step 1: Add the rules table to `scripts/build-puzzles.mjs`**

Insert at the top of the file, just after the imports:

```js
// Per-theme rules. Defined once; consumed by passesFilter, verifyPuzzle, and
// the orchestration loop.
export const THEME_RULES = {
  mateIn1:      { maxRating: 1200, exactMoves: 2, requiresMate: true,  cap: 2000, floor: 500 },
  mateIn2:      { maxRating: 1400, exactMoves: 4, requiresMate: true,  cap: 2000, floor: 250 },
  fork:         { maxRating: 1300, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
  pin:          { maxRating: 1300, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
  hangingPiece: { maxRating: 1200, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
};

export const THEME_NAMES = Object.keys(THEME_RULES);
```

- [ ] **Step 2: Replace `passesFilter` and `verifyPuzzle` with theme-aware versions**

Replace the existing `passesFilter` (single-theme) with:

```js
export function passesFilter(row, themeName, rules = THEME_RULES) {
  const rule = rules[themeName];
  if (!rule) return false;
  if (!row.themes.includes(themeName)) return false;
  if (row.rating > rule.maxRating) return false;
  if (rule.exactMoves != null && row.movesArr.length !== rule.exactMoves) return false;
  if (rule.minMoves != null && row.movesArr.length < rule.minMoves) return false;
  return true;
}
```

Replace the existing `verifyPuzzle` with:

```js
export function verifyPuzzle(row, themeName = 'mateIn1', rules = THEME_RULES) {
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

The `themeName` defaults are there so the existing Phase 2 tests (which call `verifyPuzzle(row)` with no theme) keep working without modification.

- [ ] **Step 3: Update existing tests in `tests/build-puzzles.test.js` to pass the theme name**

The Phase 2 tests call `passesFilter(r)` with one argument; they need to become `passesFilter(r, 'mateIn1')`. Find each `passesFilter(...)` call in the test file and add `'mateIn1'` as the second argument. Same for any `verifyPuzzle(...)` calls — add `'mateIn1'`.

- [ ] **Step 4: Run, expect failures (existing tests now use updated signatures)**

Run: `npm test -- tests/build-puzzles.test.js`
Expected: 13 tests pass — they all use `'mateIn1'` and the new signatures. If any fail, double-check the test edits in Step 3.

- [ ] **Step 5: Append new multi-theme tests**

Append to `tests/build-puzzles.test.js`:

```js
import { THEME_RULES } from '../scripts/build-puzzles.mjs';

const FORK_ROW_OK = {
  id: 'F1',
  fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
  movesArr: ['c4f7', 'e8f7'], // hypothetical; just need legal moves
  rating: 1100,
  themes: ['fork', 'middlegame'],
  popularity: 50,
};
// We pick a real-ish position — 2-move sequence that is legal in chess.js.
// The verifyPuzzle test for tactical themes only checks legality; chess.js will
// reject any illegal pair, so any small adjustment is fine if c4f7 isn't legal
// in this exact FEN. We'll use a synthetic FEN that's known-legal:
const TACTICAL_OK = {
  id: 'T1',
  fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',  // K+P vs K
  movesArr: ['e2e4', 'e8d8'], // both legal
  rating: 1100,
  themes: ['fork'],
  popularity: 50,
};

const MATE2_FIXTURE = {
  // Two-rook ladder mate from Phase 1's matein2Fixture.
  id: 'M2',
  fen: '6k1/8/5K2/8/8/8/R7/R7 b - - 0 1',
  movesArr: ['g8h8', 'a2a8', 'h8h7', 'a1h1'],
  rating: 1200,
  themes: ['mateIn2'],
  popularity: 50,
};

describe('passesFilter (mateIn2)', () => {
  it('accepts rating ≤ 1400 with exactly 4 moves', () => {
    expect(passesFilter(MATE2_FIXTURE, 'mateIn2')).toBe(true);
  });

  it('rejects rating > 1400', () => {
    expect(passesFilter({ ...MATE2_FIXTURE, rating: 1401 }, 'mateIn2')).toBe(false);
  });

  it('rejects move count != 4', () => {
    expect(passesFilter({ ...MATE2_FIXTURE, movesArr: ['a','b','c'] }, 'mateIn2')).toBe(false);
    expect(passesFilter({ ...MATE2_FIXTURE, movesArr: ['a','b','c','d','e'] }, 'mateIn2')).toBe(false);
  });
});

describe('passesFilter (fork)', () => {
  it('accepts rating ≤ 1300 with ≥ 2 moves', () => {
    expect(passesFilter(TACTICAL_OK, 'fork')).toBe(true);
    expect(passesFilter({ ...TACTICAL_OK, movesArr: ['a','b','c','d'] }, 'fork')).toBe(true);
  });

  it('rejects rating > 1300', () => {
    expect(passesFilter({ ...TACTICAL_OK, rating: 1301 }, 'fork')).toBe(false);
  });

  it('rejects move count < 2', () => {
    expect(passesFilter({ ...TACTICAL_OK, movesArr: ['a'] }, 'fork')).toBe(false);
  });

  it('rejects when not tagged with fork', () => {
    expect(passesFilter({ ...TACTICAL_OK, themes: ['pin'] }, 'fork')).toBe(false);
  });
});

describe('verifyPuzzle (mateIn2)', () => {
  it('accepts a hand-built mate-in-2', () => {
    expect(verifyPuzzle(MATE2_FIXTURE, 'mateIn2').ok).toBe(true);
  });

  it('rejects when last move does not mate', () => {
    // Replace the last (mate) move with a non-mate king move.
    const v = verifyPuzzle({ ...MATE2_FIXTURE, movesArr: ['g8h8','a2a8','h8h7','f6f5'] }, 'mateIn2');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('not-mate');
  });
});

describe('verifyPuzzle (tactical)', () => {
  it('accepts any all-legal sequence for fork (no mate check)', () => {
    expect(verifyPuzzle(TACTICAL_OK, 'fork').ok).toBe(true);
  });

  it('rejects illegal move in tactical sequence', () => {
    const v = verifyPuzzle({ ...TACTICAL_OK, movesArr: ['e2e5', 'e8d8'] }, 'fork'); // e2-e5 illegal (pawn goes 3 squares)
    expect(v.ok).toBe(false);
    expect(['illegal-setup', 'illegal-move']).toContain(v.reason);
  });
});

describe('THEME_RULES', () => {
  it('exposes all 5 themes with rating caps', () => {
    expect(Object.keys(THEME_RULES).sort()).toEqual(['fork','hangingPiece','mateIn1','mateIn2','pin']);
    expect(THEME_RULES.mateIn1.maxRating).toBe(1200);
    expect(THEME_RULES.mateIn2.maxRating).toBe(1400);
    expect(THEME_RULES.fork.maxRating).toBe(1300);
    expect(THEME_RULES.pin.maxRating).toBe(1300);
    expect(THEME_RULES.hangingPiece.maxRating).toBe(1200);
  });

  it('mate themes require mate; tactical themes do not', () => {
    expect(THEME_RULES.mateIn1.requiresMate).toBe(true);
    expect(THEME_RULES.mateIn2.requiresMate).toBe(true);
    expect(THEME_RULES.fork.requiresMate).toBe(false);
    expect(THEME_RULES.pin.requiresMate).toBe(false);
    expect(THEME_RULES.hangingPiece.requiresMate).toBe(false);
  });
});
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: 65 prior + ~13 new = ~78 tests pass.

If a tactical test fails because the synthetic FEN moves aren't actually legal in chess.js, adjust the fixture (e.g., use the very simple `4k3/8/8/8/8/8/4P3/4K3 w` start with `e2e3` then `e8d8` as the two moves).

- [ ] **Step 7: Commit**

```bash
git add scripts/build-puzzles.mjs tests/build-puzzles.test.js
git commit -m "Refactor build-puzzles to theme-aware filter and verify (multi-theme)"
```

---

## Task 2: Multi-theme orchestration

**Files:**
- Modify: `scripts/build-puzzles.mjs` (orchestration section)

The single-pass scan now classifies each row against all 5 rules. Per-theme buckets are sorted, capped, and emitted as separate JSON files. The build report and rejected.log gain per-theme breakdowns.

- [ ] **Step 1: Replace the orchestration code**

Find the existing `streamFilterVerify` function in `scripts/build-puzzles.mjs` and replace with this multi-theme version. The replacement keeps the same I/O shape (download/decompress/write) but redoes the filter + verify + bucket logic:

```js
async function streamFilterVerify() {
  const rejected = [];
  // One bucket per theme.
  const buckets = Object.fromEntries(THEME_NAMES.map((n) => [n, []]));
  const stats = {
    rowsScanned: 0,
    perTheme: Object.fromEntries(THEME_NAMES.map((n) => [n, {
      keptAfterFilter: 0, keptAfterVerify: 0, rejections: {},
    }])),
    globalRejections: {}, // for malformed-row that doesn't belong to any theme
  };

  const stream = createReadStream(CSV_PATH, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    if (!line) continue;
    stats.rowsScanned++;

    let row;
    try {
      row = parseLichessRow(line);
    } catch {
      stats.globalRejections['malformed-row'] = (stats.globalRejections['malformed-row'] || 0) + 1;
      rejected.push({ id: '?', theme: '-', reason: 'malformed-row', detail: line.slice(0, 80) });
      continue;
    }

    // Classify against every theme. A row may qualify for multiple.
    let qualifiedForAny = false;
    for (const theme of THEME_NAMES) {
      if (!passesFilter(row, theme)) continue;
      qualifiedForAny = true;
      stats.perTheme[theme].keptAfterFilter++;
      const v = verifyPuzzle(row, theme);
      if (!v.ok) {
        bumpThemeRejection(stats, theme, v.reason);
        rejected.push({ id: row.id, theme, reason: v.reason, detail: v.detail });
        continue;
      }
      stats.perTheme[theme].keptAfterVerify++;
      buckets[theme].push(row);
    }
    // If a row doesn't qualify for ANY theme, log it once with an aggregate reason.
    if (!qualifiedForAny) {
      // Pick the most-specific reason for the report:
      const reason = !THEME_NAMES.some((t) => row.themes.includes(t))
        ? 'no-target-theme'
        : 'rating-or-move-count';
      stats.globalRejections[reason] = (stats.globalRejections[reason] || 0) + 1;
    }

    if (stats.rowsScanned % 100000 === 0) {
      const totalVerified = Object.values(stats.perTheme).reduce((a, b) => a + b.keptAfterVerify, 0);
      process.stdout.write(`  scanned ${stats.rowsScanned}, verified ${totalVerified}\r`);
    }
  }
  console.log('');
  return { buckets, rejected, stats };
}

function bumpThemeRejection(stats, theme, reason) {
  stats.perTheme[theme].rejections[reason] = (stats.perTheme[theme].rejections[reason] || 0) + 1;
}
```

- [ ] **Step 2: Replace `sortAndCap` and `writeOutputs` with multi-theme versions**

Find existing `sortAndCap` and `writeOutputs` and replace:

```js
function sortAndCapAll(buckets) {
  const kept = {};
  const overCap = [];
  for (const theme of THEME_NAMES) {
    const sorted = buckets[theme].sort((a, b) => b.popularity - a.popularity);
    const rule = THEME_RULES[theme];
    kept[theme] = sorted.slice(0, rule.cap);
    for (const row of sorted.slice(rule.cap)) {
      overCap.push({ id: row.id, theme, reason: 'over-cap' });
    }
  }
  return { kept, overCap };
}

async function writeOutputs(kept, allRejected) {
  await mkdir(DATA_DIR, { recursive: true });

  const version = todayIso();
  const generatedAt = new Date().toISOString();

  const themeManifest = [];
  for (const theme of THEME_NAMES) {
    const themeFile = {
      version,
      theme,
      puzzles: kept[theme].map(transformPuzzle),
    };
    const themeJson = JSON.stringify(themeFile, null, 0);
    const themePath = join(DATA_DIR, `${theme}.json`);
    await writeFile(themePath, themeJson, 'utf8');
    const sha256 = sha256Hex(Buffer.from(themeJson, 'utf8'));
    themeManifest.push({
      name: theme,
      file: `${theme}.json`,
      count: kept[theme].length,
      sha256,
    });
  }

  const indexFile = {
    version,
    generatedAt,
    themes: themeManifest,
  };
  await writeFile(join(DATA_DIR, 'index.json'), JSON.stringify(indexFile, null, 2), 'utf8');

  const rejectedPath = join(DATA_DIR, 'rejected.log');
  const lines = allRejected.map((r) => `${r.id}\t${r.theme ?? '-'}\t${r.reason}\t${r.detail ?? ''}`).join('\n') + '\n';
  await writeFile(rejectedPath, lines, 'utf8');

  return themeManifest;
}
```

- [ ] **Step 3: Replace `printReport` with multi-theme version**

```js
function printReport(stats, themeManifest) {
  console.log('\n────────── Build report ──────────');
  console.log(`  rows scanned:        ${stats.rowsScanned}`);
  console.log(`  global rejections:`);
  for (const [reason, count] of Object.entries(stats.globalRejections).sort((a,b) => b[1]-a[1])) {
    console.log(`    ${reason.padEnd(28)}: ${count}`);
  }
  console.log('  per-theme:');
  for (const t of themeManifest) {
    const pt = stats.perTheme[t.name];
    console.log(`    ${t.name.padEnd(15)} written ${String(t.count).padStart(5)}  sha=${t.sha256.slice(0,8)}…`);
    console.log(`      kept after filter: ${pt.keptAfterFilter}`);
    console.log(`      kept after verify: ${pt.keptAfterVerify}`);
    if (Object.keys(pt.rejections).length > 0) {
      const reasons = Object.entries(pt.rejections).sort((a,b) => b[1]-a[1])
        .map(([r,c]) => `${r}=${c}`).join(', ');
      console.log(`      rejected:          ${reasons}`);
    }
  }
  console.log('───────────────────────────────────\n');
}
```

- [ ] **Step 4: Replace `main()` with the multi-theme version**

```js
async function main() {
  const refresh = process.argv.includes('--refresh');
  await downloadIfNeeded({ refresh });
  await decompressIfNeeded();
  const { buckets, rejected, stats } = await streamFilterVerify();
  const { kept, overCap } = sortAndCapAll(buckets);
  for (const r of overCap) rejected.push(r);

  // Per-theme floor check.
  const failures = [];
  for (const theme of THEME_NAMES) {
    if (kept[theme].length < THEME_RULES[theme].floor) {
      failures.push(`${theme}: ${kept[theme].length} verified (floor ${THEME_RULES[theme].floor})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Some themes are below their floor:\n  ${failures.join('\n  ')}\n` +
      'Lichess may have changed their schema. Inspect rejected.log.',
    );
  }

  const themeManifest = await writeOutputs(kept, rejected);
  printReport(stats, themeManifest);
}
```

- [ ] **Step 5: Sanity-check the file imports**

Run: `node --input-type=module -e "import('./scripts/build-puzzles.mjs').then(m => console.log(Object.keys(m).sort()))"`
Expected: prints `[ 'THEME_NAMES', 'THEME_RULES', 'parseLichessRow', 'passesFilter', 'ratingToStars', 'transformPuzzle', 'verifyPuzzle' ]`. The orchestration is internal and not exported.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: ~78 tests still pass — orchestration changes don't affect the helper-level tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-puzzles.mjs
git commit -m "Multi-theme build orchestration: per-theme buckets, floors, manifest"
```

---

## Task 3: Run multi-theme pipeline + commit data

**Files:**
- Modify: `data/puzzles/index.json` (regenerated)
- Modify: `data/puzzles/mateIn1.json` (regenerated; sha will change)
- Create: `data/puzzles/mateIn2.json`
- Create: `data/puzzles/fork.json`
- Create: `data/puzzles/pin.json`
- Create: `data/puzzles/hangingPiece.json`

- [ ] **Step 1: Run the pipeline (cache hits, fast)**

Run: `npm run build-puzzles`
Expected: 30s–2min runtime. The CSV is already in `.cache/` from Phase 2 (no re-download). Decompression is skipped if the existing `.csv` is newer. The single-pass scan now classifies all 5 themes simultaneously. The build report shows per-theme counts (each ≥ floor) and writes 5 JSON files plus `index.json`.

If any theme fails the floor check (e.g., very few `hangingPiece` puzzles in the rating ≤ 1200 range), the script exits non-zero with the failures listed. Inspect `rejected.log` and adjust the floor in `THEME_RULES` if the threshold was set too aggressively.

- [ ] **Step 2: Verify outputs**

Run: `ls -lh data/puzzles/`
Expected: 5 theme JSON files plus `index.json`. Each theme JSON ~300–500 KB.

Run:

```bash
node --input-type=module -e "
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const idx = JSON.parse(await readFile('data/puzzles/index.json', 'utf8'));
console.log('themes:', idx.themes.map(t => \`\${t.name}=\${t.count}\`).join(' '));
for (const t of idx.themes) {
  const bytes = await readFile(\`data/puzzles/\${t.file}\`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  console.log(\`  \${t.name}: sha\${sha === t.sha256 ? '✓' : '✗'} (\${(bytes.length/1024).toFixed(0)}KB)\`);
}
"
```
Expected: all five themes show `sha✓`.

- [ ] **Step 3: Commit data**

```bash
git add data/puzzles/
git commit -m "Generate Phase 3 puzzle data: 5 themes with per-file sha256"
```

---

## Task 4: Multi-theme atomic loader (TDD)

**Files:**
- Modify: `tests/loader.test.js`
- Modify: `src/loader.js`

- [ ] **Step 1: Update existing loader tests for multi-theme manifests**

The Phase 2 `tests/loader.test.js` mocks single-theme manifests. Update the helpers and tests to use multi-theme. Replace the test file's contents with this updated version:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { loadPuzzles, LoaderError } from '../src/loader.js';
import { Store } from '../src/store.js';

const PUZZLE = (id, theme, stars=2) => ({
  id, fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'],
  rating: 850, themes: [theme], stars,
});
const THEMES = ['mateIn1', 'mateIn2', 'fork', 'pin', 'hangingPiece'];

function themeFile(theme, ids) {
  return JSON.stringify({
    version: '2026-05-XX',
    theme,
    puzzles: ids.map((id) => PUZZLE(id, theme)),
  });
}

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeManifest(version, themes) {
  const entries = [];
  for (const t of themes) {
    entries.push({ name: t.name, file: `${t.name}.json`, count: t.ids.length, sha256: await sha256Hex(t.body) });
  }
  return JSON.stringify({ version, generatedAt: new Date().toISOString(), themes: entries });
}

function makeFetch({ indexJson, themeBodies, themeFails = {}, indexFails = false }) {
  return vi.fn(async (url) => {
    if (typeof url === 'string') url = new URL(url, 'http://localhost/');
    const path = url.pathname || url.toString();
    if (path.endsWith('index.json')) {
      if (indexFails) throw new Error('network error');
      return new Response(indexJson, { status: 200 });
    }
    for (const theme of THEMES) {
      if (path.endsWith(`${theme}.json`)) {
        if (themeFails[theme]) throw new Error(`network error: ${theme}`);
        return new Response(themeBodies[theme], { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('loadPuzzles (multi-theme)', () => {
  it('first launch: fetches all 5 themes, sha256-verifies, populates IDB', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_A`, `${t}_B`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_A`, `${t}_B`], body });
    }
    const indexJson = await makeManifest('2026-05-03', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies });
    const store = await new Store().open();

    const puzzles = await loadPuzzles({ fetch, store });

    expect(puzzles.length).toBe(10); // 2 puzzles × 5 themes
    expect(await store.getVersion()).toBe('2026-05-03');
    expect(fetch).toHaveBeenCalledTimes(6); // index + 5 themes
    await store.close();
  });

  it('dedupes union: same id in two theme files = one row in IDB', async () => {
    // Both mateIn1 and short tag the same puzzle. Our build emits the row in both files.
    const sharedId = 'SAME';
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      // Every theme contains a puzzle with the shared id and one unique to it.
      const body = themeFile(t, [sharedId, `${t}_X`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [sharedId, `${t}_X`], body });
    }
    const indexJson = await makeManifest('v1', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies });
    const store = await new Store().open();

    const puzzles = await loadPuzzles({ fetch, store });

    // 5 themes × 2 puzzles = 10 rows, but the shared id appears 5 times → 6 unique rows.
    expect((await store.getAllPuzzles()).length).toBe(6);
    expect(puzzles.length).toBe(6);
    await store.close();
  });

  it('subsequent launch with same version: no theme refetch', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_A`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_A`], body });
    }
    const indexJson = await makeManifest('v1', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies });
    const store = await new Store().open();
    // Seed cache.
    await store.replacePuzzles('all', THEMES.map((t) => PUZZLE(`${t}_A`, t)));
    await store.setVersion('v1');

    const puzzles = await loadPuzzles({ fetch, store });

    expect(puzzles.length).toBe(5);
    expect(fetch).toHaveBeenCalledTimes(1); // only index.json
    await store.close();
  });

  it('partial fetch failure: cached union returned, IDB unchanged', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_NEW`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_NEW`], body });
    }
    const indexJson = await makeManifest('v2', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies, themeFails: { fork: true } });
    const store = await new Store().open();
    // Seed cache.
    const cached = THEMES.map((t) => PUZZLE(`${t}_OLD`, t));
    await store.replacePuzzles('all', cached);
    await store.setVersion('v1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const puzzles = await loadPuzzles({ fetch, store });

    expect(puzzles.map((p) => p.id).sort()).toEqual(cached.map((p) => p.id).sort());
    expect(await store.getVersion()).toBe('v1'); // unchanged
    warn.mockRestore();
    await store.close();
  });

  it('partial fetch failure on cold start: throws LoaderError', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_A`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_A`], body });
    }
    const indexJson = await makeManifest('v1', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies, themeFails: { fork: true } });
    const store = await new Store().open();

    await expect(loadPuzzles({ fetch, store })).rejects.toThrow(LoaderError);
    await store.close();
  });

  it('sha256 mismatch on one theme: cached union returned, IDB unchanged', async () => {
    // Build a manifest whose sha for `pin` is wrong but the body is fine.
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_NEW`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_NEW`], body });
    }
    // Tamper with the manifest after computing it.
    const idx = JSON.parse(await makeManifest('v2', themesMeta));
    const pin = idx.themes.find((t) => t.name === 'pin');
    pin.sha256 = '0'.repeat(64);
    const indexJson = JSON.stringify(idx);
    const fetch = makeFetch({ indexJson, themeBodies });
    const store = await new Store().open();
    const cached = THEMES.map((t) => PUZZLE(`${t}_OLD`, t));
    await store.replacePuzzles('all', cached);
    await store.setVersion('v1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const puzzles = await loadPuzzles({ fetch, store });

    expect(puzzles.map((p) => p.id).sort()).toEqual(cached.map((p) => p.id).sort());
    expect(await store.getVersion()).toBe('v1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await store.close();
  });

  it('offline first launch: throws LoaderError', async () => {
    const fetch = makeFetch({ indexJson: '', themeBodies: {}, indexFails: true });
    const store = await new Store().open();
    await expect(loadPuzzles({ fetch, store })).rejects.toThrow(LoaderError);
    await store.close();
  });

  it('offline subsequent launch: cached union returned', async () => {
    const fetch = makeFetch({ indexJson: '', themeBodies: {}, indexFails: true });
    const store = await new Store().open();
    const cached = THEMES.map((t) => PUZZLE(`${t}_OLD`, t));
    await store.replacePuzzles('all', cached);
    await store.setVersion('v1');

    const puzzles = await loadPuzzles({ fetch, store });
    expect(puzzles.length).toBe(5);
    await store.close();
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test -- tests/loader.test.js`
Expected: most tests fail because `loadPuzzles` still has the single-theme signature. Note the failure mode for the report.

- [ ] **Step 3: Replace `src/loader.js` with the multi-theme version**

```js
// src/loader.js
// Orchestrates fetch + IndexedDB caching for puzzle data across all themes.
// Public API: loadPuzzles(opts) → Promise<Puzzle[]> — returns the deduplicated
// union of all themes in the index.json manifest.

import { Store } from './store.js';

export class LoaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoaderError';
  }
}

const DEFAULT_BASE = '/data/puzzles';

export async function loadPuzzles(opts = {}) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const store = opts.store ?? await new Store().open();
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? 5000;
  const onProgress = opts.onProgress;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE;

  const [cachedPuzzles, localVersion] = await Promise.all([
    store.getAllPuzzles(),
    store.getVersion(),
  ]);

  // Fetch the manifest first.
  let index;
  try {
    index = await fetchJsonWithTimeout(fetchFn, `${baseUrl}/index.json`, fetchTimeoutMs);
  } catch (err) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`first launch requires network: ${err.message}`);
  }

  if (index.version === localVersion && cachedPuzzles.length > 0) {
    return cachedPuzzles;
  }

  // Fetch all themes in parallel.
  let totalBytes = 0;
  let loadedBytes = 0;
  const reportProgress = () => onProgress && onProgress(loadedBytes, totalBytes);

  const fetched = []; // { theme, bytes, text, expectedSha }
  try {
    const themePromises = index.themes.map(async (themeMeta) => {
      const { bytes, text } = await fetchWithProgress(
        fetchFn,
        `${baseUrl}/${themeMeta.file}`,
        (delta, fileTotal) => {
          // Aggregate progress across in-flight downloads.
          loadedBytes += delta;
          if (fileTotal && totalBytes < loadedBytes) totalBytes = Math.max(totalBytes, loadedBytes);
          reportProgress();
        },
        fetchTimeoutMs,
      );
      return { theme: themeMeta.name, bytes, text, expectedSha: themeMeta.sha256 };
    });
    const results = await Promise.all(themePromises);
    fetched.push(...results);
  } catch (err) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`failed to fetch one or more themes: ${err.message}`);
  }

  // Verify every theme's sha256 BEFORE writing anything.
  for (const f of fetched) {
    const computed = await sha256Hex(f.bytes);
    if (computed.toLowerCase() !== f.expectedSha.toLowerCase()) {
      console.warn(
        `[loader] sha256 mismatch for ${f.theme}.json: expected ${f.expectedSha}, got ${computed}. Keeping cached data.`,
      );
      if (cachedPuzzles.length > 0) return cachedPuzzles;
      throw new LoaderError(`theme '${f.theme}' failed integrity check`);
    }
  }

  // Parse every theme.
  const allPuzzles = [];
  for (const f of fetched) {
    let parsed;
    try {
      parsed = JSON.parse(f.text);
    } catch (err) {
      if (cachedPuzzles.length > 0) return cachedPuzzles;
      throw new LoaderError(`theme '${f.theme}' JSON parse failed: ${err.message}`);
    }
    if (Array.isArray(parsed.puzzles)) {
      for (const p of parsed.puzzles) allPuzzles.push(p);
    }
  }

  // Atomic replace: clear + insert all in one transaction (already what
  // store.replacePuzzles does). Dedupe by id is automatic since the IDB store
  // is keyed on id and `put` is upsert.
  await store.replacePuzzles('all', allPuzzles);
  await store.setVersion(index.version);
  await store.setLastFetch(Date.now());

  // Return what's actually in the store (which is deduplicated).
  return await store.getAllPuzzles();
}

// ───── helpers ─────

async function fetchJsonWithTimeout(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithProgress(fetchFn, url, onChunk, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get('Content-Length')) || 0;

    if (!res.body || typeof res.body.getReader !== 'function') {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (onChunk) onChunk(buf.byteLength, total || buf.byteLength);
      return { bytes: buf, text: new TextDecoder().decode(buf) };
    }

    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (onChunk) onChunk(value.byteLength, total);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
    return { bytes, text: new TextDecoder().decode(bytes) };
  } finally {
    clearTimeout(timer);
  }
}

async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

Note: the public API changed from `loadPuzzles(theme, opts)` to `loadPuzzles(opts)`. Callers in `src/app.js` will be updated in Task 9.

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/loader.test.js`
Expected: 8 tests pass.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: ~78 prior + 1 new (the partial-failure test was added; the others replaced existing tests with multi-theme equivalents). Total around 79.

If a test fails because the existing app.js still calls `loadPuzzles('mateIn1', ...)` — that's expected at this stage; app.js is updated in Task 9. The test for app.js doesn't exist as a unit test, so test count should still be unaffected. Just confirm `npm test` itself still completes without errors.

- [ ] **Step 6: Commit**

```bash
git add tests/loader.test.js src/loader.js
git commit -m "Multi-theme loader: parallel fetch + atomic sha256-verified IDB replace"
```

---

## Task 5: Stats module (TDD)

**Files:**
- Create: `tests/stats.test.js`
- Create: `src/stats.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/stats.test.js
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Stats } from '../src/stats.js';
import { Store } from '../src/store.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.useRealTimers();
});

async function freshStatsStore() {
  const store = await new Store().open();
  const stats = await new Stats(store).load();
  return { store, stats };
}

describe('Stats', () => {
  it('initializes with zeros on a fresh DB', async () => {
    const { stats } = await freshStatsStore();
    expect(stats.snapshot()).toMatchObject({ solved: 0, streak: 0, bestStreak: 0, today: 0 });
  });

  it('clean solve increments solved, streak, bestStreak, today', async () => {
    const { stats } = await freshStatsStore();
    stats.startPuzzle();
    await stats.onCorrectSolve();
    expect(stats.snapshot()).toMatchObject({ solved: 1, streak: 1, bestStreak: 1, today: 1 });
  });

  it('two clean solves in a row: streak = 2', async () => {
    const { stats } = await freshStatsStore();
    stats.startPuzzle();
    await stats.onCorrectSolve();
    stats.startPuzzle();
    await stats.onCorrectSolve();
    expect(stats.snapshot()).toMatchObject({ solved: 2, streak: 2, bestStreak: 2, today: 2 });
  });

  it('wrong move resets streak to 0; subsequent solve does NOT increment streak', async () => {
    const { stats } = await freshStatsStore();
    // Build a streak of 3.
    for (let i = 0; i < 3; i++) {
      stats.startPuzzle();
      await stats.onCorrectSolve();
    }
    expect(stats.snapshot().streak).toBe(3);
    expect(stats.snapshot().bestStreak).toBe(3);

    // New puzzle, wrong move, then solve.
    stats.startPuzzle();
    await stats.onWrongMove();
    expect(stats.snapshot().streak).toBe(0);
    await stats.onCorrectSolve();
    expect(stats.snapshot()).toMatchObject({ solved: 4, streak: 0, bestStreak: 3, today: 4 });
  });

  it('second wrong move on same puzzle does not double-reset (streak stays 0)', async () => {
    const { stats } = await freshStatsStore();
    stats.streak = 5;
    stats.bestStreak = 5;
    stats.puzzleHadError = false;

    stats.startPuzzle();
    await stats.onWrongMove();
    expect(stats.snapshot().streak).toBe(0);
    await stats.onWrongMove(); // second wrong move on same puzzle
    expect(stats.snapshot().streak).toBe(0); // unchanged
  });

  it('skip / show: solved unchanged, streak unchanged', async () => {
    const { stats } = await freshStatsStore();
    // Build a streak.
    stats.startPuzzle();
    await stats.onCorrectSolve();
    expect(stats.snapshot().streak).toBe(1);

    stats.startPuzzle();
    await stats.onSkipOrShow(); // skip without changes
    expect(stats.snapshot()).toMatchObject({ solved: 1, streak: 1, today: 1 });

    stats.startPuzzle();
    await stats.onSkipOrShow();
    expect(stats.snapshot()).toMatchObject({ solved: 1, streak: 1, today: 1 });
  });

  it('persistence: values round-trip through Store', async () => {
    const store = await new Store().open();
    const s1 = await new Stats(store).load();
    s1.startPuzzle();
    await s1.onCorrectSolve();
    s1.startPuzzle();
    await s1.onCorrectSolve();
    await store.close();

    const store2 = await new Store().open();
    const s2 = await new Stats(store2).load();
    expect(s2.snapshot()).toMatchObject({ solved: 2, streak: 2, bestStreak: 2, today: 2 });
    await store2.close();
  });

  it('midnight rollover: today resets to 0 on next solve when date changes', async () => {
    const store = await new Store().open();
    const s1 = await new Stats(store).load();
    // Manually set yesterday's stats.
    await store.setMeta('todayDate', '2026-04-30');
    await store.setMeta('todayCount', 17);
    await store.close();

    const store2 = await new Store().open();
    const s2 = await new Stats(store2).load();
    // load() detects the date mismatch and resets todayCount.
    expect(s2.snapshot().today).toBe(0);

    s2.startPuzzle();
    await s2.onCorrectSolve();
    expect(s2.snapshot().today).toBe(1); // not 18
    await store2.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/stats.test.js`
Expected: FAIL — `../src/stats.js` not found.

- [ ] **Step 3: Implement `src/stats.js`**

```js
// src/stats.js
// Stats state machine. Tracks lifetime solved, current/best streak, today's
// count (with local-midnight rollover). Streak resets on first wrong move per
// puzzle; skip and show leave streak unchanged. Persisted via Store's meta API.

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

  startPuzzle() {
    this.puzzleHadError = false;
  }

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

  async onSkipOrShow() {
    this.puzzleHadError = false;
  }

  bumpToday() {
    if (this.todayDate !== todayKey()) {
      this.todayDate = todayKey();
      this.todayCount = 0;
    }
    this.todayCount += 1;
  }

  async persist() {
    await Promise.all([
      this.store.setMeta('solved',     this.solved),
      this.store.setMeta('streak',     this.streak),
      this.store.setMeta('bestStreak', this.bestStreak),
      this.store.setMeta('todayDate',  this.todayDate),
      this.store.setMeta('todayCount', this.todayCount),
    ]);
  }

  snapshot() {
    return {
      solved:     this.solved,
      streak:     this.streak,
      bestStreak: this.bestStreak,
      today:      this.todayCount,
    };
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

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/stats.test.js`
Expected: 8 tests pass.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: ~87 tests pass (79 + 8).

- [ ] **Step 6: Commit**

```bash
git add tests/stats.test.js src/stats.js
git commit -m "Add Stats module with TDD (streak, today rollover, persistence)"
```

---

## Task 6: Filters module (TDD)

**Files:**
- Create: `tests/filters.test.js`
- Create: `src/filters.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/filters.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Filters } from '../src/filters.js';
import { Store } from '../src/store.js';

const PUZZLE = (id, themes, stars) => ({
  id, fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'],
  rating: 850, themes, stars,
});

const POOL = [
  PUZZLE('A', ['mateIn1'],         1),
  PUZZLE('B', ['mateIn1'],         3),
  PUZZLE('C', ['mateIn2'],         2),
  PUZZLE('D', ['fork'],            1),
  PUZZLE('E', ['fork', 'mateIn1'], 2),
  PUZZLE('F', ['pin'],             4),
  PUZZLE('G', ['hangingPiece'],    2),
];

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('Filters', () => {
  it('default theme=all, maxStars=2', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    expect(filters.theme).toBe('all');
    expect(filters.maxStars).toBe(2);
    await store.close();
  });

  it('rebuildPool: theme=all + maxStars=2 filters by stars only', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    // Pool: A(1), C(2), D(1), E(2), G(2) = 5 puzzles (stars ≤ 2)
    expect(filters.pool.map((p) => p.id).sort()).toEqual(['A','C','D','E','G']);
    await store.close();
  });

  it('rebuildPool: theme=mateIn1 + maxStars=5 returns only mateIn1', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    await filters.setMaxStars(5);
    await filters.setTheme('mateIn1');
    expect(filters.pool.map((p) => p.id).sort()).toEqual(['A','B','E']);
    await store.close();
  });

  it('counts: per-theme counts under current maxStars cap', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load(); // maxStars=2
    const c = filters.counts();
    expect(c.all).toBe(5);          // A,C,D,E,G have stars ≤ 2
    expect(c.mateIn1).toBe(2);      // A, E
    expect(c.mateIn2).toBe(1);      // C
    expect(c.fork).toBe(2);         // D, E
    expect(c.pin).toBe(0);          // F has stars=4
    expect(c.hangingPiece).toBe(1); // G
    await store.close();
  });

  it('shuffle + cycle: next() returns each puzzle exactly once before any repeat', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load(); // 5 in pool
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const p = filters.next();
      expect(p).toBeTruthy();
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
    }
    expect(seen.size).toBe(5);
    // 6th call wraps; reshuffled but all should still be valid pool members.
    const sixth = filters.next();
    expect(['A','C','D','E','G']).toContain(sixth.id);
    await store.close();
  });

  it('empty pool: next() returns null', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    await filters.setTheme('pin');
    await filters.setMaxStars(1); // F has stars=4 — pool is empty under stars=1
    expect(filters.pool.length).toBe(0);
    expect(filters.next()).toBeNull();
    await store.close();
  });

  it('persistence: theme + maxStars round-trip through Store', async () => {
    const store = await new Store().open();
    const f1 = await new Filters(store, POOL).load();
    await f1.setTheme('fork');
    await f1.setMaxStars(3);
    await store.close();

    const store2 = await new Store().open();
    const f2 = await new Filters(store2, POOL).load();
    expect(f2.theme).toBe('fork');
    expect(f2.maxStars).toBe(3);
    await store2.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/filters.test.js`
Expected: FAIL — `../src/filters.js` not found.

- [ ] **Step 3: Implement `src/filters.js`**

```js
// src/filters.js
// Owns the current filter state (theme + max-stars cap), builds the active
// puzzle pool from the union, persists state to IDB meta, and provides
// next() with shuffle-and-cycle ordering.

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
      const themed = id === 'all'
        ? this.allPuzzles
        : this.allPuzzles.filter((p) => p.themes.includes(id));
      out[id] = themed.filter((p) => p.stars <= this.maxStars).length;
    }
    return out;
  }

  async setTheme(t) {
    this.theme = t;
    this.rebuildPool();
    await this.persist();
  }

  async setMaxStars(n) {
    this.maxStars = n;
    this.rebuildPool();
    await this.persist();
  }

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

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/filters.test.js`
Expected: 7 tests pass.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: ~94 tests pass (87 + 7).

- [ ] **Step 6: Commit**

```bash
git add tests/filters.test.js src/filters.js
git commit -m "Add Filters module with TDD (theme + maxStars + shuffle/cycle + persistence)"
```

---

## Task 7: UI render helpers

**Files:**
- Create: `src/ui/header.js`, `src/ui/chips.js`, `src/ui/stars.js`

These three modules are stateless renderers. No unit tests — verified visually in Task 10.

- [ ] **Step 1: Create `src/ui/header.js`**

```js
// src/ui/header.js
// Renders the stats header.

export function renderStats({ solved, streak, bestStreak, today }) {
  const el = document.querySelector('#stats-header');
  if (!el) return;
  el.textContent = `✓ ${solved}   ⚡ ${streak}   ★ ${bestStreak}   Today ${today}`;
}
```

- [ ] **Step 2: Create `src/ui/chips.js`**

```js
// src/ui/chips.js
// Renders the theme-chip bar.

const THEMES = [
  { id: 'all',          label: 'All' },
  { id: 'mateIn1',      label: 'Mate 1' },
  { id: 'mateIn2',      label: 'Mate 2' },
  { id: 'fork',         label: 'Fork' },
  { id: 'pin',          label: 'Pin' },
  { id: 'hangingPiece', label: 'Hanging' },
];

export function renderChips({ active, counts, onSelect }) {
  const bar = document.querySelector('#theme-chips');
  if (!bar) return;
  bar.replaceChildren(...THEMES.map((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (t.id === active ? ' chip-active' : '');
    btn.textContent = `${t.label} ${counts[t.id] ?? 0}`;
    btn.addEventListener('click', () => onSelect(t.id));
    return btn;
  }));
}
```

- [ ] **Step 3: Create `src/ui/stars.js`**

```js
// src/ui/stars.js
// Renders the difficulty-stars bar.

export function renderStars({ cap, onSelect }) {
  const bar = document.querySelector('#difficulty-stars');
  if (!bar) return;
  bar.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'star' + (n <= cap ? ' star-on' : ' star-off');
    btn.textContent = n <= cap ? '★' : '☆';
    btn.setAttribute('aria-label', `Set difficulty to ${n}`);
    btn.addEventListener('click', () => onSelect(n));
    return btn;
  }));
}
```

- [ ] **Step 4: Smoke-check imports**

Run: `node --input-type=module -e "
import('./src/ui/header.js').then(m => console.log('header:', Object.keys(m)));
import('./src/ui/chips.js').then(m => console.log('chips:', Object.keys(m)));
import('./src/ui/stars.js').then(m => console.log('stars:', Object.keys(m)));
"`
Expected: prints `[ 'renderStats' ]`, `[ 'renderChips' ]`, `[ 'renderStars' ]`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/header.js src/ui/chips.js src/ui/stars.js
git commit -m "Add UI render helpers: stats header, theme chips, difficulty stars"
```

---

## Task 8: Layout, markup, and CSS updates

**Files:**
- Modify: `index.html`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Update `index.html` body**

Replace the contents of `<main>` with the Phase-3 layout (board moves down, stars and status below, action buttons at bottom):

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

- [ ] **Step 2: Update `src/ui/styles.css` — remove the board tilt**

Locate the `.board-stage { ... }` block (declaring `perspective`, `perspective-origin`, square colors). The block currently has both the perspective declarations AND the warm-color CSS variables. Keep the variables, drop the perspective:

Find:

```css
.board-stage {
  width: 100%;
  aspect-ratio: 1;
  perspective: 1000px;
  perspective-origin: center 60%;
}
```

Replace with:

```css
.board-stage {
  width: 100%;
  aspect-ratio: 1;
}
```

Find the `.board-stage > * { ... }` block (which has the rotateX). Drop the rotateX:

Find:

```css
.board-stage > * {
  width: 100%;
  height: 100%;
  transform: rotateX(15deg);
  transform-origin: center center;
  transition: transform 200ms ease;
  filter: drop-shadow(0 12px 16px rgba(0, 0, 0, 0.5));
}
```

Replace with:

```css
.board-stage > * {
  width: 100%;
  height: 100%;
  transition: transform 200ms ease;
  filter: drop-shadow(0 12px 16px rgba(0, 0, 0, 0.5));
}
```

- [ ] **Step 3: Update the shake-incorrect keyframes (no rotateX)**

Find:

```css
@keyframes shake-incorrect {
  0%, 100% { transform: rotateX(15deg) translateX(0); }
  20%, 60% { transform: rotateX(15deg) translateX(-8px); }
  40%, 80% { transform: rotateX(15deg) translateX(8px); }
}
```

Replace with:

```css
@keyframes shake-incorrect {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
```

- [ ] **Step 4: Append new component styles**

Append to `src/ui/styles.css`:

```css
/* Phase 3 components */

.stats-header {
  font-size: 14px;
  color: #efe6dc;
  text-align: center;
  letter-spacing: 0.5px;
  width: 100%;
  padding: 4px 0;
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
  border-color: #f0d9b5;
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

- [ ] **Step 5: Visual smoke-check (optional dev server)**

If you have a dev server running, reload and confirm:
- Board no longer tilts.
- Empty stats header / chip bar / stars bar visible (rendering happens in Task 9).

- [ ] **Step 6: Commit**

```bash
git add index.html src/ui/styles.css
git commit -m "Phase 3 layout: drop board tilt, add stats/chips/stars regions and styles"
```

---

## Task 9: Wire `app.js`

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Replace `src/app.js` with the Phase-3-aware version**

```js
// src/app.js
// Phase 3 entry point. Loads all themes, manages stats + filters,
// renders three UI regions, and orchestrates the puzzle queue.

import { PuzzleSession } from './puzzle.js';
import { Board } from './board.js';
import { loadPuzzles } from './loader.js';
import { Store } from './store.js';
import { Stats } from './stats.js';
import { Filters } from './filters.js';
import { flashCorrect, shakeIncorrect, setStatus } from './ui/feedback.js';
import { setProgress, hideProgress } from './ui/progress.js';
import { renderStats } from './ui/header.js';
import { renderChips } from './ui/chips.js';
import { renderStars } from './ui/stars.js';

const SETUP_DELAY_MS = 600;
const OPPONENT_REPLY_DELAY_MS = 400;
const POST_SOLVE_PAUSE_MS = 800;
const POST_SHOW_PAUSE_MS = 1500;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let session = null;
let board = null;
let stats = null;
let filters = null;

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

async function handleUserMove({ from, to, promotion }) {
  if (!session || session.status !== 'awaiting-user') return;
  const r = session.attemptUserMove({ from, to, promotion });
  if (r.result === 'incorrect') {
    await stats.onWrongMove();
    renderStats(stats.snapshot());
    setStatus('Try again.');
    await Promise.all([
      shakeIncorrect(board.element),
      board.setPosition(session.fen()),
    ]);
    return;
  }

  await flashCorrect(board.squareElement(to));

  if (r.solved) {
    await stats.onCorrectSolve();
    renderStats(stats.snapshot());
    setStatus('Solved!');
    await wait(POST_SOLVE_PAUSE_MS);
    await loadNextPuzzle();
    return;
  }

  await wait(OPPONENT_REPLY_DELAY_MS);
  await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
  setStatus('Find the next best move.');
}

async function handleShowSolution() {
  if (!session || session.status !== 'awaiting-user') return;
  const r = session.playSolutionStep();
  setStatus('Here\'s the next move.');
  await board.animateMove({ from: r.applied.from, to: r.applied.to });

  if (r.opponentReply) {
    await wait(OPPONENT_REPLY_DELAY_MS);
    await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
  }

  if (r.solved) {
    setStatus('Solved!');
    await stats.onSkipOrShow();
    await wait(POST_SHOW_PAUSE_MS);
    await loadNextPuzzle();
  } else {
    setStatus('Find the next best move.');
  }
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

function bindActions() {
  document.querySelector('#hint').addEventListener('click', () => {
    if (session && session.status === 'awaiting-user') {
      board.highlightSquare(session.hint().square, 'hint');
    }
  });
  document.querySelector('#show').addEventListener('click', () => {
    handleShowSolution();
  });
  document.querySelector('#skip').addEventListener('click', async () => {
    if (stats) await stats.onSkipOrShow();
    await loadNextPuzzle();
  });
}

main().catch((e) => {
  console.error(e);
  setStatus('Something went wrong. Reload the page.');
});
```

- [ ] **Step 2: Smoke-check**

Run: `node --input-type=module -e "import('./src/app.js').then(() => console.log('ok')).catch(e => console.log('IMPORT-ONLY:', e.message))"`
Expected: prints `IMPORT-ONLY: Cannot find package ...` (browser-only). What you DON'T want is a syntax error.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: ~94 tests still pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "Wire app.js to Phase 3: stats, filters, chips, stars, atomic loader"
```

---

## Task 10: Manual test pass

**Files:** none (exercise the running app, fix any code as issues are found)

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`
Expected: server on port 8000.

- [ ] **Step 2: Walk the manual checklist**

Open Chrome at `http://localhost:8000`. Use DevTools → Application → Storage → "Clear site data" between tests when noted.

1. **Fresh first launch.** Clear site data. Reload. Expect: progress bar visible briefly during the larger fetch (~2 MB), puzzle appears. Stats: all zeros + Today 0.
2. **Theme chip swap.** Tap "Fork". Pool changes; new puzzle appears. "Fork" highlighted. Counts update.
3. **Difficulty stars (down).** Tap star 1. Chip counts drop. Pool restricts to 1-star puzzles.
4. **Difficulty stars (up).** Tap star 5. Chip counts rise.
5. **Stats — clean solve.** Solve without errors. Streak 0→1, bestStreak 1, today 1, solved 1.
6. **Stats — wrong then right.** Wrong move → shake → streak 0. Solve correctly → solved + today increment, streak stays 0.
7. **Stats — skip.** Streak unchanged, solved unchanged, today unchanged.
8. **Stats — show.** Same semantics as skip.
9. **Persistence.** Reload. Stats and filter state restored.
10. **Midnight rollover.** DevTools → IDB → meta. Edit `todayDate` to a past date (e.g., `2026-04-01`). Reload. Today resets to 0.
11. **Empty pool.** Combine "Hanging" + 1 star. If zero puzzles: status "No puzzles match — try a higher difficulty." Hint/Show/Skip become no-ops.
12. **Empty-pool recovery.** Bump stars up. Pool recovers; puzzle appears.
13. **Visual.** Confirm board no longer tilts. Drop-shadow + warm cream/walnut squares still feel polished.
14. **Promotion regression.** Try a promotion puzzle (likely shows up in mateIn1 or mateIn2). Confirm queen-default still works.
15. **Build pipeline regen.** `rm data/puzzles/*.json && npm run build-puzzles`. All 5 theme files regenerate. App reload still works.

For each issue, edit the relevant file, reload, retest. Commit fixes per logical change.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "<descriptive message per fix>"
```

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from clean clone.
- [ ] All unit tests pass (~94 total).
- [ ] `data/puzzles/{index,mateIn1,mateIn2,fork,pin,hangingPiece}.json` are committed and consistent.
- [ ] Stats track correctly across all five edge cases (clean solve, wrong-then-right, skip, show, midnight rollover).
- [ ] Filter persistence works across reloads.
- [ ] Empty-pool case shows the right message and disables actions.
- [ ] Multi-theme partial-failure case: cached state preserved.
- [ ] Board tilt is gone.
- [ ] No console errors during normal operation.

---

## Self-review notes (already addressed inline)

- **Spec coverage:** Every "In scope" bullet from the spec maps to a task. The atomic multi-theme replace is covered by Task 4's loader update plus its dedicated test. The streak edge cases (clean / wrong-then-right / second-wrong / skip / show / midnight) are covered by Task 5's tests.
- **Placeholder check:** No TBD/TODO. Theme-aware fixture in Task 1's tactical test uses a known-legal synthetic K+P vs K position; if it turns out illegal in chess.js, the implementer is told to adjust.
- **Type consistency:** `Filters.setTheme/setMaxStars/next/counts` and `Stats.startPuzzle/onCorrectSolve/onWrongMove/onSkipOrShow/snapshot` are referenced consistently across tasks.
- **Test count math:** Phase 2 ended at 65. Task 1 adds ~13. Task 4 keeps net unchanged (1 partial-failure added; 1 split into more atomic tests; net ~+1). Task 5 adds 8. Task 6 adds 7. Total: 65 + 13 + 1 + 8 + 7 ≈ 94.
- **Risk surface called out:** the Task 1 tactical-test fixture may need adjustment if the chosen UCI moves aren't legal in chess.js — instructions are inline. The Phase 2 loader's existing single-theme tests are wholesale replaced (Task 4 Step 1 uses "replace contents") rather than incrementally edited; this is cleaner than trying to graft multi-theme onto Phase 2 fixtures.
