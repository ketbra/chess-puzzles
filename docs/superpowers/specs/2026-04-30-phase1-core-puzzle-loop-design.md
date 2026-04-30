# Phase 1 Design: Core Puzzle Loop

**Date:** 2026-04-30
**Phase:** 1 of 6 (per `PROJECT.md`)
**Goal:** Prove the puzzle solving loop end-to-end on a tiny hardcoded dataset, with a polished tilted board and a TDD'd state machine. No data pipeline, no IndexedDB, no PWA infrastructure yet — those are subsequent phases.

This is the first deliverable of the Chess Puzzles PWA project. It is a working web page that cycles a child user through five hand-picked mate-in-1 puzzles with correct/incorrect feedback, hint, and skip — visually finished, but missing all the chrome that arrives in later phases.

## Scope

### In scope

- Tilted, polished board: CSS perspective transform on the board container, warm cream/walnut squares, soft glow on the selected square, legal-move dots on tap, capture rings.
- Click-to-move primary; drag-to-move via cm-chessboard defaults.
- Solve loop over five hand-picked mate-in-1 puzzles, each stored using the canonical Lichess-derived schema (id, fen, moves, rating, themes, stars) so Phase 2's loader can swap in without touching any other module.
- Lichess move convention honored: `moves[0]` is the opponent's setup move played automatically after a 600ms delay; the user's first move is `moves[1]`.
- Multi-move puzzle support (built but not exercised by the five Phase 1 puzzles, since all are mate-in-1) so Phase 2 can swap in real data without touching `puzzle.js`. Covered by a synthetic mate-in-2 in tests.
- Correct user move: green flash on destination square, ~800ms pause, then advance to next puzzle.
- Incorrect user move: red shake on the board container, undo, status text shows "Try again". Session does not end on a wrong move; user can retry as many times as needed.
- Hint button: highlights the source square of the next expected user move (not the destination). Does not mutate puzzle state.
- Skip button: discards the current session and loads the next puzzle in the queue.
- Status text above the board: "Find the best move for white" / "Find the best move for black" / "Try again". A small player-color indicator (the side-to-move marker) is part of the status bar.
- Test suite for the solve-flow state machine (`puzzle.js`), built TDD-first using Vitest.

### Out of scope (deferred)

| Feature | Phase |
|---|---|
| Theme chips, difficulty stars, stats counters | 3 |
| Real Lichess-derived puzzle data, IndexedDB persistence, build pipeline | 2 |
| Service worker, web app manifest, PWA install button, offline support | 4 |
| Settings sheet, sound effects, confetti success animation, `prefers-reduced-motion` handling | 5 |
| Adaptive difficulty, per-theme stats, profiles | 6 |

### Non-goals reaffirmed

- No build step in the deployed artifact. Plain ES modules served as static files. (npm exists at dev time only, for vitest and as a vendoring source — node_modules is not deployed.)
- No framework. Vanilla JS with a small module structure.
- No backend, no telemetry, no external CDN dependency at runtime (everything needed comes from `/vendor/`).

## File layout after Phase 1

```
chess-puzzles/
├── PROJECT.md                      (existing)
├── README.md                       (new: how to run dev server, run tests, vendor)
├── package.json                    (devDependencies + scripts; not deployed)
├── package-lock.json
├── .gitignore                      (node_modules, dist artifacts)
├── index.html                      (loads /src/app.js as module, declares import map)
├── src/
│   ├── app.js                      (entry; wires modules, owns puzzle queue + timing)
│   ├── board.js                    (cm-chessboard wrapper; click + drag input)
│   ├── puzzle.js                   (solve-flow state machine; pure logic; TDD'd)
│   ├── puzzles-phase1.js           (five hand-picked mate-in-1 puzzles in canonical schema)
│   └── ui/
│       ├── styles.css              (perspective tilt, square colors, status bar, buttons, animations)
│       └── feedback.js             (flashCorrect, shakeIncorrect, setStatus)
├── vendor/                         (committed; populated by `npm run vendor`)
│   ├── chess.js/
│   └── cm-chessboard/
├── scripts/
│   └── vendor.mjs                  (Node ESM; copies node_modules/* → vendor/*)
└── tests/
    └── puzzle.test.js              (vitest)
```

Notes:

- `src/puzzles-phase1.js` is throwaway — Phase 2 replaces it with IndexedDB-backed loading. Keeping it in `src/` (not `data/`) makes the throwaway intent obvious and keeps the future `data/` directory clean.
- `idb` is **not** vendored in Phase 1 (it arrives in Phase 2 with IndexedDB).
- No `manifest.json`, `sw.js`, or `icons/` yet — those arrive in Phase 4.
- The `vendor/` directory is committed so the deployed site has zero install steps and zero CDN dependency.

## The state machine: `puzzle.js`

This is the only module we TDD. Everything else is visually verified.

