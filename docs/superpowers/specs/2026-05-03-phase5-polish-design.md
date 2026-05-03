# Phase 5 Design: Polish

**Date:** 2026-05-03
**Phase:** 5 of 6 (per `PROJECT.md`)
**Predecessors:**
- Phases 1–4 shipped (designs in `docs/superpowers/specs/`)

**Goal:** Add the polish layer — settings sheet, success-celebration confetti, optional sound effects, and reduced-motion accessibility. After this phase, the kid can customize the experience (theme, sound, coordinates), get satisfying feedback on solve, and the app behaves well for users who prefer reduced motion.

This phase delivers four loosely-coupled features that all touch the UI layer: (1) a settings module with persistent preferences and a slide-up sheet, (2) hand-rolled canvas confetti, (3) Web Audio API synthesized sound effects, (4) `prefers-reduced-motion` support across animations.

---

## Scope

### In scope

**Settings module + sheet UI.**

- `src/settings.js` — state holder + IDB sync. Three persistent preferences:
  - `soundOn` (boolean, default `false` per PROJECT.md "off by default")
  - `theme` (`'warm'` | `'cool'`, default `'warm'`)
  - `showCoords` (boolean, default `false`)
- `src/ui/settings.js` — gear icon top-right, opens a sheet from the bottom; renders three controls + reset-stats action.
- Settings sheet contents:
  - Sound toggle (pill-slider style)
  - Theme segmented control (Warm / Cool)
  - Coordinates toggle
  - Reset stats button with in-place two-stage confirm (tap → "Confirm reset" + 3s disarm timeout → second tap commits)
- Tap outside the sheet (scrim) or the × dismisses.
- Reset stats clears `solved` / `streak` / `bestStreak` / `todayCount` / `todayDate`. **Filter preferences (`filterTheme`, `filterMaxStars`) are preserved.**
- New `Stats.reset()` method centralizes the zeroing + persist + clear-error-flag in one place.

**Confetti** — `src/ui/confetti.js`.

- Hand-rolled canvas particle system (~50 LoC).
- Single full-screen `<canvas>` overlay (`pointer-events: none`, z-index above board, below settings sheet).
- ~50 particles per fire, each with random velocity, rotation, color from active theme palette.
- Gravity + opacity decay over ~1.2s. Auto-stops when all particles expire.
- Fired alongside the existing green flash on every successful solve. Skipped when reduced-motion is preferred.
- Theme awareness: warm palette `[#f0d9b5, #7a4a2b, #5a3a22, #efe6dc, #b88550]`; cool palette `[#dee3e6, #5d7a92, #3a4d5e, #efe6dc, #a8b8c4]`.
- `updateParticle(p, dt)` exported for unit testing without a canvas/RAF loop.

**Sound effects** — `src/ui/sounds.js`.

- Web Audio API synthesized via oscillators + gain envelopes. No bundled audio files.
- Three exports:
  - `playMove()` — single sine tone at ~380 Hz, ~80ms decay (soft tap on correct in-progress moves of multi-move puzzles).
  - `playSuccess()` — two-note rising fifth (C5 → G5), ~430ms total (final correct solve).
  - `playFail()` — sawtooth at 220 Hz sweeping down to 110 Hz, ~180ms (incorrect move).
- Audio context lazy-initialized on first call; resumed if suspended (browser autoplay policy after user gesture).
- All sound functions gated on `settings.soundOn` at the call site in `src/app.js`.
- Skip and Show buttons do NOT play sounds (the kid didn't earn them; consistent with PROJECT.md's "skip doesn't break streak negatively" sentiment).

**Reduced-motion handling.**

- CSS `@media (prefers-reduced-motion: reduce)`:
  - Disables `shake-incorrect` animation.
  - Shortens `flash-correct` to 100ms (so users still see the green flash, just briefly).
  - Disables sheet/scrim transitions.
  - Hides the confetti canvas (`display: none`).
- JS `window.matchMedia('(prefers-reduced-motion: reduce)').matches` check in `app.js` skips the call to `fireConfetti` entirely (defense-in-depth).
- Functional cm-chessboard move animations are NOT disabled — they're load-bearing for understanding what happened on the board.

