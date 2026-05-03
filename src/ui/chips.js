// src/ui/chips.js
// Renders the theme-chip bar.

const THEMES = [
  { id: 'all',          label: 'All' },
  { id: 'mateIn1',      label: 'Mate 1' },
  { id: 'mateIn2',      label: 'Mate 2' },
  { id: 'fork',         label: 'Fork' },
  { id: 'pin',          label: 'Pin' },
  { id: 'hangingPiece', label: 'Hanging' },
];

export function renderChips({ active, counts, onSelect }) {
  const bar = document.querySelector('#theme-chips');
  if (!bar) return;
  bar.replaceChildren(...THEMES.map((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (t.id === active ? ' chip-active' : '');
    btn.textContent = `${t.label} ${counts[t.id] ?? 0}`;
    btn.addEventListener('click', () => onSelect(t.id));
    return btn;
  }));
}
