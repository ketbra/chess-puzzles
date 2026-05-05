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

describe('hint', () => {
  it('returns the source square of the next user move', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    expect(s.hint()).toEqual({ square: 'a1' });
  });

  it('does not mutate state', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const idxBefore = s.moveIndex;
    s.hint();
    expect(s.moveIndex).toBe(idxBefore);
  });

  it('returns the next user move source after partial multi-move progress', () => {
    const s = new PuzzleSession(matein2Fixture);
    s.applyOpponentSetup();
    s.attemptUserMove({
      from: matein2Fixture.moves[1].slice(0, 2),
      to: matein2Fixture.moves[1].slice(2, 4),
    });
    expect(s.hint().square).toBe(matein2Fixture.moves[3].slice(0, 2));
  });
});

describe('promotion', () => {
  it('accepts queen promotion when expected move is queen promotion', () => {
    const s = new PuzzleSession(promotionFixture);
    s.applyOpponentSetup();
    const r = s.attemptUserMove({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(r.result).toBe('correct');
    expect(r.solved).toBe(true);
  });

  it('rejects knight promotion when expected move is queen promotion', () => {
    const s = new PuzzleSession(promotionFixture);
    s.applyOpponentSetup();
    const r = s.attemptUserMove({ from: 'a7', to: 'a8', promotion: 'n' });
    expect(r.result).toBe('incorrect');
    // State unchanged: still awaiting user.
    expect(s.status).toBe('awaiting-user');
  });
});

describe('API guards', () => {
  it('attemptUserMove throws when called before setup', () => {
    const s = new PuzzleSession(matein1Backrank);
    expect(() => s.attemptUserMove({ from: 'a1', to: 'a8' })).toThrow();
  });

  it('attemptUserMove throws when called after solved', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(() => s.attemptUserMove({ from: 'a8', to: 'a7' })).toThrow();
  });

  it('applyOpponentSetup throws if called twice', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    expect(() => s.applyOpponentSetup()).toThrow();
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

describe('attemptUserMove (alternative mate)', () => {
  // Synthetic puzzle with TWO valid mate-in-1 moves:
  //   White Kg2, Qd1, Ra1. Black Kg8, pawns f7/g7/h7, knight on b6.
  //   After black's setup (Nb6-c4 — moves out of the way of both mate lines),
  //   white has TWO mates:
  //     canonical: Qd1-d8#
  //     alternative: Ra1-a8#
  //   PuzzleSession should accept either, since rejecting a valid mate is
  //   bad UX for a kid learner.
  const altMatesPuzzle = {
    id: 'TEST_ALT_MATES',
    fen: '6k1/5ppp/1n6/8/8/8/6K1/R2Q4 b - - 0 1',
    moves: ['b6c4', 'd1d8'], // canonical: Qd8#
    rating: 1000,
    themes: ['mateIn1'],
    stars: 2,
  };

  it('accepts the canonical mate', () => {
    const s = new PuzzleSession(altMatesPuzzle);
    s.applyOpponentSetup();
    const r = s.attemptUserMove({ from: 'd1', to: 'd8' });
    expect(r.result).toBe('correct');
    expect(r.solved).toBe(true);
  });

  it('accepts an alternative mate (Ra8#) on the final user move', () => {
    const s = new PuzzleSession(altMatesPuzzle);
    s.applyOpponentSetup();
    const r = s.attemptUserMove({ from: 'a1', to: 'a8' });
    expect(r.result).toBe('correct');
    expect(r.solved).toBe(true);
    expect(s.chess.isCheckmate()).toBe(true);
  });

  it('rejects a legal-but-non-mating move and leaves state unchanged', () => {
    const s = new PuzzleSession(altMatesPuzzle);
    s.applyOpponentSetup();
    const fenBefore = s.fen();
    const r = s.attemptUserMove({ from: 'g2', to: 'g3' }); // legal king move, not mate
    expect(r.result).toBe('incorrect');
    expect(s.fen()).toBe(fenBefore);
    expect(s.status).toBe('awaiting-user');
  });
});

describe('playSolutionStep', () => {
  it('plays the user move and solves a mate-in-1', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const r = s.playSolutionStep();
    expect(r.solved).toBe(true);
    expect(r.applied.from).toBe('a1');
    expect(r.applied.to).toBe('a8');
    expect(s.status).toBe('solved');
    expect(s.chess.isCheckmate()).toBe(true);
  });

  it('plays user move and opponent reply on multi-move, returning to awaiting-user', () => {
    const s = new PuzzleSession(matein2Fixture);
    s.applyOpponentSetup();
    const r = s.playSolutionStep();
    expect(r.solved).toBe(false);
    expect(r.opponentReply).toBeTruthy();
    expect(s.status).toBe('awaiting-user');
    expect(s.moveIndex).toBe(3);
  });

  it('completes a multi-move puzzle when called repeatedly', () => {
    const s = new PuzzleSession(matein2Fixture);
    s.applyOpponentSetup();
    s.playSolutionStep();
    const r = s.playSolutionStep();
    expect(r.solved).toBe(true);
    expect(s.status).toBe('solved');
    expect(s.chess.isCheckmate()).toBe(true);
  });

  it('throws when called outside awaiting-user', () => {
    const s = new PuzzleSession(matein1Backrank);
    expect(() => s.playSolutionStep()).toThrow(); // before setup
    s.applyOpponentSetup();
    s.playSolutionStep();
    expect(() => s.playSolutionStep()).toThrow(); // after solved
  });
});

describe('legalMovesFrom', () => {
  it('returns [] when status is not awaiting-user', () => {
    const s = new PuzzleSession(matein1Backrank);
    // Pre-setup: status === 'awaiting-setup'.
    expect(s.legalMovesFrom('a1')).toEqual([]);

    // Post-solve: status === 'solved'.
    s.applyOpponentSetup();
    s.attemptUserMove({ from: 'a1', to: 'a8' }); // mate
    expect(s.legalMovesFrom('a1')).toEqual([]);
  });

  it('returns legal moves for the source square after setup', () => {
    const s = new PuzzleSession(matein1Backrank);
    s.applyOpponentSetup();
    const moves = s.legalMovesFrom('a1');
    // The rook on a1 should have a8 in its legal-move list (and others
    // along the a-file and 1st rank, modulo blockers).
    expect(moves.find((m) => m.to === 'a8')).toEqual({ to: 'a8', isCapture: false });
    expect(moves.length).toBeGreaterThan(0);
  });

  it('flags captures correctly', () => {
    // Position: white king on e1, white rook on a1, black king on h8, black
    // pawn on a5. Black to move first (per Lichess convention), then white
    // captures pawn a1×a5.
    const synthPuzzle = {
      id: 'TEST_CAPTURE',
      fen: '7k/8/8/p7/8/8/8/R3K3 b - - 0 1',
      moves: ['h8h7', 'a1a5'], // black king h8→h7, white captures pawn a1×a5
      rating: 800,
      themes: ['mateIn1'],
      stars: 1,
    };
    const s = new PuzzleSession(synthPuzzle);
    s.applyOpponentSetup();
    const moves = s.legalMovesFrom('a1');
    const capture = moves.find((m) => m.to === 'a5');
    expect(capture).toEqual({ to: 'a5', isCapture: true });
    // Other rook moves on the a-file (a2, a3, a4) should be non-captures.
    const a2 = moves.find((m) => m.to === 'a2');
    expect(a2?.isCapture).toBe(false);
  });
});

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
