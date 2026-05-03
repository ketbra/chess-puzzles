// src/ui/header.js
// Renders the stats header.

export function renderStats({ solved, streak, bestStreak, today }) {
  const el = document.querySelector('#stats-header');
  if (!el) return;
  el.textContent = `✓ ${solved}   ⚡ ${streak}   ★ ${bestStreak}   Today ${today}`;
}
