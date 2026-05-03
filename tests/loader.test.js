import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { loadPuzzles, LoaderError } from '../src/loader.js';
import { Store } from '../src/store.js';

const PUZZLE = (id, theme, stars=2) => ({
  id, fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'],
  rating: 850, themes: [theme], stars,
});
const THEMES = ['mateIn1', 'mateIn2', 'fork', 'pin', 'hangingPiece'];

function themeFile(theme, ids) {
  return JSON.stringify({
    version: '2026-05-XX',
    theme,
    puzzles: ids.map((id) => PUZZLE(id, theme)),
  });
}

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeManifest(version, themes) {
  const entries = [];
  for (const t of themes) {
    entries.push({ name: t.name, file: `${t.name}.json`, count: t.ids.length, sha256: await sha256Hex(t.body) });
  }
  return JSON.stringify({ version, generatedAt: new Date().toISOString(), themes: entries });
}

function makeFetch({ indexJson, themeBodies, themeFails = {}, indexFails = false }) {
  return vi.fn(async (url) => {
    if (typeof url === 'string') url = new URL(url, 'http://localhost/');
    const path = url.pathname || url.toString();
    if (path.endsWith('index.json')) {
      if (indexFails) throw new Error('network error');
      return new Response(indexJson, { status: 200 });
    }
    for (const theme of THEMES) {
      if (path.endsWith(`${theme}.json`)) {
        if (themeFails[theme]) throw new Error(`network error: ${theme}`);
        return new Response(themeBodies[theme], { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('loadPuzzles (multi-theme)', () => {
  it('first launch: fetches all 5 themes, sha256-verifies, populates IDB', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_A`, `${t}_B`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_A`, `${t}_B`], body });
    }
    const indexJson = await makeManifest('2026-05-03', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies });
    const store = await new Store().open();

    const puzzles = await loadPuzzles({ fetch, store });

    expect(puzzles.length).toBe(10);
    expect(await store.getVersion()).toBe('2026-05-03');
    expect(fetch).toHaveBeenCalledTimes(6);
    await store.close();
  });

  it('dedupes union: same id in two theme files = one row in IDB', async () => {
    const sharedId = 'SAME';
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [sharedId, `${t}_X`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [sharedId, `${t}_X`], body });
    }
    const indexJson = await makeManifest('v1', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies });
    const store = await new Store().open();

    const puzzles = await loadPuzzles({ fetch, store });

    expect((await store.getAllPuzzles()).length).toBe(6);
    expect(puzzles.length).toBe(6);
    await store.close();
  });

  it('subsequent launch with same version: no theme refetch', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_A`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_A`], body });
    }
    const indexJson = await makeManifest('v1', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies });
    const store = await new Store().open();
    await store.replacePuzzles('all', THEMES.map((t) => PUZZLE(`${t}_A`, t)));
    await store.setVersion('v1');

    const puzzles = await loadPuzzles({ fetch, store });

    expect(puzzles.length).toBe(5);
    expect(fetch).toHaveBeenCalledTimes(1);
    await store.close();
  });

  it('partial fetch failure: cached union returned, IDB unchanged', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_NEW`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_NEW`], body });
    }
    const indexJson = await makeManifest('v2', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies, themeFails: { fork: true } });
    const store = await new Store().open();
    const cached = THEMES.map((t) => PUZZLE(`${t}_OLD`, t));
    await store.replacePuzzles('all', cached);
    await store.setVersion('v1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const puzzles = await loadPuzzles({ fetch, store });

    expect(puzzles.map((p) => p.id).sort()).toEqual(cached.map((p) => p.id).sort());
    expect(await store.getVersion()).toBe('v1');
    warn.mockRestore();
    await store.close();
  });

  it('partial fetch failure on cold start: throws LoaderError', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_A`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_A`], body });
    }
    const indexJson = await makeManifest('v1', themesMeta);
    const fetch = makeFetch({ indexJson, themeBodies, themeFails: { fork: true } });
    const store = await new Store().open();

    await expect(loadPuzzles({ fetch, store })).rejects.toThrow(LoaderError);
    await store.close();
  });

  it('sha256 mismatch on one theme: cached union returned, IDB unchanged', async () => {
    const themeBodies = {};
    const themesMeta = [];
    for (const t of THEMES) {
      const body = themeFile(t, [`${t}_NEW`]);
      themeBodies[t] = body;
      themesMeta.push({ name: t, ids: [`${t}_NEW`], body });
    }
    const idx = JSON.parse(await makeManifest('v2', themesMeta));
    const pin = idx.themes.find((t) => t.name === 'pin');
    pin.sha256 = '0'.repeat(64);
    const indexJson = JSON.stringify(idx);
    const fetch = makeFetch({ indexJson, themeBodies });
    const store = await new Store().open();
    const cached = THEMES.map((t) => PUZZLE(`${t}_OLD`, t));
    await store.replacePuzzles('all', cached);
    await store.setVersion('v1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const puzzles = await loadPuzzles({ fetch, store });

    expect(puzzles.map((p) => p.id).sort()).toEqual(cached.map((p) => p.id).sort());
    expect(await store.getVersion()).toBe('v1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await store.close();
  });

  it('offline first launch: throws LoaderError', async () => {
    const fetch = makeFetch({ indexJson: '', themeBodies: {}, indexFails: true });
    const store = await new Store().open();
    await expect(loadPuzzles({ fetch, store })).rejects.toThrow(LoaderError);
    await store.close();
  });

  it('offline subsequent launch: cached union returned', async () => {
    const fetch = makeFetch({ indexJson: '', themeBodies: {}, indexFails: true });
    const store = await new Store().open();
    const cached = THEMES.map((t) => PUZZLE(`${t}_OLD`, t));
    await store.replacePuzzles('all', cached);
    await store.setVersion('v1');

    const puzzles = await loadPuzzles({ fetch, store });
    expect(puzzles.length).toBe(5);
    await store.close();
  });
});
