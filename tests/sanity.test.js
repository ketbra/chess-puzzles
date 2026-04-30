import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';

describe('sanity', () => {
  it('chess.js loads and parses the start position', () => {
    const chess = new Chess();
    expect(chess.fen().startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBe(true);
    expect(chess.turn()).toBe('w');
  });

  it('chess.js accepts a move via {from, to}', () => {
    const chess = new Chess();
    const move = chess.move({ from: 'e2', to: 'e4' });
    expect(move).toBeTruthy();
    expect(move.san).toBe('e4');
  });
});