**Theme rendering.**

- Pure CSS via a `body.theme-cool` class.
- Default (no class): warm palette (current behavior unchanged for existing users).
- `body.theme-cool`: blue-grey + slate-blue squares.
- Settings.apply() is the single function that toggles the body class to match `settings.theme`. Called once at boot + after each setter.

**Coordinate visibility.**

- `src/board.js` flips `showCoordinates: true` (always render the coordinate SVG group).
- CSS controls visibility: `body:not(.show-coords) .cm-chessboard .coordinates { display: none; }`.
- Toggling the setting just adds/removes a body class — no board reconstruction.

**Install button repositions.**

- Moves from `top: 12px; right: 12px;` to `top: 12px; left: 12px;` to avoid colliding with the new top-right gear icon.
- Only CSS changes; no logic changes in `src/ui/install.js`.

### Out of scope (deferred)

| Feature | Phase |
|---|---|
| Adaptive difficulty (auto-bump stars on 80%+ accuracy) | 6 |
| Per-theme stats breakdown view | 6 |
| Multi-profile (per-kid) | 6 |
| Promotion-piece-choice dialog | future, on demand |
| Custom sounds (file upload) | not planned |
| More than 2 board themes | not planned |
| Animated theme transitions (e.g., crossfade between warm and cool) | not planned |

---

## File changes

| Action | Path | Notes |
|---|---|---|
| Create | `src/settings.js` | Settings state + IDB sync |
| Create | `src/ui/settings.js` | Gear icon + sheet binding + control wiring |
| Create | `src/ui/confetti.js` | Canvas particle system |
| Create | `src/ui/sounds.js` | Web Audio synth (3 functions) |
| Create | `tests/settings.test.js` | round-trip, defaults, persistence, apply() |
| Create | `tests/confetti.test.js` | updateParticle pure-logic + terminal state |
| Create | `tests/sounds.test.js` | no-throw without AudioContext, oscillator/gain creation, two-tone success |
| Modify | `src/stats.js` | Add `reset()` method |
| Modify | `tests/stats.test.js` | Add reset() test |
| Modify | `src/app.js` | Initialize Settings; wire reset-stats handler; fire confetti + sounds on solve/incorrect; respect reduced-motion |
| Modify | `src/board.js` | `showCoordinates: true` (CSS controls visibility) |
| Modify | `index.html` | Gear button, settings sheet markup, scrim, confetti canvas |
| Modify | `src/ui/styles.css` | Sheet/scrim animation, gear, install-button position, theme-cool rules, show-coords rule, reduced-motion media query, confetti canvas style |

**Persistence keys** added to IDB `meta` store: `soundOn`, `theme`, `showCoords`. Existing keys preserved.

---

## Settings module

```js
// src/settings.js
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

  async setSound(on)        { this.soundOn = !!on;       await this.store.setMeta('soundOn', this.soundOn); }
  async setTheme(t)         { this.theme = t;            await this.store.setMeta('theme', this.theme); }
  async setShowCoords(on)   { this.showCoords = !!on;    await this.store.setMeta('showCoords', this.showCoords); }

  apply() {
    document.body.classList.toggle('theme-cool', this.theme === 'cool');
    document.body.classList.toggle('show-coords', !!this.showCoords);
  }

  snapshot() {
    return { soundOn: this.soundOn, theme: this.theme, showCoords: this.showCoords };
  }
}
```

`Stats.reset()` (added to `src/stats.js`):

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

---

## Settings sheet UI

`src/ui/settings.js`:

```js
export function bindSettings({ settings, stats, onResetStats }) {
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

Markup added to `index.html` (inside `<body>`, after the install button, before `<main>`):

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

Styles appended to `src/ui/styles.css`:

- Gear icon: fixed top-right, 36×36, warm palette to match install button styling.
- Install button: change CSS to `top: 12px; left: 12px;` (was right) so they don't collide.
- Sheet: fixed bottom, full-width up to ~480px max, slides up via `transform: translateY(0)` when `.open`. Default state: `transform: translateY(100%)`. Transition 250ms ease.
- Scrim: fixed full-screen, dark semi-transparent (`rgba(0,0,0,0.55)`), fades opacity 0→1 when `.visible`.
- Toggle (`<label.toggle>`): hides the checkbox, paints a sliding pill via `<span.slider>`.
- Segmented: two buttons rendered side-by-side, the `.active` one gets the cream fill.
- Reset button: walnut-bordered. `.confirming` state turns it red-ish (e.g., `#a85a3c` border + cream fill turning slightly orange).
- Theme/coords rules:
  ```css
  body.theme-cool .board-stage .cm-chessboard.default .board .square.white { fill: #dee3e6; }
  body.theme-cool .board-stage .cm-chessboard.default .board .square.black { fill: #5d7a92; }
  body:not(.show-coords) .cm-chessboard .coordinates { display: none; }
  ```

---

## Confetti

`src/ui/confetti.js`:

```js
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

Markup (in `index.html`):
```html
<canvas id="confetti-canvas" class="confetti-canvas" aria-hidden="true"></canvas>
```

Styles:
```css
.confetti-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 99;
}
```

`updateParticle(p, dt)` is exported so it can be unit-tested without canvas/RAF.

---

## Sound effects

`src/ui/sounds.js`:

```js
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

Functions are no-ops when Web Audio is unavailable (test environments). Audio context is shared and lazy.

---

## Reduced-motion handling

CSS appended to `src/ui/styles.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .shake-incorrect { animation: none; }
  .flash-correct { animation-duration: 100ms; }
  .settings-sheet { transition: none; }
  .settings-scrim { transition: none; }
  .confetti-canvas { display: none; }
}
```

JS check in `src/app.js`:

```js
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

Used in the correct-solve handler:

```js
if (r.solved) {
  await stats.onCorrectSolve();
  renderStats(stats.snapshot());
  if (settings.soundOn) playSuccess();
  if (!reducedMotion) fireConfetti({ theme: settings.theme });
  setStatus('Solved!');
  await wait(POST_SOLVE_PAUSE_MS);
  await loadNextPuzzle();
  return;
}
```

The CSS `display: none` on the canvas is defense-in-depth: even if `fireConfetti` is somehow called, nothing renders.

---

## App.js wiring

Inside `main()`, after stats/filters init:

```js
const settings = await new Settings(store).load();
settings.apply();
bindSettings({
  settings,
  stats,
  onResetStats: async () => {
    await stats.reset();
    renderStats(stats.snapshot());
  },
});
```

In the user-move handler:

```js
if (r.result === 'incorrect') {
  await stats.onWrongMove();
  renderStats(stats.snapshot());
  if (settings.soundOn) playFail();
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
  if (settings.soundOn) playSuccess();
  if (!reducedMotion) fireConfetti({ theme: settings.theme });
  setStatus('Solved!');
  await wait(POST_SOLVE_PAUSE_MS);
  await loadNextPuzzle();
  return;
}

