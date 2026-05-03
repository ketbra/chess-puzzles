import { describe, it, expect } from 'vitest';
import {
  parseLichessRow,
  passesFilter,
  ratingToStars,
  transformPuzzle,
  verifyPuzzle,
  THEME_RULES,
} from '../scripts/build-puzzles.mjs';

// Real Lichess CSV row format (from the published database):
//   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
// Themes are space-separated.
const REAL_ROW = '00sHx,q3kbnr/1pp2ppp/p1p5/4Pb2/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 1 7,e8e7 b1c3,854,80,93,3719,advantage middlegame short,https://lichess.org/a1b2c3#13,';
// A back-rank mate-in-1 we control (uses the Phase 1 fixture position).
const SYNTHETIC_M1 = {
  id: 'TEST_M1',
  fen: '6k1/5ppp/2n5/8/8/8/8/R5K1 b - - 0 1',
  movesArr: ['c6e5', 'a1a8'],
  rating: 800,
  popularity: 99,
  themes: ['mateIn1', 'backRankMate'],
};

describe('parseLichessRow', () => {
  it('parses all 10 columns', () => {
    const r = parseLichessRow(REAL_ROW);
    expect(r.id).toBe('00sHx');
    expect(r.fen).toBe('q3kbnr/1pp2ppp/p1p5/4Pb2/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 1 7');
    expect(r.movesArr).toEqual(['e8e7', 'b1c3']);
    expect(r.rating).toBe(854);
    expect(r.popularity).toBe(93);
    expect(r.themes).toEqual(['advantage', 'middlegame', 'short']);
  });

  it('handles empty trailing fields', () => {
    const line = '99zzz,8/8/8/8/8/8/8/8 w - - 0 1,a1a2,500,50,10,5,mateIn1,,';
    const r = parseLichessRow(line);
    expect(r.id).toBe('99zzz');
    expect(r.themes).toEqual(['mateIn1']);
  });
});

describe('passesFilter', () => {
  it('accepts a mateIn1 with 2 moves and rating ≤ 1200', () => {
    const r = {
      themes: ['mateIn1', 'short'], rating: 900, movesArr: ['e2e4', 'e7e5']
    };
    expect(passesFilter(r, 'mateIn1')).toBe(true);
  });

  it('rejects rating > 1200', () => {
    const r = { themes: ['mateIn1'], rating: 1201, movesArr: ['a','b'] };
    expect(passesFilter(r, 'mateIn1')).toBe(false);
  });

  it('rejects when not mateIn1', () => {
    const r = { themes: ['fork', 'short'], rating: 900, movesArr: ['a','b'] };
    expect(passesFilter(r, 'mateIn1')).toBe(false);
  });

  it('rejects when move count is not exactly 2', () => {
    const r1 = { themes: ['mateIn1'], rating: 800, movesArr: ['a'] };
    const r3 = { themes: ['mateIn1'], rating: 800, movesArr: ['a','b','c'] };
    expect(passesFilter(r1, 'mateIn1')).toBe(false);
    expect(passesFilter(r3, 'mateIn1')).toBe(false);
  });
});

describe('ratingToStars', () => {
  it('maps boundary values per the spec', () => {
    expect(ratingToStars(700)).toBe(1);
    expect(ratingToStars(799)).toBe(1);
    expect(ratingToStars(800)).toBe(2);
    expect(ratingToStars(1099)).toBe(2);
    expect(ratingToStars(1100)).toBe(3);
    expect(ratingToStars(1399)).toBe(3);
    expect(ratingToStars(1400)).toBe(4);
    expect(ratingToStars(1699)).toBe(4);
    expect(ratingToStars(1700)).toBe(5);
    expect(ratingToStars(2000)).toBe(5);
  });
});

describe('transformPuzzle', () => {
  it('produces the runtime schema', () => {
    const row = {
      id: 'X1', fen: 'fen-here', movesArr: ['e2e4', 'e7e5'],
      rating: 850, themes: ['mateIn1', 'short'], popularity: 50
    };
    expect(transformPuzzle(row)).toEqual({
      id: 'X1', fen: 'fen-here', moves: ['e2e4', 'e7e5'],
      rating: 850, themes: ['mateIn1', 'short'], stars: 2,
    });
  });
});

