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
