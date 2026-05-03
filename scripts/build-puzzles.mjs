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

// Per-theme rules. Defined once; consumed by passesFilter, verifyPuzzle, and
// the orchestration loop.
export const THEME_RULES = {
  mateIn1:      { maxRating: 1200, exactMoves: 2, requiresMate: true,  cap: 2000, floor: 500 },
  mateIn2:      { maxRating: 1400, exactMoves: 4, requiresMate: true,  cap: 2000, floor: 250 },
  fork:         { maxRating: 1300, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
  pin:          { maxRating: 1300, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
  hangingPiece: { maxRating: 1200, minMoves: 2,   requiresMate: false, cap: 2000, floor: 250 },
};

export const THEME_NAMES = Object.keys(THEME_RULES);

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

export function passesFilter(row, themeName, rules = THEME_RULES) {
  const rule = rules[themeName];
  if (!rule) return false;
  if (!row.themes.includes(themeName)) return false;
  if (row.rating > rule.maxRating) return false;
  if (rule.exactMoves != null && row.movesArr.length !== rule.exactMoves) return false;
  if (rule.minMoves != null && row.movesArr.length < rule.minMoves) return false;
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

export function verifyPuzzle(row, themeName = 'mateIn1', rules = THEME_RULES) {
  const rule = rules[themeName];
  let chess;
  try { chess = new Chess(row.fen); }
  catch (e) { return { ok: false, reason: 'bad-fen', detail: e.message }; }

  for (let i = 0; i < row.movesArr.length; i++) {
    try {
      const m = parseUci(row.movesArr[i]);
      const result = chess.move(m);
      if (!result) {
        return { ok: false, reason: i === 0 ? 'illegal-setup' : 'illegal-move',
                 detail: `at move ${i}: ${row.movesArr[i]}` };
      }
    } catch (e) {
      return { ok: false, reason: i === 0 ? 'illegal-setup' : 'illegal-move',
               detail: `at move ${i}: ${e.message}` };
    }
  }

  if (rule.requiresMate && !chess.isCheckmate()) {
    return { ok: false, reason: 'not-mate' };
  }
  return { ok: true };
}

// ───────── Orchestration ─────────

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const CACHE_DIR = join(REPO_ROOT, '.cache');
const ZST_PATH = join(CACHE_DIR, 'lichess_puzzles.csv.zst');
const CSV_PATH = join(CACHE_DIR, 'lichess_puzzles.csv');
const DATA_DIR = join(REPO_ROOT, 'data', 'puzzles');
const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

async function downloadIfNeeded({ refresh }) {
  await mkdir(CACHE_DIR, { recursive: true });
  if (!refresh && existsSync(ZST_PATH)) {
    console.log(`[cache] using existing ${ZST_PATH}`);
    return;
  }
  console.log(`[download] ${URL}`);
  // Use a streamed fetch to avoid loading hundreds of MB into memory.
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const file = createWriteStream(ZST_PATH);
  let bytes = 0;
  for await (const chunk of res.body) {
    file.write(chunk);
    bytes += chunk.byteLength;
    if (bytes % (16 * 1024 * 1024) < chunk.byteLength) {
      process.stdout.write(`  ${(bytes / 1024 / 1024).toFixed(1)} MB\r`);
    }
  }
  await new Promise((resolve, reject) => file.end((err) => err ? reject(err) : resolve()));
  console.log(`\n[download] saved ${(bytes / 1024 / 1024).toFixed(1)} MB to ${ZST_PATH}`);
}

async function decompressIfNeeded() {
  if (existsSync(CSV_PATH)) {
    const csvStat = await stat(CSV_PATH);
    const zstStat = await stat(ZST_PATH);
    if (csvStat.mtimeMs >= zstStat.mtimeMs) {
      console.log(`[zstd] using existing ${CSV_PATH}`);
      return;
    }
  }
  console.log(`[zstd] decompressing → ${CSV_PATH}`);
  await new Promise((resolve, reject) => {
    const child = spawn('zstd', ['-d', '--keep', '-f', ZST_PATH, '-o', CSV_PATH], { stdio: 'inherit' });
    child.on('error', (err) => reject(new Error(`Failed to spawn 'zstd': ${err.message} (is it installed?)`)));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`zstd exited with ${code}`)));
  });
}

