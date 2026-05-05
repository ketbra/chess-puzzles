# Phase 6.3 — King-Escape Aid + Aids Settings Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "king-escape" learning aid that highlights the opposing king's escape squares (red) and covered neighbors (gray) when the user selects a piece, plus a per-profile "Learning aids" settings section that toggles legal-move dots and king-escape independently.

**Architecture:** A new `PuzzleSession.opponentKingSurround(selectedSquare?)` method computes escape vs. covered squares using a side-to-move-swapped chess.js clone with the selected piece removed (so squares the about-to-move piece currently covers correctly classify as escapes). The `Board` paints two new custom marker types (filled red/gray squares) gated by flags settable from `Settings`. UI toggles in the settings sheet persist per-profile via the existing `ProfileScopedStore`.

**Tech Stack:** Vanilla ES modules, Vitest, chess.js v1.4 (uses `chess.fen()`, `chess.board()`, `chess.moves({square, verbose: true})`, `new Chess(fen)`, `chess.remove(square)`), cm-chessboard 8.12.7 with the Markers extension (custom marker types via `{class, slice}` objects, reference-equality matching for add/remove).

**Spec:** `docs/superpowers/specs/2026-05-05-phase6-3-king-escape-aid-design.md`

---

## File map

- **Modify** `src/puzzle.js` — add `opponentKingSurround(selectedSquare = null)` method.
- **Modify** `tests/puzzle.test.js` — add `describe('opponentKingSurround', ...)` block.
- **Modify** `src/settings.js` — add `aidLegalMoves` (default `true`) and `aidKingEscape` (default `false`) fields, `load()` reads, two new setters, include in `snapshot()`.
- **Modify** `tests/settings.test.js` — update default-snapshot test, add round-trip tests for the two new fields.
- **Modify** `src/board.js` — add `onKingSurround` callback, two new module-level marker-type consts, `#showLegalMoves`/`#showKingEscape` fields with setters, gate paints on flags, rename `#clearLegalMarkers` → `#clearAidMarkers` and clear all four marker types.
- **Modify** `index.html` — add "Learning aids" section to the settings sheet between Coordinates and Reset Stats rows.
- **Modify** `src/ui/settings.js` — accept `board` param, bind new toggles to write Settings AND call Board setters.
- **Modify** `src/app.js` — pass `onKingSurround` to Board constructor, sync flags onto board after `settings.load()`, pass `board` into `bindSettings`.
- **Modify** `src/ui/styles.css` — add CSS for `.marker-king-escape` (red fill) and `.marker-king-covered` (gray fill) following the Phase 6.2 selector pattern.

---

## Task 1: `PuzzleSession.opponentKingSurround` (TDD)

**Files:**
- Modify: `src/puzzle.js`
- Test: `tests/puzzle.test.js`

- [ ] **Step 1: Write the failing tests**

Append the following block to the END of `tests/puzzle.test.js` (after the existing `describe('legalMovesFrom', ...)` block):

