# Phase 1 Implementation Plan: Core Puzzle Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 deliverable described in `docs/superpowers/specs/2026-04-30-phase1-core-puzzle-loop-design.md` — a tilted, polished chessboard that cycles a user through five hardcoded mate-in-1 puzzles with correct/incorrect feedback, hint, and skip — using a TDD'd state machine for the solve flow.

**Architecture:** Plain ES modules served as static files (no build step in deployed artifact). `puzzle.js` is a pure-logic state machine wrapping `chess.js` and is unit-tested with Vitest. `board.js` wraps `cm-chessboard` and is the only DOM-touching module of substance. `app.js` orchestrates timing and wiring. Vendored libraries live in `/vendor/` (committed) and are populated from `node_modules` via a small Node script. Browser uses an import map; tests use bare specifiers resolved by Node — both source and tests share the same imports.

**Tech Stack:** Vanilla JS (ES modules), `chess.js` (move validation), `cm-chessboard` (board UI), Vitest (tests), Node ≥18 (for vendor script and tests). No framework. No bundler. Dev server is `python3 -m http.server`.

---

## Background and conventions

- **Lichess move convention:** `puzzle.moves[0]` is the **opponent's** setup move played automatically on load. The user's first move is `puzzle.moves[1]`. For multi-move puzzles, opponent moves are at even indices and user moves at odd indices. We do not exercise multi-move flow with real puzzles in Phase 1 (all five are mate-in-1) but we build and unit-test it.
- **Move format:** Lichess UCI strings (`"e2e4"`, `"e7e8q"`). Internally we normalize to `{ from, to, promotion? }` for chess.js compatibility. Equality between expected and submitted moves is compared on the canonical UCI string.
- **TDD discipline:** every public function in `src/puzzle.js` has its tests written first, run to confirm they fail, then minimally implemented, then re-run. Commit at the end of each task.
- **chess.js current API note:** chess.js v1+ throws on invalid move attempts (older versions returned `null`). Our state machine compares UCI strings before applying, so we never call `chess.move()` with an illegal move on the happy path. Keep the contract in mind when reviewing helper code.
- **cm-chessboard hit-testing concern:** the CSS perspective tilt may make taps near the rear rank feel slightly off on Android. Confirm during the manual test pass; if it's noticeably bad, lower `rotateX` from 15° to 10° (one CSS line).

---

## Task 1: Repo skeleton — package.json, .gitignore

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "chess-puzzles",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "vendor": "node scripts/vendor.mjs",
    "dev": "python3 -m http.server 8000",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "chess.js": "^1.0.0",
    "cm-chessboard": "^8.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
.DS_Store
*.log
.vitest-cache/
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: dependencies install. A `package-lock.json` is created. (If npm complains about a specific version of `chess.js` or `cm-chessboard`, accept the latest 1.x / 8.x respectively — pin the resolved version into `package.json` afterward.)

- [ ] **Step 4: Verify the libraries' actual ESM entry points**

Run: `node -e "import('chess.js').then(m => console.log('chess.js ok:', Object.keys(m)))"` and `node -e "import('cm-chessboard').then(m => console.log('cm-chessboard ok:', Object.keys(m)))"`
Expected: both print non-empty key lists. Note any discrepancies between expected exports (`Chess` from chess.js; `Chessboard`, `COLOR`, `INPUT_EVENT_TYPE`, `MARKER_TYPE` from cm-chessboard) and actual — adjust subsequent tasks if naming differs.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "Add package.json with dev dependencies and scripts"
```

---

## Task 2: Vendor script and run it

**Files:**
- Create: `scripts/vendor.mjs`
- Populate (committed): `vendor/chess.js/`, `vendor/cm-chessboard/`

- [ ] **Step 1: Write `scripts/vendor.mjs`**

```js
// Copies the ESM build of each vendored library out of node_modules
// into /vendor/ so the deployed site has zero install / network deps.
// Idempotent. Re-run after `npm install` or `npm update`.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const vendorRoot = join(repoRoot, 'vendor');

async function readPackageEntry(pkgName) {
  const pkgJson = JSON.parse(
    await readFile(join(repoRoot, 'node_modules', pkgName, 'package.json'), 'utf8'),
  );
  // Prefer ESM via "exports" → "import", then "module", then "main"
  const exp = pkgJson.exports;
  if (typeof exp === 'string') return exp;
  if (exp && typeof exp === 'object') {
    const root = exp['.'] ?? exp;
    if (typeof root === 'string') return root;
    if (root && typeof root === 'object') {
      return root.import ?? root.default ?? root.module ?? null;
    }
  }
  return pkgJson.module ?? pkgJson.main ?? null;
}

async function vendorPackage(pkgName) {
  const src = join(repoRoot, 'node_modules', pkgName);
  const dst = join(vendorRoot, pkgName);
  if (existsSync(dst)) await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });
  // Copy the entire package directory; we'll let GitHub Pages serve only what's referenced.
  // This is simpler than cherry-picking files and avoids missing assets.
  await cp(src, dst, {
    recursive: true,
    filter: (file) => !file.endsWith('node_modules'),
  });
  const entry = await readPackageEntry(pkgName);
  console.log(`  ${pkgName}: entry = ${entry ?? '(unknown — check manually)'}`);
  return entry;
}

console.log('Vendoring libraries into /vendor/ ...');
const chessEntry = await vendorPackage('chess.js');
const boardEntry = await vendorPackage('cm-chessboard');

const importMapHint = {
  'chess.js': `/vendor/chess.js/${chessEntry ?? '<entry>'}`,
  'cm-chessboard': `/vendor/cm-chessboard/${boardEntry ?? '<entry>'}`,
};
console.log('\nImport map paths to use in index.html:');
console.log(JSON.stringify({ imports: importMapHint }, null, 2));

// Also write the hint to a file so subsequent tasks can paste it in.
await writeFile(
  join(vendorRoot, '.import-map-hint.json'),
  JSON.stringify({ imports: importMapHint }, null, 2),
);
console.log('\nDone. (Hint written to vendor/.import-map-hint.json)');
```

- [ ] **Step 2: Run it**

Run: `npm run vendor`
Expected: prints two `vendoring` lines, then an "Import map paths" JSON. `vendor/chess.js/` and `vendor/cm-chessboard/` directories now exist. Note the resolved entry paths.

- [ ] **Step 3: Verify the vendor tree contains piece SVG assets**

Run: `ls vendor/cm-chessboard/assets/pieces/ 2>&1 | head` (the path may differ slightly between cm-chessboard versions — adapt with `find vendor/cm-chessboard -name '*.svg' | head` if needed)
Expected: a list of piece SVGs (e.g., `wK.svg`, `bP.svg`, etc.) somewhere in the cm-chessboard tree. If they live elsewhere, note the path — `board.js` (Task 17) will need to point to it.

- [ ] **Step 4: Commit the vendor tree**

```bash
git add vendor/ scripts/vendor.mjs
git commit -m "Add vendor script and vendored chess.js / cm-chessboard"
```

---

## Task 3: Vitest config and a sanity test

**Files:**
- Create: `vitest.config.js`
- Create: `tests/sanity.test.js`

- [ ] **Step 1: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] **Step 2: Write `tests/sanity.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';

