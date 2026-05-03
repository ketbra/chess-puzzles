// src/app.js
// Phase 3 entry point. Loads all themes, manages stats + filters,
// renders three UI regions, and orchestrates the puzzle queue.

import { PuzzleSession } from './puzzle.js';
import { Board } from './board.js';
import { loadPuzzles } from './loader.js';
import { Store } from './store.js';
import { Stats } from './stats.js';
import { Filters } from './filters.js';
import { flashCorrect, shakeIncorrect, setStatus } from './ui/feedback.js';
import { setProgress, hideProgress } from './ui/progress.js';
import { renderStats } from './ui/header.js';
import { renderChips } from './ui/chips.js';
import { renderStars } from './ui/stars.js';
import { bindInstall } from './ui/install.js';

const SETUP_DELAY_MS = 600;
const OPPONENT_REPLY_DELAY_MS = 400;
const POST_SOLVE_PAUSE_MS = 800;
const POST_SHOW_PAUSE_MS = 1500;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[sw] registered, scope:', reg.scope);
  } catch (err) {
    console.warn('[sw] registration failed:', err);
  }
}

let session = null;
let board = null;
let stats = null;
let filters = null;

async function main() {
  setStatus('Loading puzzles…');
  registerServiceWorker(); // fire-and-forget
  bindInstall();
  board = new Board('#board', { onUserMove: handleUserMove });
  bindActions();

  let puzzles;
  try {
    puzzles = await loadPuzzles({
      onProgress: (loaded, total) => setProgress(loaded, total),
    });
  } catch (err) {
    console.error(err);
    setStatus('Need internet on first run. Reload when online.');
    hideProgress();
    return;
  }
  hideProgress();

  const store = await new Store().open();
  stats   = await new Stats(store).load();
  filters = await new Filters(store, puzzles).load();

  renderStats(stats.snapshot());
  renderChips({ active: filters.theme, counts: filters.counts(), onSelect: handleThemeChange });
  renderStars({ cap: filters.maxStars, onSelect: handleStarChange });

  await loadNextPuzzle();
}

async function loadNextPuzzle() {
  stats.startPuzzle();
  const puzzle = filters.next();
  if (!puzzle) {
    setStatus('No puzzles match — try a higher difficulty.');
    session = null;
    return;
  }
  session = new PuzzleSession(puzzle);

  await board.setPosition(session.fen(), session.orientation());
  setStatus(`Find the best move for ${session.orientation()}.`);

  await wait(SETUP_DELAY_MS);
  const setup = session.applyOpponentSetup();
  await board.animateMove({ from: setup.from, to: setup.to });
}

async function handleUserMove({ from, to, promotion }) {
  if (!session || session.status !== 'awaiting-user') return;
  const r = session.attemptUserMove({ from, to, promotion });
  if (r.result === 'incorrect') {
    await stats.onWrongMove();
    renderStats(stats.snapshot());
    setStatus('Try again.');
    await Promise.all([
      shakeIncorrect(board.element),
      board.setPosition(session.fen()),
    ]);
    return;
  }

  await flashCorrect(board.squareElement(to));

  if (r.solved) {
    await stats.onCorrectSolve();
    renderStats(stats.snapshot());
    setStatus('Solved!');
    await wait(POST_SOLVE_PAUSE_MS);
    await loadNextPuzzle();
    return;
  }

  await wait(OPPONENT_REPLY_DELAY_MS);
  await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
  setStatus('Find the next best move.');
}

async function handleShowSolution() {
  if (!session || session.status !== 'awaiting-user') return;
  const r = session.playSolutionStep();
  setStatus('Here\'s the next move.');
  await board.animateMove({ from: r.applied.from, to: r.applied.to });

  if (r.opponentReply) {
    await wait(OPPONENT_REPLY_DELAY_MS);
    await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
  }

  if (r.solved) {
    setStatus('Solved!');
    await stats.onSkipOrShow();
    await wait(POST_SHOW_PAUSE_MS);
    await loadNextPuzzle();
  } else {
    setStatus('Find the next best move.');
  }
}

async function handleThemeChange(theme) {
  await filters.setTheme(theme);
  renderChips({ active: filters.theme, counts: filters.counts(), onSelect: handleThemeChange });
  await loadNextPuzzle();
}

async function handleStarChange(n) {
  await filters.setMaxStars(n);
  renderStars({ cap: filters.maxStars, onSelect: handleStarChange });
  renderChips({ active: filters.theme, counts: filters.counts(), onSelect: handleThemeChange });
  await loadNextPuzzle();
}

function bindActions() {
  document.querySelector('#hint').addEventListener('click', () => {
    if (session && session.status === 'awaiting-user') {
      board.highlightSquare(session.hint().square, 'hint');
    }
  });
  document.querySelector('#show').addEventListener('click', () => {
    handleShowSolution();
  });
  document.querySelector('#skip').addEventListener('click', async () => {
    if (stats) await stats.onSkipOrShow();
    await loadNextPuzzle();
  });
}

main().catch((e) => {
  console.error(e);
  setStatus('Something went wrong. Reload the page.');
});
