// tests/fixtures.js
//
// All fixtures use the canonical Phase 1 puzzle schema:
//   { id, fen, moves, rating, themes, stars }
// `moves[0]` is the opponent's setup move (Lichess convention).
//
// Each fixture is verified at module-load time: the move list is replayed
// through chess.js and the final position is checked against an
// expected-state predicate. If the line breaks, the import throws.

import { Chess } from 'chess.js';

function buildAndVerify(fen, moves, expectedFinalChecker) {
  const chess = new Chess(fen);
  for (const uci of moves) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length === 5 ? uci[4] : undefined;
    let m;
    try {
      m = chess.move({ from, to, promotion });
    } catch (err) {
      throw new Error(`Fixture move ${uci} threw in position ${chess.fen()}: ${err.message}`);
    }
    if (!m) throw new Error(`Fixture move ${uci} is illegal in position ${chess.fen()}`);
  }
  if (expectedFinalChecker && !expectedFinalChecker(chess)) {
    throw new Error(`Fixture final-state check failed. Final FEN: ${chess.fen()}`);
  }
  return { fen, moves };
}

// Fixture A: simple back-rank mate-in-1.
//   White: Kg1, Ra1. Black: Kg8, pawns f7/g7/h7, knight on c6.
//   Black to move. Opponent plays knight off the 8th-rank defense
//   (Nc6-e5 — a non-pawn move that does NOT open a king escape on the
//   7th rank). Then user plays Ra1-a8# (back-rank mate, knight on e5
//   cannot interpose since none of c4/c6/d3/d7/f3/f7/g4/g6 lie on
//   the 8th rank).
const matein1Candidate = buildAndVerify(
  '6k1/5ppp/2n5/8/8/8/8/R5K1 b - - 0 1',
  ['c6e5', 'a1a8'],
  (chess) => chess.isCheckmate(),
);

export const matein1Backrank = {
  id: 'TEST_M1_BACKRANK',
  fen: matein1Candidate.fen,
  moves: matein1Candidate.moves,
  rating: 800,
  themes: ['mateIn1', 'backRankMate'],
  stars: 1,
};

// Fixture B: mate-in-2, two-rook ladder mate.
//   Position: White Kf6, Ra1, Ra2. Black Kg8 alone. Black to move.
//   Line:
//     0. Kg8-h8       (black retreats; legal alongside Kf8, Kh7;
//                      the puzzle script picks h8)
//     1. Ra2-a8+      (rook lifts to 8th rank delivering check)
//     2. Kh8-h7       (forced — only legal escape; g8/h6/g7 all covered)
//     3. Ra1-h1#      (second rook clamps the h-file; all 5 escape
//                      squares around Kh7 are covered by Kf6, Ra8, or Rh1)
const matein2Candidate = buildAndVerify(
  '6k1/8/5K2/8/8/8/R7/R7 b - - 0 1',
  ['g8h8', 'a2a8', 'h8h7', 'a1h1'],
  (chess) => chess.isCheckmate(),
);

export const matein2Fixture = {
  id: 'TEST_M2_LADDER',
  fen: matein2Candidate.fen,
  moves: matein2Candidate.moves,
  rating: 1100,
  themes: ['mateIn2'],
  stars: 2,
};

// Fixture C: promotion-mate-in-1.
//   White: Kc6, Pa7. Black: Kb8 alone. Black to move (already in check
//   from Pa7's diagonal capture threat onto b8).
//   moves[0]: 'b8c8' — black king to c8 (not attacked by Kc6 or Pa7).
//   moves[1]: 'a7a8q' — pawn promotes to queen; Qa8 covers the entire
//     8th rank (b8, d8) and a-file (a7); together with Kc6 covering
//     b7, c7, d7, all 5 squares around Kc8 are denied. Mate.
const promotionCandidate = buildAndVerify(
  '1k6/P7/2K5/8/8/8/8/8 b - - 0 1',
  ['b8c8', 'a7a8q'],
  (chess) => chess.isCheckmate(),
);

export const promotionFixture = {
  id: 'TEST_M1_PROMO',
  fen: promotionCandidate.fen,
  moves: promotionCandidate.moves,
  rating: 900,
  themes: ['mateIn1', 'promotion'],
  stars: 1,
};