describe('sanity', () => {
  it('chess.js loads and parses the start position', () => {
    const chess = new Chess();
    expect(chess.fen().startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(true);
    expect(chess.turn()).toBe('w');
  });

  it('chess.js accepts a move via {from, to}', () => {
    const chess = new Chess();
    const move = chess.move({ from: 'e2', to: 'e4' });
    expect(move).toBeTruthy();
    expect(move.san).toBe('e4');
  });
});
```

- [ ] **Step 3: Run the sanity test**

Run: `npm test`
Expected: both tests pass. If `chess.move({from, to})` throws on an illegal move in the version that's installed, the second test still passes because `e2-e4` is legal in the start position. If imports fail, fix the package install or chess.js entry resolution.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.js tests/sanity.test.js
git commit -m "Add Vitest config and sanity tests for chess.js"
```

---

## Task 4: `parseUci` helper (TDD)

**Files:**
- Create: `tests/uci.test.js`
- Create: `src/uci.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/uci.test.js
import { describe, it, expect } from 'vitest';
import { parseUci, formatMove } from '../src/uci.js';

describe('parseUci', () => {
  it('parses a standard 4-char UCI', () => {
    expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4' });
  });

  it('parses a promotion UCI', () => {
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
  });

  it('parses a knight underpromotion', () => {
    expect(parseUci('a7a8n')).toEqual({ from: 'a7', to: 'a8', promotion: 'n' });
  });

  it('throws on malformed input', () => {
    expect(() => parseUci('e2')).toThrow();
    expect(() => parseUci('')).toThrow();
    expect(() => parseUci('e9e4')).toThrow(); // bad rank
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/uci.test.js`
Expected: FAIL — module `../src/uci.js` cannot be resolved.

- [ ] **Step 3: Implement `parseUci` (minimal)**

```js
// src/uci.js
const SQUARE = /^[a-h][1-8]$/;
const PROMO = /^[qrbn]$/;

export function parseUci(uci) {
  if (typeof uci !== 'string' || (uci.length !== 4 && uci.length !== 5)) {
    throw new Error(`Invalid UCI: ${JSON.stringify(uci)}`);
  }
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  if (!SQUARE.test(from) || !SQUARE.test(to)) {
    throw new Error(`Invalid UCI squares: ${uci}`);
  }
  const result = { from, to };
  if (uci.length === 5) {
    const promotion = uci[4];
    if (!PROMO.test(promotion)) {
      throw new Error(`Invalid UCI promotion: ${uci}`);
    }
    result.promotion = promotion;
  }
  return result;
}
```

- [ ] **Step 4: Run, expect parseUci tests to pass (formatMove tests will still fail — that's Task 5)**

Run: `npm test -- tests/uci.test.js -t parseUci`
Expected: all four `parseUci` tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/uci.test.js src/uci.js
git commit -m "Add parseUci helper with TDD"
```

---

## Task 5: `formatMove` helper (TDD)

**Files:**
- Modify: `tests/uci.test.js`
- Modify: `src/uci.js`

- [ ] **Step 1: Append the failing tests**

Append to `tests/uci.test.js`:

```js
describe('formatMove', () => {
  it('formats a non-promotion move', () => {
    expect(formatMove({ from: 'e2', to: 'e4' })).toBe('e2e4');
  });

  it('formats a promotion move', () => {
    expect(formatMove({ from: 'e7', to: 'e8', promotion: 'q' })).toBe('e7e8q');
  });

  it('round-trips with parseUci', () => {
    for (const uci of ['e2e4', 'a7a8q', 'h2h1n']) {
      expect(formatMove(parseUci(uci))).toBe(uci);
    }
  });

  it('throws on invalid input', () => {
    expect(() => formatMove({ from: 'e2' })).toThrow();
    expect(() => formatMove({ from: 'e9', to: 'e4' })).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/uci.test.js -t formatMove`
Expected: FAIL — `formatMove is not a function`.

- [ ] **Step 3: Implement `formatMove`**

Append to `src/uci.js`:

```js
export function formatMove({ from, to, promotion }) {
  if (typeof from !== 'string' || typeof to !== 'string') {
    throw new Error(`Invalid move: ${JSON.stringify({ from, to, promotion })}`);
  }
  if (!SQUARE.test(from) || !SQUARE.test(to)) {
    throw new Error(`Invalid move squares: ${from}-${to}`);
  }
  let uci = from + to;
  if (promotion != null) {
    if (!PROMO.test(promotion)) {
      throw new Error(`Invalid promotion: ${promotion}`);
    }
    uci += promotion;
  }
  return uci;
}
```

- [ ] **Step 4: Run, expect all `tests/uci.test.js` tests to pass**

Run: `npm test -- tests/uci.test.js`
Expected: all `parseUci` and `formatMove` tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/uci.test.js src/uci.js
git commit -m "Add formatMove helper with round-trip tests"
```

---

## Task 6: Test fixtures for `PuzzleSession`

**Files:**
- Create: `tests/fixtures.js`

This file holds shared puzzle data used by all `puzzle.js` tests. Reusing fixtures keeps tests DRY.

- [ ] **Step 1: Write the fixtures file**

```js
// tests/fixtures.js
//
// All fixtures use the canonical Phase 1 puzzle schema:
//   { id, fen, moves, rating, themes, stars }
// `moves[0]` is the opponent's setup move (Lichess convention).

// A real Lichess mate-in-1 (white to mate). White plays the setup move
// (Kg1->h1 from white's POV is impossible; this is actually the OPPONENT
// already having played their move and the FEN reflects "user to move").
//
// To make this concrete and avoid researching real puzzle IDs at test-write
// time, we construct synthetic positions whose Lichess-style move arrays
// we control completely. Phase 1 production puzzles (Task 14) will pull
// from real Lichess data; the test fixtures here are for unit-testing
// PuzzleSession, not for production display.

// Fixture A: simple back-rank mate-in-1.
//   White: Kg1, Ra1. Black: Kg8, pawns f7/g7/h7, knight on c6.
//   Black to move. Opponent plays knight off the 8th-rank defense
//   (Nc6-e5 — a non-pawn move that does NOT open a king escape on the
//   7th rank). Then user plays Ra1-a8# (back-rank mate, knight on e5
//   cannot interpose since none of c4/c6/d3/d7/f3/f7/g4/g6 lie on
//   the 8th rank).
//
// FEN: 6k1/5ppp/2n5/8/8/8/8/R5K1 b - - 0 1
//   moves: ['c6e5', 'a1a8']
export const matein1Backrank = {
  id: 'TEST_M1_BACKRANK',
  fen: '6k1/5ppp/2n5/8/8/8/8/R5K1 b - - 0 1',
  moves: ['c6e5', 'a1a8'],
  rating: 800,
  themes: ['mateIn1', 'backRankMate'],
  stars: 1,
};

// Mate-in-2 fixture: two-rook "ladder" mate, hand-verified before
// inclusion. Position: White Kf6, Ra1, Ra2. Black Kg8 alone. Black to move.
//   Line:
//     0. Kg8-h8       (black retreats; legal alongside Kf8, Kh7; the puzzle
//                      script picks h8)
//     1. Ra2-a8+      (rook lifts to 8th rank delivering check)
//     2. Kh8-h7       (forced — only legal escape; g8/h6/g7 all covered)
//     3. Ra1-h1#      (second rook clamps the h-file; all 5 escape squares
//                      around Kh7 are covered by Kf6, Ra8, or Rh1)
//
// `buildAndVerify` re-applies all 4 moves and asserts the final position is
// checkmate. Any change to the line that breaks mate will throw at module
// load — failing the import and every dependent test loudly.

import { Chess } from 'chess.js';

function buildAndVerify(fen, moves, expectedFinalChecker) {
  const chess = new Chess(fen);
  for (const uci of moves) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length === 5 ? uci[4] : undefined;
    const m = chess.move({ from, to, promotion });
    if (!m) throw new Error(`Fixture move ${uci} is illegal in position ${chess.fen()}`);
  }
  if (expectedFinalChecker && !expectedFinalChecker(chess)) {
    throw new Error(`Fixture final-state check failed. Final FEN: ${chess.fen()}`);
  }
  return { fen, moves };
}

const matein2Candidate = buildAndVerify(
  '6k1/8/5K2/8/8/8/R7/R7 b - - 0 1',
  ['g8h8', 'a2a8', 'h8h7', 'a1h1'],
  (chess) => chess.isCheckmate(),
);

export const matein2Fixture = {
  id: 'TEST_M2_LADDER',
  fen: matein2Candidate.fen,
  moves: matein2Candidate.moves,
  rating: 1100,
  themes: ['mateIn2'],
  stars: 2,
};

// Promotion fixture: white pawn promotes to queen for mate.
// White: Ke1, Pe7. Black: Ke8 alone (impossible position: kings adjacent.
// Adjust to non-adjacent kings.)
//   White: Ka1, Pa7. Black: Kc8 alone.
//   White to move? We need the puzzle's side-to-move = OPPONENT (Lichess convention).
//   So FEN side-to-move = black.
//   moves[0] (black): 'c8b8' (legal: c8-b8, c8-c7, c8-d8, c8-d7).
//   moves[1] (white): 'a7a8q'  (promote to queen, mate?
//      White Q on a8 attacks Kb8 via rank 8 and a8-h1 diagonal. Black king
//      can move to: a7 (covered by Qa8 a-file), c7 (not covered by Qa8 directly;
//      Qa8 covers a-file, rank 8, a8-h1 diag (b7,c6,d5,...). c7 is on c-file rank 7.
//      Not on Qa8's lines. So Kc7 is escape — NOT mate.)
//   Add white K closer: white Kc6 instead of Ka1.
//     White: Kc6, Pa7. Black: Kb8 (b8 to move? White Kc6 attacks Kb7,c7,d7 etc.
//     Black king on b8 → adjacent squares a7,a8,b7,c7,c8 — Kc6 covers b7,c7. So
//     legal black moves: Ka7 (yes? Kc6 doesn't cover a7), Ka8, Kc8.
//     With FEN side-to-move = black:
//   FEN: '1k6/P7/2K5/8/8/8/8/8 b - - 0 1'
//   moves[0] (black): 'b8a8' (Ka8, only-ish escape; pick this).
//   moves[1] (white): 'a7a8q' — wait, that captures own pawn? No, the pawn is
//     on a7, promoting to a8. But Black king is now on a8 (from move 0). So
//     a7a8q IS a capture-promote and would be 'a7xa8=Q'. UCI-wise:
//     `a7a8q` works as long as chess.js sees the legal move.
//     Resulting position: White Kc6, Q on a8 (just promoted). Black has no king?
//     No, the queen captures the king??? Illegal! You can't capture the king.
//     Whole sequence is illegal.
//
// Switch:
//   moves[0] (black): 'b8c8' (Kc8). Legal? Kc6 covers c7 and b7 and d7. c8 is
//     not covered by Kc6 (3 squares away). So Kb8-c8 legal.
//   moves[1] (white): 'a7a8q' (promote on a8, no capture). Now Q on a8 attacks
//     8th rank → Kc8 attacked. Black king's squares: c7 (covered by Kc6), b7
//     (covered by Kc6), b8 (covered by Qa8 via 8th rank), d8 (covered by Qa8
//     via 8th rank), d7 (covered by Kc6). Kc8 has no escape. Mate? Yes!

const promotionCandidate = buildAndVerify(
  '1k6/P7/2K5/8/8/8/8/8 b - - 0 1',
  ['b8c8', 'a7a8q'],
  (chess) => chess.isCheckmate(),
);

export const promotionFixture = {
  id: 'TEST_M1_PROMO',
  fen: promotionCandidate.fen,
  moves: promotionCandidate.moves,
  rating: 900,
  themes: ['mateIn1', 'promotion'],
  stars: 1,
};
```

**Implementer note:** the mate-in-2 candidate move list above (`['f8e8', 'a2a8', 'e8e7', 'a1e1']`) was sketched without verification. When you run the tests, the `buildAndVerify` call will throw if it doesn't actually mate. **If it throws,** iterate until you find a valid mate-in-2 that black-to-move enters into. The simplest path: take a **real** mate-in-2 puzzle from Lichess (search lichess.org/training, theme=mateIn2, look at one with a published `Moves` field) and paste its FEN + moves. Document the source in a comment.

- [ ] **Step 2: Run the fixtures load**

Run: `node --input-type=module -e "import('./tests/fixtures.js').then(() => console.log('fixtures ok'))"`
Expected: prints `fixtures ok`. If it throws ("Fixture move ... is illegal" or "Fixture final-state check failed"), edit the candidate move list until both fixtures verify.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures.js
git commit -m "Add test fixtures for PuzzleSession (mate-in-1, mate-in-2, promotion)"
```

---

## Task 7: `PuzzleSession` — construction and initial state (TDD)

**Files:**
- Create: `tests/puzzle.test.js`
- Create: `src/puzzle.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/puzzle.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { PuzzleSession } from '../src/puzzle.js';
import { matein1Backrank, matein2Fixture, promotionFixture } from './fixtures.js';

describe('PuzzleSession construction', () => {
  it('initializes with status awaiting-setup and moveIndex 0', () => {
    const s = new PuzzleSession(matein1Backrank);
    expect(s.status).toBe('awaiting-setup');
    expect(s.moveIndex).toBe(0);
  });

  it('exposes the FEN from the puzzle data', () => {
    const s = new PuzzleSession(matein1Backrank);
    expect(s.fen()).toBe(matein1Backrank.fen);
  });

  it('reports the correct turn from the FEN', () => {
    const s = new PuzzleSession(matein1Backrank);
    // FEN side-to-move = 'b' (black) → opponent is black, user is white
    expect(s.turn()).toBe('b');
  });

  it('orientation is the side that plays moves[1] (the user)', () => {
    const s = new PuzzleSession(matein1Backrank);
    // matein1Backrank FEN side-to-move = 'b' → opponent black plays move 0;
    // user is white → orientation 'white'
    expect(s.orientation()).toBe('white');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/puzzle.test.js`
Expected: FAIL — module `../src/puzzle.js` not found.

- [ ] **Step 3: Implement the minimal `PuzzleSession`**

```js
// src/puzzle.js
import { Chess } from 'chess.js';
import { parseUci, formatMove } from './uci.js';

export class PuzzleSession {
  constructor(puzzle) {
    if (!puzzle || typeof puzzle.fen !== 'string' || !Array.isArray(puzzle.moves)) {
      throw new Error('PuzzleSession requires a puzzle with fen and moves');
    }
    this.puzzle = puzzle;
    this.chess = new Chess(puzzle.fen);
    this.moveIndex = 0;
    this.status = 'awaiting-setup';
  }

  fen() {
    return this.chess.fen();
  }

  turn() {
    return this.chess.turn();
  }

  orientation() {
    // The user plays moves[1]; the side that plays moves[1] is the OPPOSITE
    // of the FEN side-to-move (since opponent plays moves[0] from that FEN).
    return this.chess.turn() === 'w' ? 'black' : 'white';
  }
}
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/puzzle.test.js -t construction`
Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/puzzle.test.js src/puzzle.js
git commit -m "Add PuzzleSession with construction and initial state"
```

---

## Task 8: `applyOpponentSetup` (TDD)

**Files:**
- Modify: `tests/puzzle.test.js`
- Modify: `src/puzzle.js`

- [ ] **Step 1: Append the failing tests**

```js
describe('applyOpponentSetup', () => {
  it('plays moves[0], advances moveIndex to 1, sets status to awaiting-user', () => {
    const s = new PuzzleSession(matein1Backrank);
    const move = s.applyOpponentSetup();
    expect(move.from).toBe('c6');
    expect(move.to).toBe('e5');
    expect(s.moveIndex).toBe(1);
    expect(s.status).toBe('awaiting-user');
  });

  it('the chess instance reflects the opponent setup move', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    // Knight moved c6 -> e5; FEN should show 'n' on e5 area, no 'n' on c6.
    const fen = s.fen();
    expect(fen).toMatch(/n/); // sanity: knight still on board
    // After the move, side-to-move flips to white (the user).
    expect(s.turn()).toBe('w');
  });

  it('throws if called twice', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    expect(() => s.applyOpponentSetup()).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/puzzle.test.js -t applyOpponentSetup`
Expected: FAIL — `s.applyOpponentSetup is not a function`.

- [ ] **Step 3: Implement `applyOpponentSetup`**

Add to `src/puzzle.js` inside `class PuzzleSession`:

```js
  applyOpponentSetup() {
    if (this.status !== 'awaiting-setup') {
      throw new Error(`applyOpponentSetup called in status ${this.status}`);
    }
    const expected = parseUci(this.puzzle.moves[0]);
    const move = this.chess.move(expected);
    if (!move) {
      throw new Error(`Setup move ${this.puzzle.moves[0]} is illegal in puzzle ${this.puzzle.id}`);
    }
    this.moveIndex = 1;
    this.status = this.puzzle.moves.length > 1 ? 'awaiting-user' : 'solved';
    return move;
  }
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/puzzle.test.js -t applyOpponentSetup`
Expected: all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/puzzle.test.js src/puzzle.js
git commit -m "Add applyOpponentSetup to PuzzleSession"
```

---

## Task 9: `attemptUserMove` — correct move on mate-in-1 (TDD)

**Files:**
- Modify: `tests/puzzle.test.js`
- Modify: `src/puzzle.js`

- [ ] **Step 1: Append the failing test**

```js
describe('attemptUserMove (mate-in-1 correct)', () => {
  it('returns {result:correct, solved:true} when user plays the mate', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const result = s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(result.result).toBe('correct');
    expect(result.solved).toBe(true);
    expect(s.status).toBe('solved');
  });

  it('the chess instance reflects the mate', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(s.chess.isCheckmate()).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/puzzle.test.js -t "mate-in-1 correct"`
Expected: FAIL — `s.attemptUserMove is not a function`.

- [ ] **Step 3: Implement `attemptUserMove` (correct branch only)**

Add to `class PuzzleSession`:

```js
  attemptUserMove({ from, to, promotion }) {
    if (this.status !== 'awaiting-user') {
      throw new Error(`attemptUserMove called in status ${this.status}`);
    }
    const submitted = formatMove({ from, to, promotion });
    const expectedUci = this.puzzle.moves[this.moveIndex];
    if (submitted !== expectedUci) {
      return { result: 'incorrect' };
    }
    const expected = parseUci(expectedUci);
    const applied = this.chess.move(expected);
    if (!applied) {
      throw new Error(
        `Expected user move ${expectedUci} is illegal in puzzle ${this.puzzle.id}`,
      );
    }
    this.moveIndex += 1;

    if (this.moveIndex >= this.puzzle.moves.length) {
      this.status = 'solved';
      return { result: 'correct', applied, solved: true };
    }

    // Multi-move puzzle: play opponent's reply at moves[moveIndex].
    const reply = parseUci(this.puzzle.moves[this.moveIndex]);
    const opponentReply = this.chess.move(reply);
    if (!opponentReply) {
      throw new Error(
        `Opponent reply ${this.puzzle.moves[this.moveIndex]} is illegal in puzzle ${this.puzzle.id}`,
      );
    }
    this.moveIndex += 1;
    this.status = this.moveIndex >= this.puzzle.moves.length ? 'solved' : 'awaiting-user';
    return {
      result: 'correct',
      applied,
      solved: this.status === 'solved',
      opponentReply,
    };
  }
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/puzzle.test.js -t "mate-in-1 correct"`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/puzzle.test.js src/puzzle.js
git commit -m "Add attemptUserMove for correct mate-in-1 moves"
```

---

## Task 10: `attemptUserMove` — incorrect (TDD)

**Files:**
- Modify: `tests/puzzle.test.js`

The implementation already handles incorrect via the `return { result: 'incorrect' }` early-out. We just need to test it.

- [ ] **Step 1: Append the failing tests**

```js
describe('attemptUserMove (incorrect)', () => {
  it('returns {result:incorrect} for a wrong move', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const result = s.attemptUserMove({ from: 'g1', to: 'g2' });
    expect(result.result).toBe('incorrect');
  });

  it('does not mutate state on incorrect', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const fenBefore = s.fen();
    const idxBefore = s.moveIndex;
    const statusBefore = s.status;
    s.attemptUserMove({ from: 'g1', to: 'g2' });
    expect(s.fen()).toBe(fenBefore);
    expect(s.moveIndex).toBe(idxBefore);
    expect(s.status).toBe(statusBefore);
  });

  it('user can retry after an incorrect move', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'g1', to: 'g2' });
    const result = s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(result.result).toBe('correct');
    expect(result.solved).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect tests to pass (no implementation change needed)**

Run: `npm test -- tests/puzzle.test.js -t "incorrect"`
Expected: all three tests pass. If any fail, the issue is likely that `formatMove` is being called on a partially-formed object — recheck that `attemptUserMove`'s early return runs before any chess mutation.

- [ ] **Step 3: Commit**

```bash
git add tests/puzzle.test.js
git commit -m "Add tests for incorrect attemptUserMove (no state mutation)"
```

---

## Task 11: `attemptUserMove` — multi-move flow (TDD)

**Files:**
- Modify: `tests/puzzle.test.js`

The implementation already supports the multi-move branch (Task 9 added the `opponentReply` logic). We need to verify it.

- [ ] **Step 1: Append the failing tests**

```js
describe('attemptUserMove (multi-move)', () => {
  it('applies opponent reply and returns to awaiting-user', () => {
    const s = new PuzzleSession(matein2Fixture);
    s.applyOpponentSetup();
    // moves: [opp, user, opp, user]; user's first move is moves[1].
    const userMove1 = parseUciFor(matein2Fixture.moves[1]);
    const r = s.attemptUserMove(userMove1);
    expect(r.result).toBe('correct');
    expect(r.solved).toBe(false);
    expect(r.opponentReply).toBeTruthy();
    // After opponent reply, status should be 'awaiting-user' again
    // (we still have moves[3] for the user).
    expect(s.status).toBe('awaiting-user');
    expect(s.moveIndex).toBe(3);
  });

  it('completes the puzzle when user plays the final mate', () => {
    const s = new PuzzleSession(matein2Fixture);
    s.applyOpponentSetup();
    s.attemptUserMove(parseUciFor(matein2Fixture.moves[1]));
    const r = s.attemptUserMove(parseUciFor(matein2Fixture.moves[3]));
    expect(r.result).toBe('correct');
    expect(r.solved).toBe(true);
    expect(s.status).toBe('solved');
    expect(s.chess.isCheckmate()).toBe(true);
  });
});

// Local helper used by multi-move tests.
function parseUciFor(uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const out = { from, to };
  if (uci.length === 5) out.promotion = uci[4];
  return out;
}
```

- [ ] **Step 2: Run, expect tests to pass**

Run: `npm test -- tests/puzzle.test.js -t "multi-move"`
Expected: both tests pass. If `matein2Fixture` was rejected at fixture-load time (Task 6), fix the fixture first.

- [ ] **Step 3: Commit**

```bash
git add tests/puzzle.test.js
git commit -m "Test attemptUserMove multi-move flow with mate-in-2 fixture"
```

---

## Task 12: `hint` (TDD)

**Files:**
- Modify: `tests/puzzle.test.js`
- Modify: `src/puzzle.js`

- [ ] **Step 1: Append the failing tests**

```js
describe('hint', () => {
  it('returns the source square of the next user move', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    expect(s.hint()).toEqual({ square: 'a1' });
  });

  it('does not mutate state', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const idxBefore = s.moveIndex;
    s.hint();
    expect(s.moveIndex).toBe(idxBefore);
  });

  it('returns the next user move source after partial multi-move progress', () => {
    const s = new PuzzleSession(matein2Fixture);
    s.applyOpponentSetup();
    s.attemptUserMove({
      from: matein2Fixture.moves[1].slice(0, 2),
      to: matein2Fixture.moves[1].slice(2, 4),
    });
    expect(s.hint().square).toBe(matein2Fixture.moves[3].slice(0, 2));
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/puzzle.test.js -t hint`
Expected: FAIL — `s.hint is not a function`.

- [ ] **Step 3: Implement `hint`**

Add to `class PuzzleSession`:

```js
  hint() {
    const expected = parseUci(this.puzzle.moves[this.moveIndex]);
    return { square: expected.from };
  }
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/puzzle.test.js -t hint`
Expected: all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/puzzle.test.js src/puzzle.js
git commit -m "Add hint() to PuzzleSession"
```

---

## Task 13: Promotion (TDD)

**Files:**
- Modify: `tests/puzzle.test.js`

- [ ] **Step 1: Append the failing tests**

```js
describe('promotion', () => {
  it('accepts queen promotion when expected move is queen promotion', () => {
    const s = new PuzzleSession(promotionFixture);
    s.applyOpponentSetup();
    const r = s.attemptUserMove({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(r.result).toBe('correct');
    expect(r.solved).toBe(true);
  });

  it('rejects knight promotion when expected move is queen promotion', () => {
    const s = new PuzzleSession(promotionFixture);
    s.applyOpponentSetup();
    const r = s.attemptUserMove({ from: 'a7', to: 'a8', promotion: 'n' });
    expect(r.result).toBe('incorrect');
    // State unchanged: still awaiting user.
    expect(s.status).toBe('awaiting-user');
  });
});
```

- [ ] **Step 2: Run, expect tests to pass (no implementation change needed)**

Run: `npm test -- tests/puzzle.test.js -t promotion`
Expected: both tests pass. If they fail, recheck `formatMove` — it must include the promotion char in the UCI string for the equality check.

- [ ] **Step 3: Commit**

```bash
git add tests/puzzle.test.js
git commit -m "Test promotion handling in attemptUserMove"
```

---

## Task 14: API guards (TDD)

**Files:**
- Modify: `tests/puzzle.test.js`

- [ ] **Step 1: Append the failing tests**

```js
describe('API guards', () => {
  it('attemptUserMove throws when called before setup', () => {
    const s = new PuzzleSession(matein1Backrank);
    expect(() => s.attemptUserMove({ from: 'a1', to: 'a8' })).toThrow();
  });

  it('attemptUserMove throws when called after solved', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(() => s.attemptUserMove({ from: 'a8', to: 'a7' })).toThrow();
  });

  it('applyOpponentSetup throws if called twice', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    expect(() => s.applyOpponentSetup()).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect tests to pass (implementation already throws)**

Run: `npm test -- tests/puzzle.test.js -t "API guards"`
Expected: all three pass — the existing `if (this.status !== ...)` checks cover them.

- [ ] **Step 3: Run the full puzzle test file to confirm overall green**

Run: `npm test -- tests/puzzle.test.js`
Expected: all tests pass (roughly 18+ tests across construction, setup, correct/incorrect, multi-move, hint, promotion, guards).

- [ ] **Step 4: Commit**

```bash
git add tests/puzzle.test.js
git commit -m "Test API guards for PuzzleSession state-machine violations"
```

---

## Task 15: Curate the five Phase 1 puzzles + verify them in tests

**Files:**
- Create: `src/puzzles-phase1.js`
- Create: `tests/puzzles-phase1.test.js`

The five puzzles must:
- Be real Lichess mate-in-1s (`mateIn1` theme, rating ≤ 1200).
- Cover varied mating patterns (back-rank, queen mate, knight mate, etc.).
- **Not** require pawn promotion (we don't wire promotion UI in Phase 1).
- Pass a verification test that simulates the puzzle through `PuzzleSession` and asserts the user's move delivers checkmate.

- [ ] **Step 1: Write the puzzles file**

```js
// src/puzzles-phase1.js
//
// Five hand-picked Lichess mate-in-1 puzzles for the Phase 1 demo.
// Sourced from https://database.lichess.org/lichess_db_puzzle.csv.zst
// (Lichess Open Database — CC0 / public domain).
//
// Each entry uses the Phase 1 / Phase 2 canonical schema. Phase 2 will
// replace this file with IndexedDB-backed loading; the schema is
// identical so callers won't change.
//
// Selection criteria: rating ≤ 1100, theme includes mateIn1, varied
// mating patterns, no promotion required.

export const phase1Puzzles = [
  // 1. Back-rank mate.
  // PASTE A REAL LICHESS PUZZLE HERE: pick a mateIn1 with a rook delivering
  // back-rank checkmate. Example shape:
  //   { id, fen, moves: [<oppMove>, <userMate>], rating, themes, stars }
  // The verification test below will fail if the user move doesn't mate.
  // TO BE FILLED BY IMPLEMENTER (see Step 2 below).

  // 2. Queen mate against castled king.

  // 3. Knight check delivering mate.

  // 4. Bishop or queen pin-mate.

  // 5. Discovered check / double-attack mate.
];
```

- [ ] **Step 2: Source 5 real Lichess mate-in-1 puzzles**

Lichess's puzzle database lives at `https://database.lichess.org/lichess_db_puzzle.csv.zst` (Zstandard-compressed CSV; columns include `PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes`). For Phase 1 we only need 5 puzzles, so do this manually instead of writing the full Phase 2 pipeline:

1. Visit [https://lichess.org/training/themes](https://lichess.org/training/themes) → choose **Mate in 1**.
2. Solve five puzzles in the rating range visible (Lichess shows lower-rated puzzles by default for new themes).
3. For each, after solving, click "Open analysis board" and copy the FEN.
4. The puzzle ID is in the URL (e.g., `https://lichess.org/training/00sHx` → id `00sHx`).
5. Recover the `Moves` array: open the database CSV in a tool of your choice (e.g., `zstd -d lichess_db_puzzle.csv.zst -o /tmp/puzzles.csv && grep ",${PUZZLE_ID}," /tmp/puzzles.csv`) — but at 5 puzzles it's faster to just **reconstruct moves from analysis**: the FEN is the position **after** the opponent's setup move, so:
   - `Moves[0]` = the move that produced this FEN (visible in Lichess analysis as the last move on board load).
   - `Moves[1]` = the user's correct mate (visible in the puzzle solution).
6. Convert `Moves` to UCI strings.
7. Map rating → stars per the spec: `rating < 800` → 1; `800 ≤ rating < 1100` → 2; etc.

Fill in the `phase1Puzzles` array with the five resulting entries.

If this is taking more than 30 minutes, fall back: download the CSV, grep for `,mateIn1,`, sort by `Rating ascending` and `Popularity descending`, take the top 5 with varied first-move pieces (rook, queen, knight, bishop, pawn-but-not-promotion).

- [ ] **Step 3: Write the verification test**

```js
// tests/puzzles-phase1.test.js
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { PuzzleSession } from '../src/puzzle.js';
import { phase1Puzzles } from '../src/puzzles-phase1.js';

describe('phase1Puzzles', () => {
  it('contains exactly 5 puzzles', () => {
    expect(phase1Puzzles).toHaveLength(5);
  });

  it.each(phase1Puzzles)('puzzle $id: FEN parses, moves are legal, mate delivered', (puzzle) => {
    const chess = new Chess(puzzle.fen);
    expect(chess.fen()).toBeTruthy();
    expect(puzzle.moves.length).toBeGreaterThanOrEqual(2);
    expect(puzzle.themes).toContain('mateIn1');

    const s = new PuzzleSession(puzzle);
    s.applyOpponentSetup();

    // Replay the user's move (and any subsequent moves for safety).
    let result;
    while (s.status === 'awaiting-user') {
      const expected = puzzle.moves[s.moveIndex];
      const from = expected.slice(0, 2);
      const to = expected.slice(2, 4);
      const promotion = expected.length === 5 ? expected[4] : undefined;
      result = s.attemptUserMove({ from, to, promotion });
      expect(result.result).toBe('correct');
    }

    expect(s.status).toBe('solved');
    expect(s.chess.isCheckmate()).toBe(true);
  });

  it('no Phase 1 puzzle requires promotion (UI does not handle it yet)', () => {
    for (const p of phase1Puzzles) {
      for (const uci of p.moves) {
        expect(uci.length, `${p.id} has promotion in ${uci}`).toBe(4);
      }
    }
  });
});
```

- [ ] **Step 4: Run the verification test**

Run: `npm test -- tests/puzzles-phase1.test.js`
Expected: all 7 tests pass (1 length + 5 verifications + 1 no-promotion). If a puzzle fails verification, double-check that you used the FEN **after** the setup move and the user's move in UCI form. A frequent mistake: the FEN copied from Lichess analysis sometimes reflects the position **before** the opponent setup. If so, replay the setup move once via chess.js and use the resulting FEN.

- [ ] **Step 5: Commit**

```bash
git add src/puzzles-phase1.js tests/puzzles-phase1.test.js
git commit -m "Add 5 hand-picked Phase 1 mate-in-1 puzzles with verification tests"
```

---

## Task 16: `index.html` shell with import map

**Files:**
- Create: `index.html`

The import map paths come from `vendor/.import-map-hint.json` (written by the vendor script in Task 2).

- [ ] **Step 1: Read the resolved import map paths**

Run: `cat vendor/.import-map-hint.json`
Expected: a JSON object with `chess.js` and `cm-chessboard` paths. Note these for the next step.

- [ ] **Step 2: Write `index.html`**

Replace `<CHESS_ENTRY>` and `<CMCB_ENTRY>` below with the real paths from Step 1.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Chess Puzzles</title>
    <link rel="stylesheet" href="/src/ui/styles.css" />
    <script type="importmap">
      {
        "imports": {
          "chess.js": "<CHESS_ENTRY>",
          "cm-chessboard": "<CMCB_ENTRY>"
        }
      }
    </script>
  </head>
  <body>
    <main>
      <p id="status" class="status" aria-live="polite">Loading...</p>
      <div id="board" class="board-stage"></div>
      <div class="actions">
        <button id="hint" type="button" aria-label="Hint">Hint</button>
        <button id="skip" type="button" aria-label="Skip puzzle">Skip</button>
      </div>
    </main>
    <script type="module" src="/src/app.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Verify the import map is valid JSON**

Run: `node -e "const fs=require('fs'); const html=fs.readFileSync('index.html','utf8'); const m=html.match(/<script type=\"importmap\">([\s\S]+?)<\/script>/); JSON.parse(m[1]); console.log('importmap ok');"`
Expected: `importmap ok`. If JSON.parse throws, fix the entry paths.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add index.html shell with import map and DOM skeleton"
```

---

## Task 17: `src/ui/styles.css`

**Files:**
- Create: `src/ui/styles.css`

- [ ] **Step 1: Write the stylesheet**

```css
/* Phase 1: tilted board, status bar, action buttons, animations.
   No theme chips, stars, stats, or settings (later phases). */

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: #1a1614;
  color: #efe6dc;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  min-height: 100vh;
}

main {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.status {
  font-size: 18px;
  font-weight: 500;
  margin: 0;
  text-align: center;
  min-height: 1.5em;
}

/* Board container holds the perspective transform. The cm-chessboard
   element renders inside it and is unaware of the tilt. */
.board-stage {
  width: 100%;
  aspect-ratio: 1;
  perspective: 1000px;
  perspective-origin: center 60%;
}

.board-stage > * {
  width: 100%;
  height: 100%;
  transform: rotateX(15deg);
  transform-origin: center center;
  transition: transform 200ms ease;
  filter: drop-shadow(0 12px 16px rgba(0, 0, 0, 0.5));
}

/* Warm board theme. cm-chessboard exposes CSS custom properties for
   square colors; the exact variable names depend on cm-chessboard's
   stylesheet. Override here. */
.board-stage {
  --light-square: #f0d9b5; /* warm cream */
  --dark-square: #7a4a2b;  /* walnut */
}

/* Action buttons */
.actions {
  display: flex;
  gap: 16px;
  width: 100%;
  justify-content: center;
}

.actions button {
  min-width: 120px;
  min-height: 48px;
  padding: 12px 24px;
  font-size: 18px;
  font-weight: 600;
  border-radius: 8px;
  border: 2px solid #5a3a22;
  background: #2a201a;
  color: #efe6dc;
  cursor: pointer;
  transition: background 150ms ease, transform 100ms ease;
}

.actions button:hover {
  background: #3a2a1f;
}

.actions button:active {
  transform: translateY(1px);
}

/* Feedback animations */
@keyframes flash-correct {
  0%, 100% { background-color: transparent; }
  40% { background-color: #4eaf4e; }
}

.flash-correct {
  animation: flash-correct 350ms ease;
}

@keyframes shake-incorrect {
  0%, 100% { transform: rotateX(15deg) translateX(0); }
  20%, 60% { transform: rotateX(15deg) translateX(-8px); }
  40%, 80% { transform: rotateX(15deg) translateX(8px); }
}

.shake-incorrect {
  animation: shake-incorrect 320ms ease;
}
```

- [ ] **Step 2: Open the page in a browser to confirm CSS loads**

Run: `npm run dev` (in another terminal — leave it running)
Then open `http://localhost:8000/` in a browser.
Expected: warm dark page, "Loading..." status text, two large buttons. No errors in DevTools console (the import-map and `app.js` modules will fail to load because we haven't written `app.js` yet — that's expected and harmless visually for now). The page should look intentional, not unstyled.

If the buttons look too small or the layout looks broken, fix the CSS now before moving on.

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles.css
git commit -m "Add Phase 1 stylesheet with perspective tilt, status bar, action buttons"
```

---

## Task 18: `src/ui/feedback.js`

**Files:**
- Create: `src/ui/feedback.js`

- [ ] **Step 1: Write the feedback helpers**

```js
// src/ui/feedback.js

export function setStatus(text) {
  const el = document.querySelector('#status');
  if (el) el.textContent = text;
}

export function flashCorrect(squareEl) {
  if (!squareEl) return Promise.resolve();
  return runAnimation(squareEl, 'flash-correct');
}

export function shakeIncorrect(rootEl) {
  if (!rootEl) return Promise.resolve();
  return runAnimation(rootEl, 'shake-incorrect');
}

function runAnimation(el, className) {
  return new Promise((resolve) => {
    el.classList.remove(className);
    // Force reflow so re-adding the class restarts the animation.
    void el.offsetWidth;
    el.classList.add(className);
    const onEnd = () => {
      el.classList.remove(className);
      el.removeEventListener('animationend', onEnd);
      resolve();
    };
    el.addEventListener('animationend', onEnd);
    // Safety timeout in case animationend doesn't fire (e.g., on a
    // hidden element).
    setTimeout(onEnd, 600);
  });
}
```

- [ ] **Step 2: Smoke-check by opening the page (no functional test possible without a board yet)**

The page should still render the same as before (this file isn't imported anywhere yet). No regression expected.

- [ ] **Step 3: Commit**

```bash
git add src/ui/feedback.js
git commit -m "Add UI feedback helpers (flashCorrect, shakeIncorrect, setStatus)"
```

---

## Task 19: `src/board.js` — cm-chessboard wrapper

**Files:**
- Create: `src/board.js`

This task pulls in the most uncertainty because cm-chessboard's exact API surface depends on the version installed. The skeleton below uses the common cm-chessboard 8.x shape; if your installed version differs, adapt the imports/options. The vendor script's output and `node_modules/cm-chessboard/README.md` are authoritative.

- [ ] **Step 1: Skim cm-chessboard's README to confirm the API**

Run: `cat node_modules/cm-chessboard/README.md | head -200` (or open it in an editor)
Expected: examples of `new Chessboard(...)`, the input event constants, marker types, and asset paths. **Note any divergence** from the names used below (`Chessboard`, `COLOR`, `INPUT_EVENT_TYPE`, `MARKER_TYPE`, `MOVE_INPUT_MODE`).

- [ ] **Step 2: Write `src/board.js`**

```js
// src/board.js
// Wrapper around cm-chessboard. Hides the library's API behind a
// small surface used by app.js.

import {
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE,
  MARKER_TYPE,
} from 'cm-chessboard';

// Where cm-chessboard's piece SVGs live in our vendor tree. Confirmed
// in Task 2 Step 3. Adjust if the actual path differs.
const ASSETS_URL = '/vendor/cm-chessboard/assets/';

export class Board {
  constructor(selector, { onUserMove }) {
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Board: selector ${selector} not found`);
    this.root = root;

    this.cb = new Chessboard(root, {
      position: 'empty',
      assetsUrl: ASSETS_URL,
      orientation: COLOR.white,
      style: {
        cssClass: 'staunty',
        showCoordinates: false,
        pieces: { type: 'svgSprite', file: 'pieces/staunty.svg' }, // adjust if cm-chessboard 8.x uses different shape
      },
    });

    this.onUserMove = onUserMove;
    this.cb.enableMoveInput((event) => this.#handleInput(event));
  }

  get element() {
    return this.root;
  }

  setPosition(fen, orientation) {
    if (orientation) {
      this.cb.setOrientation(orientation === 'white' ? COLOR.white : COLOR.black);
    }
    return this.cb.setPosition(fen, false);
  }

  async animateMove({ from, to }) {
    // cm-chessboard exposes movePiece(from, to, animated). Returns a Promise
    // in current versions. If your version is sync, this still works.
    await this.cb.movePiece(from, to, true);
  }

  highlightSquare(square, kind = 'hint') {
    // Use cm-chessboard's frame marker. We could vary by `kind` later.
    this.cb.removeMarkers(undefined, MARKER_TYPE.frame);
    this.cb.addMarker(MARKER_TYPE.frame, square);
    // Auto-clear after 2 seconds so the hint doesn't linger.
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this.cb.removeMarkers(undefined, MARKER_TYPE.frame);
    }, 2000);
  }

  squareElement(square) {
    // cm-chessboard renders each square as an SVG <g> with a data-attribute
    // identifying the square. The exact attribute name varies; common ones
    // are `data-square` or an internal id.
    return this.root.querySelector(`[data-square="${square}"]`);
  }

  #handleInput(event) {
    if (!this.onUserMove) return false;

    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      // Accept all visually-validated moves; logical validation happens in
      // PuzzleSession.attemptUserMove afterward.
      return true;
    }

    if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
      // moveInputFinished provides squareFrom and squareTo on cm-chessboard 8.x.
      // (On older versions, the equivalent event is moveInputDone.)
      const from = event.squareFrom;
      const to = event.squareTo;
      if (from && to) {
        // Default to queen promotion. Phase 1 puzzles never require promotion
        // (verified by tests/puzzles-phase1.test.js).
        this.onUserMove({ from, to, promotion: 'q' });
      }
    }
    return undefined;
  }
}
```

- [ ] **Step 3: Reload the dev page and check console**

Reload `http://localhost:8000/`.
Expected: no JavaScript errors in DevTools console **about cm-chessboard imports** (errors about `app.js` module not existing are still expected). If cm-chessboard's import or constructor fails, the API differs from the assumed shape — fix the offending bits and re-test before continuing. Common adjustments needed in cm-chessboard 8.x:
- `assetsUrl` may be named differently (`assetsCache`, `assetsRoot`).
- `MOVE_INPUT_MODE` may need to be set explicitly.
- `INPUT_EVENT_TYPE.moveInputFinished` may instead be `moveInputDone` or `validateMoveInput` only.
- `addMarker` arity may be `(MARKER_TYPE, square)` or `(square, MARKER_TYPE)`.

- [ ] **Step 4: Commit**

```bash
git add src/board.js
git commit -m "Add Board wrapper around cm-chessboard"
```

---

## Task 20: `src/app.js` — orchestrator

**Files:**
- Create: `src/app.js`

- [ ] **Step 1: Write `src/app.js`**

```js
// src/app.js
// Phase 1 entry point. Owns the puzzle queue, current PuzzleSession,
// timing, and Hint/Skip wiring.

import { PuzzleSession } from './puzzle.js';
import { Board } from './board.js';
import { phase1Puzzles } from './puzzles-phase1.js';
import { flashCorrect, shakeIncorrect, setStatus } from './ui/feedback.js';

const SETUP_DELAY_MS = 600;
const OPPONENT_REPLY_DELAY_MS = 400;
const POST_SOLVE_PAUSE_MS = 800;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let queueIndex = 0;
let session = null;
let board = null;

async function loadNextPuzzle() {
  const puzzle = phase1Puzzles[queueIndex % phase1Puzzles.length];
  queueIndex += 1;
  session = new PuzzleSession(puzzle);

  await board.setPosition(session.fen(), session.orientation());
  setStatus(`Find the best move for ${session.orientation()}.`);

  await wait(SETUP_DELAY_MS);

  const setup = session.applyOpponentSetup();
  await board.animateMove({ from: setup.from, to: setup.to });
}

async function handleUserMove({ from, to, promotion }) {
  if (!session || session.status !== 'awaiting-user') {
    return; // ignore input during pauses / animations
  }
  const r = session.attemptUserMove({ from, to, promotion });
  if (r.result === 'incorrect') {
    setStatus('Try again.');
    await Promise.all([
      shakeIncorrect(board.element),
      board.setPosition(session.fen()), // visually revert
    ]);
    return;
  }

  // Correct.
  await flashCorrect(board.squareElement(to));

  if (r.solved) {
    setStatus('Solved!');
    await wait(POST_SOLVE_PAUSE_MS);
    await loadNextPuzzle();
    return;
  }

  // Multi-move continuation.
  await wait(OPPONENT_REPLY_DELAY_MS);
  await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
  setStatus('Find the next best move.');
}

function bindActions() {
  document.querySelector('#hint').addEventListener('click', () => {
    if (session && session.status === 'awaiting-user') {
      board.highlightSquare(session.hint().square, 'hint');
    }
  });
  document.querySelector('#skip').addEventListener('click', () => {
    loadNextPuzzle();
  });
}

async function main() {
  board = new Board('#board', { onUserMove: handleUserMove });
  bindActions();
  await loadNextPuzzle();
}

main().catch((e) => {
  console.error(e);
  setStatus('Something went wrong. Reload the page.');
});
```

- [ ] **Step 2: Reload the dev page and play through a puzzle**

Reload `http://localhost:8000/`.
Expected:
- Tilted board renders with the first puzzle's position.
- After ~600ms, opponent's setup move animates.
- Status text reads "Find the best move for white." (or "black", per the puzzle).
- Tap a piece, tap destination — if correct, green flash + advance; if wrong, board shakes and reverts.
- Hint button highlights the source square.
- Skip jumps to next puzzle.

If errors appear in the console, debug them now. Common issues:
- `MARKER_TYPE` or square selector strings are wrong → highlight does nothing. Fix in `board.js`.
- `movePiece` doesn't return a Promise on the installed cm-chessboard version → animations chain weirdly. Wrap with `await new Promise(r => setTimeout(r, 350))` if needed.
- Pieces don't render → wrong `assetsUrl` or `pieces.file`. Check the network tab for 404s on SVG assets and fix the path.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "Add app.js orchestrator wiring board, session, and UI feedback"
```

---

## Task 21: Manual test pass

**Files:** none (manual testing — fix any code as issues are found)

- [ ] **Step 1: Walk the manual checklist on desktop Chrome**

With `npm run dev` running, open `http://localhost:8000/` and verify each item from the design's manual test plan:

1. Page loads. Tilted board appears with first puzzle's position.
2. After ~600ms, opponent's setup move animates.
3. Status text reads "Find the best move for white." or "black."
4. Tap a friendly piece — it highlights, legal-move dots appear (cm-chessboard default behavior).
5. Tap a different friendly piece — selection switches.
6. Tap an empty illegal square while a piece is selected — selection clears, no error.
7. Make the wrong move — board shakes red, move undoes, status changes to "Try again."
8. Make the correct move — destination square flashes green, ~800ms pause, next puzzle loads.
9. Make a wrong move, then the correct move — second attempt succeeds.
10. After the 5th puzzle solved, puzzle 1 reappears.
11. Hint button highlights source square of next correct move.
12. Skip button immediately loads next puzzle.
13. Drag-to-move works (mouse) and tap-to-move works (try in DevTools touch emulation mode).

For each issue found, edit the relevant file, reload, retest. Commit fixes per logical change with messages like `Fix board re-orientation when puzzle player color changes`.

- [ ] **Step 2: Walk the checklist on Android Chrome**

Connect an Android phone with USB debugging, or use `chrome://inspect` to remote-test. Open `http://<dev-machine-IP>:8000/` from the phone (you may need to open port 8000 in the host firewall, or run `python3 -m http.server 8000 --bind 0.0.0.0`).

Expected: all desktop checklist items pass on the phone. **Especially verify** item 14 from the design's manual test plan: taps near the rear rank land on the intended square. If they consistently miss high, edit `src/ui/styles.css` and reduce `transform: rotateX(15deg)` to `rotateX(10deg)` in the `.board-stage > *` rule. Commit the fix with message `Reduce board tilt to 10° to improve hit-testing on Android`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "<descriptive message per fix>"
```

---

## Task 22: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README with quick start and project layout"
```

---

## Definition of done

After all tasks complete, verify:

- [ ] `npm install`, `npm run vendor`, `npm run dev`, `npm test` all work from a clean clone.
- [ ] All unit tests pass (count expectation: ~25 tests across `tests/uci.test.js`, `tests/puzzle.test.js`, `tests/puzzles-phase1.test.js`, `tests/sanity.test.js`).
- [ ] Manual test checklist passes on desktop Chrome and Android Chrome.
- [ ] No console errors or warnings during a full cycle through all five puzzles.
- [ ] Vendor directory committed; site loads with browser DevTools "Disable cache" enabled and no requests to anything outside the origin.
- [ ] README documents the dev workflow.

---

## Self-review notes (already addressed inline)

- **Spec coverage:** Every "In scope" bullet from the design has a corresponding task. Out-of-scope items are explicitly omitted (PWA, IndexedDB, filters, stats, settings, confetti, sounds, reduced-motion).
- **Placeholder check:** The mate-in-2 fixture (Task 6) and the five Phase 1 puzzles (Task 15) are written as concrete data slots that will fail their verification tests if filled in incorrectly — this catches the otherwise-handwavy "pick a real puzzle" instruction at the test boundary.
- **Type consistency:** `PuzzleSession.attemptUserMove` returns a discriminated union with consistent shapes across tasks; tested fields (`result`, `solved`, `applied`, `opponentReply`) match the spec exactly.
- **Risk surface:** cm-chessboard's exact API names are the largest implementation-time risk. Task 19 explicitly calls out what to verify (`README.md`, version-specific event names, `addMarker` arity) so the implementer pauses to confirm rather than guessing.
- **Hit-testing on Android tilted board:** flagged in Task 21 with a one-line CSS fallback if needed.
