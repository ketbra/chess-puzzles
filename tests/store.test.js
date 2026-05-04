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

  it('v1 → v2 migration: creates Player 1 and moves per-profile keys', async () => {
    // Seed v1 schema with raw idb, then open Store at v2.
    const { openDB } = await import('idb');
    const v1db = await openDB('chess-puzzles', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('puzzles')) {
          db.createObjectStore('puzzles', { keyPath: 'id' });
        }
      },
    });
    await v1db.put('meta', { key: 'solved', value: 42 });
    await v1db.put('meta', { key: 'streak', value: 7 });
    await v1db.put('meta', { key: 'theme', value: 'cool' });
    await v1db.put('meta', { key: 'soundOn', value: true });
    await v1db.put('meta', { key: 'version', value: '2026-05-03' });
    v1db.close();

    const store = await new Store().open();

    const profiles = await store.listProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].name).toBe('Player 1');
    expect(profiles[0].color).toBe('#f0d9b5');

    const activeId = await store.getMeta('activeProfileId');
    expect(activeId).toBe(profiles[0].id);

    expect(await store.getProfileMeta(profiles[0].id, 'solved')).toBe(42);
    expect(await store.getProfileMeta(profiles[0].id, 'streak')).toBe(7);
    expect(await store.getProfileMeta(profiles[0].id, 'theme')).toBe('cool');
    expect(await store.getProfileMeta(profiles[0].id, 'soundOn')).toBe(true);

    // Global keys unchanged.
    expect(await store.getMeta('version')).toBe('2026-05-03');

    // Per-profile keys removed from global meta.
    const tx = store.db.transaction('meta', 'readonly');
    const row = await tx.objectStore('meta').get('solved');
    expect(row).toBeUndefined();

    await store.close();
  });

  it('v2 schema: profiles and profile_meta stores exist after open', async () => {
    const store = await new Store().open();
    const names = Array.from(store.db.objectStoreNames);
    expect(names).toContain('profiles');
    expect(names).toContain('profile_meta');
    expect(names).toContain('meta');
    expect(names).toContain('puzzles');
    await store.close();
  });

  it('listProfiles / putProfile / getProfileMeta / setProfileMeta round-trip', async () => {
    const store = await new Store().open();
    const profile = { id: 'p1', name: 'Alice', color: '#f0d9b5', createdAt: 1000 };
    await store.putProfile(profile);

    const list = await store.listProfiles();
    // After migration, Player 1 also exists. So we expect 2 profiles total.
    expect(list.find((p) => p.id === 'p1')).toEqual(profile);

    await store.setProfileMeta('p1', 'solved', 99);
    expect(await store.getProfileMeta('p1', 'solved')).toBe(99);

    await store.close();
  });

  it('deleteProfile cascades to profile_meta rows', async () => {
    const store = await new Store().open();
    await store.putProfile({ id: 'pX', name: 'Bob', color: '#a8b8c4', createdAt: 2000 });
    await store.setProfileMeta('pX', 'solved', 5);
    await store.setProfileMeta('pX', 'theme', 'cool');

    await store.deleteProfile('pX');

    expect(await store.getProfileMeta('pX', 'solved')).toBeUndefined();
    expect(await store.getProfileMeta('pX', 'theme')).toBeUndefined();
    const list = await store.listProfiles();
    expect(list.find((p) => p.id === 'pX')).toBeUndefined();

    await store.close();
  });
});