```js
describe('opponentKingSurround', () => {
  it('returns empty before applyOpponentSetup (status awaiting-setup)', () => {
    const s = new PuzzleSession(matein1Backrank);
    expect(s.opponentKingSurround()).toEqual({ escapes: [], covered: [] });
  });

  it('returns empty after solve (status solved)', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(s.opponentKingSurround()).toEqual({ escapes: [], covered: [] });
  });

  it('clips to on-board neighbors when king is in the corner', () => {
    // Goal: test that the BLACK king (h8, alone in corner) has only 3
    // on-board neighbors (g7, h7, g8) and they all classify as escapes.
    // For opponentKingSurround to target the BLACK king, the user must be
    // WHITE (chess.turn()==='w' post-setup), which requires FEN side-to-move
    // = 'b' so the opponent (black) moves first. Black needs a legal move
    // that doesn't disturb h8's neighborhood — use a black pawn far away.
    const corner = {
      id: 'TEST_CORNER',
      fen: '7k/p7/8/8/8/8/8/4K3 b - - 0 1',
      moves: ['a7a6', 'e1e2'], // black pawn moves; placeholder white move (not played)
      rating: 0,
      themes: ['mateIn1'],
      stars: 1,
    };
    const s = new PuzzleSession(corner);
    s.applyOpponentSetup(); // black plays a7a6 — now white to move (user)
    const r = s.opponentKingSurround();
    expect(new Set(r.escapes)).toEqual(new Set(['g7', 'h7', 'g8']));
    expect(r.covered).toEqual([]);
  });

  it('reports all 5 on-back-rank neighbors as covered when blocked by own pieces', () => {
    // Goal: BLACK king e8 surrounded by black own pieces on all 5 on-board
    // neighbors. Use rooks on d8/f8 (pawns are illegal on rank 8 for black)
    // and pawns on d7/e7/f7. Add a black knight on a8 so black has a legal
    // setup move (a8→b6) that doesn't disturb the surround. FEN side-to-move
    // = 'b' so the user is white post-setup.
    const blocked = {
      id: 'TEST_BLOCKED',
      fen: 'n2rkr2/3ppp2/8/8/8/8/8/4K3 b - - 0 1',
      moves: ['a8b6', 'e1e2'], // black knight moves; placeholder white move (not played)
      rating: 0,
      themes: ['mateIn1'],
      stars: 1,
    };
    const s = new PuzzleSession(blocked);
    s.applyOpponentSetup(); // black plays a8b6 — now white to move (user)
    const r = s.opponentKingSurround();
    expect(r.escapes).toEqual([]);
    expect(new Set(r.covered)).toEqual(new Set(['d7', 'e7', 'f7', 'd8', 'f8']));
  });

  it('mixes escapes and covered when some neighbors are attacked', () => {
    // Goal: BLACK king e8 with white rook on a7 attacking the 7th rank.
    // Adjacent: d7/e7/f7 attacked → covered; d8/f8 unattacked → escapes.
    // Add a black pawn on h7 so black has a legal setup move (h7h5) that
    // doesn't disturb e8's neighborhood. FEN side-to-move = 'b'.
    const mixed = {
      id: 'TEST_MIXED',
      fen: '4k3/R6p/8/8/8/8/8/4K3 b - - 0 1',
      moves: ['h7h5', 'e1e2'], // black pawn moves; placeholder white move (not played)
      rating: 0,
      themes: ['mateIn1'],
      stars: 1,
    };
    const s = new PuzzleSession(mixed);
    s.applyOpponentSetup(); // black plays h7h5 — now white to move (user)
    const r = s.opponentKingSurround();
    expect(new Set(r.covered)).toEqual(new Set(['d7', 'e7', 'f7']));
    expect(new Set(r.escapes)).toEqual(new Set(['d8', 'f8']));
  });

  it('treats selectedSquare as vacated: removing the only attacker reclassifies covered → escape', () => {
    // Construct a position where WHITE (the user) is to move with a queen as
    // the SOLE attacker of squares around the black king. To get white-to-move
    // post-setup, FEN side-to-move = 'b' so the opponent (black) moves first.
    // Black king on e8 → king moves to e7 (legal: e7 not attacked from d5).
    // After setup: white to move, black king now on e7.
    //
    // Black king e7 neighbors: d6, e6, f6, d7, f7, d8, e8, f8.
    // White queen on d5 attacks: d-file (d6, d7, d8), 5th rank, and diagonals
    // (c4,b3,a2 / e4,f3,g2,h1 / c6,b7,a8 / e6,f7,g8). So adjacent attacked:
    // d6, e6, d7, f7, d8 → covered.  f6, e8, f8 → escapes.
    //
    // With selectedSquare='d5' (queen vacates): only the white king remains
    // (on e1) — too far to attack any e7 neighbor. So all 8 become escapes.
    const queenOnly = {
      id: 'TEST_QUEEN_VACATE',
      fen: '4k3/8/8/3Q4/8/8/8/4K3 b - - 0 1',
      moves: ['e8e7', 'd5d6'], // black king e8→e7; placeholder white move (not played)
      rating: 0,
      themes: ['mateIn1'],
      stars: 1,
    };
    const s = new PuzzleSession(queenOnly);
    s.applyOpponentSetup(); // black plays e8e7; now white to move (user).

    const noVacate = s.opponentKingSurround();
    expect(new Set(noVacate.covered)).toEqual(new Set(['d6', 'e6', 'd7', 'f7', 'd8']));
    expect(new Set(noVacate.escapes)).toEqual(new Set(['f6', 'e8', 'f8']));

    const withVacate = s.opponentKingSurround('d5');
    expect(new Set(withVacate.escapes)).toEqual(
      new Set(['d6', 'e6', 'f6', 'd7', 'f7', 'd8', 'e8', 'f8']),
    );
    expect(withVacate.covered).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- tests/puzzle.test.js
```

