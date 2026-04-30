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
