# Phase 5 Implementation Plan: Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase 5 per `docs/superpowers/specs/2026-05-03-phase5-polish-design.md` — settings module + slide-up sheet, hand-rolled canvas confetti, Web Audio synthesized sound effects, and `prefers-reduced-motion` accessibility, all wired into the existing app.

**Architecture:** A new `Settings` module mirrors the `Stats`/`Filters` pattern (state + IDB sync + apply-to-DOM). A small UI module binds the settings sheet's controls. Confetti is a single canvas with a hand-rolled particle system; sounds use the Web Audio API directly with no bundled files. Theme + coordinate visibility flip via body classes (no board reconstruction). Reduced-motion is honored both in CSS and via a JS check.

**Tech Stack:** Same as Phase 4 — vanilla JS ES modules, Vitest, no bundler. No new dependencies.

---

## Background and conventions

- **Settings persistence keys** (added to IDB `meta`): `soundOn`, `theme`, `showCoords`. Existing keys unchanged.
- **Sound triggers** (gated on `settings.soundOn`): `playMove` on multi-move in-progress correct moves; `playSuccess` on final solve; `playFail` on incorrect. Skip and Show stay silent.
- **Confetti trigger**: only on final solve (`r.solved === true`). Skipped if `prefers-reduced-motion`.
- **Theme + coords toggle**: pure CSS. JS only mutates `body.classList`. No cm-chessboard reconstruction.
- **Install button repositions**: top-right gear claims that corner; install button moves to top-left.
- **`Stats.reset()`** is added to centralize the reset-stats logic; the settings sheet calls it.

---

## Task 1: Settings module + Stats.reset() (TDD)

**Files:**
- Create: `src/settings.js`
- Create: `tests/settings.test.js`
- Modify: `src/stats.js` (add `reset()` method)
- Modify: `tests/stats.test.js` (add `reset()` test)

- [ ] **Step 1: Write the failing tests**

Create `tests/settings.test.js`:

```js
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Settings } from '../src/settings.js';
import { Store } from '../src/store.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Settings', () => {
  it('initializes with defaults on a fresh DB', async () => {
    const store = await new Store().open();
    const s = await new Settings(store).load();
    expect(s.snapshot()).toEqual({ soundOn: false, theme: 'warm', showCoords: false });
    await store.close();
  });

  it('round-trips soundOn through Store', async () => {
    const store = await new Store().open();
    const s = await new Settings(store).load();
    await s.setSound(true);
    expect(s.snapshot().soundOn).toBe(true);
    expect(await store.getMeta('soundOn')).toBe(true);
    await store.close();
  });

  it('round-trips theme', async () => {
    const store = await new Store().open();
    const s = await new Settings(store).load();
    await s.setTheme('cool');
    expect(s.snapshot().theme).toBe('cool');
    expect(await store.getMeta('theme')).toBe('cool');
    await store.close();
  });

  it('round-trips showCoords', async () => {
    const store = await new Store().open();
    const s = await new Settings(store).load();
    await s.setShowCoords(true);
    expect(s.snapshot().showCoords).toBe(true);
    expect(await store.getMeta('showCoords')).toBe(true);
    await store.close();
  });

  it('persists across Settings instances', async () => {
    const store = await new Store().open();
    const s1 = await new Settings(store).load();
    await s1.setSound(true);
    await s1.setTheme('cool');
    await s1.setShowCoords(true);
    await store.close();

    const store2 = await new Store().open();
    const s2 = await new Settings(store2).load();
    expect(s2.snapshot()).toEqual({ soundOn: true, theme: 'cool', showCoords: true });
    await store2.close();
  });

  it('apply() toggles body.theme-cool and body.show-coords', async () => {
    const toggle = vi.fn();
    vi.stubGlobal('document', { body: { classList: { toggle } } });

    const store = await new Store().open();
    const s = await new Settings(store).load();
    await s.setTheme('cool');
    await s.setShowCoords(true);
    s.apply();

    expect(toggle).toHaveBeenCalledWith('theme-cool', true);
    expect(toggle).toHaveBeenCalledWith('show-coords', true);
    await store.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/settings.test.js`
