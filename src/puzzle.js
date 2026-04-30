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

  hint() {
    const expected = parseUci(this.puzzle.moves[this.moveIndex]);
    return { square: expected.from };
  }
}
