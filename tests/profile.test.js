import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Profiles, ProfileScopedStore } from '../src/profile.js';
import { Store } from '../src/store.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

async function openStoreWithMigration() {
  // Just opening a Store at v2 with no v1 data triggers the migration's
  // "create Player 1" path, since profilesCount === 0.
  return await new Store().open();
}

describe('Profiles', () => {
  it('load() picks up the migrated Player 1 and sets activeId', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    expect(profiles.list().length).toBe(1);
    expect(profiles.active().name).toBe('Player 1');
    expect(profiles.activeId).toBe(profiles.active().id);
    await store.close();
  });

  it('create() adds a profile with a palette color and persists it', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const p = await profiles.create('Alice');
    expect(p.name).toBe('Alice');
    expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(profiles.list().length).toBe(2);

    const profilesAfter = await new Profiles(store).load();
    expect(profilesAfter.list().find((q) => q.id === p.id)).toBeTruthy();
    await store.close();
  });

  it('create() trims, truncates to 20 chars, falls back for empty', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const p1 = await profiles.create('   ');
    expect(p1.name).toBe('New Player');
    const p2 = await profiles.create('a'.repeat(30));
    expect(p2.name.length).toBe(20);
    const p3 = await profiles.create('  Bob  ');
    expect(p3.name).toBe('Bob');
    await store.close();
  });

  it('rename() updates the name', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const p = await profiles.create('Alice');
    await profiles.rename(p.id, 'Bob');
    const reloaded = await new Profiles(store).load();
    expect(reloaded.list().find((q) => q.id === p.id).name).toBe('Bob');
    await store.close();
  });

  it('color round-robin: first 5 profiles get distinct palette colors; 6th cycles', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    // Player 1 already has the first color. Add 4 more for 5 total.
    const created = [];
    for (let i = 0; i < 4; i++) created.push(await profiles.create(`P${i}`));
    const allColors = profiles.list().map((p) => p.color);
    const distinct = new Set(allColors);
    expect(distinct.size).toBe(5);
    // The 6th should cycle (palette has 5 entries).
    const sixth = await profiles.create('Sixth');
    expect(['#f0d9b5', '#a8b8c4', '#b8cfb0', '#e8b89c', '#c9b4d8']).toContain(sixth.color);
    await store.close();
  });

  it('setActive() updates activeId and persists', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const p = await profiles.create('Alice');
    await profiles.setActive(p.id);
    const reloaded = await new Profiles(store).load();
    expect(reloaded.active().id).toBe(p.id);
    await store.close();
  });

  it('remove() throws when only one profile exists', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const onlyId = profiles.active().id;
    await expect(profiles.remove(onlyId)).rejects.toThrow(/only profile/);
    await store.close();
  });

  it('remove() throws when targeting the active profile', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    await profiles.create('Alice');
    const activeId = profiles.activeId;
    await expect(profiles.remove(activeId)).rejects.toThrow(/active profile/);
    await store.close();
  });

  it('remove() cascades to profile_meta', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const p = await profiles.create('Alice');
    await store.setProfileMeta(p.id, 'solved', 7);
    await store.setProfileMeta(p.id, 'theme', 'cool');

    await profiles.remove(p.id);

    expect(await store.getProfileMeta(p.id, 'solved')).toBeUndefined();
    expect(await store.getProfileMeta(p.id, 'theme')).toBeUndefined();
    expect(profiles.list().find((q) => q.id === p.id)).toBeUndefined();
    await store.close();
  });
});

describe('ProfileScopedStore', () => {
  it('routes getMeta/setMeta to profile_meta keyed by profileId', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const a = profiles.active();
    const b = await profiles.create('Bob');

    const aScoped = new ProfileScopedStore(store, a.id);
    const bScoped = new ProfileScopedStore(store, b.id);

    await aScoped.setMeta('solved', 10);
    await bScoped.setMeta('solved', 99);

    expect(await aScoped.getMeta('solved')).toBe(10);
    expect(await bScoped.getMeta('solved')).toBe(99);
    await store.close();
  });

  it('passes through puzzle methods to the underlying Store', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const scoped = new ProfileScopedStore(store, profiles.active().id);

    await scoped.replacePuzzles('all', [
      { id: 'X', fen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: ['a1a2','a3a4'], rating: 700, themes: ['mateIn1'], stars: 1 },
    ]);
    const got = await scoped.getAllPuzzles();
    expect(got.length).toBe(1);
    expect(got[0].id).toBe('X');
    await store.close();
  });

  it('passes through version/lastFetch to global meta', async () => {
    const store = await openStoreWithMigration();
    const profiles = await new Profiles(store).load();
    const scoped = new ProfileScopedStore(store, profiles.active().id);

    await scoped.setVersion('v123');
    expect(await scoped.getVersion()).toBe('v123');
    // Verify it's in the global meta store, not profile_meta.
    expect(await store.getMeta('version')).toBe('v123');
    await store.close();
  });
});