Expected: all 6 new tests in the `opponentKingSurround` describe block FAIL with `s.opponentKingSurround is not a function`. Existing tests still pass.

- [ ] **Step 3: Implement `opponentKingSurround` in `src/puzzle.js`**

Append this method to the `PuzzleSession` class, after `legalMovesFrom` (line 158, before the closing `}`):

```js
  opponentKingSurround(selectedSquare = null) {
    if (this.status !== 'awaiting-user') return { escapes: [], covered: [] };
    const userColor = this.chess.turn();
    const oppColor = userColor === 'w' ? 'b' : 'w';

    // Locate the opponent king on the live position.
    let kingSq = null;
    outer: for (const row of this.chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === oppColor) {
          kingSq = cell.square;
          break outer;
        }
      }
    }
    if (!kingSq) return { escapes: [], covered: [] };

    // Clone the position with side-to-move swapped to the opponent (so
    // chess.moves() returns the opponent king's legal moves) and en-passant
    // cleared (avoids invalid-FEN edge cases; doesn't affect king moves).
    const parts = this.chess.fen().split(' ');
    parts[1] = oppColor;
    parts[3] = '-';
    let cloned;
    try {
      cloned = new Chess(parts.join(' '));
    } catch {
      return { escapes: [], covered: [] };
    }

    // Treat the about-to-move piece as already gone, so squares it currently
    // covers correctly classify as escapes (the kid is planning that move).
    if (selectedSquare) {
      cloned.remove(selectedSquare);
    }

    // King's legal moves to adjacent squares (filter out castling).
    const escapes = new Set(
      cloned.moves({ square: kingSq, verbose: true })
        .filter((m) => {
          const df = Math.abs(m.from.charCodeAt(0) - m.to.charCodeAt(0));
          const dr = Math.abs(parseInt(m.from[1], 10) - parseInt(m.to[1], 10));
          return df <= 1 && dr <= 1;
        })
        .map((m) => m.to),
    );

    // On-board adjacent squares not in escapes are "covered".
    const file = kingSq.charCodeAt(0); // 'a' = 97
    const rank = parseInt(kingSq[1], 10);
    const covered = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const f = file + df;
        const r = rank + dr;
        if (f < 97 || f > 104 || r < 1 || r > 8) continue;
        const sq = String.fromCharCode(f) + r;
        if (!escapes.has(sq)) covered.push(sq);
      }
    }
    return { escapes: [...escapes], covered };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/puzzle.test.js
```

Expected: all `opponentKingSurround` tests PASS, all existing `puzzle.test.js` tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/puzzle.js tests/puzzle.test.js
git commit -m "$(cat <<'EOF'
feat(puzzle): add opponentKingSurround for king-escape aid

Computes the opponent king's escape squares and covered neighbors via
a side-to-move-swapped clone with the selected piece optionally vacated.
The "vacate selected piece" semantics ensure squares the about-to-move
piece currently covers display as escapes, not covered — the kid would
otherwise be misled into thinking those squares are handled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `Settings` — `aidLegalMoves` and `aidKingEscape` fields (TDD)

**Files:**
- Modify: `src/settings.js`
- Test: `tests/settings.test.js`

- [ ] **Step 1: Update the default-snapshot test and add round-trip tests**

In `tests/settings.test.js`, REPLACE the existing first test (lines 16-21):

```js
  it('initializes with defaults on a fresh DB', async () => {
    const store = await new Store().open();
    const s = await new Settings(store).load();
    expect(s.snapshot()).toEqual({ soundOn: false, theme: 'warm', showCoords: false });
    await store.close();
  });
```

with:

