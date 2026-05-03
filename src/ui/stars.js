// src/ui/stars.js
// Renders the difficulty-stars bar.

export function renderStars({ cap, onSelect }) {
  const bar = document.querySelector('#difficulty-stars');
  if (!bar) return;
  bar.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'star' + (n <= cap ? ' star-on' : ' star-off');
    btn.textContent = n <= cap ? '★' : '☆';
    btn.setAttribute('aria-label', `Set difficulty to ${n}`);
    btn.addEventListener('click', () => onSelect(n));
    return btn;
  }));
}
