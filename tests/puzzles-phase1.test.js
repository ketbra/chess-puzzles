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