Expected: FAIL — `../src/settings.js` not found.

- [ ] **Step 3: Implement `src/settings.js`**

```js
// src/settings.js
// Settings state + IDB persistence. Mirrors the Stats/Filters pattern.

export class Settings {
  constructor(store) {
    this.store = store;
    this.soundOn = false;
    this.theme = 'warm';
    this.showCoords = false;
  }

  async load() {
    this.soundOn    = (await this.store.getMeta('soundOn'))    ?? false;
    this.theme      = (await this.store.getMeta('theme'))      ?? 'warm';
    this.showCoords = (await this.store.getMeta('showCoords')) ?? false;
    return this;
  }

  async setSound(on) {
    this.soundOn = !!on;
    await this.store.setMeta('soundOn', this.soundOn);
  }

  async setTheme(t) {
    this.theme = t;
    await this.store.setMeta('theme', this.theme);
  }

  async setShowCoords(on) {
    this.showCoords = !!on;
    await this.store.setMeta('showCoords', this.showCoords);
  }

  apply() {
    document.body.classList.toggle('theme-cool', this.theme === 'cool');
    document.body.classList.toggle('show-coords', !!this.showCoords);
  }

  snapshot() {
    return { soundOn: this.soundOn, theme: this.theme, showCoords: this.showCoords };
  }
}
```

- [ ] **Step 4: Run, expect Settings tests to pass**

Run: `npm test -- tests/settings.test.js`
Expected: 6 tests pass.

- [ ] **Step 5: Add `Stats.reset()` to `src/stats.js`**

Inside `class Stats`, after the existing methods, add:

```js
  async reset() {
    this.solved = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.todayCount = 0;
    this.todayDate = todayKey();
    this.puzzleHadError = false;
    await this.persist();
  }
```

`todayKey` is the private function already at the bottom of `src/stats.js` — it's in scope.

- [ ] **Step 6: Add the `reset()` test in `tests/stats.test.js`**

Append to the existing `describe('Stats', ...)` block:

```js
  it('reset() zeros all stats and clears the puzzle error flag', async () => {
    const { stats } = await freshStatsStore();
    // Build up some state.
    for (let i = 0; i < 3; i++) {
      stats.startPuzzle();
      await stats.onCorrectSolve();
    }
    stats.startPuzzle();
    await stats.onWrongMove();
    expect(stats.snapshot().solved).toBe(3);
    expect(stats.snapshot().bestStreak).toBe(3);
    expect(stats.puzzleHadError).toBe(true);

    await stats.reset();

    expect(stats.snapshot()).toMatchObject({ solved: 0, streak: 0, bestStreak: 0, today: 0 });
    expect(stats.puzzleHadError).toBe(false);
  });
```

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: 107 tests pass (100 prior + 6 settings + 1 stats reset).

- [ ] **Step 8: Commit**

```bash
git add src/settings.js tests/settings.test.js src/stats.js tests/stats.test.js
git commit -m "Add Settings module + Stats.reset() with TDD"
```

---

## Task 2: Settings sheet UI + theme/coords CSS hooks + install button reposition

**Files:**
- Create: `src/ui/settings.js`
- Modify: `index.html` (gear button, sheet markup, scrim, confetti canvas)
- Modify: `src/ui/styles.css` (gear, sheet, toggle, segmented, theme-cool, show-coords, install button reposition)
- Modify: `src/board.js` (`showCoordinates: true`)

This task is UI-only; no unit tests (manual verification in Task 7).

- [ ] **Step 1: Update `src/board.js` to always render coordinates**

Find the `style:` block in the `Chessboard` constructor:

```js
style: {
  cssClass: 'default',
  showCoordinates: false,
  pieces: { type: 'svgSprite', file: 'pieces/staunty.svg' },
},
```

Change `showCoordinates: false` to `showCoordinates: true`. CSS controls visibility from now on.

- [ ] **Step 2: Add markup to `index.html`**

