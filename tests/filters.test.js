import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Filters } from '../src/filters.js';
import { Store } from '../src/store.js';

const PUZZLE = (id, themes, stars) => ({
  id, fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'],
  rating: 850, themes, stars,
});

const POOL = [
  PUZZLE('A', ['mateIn1'],         1),
  PUZZLE('B', ['mateIn1'],         3),
  PUZZLE('C', ['mateIn2'],         2),
  PUZZLE('D', ['fork'],            1),
  PUZZLE('E', ['fork', 'mateIn1'], 2),
  PUZZLE('F', ['pin'],             4),
  PUZZLE('G', ['hangingPiece'],    2),
];

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('Filters', () => {
  it('default theme=all, maxStars=2', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    expect(filters.theme).toBe('all');
    expect(filters.maxStars).toBe(2);
    await store.close();
  });

  it('rebuildPool: theme=all + maxStars=2 filters by stars only', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    expect(filters.pool.map((p) => p.id).sort()).toEqual(['A','C','D','E','G']);
    await store.close();
  });

  it('rebuildPool: theme=mateIn1 + maxStars=5 returns only mateIn1', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    await filters.setMaxStars(5);
    await filters.setTheme('mateIn1');
    expect(filters.pool.map((p) => p.id).sort()).toEqual(['A','B','E']);
    await store.close();
  });

  it('counts: per-theme counts under current maxStars cap', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    const c = filters.counts();
    expect(c.all).toBe(5);
    expect(c.mateIn1).toBe(2);
    expect(c.mateIn2).toBe(1);
    expect(c.fork).toBe(2);
    expect(c.pin).toBe(0);
    expect(c.hangingPiece).toBe(1);
    await store.close();
  });

  it('shuffle + cycle: next() returns each puzzle exactly once before any repeat', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const p = filters.next();
      expect(p).toBeTruthy();
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
    }
    expect(seen.size).toBe(5);
    const sixth = filters.next();
    expect(['A','C','D','E','G']).toContain(sixth.id);
    await store.close();
  });

  it('empty pool: next() returns null', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    await filters.setTheme('pin');
    await filters.setMaxStars(1);
    expect(filters.pool.length).toBe(0);
    expect(filters.next()).toBeNull();
    await store.close();
  });

  it('persistence: theme + maxStars round-trip through Store', async () => {
    const store = await new Store().open();
    const f1 = await new Filters(store, POOL).load();
    await f1.setTheme('fork');
    await f1.setMaxStars(3);
    await store.close();

    const store2 = await new Store().open();
    const f2 = await new Filters(store2, POOL).load();
    expect(f2.theme).toBe('fork');
    expect(f2.maxStars).toBe(3);
    await store2.close();
  });
});