### Concept

A `PuzzleSession` owns one in-progress puzzle. It tracks where in the move sequence we are, validates user moves against the expected next move, and reports what the UI should do next. It is **pure logic**: it does not touch the DOM, animate anything, or know about cm-chessboard. It depends only on `chess.js`.

### State

| Field | Type | Meaning |
|---|---|---|
| `puzzle` | object | The Lichess-schema puzzle data passed to the constructor |
| `chess` | Chess | A `chess.js` instance loaded from `puzzle.fen` |
| `moveIndex` | number | Index into `puzzle.moves[]` of the next move to play |
| `status` | `'awaiting-setup'` \| `'awaiting-user'` \| `'awaiting-opponent'` \| `'solved'` | State machine position |

`'failed'` is intentionally absent. A wrong user move does not end the session in Phase 1; it just gets rejected and the user can retry.

### Public API

```js
new PuzzleSession(puzzleData)
  // Initial state: status === 'awaiting-setup', moveIndex === 0.

session.applyOpponentSetup() → { from, to, promotion?, san }
  // Plays moves[0] on the chess instance.
  // Advances moveIndex to 1, status to 'awaiting-user'.
  // Returns the move object so the UI can animate it.
  // Throws if status !== 'awaiting-setup'.

session.attemptUserMove({ from, to, promotion? })
  // Returns one of:
  //   { result: 'correct',  applied, solved: true }
  //   { result: 'correct',  applied, solved: false, opponentReply: move }
  //   { result: 'incorrect' }
  // 'correct' applies the move to chess and advances moveIndex.
  // For multi-move puzzles, ALSO applies opponent's reply at moves[moveIndex]
  //   and advances again (status returns to 'awaiting-user').
  // 'incorrect' does NOT mutate state. UI can re-prompt without rebuilding the session.
  // Throws if status !== 'awaiting-user'.

session.hint() → { square }
  // Source square of moves[moveIndex] (the next expected user move).
  // Does not mutate state.

session.fen() → string         // current chess.fen()
session.turn() → 'w' | 'b'     // chess.turn() — convenience accessor
session.orientation() → 'white' | 'black'
  // Player color = the side moving on the user's first move.
  // Derived from puzzle.fen + moves[0]: orientation is the side NOT to move in fen.
  // Stable across the lifetime of the session.
```

### Move format

Lichess UCI is a string like `"e2e4"` or `"e7e8q"` (promotion). chess.js accepts `{ from, to, promotion? }`. We normalize to `{ from, to, promotion? }` at session boundaries with two small helpers:

- `parseUci(uci) → { from, to, promotion? }`
- `formatMove({from, to, promotion?}) → uci`

Equality between expected and actual user moves is structural, comparing all three fields. Both helpers are exported and tested independently.

### Why a class

Each puzzle attempt is a fresh session. Re-instantiate on Skip and on next-puzzle-after-correct. Avoids the trap of `reset()` methods that have to scrub every field correctly. Throwing the object away is the cleanest reset.

### Why multi-move support is built now

All five Phase 1 puzzles are mate-in-1, so `puzzle.moves.length === 2` always. The multi-move branch is therefore not exercised by the production data. We build it anyway because:

1. The state machine is not really finished without it — partial implementations with a "future TODO" tend to grow subtle bugs.
2. It is TDD-cheap (one synthetic mate-in-2 puzzle in tests covers the branch).
3. Phase 2 swaps in real data (which does include multi-move themes) without touching `puzzle.js`.

## UI wiring

### `board.js` (cm-chessboard wrapper)

Hides cm-chessboard's API behind a small surface:

| Method | Purpose |
|---|---|
| `new Board(selector, { onUserMove })` | Instantiate cm-chessboard, set `MOVE_INPUT_MODE` to allow click and drag, register an input-validated callback that fires `onUserMove({from, to, promotion?})` |
| `setPosition(fen, orientation?)` | Render position; switch orientation when the puzzle's player color changes |
| `animateMove(move)` | Apply a move and resolve when the animation finishes |
| `highlightSquare(sq, kind)` | Add a marker via cm-chessboard markers (`'hint'` for hint button) |
| `squareElement(sq)` | Return the DOM node for that square (so `feedback.js` can flash it green) |
| `element` | Root container (so `feedback.js` can shake it) |

The tilt is **CSS only** — `transform: perspective(1000px) rotateX(15deg)` on the board's container, plus a `box-shadow` for depth. `board.js` does not know about the tilt.

### `app.js` (entry / orchestrator)

Owns:

- The puzzle queue: an integer index into `phase1Puzzles`, modulo length. Phase 1 cycles forever.
- The current `PuzzleSession`.
- The `Board` instance.
- Timing constants from the spec: 600ms before opponent setup, 400ms before opponent reply (multi-move continuation), 800ms after final correct before next puzzle.
- Hint and Skip button click handlers.

