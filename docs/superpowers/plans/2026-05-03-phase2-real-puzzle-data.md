# Phase 2 Implementation Plan: Real Puzzle Data

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2 deliverable described in `docs/superpowers/specs/2026-05-03-phase2-real-puzzle-data-design.md` — replace the five hand-built mate-in-1 puzzles with ~2000 verified Lichess puzzles, fetched once and cached forever in IndexedDB.

**Architecture:** A Node ESM build script (`scripts/build-puzzles.mjs`) downloads the Lichess puzzle DB, filters, verifies via `chess.js`, and emits `data/puzzles/*.json` with a sha256 manifest. At runtime, `src/loader.js` fetches the manifest, version-checks, downloads the theme JSON if needed, sha256-verifies, and stores in IndexedDB via `src/store.js` (vendored `idb`). `src/app.js` switches from a static import to `await loadPuzzles()` with a streamed progress bar. Phase 1's hardcoded fallback is deleted.

**Tech Stack:** Node ≥18 (ESM), `chess.js` (verification), `idb` (IndexedDB wrapper, vendored), `fake-indexeddb` (test-only), `zstd` shell command for decompression, Vitest for unit tests. No bundler, no build step in deployed artifact.

---

## Background and conventions

- **Lichess CSV columns:** `PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags`. Headers in row 1. `Moves` is space-separated UCI; `Themes` is space-separated tags.
- **Lichess move convention:** `Moves[0]` is the opponent's setup move; user starts at index 1. For mate-in-1 puzzles, the array length is exactly 2.
- **Star rule:** `<800 → 1`, `800–1099 → 2`, `1100–1399 → 3`, `1400–1699 → 4`, `≥1700 → 5`.
- **Schema** (runtime + emitted JSON):
  ```json
  { "id": "00sHx", "fen": "...", "moves": ["...", "..."], "rating": 854, "themes": ["mateIn1", "short"], "stars": 1 }
  ```
- **Cap and floor:** keep top 2000 verified puzzles by `Popularity` descending; abort the build with a non-zero exit if fewer than 500 verified puzzles survive (regression guard).
- **chess.js v1.4 throws on illegal moves** — handle with try/catch in verification, treat throws as rejection.

---

## Task 1: Dependencies, vendor, import map

**Files:**
- Modify: `package.json` (add `idb` to deps, `fake-indexeddb` to devDeps, add `build-puzzles` script)
- Modify: `scripts/vendor.mjs` (vendor `idb` too)
- Modify: `index.html` (extend import map)
- Modify: `.gitignore` (ignore `.cache/`)

- [ ] **Step 1: Add `idb` and `fake-indexeddb` to package.json**

Edit the `devDependencies` section to add:

```json
  "devDependencies": {
    "chess.js": "^1.0.0",
    "cm-chessboard": "^8.0.0",
    "fake-indexeddb": "^6.0.0",
    "idb": "^8.0.0",
    "vitest": "^2.0.0"
  }
```

Add a new script under `scripts`:

```json
  "scripts": {
    "vendor": "node scripts/vendor.mjs",
    "dev": "python3 -m http.server 8000",
    "test": "vitest run",
    "test:watch": "vitest",
    "build-puzzles": "node scripts/build-puzzles.mjs"
  }
```