// Multi-move continuation: in-progress correct move plays the soft tap.
if (settings.soundOn) playMove();
await wait(OPPONENT_REPLY_DELAY_MS);
await board.animateMove({ from: r.opponentReply.from, to: r.opponentReply.to });
setStatus('Find the next best move.');
```

Show and Skip handlers do NOT call any sound or confetti — the kid didn't earn it.

---

## Test plan

| File | Group | Tests |
|---|---|---|
| `tests/settings.test.js` | round-trip | each setter persists; getter returns saved value |
| `tests/settings.test.js` | persistence | `new Settings(store).load()` after a setter returns the saved value across instances |
| `tests/settings.test.js` | defaults | fresh DB → `soundOn: false`, `theme: 'warm'`, `showCoords: false` |
| `tests/settings.test.js` | apply() | toggles `body.theme-cool` and `body.show-coords` based on state (using stubbed document.body) |
| `tests/stats.test.js` (new test) | reset() | populates stats, calls `reset()`, all back to 0; `puzzleHadError` cleared |
| `tests/confetti.test.js` | updateParticle pure logic | x/y advance by velocity; vy increases (gravity); life decreases; rotation advances |
| `tests/confetti.test.js` | terminal state | repeated updates eventually drop life ≤ 0 |
| `tests/sounds.test.js` | no AudioContext, no throw | with `window.AudioContext = undefined`, `playMove()/playSuccess()/playFail()` return without error |
| `tests/sounds.test.js` | creates oscillator + gain | with stubbed AudioContext, `playMove()` calls `createOscillator` + `createGain` once |
| `tests/sounds.test.js` | playSuccess fires two tones | with stubbed AudioContext + fake timers, `createOscillator` called twice (one immediate, one after 130ms) |

Approximate new test count: ~12. Target total: ~112 (100 prior + 12 new).

---

## Manual test plan

After unit tests pass:

1. **Settings sheet open/close.** Tap gear (top-right). Sheet slides up. Tap × or scrim. Sheet slides down.
2. **Theme switch.** Tap "Cool" segment. Board squares change to blue-grey + slate-blue. Tap "Warm". Squares revert.
3. **Theme persistence.** Reload. Theme persists.
4. **Coordinates toggle.** Toggle on. File letters (a–h) and rank numbers (1–8) appear on the board. Toggle off. They disappear.
5. **Sound toggle.** Toggle on. Solve a puzzle without errors → hear the rising-fifth chime. Make a wrong move → hear the descending buzzer. Toggle off. Same actions are silent.
6. **Reset stats.** Solve a few puzzles. Open settings → tap "Reset stats" once → button morphs to "Confirm reset" with a different style. Tap again. Stats header zeros out. Filter prefs unchanged.
7. **Reset stats — disarm timeout.** Tap "Reset stats" once. Wait 4 seconds. Button reverts to "Reset stats" without committing.
8. **Confetti on solve.** Solve a puzzle without errors. ~50 colored particles burst from board area, gravity pulls them down, fade over ~1.2s.
9. **Confetti theme awareness.** Switch to Cool theme. Solve a puzzle. Particles use cool palette (blues/grey).
10. **Reduced-motion.** OS Settings → Accessibility → Reduce Motion = on. Reload. Solve a puzzle: no confetti, no shake on wrong moves. Move animations still play.
11. **Install button position.** Fresh install (clear data + offline once + back online). When `beforeinstallprompt` fires, install button appears top-LEFT (not top-right where the gear is). Both buttons visible side-by-side without overlap.
12. **Sound autoplay handling.** First solve after page load (with sound enabled): the audio context resumes from any suspended state and the chime plays cleanly.

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run icons`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from clean clone.
- [ ] All unit tests pass (~112 total).
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

## Architecture trade-offs explicitly considered

- **Web Audio synthesis vs bundled audio files.** Synthesized chosen. Zero bundle weight, no copyright concerns, customizable.
- **Hand-rolled confetti vs library.** Hand-rolled. ~50 LoC, theme-aware, fits the no-framework style.
- **Cool theme palette.** Lichess-inspired blue-grey + slate-blue. Familiar to anyone who's used a chess site.
- **CSS-driven theme + coords toggle.** No board reconstruction. Body classes are the single source of truth; CSS handles the rest.
- **Reset stats scope.** Just stats, not filter prefs. The button is named "Reset stats" — it should do exactly that.
- **In-place two-stage confirm for reset.** No nested modal; the button itself morphs. 3-second timeout disarms.
- **Sound off by default.** Per PROJECT.md. Kid app shouldn't make noise unprompted.
- **Reduced-motion check in CSS + JS.** CSS hides confetti canvas; JS skips the work entirely. Defense in depth.
- **Install button moves left.** Top-right is gear (per PROJECT.md). Install button only matters on first visit; moving it left avoids collision.
- **Skip and Show silent.** Consistent with their stats semantics: kid didn't earn the success, no celebration audio.
- **Soft-tap on multi-move correct moves.** Subtle reward feedback for being on track without preempting the bigger success chime at the final solve.
