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

  attemptUserMove({ from, to, promotion }) {
    if (this.status !== 'awaiting-user') {
      throw new Error(`attemptUserMove called in status ${this.status}`);
    }
    const submitted = formatMove({ from, to, promotion });
    const expectedUci = this.puzzle.moves[this.moveIndex];
    const isFinalUserMove = this.moveIndex === this.puzzle.moves.length - 1;

    // Path 1: exact match with the puzzle's intended line.
    if (submitted === expectedUci) {
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

    // Path 2: not the canonical line. On the FINAL user move, accept any
    // legal move that delivers checkmate (mate-in-1 positions often have
    // multiple mating moves; rejecting them is bad UX for a kid learner).
    // For non-final user moves in multi-move puzzles, the canonical line
    // must be followed exactly because the rest of the sequence depends on it.
    if (isFinalUserMove) {
      let applied;
      try {
        applied = this.chess.move({ from, to, promotion });
      } catch {
        return { result: 'incorrect' };
      }
      if (!applied) return { result: 'incorrect' };

      if (this.chess.isCheckmate()) {
        this.moveIndex += 1;
        this.status = 'solved';
        return { result: 'correct', applied, solved: true };
      }

      // Legal but doesn't mate — undo and reject.
      this.chess.undo();
      return { result: 'incorrect' };
    }

    return { result: 'incorrect' };
  }

  hint() {
    const expected = parseUci(this.puzzle.moves[this.moveIndex]);
    return { square: expected.from };
  }

  // Plays the next canonical user move (and opponent reply if multi-move),
  // bypassing the equality check in attemptUserMove. Used by the "Show"
  // solution button. Returns the same shape as a 'correct' attemptUserMove.
  playSolutionStep() {
    if (this.status !== 'awaiting-user') {
      throw new Error(`playSolutionStep called in status ${this.status}`);
    }
    const userMoveUci = this.puzzle.moves[this.moveIndex];
    const applied = this.chess.move(parseUci(userMoveUci));
    if (!applied) {
      throw new Error(
        `Solution user move ${userMoveUci} is illegal in puzzle ${this.puzzle.id}`,
      );
    }
    this.moveIndex += 1;

    if (this.moveIndex >= this.puzzle.moves.length) {
      this.status = 'solved';
      return { applied, solved: true };
    }

    const replyUci = this.puzzle.moves[this.moveIndex];
    const opponentReply = this.chess.move(parseUci(replyUci));
    if (!opponentReply) {
      throw new Error(
        `Opponent reply ${replyUci} is illegal in puzzle ${this.puzzle.id}`,
      );
    }
    this.moveIndex += 1;
    this.status = this.moveIndex >= this.puzzle.moves.length ? 'solved' : 'awaiting-user';
    return { applied, opponentReply, solved: this.status === 'solved' };
  }

  legalMovesFrom(square) {
    if (this.status !== 'awaiting-user') return [];
    const moves = this.chess.moves({ square, verbose: true });
    return moves.map((m) => ({
      to: m.to,
      isCapture: m.flags.includes('c') || m.flags.includes('e'),
    }));
  }

  opponentKingSurround(selectedSquare = null) {
    if (this.status !== 'awaiting-user') return { kingSquare: null, escapes: [], covered: [] };
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
    if (!kingSq) return { kingSquare: null, escapes: [], covered: [] };

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
      return { kingSquare: null, escapes: [], covered: [] };
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
    return { kingSquare: kingSq, escapes: [...escapes], covered };
  }
}