Inside `<body>`, after the `<button id="install-btn" ...>` line, add:

```html
    <button id="gear-btn" type="button" class="gear-btn" aria-label="Settings">⚙</button>
    <canvas id="confetti-canvas" class="confetti-canvas" aria-hidden="true"></canvas>
    <div id="settings-scrim" class="settings-scrim" aria-hidden="true"></div>
    <div id="settings-sheet" class="settings-sheet" role="dialog" aria-label="Settings">
      <div class="settings-sheet-header">
        <h2>Settings</h2>
        <button id="settings-close" type="button" class="settings-close" aria-label="Close">×</button>
      </div>
      <div class="setting-row">
        <span>Sound</span>
        <label class="toggle">
          <input id="setting-sound" type="checkbox">
          <span class="slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <span>Theme</span>
        <div class="segmented">
          <button id="setting-theme-warm" type="button">Warm</button>
          <button id="setting-theme-cool" type="button">Cool</button>
        </div>
      </div>
      <div class="setting-row">
        <span>Coordinates</span>
        <label class="toggle">
          <input id="setting-coords" type="checkbox">
          <span class="slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <button id="setting-reset-stats" type="button" class="reset-btn">Reset stats</button>
      </div>
    </div>
```

- [ ] **Step 3: Update `src/ui/styles.css` — install button moves to top-left**

Find the existing `.install-btn` rule. The line `right: 12px;` becomes `left: 12px;`:

```css
.install-btn {
  position: fixed;
  top: 12px;
  left: 12px;            /* was: right: 12px; */
  z-index: 100;
  /* ...rest unchanged */
}
```

- [ ] **Step 4: Append all new styles to `src/ui/styles.css`**

```css
/* Gear icon — top-right; opens settings sheet. */
.gear-btn {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 100;
  width: 40px;
  height: 40px;
  font-size: 22px;
  border-radius: 50%;
  border: 2px solid #5a3a22;
  background: #2a201a;
  color: #efe6dc;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.gear-btn:hover {
  background: #3a2a1f;
}

/* Scrim behind the sheet. */
.settings-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
  z-index: 200;
}

.settings-scrim.visible {
  opacity: 1;
  pointer-events: auto;
}

/* Bottom sheet. */
.settings-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 201;
  max-width: 480px;
  margin: 0 auto;
  padding: 16px;
  background: #2a201a;
  color: #efe6dc;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  border: 2px solid #5a3a22;
  border-bottom: none;
  transform: translateY(100%);
  transition: transform 250ms ease;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.6);
}

.settings-sheet.open {
  transform: translateY(0);
}

.settings-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.settings-sheet-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.settings-close {
  background: transparent;
  border: none;
  color: #efe6dc;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  padding: 0 8px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 4px;
  border-top: 1px solid #4a3525;
}

.setting-row:first-child {
  border-top: none;
}

.setting-row > span {
  font-size: 16px;
}

/* Toggle (pill-slider) styled checkbox. */
.toggle {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 28px;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle .slider {
  position: absolute;
  inset: 0;
  background: #4a3525;
  border-radius: 999px;
  transition: background 150ms ease;
}

.toggle .slider::before {
  content: "";
  position: absolute;
  width: 22px;
  height: 22px;
  left: 3px;
  top: 3px;
  background: #efe6dc;
  border-radius: 50%;
  transition: transform 150ms ease;
}

.toggle input:checked + .slider {
  background: #f0d9b5;
}

.toggle input:checked + .slider::before {
  transform: translateX(20px);
  background: #2a201a;
}

/* Segmented (Warm | Cool). */
.segmented {
  display: flex;
  border-radius: 999px;
  border: 2px solid #5a3a22;
  overflow: hidden;
}

.segmented button {
  background: #2a201a;
  color: #efe6dc;
  border: none;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
}

.segmented button.active {
  background: #f0d9b5;
  color: #2a201a;
}

/* Reset stats button. */
.reset-btn {
  width: 100%;
  min-height: 44px;
  padding: 10px 16px;
  font-size: 16px;
  border-radius: 8px;
  border: 2px solid #5a3a22;
  background: #2a201a;
  color: #efe6dc;
  cursor: pointer;
  font-weight: 600;
}

.reset-btn.confirming {
  border-color: #a85a3c;
  background: #5a2a1f;
  color: #f0d9b5;
}

/* Cool theme overrides for board squares. */
body.theme-cool .board-stage .cm-chessboard.default .board .square.white { fill: #dee3e6; }
body.theme-cool .board-stage .cm-chessboard.default .board .square.black { fill: #5d7a92; }

/* Coordinates visibility — controlled by body.show-coords class. */
body:not(.show-coords) .cm-chessboard .coordinates { display: none; }

/* Confetti canvas (Phase 5 — full-screen overlay; particles drawn by JS). */
.confetti-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 99;
}
```

