import { describe, it, expect, beforeEach } from 'vitest';
import { PuzzleSession } from '../src/puzzle.js';
import { matein1Backrank, matein2Fixture, promotionFixture } from './fixtures.js';

describe('PuzzleSession construction', () => {
  it('initializes with status awaiting-setup and moveIndex 0', () => {
    const s = new PuzzleSession(matein1Backrank);
    expect(s.status).toBe('awaiting-setup');
    expect(s.moveIndex).toBe(0);
  });

  it('exposes the FEN from the puzzle data', () => {
    const s = new PuzzleSession(matein1Backrank);
    expect(s.fen()).toBe(matein1Backrank.fen);
  });

  it('reports the correct turn from the FEN', () => {
    const s = new PuzzleSession(matein1Backrank);
    // FEN side-to-move = 'b' (black) → opponent is black, user is white
    expect(s.turn()).toBe('b');
  });

  it('orientation is the side that plays moves[1] (the user)', () => {
    const s = new PuzzleSession(matein1Backrank);
    // matein1Backrank FEN side-to-move = 'b' → opponent black plays move 0;
    // user is white → orientation 'white'
    expect(s.orientation()).toBe('white');
  });
});