Wiring (pseudocode):

```js
import { PuzzleSession } from './puzzle.js';
import { Board } from './board.js';
import { phase1Puzzles } from './puzzles-phase1.js';
import { flashCorrect, shakeIncorrect, setStatus } from './ui/feedback.js';

let queueIndex = 0;
let session = null;
let board = null;

async function loadNextPuzzle() {
  const puzzle = phase1Puzzles[queueIndex % phase1Puzzles.length];
  queueIndex++;
  session = new PuzzleSession(puzzle);
  board.setPosition(session.fen(), session.orientation());
  setStatus(`Find the best move for ${session.orientation()}`);
  await wait(600);
  const setup = session.applyOpponentSetup();
  await board.animateMove(setup);
}

board = new Board('#board', {
  onUserMove: async ({ from, to, promotion }) => {
    if (!session || session.status !== 'awaiting-user') return;  // ignore input during pauses
    const r = session.attemptUserMove({ from, to, promotion });
    if (r.result === 'incorrect') {
      shakeIncorrect(board.element);
      setStatus('Try again');
      board.setPosition(session.fen());
      return;
    }
    await flashCorrect(board.squareElement(to));
    if (r.solved) {
      await wait(800);
      await loadNextPuzzle();
    } else {
      await wait(400);
      await board.animateMove(r.opponentReply);
    }
  },
});

document.querySelector('#hint').addEventListener('click', () => {
  if (session) board.highlightSquare(session.hint().square, 'hint');
});
document.querySelector('#skip').addEventListener('click', loadNextPuzzle);

await loadNextPuzzle();
```

Target size: ~80 LoC. No state library — module-level `let`s suffice.

### `ui/feedback.js`

Three functions:

- `flashCorrect(squareElement) → Promise<void>` — toggles a CSS class with a brief green pulse keyframe, resolves on `animationend`.
- `shakeIncorrect(rootElement) → Promise<void>` — toggles a class with a horizontal shake keyframe, resolves on `animationend`.
- `setStatus(text)` — writes into the status DOM node.

### `index.html`

Minimal shell with an import map:

```html
<script type="importmap">
{
  "imports": {
    "chess.js": "/vendor/chess.js/<entry>",
    "cm-chessboard": "/vendor/cm-chessboard/<entry>"
  }
}
</script>
```

The `<entry>` paths are determined at vendor time from each package's `exports` field (or `module`/`main` if `exports` is absent). The `vendor.mjs` script will print the resolved entry paths so they can be pasted into the import map.

Source files use bare specifiers (`import { Chess } from 'chess.js'`). Vitest resolves the same names from `node_modules` directly; no import-map equivalent is needed in tests. As a result, `src/puzzle.js` and `tests/puzzle.test.js` share the exact same imports and run unmodified in either environment.

### `ui/styles.css`

- Board container perspective + rotateX + box-shadow.
- Square colors via cm-chessboard's CSS custom properties (warm cream / walnut).
- Status bar typography and spacing.
- Hint and Skip buttons with ≥48px hit targets.
- `@keyframes` for `flashCorrect` (green pulse) and `shakeIncorrect` (horizontal shake).

`prefers-reduced-motion` handling is **deferred to Phase 5** along with the rest of the motion polish (confetti, sounds). Phase 1's shake and pulse are short (<400ms) and considered acceptable for the brief Phase 1 demo period.

## Hand-picked Phase 1 puzzles

Five real Lichess mate-in-1 positions, selected for variety of mating pattern:

1. Back-rank mate.
2. Smothered-style mate (knight delivers, king has no escape).
3. Queen mate against a corner-castled king.
4. Knight check delivering mate.
5. Discovered or double-attack mate.

Each entry uses the canonical schema (id, fen, moves, rating, themes, stars). Real Lichess puzzle IDs and FENs will be drawn from the published Lichess puzzle database. Each puzzle will be hand-verified during implementation by simulating it through `PuzzleSession` in a one-off setup script — confirming the FEN parses, `moves[0]` is legal, and `moves[1]` delivers checkmate.

## Dev workflow

```
npm install            # installs chess.js, cm-chessboard, vitest (idb arrives in Phase 2)
npm run vendor         # node scripts/vendor.mjs → populates /vendor/
npm run dev            # python3 -m http.server 8000 (serves repo root)
npm test               # vitest run
```

Rationale: `python3 -m http.server` is universally available, has no install footprint beyond what most dev machines already have, and Phase 1 does not benefit meaningfully from hot reload. Vite remains an option for later phases per the PROJECT.md note.

