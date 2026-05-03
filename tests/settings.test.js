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
