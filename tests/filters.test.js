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
  it('default theme=all, range=[1, 2]', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    expect(filters.theme).toBe('all');
    expect(filters.minStars).toBe(1);
    expect(filters.maxStars).toBe(2);
    await store.close();
  });

  it('rebuildPool: theme=all + range=[1,2] filters by star range', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    expect(filters.pool.map((p) => p.id).sort()).toEqual(['A','C','D','E','G']);
    await store.close();
  });

  it('rebuildPool: range can exclude low stars (lower bound matters)', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    await filters.setStarRange(2, 3);
    expect(filters.pool.map((p) => p.id).sort()).toEqual(['B','C','E','G']);
    await store.close();
  });

  it('rebuildPool: exact-match a single star (range=[N,N])', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    await filters.setStarRange(3, 3);
    expect(filters.pool.map((p) => p.id).sort()).toEqual(['B']);
    await store.close();
  });

  it('rebuildPool: range=[1,5] + theme=mateIn1 returns only mateIn1', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    await filters.setStarRange(1, 5);
    await filters.setTheme('mateIn1');
    expect(filters.pool.map((p) => p.id).sort()).toEqual(['A','B','E']);
    await store.close();
  });

  it('counts: per-theme counts under current range', async () => {
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

  it('counts: respect lower bound', async () => {
    const store = await new Store().open();
    const filters = await new Filters(store, POOL).load();
    await filters.setStarRange(3, 5);
    const c = filters.counts();
    expect(c.all).toBe(2);          // B (3-star) + F (4-star)
    expect(c.mateIn1).toBe(1);      // B
    expect(c.pin).toBe(1);          // F
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
    await filters.setStarRange(1, 1);   // pin puzzle is 4-star → no match
    expect(filters.pool.length).toBe(0);
    expect(filters.next()).toBeNull();
    await store.close();
  });

  it('persistence: theme + range round-trip through Store', async () => {
    const store = await new Store().open();
    const f1 = await new Filters(store, POOL).load();
    await f1.setTheme('fork');
    await f1.setStarRange(2, 4);
    await store.close();

    const store2 = await new Store().open();
    const f2 = await new Filters(store2, POOL).load();
    expect(f2.theme).toBe('fork');
    expect(f2.minStars).toBe(2);
    expect(f2.maxStars).toBe(4);
    await store2.close();
  });

  it('migration: existing filterMaxStars without filterMinStars defaults min to 1', async () => {
    const store = await new Store().open();
    // Simulate pre-update state: only filterMaxStars set.
    await store.setMeta('filterMaxStars', 3);

    const filters = await new Filters(store, POOL).load();
    expect(filters.minStars).toBe(1);
    expect(filters.maxStars).toBe(3);
    await store.close();
  });
});
