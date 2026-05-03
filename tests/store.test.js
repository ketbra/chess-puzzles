import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';            // installs fake indexedDB on globalThis
import { IDBFactory } from 'fake-indexeddb';
import { Store } from '../src/store.js';

const SAMPLE_PUZZLES = [
  { id: 'A1', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 },
  { id: 'B2', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['b1b2','b3b4'], rating: 800, themes: ['mateIn1'], stars: 2 },
  { id: 'C3', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['c1c2','c3c4'], rating: 900, themes: ['mateIn1'], stars: 2 },
];

beforeEach(() => {
  // Reset the fake-indexeddb so each test starts with a clean DB.
  globalThis.indexedDB = new IDBFactory();
});

describe('Store', () => {
  it('open creates the meta and puzzles object stores', async () => {
    const store = await new Store().open();
    // We can verify by writing/reading meta and puzzles below.
    expect(await store.getVersion()).toBeUndefined();
    expect(await store.getAllPuzzles()).toEqual([]);
    await store.close();
  });

  it('round-trips version', async () => {
    const store = await new Store().open();
    await store.setVersion('2026-05-03');
    expect(await store.getVersion()).toBe('2026-05-03');
    await store.close();
  });

  it('round-trips lastFetch', async () => {
    const store = await new Store().open();
    await store.setLastFetch(1234567890);
    expect(await store.getLastFetch()).toBe(1234567890);
    await store.close();
  });

  it('replacePuzzles writes all entries', async () => {
    const store = await new Store().open();
    await store.replacePuzzles('mateIn1', SAMPLE_PUZZLES);
    const got = await store.getAllPuzzles();
    expect(got.length).toBe(3);
    expect(got.map((p) => p.id).sort()).toEqual(['A1', 'B2', 'C3']);
    await store.close();
  });

  it('replacePuzzles replaces, not appends', async () => {
    const store = await new Store().open();
    await store.replacePuzzles('mateIn1', SAMPLE_PUZZLES);
    await store.replacePuzzles('mateIn1', [SAMPLE_PUZZLES[0]]);
    const got = await store.getAllPuzzles();
    expect(got.length).toBe(1);
    expect(got[0].id).toBe('A1');
    await store.close();
  });

  it('persists across close + reopen', async () => {
    const s1 = await new Store().open();
    await s1.replacePuzzles('mateIn1', SAMPLE_PUZZLES);
    await s1.setVersion('v1');
    await s1.close();

    const s2 = await new Store().open();
    expect(await s2.getVersion()).toBe('v1');
    expect((await s2.getAllPuzzles()).length).toBe(3);
    await s2.close();
  });
});
