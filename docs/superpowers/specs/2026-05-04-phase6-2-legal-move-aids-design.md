# Phase 6.2 Design: Legal-move learning aids

**Date:** 2026-05-04
**Phase:** 6.2 of 6 (second sub-project of Phase 6 stretch features)
**Predecessors:**
- Phases 1–5 shipped (designs in `docs/superpowers/specs/`)
- Phase 6.1 multi-profile shipped

**Goal:** Add two kid-friendly learning aids: (1) only pieces of the side-to-move are clickable / draggable; (2) when a piece is selected, show green dots on legal target squares and green rings around capturable enemy pieces.

This is the second of four Phase 6 stretch sub-projects (multi-profile, legal-move aids, king-escape danger, daily streak calendar). Each gets its own design + plan + implementation cycle. Sub-project 6.2 deliberately stays narrow so the king-escape danger feature (red overlays, attacked-square computation) can build on its color taxonomy in a separate phase.

---

## Color taxonomy (locked in across Phase 6.x)

Three semantic overlay colors, fixed regardless of board theme so the kid's muscle memory stays consistent:

| Color | Meaning | Phase |
|---|---|---|
| Green `#7a9f3a` | "go / legal" — dots on legal target squares, rings on capturable pieces | 6.2 |
| Red `#c25555` | "danger" — uncovered king-escape squares, pieces under attack | 6.3 |
| Cream `#f0d9b5` | "key / hint" — Hint button source-square frame | 1 (existing) |

These colors are functional signals, not decoration. They look the same on warm and cool board palettes by design.

---

## Scope

### In scope (Phase 6.2)

**1. Constrain piece selection to the side-to-move.**

When a puzzle is awaiting a user move, only the user's pieces are clickable / draggable. Tapping an opponent piece does nothing (no selection, no markers, no flash). Implemented in `Board#handleInput` by returning `false` from the `moveInputStarted` event when the piece's color doesn't match `Board.userColor`.

The user's color comes from chess.js's side-to-move character (`'w'` or `'b'`) after the opponent setup move applies. `app.js` calls `board.setUserColor(session.turn())` inside `loadNextPuzzle()` immediately after `applyOpponentSetup()`.

**2. Legal-move overlays.**