```js
  it('initializes with defaults on a fresh DB', async () => {
    const store = await new Store().open();
    const s = await new Settings(store).load();
    expect(s.snapshot()).toEqual({
      soundOn: false,
      theme: 'warm',
      showCoords: false,
      aidLegalMoves: true,
      aidKingEscape: false,
    });
    await store.close();
  });
```

REPLACE the existing persistence test (lines 50-62) with:

```js
  it('persists across Settings instances', async () => {
    const store = await new Store().open();
    const s1 = await new Settings(store).load();
    await s1.setSound(true);
    await s1.setTheme('cool');
    await s1.setShowCoords(true);
    await s1.setAidLegalMoves(false);
    await s1.setAidKingEscape(true);
    await store.close();

    const store2 = await new Store().open();
    const s2 = await new Settings(store2).load();
    expect(s2.snapshot()).toEqual({
      soundOn: true,
      theme: 'cool',
      showCoords: true,
      aidLegalMoves: false,
      aidKingEscape: true,
    });
    await store2.close();
  });
```

ADD two new round-trip tests immediately after the existing `it('round-trips showCoords', ...)` block (around line 47):

```js
  it('round-trips aidLegalMoves', async () => {
    const store = await new Store().open();
    const s = await new Settings(store).load();
    await s.setAidLegalMoves(false);
    expect(s.snapshot().aidLegalMoves).toBe(false);
    expect(await store.getMeta('aidLegalMoves')).toBe(false);
    await store.close();
  });

  it('round-trips aidKingEscape', async () => {
    const store = await new Store().open();
    const s = await new Settings(store).load();
    await s.setAidKingEscape(true);
    expect(s.snapshot().aidKingEscape).toBe(true);
    expect(await store.getMeta('aidKingEscape')).toBe(true);
    await store.close();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/settings.test.js
```

Expected: the new round-trip tests FAIL with `s.setAidLegalMoves is not a function` / `s.setAidKingEscape is not a function`. The default-snapshot and persistence tests fail because the snapshot is missing the new fields.

- [ ] **Step 3: Update `src/settings.js`**

Replace the entire file content with:

```js
// src/settings.js
// Settings state + IDB persistence. Mirrors the Stats/Filters pattern.

export class Settings {
  constructor(store) {
    this.store = store;
    this.soundOn = false;
    this.theme = 'warm';
    this.showCoords = false;
    this.aidLegalMoves = true;   // Phase 6.3: legal-move dots default ON.
    this.aidKingEscape = false;  // Phase 6.3: king-escape default OFF (opt-in).
  }

  async load() {
    this.soundOn       = (await this.store.getMeta('soundOn'))       ?? false;
    this.theme         = (await this.store.getMeta('theme'))         ?? 'warm';
    this.showCoords    = (await this.store.getMeta('showCoords'))    ?? false;
    this.aidLegalMoves = (await this.store.getMeta('aidLegalMoves')) ?? true;
    this.aidKingEscape = (await this.store.getMeta('aidKingEscape')) ?? false;
    return this;
  }

  async setSound(on) {
    this.soundOn = !!on;
    await this.store.setMeta('soundOn', this.soundOn);
  }

  async setTheme(t) {
    this.theme = t;
    await this.store.setMeta('theme', this.theme);
  }

  async setShowCoords(on) {
    this.showCoords = !!on;
    await this.store.setMeta('showCoords', this.showCoords);
  }

  async setAidLegalMoves(on) {
    this.aidLegalMoves = !!on;
    await this.store.setMeta('aidLegalMoves', this.aidLegalMoves);
  }

  async setAidKingEscape(on) {
    this.aidKingEscape = !!on;
    await this.store.setMeta('aidKingEscape', this.aidKingEscape);
  }

  apply() {
    document.body.classList.toggle('theme-cool', this.theme === 'cool');
    document.body.classList.toggle('show-coords', !!this.showCoords);
  }

  snapshot() {
    return {
      soundOn: this.soundOn,
      theme: this.theme,
      showCoords: this.showCoords,
      aidLegalMoves: this.aidLegalMoves,
      aidKingEscape: this.aidKingEscape,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/settings.test.js
```

Expected: all `Settings` tests PASS.

- [ ] **Step 5: Run the FULL suite**

```bash
npm test
```

Expected: all tests PASS (Settings change does not break any other module).

- [ ] **Step 6: Commit**