- [ ] **Step 5: Create `src/ui/settings.js`**

```js
// src/ui/settings.js
// Binds the gear icon, settings sheet, scrim, and the four controls
// (sound toggle, theme segmented, coords toggle, reset stats button).

export function bindSettings({ settings, onResetStats }) {
  const gear = document.querySelector('#gear-btn');
  const sheet = document.querySelector('#settings-sheet');
  const scrim = document.querySelector('#settings-scrim');
  const closeBtn = document.querySelector('#settings-close');
  const soundToggle = document.querySelector('#setting-sound');
  const themeWarm = document.querySelector('#setting-theme-warm');
  const themeCool = document.querySelector('#setting-theme-cool');
  const coordsToggle = document.querySelector('#setting-coords');
  const resetBtn = document.querySelector('#setting-reset-stats');

  syncControls(settings);

  gear.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);

  soundToggle.addEventListener('change', async () => {
    await settings.setSound(soundToggle.checked);
  });
  themeWarm.addEventListener('click', async () => {
    await settings.setTheme('warm');
    settings.apply();
    syncControls(settings);
  });
  themeCool.addEventListener('click', async () => {
    await settings.setTheme('cool');
    settings.apply();
    syncControls(settings);
  });
  coordsToggle.addEventListener('change', async () => {
    await settings.setShowCoords(coordsToggle.checked);
    settings.apply();
  });

  // Reset stats: in-place two-stage confirm with 3s disarm timeout.
  let resetArmed = false;
  let disarmTimer = null;
  resetBtn.addEventListener('click', async () => {
    if (!resetArmed) {
      resetBtn.textContent = 'Confirm reset';
      resetBtn.classList.add('confirming');
      resetArmed = true;
      clearTimeout(disarmTimer);
      disarmTimer = setTimeout(() => {
        resetArmed = false;
        resetBtn.textContent = 'Reset stats';
        resetBtn.classList.remove('confirming');
      }, 3000);
      return;
    }
    clearTimeout(disarmTimer);
    await onResetStats();
    resetArmed = false;
    resetBtn.textContent = 'Reset stats';
    resetBtn.classList.remove('confirming');
  });

  function syncControls(s) {
    soundToggle.checked = s.soundOn;
    coordsToggle.checked = s.showCoords;
    themeWarm.classList.toggle('active', s.theme === 'warm');
    themeCool.classList.toggle('active', s.theme === 'cool');
  }

  function open() { sheet.classList.add('open'); scrim.classList.add('visible'); }
  function close() { sheet.classList.remove('open'); scrim.classList.remove('visible'); }
}
```

- [ ] **Step 6: Smoke-check the new module imports**

Run: `node --input-type=module -e "import('./src/ui/settings.js').then(m => console.log(Object.keys(m)))"`
Expected: prints `[ 'bindSettings' ]`.

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: 107 tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/ui/settings.js index.html src/ui/styles.css src/board.js
git commit -m "Add settings sheet UI: gear, sheet, controls, theme/coords CSS hooks"
```

---

## Task 3: Confetti (TDD pure-logic + canvas overlay)

**Files:**
- Create: `src/ui/confetti.js`
- Create: `tests/confetti.test.js`

The canvas markup and CSS were added in Task 2.

- [ ] **Step 1: Write the failing tests**

```js
// tests/confetti.test.js
import { describe, it, expect } from 'vitest';
import { updateParticle } from '../src/ui/confetti.js';

