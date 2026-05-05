# Phase 6.3 — King-escape aid + Aids settings section

## Goal

Help a kid solve mate-in-1 puzzles by showing, on piece selection, which squares around the opposing king are still escape routes (red) and which are already covered (gray). Wrap this and the existing legal-move dots in a new "Learning aids" settings section so each can be toggled per-profile.

## Behavior

**Trigger.** Piece selection (`moveInputStarted`). Same trigger as the Phase 6.2 legal-move dots. `moveInputCanceled` and `moveInputFinished` clear all aid markers.

**Visualization.** Around the opponent king's 8 adjacent squares:

- **Red** (`#c25555`, translucent fill, locked danger color): squares the king *can* legally move to right now. Open escape routes.
- **Gray** (translucent fill): adjacent on-board squares the king *cannot* legally move to. Lumps together: own-piece blocks, attacked squares, defended attackers.
- **No marker:** off-board squares (king on edge/corner).

When both legal-move dots and king-escape are enabled, green dots (or capture rings) layer on top of the red/gray fills — visually compatible because the fills are translucent.

**"Vacate the selected piece."** When computing the surround, the selected piece is treated as already removed from the board. Rationale: the kid is *planning* to move that piece. If the bishop currently covers f7 and the kid selects the bishop, f7 must show as red — moving the bishop will break that coverage unless the destination still covers it. Showing it as gray would mislead the kid into thinking f7 is handled.

**Independence.** Each aid has its own toggle. Color guard (only your-color pieces are pickable) is unconditional — not part of the aid system.

**Defaults.**
- `aidLegalMoves`: **true** (preserves Phase 6.2 default — legal-move dots stay on for existing users).
- `aidKingEscape`: **false** (new feature, opt-in).

**Persistence.** Per-profile via the existing `ProfileScopedStore.setMeta` infrastructure under keys `aidLegalMoves` and `aidKingEscape`. Same shape as `soundOn` / `theme` / `showCoords`.

## Architecture

```
PuzzleSession.opponentKingSurround(selectedSquare?) ──┐
                                                      ├─→ Board.#paintKingMarkers(surround)
Settings.aidLegalMoves / aidKingEscape ───────────────┤
                                                      └─→ board.setShowLegalMoves(...)
                                                          board.setShowKingEscape(...)

Board.#handleInput on moveInputStarted:
  1. Color guard (unconditional)
  2. If aidLegalMoves: paint green dots/rings via onLegalMoves(square)
  3. If aidKingEscape: paint red/gray squares via onKingSurround(square)

Board.#handleInput on moveInputCanceled / moveInputFinished:
  Clear all four marker types (dot, circle, marker-king-escape, marker-king-covered).
```

## Components

### `PuzzleSession.opponentKingSurround(selectedSquare = null)`

Returns `{ escapes: string[], covered: string[] }`.

Algorithm:

1. Guard: status must be `awaiting-user`; otherwise return empty.
2. Locate the opponent king on the live position (`chess.board()` scan; king position itself does not depend on `selectedSquare`).
3. Build a cloned `Chess` instance with side-to-move swapped to opponent and en-passant cleared (`parts[3] = '-'`). Wrap in try/catch — return empty on parse failure as a safety net.
4. If `selectedSquare` is non-null, call `cloned.remove(selectedSquare)` to vacate the about-to-move piece.
5. `escapes = cloned.moves({ square: kingSq, verbose: true })`, filtered to adjacent (file delta ≤ 1 AND rank delta ≤ 1, dropping castling), mapped to the `to` square. Stored as a Set.
6. Iterate the 8 neighbor offsets `(df, dr) ∈ {-1,0,1}² \ {(0,0)}` from the king's file/rank. For each on-board neighbor not in `escapes`, push to `covered`.
7. Return `{ escapes: [...escapes], covered }`.

The clone is created once per piece-select. chess.js's verbose move generation handles all the legality nuances (own-piece blocks, attacks, defended attackers, captures into safe squares) — we don't reimplement them.

### `Board`

New constructor option: `onKingSurround: (selectedSquare) => ({ escapes, covered })`. Peer to `onLegalMoves`.

New private fields with default values: `#showLegalMoves = true`, `#showKingEscape = false`.

New setters: `setShowLegalMoves(on)`, `setShowKingEscape(on)`. Stores the boolean on the field; doesn't repaint immediately (changes apply on the next piece-select, which is the natural rhythm).

Two new module-level marker-type constants reusing cm-chessboard's filled-square sprite slice:

```js
const MARKER_KING_ESCAPE  = { class: 'marker-king-escape',  slice: 'markerSquare' };
const MARKER_KING_COVERED = { class: 'marker-king-covered', slice: 'markerSquare' };
```

In `moveInputStarted`, after the color guard:

```js
if (this.#showLegalMoves && this.onLegalMoves) {
  this.#paintLegalMarkers(this.onLegalMoves(square));
}
if (this.#showKingEscape && this.onKingSurround) {
  this.#paintKingMarkers(this.onKingSurround(square));
}
```

