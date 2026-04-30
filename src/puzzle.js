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
}