function makeParticle(overrides = {}) {
  return {
    x: 100, y: 100,
    vx: 5, vy: -3,
    rot: 0, vrot: 0.1,
    size: 8,
    color: '#fff',
    life: 1,
    ...overrides,
  };
}

describe('updateParticle', () => {
  it('advances position by velocity', () => {
    const p = makeParticle();
    updateParticle(p, 1);
    expect(p.x).toBe(105);
    expect(p.y).toBe(97); // 100 + (-3)
  });

  it('applies gravity to vy', () => {
    const p = makeParticle({ vy: 0 });
    updateParticle(p, 1);
    expect(p.vy).toBeGreaterThan(0); // gravity pulls down
  });

  it('decreases life over time', () => {
    const p = makeParticle({ life: 1 });
    updateParticle(p, 1);
    expect(p.life).toBeLessThan(1);
  });

  it('advances rotation by vrot', () => {
    const p = makeParticle({ rot: 0, vrot: 0.5 });
    updateParticle(p, 1);
    expect(p.rot).toBe(0.5);
  });

  it('repeated updates eventually drop life to ≤ 0', () => {
    const p = makeParticle({ life: 1 });
    for (let i = 0; i < 100; i++) updateParticle(p, 1);
    expect(p.life).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/confetti.test.js`
Expected: FAIL — `../src/ui/confetti.js` not found.

- [ ] **Step 3: Implement `src/ui/confetti.js`**

```js
// src/ui/confetti.js
// Hand-rolled canvas confetti. Single full-screen overlay; particles drawn
// per RAF frame with gravity + opacity decay.

const PALETTE_WARM = ['#f0d9b5', '#7a4a2b', '#5a3a22', '#efe6dc', '#b88550'];
const PALETTE_COOL = ['#dee3e6', '#5d7a92', '#3a4d5e', '#efe6dc', '#a8b8c4'];

let canvas = null;
let ctx = null;
let particles = [];
let rafId = null;

export function fireConfetti({ theme = 'warm', count = 50 } = {}) {
  ensureCanvas();
  if (!ctx) return;

  const palette = theme === 'cool' ? PALETTE_COOL : PALETTE_WARM;
  const cx = canvas.width / 2;
  const cy = canvas.height * 0.4;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 6;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.4,
      size: 6 + Math.random() * 6,
      color: palette[Math.floor(Math.random() * palette.length)],
      life: 1,
    });
  }

  if (rafId == null) tick();
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.querySelector('#confetti-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!canvas) return;
  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
}

export function updateParticle(p, dt) {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vy += 0.4 * dt;
  p.rot += p.vrot * dt;
  p.life -= 0.02 * dt;
  return p;
}

function tick() {
  if (!ctx) { rafId = null; return; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const alive = [];
  for (const p of particles) {
    updateParticle(p, 1);
    if (p.life > 0 && p.y < canvas.height + 100) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
      ctx.restore();
      alive.push(p);
    }
  }
  particles = alive;

  if (particles.length > 0) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/confetti.test.js`
Expected: 5 tests pass.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 112 tests pass (107 + 5).

- [ ] **Step 6: Commit**

```bash
git add src/ui/confetti.js tests/confetti.test.js
git commit -m "Add confetti: canvas particle system with theme-aware palette"
```

---

## Task 4: Sound effects (TDD)

**Files:**
- Create: `src/ui/sounds.js`
- Create: `tests/sounds.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/sounds.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let createOscillator;
let createGain;
let mockOsc;
let mockGain;

function makeMockAudioContext() {
  mockOsc = {
    type: '',
    frequency: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(() => mockGain),
    start: vi.fn(),
    stop: vi.fn(),
  };
  mockGain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  createOscillator = vi.fn(() => mockOsc);
  createGain = vi.fn(() => mockGain);
  return class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
    }
    createOscillator() { return createOscillator(); }
    createGain() { return createGain(); }
    resume() { this.state = 'running'; }
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sounds', () => {
  it('does not throw when AudioContext is unavailable', async () => {
    vi.stubGlobal('window', { AudioContext: undefined, webkitAudioContext: undefined });
    const { playMove, playSuccess, playFail } = await import('../src/ui/sounds.js');
    expect(() => { playMove(); playSuccess(); playFail(); }).not.toThrow();
  });

  it('playMove creates an oscillator + gain when AudioContext is available', async () => {
    const Mock = makeMockAudioContext();
    vi.stubGlobal('window', { AudioContext: Mock, webkitAudioContext: undefined });
    const { playMove } = await import('../src/ui/sounds.js');
    playMove();
    expect(createOscillator).toHaveBeenCalledTimes(1);
    expect(createGain).toHaveBeenCalledTimes(1);
  });

  it('playSuccess fires two tones (one immediate, one after 130ms)', async () => {
    const Mock = makeMockAudioContext();
    vi.stubGlobal('window', { AudioContext: Mock, webkitAudioContext: undefined });
    vi.useFakeTimers();
    const { playSuccess } = await import('../src/ui/sounds.js');
    playSuccess();
    expect(createOscillator).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(140);
    expect(createOscillator).toHaveBeenCalledTimes(2);
  });

  it('playFail uses a sawtooth oscillator', async () => {
    const Mock = makeMockAudioContext();
    vi.stubGlobal('window', { AudioContext: Mock, webkitAudioContext: undefined });
    const { playFail } = await import('../src/ui/sounds.js');
    playFail();
    expect(mockOsc.type).toBe('sawtooth');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/sounds.test.js`
Expected: FAIL — `../src/ui/sounds.js` not found.

- [ ] **Step 3: Implement `src/ui/sounds.js`**

```js
// src/ui/sounds.js
// Web Audio API synthesized sound effects. Lazy AudioContext init; functions
// are no-ops when Web Audio is unavailable.

let ctx = null;

function getCtx() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq, type = 'sine', duration = 0.1, attack = 0.005, peakGain = 0.2, sweepTo = null }) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (sweepTo != null) osc.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + duration);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(peakGain, c.currentTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration + 0.05);
}

export function playMove() {
  tone({ freq: 380, type: 'sine', duration: 0.08, peakGain: 0.15 });
}

export function playSuccess() {
  tone({ freq: 523, type: 'sine', duration: 0.18, peakGain: 0.2 });
  setTimeout(() => tone({ freq: 784, type: 'sine', duration: 0.3, peakGain: 0.2 }), 130);
}

export function playFail() {
  tone({ freq: 220, type: 'sawtooth', duration: 0.18, peakGain: 0.15, sweepTo: 110 });
}
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/sounds.test.js`
Expected: 4 tests pass.

If the first test (no AudioContext) fails because module-level state leaks across imports (the `ctx` variable persists between tests), `vi.resetModules()` in `beforeEach` should clear it. The plan already includes this; if it still fails, double-check the import path.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 116 tests pass (112 + 4).

- [ ] **Step 6: Commit**

```bash
git add src/ui/sounds.js tests/sounds.test.js
git commit -m "Add Web Audio sounds: move, success (rising fifth), fail"
```

---

## Task 5: Reduced-motion CSS

**Files:**
- Modify: `src/ui/styles.css`

CSS-only task. JS check is added in Task 6.

- [ ] **Step 1: Append the reduced-motion media query**

Append to `src/ui/styles.css`:

```css
/* Phase 5: respect prefers-reduced-motion. Functional cm-chessboard move
   animations are not disabled — they're load-bearing for understanding the
   move that just happened. */
@media (prefers-reduced-motion: reduce) {
  .shake-incorrect { animation: none; }
  .flash-correct { animation-duration: 100ms; }
  .settings-sheet { transition: none; }
  .settings-scrim { transition: none; }
  .confetti-canvas { display: none; }
}
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: 116 tests still pass (CSS-only change).

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles.css
git commit -m "Respect prefers-reduced-motion: disable shake, shorten flash, hide confetti"
```

---

## Task 6: Wire `app.js`

**Files:**
- Modify: `src/app.js`

Integrate all four polish features into the runtime: settings init + apply, sound triggers, confetti on solve, reduced-motion check, reset-stats handler.

- [ ] **Step 1: Add the new imports**

At the top of `src/app.js`, find the existing imports section. Add:

```js
import { Settings } from './settings.js';
import { bindSettings } from './ui/settings.js';
import { fireConfetti } from './ui/confetti.js';
import { playMove, playSuccess, playFail } from './ui/sounds.js';
```

Place these after the existing `import { renderStars } from './ui/stars.js';` line and before `import { bindInstall } from './ui/install.js';` so the imports stay grouped (state modules, then UI modules).

- [ ] **Step 2: Add module-level state for settings + reducedMotion**

Find the existing module-level state declarations:

```js
let session = null;
let board = null;
let stats = null;
let filters = null;
```

Add immediately after:

```js
let settings = null;
const reducedMotion = typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

- [ ] **Step 3: Initialize Settings inside `main()` and bind the sheet**

Find the existing `main()` block where stats and filters are loaded:

```js
const store = await new Store().open();
stats   = await new Stats(store).load();
filters = await new Filters(store, puzzles).load();

renderStats(stats.snapshot());
renderChips({ active: filters.theme, counts: filters.counts(), onSelect: handleThemeChange });
renderStars({ cap: filters.maxStars, onSelect: handleStarChange });
```

Add immediately after (and before `await loadNextPuzzle();`):

```js
settings = await new Settings(store).load();
settings.apply();
bindSettings({
  settings,
  onResetStats: async () => {
    await stats.reset();
    renderStats(stats.snapshot());
  },
});
```

- [ ] **Step 4: Add sound + confetti triggers in `handleUserMove`**

Find `handleUserMove`. The current function structure is:

```js
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
```

Add three sound triggers and one confetti trigger:

```js
async function handleUserMove({ from, to, promotion }) {
  if (!session || session.status !== 'awaiting-user') return;
  const r = session.attemptUserMove({ from, to, promotion });
  if (r.result === 'incorrect') {
    await stats.onWrongMove();
    renderStats(stats.snapshot());
    if (settings && settings.soundOn) playFail();
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
    if (settings && settings.soundOn) playSuccess();
    if (!reducedMotion) fireConfetti({ theme: settings ? settings.theme : 'warm' });
    setStatus('Solved!');
    await wait(POST_SOLVE_PAUSE_MS);
    await loadNextPuzzle();
    return;
  }

  // Multi-move continuation: in-progress correct move plays the soft tap.
  if (settings && settings.soundOn) playMove();
  await wait(OPPONENT_REPLY_DELAY_MS);
  await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
  setStatus('Find the next best move.');
}
```

The `settings && ...` guard handles the case where the sound trigger fires before settings has loaded (theoretically possible if a wrong move happens before `await new Settings(store).load()` resolves; in practice the user can't move before main() finishes, but the guard is cheap defense).

- [ ] **Step 5: Smoke-check**

Run: `node --input-type=module -e "import('./src/app.js').then(() => console.log('ok')).catch(e => console.log('IMPORT-ONLY:', e.message))"`
Expected: prints `IMPORT-ONLY: Cannot find package ...` (browser-only). What you don't want is a syntax error.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: 116 tests still pass (no regressions; app.js isn't unit-tested).

- [ ] **Step 7: Commit**

```bash
git add src/app.js
git commit -m "Wire app.js: Settings, sound triggers, confetti, reduced-motion check"
```

---

## Task 7: Manual test pass

**Files:** none (exercise the running app, fix any code as issues are found)

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`
Expected: server on port 8000.

- [ ] **Step 2: Walk the manual checklist**

Open Chrome at `http://localhost:8000`. Use DevTools → Application → Storage → "Clear site data" between tests as noted.

1. **Settings sheet open/close.** Tap gear (top-right). Sheet slides up. Tap × or scrim. Sheet slides down.
2. **Theme switch.** Tap "Cool" segment. Board squares change to blue-grey + slate-blue. Tap "Warm". Squares revert.
3. **Theme persistence.** Reload. Theme persists.
4. **Coordinates toggle.** Toggle on. File letters (a–h) and rank numbers (1–8) appear on the board. Toggle off. They disappear.
5. **Sound toggle.** Toggle on. Solve a puzzle without errors → hear the rising-fifth chime. Make a wrong move → hear the descending buzzer. In a multi-move puzzle, play the first correct move → hear the soft tap. Toggle off. Same actions are silent.
6. **Reset stats.** Solve a few puzzles. Open settings → tap "Reset stats" once → button morphs to "Confirm reset" with a different style. Tap again. Stats header zeros out. Filter prefs unchanged.
7. **Reset stats — disarm timeout.** Tap "Reset stats" once. Wait 4 seconds. Button reverts to "Reset stats" without committing.
8. **Confetti on solve.** Solve a puzzle without errors. ~50 colored particles burst from board area, gravity pulls them down, fade over ~1.2s.
9. **Confetti theme awareness.** Switch to Cool theme. Solve a puzzle. Particles use cool palette (blues/grey).
10. **Reduced-motion.** OS Settings → Accessibility → Reduce Motion = on. Reload. Solve a puzzle: no confetti, no shake on wrong moves. Move animations still play.
11. **Install button position.** Fresh install (clear data + offline once + back online). When `beforeinstallprompt` fires, install button appears top-LEFT (not top-right where the gear is). Both buttons visible side-by-side without overlap.
12. **Sound autoplay handling.** First solve after page load (with sound enabled): the audio context resumes from any suspended state and the chime plays cleanly.
13. **Skip / Show silent.** With sound on: tap Skip — silent. Tap Show — silent (the move animation plays but no audio).

For each issue found, edit the relevant file, reload, retest. Commit fixes per logical change.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "<descriptive message per fix>"
```

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run icons`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from clean clone.
- [ ] All unit tests pass (~116 total).
- [ ] Settings sheet opens, closes, and all four controls work.
- [ ] Theme switches the board palette without page reload.
- [ ] Coordinates toggle shows/hides labels without board reconstruction.
- [ ] Sound triggers correctly (move/success/fail) when enabled, silent when disabled.
- [ ] Reset stats requires confirmation and resets only stats (filter prefs preserved).
- [ ] Confetti fires on solve with palette matching the active theme.
- [ ] `prefers-reduced-motion` disables shake + confetti while keeping move animations.
- [ ] Install button moved to top-left to avoid colliding with the new gear.
- [ ] No console errors during normal operation.

---

## Self-review notes

- **Spec coverage:** All "In scope" bullets map to a task. Settings module + Stats.reset() = Task 1. Sheet UI + theme/coords CSS + install reposition + board.js coords = Task 2. Confetti = Task 3. Sounds = Task 4. Reduced-motion CSS = Task 5. Wiring = Task 6. Manual test = Task 7.
- **Placeholder check:** No TBD/TODO. All code blocks are concrete. Test fixtures use real values. The `tone()` parameters (frequencies, durations, gain) are all literal.
- **Type consistency:** `Settings.setSound/setTheme/setShowCoords/apply/snapshot` consistent across plan + tests + spec. `Stats.reset()` matches. `bindSettings({settings, onResetStats})` matches. `fireConfetti({theme, count})` matches. `playMove/playSuccess/playFail` exports consistent.
- **Test count math:** Phase 4 ended at 100. Task 1 adds 7 (6 settings + 1 stats). Task 3 adds 5. Task 4 adds 4. Total: 116.
- **Risk surface called out:** the `sounds.test.js` "no AudioContext" case relies on `vi.resetModules()` clearing the module-level `ctx` cache between tests. If state leaks despite this, the implementer is told to debug.