`scripts/vendor.mjs` is plain Node ESM. For each of `chess.js` and `cm-chessboard`, it copies the ESM build files (and cm-chessboard's `assets/pieces/` SVGs and CSS) from `node_modules/<pkg>/` to `/vendor/<pkg>/`. Idempotent. No template strings, no transformation — just `fs.cp`. The script is run once after `npm install` (and again whenever a vendored library is updated) and the resulting `/vendor/` tree is committed.

## Test plan: `tests/puzzle.test.js`

| Group | Tests |
|---|---|
| Construction | initial state for a mate-in-1 (status, moveIndex, fen, orientation derived correctly from FEN side-to-move) |
| Setup move | `applyOpponentSetup()` advances state correctly; throws if called twice; the returned move object matches `moves[0]` parsed |
| Correct user move (mate-in-1) | returns `{result:'correct', solved:true}`; chess instance reflects the user's move; status becomes `'solved'` |
| Correct user move (multi-move) | returns `{result:'correct', solved:false, opponentReply}`; opponentReply matches `moves[moveIndex]`; chess reflects both moves; status returns to `'awaiting-user'` |
| Incorrect user move | returns `{result:'incorrect'}`; does not mutate state (fen, moveIndex, status all unchanged); a subsequent correct move still works |
| Hint | returns the source square of `moves[moveIndex]` regardless of position; works after setup move and after partial multi-move progress |
| Promotion | a synthetic position where queening delivers mate but underpromoting to knight does not: `attemptUserMove` with `promotion: 'q'` returns `correct`; with `promotion: 'n'` returns `incorrect` (state unchanged either way except on success) |
| UCI parsing | `parseUci('e2e4')` and `parseUci('e7e8q')` produce expected objects; `formatMove` is the inverse |
| Multi-move flow | a synthetic mate-in-2 walks through correctly: setup → user → opponentReply → user → solved |
| API guards | `applyOpponentSetup` throws after first call; `attemptUserMove` throws when called before setup; `attemptUserMove` throws when called after `'solved'` |

Roughly 12–15 tests. TDD order: parsing helpers → construction → setup → correct mate-in-1 → incorrect → hint → multi-move → promotion → guards.

## Manual test plan

After all unit tests pass, manually verify in a browser:

1. Page loads at `http://localhost:8000`. Tilted board appears with first puzzle's position.
2. After ~600ms, opponent's setup move animates.
3. Status text reads "Find the best move for white" (or "black" for the appropriate puzzle).
4. Tap a friendly piece — it highlights, legal-move dots appear.
5. Tap a different friendly piece — selection switches.
6. Tap an empty illegal square while a piece is selected — selection clears with no error.
7. Make the wrong move — board shakes red, move undoes, status changes to "Try again".
8. Make the correct move — destination square flashes green, ~800ms pause, next puzzle loads.
9. Make a wrong move, then the correct move — second attempt succeeds.
10. After the 5th puzzle solved, puzzle 1 reappears (sequential cycle).
11. Hint button — highlights source square of next correct move, does not advance.
12. Skip button — immediately loads next puzzle, no shake, no flash.
13. Drag-to-move (mouse) and tap-to-move (touch) both work.
14. **Hit-testing on Android Chrome:** taps near the rear rank of the tilted board land on the intended square. If they consistently miss high, lower `rotateX` from 15° toward 10°.

Item 14 is the only known risk inherent to the Phase 1 design (the tilt may make hit-testing feel slightly off). The fallback is a CSS one-liner.

## Architecture trade-offs explicitly considered

- **Pure-logic `puzzle.js` vs. UI-coupled puzzle module.** Chose pure logic. Trades a small amount of wiring in `app.js` for fully unit-testable solve flow and confidence we will not regress the Lichess move convention.
- **Class-based `PuzzleSession` vs. functional state object.** Chose class. The session is short-lived, has identity (one per puzzle attempt), and the constructor cleanly establishes the chess.js instance from the FEN.
- **Vendoring strategy.** npm + copy script chosen over manual download or git submodules. Cost of npm is already paid by Vitest as a dev dep. Updates are `npm update && npm run vendor`. Deployed artifact remains pure static files.
- **Import maps vs. relative imports.** Import maps chosen so source files use the same bare specifiers in browser and tests, eliminating dual-import branches.
- **Sequential cycle vs. completion screen.** Sequential cycle. Phase 1's job is to prove the loop works, not to track completion. A completion screen would be Phase-1 throwaway.
- **Confetti now vs. Phase 5.** Phase 5. Confetti ships with sound and reduced-motion handling and would otherwise be partially redone.

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run dev`, `npm test` all work from a clean clone.
- [ ] All unit tests in `tests/puzzle.test.js` pass.
- [ ] All manual test checklist items pass on desktop Chrome and Android Chrome.
- [ ] No console errors or warnings during a full cycle through all five puzzles.
- [ ] Vendor directory committed; site loads with browser DevTools "Disable cache" enabled and no requests to anything outside the origin (other than the import map's local paths).
- [ ] README documents the dev workflow.
