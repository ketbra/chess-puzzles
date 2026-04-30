// src/app.js
// Phase 1 entry point. Owns the puzzle queue, current PuzzleSession,
// timing, and Hint/Skip wiring.

import { PuzzleSession } from './puzzle.js';
import { Board } from './board.js';
import { phase1Puzzles } from './puzzles-phase1.js';
import { flashCorrect, shakeIncorrect, setStatus } from './ui/feedback.js';

const SETUP_DELAY_MS = 600;
const OPPONENT_REPLY_DELAY_MS = 400;
const POST_SOLVE_PAUSE_MS = 800;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let queueIndex = 0;
let session = null;
let board = null;

async function loadNextPuzzle() {
  const puzzle = phase1Puzzles[queueIndex % phase1Puzzles.length];
  queueIndex += 1;
  session = new PuzzleSession(puzzle);

  await board.setPosition(session.fen(), session.orientation());
  setStatus(`Find the best move for ${session.orientation()}.`);

  await wait(SETUP_DELAY_MS);

  const setup = session.applyOpponentSetup();
  await board.animateMove({ from: setup.from, to: setup.to });
}

async function handleUserMove({ from, to, promotion }) {
  if (!session || session.status !== 'awaiting-user') {
    return; // ignore input during pauses / animations
  }
  const r = session.attemptUserMove({ from, to, promotion });
  if (r.result === 'incorrect') {
    setStatus('Try again.');
    await Promise.all([
      shakeIncorrect(board.element),
      board.setPosition(session.fen()), // visually revert
    ]);
    return;
  }

  // Correct.
  await flashCorrect(board.squareElement(to));

  if (r.solved) {
    setStatus('Solved!');
    await wait(POST_SOLVE_PAUSE_MS);
    await loadNextPuzzle();
    return;
  }

  // Multi-move continuation.
  await wait(OPPONENT_REPLY_DELAY_MS);
  await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
  setStatus('Find the next best move.');
}

function bindActions() {
  document.querySelector('#hint').addEventListener('click', () => {
    if (session && session.status === 'awaiting-user') {
      board.highlightSquare(session.hint().square, 'hint');
    }
  });
  document.querySelector('#skip').addEventListener('click', () => {
    loadNextPuzzle();
  });
}

async function main() {
  board = new Board('#board', { onUserMove: handleUserMove });
  bindActions();
  await loadNextPuzzle();
}

main().catch((e) => {
  console.error(e);
  setStatus('Something went wrong. Reload the page.');
});