Note: `idb` is in devDeps because the deployed artifact reads it from `/vendor/`, not `node_modules/`. The split is purely about install footprint at deploy time (which doesn't apply since GitHub Pages serves only the static files).

- [ ] **Step 2: Run `npm install`**

Run: `npm install`
Expected: idb and fake-indexeddb install. Lockfile updates.

- [ ] **Step 3: Update `scripts/vendor.mjs` to vendor `idb`**

Replace the `vendorPackage` calls block at the bottom with:

```js
console.log('Vendoring libraries into /vendor/ ...');
const chessEntry = await vendorPackage('chess.js');
const boardEntry = await vendorPackage('cm-chessboard');
const idbEntry = await vendorPackage('idb');

const importMapHint = {
  'chess.js': `/vendor/chess.js/${chessEntry}`,
  'cm-chessboard': `/vendor/cm-chessboard/${boardEntry}`,
  'idb': `/vendor/idb/${idbEntry}`,
};
```

- [ ] **Step 4: Run the vendor script**

Run: `npm run vendor`
Expected: `vendor/idb/` directory created. Output prints the resolved entry path. Note it for Step 5.

The expected path is something like `/vendor/idb/build/index.js` (idb 8.x ships ESM). Confirm by reading the `vendor/.import-map-hint.json` file:

Run: `cat vendor/.import-map-hint.json`

- [ ] **Step 5: Update `index.html` import map**

Replace the `imports` block in `index.html` with the three entries (use the `idb` path from Step 4):

```html
    <script type="importmap">
      {
        "imports": {
          "chess.js": "/vendor/chess.js/dist/esm/chess.js",
          "cm-chessboard": "/vendor/cm-chessboard/src/Chessboard.js",
          "cm-chessboard/": "/vendor/cm-chessboard/",
          "idb": "/vendor/idb/<idb-entry-from-step-4>"
        }
      }
    </script>
```

Replace `<idb-entry-from-step-4>` with the actual resolved path.

- [ ] **Step 6: Update `.gitignore`**

Append to `.gitignore`:

```
.cache/
```

- [ ] **Step 7: Verify by running existing tests**

Run: `npm test`
Expected: all 46 tests still pass (idb addition shouldn't break anything).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json scripts/vendor.mjs index.html vendor/ .gitignore
git commit -m "Add idb dep, vendor it, extend import map; ignore .cache"
```

---

## Task 2: Build script — pure helpers (TDD)

**Files:**
- Create: `tests/build-puzzles.test.js`
- Create: `scripts/build-puzzles.mjs` (initial — pure helpers only)

The build script's pure functions are tested in isolation with fixture data. Orchestration (download, decompress, file I/O) is tested manually via Task 4's full run.

- [ ] **Step 1: Write the failing tests**

Create `tests/build-puzzles.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  parseLichessRow,
  passesFilter,
  ratingToStars,
  transformPuzzle,
  verifyPuzzle,
} from '../scripts/build-puzzles.mjs';

// Real Lichess CSV row format (from the published database):
//   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
// Themes are space-separated.
const REAL_ROW = '00sHx,q3kbnr/1pp2ppp/p1p5/4Pb2/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 1 7,e8e7 b1c3,854,80,93,3719,advantage middlegame short,https://lichess.org/a1b2c3#13,';
// A back-rank mate-in-1 we control (uses the Phase 1 fixture position).
const SYNTHETIC_M1 = {
  id: 'TEST_M1',
  fen: '6k1/5ppp/2n5/8/8/8/8/R5K1 b - - 0 1',
  movesArr: ['c6e5', 'a1a8'],
  rating: 800,
  popularity: 99,
  themes: ['mateIn1', 'backRankMate'],
};

describe('parseLichessRow', () => {
  it('parses all 10 columns', () => {
    const r = parseLichessRow(REAL_ROW);
    expect(r.id).toBe('00sHx');
    expect(r.fen).toBe('q3kbnr/1pp2ppp/p1p5/4Pb2/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 1 7');
    expect(r.movesArr).toEqual(['e8e7', 'b1c3']);
    expect(r.rating).toBe(854);
    expect(r.popularity).toBe(93);
    expect(r.themes).toEqual(['advantage', 'middlegame', 'short']);
  });

  it('handles empty trailing fields', () => {
    const line = '99zzz,8/8/8/8/8/8/8/8 w - - 0 1,a1a2,500,50,10,5,mateIn1,,';
    const r = parseLichessRow(line);
    expect(r.id).toBe('99zzz');
    expect(r.themes).toEqual(['mateIn1']);
  });
});

describe('passesFilter', () => {
  it('accepts a mateIn1 with 2 moves and rating ≤ 1200', () => {
    const r = {
      themes: ['mateIn1', 'short'], rating: 900, movesArr: ['e2e4', 'e7e5']
    };
    expect(passesFilter(r)).toBe(true);
  });

  it('rejects rating > 1200', () => {
    const r = { themes: ['mateIn1'], rating: 1201, movesArr: ['a','b'] };
    expect(passesFilter(r)).toBe(false);
  });

  it('rejects when not mateIn1', () => {
    const r = { themes: ['fork', 'short'], rating: 900, movesArr: ['a','b'] };
    expect(passesFilter(r)).toBe(false);
  });

  it('rejects when move count is not exactly 2', () => {
    const r1 = { themes: ['mateIn1'], rating: 800, movesArr: ['a'] };
    const r3 = { themes: ['mateIn1'], rating: 800, movesArr: ['a','b','c'] };
    expect(passesFilter(r1)).toBe(false);
    expect(passesFilter(r3)).toBe(false);
  });
});

describe('ratingToStars', () => {
  it('maps boundary values per the spec', () => {
    expect(ratingToStars(700)).toBe(1);
    expect(ratingToStars(799)).toBe(1);
    expect(ratingToStars(800)).toBe(2);
    expect(ratingToStars(1099)).toBe(2);
    expect(ratingToStars(1100)).toBe(3);
    expect(ratingToStars(1399)).toBe(3);
    expect(ratingToStars(1400)).toBe(4);
    expect(ratingToStars(1699)).toBe(4);
    expect(ratingToStars(1700)).toBe(5);
    expect(ratingToStars(2000)).toBe(5);
  });
});

describe('transformPuzzle', () => {
  it('produces the runtime schema', () => {
    const row = {
      id: 'X1', fen: 'fen-here', movesArr: ['e2e4', 'e7e5'],
      rating: 850, themes: ['mateIn1', 'short'], popularity: 50
    };
    expect(transformPuzzle(row)).toEqual({
      id: 'X1', fen: 'fen-here', moves: ['e2e4', 'e7e5'],
      rating: 850, themes: ['mateIn1', 'short'], stars: 2,
    });
  });
});

describe('verifyPuzzle', () => {
  it('accepts a valid mate-in-1', () => {
    const r = verifyPuzzle(SYNTHETIC_M1);
    expect(r.ok).toBe(true);
  });

  it('rejects a broken FEN', () => {
    const r = verifyPuzzle({ ...SYNTHETIC_M1, fen: 'not-a-fen' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-fen');
  });

  it('rejects when the opponent setup move is illegal', () => {
    const r = verifyPuzzle({ ...SYNTHETIC_M1, movesArr: ['e2e4', 'a1a8'] }); // e2e4 not legal in this fen
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('illegal-setup');
  });

  it('rejects when the user move is illegal', () => {
    const r = verifyPuzzle({ ...SYNTHETIC_M1, movesArr: ['c6e5', 'h2h4'] }); // h2h4 not legal (no pawn there)
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('illegal-user-move');
  });

  it('rejects when the user move does not deliver mate', () => {
    // Same fixture but replace mate move with a non-mate move (Kg2).
    const r = verifyPuzzle({ ...SYNTHETIC_M1, movesArr: ['c6e5', 'g1g2'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-mate');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/build-puzzles.test.js`
Expected: FAIL — module `../scripts/build-puzzles.mjs` cannot be resolved.

- [ ] **Step 3: Create `scripts/build-puzzles.mjs` with the pure helpers**

```js
// scripts/build-puzzles.mjs
//
// Build pipeline: downloads the Lichess puzzle database, filters to mate-in-1
// puzzles with rating ≤ 1200, verifies each via chess.js, sorts by Popularity,
// caps at 2000, and emits data/puzzles/{mateIn1.json, index.json, rejected.log}.
//
// Run via: npm run build-puzzles  [-- --refresh]
//   --refresh forces re-download of the source CSV.

import { Chess } from 'chess.js';
import { parseUci } from '../src/uci.js';

// ───────── Pure helpers (exported for tests) ─────────

export function parseLichessRow(line) {
  // Lichess CSV columns:
  //   0 PuzzleId
  //   1 FEN
  //   2 Moves        (space-separated UCI)
  //   3 Rating       (integer)
  //   4 RatingDeviation
  //   5 Popularity   (integer; can be negative)
  //   6 NbPlays
  //   7 Themes       (space-separated tags)
  //   8 GameUrl
  //   9 OpeningTags
  const cols = line.split(',');
  if (cols.length < 8) {
    throw new Error(`Malformed CSV row (${cols.length} cols): ${line.slice(0, 80)}`);
  }
  return {
    id: cols[0],
    fen: cols[1],
    movesArr: cols[2].split(' ').filter(Boolean),
    rating: Number(cols[3]),
    ratingDeviation: Number(cols[4]),
    popularity: Number(cols[5]),
    nbPlays: Number(cols[6]),
    themes: cols[7].split(' ').filter(Boolean),
    gameUrl: cols[8] ?? '',
    openingTags: (cols[9] ?? '').split(' ').filter(Boolean),
  };
}

export function passesFilter(row) {
  if (!row.themes.includes('mateIn1')) return false;
  if (row.rating > 1200) return false;
  if (row.movesArr.length !== 2) return false;
  return true;
}

export function ratingToStars(rating) {
  if (rating < 800) return 1;
  if (rating < 1100) return 2;
  if (rating < 1400) return 3;
  if (rating < 1700) return 4;
  return 5;
}

export function transformPuzzle(row) {
  return {
    id: row.id,
    fen: row.fen,
    moves: row.movesArr,
    rating: row.rating,
    themes: row.themes,
    stars: ratingToStars(row.rating),
  };
}

export function verifyPuzzle(row) {
  let chess;
  try {
    chess = new Chess(row.fen);
  } catch (e) {
    return { ok: false, reason: 'bad-fen', detail: e.message };
  }

  // Apply moves[0] (opponent setup).
  try {
    const m = parseUci(row.movesArr[0]);
    const result = chess.move(m);
    if (!result) return { ok: false, reason: 'illegal-setup' };
  } catch (e) {
    return { ok: false, reason: 'illegal-setup', detail: e.message };
  }

  // Apply moves[1] (user mate).
  try {
    const m = parseUci(row.movesArr[1]);
    const result = chess.move(m);
    if (!result) return { ok: false, reason: 'illegal-user-move' };
  } catch (e) {
    return { ok: false, reason: 'illegal-user-move', detail: e.message };
  }

  if (!chess.isCheckmate()) {
    return { ok: false, reason: 'not-mate' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/build-puzzles.test.js`
Expected: 14 tests pass.

- [ ] **Step 5: Run all tests to confirm no regressions**

Run: `npm test`
Expected: 60 tests pass (46 prior + 14 new).

- [ ] **Step 6: Commit**

```bash
git add scripts/build-puzzles.mjs tests/build-puzzles.test.js
git commit -m "Add build-puzzles pure helpers (parseLichessRow, filter, verify, transform)"
```

---

## Task 3: Build script — orchestration

**Files:**
- Modify: `scripts/build-puzzles.mjs` (append orchestration)

This task adds the I/O glue: download, decompress, stream-parse, sort, cap, write JSON files, write rejected.log, print report. Not unit-tested — exercised end-to-end in Task 4.

- [ ] **Step 1: Append orchestration to `scripts/build-puzzles.mjs`**

```js
// ───────── Orchestration ─────────

import { mkdir, readFile, writeFile, stat, appendFile, rm } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CACHE_DIR = join(REPO_ROOT, '.cache');
const ZST_PATH = join(CACHE_DIR, 'lichess_puzzles.csv.zst');
const CSV_PATH = join(CACHE_DIR, 'lichess_puzzles.csv');
const DATA_DIR = join(REPO_ROOT, 'data', 'puzzles');
const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const CAP = 2000;
const FLOOR = 500;

async function downloadIfNeeded({ refresh }) {
  await mkdir(CACHE_DIR, { recursive: true });
  if (!refresh && existsSync(ZST_PATH)) {
    console.log(`[cache] using existing ${ZST_PATH}`);
    return;
  }
  console.log(`[download] ${URL}`);
  // Use a streamed fetch to avoid loading hundreds of MB into memory.
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const file = createWriteStream(ZST_PATH);
  let bytes = 0;
  for await (const chunk of res.body) {
    file.write(chunk);
    bytes += chunk.byteLength;
    if (bytes % (16 * 1024 * 1024) < chunk.byteLength) {
      process.stdout.write(`  ${(bytes / 1024 / 1024).toFixed(1)} MB\r`);
    }
  }
  await new Promise((resolve, reject) => file.end((err) => err ? reject(err) : resolve()));
  console.log(`\n[download] saved ${(bytes / 1024 / 1024).toFixed(1)} MB to ${ZST_PATH}`);
}

async function decompressIfNeeded() {
  if (existsSync(CSV_PATH)) {
    const csvStat = await stat(CSV_PATH);
    const zstStat = await stat(ZST_PATH);
    if (csvStat.mtimeMs >= zstStat.mtimeMs) {
      console.log(`[zstd] using existing ${CSV_PATH}`);
      return;
    }
  }
  console.log(`[zstd] decompressing → ${CSV_PATH}`);
  await new Promise((resolve, reject) => {
    const child = spawn('zstd', ['-d', '--keep', '-f', ZST_PATH, '-o', CSV_PATH], { stdio: 'inherit' });
    child.on('error', (err) => reject(new Error(`Failed to spawn 'zstd': ${err.message} (is it installed?)`)));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`zstd exited with ${code}`)));
  });
}

async function streamFilterVerify() {
  const rejected = [];
  const candidates = [];
  const stats = {
    rowsScanned: 0,
    keptAfterFilter: 0,
    keptAfterVerify: 0,
    rejections: {},
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
      // Genuinely malformed line — count as rejection.
      bumpRejection(stats, 'malformed-row');
      rejected.push({ id: '?', reason: 'malformed-row', detail: line.slice(0, 80) });
      continue;
    }

    if (!passesFilter(row)) {
      const reason = !row.themes.includes('mateIn1') ? 'non-mateIn1-theme'
        : row.rating > 1200 ? 'rating-too-high'
        : 'wrong-move-count';
      bumpRejection(stats, reason);
      rejected.push({ id: row.id, reason });
      continue;
    }
    stats.keptAfterFilter++;

    const v = verifyPuzzle(row);
    if (!v.ok) {
      bumpRejection(stats, v.reason);
      rejected.push({ id: row.id, reason: v.reason, detail: v.detail });
      continue;
    }
    stats.keptAfterVerify++;
    candidates.push(row);

    if (stats.rowsScanned % 100000 === 0) {
      process.stdout.write(`  scanned ${stats.rowsScanned}, verified ${stats.keptAfterVerify}\r`);
    }
  }
  console.log(`\n[parse] scanned ${stats.rowsScanned}, verified ${stats.keptAfterVerify}`);
  return { candidates, rejected, stats };
}

function bumpRejection(stats, reason) {
  stats.rejections[reason] = (stats.rejections[reason] || 0) + 1;
}

function sortAndCap(candidates) {
  candidates.sort((a, b) => b.popularity - a.popularity);
  const kept = candidates.slice(0, CAP);
  const overCap = candidates.slice(CAP).map((c) => ({ id: c.id, reason: 'over-cap' }));
  return { kept, overCap };
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function writeOutputs(kept, allRejected, stats) {
  await mkdir(DATA_DIR, { recursive: true });

  const version = todayIso();
  const generatedAt = new Date().toISOString();

  const themeFile = {
    version,
    theme: 'mateIn1',
    puzzles: kept.map(transformPuzzle),
  };
  const themeJson = JSON.stringify(themeFile, null, 0); // minified to keep transfer small
  const themePath = join(DATA_DIR, 'mateIn1.json');
  await writeFile(themePath, themeJson, 'utf8');
  const sha256 = sha256Hex(Buffer.from(themeJson, 'utf8'));

  const indexFile = {
    version,
    generatedAt,
    themes: [
      { name: 'mateIn1', file: 'mateIn1.json', count: kept.length, sha256 },
    ],
  };
  await writeFile(join(DATA_DIR, 'index.json'), JSON.stringify(indexFile, null, 2), 'utf8');

  const rejectedPath = join(DATA_DIR, 'rejected.log');
  // One line per rejection: <id>\t<reason>\t<detail>
  const lines = allRejected.map((r) => `${r.id}\t${r.reason}\t${r.detail ?? ''}`).join('\n') + '\n';
  await writeFile(rejectedPath, lines, 'utf8');

  return { themePath, themeBytes: Buffer.byteLength(themeJson, 'utf8'), sha256 };
}

function printReport(stats, kept, themeBytes, sha256) {
  console.log('\n────────── Build report ──────────');
  console.log(`  rows scanned:        ${stats.rowsScanned}`);
  console.log(`  kept after filter:   ${stats.keptAfterFilter}`);
  console.log(`  kept after verify:   ${stats.keptAfterVerify}`);
  console.log(`  written to JSON:     ${kept.length}`);
  console.log(`  theme file size:     ${(themeBytes / 1024).toFixed(1)} KB`);
  console.log(`  sha256:              ${sha256}`);
  console.log(`  rejection histogram:`);
  for (const [reason, count] of Object.entries(stats.rejections).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason.padEnd(22)}: ${count}`);
  }
  console.log('───────────────────────────────────\n');
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  await downloadIfNeeded({ refresh });
  await decompressIfNeeded();
  const { candidates, rejected, stats } = await streamFilterVerify();
  const { kept, overCap } = sortAndCap(candidates);
  for (const r of overCap) {
    bumpRejection(stats, 'over-cap');
    rejected.push(r);
  }

  if (kept.length < FLOOR) {
    throw new Error(
      `Only ${kept.length} verified puzzles, expected ≥ ${FLOOR}. ` +
      'Lichess may have changed their schema. Inspect rejected.log.',
    );
  }

  const { themeBytes, sha256 } = await writeOutputs(kept, rejected, stats);
  printReport(stats, kept, themeBytes, sha256);
}

// Only run main() when invoked as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('\n[error]', err.message);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Sanity-check the file imports**

Run: `node --input-type=module -e "import('./scripts/build-puzzles.mjs').then(m => console.log(Object.keys(m).filter(k => !k.startsWith('_'))))"`
Expected: prints `[ 'parseLichessRow', 'passesFilter', 'ratingToStars', 'transformPuzzle', 'verifyPuzzle' ]` (without running `main()` because the import-only check skips it).

- [ ] **Step 3: Run the existing tests**

Run: `npm test`
Expected: still 60 tests pass — adding orchestration code doesn't break the pure-helper tests.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-puzzles.mjs
git commit -m "Add build-puzzles orchestration: download, decompress, stream-parse, write outputs"
```

---

## Task 4: Run the build script and commit data

**Files:**
- Create: `data/puzzles/mateIn1.json`
- Create: `data/puzzles/index.json`
- Create: `data/puzzles/rejected.log`

This task runs the pipeline end-to-end, downloads ~150MB of source data, and produces the committed output. **Requires `zstd` on the system PATH** (Fedora: `dnf install zstd` if missing; default on most distros).

- [ ] **Step 1: Verify `zstd` is available**

Run: `which zstd`
Expected: prints a path. If not, install with `dnf install -y zstd` (Fedora) or equivalent.

- [ ] **Step 2: Run the full pipeline**

Run: `npm run build-puzzles`
Expected:
- Downloads ~150MB to `.cache/lichess_puzzles.csv.zst` (takes 1–10 minutes depending on bandwidth).
- Decompresses to `.cache/lichess_puzzles.csv` (~1GB).
- Streams the CSV, prints periodic progress.
- Writes `data/puzzles/mateIn1.json` (target 2000 entries, ~400 KB).
- Writes `data/puzzles/index.json` with version, count, sha256.
- Writes `data/puzzles/rejected.log`.
- Prints a build report showing `kept after verify` ≥ 2000 (with overflow going to `over-cap`) and a rejection histogram.

If the run aborts with `Only N verified puzzles, expected ≥ 500`, inspect `data/puzzles/rejected.log` and re-evaluate the filter logic.

- [ ] **Step 3: Sanity-check outputs**

Run: `cat data/puzzles/index.json | head -30`
Expected: valid JSON with `version` (today's date), `themes[0].count` of 2000, `themes[0].sha256` is 64 hex chars.

Run: `node --input-type=module -e "
import { readFile } from 'node:fs/promises';
const j = JSON.parse(await readFile('data/puzzles/mateIn1.json', 'utf8'));
console.log('version:', j.version, 'theme:', j.theme, 'count:', j.puzzles.length);
console.log('first puzzle id:', j.puzzles[0].id);
console.log('first puzzle stars:', j.puzzles[0].stars);
"`
Expected: count 2000, first puzzle id is a real Lichess id (5 chars), stars in 1–3 range.

- [ ] **Step 4: Verify the sha256 manifest claim matches the file**

Run: `node --input-type=module -e "
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const themeJson = await readFile('data/puzzles/mateIn1.json', 'utf8');
const sha = createHash('sha256').update(themeJson).digest('hex');
const index = JSON.parse(await readFile('data/puzzles/index.json', 'utf8'));
console.log('file sha256:    ', sha);
console.log('manifest sha256:', index.themes[0].sha256);
console.log('match:', sha === index.themes[0].sha256);
"`
Expected: `match: true`.

- [ ] **Step 5: Commit the data**

```bash
git add data/puzzles/
git commit -m "Generate Phase 2 puzzle data: ~2000 mate-in-1 puzzles from Lichess"
```

---

## Task 5: `src/store.js` — IndexedDB wrapper (TDD)

**Files:**
- Create: `tests/store.test.js`
- Create: `src/store.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/store.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';            // installs fake indexedDB on globalThis
import { IDBFactory } from 'fake-indexeddb';
import { Store } from '../src/store.js';

const SAMPLE_PUZZLES = [
  { id: 'A1', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 },
  { id: 'B2', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['b1b2','b3b4'], rating: 800, themes: ['mateIn1'], stars: 2 },
  { id: 'C3', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['c1c2','c3c4'], rating: 900, themes: ['mateIn1'], stars: 2 },
];

beforeEach(() => {
  // Reset the fake-indexeddb so each test starts with a clean DB.
  globalThis.indexedDB = new IDBFactory();
});

describe('Store', () => {
  it('open creates the meta and puzzles object stores', async () => {
    const store = await new Store().open();
    const dbNames = (await indexedDB.databases?.()) ?? [];
    // We can verify by writing/reading meta and puzzles below.
    expect(await store.getVersion()).toBeUndefined();
    expect(await store.getAllPuzzles()).toEqual([]);
    await store.close();
  });

  it('round-trips version', async () => {
    const store = await new Store().open();
    await store.setVersion('2026-05-03');
    expect(await store.getVersion()).toBe('2026-05-03');
    await store.close();
  });

  it('round-trips lastFetch', async () => {
    const store = await new Store().open();
    await store.setLastFetch(1234567890);
    expect(await store.getLastFetch()).toBe(1234567890);
    await store.close();
  });

  it('replacePuzzles writes all entries', async () => {
    const store = await new Store().open();
    await store.replacePuzzles('mateIn1', SAMPLE_PUZZLES);
    const got = await store.getAllPuzzles();
    expect(got.length).toBe(3);
    expect(got.map((p) => p.id).sort()).toEqual(['A1', 'B2', 'C3']);
    await store.close();
  });

  it('replacePuzzles replaces, not appends', async () => {
    const store = await new Store().open();
    await store.replacePuzzles('mateIn1', SAMPLE_PUZZLES);
    await store.replacePuzzles('mateIn1', [SAMPLE_PUZZLES[0]]);
    const got = await store.getAllPuzzles();
    expect(got.length).toBe(1);
    expect(got[0].id).toBe('A1');
    await store.close();
  });

  it('persists across close + reopen', async () => {
    const s1 = await new Store().open();
    await s1.replacePuzzles('mateIn1', SAMPLE_PUZZLES);
    await s1.setVersion('v1');
    await s1.close();

    const s2 = await new Store().open();
    expect(await s2.getVersion()).toBe('v1');
    expect((await s2.getAllPuzzles()).length).toBe(3);
    await s2.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/store.test.js`
Expected: FAIL — module `../src/store.js` not found.

- [ ] **Step 3: Implement `src/store.js`**

```js
// src/store.js
// Promise-based IndexedDB wrapper. Two object stores:
//   meta:    keyPath 'key';  rows shaped { key, value }
//   puzzles: keyPath 'id';   rows are full puzzle objects
//
// The store uses the global `indexedDB`. In production this is the browser's
// native IDB; in tests, `fake-indexeddb/auto` replaces it before this module
// is imported.

import { openDB } from 'idb';

const DB_NAME = 'chess-puzzles';
const DB_VERSION = 1;

export class Store {
  constructor() {
    this.db = null;
  }

  async open() {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('puzzles')) {
          db.createObjectStore('puzzles', { keyPath: 'id' });
        }
      },
    });
    return this;
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async getMeta(key) {
    const row = await this.db.get('meta', key);
    return row?.value;
  }

  async setMeta(key, value) {
    await this.db.put('meta', { key, value });
  }

  getVersion()  { return this.getMeta('version'); }
  setVersion(v) { return this.setMeta('version', v); }
  getLastFetch()  { return this.getMeta('lastFetch'); }
  setLastFetch(v) { return this.setMeta('lastFetch', v); }

  async getAllPuzzles() {
    return await this.db.getAll('puzzles');
  }

  // For Phase 2 (single theme): clear the entire puzzles store and insert all.
  // The `theme` parameter is reserved for Phase 3 multi-theme support.
  async replacePuzzles(theme, puzzles) {
    const tx = this.db.transaction('puzzles', 'readwrite');
    const store = tx.objectStore('puzzles');
    await store.clear();
    for (const p of puzzles) {
      await store.put(p);
    }
    await tx.done;
  }
}
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/store.test.js`
Expected: 6 tests pass.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 66 tests pass (60 + 6).

- [ ] **Step 6: Commit**

```bash
git add tests/store.test.js src/store.js
git commit -m "Add IndexedDB Store wrapper with TDD (open, getAll, replace, version)"
```

---

## Task 6: `src/loader.js` — fetch + cache orchestrator (TDD)

**Files:**
- Create: `tests/loader.test.js`
- Create: `src/loader.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/loader.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { loadPuzzles, LoaderError } from '../src/loader.js';
import { Store } from '../src/store.js';

const SAMPLE_THEME_FILE = JSON.stringify({
  version: '2026-05-03',
  theme: 'mateIn1',
  puzzles: [
    { id: 'X1', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 },
    { id: 'X2', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['b1b2','b3b4'], rating: 800, themes: ['mateIn1'], stars: 2 },
  ],
});

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function makeIndexJson(version, sha256) {
  return JSON.stringify({
    version,
    generatedAt: new Date().toISOString(),
    themes: [{ name: 'mateIn1', file: 'mateIn1.json', count: 2, sha256 }],
  });
}

function makeFetch({ indexJson, themeJson, themeFails = false, indexFails = false }) {
  return vi.fn(async (url) => {
    if (typeof url === 'string') url = new URL(url, 'http://localhost/');
    const path = url.pathname || url.toString();
    if (path.endsWith('index.json')) {
      if (indexFails) throw new Error('network error');
      return new Response(indexJson, { status: 200 });
    }
    if (path.endsWith('mateIn1.json')) {
      if (themeFails) throw new Error('network error');
      return new Response(themeJson, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('loadPuzzles', () => {
  it('first launch: fetches, sha256-verifies, populates IDB, returns puzzles', async () => {
    const sha = await sha256Hex(SAMPLE_THEME_FILE);
    const indexJson = makeIndexJson('2026-05-03', sha);
    const fetch = makeFetch({ indexJson, themeJson: SAMPLE_THEME_FILE });
    const store = await new Store().open();

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles).toHaveLength(2);
    expect(await store.getVersion()).toBe('2026-05-03');
    expect((await store.getAllPuzzles()).length).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2); // index + theme
    await store.close();
  });

  it('subsequent launch with same version: no theme refetch', async () => {
    const sha = await sha256Hex(SAMPLE_THEME_FILE);
    const fetch = makeFetch({ indexJson: makeIndexJson('v1', sha), themeJson: SAMPLE_THEME_FILE });
    const store = await new Store().open();
    // Seed cache.
    await store.replacePuzzles('mateIn1', JSON.parse(SAMPLE_THEME_FILE).puzzles);
    await store.setVersion('v1');

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1); // only index.json
    await store.close();
  });

  it('subsequent launch with newer version: refetches and replaces', async () => {
    const sha = await sha256Hex(SAMPLE_THEME_FILE);
    const fetch = makeFetch({ indexJson: makeIndexJson('v2', sha), themeJson: SAMPLE_THEME_FILE });
    const store = await new Store().open();
    await store.replacePuzzles('mateIn1', [{ id: 'OLD', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 }]);
    await store.setVersion('v1');

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles.map((p) => p.id).sort()).toEqual(['X1', 'X2']);
    expect(await store.getVersion()).toBe('v2');
    await store.close();
  });

  it('offline with cached data: returns cache, does not throw', async () => {
    const fetch = makeFetch({ indexFails: true, indexJson: '', themeJson: '' });
    const store = await new Store().open();
    await store.replacePuzzles('mateIn1', JSON.parse(SAMPLE_THEME_FILE).puzzles);
    await store.setVersion('v1');

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles).toHaveLength(2);
    await store.close();
  });

  it('offline first launch: throws LoaderError', async () => {
    const fetch = makeFetch({ indexFails: true, indexJson: '', themeJson: '' });
    const store = await new Store().open();

    await expect(loadPuzzles('mateIn1', { fetch, store })).rejects.toThrow(LoaderError);
    await store.close();
  });

  it('sha256 mismatch: keeps cache, does not replace', async () => {
    const fetch = makeFetch({
      indexJson: makeIndexJson('v2', '0000000000000000000000000000000000000000000000000000000000000000'),
      themeJson: SAMPLE_THEME_FILE,
    });
    const store = await new Store().open();
    const original = [{ id: 'OLD', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 }];
    await store.replacePuzzles('mateIn1', original);
    await store.setVersion('v1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles).toEqual(original);
    expect(await store.getVersion()).toBe('v1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await store.close();
  });

  it('progress callback fires during theme fetch', async () => {
    const sha = await sha256Hex(SAMPLE_THEME_FILE);
    const fetch = makeFetch({ indexJson: makeIndexJson('v1', sha), themeJson: SAMPLE_THEME_FILE });
    const store = await new Store().open();
    const onProgress = vi.fn();

    await loadPuzzles('mateIn1', { fetch, store, onProgress });

    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBeGreaterThan(0); // loaded > 0
    await store.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/loader.test.js`
Expected: FAIL — `../src/loader.js` not found.

- [ ] **Step 3: Implement `src/loader.js`**

```js
// src/loader.js
// Orchestrates fetch + IndexedDB caching for puzzle data.
// Public API: loadPuzzles(theme, opts) → Promise<Puzzle[]>

import { Store } from './store.js';

export class LoaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoaderError';
  }
}

const DEFAULT_BASE = '/data/puzzles';

export async function loadPuzzles(theme = 'mateIn1', opts = {}) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const store = opts.store ?? await new Store().open();
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? 5000;
  const onProgress = opts.onProgress;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE;

  // Read cache.
  const [cachedPuzzles, localVersion] = await Promise.all([
    store.getAllPuzzles(),
    store.getVersion(),
  ]);

  // Try to fetch the manifest.
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

  // Need to (re)fetch the theme file.
  const themeMeta = index.themes.find((t) => t.name === theme);
  if (!themeMeta) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`theme '${theme}' not in manifest`);
  }

  let themeBytes, themeText;
  try {
    ({ bytes: themeBytes, text: themeText } = await fetchWithProgress(
      fetchFn,
      `${baseUrl}/${themeMeta.file}`,
      onProgress,
      fetchTimeoutMs,
    ));
  } catch (err) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`failed to fetch theme: ${err.message}`);
  }

  // sha256-verify.
  const computedSha = await sha256Hex(themeBytes);
  if (computedSha.toLowerCase() !== themeMeta.sha256.toLowerCase()) {
    console.warn(
      `[loader] sha256 mismatch for ${themeMeta.file}: expected ${themeMeta.sha256}, got ${computedSha}. Keeping cached data.`,
    );
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError('downloaded theme failed integrity check');
  }

  // Parse and store.
  let parsed;
  try {
    parsed = JSON.parse(themeText);
  } catch (err) {
    if (cachedPuzzles.length > 0) return cachedPuzzles;
    throw new LoaderError(`theme JSON parse failed: ${err.message}`);
  }

  await store.replacePuzzles(theme, parsed.puzzles);
  await store.setVersion(index.version);
  await store.setLastFetch(Date.now());

  return parsed.puzzles;
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

async function fetchWithProgress(fetchFn, url, onProgress, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get('Content-Length')) || 0;

    // If the response body isn't a ReadableStream (e.g., in older test mocks),
    // fall back to arrayBuffer.
    if (!res.body || typeof res.body.getReader !== 'function') {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (onProgress) onProgress(buf.byteLength, buf.byteLength);
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
      if (onProgress) onProgress(loaded, total);
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

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/loader.test.js`
Expected: 7 tests pass.

If a test fails due to fake `Response` lacking `body.getReader`, the loader falls back to `arrayBuffer` automatically — but `onProgress` will only fire once (with `loaded === total`). The progress test still passes in that case because the assertion is just `loaded > 0`.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 73 tests pass (66 + 7).

- [ ] **Step 6: Commit**

```bash
git add tests/loader.test.js src/loader.js
git commit -m "Add loader: fetch + sha256-verify + IndexedDB caching with offline fallback"
```

---

## Task 7: Progress UI helper

**Files:**
- Create: `src/ui/progress.js`
- Modify: `index.html` (add `<progress>` element)
- Modify: `src/ui/styles.css` (style the progress bar)

- [ ] **Step 1: Add `<progress>` element to `index.html`**

Inside `<main>`, after the `<p id="status">` line, add:

```html
      <progress id="loading-progress" class="loading-progress" max="100" value="0" hidden></progress>
```

- [ ] **Step 2: Create `src/ui/progress.js`**

```js
// src/ui/progress.js
// Tiny wrapper around the #loading-progress element.

export function setProgress(loaded, total) {
  const el = document.querySelector('#loading-progress');
  if (!el) return;
  el.hidden = false;
  if (total > 0) {
    el.value = Math.round((loaded / total) * 100);
  } else {
    el.removeAttribute('value'); // indeterminate state
  }
}

export function hideProgress() {
  const el = document.querySelector('#loading-progress');
  if (el) {
    el.hidden = true;
    el.value = 0;
  }
}
```

- [ ] **Step 3: Add styles for the progress bar**

Append to `src/ui/styles.css`:

```css
/* Loading progress bar shown during first-run puzzle fetch. */
.loading-progress {
  width: 100%;
  height: 12px;
  border: 2px solid #5a3a22;
  border-radius: 6px;
  background: #2a201a;
  appearance: none;
  -webkit-appearance: none;
  overflow: hidden;
}

.loading-progress::-webkit-progress-bar {
  background: #2a201a;
}

.loading-progress::-webkit-progress-value {
  background: #f0d9b5;
  transition: width 200ms ease;
}

.loading-progress::-moz-progress-bar {
  background: #f0d9b5;
}
```

- [ ] **Step 4: Smoke-check the file imports**

Run: `node --input-type=module -e "import('./src/ui/progress.js').then(m => console.log(Object.keys(m)))"`
Expected: prints `[ 'setProgress', 'hideProgress' ]`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/progress.js index.html src/ui/styles.css
git commit -m "Add loading progress bar (markup, helper, styles)"
```

---

## Task 8: Wire `app.js` to use the loader

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Replace static import + main() with loader-driven version**

Replace the contents of `src/app.js` with:

```js
// src/app.js
// Phase 2 entry point. Loads puzzles from IndexedDB (fetched once on first
// run); orchestrates the puzzle queue, timing, and Hint/Show/Skip wiring.

import { PuzzleSession } from './puzzle.js';
import { Board } from './board.js';
import { loadPuzzles } from './loader.js';
import { flashCorrect, shakeIncorrect, setStatus } from './ui/feedback.js';
import { setProgress, hideProgress } from './ui/progress.js';

const SETUP_DELAY_MS = 600;
const OPPONENT_REPLY_DELAY_MS = 400;
const POST_SOLVE_PAUSE_MS = 800;
const POST_SHOW_PAUSE_MS = 1500;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let queueIndex = 0;
let session = null;
let board = null;
let puzzles = [];

async function loadNextPuzzle() {
  const puzzle = puzzles[queueIndex % puzzles.length];
  queueIndex += 1;
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
    setStatus('Try again.');
    await Promise.all([
      shakeIncorrect(board.element),
      board.setPosition(session.fen()),
    ]);
    return;
  }

  await flashCorrect(board.squareElement(to));

  if (r.solved) {
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
  setStatus('Here’s the next move.');
  await board.animateMove({ from: r.applied.from, to: r.applied.to });

  if (r.opponentReply) {
    await wait(OPPONENT_REPLY_DELAY_MS);
    await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
  }

  if (r.solved) {
    setStatus('Solved!');
    await wait(POST_SHOW_PAUSE_MS);
    await loadNextPuzzle();
  } else {
    setStatus('Find the next best move.');
  }
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
  document.querySelector('#skip').addEventListener('click', () => {
    loadNextPuzzle();
  });
}

async function main() {
  setStatus('Loading puzzles…');
  board = new Board('#board', { onUserMove: handleUserMove });
  bindActions();

  try {
    puzzles = await loadPuzzles('mateIn1', {
      onProgress: (loaded, total) => setProgress(loaded, total),
    });
  } catch (err) {
    console.error(err);
    setStatus('Need internet on first run. Reload when online.');
    hideProgress();
    return;
  }

  hideProgress();
  await loadNextPuzzle();
}

main().catch((e) => {
  console.error(e);
  setStatus('Something went wrong. Reload the page.');
});
```

- [ ] **Step 2: Smoke-check**

Run: `node --input-type=module -e "import('./src/app.js').then(() => console.log('ok')).catch(e => console.log('IMPORT-ONLY:', e.message))"`
Expected: prints `IMPORT-ONLY: Cannot find package ...` (the bare-specifier resolution failure for `cm-chessboard` or `chess.js` or `idb` in Node — same as Phase 1; it's browser-only). What you DON'T want is a syntax error.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: 73 tests still pass (no regressions). The puzzles-phase1 test file still exists at this point, with its own static import — Task 9 deletes it.

Actually wait — `tests/puzzles-phase1.test.js` imports from `src/puzzles-phase1.js`. Both still exist after Task 8. They should still pass.

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "Wire app.js to use loadPuzzles instead of static phase1Puzzles import"
```

---

## Task 9: Remove obsolete Phase 1 fallback

**Files:**
- Delete: `src/puzzles-phase1.js`
- Delete: `tests/puzzles-phase1.test.js`

- [ ] **Step 1: Verify nothing else imports from `src/puzzles-phase1.js`**

Run: `grep -rn "puzzles-phase1" src tests scripts | grep -v "^docs/" | grep -v ".md:"`
Expected: only `tests/puzzles-phase1.test.js` matches (which we're about to delete). If any other file matches, fix it before deleting.

- [ ] **Step 2: Delete the files**

Run: `rm src/puzzles-phase1.js tests/puzzles-phase1.test.js`

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: tests still pass, count drops by the 7 puzzles-phase1 tests → 66 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Remove Phase 1 hardcoded puzzle fallback (replaced by loader + IndexedDB)"
```

---

## Task 10: Manual test pass

**Files:** none (exercise the running app, fix any code issues found)

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`
Expected: server starts on port 8000.

- [ ] **Step 2: Walk the manual test checklist (from the spec)**

In Chrome DevTools, `Application → Storage → Clear site data` to ensure a fresh start. Then open `http://localhost:8000`.

1. **First launch (online).** "Loading puzzles…" appears. Progress bar shows briefly. Then a real Lichess puzzle loads. Solve a few; cycling works.
2. **Reload.** Brief "Loading puzzles…" then immediately the first puzzle (no progress bar visible). Network tab shows only `index.json` was fetched, not `mateIn1.json`.
3. **DevTools offline mode → reload.** Same as 2 — cached data. No error.
4. **Clear IDB → DevTools offline mode → reload.** Status changes to "Need internet on first run. Reload when online."
5. **Disable offline mode → reload.** Recovers; fetches; puzzles load.
6. **Tamper test.** Edit `data/puzzles/mateIn1.json` (e.g., delete a puzzle from the array). Bump `index.json`'s `version` field to a new date. Save. Reload. Console should warn `sha256 mismatch`. The cached (good) data is used; no crash. Restore the file via `git checkout data/puzzles/`.
7. **Build script idempotency.** Run `npm run build-puzzles` again (without `--refresh`). Expected: skips download (uses cache), regenerates outputs deterministically. `git diff data/puzzles/` should show no changes (assuming Lichess CSV unchanged) — except possibly `index.json`'s `version` and `generatedAt` fields if you crossed midnight UTC.
8. **Promotion puzzle (auto-queen).** Skip until you encounter a puzzle whose `moves[1]` is a 5-char UCI ending in `q` (visible in DevTools network tab → mateIn1.json). Try to play the move on the board. If cm-chessboard fires `validateMoveInput` / `moveInputFinished` with `event.promotion` populated → it works as-is. If `event.promotion` is undefined and the move is rejected as `Try again` (because our code passes `promotion: undefined` and `formatMove` produces `a7a8` which doesn't match expected `a7a8q`), patch `src/board.js` `#handleInput` to auto-default to queen for back-rank pawn moves:

```js
if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
  const from = event.squareFrom;
  const to = event.squareTo;
  if (from && to && event.legalMove) {
    const move = { from, to };
    if (event.promotion) {
      move.promotion = event.promotion;
    } else if (isBackRankPawnMove(from, to)) {
      move.promotion = 'q';
    }
    this.onUserMove(move);
  }
}
```

with helper:

```js
function isBackRankPawnMove(from, to) {
  // We don't have piece info here; this is a heuristic. Pawn moves to rank 1
  // or rank 8 from rank 2 or rank 7 with file diff ≤ 1 are promotion candidates.
  const fromRank = +from[1];
  const toRank = +to[1];
  const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  return ((fromRank === 7 && toRank === 8) || (fromRank === 2 && toRank === 1))
    && fileDiff <= 1;
}
```

Commit any patch with message `Fix board.js: auto-promote to queen on back-rank pawn moves`.

For each issue found, edit the relevant file, reload, retest. Commit fixes per logical change with messages like `Fix loader: handle ... case`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "<descriptive message per fix>"
```

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from a clean clone.
- [ ] All unit tests pass (66 tests total: 46 prior, minus 7 deleted phase-1 tests, plus 14 build-puzzles + 6 store + 7 loader).
- [ ] `data/puzzles/mateIn1.json` and `data/puzzles/index.json` are committed and consistent (sha256 matches).
- [ ] Manual checklist passes on desktop Chrome.
- [ ] First-launch online produces a working puzzle session with visible progress.
- [ ] First-launch offline produces a clear, non-scary error.
- [ ] Subsequent launches work without network.
- [ ] sha256 mismatch keeps cached data and logs a console warning.
- [ ] No console errors during normal operation.

---

## Self-review notes (already addressed inline)

- **Spec coverage:** Every "In scope" bullet from the spec maps to a task. Out-of-scope features (theme chips, service worker, settings, promotion dialog) are explicitly omitted.
- **Placeholder check:** No TBD / TODO / "implement later" markers. The build-script and loader code is complete in the plan; running it produces working output.
- **Type consistency:** `Store.replacePuzzles(theme, puzzles)`, `Store.getAllPuzzles()`, `loadPuzzles(theme, opts)` are used consistently across tasks. The puzzle schema is identical between the build script's `transformPuzzle` output, the JSON files on disk, and the runtime consumers.
- **Test count math:** Phase 1 ended at 46. Task 2 adds 14 (build-puzzles). Task 5 adds 6 (store). Task 6 adds 7 (loader). Task 9 removes 7 (puzzles-phase1). Net: 46 + 14 + 6 + 7 − 7 = 66.
- **Risk surface called out:** the `idb` library's `openDB` may not accept the third option-arg shape used to inject a custom `idb` factory. The store's implementation note instructs the implementer to fall back to `fake-indexeddb/auto`'s global replacement if needed. The loader's progress-streaming path falls back gracefully if `response.body` lacks `getReader` (older mocks).