```bash
git add src/settings.js tests/settings.test.js
git commit -m "$(cat <<'EOF'
feat(settings): add aidLegalMoves/aidKingEscape per-profile flags

Two new persisted booleans for the Phase 6.3 Aids settings section.
aidLegalMoves defaults true (preserves Phase 6.2 behavior); aidKingEscape
defaults false (opt-in for the new feature).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `Board` — king-escape marker types and aid-flag gating

**Files:**
- Modify: `src/board.js`

No unit tests for `Board` (browser-only module — consistent with existing pattern). After this task, manual verification happens together with the wiring tasks.

- [ ] **Step 1: Replace the entire `src/board.js` content**

Replace `src/board.js` with:

```js
// src/board.js
// Browser-only module — not imported in Node; never unit-tested in Phase 1.
import {
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE,
} from 'cm-chessboard';
import { Markers, MARKER_TYPE } from 'cm-chessboard/src/extensions/markers/Markers.js';

const ASSETS_URL = './vendor/cm-chessboard/assets/';

// Phase 6.3: custom marker types for the king-escape aid. cm-chessboard
// matches markers by reference equality (Marker.matches uses `===` on the
// type object), so each const must be a stable singleton and the SAME
// reference must be used for both addMarker and removeMarkers calls.
const MARKER_KING_ESCAPE  = { class: 'marker-king-escape',  slice: 'markerSquare' };
const MARKER_KING_COVERED = { class: 'marker-king-covered', slice: 'markerSquare' };

export class Board {
  #showLegalMoves = true;   // Phase 6.3: toggleable via setShowLegalMoves
  #showKingEscape = false;  // Phase 6.3: toggleable via setShowKingEscape

