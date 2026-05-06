// src/ui/stars.js
// Renders the difficulty-stars bar with tap-or-drag range selection.
//
// Interaction model:
//   - Tap a star  → range collapses to [N, N]
//   - Drag across → range = [min(anchor, current), max(anchor, current)]
// Forced contiguity: there is no way to produce a gappy selection like {1,5}.
// There is also no "tap to deselect" — every interaction commits a non-empty
// range, so the puzzle pool is never accidentally emptied via this control.

const TOTAL_STARS = 5;

export function renderStars({ range, onChange }) {
  const bar = document.querySelector('#difficulty-stars');
  if (!bar) return;

  // Build the buttons once. Subsequent state changes (drag updates, external
  // updates) toggle classes via #applyRange below — we never re-create DOM
  // mid-drag because that would lose pointer capture.
  bar.replaceChildren(...Array.from({ length: TOTAL_STARS }, (_, i) => {
    const n = i + 1;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'star';
    btn.dataset.n = String(n);
    btn.setAttribute('aria-label', `Difficulty ${n}`);
    return btn;
  }));

  // touch-action: none lets us own the pointer drag without iOS treating
  // the gesture as a horizontal scroll/swipe.
  bar.style.touchAction = 'none';

  applyRange(bar, range);

  // Drag state lives on the bar itself across the down/move/up sequence.
  let anchor = null;
  let liveRange = null;

  bar.addEventListener('pointerdown', (event) => {
    const star = starFromEvent(event);
    if (!star) return;
    event.preventDefault();
    anchor = star;
    liveRange = { min: anchor, max: anchor };
    applyRange(bar, liveRange);
    onChange(liveRange);
    // Capture so we keep getting move/up even if the pointer leaves the bar.
    bar.setPointerCapture(event.pointerId);
  });

  bar.addEventListener('pointermove', (event) => {
    if (anchor === null) return;
    const star = starFromPoint(event.clientX, event.clientY);
    if (!star) return;
    const next = { min: Math.min(anchor, star), max: Math.max(anchor, star) };
    if (next.min === liveRange.min && next.max === liveRange.max) return;
    liveRange = next;
    applyRange(bar, liveRange);
    onChange(liveRange);
  });

  const endDrag = (event) => {
    if (anchor === null) return;
    anchor = null;
    liveRange = null;
    if (bar.hasPointerCapture(event.pointerId)) {
      bar.releasePointerCapture(event.pointerId);
    }
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
}

function starFromEvent(event) {
  return readStar(event.target);
}

function starFromPoint(x, y) {
  return readStar(document.elementFromPoint(x, y));
}

function readStar(el) {
  if (!el || !el.classList || !el.classList.contains('star')) return null;
  const n = Number(el.dataset.n);
  return Number.isFinite(n) ? n : null;
}

function applyRange(bar, { min, max }) {
  for (const btn of bar.querySelectorAll('.star')) {
    const n = Number(btn.dataset.n);
    const on = n >= min && n <= max;
    btn.classList.toggle('star-on',  on);
    btn.classList.toggle('star-off', !on);
    btn.textContent = on ? '★' : '☆';
  }
}