describe('verifyPuzzle', () => {
  it('accepts a valid mate-in-1', () => {
    const r = verifyPuzzle(SYNTHETIC_M1);
    expect(r.ok).toBe(true);
  });

  it('rejects a broken FEN', () => {
    const r = verifyPuzzle({ ...SYNTHETIC_M1, fen: 'not-a-fen' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-fen');
  });

  it('rejects when the opponent setup move is illegal', () => {
    const r = verifyPuzzle({ ...SYNTHETIC_M1, movesArr: ['e2e4', 'a1a8'] }); // e2e4 not legal in this fen
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('illegal-setup');
  });

  it('rejects when the user move is illegal', () => {
    const r = verifyPuzzle({ ...SYNTHETIC_M1, movesArr: ['c6e5', 'h2h4'] }); // h2h4 not legal (no pawn there)
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('illegal-move');
  });

  it('rejects when the user move does not deliver mate', () => {
    // Same fixture but replace mate move with a non-mate move (Kg2).
    const r = verifyPuzzle({ ...SYNTHETIC_M1, movesArr: ['c6e5', 'g1g2'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-mate');
  });
});

const TACTICAL_OK = {
  id: 'T1',
  fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
  movesArr: ['e2e4', 'e8d8'], // both legal: pawn double-push, then king move
  rating: 1100,
  themes: ['fork'],
  popularity: 50,
};

const MATE2_FIXTURE = {
  // Two-rook ladder mate from Phase 1's matein2Fixture.
  id: 'M2',
  fen: '6k1/8/5K2/8/8/8/R7/R7 b - - 0 1',
  movesArr: ['g8h8', 'a2a8', 'h8h7', 'a1h1'],
  rating: 1200,
  themes: ['mateIn2'],
  popularity: 50,
};

describe('passesFilter (mateIn2)', () => {
  it('accepts rating ≤ 1400 with exactly 4 moves', () => {
    expect(passesFilter(MATE2_FIXTURE, 'mateIn2')).toBe(true);
  });

  it('rejects rating > 1400', () => {
    expect(passesFilter({ ...MATE2_FIXTURE, rating: 1401 }, 'mateIn2')).toBe(false);
  });

  it('rejects move count != 4', () => {
    expect(passesFilter({ ...MATE2_FIXTURE, movesArr: ['a','b','c'] }, 'mateIn2')).toBe(false);
    expect(passesFilter({ ...MATE2_FIXTURE, movesArr: ['a','b','c','d','e'] }, 'mateIn2')).toBe(false);
  });
});

describe('passesFilter (fork)', () => {
  it('accepts rating ≤ 1300 with ≥ 2 moves', () => {
    expect(passesFilter(TACTICAL_OK, 'fork')).toBe(true);
    expect(passesFilter({ ...TACTICAL_OK, movesArr: ['a','b','c','d'] }, 'fork')).toBe(true);
  });

  it('rejects rating > 1300', () => {
    expect(passesFilter({ ...TACTICAL_OK, rating: 1301 }, 'fork')).toBe(false);
  });

  it('rejects move count < 2', () => {
    expect(passesFilter({ ...TACTICAL_OK, movesArr: ['a'] }, 'fork')).toBe(false);
  });

  it('rejects when not tagged with fork', () => {
    expect(passesFilter({ ...TACTICAL_OK, themes: ['pin'] }, 'fork')).toBe(false);
  });
});

describe('verifyPuzzle (mateIn2)', () => {
  it('accepts a hand-built mate-in-2', () => {
    expect(verifyPuzzle(MATE2_FIXTURE, 'mateIn2').ok).toBe(true);
  });

  it('rejects when last move does not mate', () => {
    const v = verifyPuzzle({ ...MATE2_FIXTURE, movesArr: ['g8h8','a2a8','h8h7','f6f5'] }, 'mateIn2');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('not-mate');
  });
});

describe('verifyPuzzle (tactical)', () => {
  it('accepts any all-legal sequence for fork (no mate check)', () => {
    expect(verifyPuzzle(TACTICAL_OK, 'fork').ok).toBe(true);
  });

  it('rejects illegal move in tactical sequence', () => {
    const v = verifyPuzzle({ ...TACTICAL_OK, movesArr: ['e2e5', 'e8d8'] }, 'fork'); // e2-e5 illegal (3 squares)
    expect(v.ok).toBe(false);
    expect(['illegal-setup', 'illegal-move']).toContain(v.reason);
  });
});

describe('THEME_RULES', () => {
  it('exposes all 5 themes with rating caps', () => {
    expect(Object.keys(THEME_RULES).sort()).toEqual(['fork','hangingPiece','mateIn1','mateIn2','pin']);
    expect(THEME_RULES.mateIn1.maxRating).toBe(1200);
    expect(THEME_RULES.mateIn2.maxRating).toBe(1400);
    expect(THEME_RULES.fork.maxRating).toBe(1300);
    expect(THEME_RULES.pin.maxRating).toBe(1300);
    expect(THEME_RULES.hangingPiece.maxRating).toBe(1200);
  });

  it('mate themes require mate; tactical themes do not', () => {
    expect(THEME_RULES.mateIn1.requiresMate).toBe(true);
    expect(THEME_RULES.mateIn2.requiresMate).toBe(true);
    expect(THEME_RULES.fork.requiresMate).toBe(false);
    expect(THEME_RULES.pin.requiresMate).toBe(false);
    expect(THEME_RULES.hangingPiece.requiresMate).toBe(false);
  });
});
