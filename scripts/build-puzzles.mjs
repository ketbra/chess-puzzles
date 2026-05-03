// scripts/build-puzzles.mjs
//
// Build pipeline: downloads the Lichess puzzle database, filters to mate-in-1
// puzzles with rating ≤ 1200, verifies each via chess.js, sorts by Popularity,
// caps at 2000, and emits data/puzzles/{mateIn1.json, index.json, rejected.log}.
//
// Run via: npm run build-puzzles  [-- --refresh]
//   --refresh forces re-download of the source CSV.

import { Chess } from 'chess.js';
import { parseUci } from '../src/uci.js';

// ───────── Pure helpers (exported for tests) ─────────

export function parseLichessRow(line) {
  // Lichess CSV columns:
  //   0 PuzzleId
  //   1 FEN
  //   2 Moves        (space-separated UCI)
  //   3 Rating       (integer)
  //   4 RatingDeviation
  //   5 Popularity   (integer; can be negative)
  //   6 NbPlays
  //   7 Themes       (space-separated tags)
  //   8 GameUrl
  //   9 OpeningTags
  const cols = line.split(',');
  if (cols.length < 8) {
    throw new Error(`Malformed CSV row (${cols.length} cols): ${line.slice(0, 80)}`);
  }
  return {
    id: cols[0],
    fen: cols[1],
    movesArr: cols[2].split(' ').filter(Boolean),
    rating: Number(cols[3]),
    ratingDeviation: Number(cols[4]),
    popularity: Number(cols[5]),
    nbPlays: Number(cols[6]),
    themes: cols[7].split(' ').filter(Boolean),
    gameUrl: cols[8] ?? '',
    openingTags: (cols[9] ?? '').split(' ').filter(Boolean),
  };
}

export function passesFilter(row) {
  if (!row.themes.includes('mateIn1')) return false;
  if (row.rating > 1200) return false;
  if (row.movesArr.length !== 2) return false;
  return true;
}

export function ratingToStars(rating) {
  if (rating < 800) return 1;
  if (rating < 1100) return 2;
  if (rating < 1400) return 3;
  if (rating < 1700) return 4;
  return 5;
}

export function transformPuzzle(row) {
  return {
    id: row.id,
    fen: row.fen,
    moves: row.movesArr,
    rating: row.rating,
    themes: row.themes,
    stars: ratingToStars(row.rating),
  };
}

export function verifyPuzzle(row) {
  let chess;
  try {
    chess = new Chess(row.fen);
  } catch (e) {
    return { ok: false, reason: 'bad-fen', detail: e.message };
  }

  // Apply moves[0] (opponent setup).
  try {
    const m = parseUci(row.movesArr[0]);
    const result = chess.move(m);
    if (!result) return { ok: false, reason: 'illegal-setup' };
  } catch (e) {
    return { ok: false, reason: 'illegal-setup', detail: e.message };
  }

  // Apply moves[1] (user mate).
  try {
    const m = parseUci(row.movesArr[1]);
    const result = chess.move(m);
    if (!result) return { ok: false, reason: 'illegal-user-move' };
  } catch (e) {
    return { ok: false, reason: 'illegal-user-move', detail: e.message };
  }

  if (!chess.isCheckmate()) {
    return { ok: false, reason: 'not-mate' };
  }
  return { ok: true };
}