  constructor(selector, { onUserMove, onLegalMoves, onKingSurround }) {
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Board: selector ${selector} not found`);
    this.root = root;
    this.userColor = null;
    this.onLegalMoves = onLegalMoves;
    this.onKingSurround = onKingSurround;

    this.cb = new Chessboard(root, {
      assetsUrl: ASSETS_URL,
      orientation: COLOR.white,
      style: {
        cssClass: 'default',
        showCoordinates: true,
        pieces: { type: 'svgSprite', file: 'pieces/staunty.svg' },
      },
      extensions: [{ class: Markers }],
    });

    this.onUserMove = onUserMove;
    this.cb.enableMoveInput((event) => this.#handleInput(event));
  }

  get element() {
    return this.root;
  }

  setUserColor(color) {
    // Accepts 'w'/'b' (chess.js style) or 'white'/'black' (cm-chessboard style).
    this.userColor = color;
  }

  setShowLegalMoves(on) {
    this.#showLegalMoves = !!on;
  }

  setShowKingEscape(on) {
    this.#showKingEscape = !!on;
  }

  setPosition(fen, orientation) {
    if (orientation) {
      this.cb.setOrientation(orientation === 'white' ? COLOR.white : COLOR.black);
    }
    return this.cb.setPosition(fen, false);
  }

  async animateMove({ from, to }) {
    await this.cb.movePiece(from, to, true);
  }

  highlightSquare(square, _kind = 'hint') {
    this.cb.removeMarkers(MARKER_TYPE.frame);
    this.cb.addMarker(MARKER_TYPE.frame, square);
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this.cb.removeMarkers(MARKER_TYPE.frame);
    }, 2000);
  }

  squareElement(square) {
    return this.root.querySelector(`[data-square="${square}"]`);
  }

  #handleInput(event) {
    if (!this.onUserMove) return false;

    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
      // Color guard: only user's pieces are pickable. Unconditional — not
      // part of the toggleable aid system.
      if (this.userColor && event.piece) {
        const pieceColor = event.piece[0]; // cm-chessboard pieces are 'wK', 'bN', etc.
        const wantColor = this.userColor === 'white' ? 'w'
                        : this.userColor === 'black' ? 'b'
                        : this.userColor;
        if (pieceColor !== wantColor) return false;
      }
      const square = event.squareFrom ?? event.square;
      // Aid 1: green legal-move dots/rings.
      if (this.#showLegalMoves && this.onLegalMoves) {
        this.#paintLegalMarkers(this.onLegalMoves(square));
      }
      // Aid 2: red/gray king-escape markers.
      if (this.#showKingEscape && this.onKingSurround) {
        this.#paintKingMarkers(this.onKingSurround(square));
      }
      return true;
    }

    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      return true; // always accept; game logic validates externally
    }

    if (event.type === INPUT_EVENT_TYPE.moveInputCanceled
     || event.type === INPUT_EVENT_TYPE.moveInputFinished) {
      this.#clearAidMarkers();
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
    // Clear the legal-move markers (dot/circle) before repainting; leave
    // any king-escape markers intact (they share the same select trigger
    // and were painted in the same #handleInput call if enabled).
    this.cb.removeMarkers(MARKER_TYPE.dot);
    this.cb.removeMarkers(MARKER_TYPE.circle);
    for (const m of moves) {
      if (m.isCapture) {
        this.cb.addMarker(MARKER_TYPE.circle, m.to);
      } else {
        this.cb.addMarker(MARKER_TYPE.dot, m.to);
      }
    }
  }

  #paintKingMarkers({ escapes, covered }) {
    this.cb.removeMarkers(MARKER_KING_ESCAPE);
    this.cb.removeMarkers(MARKER_KING_COVERED);
    for (const sq of escapes)  this.cb.addMarker(MARKER_KING_ESCAPE,  sq);
    for (const sq of covered)  this.cb.addMarker(MARKER_KING_COVERED, sq);
  }

  #clearAidMarkers() {
    this.cb.removeMarkers(MARKER_TYPE.dot);
    this.cb.removeMarkers(MARKER_TYPE.circle);
    this.cb.removeMarkers(MARKER_KING_ESCAPE);
    this.cb.removeMarkers(MARKER_KING_COVERED);
  }
}
```

- [ ] **Step 2: Run the full suite to confirm nothing else broke**

```bash
npm test
```

Expected: all tests PASS. (Board has no unit tests; this is a sanity check that no other test imports Board indirectly.)

- [ ] **Step 3: Commit**

```bash
git add src/board.js
git commit -m "$(cat <<'EOF'
feat(board): king-escape markers + per-aid flag gating

Adds two custom cm-chessboard marker types (filled red/gray squares) for
the Phase 6.3 king-escape aid, and #showLegalMoves/#showKingEscape flags
that gate each aid's paint independently. Color guard remains unconditional.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: CSS for king-escape markers

**Files:**
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Append CSS rules to `src/ui/styles.css`**

Append at the END of `src/ui/styles.css` (after the existing Phase 6.2 marker rules at line 557):

```css

/* Phase 6.3: king-escape aid. Translucent fills so the green legal-move
   dots layer cleanly on top when both aids are on simultaneously.
   Color taxonomy: red = danger (escape route still open),
   gray = neutral (covered by attack or own-piece block). */
.cm-chessboard .markers .marker.marker-king-escape {
  fill: #c25555;
  opacity: 0.45;
}

.cm-chessboard .markers .marker.marker-king-covered {
  fill: #8a8a8a;
  opacity: 0.30;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/styles.css
git commit -m "$(cat <<'EOF'
feat(styles): red/gray fills for king-escape aid markers

Translucent so the green legal-move dots remain visible when both aids
are toggled on. Color taxonomy: #c25555 red = danger (open escape),
gray = covered.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Settings sheet UI — "Learning aids" section

**Files:**
- Modify: `index.html`
- Modify: `src/ui/settings.js`
- Modify: `src/app.js`

- [ ] **Step 1: Add the Learning aids section to `index.html`**

In `index.html`, INSERT the following block immediately after the closing `</div>` of the Coordinates row (after line 66, before the Reset Stats setting-row at line 67):

```html
      <div class="settings-section-title">Learning aids</div>
      <div class="setting-row">
        <span>Show legal moves</span>
        <label class="toggle">
          <input id="setting-aid-legal" type="checkbox">
          <span class="slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <span>Show king's escape squares</span>
        <label class="toggle">
          <input id="setting-aid-king" type="checkbox">
          <span class="slider"></span>
        </label>
      </div>
```

(The `.settings-section-title` class doesn't exist yet — that's fine. We will style it in step 2.)

- [ ] **Step 2: Add minimal CSS for the section title**

Append to `src/ui/styles.css`:

```css

/* Phase 6.3: section title within the settings sheet (sits between
   setting rows). Differentiates the "Learning aids" subsection from
   the rows above/below without requiring a full nested container. */
.settings-section-title {
  margin: 12px 4px 4px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}
```

- [ ] **Step 3: Update `src/ui/settings.js` to bind the new toggles**

Replace the entire content of `src/ui/settings.js` with:

```js
// src/ui/settings.js
// Binds the gear icon, settings sheet, scrim, and all controls
// (sound toggle, theme segmented, coords toggle, aid toggles, reset stats).

import { bindProfileSection } from './profile.js';

export function bindSettings({ settings, profiles, board, onResetStats }) {
  bindProfileSection({ profiles });
  const gear = document.querySelector('#gear-btn');
  const sheet = document.querySelector('#settings-sheet');
  const scrim = document.querySelector('#settings-scrim');
  const closeBtn = document.querySelector('#settings-close');
  const soundToggle = document.querySelector('#setting-sound');
  const themeWarm = document.querySelector('#setting-theme-warm');
  const themeCool = document.querySelector('#setting-theme-cool');
  const coordsToggle = document.querySelector('#setting-coords');
  const aidLegalToggle = document.querySelector('#setting-aid-legal');
  const aidKingToggle = document.querySelector('#setting-aid-king');
  const resetBtn = document.querySelector('#setting-reset-stats');

  syncControls(settings);

  gear.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);

  soundToggle.addEventListener('change', async () => {
    await settings.setSound(soundToggle.checked);
  });
  themeWarm.addEventListener('click', async () => {
    await settings.setTheme('warm');
    settings.apply();
    syncControls(settings);
  });
  themeCool.addEventListener('click', async () => {
    await settings.setTheme('cool');
    settings.apply();
    syncControls(settings);
  });
  coordsToggle.addEventListener('change', async () => {
    await settings.setShowCoords(coordsToggle.checked);
    settings.apply();
  });
  aidLegalToggle.addEventListener('change', async () => {
    await settings.setAidLegalMoves(aidLegalToggle.checked);
    if (board) board.setShowLegalMoves(aidLegalToggle.checked);
  });
  aidKingToggle.addEventListener('change', async () => {
    await settings.setAidKingEscape(aidKingToggle.checked);
    if (board) board.setShowKingEscape(aidKingToggle.checked);
  });

  // Reset stats: in-place two-stage confirm with 3s disarm timeout.
  let resetArmed = false;
  let disarmTimer = null;
  resetBtn.addEventListener('click', async () => {
    if (!resetArmed) {
      resetBtn.textContent = 'Confirm reset';
      resetBtn.classList.add('confirming');
      resetArmed = true;
      clearTimeout(disarmTimer);
      disarmTimer = setTimeout(() => {
        resetArmed = false;
        resetBtn.textContent = 'Reset stats';
        resetBtn.classList.remove('confirming');
      }, 3000);
      return;
    }
    clearTimeout(disarmTimer);
    await onResetStats();
    resetArmed = false;
    resetBtn.textContent = 'Reset stats';
    resetBtn.classList.remove('confirming');
  });

  function syncControls(s) {
    soundToggle.checked = s.soundOn;
    coordsToggle.checked = s.showCoords;
    aidLegalToggle.checked = s.aidLegalMoves;
    aidKingToggle.checked = s.aidKingEscape;
    themeWarm.classList.toggle('active', s.theme === 'warm');
    themeCool.classList.toggle('active', s.theme === 'cool');
  }

  function open() { sheet.classList.add('open'); scrim.classList.add('visible'); }
  function close() { sheet.classList.remove('open'); scrim.classList.remove('visible'); }
}
```

- [ ] **Step 4: Wire `app.js` to pass `onKingSurround`, sync flags, and pass `board` to `bindSettings`**

In `src/app.js`, REPLACE the `Board` construction (lines 55-58):

```js
  board = new Board('#board', {
    onUserMove: handleUserMove,
    onLegalMoves: (square) => session?.legalMovesFrom(square) ?? [],
  });
```

with:

```js
  board = new Board('#board', {
    onUserMove: handleUserMove,
    onLegalMoves: (square) => session?.legalMovesFrom(square) ?? [],
    onKingSurround: (square) => session?.opponentKingSurround(square) ?? { escapes: [], covered: [] },
  });
```

REPLACE the `settings.apply()` call and surrounding lines (lines 81-83):

```js
  settings = await new Settings(scopedStore).load();
  settings.apply();
```

with:

```js
  settings = await new Settings(scopedStore).load();
  settings.apply();
  board.setShowLegalMoves(settings.aidLegalMoves);
  board.setShowKingEscape(settings.aidKingEscape);
```

REPLACE the `bindSettings` call (lines 88-95):

```js
  bindSettings({
    settings,
    profiles,
    onResetStats: async () => {
      await stats.reset();
      renderStats(stats.snapshot());
    },
  });
```

with:

```js
  bindSettings({
    settings,
    profiles,
    board,
    onResetStats: async () => {
      await stats.reset();
      renderStats(stats.snapshot());
    },
  });
```

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: all tests PASS. (No unit tests for `app.js` / `ui/settings.js` directly.)

- [ ] **Step 6: Manual browser verification**

```bash
npm run dev
```

Open the printed local URL in a browser. Verify:

1. App loads, a puzzle appears.
2. Click an opposing piece → no markers (color guard, unchanged behavior).
3. Click one of your pieces → green dots appear (legal moves), red squares around enemy king do NOT yet (default off).
4. Open settings (gear icon). Confirm a "LEARNING AIDS" subtitle followed by two toggles. "Show legal moves" is ON. "Show king's escape squares" is OFF.
5. Toggle "Show king's escape squares" ON. Close the sheet. Click one of your pieces → BOTH green dots AND red/gray markers around the enemy king appear.
6. Cancel the selection (click off-board or drop on origin) → all markers clear.
7. Toggle "Show legal moves" OFF in settings. Click a piece → only red/gray markers around the enemy king (no green dots).
8. Toggle both off → only the color guard fires (no aid markers at all).
9. Switch to a different profile (via profile-switcher in settings). Toggle aids differently. Switch back to first profile — the first profile's aid preferences should be restored.

- [ ] **Step 7: Commit**

```bash
git add index.html src/ui/settings.js src/ui/styles.css src/app.js
git commit -m "$(cat <<'EOF'
feat(ui): Aids settings section + king-escape wiring

Adds the "Learning aids" section in the settings sheet with toggles for
legal-move dots and king-escape markers. Each toggle writes Settings AND
calls the matching Board flag so changes take effect on the next piece-
select. App syncs both flags onto the board after Settings.load().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (controller, post-plan)

- **Spec coverage:**
  - "Trigger on piece selection" → Task 3 step 1 (#handleInput moveInputStarted).
  - "Red on escape, gray on covered, none off-board" → Task 1 step 3 (algorithm), Task 4 step 1 (CSS).
  - "Vacate selected piece" → Task 1 step 3 (`cloned.remove(selectedSquare)`), Task 1 step 1 (queen-only test).
  - "Aids independent" → Task 3 step 1 (separate `if (this.#showX)` blocks).
  - "Defaults: legal=true, king=false" → Task 2 step 3 (constructor + load defaults).
  - "Per-profile persistence" → Task 2 step 3 (uses `this.store.getMeta/setMeta`, scoped store passed in by app.js — unchanged).
  - "Settings sheet section between Coordinates and Reset Stats" → Task 5 step 1 (insert location).
  - "Test cases #1–#6" from spec → Task 1 step 1 covers status guard, corner clip, all-covered back-rank, mixed scenario, selectedSquare-removal (two variants — basic shape + queen-only-attacker), side-to-move correctness implicit in mixed/queen tests (different colors on move).
- **Placeholder scan:** no TODOs/TBDs. All code blocks show actual code.
- **Type consistency:** `opponentKingSurround` returns `{escapes: string[], covered: string[]}` consistently across spec, tests, and Board's `#paintKingMarkers`. `setShowLegalMoves`/`setShowKingEscape` names match across Settings, Board, and bindSettings. `aidLegalMoves`/`aidKingEscape` keys match across Settings init, load, setters, snapshot, and bindSettings reads.
