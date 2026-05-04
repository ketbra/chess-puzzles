# Phase 6.2 Implementation Plan: Legal-move learning aids

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase 6.2 per `docs/superpowers/specs/2026-05-04-phase6-2-legal-move-aids-design.md` — only pieces of the side-to-move are clickable; tapping a friendly piece shows green dots on legal target squares and green rings around capturable enemies.

**Architecture:** A new `PuzzleSession.legalMovesFrom(square)` method exposes legal moves to the UI layer. `Board` gains a `userColor` field, a `setUserColor()` method, and an `onLegalMoves` callback. `app.js` wires the callback to the active session and calls `setUserColor` after each opponent setup move. CSS overrides cm-chessboard's marker colors to a fixed forest green (`#7a9f3a`) regardless of the active board theme.

**Tech Stack:** Same as Phase 6.1 — vanilla JS ES modules, Vitest, no bundler. No new dependencies.

---

## Background and conventions

- **Color taxonomy** (locked across Phase 6.x): green `#7a9f3a` = legal/go (this phase); red `#c25555` reserved for danger (Phase 6.3); cream `#f0d9b5` = hint frame (existing).
- **Color guard implementation choice:** return `false` from `moveInputStarted` in `Board#handleInput` rather than using cm-chessboard's `enableMoveInput(callback, color)` filter. Avoids re-binding input on every puzzle.
- **`legalMovesFrom` shape:** `Array<{ to, isCapture }>` — only the destination + capture flag (YAGNI; the only consumer paints markers).
- **Theme independence:** marker color is a functional signal, fixed regardless of the active theme.
- **`MARKER_TYPE.dot` and `MARKER_TYPE.circle`** come from the existing `cm-chessboard/src/extensions/markers/Markers.js`. If exact names differ in the installed 8.12.7 version, the implementer adapts (typical exports: `dot`, `frame`, `circlePrimary`, `circleDanger`).

---

## Task 1: `PuzzleSession.legalMovesFrom` (TDD)

