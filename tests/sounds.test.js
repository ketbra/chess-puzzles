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
