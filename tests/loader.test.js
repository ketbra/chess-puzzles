import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { loadPuzzles, LoaderError } from '../src/loader.js';
import { Store } from '../src/store.js';

const SAMPLE_THEME_FILE = JSON.stringify({
  version: '2026-05-03',
  theme: 'mateIn1',
  puzzles: [
    { id: 'X1', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 },
    { id: 'X2', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['b1b2','b3b4'], rating: 800, themes: ['mateIn1'], stars: 2 },
  ],
});

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function makeIndexJson(version, sha256) {
  return JSON.stringify({
    version,
    generatedAt: new Date().toISOString(),
    themes: [{ name: 'mateIn1', file: 'mateIn1.json', count: 2, sha256 }],
  });
}

function makeFetch({ indexJson, themeJson, themeFails = false, indexFails = false }) {
  return vi.fn(async (url) => {
    if (typeof url === 'string') url = new URL(url, 'http://localhost/');
    const path = url.pathname || url.toString();
    if (path.endsWith('index.json')) {
      if (indexFails) throw new Error('network error');
      return new Response(indexJson, { status: 200 });
    }
    if (path.endsWith('mateIn1.json')) {
      if (themeFails) throw new Error('network error');
      return new Response(themeJson, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('loadPuzzles', () => {
  it('first launch: fetches, sha256-verifies, populates IDB, returns puzzles', async () => {
    const sha = await sha256Hex(SAMPLE_THEME_FILE);
    const indexJson = makeIndexJson('2026-05-03', sha);
    const fetch = makeFetch({ indexJson, themeJson: SAMPLE_THEME_FILE });
    const store = await new Store().open();

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles).toHaveLength(2);
    expect(await store.getVersion()).toBe('2026-05-03');
    expect((await store.getAllPuzzles()).length).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2); // index + theme
    await store.close();
  });

  it('subsequent launch with same version: no theme refetch', async () => {
    const sha = await sha256Hex(SAMPLE_THEME_FILE);
    const fetch = makeFetch({ indexJson: makeIndexJson('v1', sha), themeJson: SAMPLE_THEME_FILE });
    const store = await new Store().open();
    // Seed cache.
    await store.replacePuzzles('mateIn1', JSON.parse(SAMPLE_THEME_FILE).puzzles);
    await store.setVersion('v1');

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1); // only index.json
    await store.close();
  });

  it('subsequent launch with newer version: refetches and replaces', async () => {
    const sha = await sha256Hex(SAMPLE_THEME_FILE);
    const fetch = makeFetch({ indexJson: makeIndexJson('v2', sha), themeJson: SAMPLE_THEME_FILE });
    const store = await new Store().open();
    await store.replacePuzzles('mateIn1', [{ id: 'OLD', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 }]);
    await store.setVersion('v1');

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles.map((p) => p.id).sort()).toEqual(['X1', 'X2']);
    expect(await store.getVersion()).toBe('v2');
    await store.close();
  });

  it('offline with cached data: returns cache, does not throw', async () => {
    const fetch = makeFetch({ indexFails: true, indexJson: '', themeJson: '' });
    const store = await new Store().open();
    await store.replacePuzzles('mateIn1', JSON.parse(SAMPLE_THEME_FILE).puzzles);
    await store.setVersion('v1');

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles).toHaveLength(2);
    await store.close();
  });

  it('offline first launch: throws LoaderError', async () => {
    const fetch = makeFetch({ indexFails: true, indexJson: '', themeJson: '' });
    const store = await new Store().open();

    await expect(loadPuzzles('mateIn1', { fetch, store })).rejects.toThrow(LoaderError);
    await store.close();
  });

  it('sha256 mismatch: keeps cache, does not replace', async () => {
    const fetch = makeFetch({
      indexJson: makeIndexJson('v2', '0000000000000000000000000000000000000000000000000000000000000000'),
      themeJson: SAMPLE_THEME_FILE,
    });
    const store = await new Store().open();
    const original = [{ id: 'OLD', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 }];
    await store.replacePuzzles('mateIn1', original);
    await store.setVersion('v1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const puzzles = await loadPuzzles('mateIn1', { fetch, store });

    expect(puzzles).toEqual(original);
    expect(await store.getVersion()).toBe('v1');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await store.close();
  });

  it('progress callback fires during theme fetch', async () => {
    const sha = await sha256Hex(SAMPLE_THEME_FILE);
    const fetch = makeFetch({ indexJson: makeIndexJson('v1', sha), themeJson: SAMPLE_THEME_FILE });
    const store = await new Store().open();
    const onProgress = vi.fn();

    await loadPuzzles('mateIn1', { fetch, store, onProgress });

    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
    expect(lastCall[0]).toBeGreaterThan(0); // loaded > 0
    await store.close();
  });
});
