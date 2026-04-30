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

describe('applyOpponentSetup', () => {
  it('plays moves[0], advances moveIndex to 1, sets status to awaiting-user', () => {
    const s = new PuzzleSession(matein1Backrank);
    const move = s.applyOpponentSetup();
    expect(move.from).toBe('c6');
    expect(move.to).toBe('e5');
    expect(s.moveIndex).toBe(1);
    expect(s.status).toBe('awaiting-user');
  });

  it('the chess instance reflects the opponent setup move', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    // Knight moved c6 -> e5; FEN should show 'n' on board, no 'n' on c6.
    const fen = s.fen();
    expect(fen).toMatch(/n/); // sanity: knight still on board
    // After the move, side-to-move flips to white (the user).
    expect(s.turn()).toBe('w');
  });

  it('throws if called twice', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    expect(() => s.applyOpponentSetup()).toThrow();
  });
});
