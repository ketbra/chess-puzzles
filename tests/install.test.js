// tests/install.test.js
//
// Tests for src/ui/install.js. Uses manual stubs for window/document since
// the install button logic is tiny and adding happy-dom/jsdom isn't worth
// the dev-dep overhead.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let buttonEl;
let listeners;

beforeEach(async () => {
  vi.resetModules();

  const win = new EventTarget();
  vi.stubGlobal('window', win);

  buttonEl = {
    hidden: true,
    addEventListener: vi.fn((type, handler) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    }),
  };
  listeners = {};
  vi.stubGlobal('document', {
    querySelector: (sel) => (sel === '#install-btn' ? buttonEl : null),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bindInstall', () => {
  it('shows the install button when beforeinstallprompt fires', async () => {
    const { bindInstall } = await import('../src/ui/install.js');
    bindInstall();

    const event = new Event('beforeinstallprompt');
    event.preventDefault = vi.fn();
    event.prompt = vi.fn();
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);

    expect(buttonEl.hidden).toBe(false);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('calls prompt() and hides the button on click', async () => {
    const { bindInstall } = await import('../src/ui/install.js');
    bindInstall();

    const event = new Event('beforeinstallprompt');
    event.preventDefault = vi.fn();
    const prompt = vi.fn();
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);

    expect(listeners.click).toBeTruthy();
    await listeners.click[0]();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(buttonEl.hidden).toBe(true);
  });

  it('hides the button when appinstalled fires', async () => {
    const { bindInstall } = await import('../src/ui/install.js');
    bindInstall();

    const e1 = new Event('beforeinstallprompt');
    e1.preventDefault = vi.fn();
    e1.prompt = vi.fn();
    e1.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e1);
    expect(buttonEl.hidden).toBe(false);

    window.dispatchEvent(new Event('appinstalled'));
    expect(buttonEl.hidden).toBe(true);
  });
});