When the kid taps a friendly piece (and it's their turn), green markers appear:
- Empty legal target squares get a centered **dot** marker (`MARKER_TYPE.dot`).
- Capturable enemy pieces get a **ring** marker around the square (`MARKER_TYPE.circle` or whichever cm-chessboard variant suits the markers extension).

Markers clear automatically when:
- The move resolves (`moveInputFinished` event).
- The user cancels by tapping elsewhere (`moveInputCanceled`).
- A different piece is tapped (next `moveInputStarted` triggers a clear-then-paint cycle).

**3. New `PuzzleSession.legalMovesFrom(square)` method.**

Returns `Array<{ to, isCapture }>` for every legal move from the given square. Returns `[]` if the session isn't `'awaiting-user'`. Uses chess.js's `chess.moves({ square, verbose: true })`; capture detection uses the verbose move's `flags` field (`'c'` for capture, `'e'` for en passant).

### Out of scope (deferred or not planned)

| Feature | Phase / decision |
|---|---|
| King-escape danger squares (red markers around enemy king) | 6.3 |
| Pieces-under-attack warnings | 6.3 (or 6.4) |
| Last-move highlight | not planned |
| Threat indicators (squares opponent attacks generally) | not planned |
| Toggle to disable legal-move markers (for advanced kids) | not planned for 6.2; revisit if requested |

---

## File changes

| Action | Path | Notes |
|---|---|---|
| Modify | `src/puzzle.js` | Add `legalMovesFrom(square)` method on `PuzzleSession` |
| Modify | `tests/puzzle.test.js` | 3 new tests for `legalMovesFrom` |
| Modify | `src/board.js` | Add `userColor` field + `setUserColor(color)`; add `onLegalMoves` constructor callback; color guard + dot/ring rendering in `#handleInput` |
| Modify | `src/app.js` | Pass `onLegalMoves` to `Board`; call `board.setUserColor(...)` after each `applyOpponentSetup()` |
| Modify | `src/ui/styles.css` | Override marker SVG colors for the legal-move dot and capture-ring marker types |
| (none) | tests for `board.js` | No new unit tests; board.js stays manually verified |

---

## `PuzzleSession.legalMovesFrom`

```js
legalMovesFrom(square) {
  // Returns array of { to, isCapture } for every legal move from `square`.
  // Returns [] when the session isn't awaiting a user move.
  if (this.status !== 'awaiting-user') return [];
  const moves = this.chess.moves({ square, verbose: true });
  return moves.map((m) => ({
    to: m.to,
    isCapture: m.flags.includes('c') || m.flags.includes('e'),
  }));
}
```

Pure function over the existing chess.js instance. No state mutation. No defensive checks beyond the status guard — chess.js handles invalid square strings by returning `[]`.

---

## `Board` changes

New constructor option `onLegalMoves: (square) => Array<{ to, isCapture }>`. New `userColor` field starts at `null` and is set by `setUserColor(color)`.

```js
constructor(selector, { onUserMove, onLegalMoves }) {
  // ... existing setup ...
  this.userColor = null;
  this.onLegalMoves = onLegalMoves;
}

setUserColor(color) {
  // Accepts 'w'/'b' (chess.js style) or 'white'/'black'.
  this.userColor = color;
}

#handleInput(event) {
  if (!this.onUserMove) return false;

  if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
    // Color guard: only user's pieces are pickable.
    if (this.userColor && event.piece) {
      const pieceColor = event.piece[0]; // cm-chessboard pieces are 'wK', 'bN', etc.
      const wantColor = this.userColor === 'white' ? 'w'
                      : this.userColor === 'black' ? 'b'
                      : this.userColor;
      if (pieceColor !== wantColor) return false;
    }
    // Paint legal-move markers.
    if (this.onLegalMoves) {
      const moves = this.onLegalMoves(event.squareFrom ?? event.square);
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

**API notes for the implementer:**
- `MARKER_TYPE.dot` and `MARKER_TYPE.circle` come from `cm-chessboard/src/extensions/markers/Markers.js`. If either name differs in the installed version (8.12.7), substitute the closest equivalent — typical cm-chessboard 8.x exports include `dot`, `frame`, `circlePrimary`, `circleDanger`. Confirm during smoke test.
- `event.piece` field name and shape may vary; `console.log(event)` during the manual test pass to verify and adjust if needed.
- `event.squareFrom` is the canonical source-square field on cm-chessboard 8.x's `moveInputStarted` event; the `?? event.square` fallback handles older shapes.

---

## App.js wiring

Constructor (one line added):

```js
board = new Board('#board', {
  onUserMove: handleUserMove,
  onLegalMoves: (square) => session?.legalMovesFrom(square) ?? [],
});
```

Inside `loadNextPuzzle()`, after `applyOpponentSetup()`:

```js
const setup = session.applyOpponentSetup();
await board.animateMove({ from: setup.from, to: setup.to });
board.setUserColor(session.turn()); // 'w' or 'b' — whoever's turn it is now
```

`session.turn()` already exists on `PuzzleSession` (returns the chess.js side-to-move). After `applyOpponentSetup()` it's the user's color.

---

## CSS — marker color overrides

cm-chessboard's marker layer uses SVG `<circle>` elements with class names tied to the marker type. The override targets those:

```css
/* Phase 6.2: green legal-move dots and capture rings. Fixed color
   regardless of theme, so the kid's "this is where I can go" muscle
   memory stays consistent. */
.cm-chessboard .markers .marker.dot circle,
.cm-chessboard .markers-layer .marker.dot circle {
  fill: #7a9f3a;
  fill-opacity: 0.6;
}

.cm-chessboard .markers .marker.circle circle,
.cm-chessboard .markers-layer .marker.circle circle {
  stroke: #7a9f3a;
  stroke-width: 4;
  fill: none;
  stroke-opacity: 0.7;
}
```

Both selector forms are included because cm-chessboard's exact wrapper class name varies by version. The implementer verifies via DevTools inspection during the manual test pass and removes the unused selector if desired.

---

## Test plan

| File | Group | Tests |
|---|---|---|
| `tests/puzzle.test.js` | `legalMovesFrom` returns [] before setup | session in `'awaiting-setup'` returns `[]` for any square |
| `tests/puzzle.test.js` | `legalMovesFrom` returns correct moves after setup | for the `matein1Backrank` fixture's `'a1'` square (rook), result includes `{to:'a8', isCapture:false}` |
| `tests/puzzle.test.js` | `legalMovesFrom` flags captures correctly | construct a position where a piece can both move to empty squares and capture; verify `isCapture: true` only on the capture target |

Approximate new test count: 3. Target total: 132 + 3 = 135.

`board.js` and the CSS overrides are not unit-tested. They're verified manually in the next section.

---

## Manual test plan

1. **Color guard works (mate-in-1, white to move).** Reload. After the opponent setup move animates, try to tap a black piece — nothing happens. Tap a white piece — selection appears with green markers.
2. **Color guard works (mate-in-1, black to move).** Find or jump to a puzzle where the user is black. Confirm the inverse: black pieces clickable, white pieces inert.
3. **Legal-move dots on a non-capturing move.** Tap a piece with several non-capturing legal targets (e.g., a knight in the middle of the board). Each empty target square shows a centered green dot.
4. **Capture rings.** Tap a piece that can capture. The capturable square shows a green ring around the enemy piece (not a centered dot).
5. **Markers clear on cancel.** Tap a piece (markers appear). Tap an empty square that's NOT a legal target. Selection clears, markers disappear.
6. **Markers clear after move.** Tap a piece (markers appear). Tap a legal target. Move resolves (correct or wrong); markers disappear.
7. **Re-tap switches.** Tap piece A (markers for A). Tap piece B (markers update to B's targets). No leftover dots from A.
8. **Hint button still works.** Tap Hint. Cream frame still appears on source square (separate marker type — should not conflict with green dots/rings).
9. **Multi-move puzzle.** On a multi-move puzzle (will need a synthetic / future real one to test), after the user's first correct move and opponent's reply, color guard re-engages for the new turn.
10. **Theme switch doesn't change marker color.** Switch to Cool theme. Tap a piece. Markers still green.
11. **Phase 5 regressions.** Confetti, sounds, reduced-motion, settings sheet, gear, install button — all still work.
12. **Phase 6.1 regression.** Switching profiles still preserves the new feature (color guard re-engages after reload, markers still green).

---

## Definition of done

- [ ] All unit tests pass (~135 total).
- [ ] Tapping an opponent piece does nothing — no selection, no markers.
- [ ] Tapping a friendly piece shows green dots on empty legal targets and green rings on capturable enemies.
- [ ] Markers clear on cancel, on move resolution, and when a different piece is tapped.
- [ ] Hint button frame and legal-move markers do not visually conflict.
- [ ] No console errors during normal operation.

---

## Architecture trade-offs explicitly considered

- **Color guard via `#handleInput` return-false vs cm-chessboard's `enableMoveInput(callback, color)` constraint.** Return-false chosen. cm-chessboard's color filter argument constrains globally and would need re-binding on every puzzle (`enableMoveInput` followed by `disableMoveInput`); the return-false approach is one extra check inside our existing handler and trivially adapts when the user's color changes mid-session.
- **Computing legal moves at the app layer vs inside `Board`.** App layer (via `onLegalMoves` callback). `Board` has no chess engine; pushing the chess.js dependency into `Board` would couple it to puzzle logic and break the existing UI/logic separation.
- **`isCapture` shape returned by `legalMovesFrom`.** A simple boolean. Could have returned the full chess.js verbose move; the only consumer (Board's marker painter) needs only the destination square and capture flag, so YAGNI.
- **CSS-driven color override vs JS-injected style.** CSS. Single source of truth in `styles.css` next to the rest of the theme rules; survives DOM rebuilds without re-injection.
- **Theme-independent marker color.** Functional signal, not decoration. Consistency across themes preserves the kid's muscle memory.
- **Hint frame and legal-move markers coexist.** Different `MARKER_TYPE`s; both layers render simultaneously. The hint frame is yellow/cream and surrounds a square outer edge; the legal-move dot fills the center. Visually distinct without clash.
- **Defer king-escape feature to 6.3.** Lets 6.2 ship narrow and validates the color taxonomy before adding the second semantic color (red).
