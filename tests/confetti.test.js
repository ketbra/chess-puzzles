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
