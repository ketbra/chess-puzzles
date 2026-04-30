// src/puzzles-phase1.js
// Five hand-picked mate-in-1 puzzles for the Phase 1 demo.
// Schema matches what the Phase 2 data pipeline will produce.
//
// Puzzle structure:
//   { id, fen, moves, rating, themes, stars }
//   moves[0] — opponent's setup move (Lichess convention)
//   moves[1] — user's mating move
//
// Star rating mapping: <800 → 1 star, 800–1099 → 2 stars, 1100–1399 → 3 stars
//
// All positions are verified: each line was traced through chess.js and confirmed
// to produce checkmate (see tests/puzzles-phase1.test.js).

export const phase1Puzzles = [
  // -----------------------------------------------------------------------
  // Puzzle 1: Back-rank rook mate (Ra8#)
  // White Ra1 delivers checkmate on the back rank.
  // Position: White Kg1 Ra1 | Black Kg8, pawns f7/g7/h7, knight on b5.
  // Setup: Black Nb5-d4 (knight retreats, harmless).
  // Mate:   White Ra1-a8# (rank 8 covers f8/h8; pawns seal g7/h7/f7).
  // -----------------------------------------------------------------------
  {
    id: 'P1_BACKRANK_01',
    fen: '6k1/5ppp/8/1n6/8/8/8/R5K1 b - - 0 1',
    moves: ['b5d4', 'a1a8'],
    rating: 700,
    themes: ['mateIn1', 'backRankMate'],
    stars: 1,
  },

  // -----------------------------------------------------------------------
  // Puzzle 2: Queen diagonal Qh8#
  // White queen slides along the a1–h8 diagonal to deliver a corner mate.
  // Position: White Kg1 Qa1 | Black Ke8, pawns d7/e7/f7, rook on b5.
  // Setup: Black Rb5-b4 (rook retreats, quiet).
  // Mate:   White Qa1-h8# (queen on h8 covers entire rank 8; pawns seal d7/e7/f7).
  // -----------------------------------------------------------------------
  {
    id: 'P1_QUEEN_02',
    fen: '4k3/3ppp2/8/1r6/8/8/8/Q5K1 b - - 0 1',
    moves: ['b5b4', 'a1h8'],
    rating: 850,
    themes: ['mateIn1', 'queenMate'],
    stars: 2,
  },

  // -----------------------------------------------------------------------
  // Puzzle 3: Smothered knight mate (Nf7#)
  // Classic smothered-mate pattern: the king is surrounded by its own pieces;
  // the knight lands on f7 attacking h8, and no own piece can capture back.
  // Position: White Kg1 Ne5 | Black Kh8, rook g8, pawns e7/g7/h7, rook a8.
  //   (The e7 pawn is critical — it prevents Ra8/Ra7 from capturing Nf7 along rank 7.)
  // Setup: Black Ra8-a7 (rook steps back, quiet).
  // Mate:   White Ne5-f7# (smothered: Rg8 blocks g8; g7/h7 pawns block g7/h7;
  //                        Ra7 cannot interpose — e7 pawn blocks the a7–f7 path).
  // -----------------------------------------------------------------------
  {
    id: 'P1_KNIGHT_03',
    fen: 'r5rk/4p1pp/8/4N3/8/8/8/6K1 b - - 0 1',
    moves: ['a8a7', 'e5f7'],
    rating: 1050,
    themes: ['mateIn1', 'smotheredMate', 'knightMate'],
    stars: 2,
  },

  // -----------------------------------------------------------------------
  // Puzzle 4: Queen+King corner Qa8# (queen protected by Ra1)
  // The queen swings to the a-file corner, backed by a rook so the king can't
  // capture it.
  // Position: White Kc6 Qa5 Ra1 | Black Kb8, pawn h4.
  // Setup: Black Ph4-h3 (distant pawn push, quiet).
  // Mate:   White Qa5-a8# (queen on a8 covers b8/c8 via rank 8 and a7 via a-file;
  //                        Kc6 covers b7/c7; Ra1 defends Qa8 via a-file).
  // -----------------------------------------------------------------------
  {
    id: 'P1_QUEEN_04',
    fen: '1k6/8/2K5/Q7/7p/8/8/R7 b - - 0 1',
    moves: ['h4h3', 'a5a8'],
    rating: 900,
    themes: ['mateIn1', 'queenMate'],
    stars: 2,
  },

  // -----------------------------------------------------------------------
  // Puzzle 5: Rook Ra8# (king on g8, escape sealed by king on f6)
  // The rook sweeps to the back rank; the white king covers the g7 escape.
  // Position: White Kf6 Ra1 | Black Kg8, pawns f7/h7, knight b5.
  // Setup: Black Nb5-d4 (knight hops away, quiet).
  // Mate:   White Ra1-a8# (rank 8 covers f8/g8/h8; Kf6 covers g7; pawns seal f7/h7).
  // -----------------------------------------------------------------------
  {
    id: 'P1_ROOK_05',
    fen: '6k1/5p1p/5K2/1n6/8/8/8/R7 b - - 0 1',
    moves: ['b5d4', 'a1a8'],
    rating: 750,
    themes: ['mateIn1', 'backRankMate'],
    stars: 1,
  },
];