**Files:**
- Modify: `src/puzzle.js`
- Modify: `tests/puzzle.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/puzzle.test.js` (above the closing `});` of the file's last describe block, OR as a new top-level describe — pick whichever fits the existing pattern):

```js
describe('legalMovesFrom', () => {
  it('returns [] when status is not awaiting-user', () => {
    const s = new PuzzleSession(matein1Backrank);
    // Pre-setup: status === 'awaiting-setup'.
    expect(s.legalMovesFrom('a1')).toEqual([]);

    // Post-solve: status === 'solved'.
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'a1', to: 'a8' }); // mate
    expect(s.legalMovesFrom('a1')).toEqual([]);
  });

  it('returns legal moves for the source square after setup', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const moves = s.legalMovesFrom('a1');
    // The rook on a1 should have a8 in its legal-move list (and others
    // along the a-file and 1st rank, modulo blockers).
    expect(moves.find((m) => m.to === 'a8')).toEqual({ to: 'a8', isCapture: false });
    expect(moves.length).toBeGreaterThan(0);
  });

  it('flags captures correctly', () => {
    // Construct a synthetic position where a piece can both move to empty
    // squares and capture an enemy piece.
    //
    // Position: white king on e1, white rook on a1, black king on h8, black
    // pawn on a5. White to move (synthetic FEN, no setup move needed —
    // we'll skip applyOpponentSetup by constructing a session with a
    // 1-move puzzle and treating the user move as the only move).
    //
    // Easier: re-use chess.js directly to verify isCapture, since that's
    // the only logic this test cares about.
    const synthPuzzle = {
      id: 'TEST_CAPTURE',
      // Black to move (so opp setup is black, then user is white with a
      // capturing rook).
      fen: '7k/8/8/p7/8/8/8/R3K3 b - - 0 1',
      moves: ['h8h7', 'a1a5'], // black moves king h8→h7, white captures pawn a1×a5
      rating: 800,
      themes: ['mateIn1'],
      stars: 1,
    };
    const s = new PuzzleSession(synthPuzzle);
    s.applyOpponentSetup();
    const moves = s.legalMovesFrom('a1');
    const capture = moves.find((m) => m.to === 'a5');
    expect(capture).toEqual({ to: 'a5', isCapture: true });
    // Other rook moves on the a-file (a2, a3, a4) should be non-captures.
    const a2 = moves.find((m) => m.to === 'a2');
    expect(a2?.isCapture).toBe(false);
  });
});
```

The third test uses a synthetic puzzle inline; it does not need to mate at the end (we're only testing `legalMovesFrom`, which is unrelated to mate-checking). chess.js doesn't care whether the position later mates.

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/puzzle.test.js -t legalMovesFrom`
Expected: FAIL — `s.legalMovesFrom is not a function`.

- [ ] **Step 3: Implement `legalMovesFrom` in `src/puzzle.js`**

Inside the `class PuzzleSession`, after the existing methods (after `playSolutionStep` or whichever the last method is), add:

```js
  legalMovesFrom(square) {
    if (this.status !== 'awaiting-user') return [];
    const moves = this.chess.moves({ square, verbose: true });
    return moves.map((m) => ({
      to: m.to,
      isCapture: m.flags.includes('c') || m.flags.includes('e'),
    }));
  }
```

`chess.moves({ square, verbose: true })` is chess.js v1.4's standard API. Each verbose move has `flags` (string of single-char codes), `from`, `to`, `piece`, `captured`, etc. We use `flags` to detect captures: `'c'` = standard capture, `'e'` = en passant capture.

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/puzzle.test.js -t legalMovesFrom`
Expected: 3 tests pass.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 132 prior + 3 new = 135 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/puzzle.js tests/puzzle.test.js
git commit -m "Add PuzzleSession.legalMovesFrom for legal-move overlays"
```

---

## Task 2: Board color guard + legal-move markers

**Files:**
- Modify: `src/board.js`

This task adds three pieces to `Board`:
1. `userColor` field + `setUserColor(color)` method.
2. `onLegalMoves` constructor callback.
3. Color guard in `#handleInput` + paint/clear marker helpers.

`board.js` is browser-only (bare specifier imports for cm-chessboard); no Node-side unit tests. Manual verification in Task 4.

- [ ] **Step 1: Read the current `src/board.js` to confirm context**

Run: `cat src/board.js`
Expected: file with the `Board` class, `MARKER_TYPE` import from `cm-chessboard/src/extensions/markers/Markers.js`, and a `#handleInput` private method.

- [ ] **Step 2: Add `userColor` field and `onLegalMoves` to constructor**

Find the existing constructor:

```js
constructor(selector, { onUserMove }) {
  // ... existing setup ...
}
```

Replace the destructuring + add field initialization:

```js
constructor(selector, { onUserMove, onLegalMoves }) {
  const root = document.querySelector(selector);
  if (!root) throw new Error(`Board: selector ${selector} not found`);
  this.root = root;
  this.userColor = null;
  this.onLegalMoves = onLegalMoves;

  // ... existing this.cb = new Chessboard(...) and below stays unchanged ...

  this.onUserMove = onUserMove;
  this.cb.enableMoveInput((event) => this.#handleInput(event));
}
```

(Insert `this.userColor = null;` and `this.onLegalMoves = onLegalMoves;` near the top of the constructor body, right after `this.root = root;`.)

- [ ] **Step 3: Add `setUserColor` public method**

After the `element` getter (or wherever fits the existing method order; just outside the constructor), add:

```js
setUserColor(color) {
  // Accepts 'w'/'b' (chess.js style) or 'white'/'black' (cm-chessboard style).
  this.userColor = color;
}
```

- [ ] **Step 4: Update `#handleInput` with color guard + marker logic**

Find the existing `#handleInput`. The current shape is roughly:

```js
#handleInput(event) {
  if (!this.onUserMove) return false;

  if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
    return true;
  }

  if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
    return true;
  }

  if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
    // ... existing move dispatch ...
  }
  return undefined;
}
```

Replace with:

```js
#handleInput(event) {
  if (!this.onUserMove) return false;

  if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
    // Color guard: only user's pieces are pickable.
    if (this.userColor && event.piece) {
      const pieceColor = event.piece[0]; // 'w' or 'b' (cm-chessboard pieces are 'wK', 'bN', etc.)
      const wantColor = this.userColor === 'white' ? 'w'
                      : this.userColor === 'black' ? 'b'
                      : this.userColor;
      if (pieceColor !== wantColor) return false;
    }
    // Paint legal-move markers via the app-supplied callback.
    if (this.onLegalMoves) {
      const square = event.squareFrom ?? event.square;
      const moves = this.onLegalMoves(square);
      this.#paintLegalMarkers(moves);
    }
    return true;
  }

  if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
    return true;
  }

  if (event.type === INPUT_EVENT_TYPE.moveInputCanceled
   || event.type === INPUT_EVENT_TYPE.moveInputFinished) {
    this.#clearLegalMarkers();
  }

  if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
    const from = event.squareFrom;
    const to = event.squareTo;
    if (from && to && event.legalMove) {
      const move = { from, to };
      if (event.promotion) move.promotion = event.promotion;
      this.onUserMove(move);
    }
  }
  return undefined;
}

#paintLegalMarkers(moves) {
  this.#clearLegalMarkers();
  for (const m of moves) {
    if (m.isCapture) {
      this.cb.addMarker(MARKER_TYPE.circle, m.to);
    } else {
      this.cb.addMarker(MARKER_TYPE.dot, m.to);
    }
  }
}

#clearLegalMarkers() {
  this.cb.removeMarkers(MARKER_TYPE.dot);
  this.cb.removeMarkers(MARKER_TYPE.circle);
}
```

Keep the rest of the file (e.g., `setPosition`, `animateMove`, `highlightSquare`, `squareElement` accessor, etc.) unchanged.

**Implementer note on `MARKER_TYPE` names:** the file imports from `cm-chessboard/src/extensions/markers/Markers.js`. The Markers extension typically exposes `MARKER_TYPE.dot`, `MARKER_TYPE.frame`, `MARKER_TYPE.circlePrimary`, `MARKER_TYPE.circleDanger`. If `MARKER_TYPE.circle` doesn't exist, substitute `MARKER_TYPE.circlePrimary`. Verify by `console.log(MARKER_TYPE)` once during the manual test.

- [ ] **Step 5: Smoke-check syntax**

Run: `node --input-type=module -e "import('./src/board.js').then(() => console.log('ok')).catch(e => console.log('IMPORT-ONLY:', e.message))"`
Expected: prints `IMPORT-ONLY: Cannot find package 'cm-chessboard'` (browser-only). NOT a syntax error.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: 135 tests still pass (board.js isn't unit-tested).

- [ ] **Step 7: Commit**

```bash
git add src/board.js
git commit -m "Board: color guard + legal-move dot/ring markers"
```

---

## Task 3: app.js wiring + CSS marker color overrides

**Files:**
- Modify: `src/app.js`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Update `Board` constructor call in `src/app.js`**

Find the existing `Board` instantiation (currently in `main()` near the start):

```js
board = new Board('#board', { onUserMove: handleUserMove });
```

Replace with:

```js
board = new Board('#board', {
  onUserMove: handleUserMove,
  onLegalMoves: (square) => session?.legalMovesFrom(square) ?? [],
});
```

The optional-chain on `session` handles the brief window before `loadNextPuzzle` creates the first session.

- [ ] **Step 2: Call `board.setUserColor` in `loadNextPuzzle`**

Find the existing `loadNextPuzzle`:

```js
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
```

Add a `board.setUserColor(...)` call after `board.animateMove`:

```js
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
  board.setUserColor(session.turn()); // 'w' or 'b' — whoever's turn it is now
}
```

`session.turn()` returns chess.js's side-to-move character (`'w'` or `'b'`) — already exists on `PuzzleSession`.

- [ ] **Step 3: Append CSS marker overrides to `src/ui/styles.css`**

Append to the end of `src/ui/styles.css`:

```css
/* Phase 6.2: green legal-move dots and capture rings. Theme-independent —
   functional signal, not decoration; consistent muscle memory across themes. */
.cm-chessboard .markers .marker.dot circle,
.cm-chessboard .markers-layer .marker.dot circle {
  fill: #7a9f3a;
  fill-opacity: 0.6;
}

.cm-chessboard .markers .marker.circle circle,
.cm-chessboard .markers-layer .marker.circle circle,
.cm-chessboard .markers .marker.circlePrimary circle,
.cm-chessboard .markers-layer .marker.circlePrimary circle {
  stroke: #7a9f3a;
  stroke-width: 4;
  fill: none;
  stroke-opacity: 0.7;
}
```

Both selector forms are included because cm-chessboard's exact wrapper class name varies by version, AND because we use `MARKER_TYPE.circle` or `circlePrimary` depending on what's exported. If only one form takes effect, the other is harmless (no matching DOM nodes).

- [ ] **Step 4: Smoke-check `app.js`**

Run: `node --input-type=module -e "import('./src/app.js').then(() => console.log('ok')).catch(e => console.log('IMPORT-ONLY:', e.message))"`
Expected: `IMPORT-ONLY: Cannot find package ...`. NOT a syntax error.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 135 tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/ui/styles.css
git commit -m "Wire app.js for legal-move aids; add green marker CSS overrides"
```

---

## Task 4: Manual test pass

**Files:** none (exercise the running app, fix any code as issues are found)

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`
Expected: server on port 8000.

- [ ] **Step 2: Walk the manual checklist**

Open Chrome at `http://localhost:8000`. Hard-reload to ensure fresh code. Use DevTools → Console to verify no errors.

1. **Color guard works (white-to-move puzzle).** Reload. Wait for opponent setup move animation. Try to tap a black piece — nothing happens (no selection, no markers). Tap a white piece — selection appears with green markers.
2. **Color guard works (black-to-move puzzle).** Solve a few puzzles until you get one where the user is black. Confirm the inverse: black pieces clickable, white pieces inert.
3. **Legal-move dots on a non-capturing piece.** Tap a piece with several non-capturing legal targets (e.g., a knight or rook with empty squares around it). Each empty target square shows a centered green dot.
4. **Capture rings.** Tap a piece that can capture an enemy. The capturable square shows a green ring around the enemy piece (not a centered dot).
5. **Markers clear on cancel.** Tap a piece (markers appear). Tap an empty square that's NOT a legal target. Selection clears, markers disappear.
6. **Markers clear after a move (correct or incorrect).** Tap a piece, then tap a legal target. Move resolves. Markers disappear.
7. **Re-tap switches markers.** Tap piece A (markers for A). Tap piece B (markers update to B's targets). No leftover dots from A.
8. **Hint button still works.** Tap Hint. Cream frame appears on source square. Confirm it doesn't visually conflict with green dots/rings (different marker types).
9. **Theme switch doesn't change marker color.** Open settings, switch to Cool theme. Tap a piece. Markers still green (`#7a9f3a`).
10. **Phase 5 regressions.** Confetti, sounds, reduced-motion, settings sheet, gear, install button — all still work.
11. **Phase 6.1 regression.** Switching profiles still works; new feature still active after reload.
12. **Console quiet.** No errors or warnings during normal play.

If `MARKER_TYPE.circle` isn't exported (causing capture rings not to render), inspect via DevTools (`MARKER_TYPE` is reachable through the imported module in DevTools' Sources panel) and adjust to `MARKER_TYPE.circlePrimary`. Re-run smoke checks.

If the CSS selectors don't match cm-chessboard's actual marker DOM, inspect via DevTools to find the right class names and update the selectors in `src/ui/styles.css`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "<descriptive message per fix>"
```

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run icons`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from clean clone.
- [ ] All unit tests pass (~135 total: 132 prior + 3 new).
- [ ] Tapping an opponent piece does nothing — no selection, no markers.
- [ ] Tapping a friendly piece shows green dots on empty legal targets and green rings on capturable enemies.
- [ ] Markers clear on cancel, on move resolution, and when a different piece is tapped.
- [ ] Hint button frame and legal-move markers do not visually conflict.
- [ ] Theme switch leaves marker color unchanged.
- [ ] No console errors during normal operation.

---

## Self-review notes

- **Spec coverage:** Every requirement in the spec maps to a task. `legalMovesFrom` (spec §2) = Task 1. Color guard + paint/clear (spec §3, §4) = Task 2. App wiring + CSS overrides (spec §5, §6) = Task 3. Manual test = Task 4.
- **Placeholder check:** No TBD/TODO. All code blocks are concrete.
- **Type consistency:** `legalMovesFrom(square) → Array<{to, isCapture}>` consistent across plan, spec, and tests. `Board.setUserColor / onLegalMoves` consistent. `session.turn()` matches the existing `PuzzleSession` API (already used in Phase 1).
- **Test count math:** Phase 6.1 ended at 132. Task 1 adds 3. Total: 135.
- **Risk surface called out:** the exact `MARKER_TYPE` constant names depend on cm-chessboard 8.12.7's export shape; the manual test step calls out the verification + fallback. The CSS selectors include both `markers` and `markers-layer` forms to cover version variance.
