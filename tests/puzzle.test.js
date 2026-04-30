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

describe('attemptUserMove (mate-in-1 correct)', () => {
  it('returns {result:correct, solved:true} when user plays the mate', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const result = s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(result.result).toBe('correct');
    expect(result.solved).toBe(true);
    expect(s.status).toBe('solved');
  });

  it('the chess instance reflects the mate', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(s.chess.isCheckmate()).toBe(true);
  });
});

describe('attemptUserMove (incorrect)', () => {
  it('returns {result:incorrect} for a wrong move', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const result = s.attemptUserMove({ from: 'g1', to: 'g2' });
    expect(result.result).toBe('incorrect');
  });

  it('does not mutate state on incorrect', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const fenBefore = s.fen();
    const idxBefore = s.moveIndex;
    const statusBefore = s.status;
    s.attemptUserMove({ from: 'g1', to: 'g2' });
    expect(s.fen()).toBe(fenBefore);
    expect(s.moveIndex).toBe(idxBefore);
    expect(s.status).toBe(statusBefore);
  });

  it('user can retry after an incorrect move', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'g1', to: 'g2' });
    const result = s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(result.result).toBe('correct');
    expect(result.solved).toBe(true);
  });
});

describe('attemptUserMove (multi-move)', () => {
  it('applies opponent reply and returns to awaiting-user', () => {
    const s = new PuzzleSession(matein2Fixture);
    s.applyOpponentSetup();
    // moves: [opp, user, opp, user]; user's first move is moves[1].
    const userMove1 = parseUciFor(matein2Fixture.moves[1]);
    const r = s.attemptUserMove(userMove1);
    expect(r.result).toBe('correct');
    expect(r.solved).toBe(false);
    expect(r.opponentReply).toBeTruthy();
    // After opponent reply, status should be 'awaiting-user' again
    // (we still have moves[3] for the user).
    expect(s.status).toBe('awaiting-user');
    expect(s.moveIndex).toBe(3);
  });

  it('completes the puzzle when user plays the final mate', () => {
    const s = new PuzzleSession(matein2Fixture);
    s.applyOpponentSetup();
    s.attemptUserMove(parseUciFor(matein2Fixture.moves[1]));
    const r = s.attemptUserMove(parseUciFor(matein2Fixture.moves[3]));
    expect(r.result).toBe('correct');
    expect(r.solved).toBe(true);
    expect(s.status).toBe('solved');
    expect(s.chess.isCheckmate()).toBe(true);
  });
});

// Local helper used by multi-move tests.
function parseUciFor(uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const out = { from, to };
  if (uci.length === 5) out.promotion = uci[4];
  return out;
}
