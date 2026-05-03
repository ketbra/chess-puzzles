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