async function streamFilterVerify() {
  const rejected = [];
  // One bucket per theme.
  const buckets = Object.fromEntries(THEME_NAMES.map((n) => [n, []]));
  const stats = {
    rowsScanned: 0,
    perTheme: Object.fromEntries(THEME_NAMES.map((n) => [n, {
      keptAfterFilter: 0, keptAfterVerify: 0, rejections: {},
    }])),
    globalRejections: {},
  };

  const stream = createReadStream(CSV_PATH, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    if (!line) continue;
    stats.rowsScanned++;

    let row;
    try {
      row = parseLichessRow(line);
    } catch {
      stats.globalRejections['malformed-row'] = (stats.globalRejections['malformed-row'] || 0) + 1;
      rejected.push({ id: '?', theme: '-', reason: 'malformed-row', detail: line.slice(0, 80) });
      continue;
    }

    let qualifiedForAny = false;
    for (const theme of THEME_NAMES) {
      if (!passesFilter(row, theme)) continue;
      qualifiedForAny = true;
      stats.perTheme[theme].keptAfterFilter++;
      const v = verifyPuzzle(row, theme);
      if (!v.ok) {
        bumpThemeRejection(stats, theme, v.reason);
        rejected.push({ id: row.id, theme, reason: v.reason, detail: v.detail });
        continue;
      }
      stats.perTheme[theme].keptAfterVerify++;
      buckets[theme].push(row);
    }
    if (!qualifiedForAny) {
      const reason = !THEME_NAMES.some((t) => row.themes.includes(t))
        ? 'no-target-theme'
        : 'rating-or-move-count';
      stats.globalRejections[reason] = (stats.globalRejections[reason] || 0) + 1;
    }

    if (stats.rowsScanned % 100000 === 0) {
      const totalVerified = Object.values(stats.perTheme).reduce((a, b) => a + b.keptAfterVerify, 0);
      process.stdout.write(`  scanned ${stats.rowsScanned}, verified ${totalVerified}\r`);
    }
  }
  console.log('');
  return { buckets, rejected, stats };
}

function bumpThemeRejection(stats, theme, reason) {
  stats.perTheme[theme].rejections[reason] = (stats.perTheme[theme].rejections[reason] || 0) + 1;
}

function sortAndCapAll(buckets) {
  const kept = {};
  const overCap = [];
  for (const theme of THEME_NAMES) {
    const sorted = buckets[theme].sort((a, b) => b.popularity - a.popularity);
    const rule = THEME_RULES[theme];
    kept[theme] = sorted.slice(0, rule.cap);
    for (const row of sorted.slice(rule.cap)) {
      overCap.push({ id: row.id, theme, reason: 'over-cap' });
    }
  }
  return { kept, overCap };
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function writeOutputs(kept, allRejected) {
  await mkdir(DATA_DIR, { recursive: true });

  const version = todayIso();
  const generatedAt = new Date().toISOString();

  const themeManifest = [];
  for (const theme of THEME_NAMES) {
    const themeFile = {
      version,
      theme,
      puzzles: kept[theme].map(transformPuzzle),
    };
    const themeJson = JSON.stringify(themeFile, null, 0);
    const themePath = join(DATA_DIR, `${theme}.json`);
    await writeFile(themePath, themeJson, 'utf8');
    const sha256 = sha256Hex(Buffer.from(themeJson, 'utf8'));
    themeManifest.push({
      name: theme,
      file: `${theme}.json`,
      count: kept[theme].length,
      sha256,
    });
  }

  const indexFile = {
    version,
    generatedAt,
    themes: themeManifest,
  };
  await writeFile(join(DATA_DIR, 'index.json'), JSON.stringify(indexFile, null, 2), 'utf8');

  const rejectedPath = join(DATA_DIR, 'rejected.log');
  const lines = allRejected.map((r) => `${r.id}\t${r.theme ?? '-'}\t${r.reason}\t${r.detail ?? ''}`).join('\n') + '\n';
  await writeFile(rejectedPath, lines, 'utf8');

  return themeManifest;
}

function printReport(stats, themeManifest) {
  console.log('\n────────── Build report ──────────');
  console.log(`  rows scanned:        ${stats.rowsScanned}`);
  console.log(`  global rejections:`);
  for (const [reason, count] of Object.entries(stats.globalRejections).sort((a,b) => b[1]-a[1])) {
    console.log(`    ${reason.padEnd(28)}: ${count}`);
  }
  console.log('  per-theme:');
  for (const t of themeManifest) {
    const pt = stats.perTheme[t.name];
    console.log(`    ${t.name.padEnd(15)} written ${String(t.count).padStart(5)}  sha=${t.sha256.slice(0,8)}…`);
    console.log(`      kept after filter: ${pt.keptAfterFilter}`);
    console.log(`      kept after verify: ${pt.keptAfterVerify}`);
    if (Object.keys(pt.rejections).length > 0) {
      const reasons = Object.entries(pt.rejections).sort((a,b) => b[1]-a[1])
        .map(([r,c]) => `${r}=${c}`).join(', ');
      console.log(`      rejected:          ${reasons}`);
    }
  }
  console.log('───────────────────────────────────\n');
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  await downloadIfNeeded({ refresh });
  await decompressIfNeeded();
  const { buckets, rejected, stats } = await streamFilterVerify();
  const { kept, overCap } = sortAndCapAll(buckets);
  for (const r of overCap) rejected.push(r);

  const failures = [];
  for (const theme of THEME_NAMES) {
    if (kept[theme].length < THEME_RULES[theme].floor) {
      failures.push(`${theme}: ${kept[theme].length} verified (floor ${THEME_RULES[theme].floor})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Some themes are below their floor:\n  ${failures.join('\n  ')}\n` +
      'Lichess may have changed their schema. Inspect rejected.log.',
    );
  }

  const themeManifest = await writeOutputs(kept, rejected);
  printReport(stats, themeManifest);
}

// Only run main() when invoked as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('\n[error]', err.message);
    process.exit(1);
  });
}