`#paintKingMarkers({escapes, covered})` adds `MARKER_KING_ESCAPE` for each escape and `MARKER_KING_COVERED` for each covered square. The existing `#clearLegalMarkers` is renamed to `#clearAidMarkers` and removes all four marker types so cancel/finish wipes everything cleanly.

### `Settings`

Two new fields, two new setters:

```js
this.aidLegalMoves = true;   // default ON
this.aidKingEscape = false;  // default OFF
```

`load()` reads them with the existing `?? default` pattern. `setAidLegalMoves(on)` / `setAidKingEscape(on)` follow the same shape as `setSound` / `setShowCoords` — coerce to boolean, persist, store on instance.

`snapshot()` includes the new fields for testing.

### Settings sheet UI (`index.html` + `src/ui/settings.js`)

A new "Learning aids" section in the settings sheet, placed after the Coordinates row and before the Reset Stats row, so it sits with the other display-toggle rows. Two checkbox rows using the same widget pattern as Sound and Coordinates:

```html
<div class="settings-section">
  <div class="settings-section-title">Learning aids</div>
  <div class="setting-row">
    <label for="setting-aid-legal">Show legal moves</label>
    <input type="checkbox" id="setting-aid-legal" />
  </div>
  <div class="setting-row">
    <label for="setting-aid-king">Show king's escape squares</label>
    <input type="checkbox" id="setting-aid-king" />
  </div>
</div>
```

`bindSettings` is extended:

- Inputs read in `syncControls`.
- `change` listener on each toggle calls `settings.setAidX(checked)` AND `board.setShowX(checked)` so the change takes effect immediately on the next piece selection. (Requires passing `board` into `bindSettings` — peer to `settings`/`profiles`.)

### CSS (`src/ui/styles.css`)

Two rules following the same selector pattern as the green dots from Phase 6.2 (cm-chessboard renders markers as `<use>` elements with hyphenated classes):

```css
.cm-chessboard .markers .marker.marker-king-escape  { fill: #c25555; opacity: 0.45; }
.cm-chessboard .markers .marker.marker-king-covered { fill: #8a8a8a; opacity: 0.30; }
```

Theme-independent — these are functional signals, like the green dots.

### App wiring (`src/app.js`)

In Board construction, add:

```js
onKingSurround: (square) => session?.opponentKingSurround(square) ?? { escapes: [], covered: [] }
```

After `settings.load()`, sync the flags onto the board:

```js
board.setShowLegalMoves(settings.aidLegalMoves);
board.setShowKingEscape(settings.aidKingEscape);
```

Pass `board` into `bindSettings` so the settings UI listeners can call the same setters when the user toggles them live.

## Testing

Unit tests in `tests/puzzle.test.js` for `opponentKingSurround`:

1. **Status guard** — when not `awaiting-user`, returns `{escapes: [], covered: []}`.
2. **All-covered back-rank** — opponent king on the back rank (e.g., e8) with all 5 on-board neighbors (d7, e7, f7, d8, f8) occupied by the opponent's own pieces. Expect 5 covered, 0 escapes.
3. **Corner clip** — opponent king in the corner (e.g., a8); only 3 neighbors total; verify only those 3 are reported.
4. **Mixed scenario** — some neighbors are escapes (open and unattacked), some are covered (attacked or own-piece-occupied); both lists are populated correctly.
5. **`selectedSquare` removal** — set up a position where a user piece on square X is the *only* attacker of an adjacent-to-king square Y. With `selectedSquare = null`, Y is covered. With `selectedSquare = X`, Y becomes an escape. Direct test of the "vacate the selected piece" semantics.
6. **Side-to-move sanity** — a position evaluated correctly regardless of which color is on move (run the same FEN with the user as white vs. as black and verify both produce coherent output).

No Board-level tests (browser-only, consistent with the existing pattern).

Manual verification (dev server, browser):

- Open a known mate-in-1; confirm red squares around the enemy king when a non-mating piece is selected.
- Toggle each aid in the settings sheet and verify the next piece-select reflects the new state.
- Toggle profile and verify each profile's aid preferences persist independently.
- Confirm green dots layer cleanly over red/gray fills when both aids are on.

## Out of scope (explicit non-goals)

- **Hypothetical "what if I move here" preview.** The visualization shows the *current* king state with the selected piece vacated — it does NOT recompute as the kid drags toward a target square. The kid still has to mentally simulate the move's consequences. Future enhancement, not now.
- **Theme-conditional aids.** The aids fire on every puzzle regardless of theme. Mate-in-1 is the motivating use case but the aids are useful for non-mate puzzles too.
- **Highlighting which user pieces attack which king-neighbor.** The aid is one-directional (state of the king's escape options), not a teaching tool for piece coordination. Could be a future Phase 6.x.
