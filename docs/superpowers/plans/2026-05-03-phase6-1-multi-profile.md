# Phase 6.1 Implementation Plan: Multi-profile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase 6.1 per `docs/superpowers/specs/2026-05-03-phase6-1-multi-profile-design.md` — let multiple kids share the device with isolated stats, streaks, filter prefs, and settings, switchable from the settings sheet.

**Architecture:** `Store` upgrades to DB v2 with two new object stores (`profiles`, `profile_meta`) and a one-time migration that auto-creates "Player 1" with existing data preserved. A new `Profiles` class manages CRUD; a `ProfileScopedStore` wrapper mirrors the `Store` API so existing `Stats` / `Filters` / `Settings` work unchanged. Profile UI sits at the top of the settings sheet; switching profiles triggers a full page reload.

**Tech Stack:** Same as Phase 5 — vanilla JS ES modules, Vitest, no bundler. No new dependencies.

---

## Background and conventions

- **DB version bump v1 → v2** in `src/store.js`. Migration runs in a normal transaction immediately after `openDB` resolves (the upgrade transaction in `idb` doesn't ergonomically support read-then-write across stores).
- **Per-profile keys list** is the source of truth for the migration: `solved, streak, bestStreak, todayCount, todayDate, filterTheme, filterMaxStars, soundOn, theme, showCoords`.
- **`ProfileScopedStore`** mirrors `Store`'s `getMeta`/`setMeta` so `Stats`/`Filters`/`Settings` need no changes. Puzzle methods + version/lastFetch pass through unchanged.
- **Switch profile = `setActive(id)` + `window.location.reload()`** — guaranteed clean state with zero re-instantiation logic.
- **Profile color palette** (5 entries, round-robin): `#f0d9b5, #a8b8c4, #b8cfb0, #e8b89c, #c9b4d8`.

---

## Task 1: Store schema upgrade + new methods (TDD)

**Files:**
- Modify: `src/store.js`
- Modify: `tests/store.test.js`

This task adds DB v2 schema, the migration logic, and five new Store methods (`listProfiles`, `putProfile`, `deleteProfile`, `getProfileMeta`, `setProfileMeta`).

- [ ] **Step 1: Write the failing migration test**

Append to `tests/store.test.js` (above the closing `});` of `describe('Store', ...)`):

```js
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
```

The test file already imports `'fake-indexeddb/auto'` and `IDBFactory` for the `beforeEach` reset. The `openDB` import inside the migration test is dynamic (avoids polluting top-level imports for tests that don't need it).

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/store.test.js`
Expected: FAIL — `store.listProfiles is not a function` (or similar; v2 schema doesn't exist yet).

- [ ] **Step 3: Update `src/store.js`**

Replace the `class Store` implementation with the v2 version. Locate the existing class:

```js
const DB_NAME = 'chess-puzzles';
const DB_VERSION = 1;

export class Store {
  // ... existing v1 implementation ...
}
```

Replace with:

```js
const DB_NAME = 'chess-puzzles';
const DB_VERSION = 2;

const PER_PROFILE_KEYS = [
  'solved', 'streak', 'bestStreak', 'todayCount', 'todayDate',
  'filterTheme', 'filterMaxStars',
  'soundOn', 'theme', 'showCoords',
];

const FIRST_PALETTE_COLOR = '#f0d9b5';

export class Store {
  constructor() {
    this.db = null;
  }

  async open() {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('meta',    { keyPath: 'key' });
          db.createObjectStore('puzzles', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          db.createObjectStore('profiles',     { keyPath: 'id' });
          db.createObjectStore('profile_meta', { keyPath: ['profileId', 'key'] });
        }
      },
    });
    await this.maybeRunMigration();
    return this;
  }

  async maybeRunMigration() {
    const profilesCount = await this.db.count('profiles');
    if (profilesCount > 0) return;

    const tx = this.db.transaction(['meta', 'profiles', 'profile_meta'], 'readwrite');
    const metaStore = tx.objectStore('meta');
    const profilesStore = tx.objectStore('profiles');
    const profileMetaStore = tx.objectStore('profile_meta');

    const profile = {
      id: cryptoRandomId(),
      name: 'Player 1',
      color: FIRST_PALETTE_COLOR,
      createdAt: Date.now(),
    };
    await profilesStore.put(profile);
    await metaStore.put({ key: 'activeProfileId', value: profile.id });

    for (const key of PER_PROFILE_KEYS) {
      const row = await metaStore.get(key);
      if (row && row.value !== undefined) {
        await profileMetaStore.put({ profileId: profile.id, key, value: row.value });
        await metaStore.delete(key);
      }
    }
    await tx.done;
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async getMeta(key) {
    const row = await this.db.get('meta', key);
    return row?.value;
  }

  async setMeta(key, value) {
    await this.db.put('meta', { key, value });
  }

  getVersion()  { return this.getMeta('version'); }
  setVersion(v) { return this.setMeta('version', v); }
  getLastFetch()  { return this.getMeta('lastFetch'); }
  setLastFetch(v) { return this.setMeta('lastFetch', v); }

  async getAllPuzzles() {
    return await this.db.getAll('puzzles');
  }

  async replacePuzzles(_theme, puzzles) {
    const tx = this.db.transaction('puzzles', 'readwrite');
    const store = tx.objectStore('puzzles');
    await store.clear();
    for (const p of puzzles) {
      await store.put(p);
    }
    await tx.done;
  }

  // ───────── Profile-related methods ─────────

  async listProfiles() {
    return await this.db.getAll('profiles');
  }

  async putProfile(profile) {
    await this.db.put('profiles', profile);
  }

  async deleteProfile(id) {
    const tx = this.db.transaction(['profiles', 'profile_meta'], 'readwrite');
    await tx.objectStore('profiles').delete(id);
    const pmStore = tx.objectStore('profile_meta');
    let cursor = await pmStore.openCursor();
    while (cursor) {
      if (cursor.value.profileId === id) await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async getProfileMeta(profileId, key) {
    const row = await this.db.get('profile_meta', [profileId, key]);
    return row?.value;
  }

  async setProfileMeta(profileId, key, value) {
    await this.db.put('profile_meta', { profileId, key, value });
  }
}

function cryptoRandomId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

The signatures for the existing `Store` methods (`open`, `close`, `getMeta`, `setMeta`, `getVersion`, `setVersion`, `getLastFetch`, `setLastFetch`, `getAllPuzzles`, `replacePuzzles`) are preserved unchanged. Five new methods are added.

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/store.test.js`
Expected: 6 prior store tests + 4 new = 10 store tests pass.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 116 prior + 4 new = 120 tests pass.

If any existing tests fail (e.g., one that relied on `getAllPuzzles` returning empty after migration), debug. The migration shouldn't affect puzzles store at all.

- [ ] **Step 6: Commit**

```bash
git add src/store.js tests/store.test.js
git commit -m "Store v2 schema: profiles + profile_meta stores, v1→v2 migration"
```

---

## Task 2: `Profiles` class + `ProfileScopedStore` wrapper (TDD)

**Files:**
- Create: `src/profile.js`
- Create: `tests/profile.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/profile.test.js`:

```js
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
```

- [ ] **Step 2: Run, expect failure**

Run: `npm test -- tests/profile.test.js`
Expected: FAIL — `../src/profile.js` not found.

- [ ] **Step 3: Implement `src/profile.js`**

```js
// src/profile.js
// Profiles class manages the active profile and the profile list, persisting
// via the Store's new profiles + profile_meta object stores.
//
// ProfileScopedStore wraps Store so existing modules (Stats, Filters,
// Settings) call getMeta/setMeta unchanged; the wrapper routes those calls
// to the active profile's compound-keyed rows in profile_meta.

const PALETTE = ['#f0d9b5', '#a8b8c4', '#b8cfb0', '#e8b89c', '#c9b4d8'];

export class Profiles {
  constructor(store) {
    this.store = store;
    this.profiles = [];
    this.activeId = null;
  }

  async load() {
    this.profiles = await this.store.listProfiles();
    this.activeId = await this.store.getMeta('activeProfileId');
    if (!this.activeId && this.profiles.length > 0) {
      this.activeId = this.profiles[0].id;
      await this.store.setMeta('activeProfileId', this.activeId);
    }
    return this;
  }

  list()   { return this.profiles.slice(); }
  active() { return this.profiles.find((p) => p.id === this.activeId) ?? null; }

  async create(name) {
    const trimmed = (name || '').trim().slice(0, 20) || 'New Player';
    const usedColors = new Set(this.profiles.map((p) => p.color));
    const color = PALETTE.find((c) => !usedColors.has(c)) ?? PALETTE[this.profiles.length % PALETTE.length];
    const profile = { id: cryptoRandomId(), name: trimmed, color, createdAt: Date.now() };
    await this.store.putProfile(profile);
    this.profiles.push(profile);
    return profile;
  }

  async rename(id, name) {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return;
    const trimmed = (name || '').trim().slice(0, 20);
    profile.name = trimmed || profile.name;
    await this.store.putProfile(profile);
  }

  async remove(id) {
    if (this.profiles.length <= 1) throw new Error('Cannot delete the only profile');
    if (id === this.activeId)       throw new Error('Cannot delete the active profile');
    await this.store.deleteProfile(id);
    this.profiles = this.profiles.filter((p) => p.id !== id);
  }

  async setActive(id) {
    if (!this.profiles.some((p) => p.id === id)) throw new Error('Unknown profile id');
    this.activeId = id;
    await this.store.setMeta('activeProfileId', id);
  }
}

export class ProfileScopedStore {
  constructor(store, profileId) {
    this.store = store;
    this.profileId = profileId;
  }

  async getMeta(key) {
    return await this.store.getProfileMeta(this.profileId, key);
  }
  async setMeta(key, value) {
    return await this.store.setProfileMeta(this.profileId, key, value);
  }

  getAllPuzzles() { return this.store.getAllPuzzles(); }
  replacePuzzles(...args) { return this.store.replacePuzzles(...args); }
  getVersion()    { return this.store.getVersion(); }
  setVersion(v)   { return this.store.setVersion(v); }
  getLastFetch()  { return this.store.getLastFetch(); }
  setLastFetch(v) { return this.store.setLastFetch(v); }
}

function cryptoRandomId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run, expect tests to pass**

Run: `npm test -- tests/profile.test.js`
Expected: 12 tests pass (9 Profiles + 3 ProfileScopedStore).

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 132 tests pass (120 + 12).

- [ ] **Step 6: Commit**

```bash
git add src/profile.js tests/profile.test.js
git commit -m "Add Profiles class + ProfileScopedStore wrapper with TDD"
```

---

## Task 3: Profile UI in settings sheet

**Files:**
- Create: `src/ui/profile.js`
- Modify: `index.html` (profile section markup at top of settings sheet)
- Modify: `src/ui/settings.js` (accept `profiles` param; call `bindProfileSection`)
- Modify: `src/ui/styles.css` (profile section styles)

UI-only task; manual verification in Task 6.

- [ ] **Step 1: Add markup to `index.html`**

Inside the existing `<div id="settings-sheet">`, locate the first `<div class="setting-row">` (which is the Sound row). Insert the profile section as the FIRST children of `<div id="settings-sheet">`, before any existing rows. The settings-sheet block should now look like:

```html
<div id="settings-sheet" class="settings-sheet" role="dialog" aria-label="Settings">
  <div class="settings-sheet-header">
    <h2>Settings</h2>
    <button id="settings-close" type="button" class="settings-close" aria-label="Close">×</button>
  </div>

  <!-- Phase 6.1: profile section -->
  <div class="setting-row profile-row">
    <button id="profile-active" type="button" class="profile-active" aria-label="Switch profile">
      <span id="profile-active-avatar" class="profile-avatar"></span>
      <span id="profile-active-name" class="profile-active-name"></span>
      <span class="profile-active-chevron">›</span>
    </button>
    <button id="profile-rename" type="button" class="profile-rename" aria-label="Rename profile">✏</button>
  </div>
  <div id="profile-switcher" class="profile-switcher" hidden>
    <div id="profile-list" class="profile-list"></div>
    <button id="profile-add" type="button" class="profile-add">+ Add profile</button>
  </div>

  <!-- existing Sound, Theme, Coordinates, Reset Stats rows below... -->
  <div class="setting-row">
    <span>Sound</span>
    <!-- ... existing content unchanged ... -->
  </div>
  <!-- (rest of existing rows) -->
</div>
```

Don't change the existing rows; just insert the new ones before them.

- [ ] **Step 2: Create `src/ui/profile.js`**

```js
// src/ui/profile.js
// Renders the profile section of the settings sheet:
//   - active row: avatar (color circle with initial) + name + chevron + ✏
//   - expandable switcher panel: profile list with Switch/Delete + Add button
//
// Switching or adding a profile triggers a full page reload so Stats/
// Filters/Settings are re-instantiated cleanly under the new active id.

export function bindProfileSection({ profiles }) {
  const activeRow    = document.querySelector('#profile-active');
  const activeAvatar = document.querySelector('#profile-active-avatar');
  const activeName   = document.querySelector('#profile-active-name');
  const renameBtn    = document.querySelector('#profile-rename');
  const switcher     = document.querySelector('#profile-switcher');
  const listEl       = document.querySelector('#profile-list');
  const addBtn       = document.querySelector('#profile-add');

  renderActive();
  renderList();

  activeRow.addEventListener('click', () => {
    switcher.hidden = !switcher.hidden;
  });

  renameBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const cur = profiles.active();
    if (!cur) return;
    const next = prompt('Rename profile:', cur.name);
    if (next == null) return;
    await profiles.rename(cur.id, next);
    renderActive();
    renderList();
  });

  addBtn.addEventListener('click', async () => {
    const name = prompt('What’s your name?');
    if (name == null) return;
    const profile = await profiles.create(name);
    await profiles.setActive(profile.id);
    window.location.reload();
  });

  function renderActive() {
    const cur = profiles.active();
    if (!cur) return;
    activeName.textContent = cur.name;
    paintAvatar(activeAvatar, cur);
  }

  function renderList() {
    listEl.replaceChildren(...profiles.list().map((p) => makeRow(p)));
  }

  function makeRow(p) {
    const row = document.createElement('div');
    row.className = 'profile-row-item' + (p.id === profiles.active()?.id ? ' is-active' : '');
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    paintAvatar(avatar, p);
    const name = document.createElement('span');
    name.className = 'profile-row-name';
    name.textContent = p.name;
    row.append(avatar, name);

    if (p.id !== profiles.active()?.id) {
      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'profile-switch';
      switchBtn.textContent = 'Switch';
      switchBtn.addEventListener('click', async () => {
        await profiles.setActive(p.id);
        window.location.reload();
      });
      row.appendChild(switchBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'profile-delete';
      delBtn.setAttribute('aria-label', `Delete ${p.name}`);
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete ${p.name}? Their stats will be lost.`)) return;
        try {
          await profiles.remove(p.id);
          renderList();
        } catch (err) {
          alert(err.message);
        }
      });
      row.appendChild(delBtn);
    }

    return row;
  }

  function paintAvatar(el, p) {
    el.textContent = (p.name || '?').charAt(0).toUpperCase();
    el.style.background = p.color;
  }
}
```

- [ ] **Step 3: Update `src/ui/settings.js`**

Add the import for `bindProfileSection` near the other imports at the top of the file:

```js
import { bindProfileSection } from './profile.js';
```

Update the `bindSettings` function signature to accept `profiles`:

```js
export function bindSettings({ settings, profiles, onResetStats }) {
```

At the very start of the function body (before any of the existing `const gear = ...` lookups), add:

```js
  bindProfileSection({ profiles });
```

The full first lines of the function become:

```js
export function bindSettings({ settings, profiles, onResetStats }) {
  bindProfileSection({ profiles });

  const gear = document.querySelector('#gear-btn');
  // ... rest unchanged ...
```

- [ ] **Step 4: Append profile CSS to `src/ui/styles.css`**

Append:

```css
/* Phase 6.1: profile section in settings sheet */

.profile-row {
  align-items: center;
  gap: 8px;
}

.profile-active {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  background: transparent;
  border: none;
  color: #efe6dc;
  font-size: 16px;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.profile-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-weight: 600;
  color: #2a201a;
  background: #f0d9b5;
  flex: 0 0 auto;
}

.profile-active-name {
  flex: 1;
  font-weight: 600;
}

.profile-active-chevron {
  color: #b88550;
  font-size: 18px;
}

.profile-rename {
  background: transparent;
  border: none;
  color: #efe6dc;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
}

.profile-switcher {
  margin-top: 8px;
  border-top: 1px solid #4a3525;
  padding-top: 8px;
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-row-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-radius: 8px;
}

.profile-row-item.is-active {
  background: #4a3525;
}

.profile-row-name {
  flex: 1;
  font-size: 15px;
}

.profile-switch,
.profile-delete {
  background: transparent;
  border: 2px solid #5a3a22;
  color: #efe6dc;
  border-radius: 8px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}

.profile-delete {
  border-color: #a85a3c;
  padding: 4px 8px;
}

.profile-add {
  margin-top: 8px;
  width: 100%;
  min-height: 40px;
  background: #2a201a;
  border: 2px solid #5a3a22;
  color: #efe6dc;
  border-radius: 8px;
  cursor: pointer;
  font-size: 15px;
}
```

- [ ] **Step 5: Smoke-check the new module imports**

Run: `node --input-type=module -e "import('./src/ui/profile.js').then(m => console.log(Object.keys(m)))"`
Expected: prints `[ 'bindProfileSection' ]`.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: 132 tests still pass (CSS/HTML/binding additions don't affect Node-side tests).

- [ ] **Step 7: Commit**

```bash
git add src/ui/profile.js src/ui/settings.js index.html src/ui/styles.css
git commit -m "Add profile section UI: avatar, switcher panel, rename/add/delete"
```

---

## Task 4: Wire `app.js`

**Files:**
- Modify: `src/app.js`

Surgical edit. The order of construction matters: `Profiles` first, then `ProfileScopedStore`, then `Stats`/`Filters`/`Settings` constructed with the scoped store.

- [ ] **Step 1: Add the new imports**

At the top of `src/app.js`, locate the existing `import { Settings } from './settings.js';` line. Add immediately after:

```js
import { Profiles, ProfileScopedStore } from './profile.js';
```

- [ ] **Step 2: Restructure the `main()` post-loader section**

Find the existing block in `main()`:

```js
const store = await new Store().open();
stats   = await new Stats(store).load();
filters = await new Filters(store, puzzles).load();
```

(Plus the Settings load that was added in Phase 5.)

Replace the existing instantiations to use the scoped store. The replacement block:

```js
const store = await new Store().open();
const profiles = await new Profiles(store).load();
const active = profiles.active(); // never null after load (migration creates Player 1)
const scopedStore = new ProfileScopedStore(store, active.id);

stats    = await new Stats(scopedStore).load();
filters  = await new Filters(scopedStore, puzzles).load();
settings = await new Settings(scopedStore).load();
settings.apply();

renderStats(stats.snapshot());
renderChips({ active: filters.theme, counts: filters.counts(), onSelect: handleThemeChange });
renderStars({ cap: filters.maxStars, onSelect: handleStarChange });

bindSettings({
  settings,
  profiles,
  onResetStats: async () => {
    await stats.reset();
    renderStats(stats.snapshot());
  },
});
```

The key changes:
- `Profiles` constructed first (before any per-profile module).
- `ProfileScopedStore` wraps `store` for the active profile.
- `Stats`, `Filters`, `Settings` constructed with `scopedStore` (no internal change to those classes; their `getMeta`/`setMeta` calls now route through the wrapper).
- `bindSettings` gets the new `profiles` param.

- [ ] **Step 3: Smoke-check**

Run: `node --input-type=module -e "import('./src/app.js').then(() => console.log('ok')).catch(e => console.log('IMPORT-ONLY:', e.message))"`
Expected: prints `IMPORT-ONLY: Cannot find package ...` (browser-only). Not a syntax error.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: 132 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "Wire app.js to multi-profile: Profiles + ProfileScopedStore"
```

---

## Task 5: Service worker update

**Files:**
- Modify: `sw.js`

Add the two new modules to the precache list and bump `SW_VERSION` so the activate handler purges the old cache.

- [ ] **Step 1: Update `sw.js`**

Find the `SW_VERSION` constant and bump from `'v4'` to `'v5'`:

```js
const SW_VERSION = 'v5';
```

In the `APP_SHELL` array, find the line `'./src/filters.js',` and add immediately after:

```js
  './src/profile.js',
```

In the same array, find the line `'./src/ui/install.js',` and add immediately after:

```js
  './src/ui/profile.js',
```

The two new entries keep their alphabetical-ish neighbor pattern (settings-relations grouped together).

- [ ] **Step 2: Sanity-check syntax**

Run: `node --check sw.js`
Expected: no output (success).

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: 132 tests still pass (sw.js isn't unit-tested).

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "Bump SW to v5; precache profile.js and ui/profile.js"
```

---

## Task 6: Manual test pass

**Files:** none (exercise the running app, fix any code as issues are found)

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`
Expected: server on port 8000.

- [ ] **Step 2: Walk the manual checklist**

Open Chrome at `http://localhost:8000`. Use DevTools → Application → IndexedDB → `chess-puzzles` to inspect state when noted.

1. **Migration on existing data.** With existing Phase-5 IDB state (do NOT clear site data), reload after this update. App shows the same stats, theme, filter prefs as before. Open settings → "Player 1" appears at the top with auto-assigned cream avatar. Stats unchanged. Inspect IDB: `profiles` store has 1 row; `meta` no longer has solved/streak/etc; `profile_meta` has rows under Player 1's id.
2. **Rename.** Tap ✏ next to "Player 1". Type the kid's actual name. Save. Settings sheet updates the active row.
3. **Add second profile.** Tap row → "+ Add profile" → enter name. Page reloads under the new profile. Stats header shows zero. Theme / sound / coords reset to defaults (new profile, no settings yet).
4. **Switch back to Player 1.** Open settings → tap row → "Switch" next to Player 1. Page reloads. Stats and settings restored.
5. **Add third profile.** Repeat. Each gets a different palette color avatar (cream / slate-blue / mint).
6. **Delete a profile.** From a different active profile, tap 🗑 next to a non-active profile. Confirm dialog. Profile removed. Cannot delete active profile (alert blocks). Cannot delete only-remaining profile after deleting all but one (alert blocks).
7. **Persistence across reloads.** Reload the app. Active profile preserved.
8. **Sound + theme + coords are per-profile.** Set sound on for Player A, theme cool. Switch to Player B. Sound off, theme warm.
9. **Stats are per-profile.** Solve puzzles as A → solved count rises for A only. Switch to B → solved count is independent.
10. **Filter prefs are per-profile.** A picks Fork + 5 stars; B picks All + 2 stars. Each is restored on switch.
11. **Sound effects / confetti / reduced-motion behavior unchanged within a profile** (regression check from Phase 5).
12. **Reset stats stays per-profile.** Reset stats from settings sheet. Active profile's stats zero out. Switch to another profile. Their stats unchanged.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "<descriptive message per fix>"
```

---

## Definition of done

- [ ] `npm install`, `npm run vendor`, `npm run icons`, `npm run build-puzzles`, `npm test`, `npm run dev` all work from clean clone.
- [ ] All unit tests pass (~132 total: 116 prior + 4 store + 12 profile).
- [ ] Existing single-profile users see their data preserved after the update (verified via the migration unit test + manual test).
- [ ] Add / rename / delete / switch profile all work via the settings sheet.
- [ ] Stats, settings, and filter prefs are independent across profiles.
- [ ] The active profile cannot be deleted; the only-remaining profile cannot be deleted (alert blocks).
- [ ] Profile color avatars cycle through the five-color palette.
- [ ] No console errors during normal operation.
- [ ] SW APP_SHELL list updated; SW_VERSION bumped to v5.

---

## Self-review notes

- **Spec coverage:** Every spec section maps to a task. Schema upgrade + migration = Task 1. Profiles class + ProfileScopedStore = Task 2. Profile UI = Task 3. App wiring = Task 4. SW update = Task 5. Manual test = Task 6.
- **Placeholder check:** No TBD/TODO. All code blocks are concrete.
- **Type consistency:** `Profiles.create / rename / remove / setActive / list / active / activeId` consistent across plan + spec + tests. `ProfileScopedStore.getMeta / setMeta / getAllPuzzles / replacePuzzles / getVersion / setVersion / getLastFetch / setLastFetch` consistent. `Store.listProfiles / putProfile / deleteProfile / getProfileMeta / setProfileMeta` consistent.
- **Test count math:** Phase 5 ended at 116. Task 1 adds 4 store tests. Task 2 adds 12 profile tests. Total: 132.
- **Risk surface called out:** the migration test seeds v1 IDB with raw `idb` library before opening Store at v2. fake-indexeddb correctly handles cross-version opens; this pattern is standard. If a test environment's IDB doesn't honor the `oldVersion` parameter in the upgrade callback, we'd see incorrect migration behavior — but fake-indexeddb 6.x handles this cleanly.
