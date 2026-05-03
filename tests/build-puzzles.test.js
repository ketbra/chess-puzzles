import { describe, it, expect } from 'vitest';
import {
  parseLichessRow,
  passesFilter,
  ratingToStars,
  transformPuzzle,
  verifyPuzzle,
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
    expect(passesFilter(r)).toBe(true);
  });

  it('rejects rating > 1200', () => {
    const r = { themes: ['mateIn1'], rating: 1201, movesArr: ['a','b'] };
    expect(passesFilter(r)).toBe(false);
  });

  it('rejects when not mateIn1', () => {
    const r = { themes: ['fork', 'short'], rating: 900, movesArr: ['a','b'] };
    expect(passesFilter(r)).toBe(false);
  });

  it('rejects when move count is not exactly 2', () => {
    const r1 = { themes: ['mateIn1'], rating: 800, movesArr: ['a'] };
    const r3 = { themes: ['mateIn1'], rating: 800, movesArr: ['a','b','c'] };
    expect(passesFilter(r1)).toBe(false);
    expect(passesFilter(r3)).toBe(false);
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
    expect(r.reason).toBe('illegal-user-move');
  });

  it('rejects when the user move does not deliver mate', () => {
    // Same fixture but replace mate move with a non-mate move (Kg2).
    const r = verifyPuzzle({ ...SYNTHETIC_M1, movesArr: ['c6e5', 'g1g2'] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-mate');
  });
});
